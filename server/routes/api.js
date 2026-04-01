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

// 1. Restaurar Cara
router.post('/restore-face', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);
    const output = await replicate.run(
      "sczhou/codeformer:7de2ea26c616d5bf2245ad0d5e24f0ff9ea204d7ff76a805b379c3baa9b99cc1",
      { input: { image: dataURI, fidelity: 0.7, background_enhance: true, face_upsample: true, upscale: 2 } }
    );
    res.json({ success: true, result: output });
  } catch (err) {
    console.error('restore-face error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

// 2. Producto HD
router.post('/product-hd', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);
    const output = await replicate.run(
      "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
      { input: { image: dataURI, scale: 4, face_enhance: false } }
    );
    res.json({ success: true, result: output });
  } catch (err) {
    console.error('product-hd error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

// 3. Piel Real — Crystal Upscaler (reemplaza SUPIR: 4x mas barato, 10x mas rapido)
router.post('/skin-real', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);
    const output = await replicate.run(
      "philz1337x/crystal-upscaler",
      { input: { image: dataURI, scale_factor: 2 } }
    );
    res.json({ success: true, result: output });
  } catch (err) {
    console.error('skin-real error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

// 4. Remover Fondo
router.post('/remove-bg', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);
    const output = await replicate.run(
      "cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
      { input: { image: dataURI } }
    );
    res.json({ success: true, result: output });
  } catch (err) {
    console.error('remove-bg error:', err.message);
    res.status(500).json({ error: 'Error procesando imagen', details: err.message });
  }
});

// 5. Maxima Calidad — Pipeline de 3 pasos: CodeFormer → Crystal Upscaler → Real-ESRGAN 4K
router.post('/max-quality', requireAuth, checkCredits, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subio imagen' });
    const dataURI = toDataURI(req.file.buffer, req.file.mimetype);

    // Paso 1: CodeFormer — face restore only (fidelity 0.5, no upscale)
    const step1 = await replicate.run(
      "sczhou/codeformer:7de2ea26c616d5bf2245ad0d5e24f0ff9ea204d7ff76a805b379c3baa9b99cc1",
      { input: { image: dataURI, fidelity: 0.5, background_enhance: true, face_upsample: true, upscale: 1 } }
    );

    // Paso 2: Crystal Upscaler — skin texture + 2x upscale
    const step2 = await replicate.run(
      "philz1337x/crystal-upscaler",
      { input: { image: step1, scale_factor: 2 } }
    );

    // Paso 3: Real-ESRGAN — 4x upscale to 4K with face enhance
    const output = await replicate.run(
      "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
      { input: { image: step2, scale: 4, face_enhance: true } }
    );

    res.json({ success: true, result: output });
  } catch (err) {
    console.error('max-quality error:', err.message);
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
