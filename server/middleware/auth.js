const { createClient } = require('@supabase/supabase-js');
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

if (!supabaseConfigured) {
  console.warn('[auth] Supabase no configurado — auth y créditos deshabilitados, endpoints abiertos.');
}

// Verifica que el usuario esté autenticado via Supabase JWT
async function requireAuth(req, res, next) {
  // Si Supabase no está configurado, dejar pasar (modo desarrollo)
  if (!supabaseConfigured) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autenticado. Iniciá sesión para continuar.' });
  }

  const token = authHeader.split(' ')[1];

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }

  req.user = user;
  next();
}

// Verifica y descuenta créditos según rol, suscripción o créditos sueltos
async function checkCredits(req, res, next) {
  if (!supabaseConfigured) return next();

  const userId = req.user.id;

  // 1. Buscar perfil del usuario
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('role, credits')
    .eq('id', userId)
    .single();

  if (profileErr || !profile) {
    return res.status(500).json({ error: 'No se pudo obtener el perfil del usuario.' });
  }

  // 2. Admin pasa sin cobrar
  if (profile.role === 'admin') {
    return next();
  }

  // 3. Verificar suscripción activa
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id, monthly_limit, period_start')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (subscription) {
    // Contar usos en el período actual
    const { count } = await supabase
      .from('usage_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', subscription.period_start);

    if (count < subscription.monthly_limit) {
      // Registrar uso y dejar pasar
      await supabase.from('usage_log').insert({
        user_id: userId,
        tool: req.path,
        source: 'subscription'
      });
      return next();
    }
    // Si excedió el límite mensual, caer al chequeo de créditos sueltos
  }

  // 4. Verificar créditos sueltos
  if (profile.credits > 0) {
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ credits: profile.credits - 1 })
      .eq('id', userId)
      .eq('credits', profile.credits); // optimistic lock

    if (updateErr) {
      return res.status(500).json({ error: 'Error al descontar crédito. Intentá de nuevo.' });
    }

    await supabase.from('usage_log').insert({
      user_id: userId,
      tool: req.path,
      source: 'credits'
    });
    return next();
  }

  // 5. Sin créditos ni suscripción disponible
  return res.status(402).json({
    error: 'Sin créditos',
    message: 'No tenés créditos disponibles. Comprá más o activá una suscripción.'
  });
}

module.exports = { supabase, requireAuth, checkCredits };
