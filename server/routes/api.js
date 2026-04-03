const express = require('express');
const multer = require('multer');
const Replicate = require('replicate');
require('dotenv').config();

const { requireAuth, checkCredits } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

function toDataURI(buffer, mimetype) {
  return 'data:' + mimetype + ';base64,' + buffer.toString('base64');
}

function extractUrl(output) {
  if (output && typeof output === 'object' && typeof output.url === 'function') {
    const u = output.url();
    return u.href || u.toString();
  }
  if (typeof output === 'string' && output.startsWith('http')) return output;
  if (Array.isArray(output) && output.length > 0) return extractUrl(output[0]);
  if (typeof output === 'string' && output.startsWith('data:')) return output;
  throw new Error('Formato de output no reconocido: ' + typeof output);
}

async function replicateResultToBase64(output) {
  const url = extractUrl(output);
  if (url.startsWith('data:')) return url;

  const fetch = (await import('node-fetch')).default;
  console.log('Downloading from:', url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Download failed: ' + response.status + ' ' + response.statusText);
  }
  const arrayBuf = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const contentType = response.headers.get('content-type') || 'image/png';
  console.log('Downloaded:', (buffer.length / 1024 / 1024).toFixed(2) + 'MB, type:', contentType);
  return 'data:' + contentType + ';base64,' + buffer.toString('base64');
}

