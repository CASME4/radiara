const express = require('express');
const multer = require('multer');
const Replicate = require('replicate');
const sharp = require('sharp');
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

// Resize helper — proportionally resize buffer if it exceeds maxPixels
async function resizeForModel(buffer, maxPixels) {
  const meta = await sharp(buffer).metadata();
  const pixels = meta.width * meta.height;
  if (pixels <= maxPixels) return { buffer, w: meta.width, h: meta.height, resized: false };
  const ratio = Math.sqrt(maxPixels / pixels);
  const w = Math.floor(meta.width * ratio);
  const h = Math.floor(meta.height * ratio);
  const resized = await sharp(buffer).resize(w, h, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  console.log('resizeForModel: ' + meta.width + 'x' + meta.height + ' (' + (pixels/1e6).toFixed(1) + 'MP) -> ' + w + 'x' + h + ' (max ' + (maxPixels/1e6).toFixed(1) + 'MP)');
  return { buffer: resized, w, h, resized: true };
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

// 4. Piel Real — Dos modos: enhance (Topaz/SwinIR) o hyperreal (SUPIR-v0F)
router.post('/skin-real', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const mode = req.body && req.body.mode ? req.body.mode : 'enhance';
    console.log('skin-real mode:', mode);

    let finalResult;

    if (mode === 'hyperreal') {
      // MODO HIPERREALISTA: SUPIR-v0Q (0.8MP, stable) + Real-ESRGAN 4x → 8K
      const supirSafe = await resizeForModel(req.file.buffer, 800000);
      const supirURI = toDataURI(supirSafe.buffer, 'image/png');
      const t1 = Date.now();
      let supirUrl = null;
      try {
        const supirRaw = await replicate.run(
          "cjwbw/supir-v0q:ede69f6a5ae7d09f769d683347325b08d2f83a93d136ed89747941205e0a71da",
          { input: {
            image: supirURI,
            upscale: 2,
            a_prompt: "Extreme macro photography shot on Canon EOS R5 with 100mm f/2.8L macro lens at ISO 100. Microscopic skin detail: individually visible pores with depth and shadow on nose bridge, cheeks, forehead and chin. Natural sebum oil sheen reflecting light on T-zone. Visible vellus hair (peach fuzz) on cheeks and jawline catching sidelight. Each eyelash individually defined and separated. Iris showing radial fibers, collarette ring, and bright catchlight reflection. Teeth showing individual texture and subtle translucency. Lips with natural moisture, fine vertical lines and slight color variation. Hair with individual strand definition, natural flyaways and light interaction. Skin showing subsurface scattering where light penetrates. 32K ultra high definition resolution, photojournalistic unretouched raw quality.",
            n_prompt: "painting, oil painting, illustration, drawing, art, sketch, cartoon, CG Style, 3D render, unreal engine, blurry, plastic skin, smooth skin, airbrushed, beauty filter, waxy, porcelain, doll-like, deformed, low quality, lowres, over-smooth, frames, watermark",
            s_cfg: 6.0,
            s_stage2: 1.0,
            s_churn: 5,
            s_noise: 1.003,
            edm_steps: 60,
            min_size: 1024,
            color_fix_type: "Wavelet"
          }}
        );
        supirUrl = extractUrl(supirRaw);
        console.log('skin-real hyperreal paso 1 (supir-v0q 2x, 60 steps):', (Date.now() - t1) + 'ms');
      } catch (supirErr) {
        console.warn('skin-real hyperreal supir-v0q failed, trying supir-v0f:', supirErr.message);
        // Fallback 1: SUPIR-v0F (lighter model)
        try {
          const v0fRaw = await replicate.run(
            "cjwbw/supir-v0f:b9c26267b41f3617099b53f09f2d894a621ebf4a59b632bfedb5031eeabd8959",
            { input: {
              image: supirURI,
              upscale: 2,
              a_prompt: "Extreme macro photography, hyper detailed skin pores, peach fuzz, individual eyelashes, iris fibers, natural skin oil sheen, 32K ultra HD, unretouched raw photograph",
              n_prompt: "painting, illustration, cartoon, blurry, plastic skin, smooth skin, airbrushed, deformed, low quality",
              s_cfg: 6.0,
              s_stage2: 1.0,
              s_churn: 5,
              s_noise: 1.003,
              edm_steps: 50,
              min_size: 1024,
              color_fix_type: "Wavelet"
            }}
          );
          supirUrl = extractUrl(v0fRaw);
          console.log('skin-real hyperreal (supir-v0f fallback):', (Date.now() - t1) + 'ms');
        } catch (v0fErr) {
          console.warn('skin-real hyperreal supir-v0f also failed:', v0fErr.message);
        }
      }

      // Paso 2: Real-ESRGAN 4x para escalar a 8K
      if (supirUrl) {
        try {
          const fetchMod = (await import('node-fetch')).default;
          const dlResp = await fetchMod(supirUrl);
          const dlBuf = Buffer.from(await dlResp.arrayBuffer());
          const esrganSafe = await resizeForModel(dlBuf, 2000000);
          const esrganURI = toDataURI(esrganSafe.buffer, 'image/png');
          const t2 = Date.now();
          const esrganRaw = await replicate.run(
            "nightmareai/real-esrgan:b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
            { input: { image: esrganURI, scale: 4, face_enhance: false } }
          );
          console.log('skin-real hyperreal paso 2 (esrgan 4x):', (Date.now() - t2) + 'ms');
          finalResult = esrganRaw;
        } catch (esrganErr) {
          console.warn('skin-real hyperreal esrgan failed, returning supir result:', esrganErr.message);
          finalResult = supirUrl;
        }
      } else {
        // All failed, last resort: ESRGAN on original
        const esrganSafe = await resizeForModel(req.file.buffer, 2000000);
        const esrganURI = toDataURI(esrganSafe.buffer, 'image/png');
        const esrganRaw = await replicate.run(
          "nightmareai/real-esrgan:b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
          { input: { image: esrganURI, scale: 4, face_enhance: false } }
        );
        console.log('skin-real hyperreal (esrgan last resort):', (Date.now() - t1) + 'ms');
        finalResult = esrganRaw;
      }

    } else {
      // MODO ENHANCE: Topaz -> SwinIR -> Real-ESRGAN (all with resize safety)
      const enhanceSafe = await resizeForModel(req.file.buffer, 2000000);
      const enhanceURI = toDataURI(enhanceSafe.buffer, 'image/png');
      const t1 = Date.now();
      try {
        const topazRaw = await replicate.run(
          "topazlabs/image-upscale:2fdc3b86a01d338ae89ad58e5d9241398a8a01de9b0dda41ba8a0434c8a00dc3",
          { input: { image: enhanceURI, upscale_factor: 2, enhance_model: "Standard V2", face_enhancement: false } }
        );
        console.log('skin-real enhance (topaz):', (Date.now() - t1) + 'ms');
        finalResult = topazRaw;
      } catch (topazErr) {
        console.warn('skin-real enhance topaz failed, trying swinir:', topazErr.message);
        try {
          const swinRaw = await replicate.run(
            "jingyunliang/swinir:660d922d33153019e8c263a3bba265de882e7f4f70396546b6c9c8f9d47a021a",
            { input: { image: enhanceURI, task_type: "Real-World Image Super-Resolution-Large" } }
          );
          console.log('skin-real enhance (swinir):', (Date.now() - t1) + 'ms');
          finalResult = swinRaw;
        } catch (swinErr) {
          console.warn('skin-real enhance swinir failed, using esrgan:', swinErr.message);
          const esrganRaw = await replicate.run(
            "nightmareai/real-esrgan:b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
            { input: { image: enhanceURI, scale: 4, face_enhance: false } }
          );
          console.log('skin-real enhance (esrgan fallback):', (Date.now() - t1) + 'ms');
          finalResult = esrganRaw;
        }
      }
    }

    const base64 = await replicateResultToBase64(finalResult);
    res.json({ success: true, result: base64 });
  } catch (err) {
    console.error('skin-real error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error procesando imagen', details: err.message });
    }
  }
});

