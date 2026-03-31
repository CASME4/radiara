// Supabase client-side auth para RADIARA
// Las keys se inyectan desde el HTML o se configuran acá
const SUPABASE_URL = window.RADIARA_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.RADIARA_SUPABASE_ANON_KEY || '';

let supabaseClient = null;
let currentSession = null;

function initAuth() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('Supabase no configurado. Auth deshabilitado.');
    return;
  }
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    updateAuthUI();
  });
  // Cargar sesión existente
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    currentSession = session;
    updateAuthUI();
  });
}

async function login(email, password) {
  if (!supabaseClient) return { error: 'Supabase no configurado' };
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  currentSession = data.session;
  updateAuthUI();
  return { success: true };
}

async function register(email, password) {
  if (!supabaseClient) return { error: 'Supabase no configurado' };
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) return { error: error.message };
  if (data.user && !data.session) {
    return { success: true, message: 'Revisá tu email para confirmar la cuenta.' };
  }
  currentSession = data.session;
  updateAuthUI();
  return { success: true };
}

async function logout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentSession = null;
  updateAuthUI();
}

function getAccessToken() {
  return currentSession?.access_token || null;
}

function isLoggedIn() {
  return currentSession !== null;
}

function getUserEmail() {
  return currentSession?.user?.email || null;
}

// Agrega el token a las requests de los endpoints de IA
function authHeaders() {
  const token = getAccessToken();
  if (!token) return {};
  return { 'Authorization': 'Bearer ' + token };
}

// Actualiza la UI según el estado de auth
function updateAuthUI() {
  const authSection = document.getElementById('auth-section');
  if (!authSection) return;

  if (isLoggedIn()) {
    authSection.innerHTML =
      '<span class="user-email">' + getUserEmail() + '</span>' +
      '<button class="auth-btn" onclick="logout()">Cerrar sesión</button>';
  } else {
    authSection.innerHTML =
      '<button class="auth-btn" onclick="showLoginModal()">Iniciar sesión</button>' +
      '<button class="auth-btn auth-btn-outline" onclick="showRegisterModal()">Registrarse</button>';
  }
}

function showLoginModal() {
  showAuthModal('login');
}

function showRegisterModal() {
  showAuthModal('register');
}

function showAuthModal(mode) {
  const existing = document.getElementById('auth-modal');
  if (existing) existing.remove();

  const title = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
  const btnText = mode === 'login' ? 'Entrar' : 'Registrarse';
  const altText = mode === 'login'
    ? '¿No tenés cuenta? <a href="#" onclick="showRegisterModal(); return false;">Registrate</a>'
    : '¿Ya tenés cuenta? <a href="#" onclick="showLoginModal(); return false;">Iniciá sesión</a>';

  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
  modal.innerHTML =
    '<div style="background:#111;border:1px solid #222;border-radius:12px;padding:2rem;width:90%;max-width:380px;">' +
      '<h3 style="font-family:var(--mono);margin-bottom:1.5rem;color:#fff;">' + title + '</h3>' +
      '<input id="auth-email" type="email" placeholder="Email" style="width:100%;padding:0.7rem;margin-bottom:0.8rem;background:#0a0a0a;border:1px solid #333;border-radius:8px;color:#fff;font-family:var(--sans);font-size:0.9rem;">' +
      '<input id="auth-password" type="password" placeholder="Contraseña" style="width:100%;padding:0.7rem;margin-bottom:1rem;background:#0a0a0a;border:1px solid #333;border-radius:8px;color:#fff;font-family:var(--sans);font-size:0.9rem;">' +
      '<div id="auth-error" style="color:#FF3333;font-size:0.8rem;margin-bottom:0.8rem;display:none;"></div>' +
      '<button onclick="submitAuth(\'' + mode + '\')" style="width:100%;padding:0.8rem;background:#FF3333;color:#fff;border:none;border-radius:8px;font-family:var(--mono);font-weight:700;cursor:pointer;font-size:0.9rem;">' + btnText + '</button>' +
      '<p style="text-align:center;margin-top:1rem;font-size:0.8rem;color:#888;">' + altText + '</p>' +
      '<button onclick="closeAuthModal()" style="position:absolute;top:1rem;right:1rem;background:none;border:none;color:#888;font-size:1.2rem;cursor:pointer;">✕</button>' +
    '</div>';

  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAuthModal(); });
}

async function submitAuth(mode) {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');

  if (!email || !password) {
    errorEl.textContent = 'Completá email y contraseña.';
    errorEl.style.display = 'block';
    return;
  }

  const result = mode === 'login' ? await login(email, password) : await register(email, password);

  if (result.error) {
    errorEl.textContent = result.error;
    errorEl.style.display = 'block';
    return;
  }

  if (result.message) {
    errorEl.style.color = '#00FF88';
    errorEl.textContent = result.message;
    errorEl.style.display = 'block';
    return;
  }

  closeAuthModal();
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.remove();
}

// Init cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initAuth);
