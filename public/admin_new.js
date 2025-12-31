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
      btnText.textContent = '🔐 Access Admin Panel';
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

async function fetchAppointments(startDate, endDate) {
  const token = getToken();
  const url = new URL('/api/appointments', window.location.origin);
  if (startDate && endDate) {
    url.searchParams.set('startDate', startDate);
    url.searchParams.set('endDate', endDate);
  }
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

// Calendar state
let currentDate = new Date();
let appointments = [];
let selectedDate = null;

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function formatDisplayDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function renderCalendar() {
  const calendar = $('#calendar');
  const monthStart = getMonthStart(currentDate);
  const monthEnd = getMonthEnd(currentDate);
  const startDate = new Date(monthStart);
  startDate.setDate(startDate.getDate() - monthStart.getDay()); // Start from Sunday

  const endDate = new Date(monthEnd);
  endDate.setDate(endDate.getDate() + (6 - monthEnd.getDay())); // End on Saturday

  // Update month header
  $('#currentMonth').textContent = currentDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long'
  });

  // Create calendar header
  const header = el('div', { class: 'calendar-header' },
    el('div', {}, 'Sun'),
    el('div', {}, 'Mon'),
    el('div', {}, 'Tue'),
    el('div', {}, 'Wed'),
    el('div', {}, 'Thu'),
    el('div', {}, 'Fri'),
    el('div', {}, 'Sat')
  );

  // Create calendar grid
  const grid = el('div', { class: 'calendar-grid' });
  grid.appendChild(header);

  const current = new Date(startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    const dayAppointments = appointments.filter(apt => apt.date === formatDate(current));
    const isToday = current.toDateString() === today.toDateString();
    const isCurrentMonth = current.getMonth() === currentDate.getMonth();

    const dayElement = el('div', {
      class: `calendar-day ${isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''}`,
      onClick: () => selectDate(current)
    },
      el('div', { class: 'calendar-day-number' }, current.getDate()),
      el('div', { class: 'calendar-appointments' })
    );

    if (dayAppointments.length > 0) {
      const appointmentsContainer = dayElement.querySelector('.calendar-appointments');

      dayAppointments.slice(0, 3).forEach(apt => {
        const aptElement = el('div', {
          class: `appointment-item ${apt.status}`,
          title: `${apt.name} - ${apt.timeWindow}`
        }, `${apt.timeWindow}: ${apt.name}`);
        appointmentsContainer.appendChild(aptElement);
      });

      if (dayAppointments.length > 3) {
        const countElement = el('div', { class: 'appointment-count' }, `+${dayAppointments.length - 3}`);
        dayElement.appendChild(countElement);
      }
    }

    grid.appendChild(dayElement);
    current.setDate(current.getDate() + 1);
  }

  calendar.innerHTML = '';
  calendar.appendChild(grid);
}

function selectDate(date) {
  selectedDate = new Date(date);
  const dayAppointments = appointments.filter(apt => apt.date === formatDate(selectedDate));

  $('#selectedDate').textContent = formatDisplayDate(selectedDate);
  $('#appointmentDetails').hidden = false;

  renderDayAppointments(dayAppointments);
}

function renderDayAppointments(dayAppointments) {
  const container = $('#dayAppointments');
  container.innerHTML = '';

  if (dayAppointments.length === 0) {
    container.appendChild(el('div', { class: 'note' }, 'No appointments for this date.'));
    return;
  }

  dayAppointments.forEach(apt => {
    const card = el('div', { class: 'day-appointment-card' },
      el('div', { class: 'appointment-header' },
        el('div', {},
          el('strong', {}, apt.name),
          el('div', { style: 'font-size: 0.9rem; color: #666; margin-top: 0.25rem;' },
            `📅 ${apt.timeWindow} • 🛞 ${apt.tiresCount || 0} tires`
          )
        ),
        el('div', { class: `appointment-status ${apt.status}` }, apt.status)
      ),
      el('div', { class: 'appointment-info' },
        el('div', {}, `📞 ${apt.phone || 'No phone'}`),
        el('div', {}, `📧 ${apt.email || 'No email'}`),
        el('div', {}, `📍 ${[apt.address, apt.city, apt.state, apt.zip].filter(Boolean).join(', ')}`),
        apt.notes ? el('div', { style: 'margin-top: 0.5rem; padding: 0.5rem; background: #f7fafc; border-radius: 6px;' },
          `💬 ${apt.notes}`) : null
      ),
      el('div', { class: 'appointment-actions' },
        el('select', {
          id: `status-${apt.id}`,
          onChange: async (e) => {
            try {
              await patchAppointment(apt.id, { status: e.target.value });
              await loadAppointments();
            } catch (error) {
              alert(`❌ ${error.message}`);
            }
          }
        },
          el('option', { value: 'scheduled', selected: apt.status === 'scheduled' }, '🟡 Scheduled'),
          el('option', { value: 'completed', selected: apt.status === 'completed' }, '🟢 Completed'),
          el('option', { value: 'cancelled', selected: apt.status === 'cancelled' }, '🔴 Cancelled')
        ),
        el('button', {
          onClick: async () => {
            if (confirm(`Delete appointment for ${apt.name}?`)) {
              try {
                const token = getToken();
                await fetch(`/api/appointments/${apt.id}`, {
                  method: 'DELETE',
                  headers: { 'Authorization': `Bearer ${token}` }
                });
                await loadAppointments();
              } catch (error) {
                alert(`❌ ${error.message}`);
              }
            }
          },
          style: 'padding: 0.5rem 1rem; background: #8B0000; color: white; border: none; border-radius: 6px; cursor: pointer;'
        }, '🗑️ Delete')
      )
    );

    container.appendChild(card);
  });
}

async function loadAppointments() {
  try {
    const startDate = formatDate(getMonthStart(currentDate));
    const endDate = formatDate(getMonthEnd(currentDate));
    appointments = await fetchAppointments(startDate, endDate);
    renderCalendar();

    if (selectedDate) {
      const dayAppointments = appointments.filter(apt => apt.date === formatDate(selectedDate));
      renderDayAppointments(dayAppointments);
    }
  } catch (error) {
    alert(`❌ Failed to load appointments: ${error.message}`);
  }
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
    loadAppointments();
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
        loadAppointments();
      }, 1000);
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'error');
    }
  });

  // Calendar navigation
  $('#prevMonth').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    loadAppointments();
  });

  $('#nextMonth').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    loadAppointments();
  });

  $('#refresh').addEventListener('click', loadAppointments);
  $('#exportCsv').addEventListener('click', async () => {
    const allAppointments = await fetchAppointments().catch(() => []);
    exportCsv(allAppointments);
  });
  $('#logout').addEventListener('click', () => {
    clearToken();
    location.reload();
  });
})();