// 5. Ultra HD 4K — Pipeline inteligente segun tamano de imagen
const SMALL_IMAGE_THRESHOLD = 500000;

async function safeResizeForEsrgan(buffer) {
  return resizeForModel(buffer, 2000000);
}


router.post('/ultra-hd', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });

    const metadata = await sharp(req.file.buffer).metadata();
    const origW = metadata.width;
    const origH = metadata.height;
    const origPixels = origW * origH;
    const isSmall = origPixels < SMALL_IMAGE_THRESHOLD;

    let esrganInput;

    if (isSmall) {
      // Pipeline de reconstruccion: CodeFormer 2x -> resize seguro -> ESRGAN 4x
      console.log('ultra-hd: Imagen pequena detectada (' + origW + 'x' + origH + ', ' + (origPixels / 1e6).toFixed(2) + 'MP), usando pipeline de reconstruccion');

      const t1 = Date.now();
      const cfRaw = await replicate.run(
        "sczhou/codeformer:cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2",
        { input: { image: toDataURI(req.file.buffer, req.file.mimetype), fidelity: 0.7, background_enhance: true, face_upsample: true, upscale: 2 } }
      );
      const cfUrl = extractUrl(cfRaw);
      console.log('ultra-hd paso 1 (codeformer 2x):', (Date.now() - t1) + 'ms');

      // Download CodeFormer result and check if it needs resize for ESRGAN
      const fetchMod = (await import('node-fetch')).default;
      const cfResp = await fetchMod(cfUrl);
      const cfArrayBuf = await cfResp.arrayBuffer();
      const cfBuffer = Buffer.from(cfArrayBuf);

      const safe = await safeResizeForEsrgan(cfBuffer);
      if (safe.resized) console.log('ultra-hd: resize post-codeformer -> ' + safe.w + 'x' + safe.h);
      esrganInput = toDataURI(safe.buffer, 'image/png');

    } else {
      // Pipeline de preservacion: resize seguro -> ESRGAN 4x
      console.log('ultra-hd: Imagen grande detectada (' + origW + 'x' + origH + ', ' + (origPixels / 1e6).toFixed(1) + 'MP), usando pipeline de preservacion');

      const safe = await safeResizeForEsrgan(req.file.buffer);
      if (safe.resized) console.log('ultra-hd: resize -> ' + safe.w + 'x' + safe.h);
      esrganInput = toDataURI(safe.buffer, 'image/png');
    }

    // Real-ESRGAN 4x final
    const t2 = Date.now();
    const output = await replicate.run(
      "nightmareai/real-esrgan:b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
      { input: { image: esrganInput, scale: 4, face_enhance: false } }
    );
    console.log('ultra-hd (esrgan 4x):', (Date.now() - t2) + 'ms');

    const base64 = await replicateResultToBase64(output);
    res.json({ success: true, result: base64 });
  } catch (err) {
    console.error('ultra-hd error:', err.message);
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
