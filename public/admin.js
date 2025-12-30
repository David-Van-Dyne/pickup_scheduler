function $(sel) { return document.querySelector(sel); }
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') n.className = v; else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  });
  for (const c of children) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
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
      btnText.textContent = '� Access Admin Panel';
      btn.classList.remove('loading');
    }
  }
}

function getToken() { return localStorage.getItem('adm_token') || ''; }
function setToken(t) { localStorage.setItem('adm_token', t); }
function clearToken() { localStorage.removeItem('adm_token'); }

async function login(password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data.token;
}

async function fetchAppointments(date) {
  const token = getToken();
  const url = new URL('/api/appointments', window.location.origin);
  if (date) url.searchParams.set('date', date);
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load');
  return data.appointments || [];
}

async function patchAppointment(id, patch) {
  const token = getToken();
  const res = await fetch(`/api/appointments/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(patch)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data.appointment;
}

function renderAppointments(list) {
  const root = $('#apptList');
  root.innerHTML = '';

  if (!list.length) {
    root.appendChild(el('div', { class: 'item note' }, '📅 No appointments found for the selected date.'));
    return;
  }

  for (const a of list) {
    const statusColors = {
      scheduled: '🟡',
      completed: '🟢',
      cancelled: '🔴'
    };

    const top = el('div', { class: 'row' },
      el('div', {}, `📅 ${a.date} ${a.timeWindow}`),
      el('div', { class: 'badge', style: `background: ${a.status === 'completed' ? '#c6f6d5' : a.status === 'cancelled' ? '#fed7d7' : '#fef5e7'}; color: ${a.status === 'completed' ? '#22543d' : a.status === 'cancelled' ? '#742a2a' : '#744210'}` },
        `${statusColors[a.status] || '🟡'} ${a.status}`)
    );

    const contact = [a.phone, a.email].filter(Boolean).join(' • ');
    const mid = el('div', { style: 'margin: 0.5rem 0;' }, `👤 ${a.name}${contact ? ` — ${contact}` : ''}`);

    const addr = [a.address, a.city, a.state, a.zip].filter(Boolean).join(', ');
    const tires = a.tiresCount ? ` (${a.tiresCount} tires)` : '';

    const bot = el('div', { class: 'row' },
      el('div', { class: 'note' }, `📍 ${addr}${tires}`),
      el('div', {},
        el('select', { id: `status-${a.id}`, style: 'margin-right: 0.5rem; padding: 0.25rem 0.5rem; border-radius: 6px; border: 1px solid #e2e8f0;' },
          el('option', { value: 'scheduled', selected: a.status === 'scheduled' }, '🟡 Scheduled'),
          el('option', { value: 'completed', selected: a.status === 'completed' }, '🟢 Completed'),
          el('option', { value: 'cancelled', selected: a.status === 'cancelled' }, '🔴 Cancelled')
        ),
        el('button', {
          onClick: async () => {
            const sel = document.getElementById(`status-${a.id}`);
            const btn = event.target;
            const originalText = btn.textContent;
            try {
              btn.textContent = '⏳ Updating...';
              btn.disabled = true;
              await patchAppointment(a.id, { status: sel.value });
              await refresh();
            } catch (e) {
              alert(`❌ ${e.message}`);
              btn.textContent = originalText;
              btn.disabled = false;
            }
          },
          style: 'padding: 0.25rem 0.75rem; background: #4299e1; color: white; border: none; border-radius: 6px; cursor: pointer;'
        }, '✅ Update')
      )
    );

    const notes = a.notes ? el('div', { class: 'note', style: 'margin-top: 0.5rem; padding: 0.5rem; background: #f7fafc; border-radius: 6px;' }, `💬 ${a.notes}`) : null;

    const item = el('div', { class: 'item' }, top, mid, bot);
    if (notes) item.appendChild(notes);

    root.appendChild(item);
  }
}

async function refresh() {
  const date = $('#filterDate').value;
  try {
    const list = await fetchAppointments(date);
    renderAppointments(list);
  } catch (e) { alert(e.message); }
}

function exportCsv(list) {
  const headers = ['id','createdAt','status','name','email','phone','address','city','state','zip','date','timeWindow','tiresCount','notes'];
  const rows = [headers.join(',')].concat(
    list.map(a => headers.map(h => JSON.stringify(a[h] ?? '')).join(','))
  ).join('\n');
  const blob = new Blob([rows], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'appointments.csv' });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

(function init() {
  const token = getToken();
  if (token) {
    $('#loginSection').hidden = true;
    $('#adminSection').hidden = false;
    refresh();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('⏳ Signing in...', 'loading');
    const pwd = new FormData(e.currentTarget).get('password');
    try {
      const t = await login(pwd);
      setToken(t);
      setStatus('✅ Login successful!', 'success');
      setTimeout(() => {
        $('#loginSection').hidden = true;
        $('#adminSection').hidden = false;
        refresh();
      }, 1000);
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'error');
    }
  });

  $('#refresh').addEventListener('click', refresh);
  $('#exportCsv').addEventListener('click', async () => {
    const list = await fetchAppointments($('#filterDate').value).catch(() => []);
    exportCsv(list);
  });
  $('#logout').addEventListener('click', () => { clearToken(); location.reload(); });
})();

