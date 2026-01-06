function $(sel) {
  return document.querySelector(sel);
}

function setStatus(msg, cls = '') {
  const s = $('#loginStatus');
  const btn = $('#loginBtn');
  const btnText = $('#loginBtnText');

  if (s) {
    s.textContent = msg;
    s.className = cls;
  }

  if (btn && btnText) {
    if (cls === 'loading') {
      btn.disabled = true;
      btnText.textContent = '⏳ Signing in...';
      btn.classList.add('loading');
    } else {
      btn.disabled = false;
      btnText.textContent = '🔐 Access Admin Panel';
      btn.classList.remove('loading');
    }
  }
}

function getToken() {
  return localStorage.getItem('adm_token') || '';
}

function setToken(t) {
  localStorage.setItem('adm_token', t);
}

function clearToken() {
  localStorage.removeItem('adm_token');
}

async function validateToken(token) {
  const res = await fetch('/api/admin/session', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function login(password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) throw new Error(data.error || 'Login failed');
  if (!data.token) throw new Error('Login failed (no token)');
  return data.token;
}

async function bootAdminApp() {
  // Keep appointment sync separate from the calendar source code.
  await import('./appointment-calendar-sync.js');
  // Importing index.js starts the calendar app.
  await import('./index.js');
}

function showLogin() {
  const loginSection = $('#loginSection');
  const adminSection = $('#adminSection');
  if (loginSection) loginSection.hidden = false;
  if (adminSection) adminSection.hidden = true;
}

async function showAdmin() {
  const loginSection = $('#loginSection');
  const adminSection = $('#adminSection');
  if (loginSection) loginSection.hidden = true;
  if (adminSection) adminSection.hidden = false;
  await bootAdminApp();

  const logoutBtn = $('#logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearToken();
      location.reload();
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = $('#loginForm');
  if (!form) {
    // If the page doesn't have the login form, just boot.
    await bootAdminApp();
    return;
  }

  const token = getToken();
  if (token && await validateToken(token)) {
    await showAdmin();
  } else {
    if (token) clearToken();
    showLogin();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('⏳ Signing in...', 'loading');

    const pwd = new FormData(form).get('password');
    try {
      const t = await login(String(pwd || ''));
      setToken(t);
      setStatus('✅ Login successful!', 'success');
      await showAdmin();
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'error');
    }
  });
});