// 1. Mejorar Rostro — CodeFormer solo (fotos borrosas/viejas normales)
router.post('/improve-face', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);
    const output = await replicate.run(
      "sczhou/codeformer:cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2",
      { input: { image: dataURI, fidelity: 0.7, background_enhance: true, face_upsample: true, upscale: 2 } }
    );
    const base64 = await replicateResultToBase64(output);
    res.json({ success: true, result: base64 });
  } catch (err) {
    console.error('improve-face error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

// 2. Reconstruir Rostro — Nano Banana (inpainting) + CodeFormer (fotos MUY danadas)
router.post('/reconstruct-face', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);

    // Paso 1: Nano Banana — reconstruye partes faltantes con IA generativa
    const step1Raw = await replicate.run(
      "google/nano-banana:5bdc2c7cd642ae33611d8c33f79615f98ff02509ab8db9d8ec1cc6c36d378fba",
      { input: {
        prompt: "restore this damaged old photograph, reconstruct all missing facial features, remove all damage and torn paper, output a clean pristine portrait photo, photorealistic restoration",
        image_input: [dataURI],
        aspect_ratio: "match_input_image",
        output_format: "png"
      }}
    );
    const step1Url = extractUrl(step1Raw);

    // Paso 2: CodeFormer — refina rasgos faciales con alta fidelidad
    const output = await replicate.run(
      "sczhou/codeformer:cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2",
      { input: { image: step1Url, fidelity: 0.9, background_enhance: true, face_upsample: true, upscale: 2 } }
    );
    const base64 = await replicateResultToBase64(output);
    res.json({ success: true, result: base64 });
  } catch (err) {
    console.error('reconstruct-face error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

// 3. Producto HD
router.post('/product-hd', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);
    const output = await replicate.run(
      "nightmareai/real-esrgan:b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
      { input: { image: dataURI, scale: 4, face_enhance: false } }
    );
    const base64 = await replicateResultToBase64(output);
    res.json({ success: true, result: base64 });
  } catch (err) {
    console.error('product-hd error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

// 4. Piel Real 8K — Pipeline: CodeFormer (identity) + Magic Refiner (texture) + Real-ESRGAN (4K)
router.post('/skin-real-8k', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);

    // Paso 1: CodeFormer — restaurar y limpiar rostro SIN cambiar identidad
    let step1Url = dataURI;
    try {
      const t1 = Date.now();
      const step1Raw = await replicate.run(
        "sczhou/codeformer:cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2",
        { input: { image: dataURI, fidelity: 0.9, background_enhance: true, face_upsample: true, upscale: 1 } }
      );
      step1Url = extractUrl(step1Raw);
      console.log('skin-real-8k paso 1 (codeformer):', (Date.now() - t1) + 'ms');
    } catch (err1) {
      console.warn('skin-real-8k paso 1 fallback:', err1.message);
    }

    // Paso 2: Magic Image Refiner — agregar SOLO textura microscopica de piel
    let step2Url = step1Url;
    try {
      const t2 = Date.now();
      const step2Raw = await replicate.run(
        "batouresearch/magic-image-refiner:507ddf6f977a7e30e46c0daefd30de7d563c72322f9e4cf7cbac52ef0f667b13",
        { input: {
          image: step1Url,
          resemblance: 0.9,
          creativity: 0.25,
          hdr: 0,
          prompt: "Add visible pores and fine micro-texture to skin only, keep natural fine lines, preserve exact same face identity and facial features unchanged, keep the same lighting, no smoothing, no beauty filter, no AI glow, natural skin imperfections, subtle uneven pigmentation, slight natural redness, visible hair follicles, realistic skin oil sheen on forehead and nose, subtle sensor grain, unretouched raw photograph look, do not change face structure or features",
          negative_prompt: "different face, changed face, plastic skin, smooth skin, beauty filter, airbrushed, blurry, waxy, porcelain, face morphing, identity change"
        }}
      );
      step2Url = extractUrl(step2Raw);
      console.log('skin-real-8k paso 2 (refiner):', (Date.now() - t2) + 'ms');
    } catch (err2) {
      console.warn('skin-real-8k paso 2 fallback:', err2.message);
    }

    // Paso 3: Real-ESRGAN — escalar a 4K/8K sin tocar la cara
    let finalResult;
    try {
      const t3 = Date.now();
      const step3Raw = await replicate.run(
        "nightmareai/real-esrgan:b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
        { input: { image: step2Url, scale: 4, face_enhance: false } }
      );
      console.log('skin-real-8k paso 3 (esrgan):', (Date.now() - t3) + 'ms');
      finalResult = step3Raw;
    } catch (err3) {
      console.warn('skin-real-8k paso 3 fallback:', err3.message);
      finalResult = step2Url;
    }

    const base64 = await replicateResultToBase64(finalResult);
    console.log('skin-real-8k sending response, base64 length:', base64.length);
    res.json({ success: true, result: base64 });
  } catch (err) {
    console.error('skin-real-8k error:', err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error procesando imagen', details: err.message });
    }
  }
});

// 5. Remover Fondo
router.post('/remove-bg', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);
    const output = await replicate.run(
      "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
      { input: { image: dataURI, format: 'png', background_type: 'rgba', threshold: 0 } }
    );
    const base64 = await replicateResultToBase64(output);
    res.json({ success: true, result: base64 });
  } catch (err) {
    console.error('remove-bg error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

// 6. Vectorizar con IA — Vectorizer.AI API
router.post('/vectorize-ai', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });

    const apiKey = process.env.API_VECTORIZER_KEY;
    if (!apiKey || apiKey === 'placeholder-key') {
      return res.status(503).json({ error: 'Vectorizer AI no configurado. Contacta al administrador.' });
    }

    const FormData = (await import('form-data')).default;
    const fetch = (await import('node-fetch')).default;

    const form = new FormData();
    form.append('image', req.file.buffer, {
      filename: req.file.originalname || 'image.png',
      contentType: req.file.mimetype
    });
    form.append('output.format', 'svg');

    const response = await fetch('https://api.vectorizer.ai/api/v1/vectorize', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('vk_' + apiKey + ':').toString('base64'),
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Error de Vectorizer AI', details: errText });
    }

    const svgText = await response.text();
    const svgBase64 = 'data:image/svg+xml;base64,' + Buffer.from(svgText).toString('base64');
    res.json({ success: true, result: svgBase64 });
  } catch (err) {
    console.error('vectorize-ai error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

module.exports = router;
