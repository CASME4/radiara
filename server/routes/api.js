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
  const buffer = await response.buffer();
  const contentType = response.headers.get('content-type') || 'image/png';
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

// 4. Piel Real — Pipeline: Magic Image Refiner (textura) + Crystal Upscaler (refinado)
router.post('/skin-real', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);

    let step1Url = dataURI;
    // Paso 1: Magic Image Refiner — agrega textura de piel realista
    try {
      const t1 = Date.now();
      const step1Raw = await replicate.run(
        "fermatresearch/magic-image-refiner:507ddf6f977a7e30e46c0daefd30de7d563c72322f9e4cf7cbac52ef0f667b13",
        { input: {
          image: dataURI,
          resemblance: 0.85,
          creativity: 0.35,
          prompt: "ultra realistic human skin texture, visible pores, individual eyelashes, fine hair follicles, natural skin imperfections, subsurface scattering, realistic lighting on skin, micro details, photorealistic 8k"
        }}
      );
      step1Url = extractUrl(step1Raw);
      console.log('skin-real paso 1 (refiner):', (Date.now() - t1) + 'ms');
    } catch (err1) {
      console.warn('skin-real paso 1 fallback — refiner fallo:', err1.message);
      // Fallback: skip paso 1, use original image
    }

    // Paso 2: Crystal Upscaler — escala y refina con textura del paso 1
    const t2 = Date.now();
    const output = await replicate.run(
      "philz1337x/crystal-upscaler:5d917b1444c89ed91055f3052d27e1ad433a1218599a36544510e1dfa9ac26c8",
      { input: { image: step1Url, scale_factor: 2 } }
    );
    console.log('skin-real paso 2 (crystal):', (Date.now() - t2) + 'ms');

    const base64 = await replicateResultToBase64(output);
    res.json({ success: true, result: base64 });
  } catch (err) {
    console.error('skin-real error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
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

// 6. Maxima Calidad — Pipeline de 3 pasos: CodeFormer -> Crystal Upscaler -> Real-ESRGAN 4K
router.post('/max-quality', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);

    // Paso 1: CodeFormer — face restore only (fidelity 0.5, no upscale)
    const step1Raw = await replicate.run(
      "sczhou/codeformer:cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2",
      { input: { image: dataURI, fidelity: 0.5, background_enhance: true, face_upsample: true, upscale: 1 } }
    );
    const step1Url = extractUrl(step1Raw);

    // Paso 2: Crystal Upscaler — skin texture + 2x upscale
    const step2Raw = await replicate.run(
      "philz1337x/crystal-upscaler:5d917b1444c89ed91055f3052d27e1ad433a1218599a36544510e1dfa9ac26c8",
      { input: { image: step1Url, scale_factor: 2 } }
    );
    const step2Url = extractUrl(step2Raw);

    // Paso 3: Real-ESRGAN — 4x upscale to 4K with face enhance
    const output = await replicate.run(
      "nightmareai/real-esrgan:b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
      { input: { image: step2Url, scale: 4, face_enhance: true } }
    );
    const base64 = await replicateResultToBase64(output);

    res.json({ success: true, result: base64 });
  } catch (err) {
    console.error('max-quality error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

// 7. Vectorizar con IA — Vectorizer.AI API
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
