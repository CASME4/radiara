const http = require('http');
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
  res.json({ status: 'RADIARA online', version: '1.4.0', endpoints: ['improve-face','reconstruct-face','product-hd','skin-real','remove-bg','vectorize-ai'] });
});

// Global error handler — always return JSON, never HTML
app.use(function(err, req, res, next) {
  console.error('Global error handler:', err.message, err.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Error interno del servidor', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log('RADIARA v1.2.0 corriendo en http://localhost:' + PORT);
  console.log('ENV CHECK - REPLICATE_API_TOKEN:', process.env.REPLICATE_API_TOKEN ? `SET (${process.env.REPLICATE_API_TOKEN.substring(0,8)}...)` : 'NOT SET');
  console.log('ENV CHECK - NODE_ENV:', process.env.NODE_ENV);
  console.log('ENV CHECK - SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'NOT SET');
  console.log('ENV CHECK - SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'SET' : 'NOT SET');
});
