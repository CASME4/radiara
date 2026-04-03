const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const apiRoutes = require('./routes/api');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiadas solicitudes. Espera un minuto.' }
});
app.use('/api/', apiLimiter);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', apiRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'RADIARA online', version: '1.2.0', endpoints: ['improve-face','reconstruct-face','product-hd','ultra-hd','remove-bg','vectorize-ai'] });
});

// Global error handler — always return JSON, never HTML
app.use(function(err, req, res, next) {
  console.error('Global error handler:', err.message, err.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Error interno del servidor', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server started - Ultra HD endpoint ready');
  console.log('RADIARA v1.2.0 corriendo en http://localhost:' + PORT);
});
