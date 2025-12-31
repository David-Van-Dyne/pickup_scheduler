function $(sel) { return document.querySelector(sel); }
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') n.className = v; else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  });
  for (const c of children) {
    if (typeof c === 'string' || typeof c === 'number') {
      n.appendChild(document.createTextNode(String(c)));
    } else if (c instanceof Node) {
      n.appendChild(c);
    }
  }
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

async function fetchAppointments() {
  const token = getToken();
  const res = await fetch('/api/appointments', { headers: { 'Authorization': `Bearer ${token}` } });
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

// Account management functions
async function fetchAccounts() {
  const token = getToken();
  const res = await fetch('/api/accounts', { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch accounts');
  return data.accounts;
}

async function createAccount(appointmentId, notes = '') {
  const token = getToken();
  const res = await fetch('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ appointmentId, notes })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create account');
  return data.account;
}

async function patchAccount(id, patch) {
  const token = getToken();
  const res = await fetch(`/api/accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(patch)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data.account;
}

async function deleteAccount(id) {
  const token = getToken();
  const res = await fetch(`/api/accounts/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Delete failed');
  }
  return true;
}

async function addNotification(accountId, message, date) {
  const token = getToken();
  const res = await fetch(`/api/accounts/${accountId}/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ message, date })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to add notification');
  return data.notification;
}

async function deleteNotification(accountId, notificationId) {
  const token = getToken();
  const res = await fetch(`/api/accounts/${accountId}/notifications/${notificationId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Delete failed');
  }
  return true;
}

// Calendar state
let currentDate = new Date();
let appointments = [];
let accounts = [];
let selectedDate = null;
let selectedAppointment = null;

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
  startDate.setDate(startDate.getDate() - monthStart.getDay()); // Sunday

  const endDate = new Date(monthEnd);
  endDate.setDate(endDate.getDate() + (6 - monthEnd.getDay())); // Saturday

  // Header text
  $('#currentMonth').textContent = currentDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long'
  });

  // Build a date -> appointments map once
  const apptsByDate = new Map();
  for (const apt of appointments) {
    if (!apptsByDate.has(apt.date)) apptsByDate.set(apt.date, []);
    apptsByDate.get(apt.date).push(apt);
  }

  const header = el('div', { class: 'calendar-header' },
    el('div', {}, 'Sun'),
    el('div', {}, 'Mon'),
    el('div', {}, 'Tue'),
    el('div', {}, 'Wed'),
    el('div', {}, 'Thu'),
    el('div', {}, 'Fri'),
    el('div', {}, 'Sat')
  );

  const grid = el('div', { class: 'calendar-grid' });
  grid.appendChild(header);

  const current = new Date(startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    const dateKey = formatDate(current);
    const dayAppointments = apptsByDate.get(dateKey) || [];

    const isToday = current.toDateString() === today.toDateString();
    const isCurrentMonth = current.getMonth() === currentDate.getMonth();
    const currentDateCopy = new Date(current);

    const dayElement = el('div', {
      class: `calendar-day ${isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''}`,
      'data-date': dateKey,
      onclick: () => selectDate(currentDateCopy)
    },
      el('div', { class: 'calendar-day-number' }, current.getDate()),
      el('div', { class: 'calendar-appointments' })
    );

    if (dayAppointments.length) {
      const appointmentsContainer = dayElement.querySelector('.calendar-appointments');

      if (dayAppointments.length > 3) {
        const limitedContainer = el('div', { class: 'calendar-appointments-limited' });

        dayAppointments.slice(0, 3).forEach(apt => {
          const aptElement = el('div', {
            class: `appointment-item ${apt.status}`,
            title: `${apt.name} - ${apt.timeWindow}`
          }, `${apt.timeWindow}: ${apt.name}`);
          aptElement.addEventListener('click', (e) => { e.stopPropagation(); selectAppointment(apt); });
          limitedContainer.appendChild(aptElement);
        });

        const moreElement = el('div', { class: 'appointment-more' }, `+${dayAppointments.length - 3} more`);
        moreElement.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleDayExpansion(currentDateCopy, dayAppointments);
        });
        limitedContainer.appendChild(moreElement);

        const expandedContainer = el('div', {
          class: 'calendar-appointments-expanded',
          style: 'display: none;'
        });

        const lessElement = el('div', { class: 'appointment-more expanded' }, 'Show less');
        lessElement.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleDayExpansion(currentDateCopy, dayAppointments);
        });
        expandedContainer.appendChild(lessElement);

        dayAppointments.forEach(apt => {
          const aptElement = el('div', {
            class: `appointment-item ${apt.status}`,
            title: `${apt.name} - ${apt.timeWindow}`
          }, `${apt.timeWindow}: ${apt.name}`);
          aptElement.addEventListener('click', (e) => { e.stopPropagation(); selectAppointment(apt); });
          expandedContainer.appendChild(aptElement);
        });

        appointmentsContainer.appendChild(limitedContainer);
        appointmentsContainer.appendChild(expandedContainer);
      } else {
        dayAppointments.forEach(apt => {
          const aptElement = el('div', {
            class: `appointment-item ${apt.status}`,
            title: `${apt.name} - ${apt.timeWindow}`
          }, `${apt.timeWindow}: ${apt.name}`);
          aptElement.addEventListener('click', (e) => { e.stopPropagation(); selectAppointment(apt); });
          appointmentsContainer.appendChild(aptElement);
        });
      }
    }

    grid.appendChild(dayElement);
    current.setDate(current.getDate() + 1);
  }

  calendar.replaceChildren(grid); // slightly cleaner than innerHTML=''
}

function toggleDayExpansion(date, dayAppointments) {
  const dateStr = formatDate(date);
  const dayElement = document.querySelector(`[data-date="${dateStr}"]`);

  if (!dayElement) return;

  const limitedContainer = dayElement.querySelector('.calendar-appointments-limited');
  const expandedContainer = dayElement.querySelector('.calendar-appointments-expanded');

  if (!limitedContainer || !expandedContainer) return;

  if (limitedContainer.style.display === 'none' || limitedContainer.style.display === '') {
    // Currently showing expanded, switch to limited
    limitedContainer.style.display = 'block';
    expandedContainer.style.display = 'none';
  } else {
    // Currently showing limited, switch to expanded
    limitedContainer.style.display = 'none';
    expandedContainer.style.display = 'block';
  }
}

function selectDate(date) {
  selectedDate = new Date(date);
  selectedAppointment = null; // Clear appointment selection when selecting a date
  const dayAppointments = appointments.filter(apt => apt.date === formatDate(selectedDate));

  $('#selectedDate').textContent = formatDisplayDate(selectedDate);
  $('#appointmentDetails').hidden = false;

  renderDayAppointments(dayAppointments, accounts);
}

function selectAppointment(appointment) {
  selectedDate = new Date(appointment.date);
  selectedAppointment = appointment;
  const dayAppointments = appointments.filter(apt => apt.date === formatDate(selectedDate));

  $('#selectedDate').textContent = formatDisplayDate(selectedDate);
  $('#appointmentDetails').hidden = false;

  renderDayAppointments(dayAppointments, accounts);
}

function renderDayAppointments(dayAppointments, accounts = []) {
  const container = $('#dayAppointments');
  container.innerHTML = '';

  if (dayAppointments.length === 0) {
    container.appendChild(el('div', { class: 'note' }, 'No appointments for this date.'));
    return;
  }

  dayAppointments.forEach(apt => {
    const accountExists = accounts.some(account => account.email === apt.email);
    const isSelected = selectedAppointment && selectedAppointment.id === apt.id;
    const card = el('div', {
      class: `day-appointment-card ${isSelected ? 'selected' : ''}`,
      onclick: () => selectAppointment(apt)
    },
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
          onchange: async (e) => {
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
        !accountExists && el('button', {
          onclick: async (e) => {
            e.stopPropagation();

            try {
              const notes = prompt('Add any notes for this account (optional):');
              await createAccount(apt.id, notes || '');
              alert('✅ Account created successfully!');
              await loadAppointments();
            } catch (error) {
              alert(`❌ ${error.message}`);
            }
          },
          style: 'padding: 0.5rem 1rem; background: #228B22; color: white; border: none; border-radius: 6px; cursor: pointer; margin-right: 0.5rem;'
        }, '👤 Create Account'),
        el('button', {
          onclick: async () => {
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

function renderAccounts(accounts) {
  const container = $('#accountsList');
  container.innerHTML = '';

  if (accounts.length === 0) {
    container.appendChild(el('div', { class: 'note' }, 'No customer accounts found.'));
    return;
  }

  accounts.forEach(account => {
    const card = el('div', {
      class: 'account-card',
      onclick: () => showAccountDetails(account)
    },
      el('div', { class: 'account-header' },
        el('div', {},
          el('div', { class: 'account-name' }, account.name),
          el('div', { class: 'account-address' }, [account.address, account.city, account.state, account.zip].filter(Boolean).join(', ')),
          el('div', { class: 'account-email' }, account.email)
        ),
        el('div', { class: 'account-stats' },
          el('span', {}, `🛞 ${account.totalPickups || 0} pickups`),
          el('span', {}, `📅 Last: ${account.lastPickup || 'Never'}`)
        )
      )
    );

    container.appendChild(card);
  });
}

function renderAccountDetails(account) {
  const container = $('#accountInfo');
  container.innerHTML = '';

  const infoGrid = el('div', { class: 'account-info-grid' },
    el('div', { class: 'info-field' },
      el('label', {}, 'Name'),
      el('span', {}, account.name)
    ),
    el('div', { class: 'info-field' },
      el('label', {}, 'Email'),
      el('span', {}, account.email)
    ),
    el('div', { class: 'info-field' },
      el('label', {}, 'Phone'),
      el('span', {}, account.phone || 'Not provided')
    ),
    el('div', { class: 'info-field' },
      el('label', {}, 'Address'),
      el('span', {}, [account.address, account.city, account.state, account.zip].filter(Boolean).join(', '))
    ),
    el('div', { class: 'info-field' },
      el('label', {}, 'Total Pickups'),
      el('span', {}, account.totalPickups || 0)
    ),
    el('div', { class: 'info-field' },
      el('label', {}, 'Last Pickup'),
      el('span', {}, account.lastPickup || 'Never')
    ),
    account.notes ? el('div', { class: 'info-field', style: 'grid-column: 1 / -1;' },
      el('label', {}, 'Notes'),
      el('span', {}, account.notes)
    ) : null
  );

  container.appendChild(infoGrid);

  // Render notifications
  renderNotifications(account);
}

function renderNotifications(account) {
  const container = $('#notificationsList');
  container.innerHTML = '';

  const notifications = account.notifications || [];

  if (notifications.length === 0) {
    container.appendChild(el('div', { class: 'note' }, 'No notifications scheduled.'));
    return;
  }

  notifications.forEach(notification => {
    const textarea = document.createElement('textarea');
    textarea.className = 'notification-message';
    textarea.value = notification.message || '';
    const item = el('div', { class: 'notification-item' },
      el('div', { class: 'notification-date' },
        `📅 ${new Date(notification.date).toLocaleDateString()}`
      ),
      textarea,

      el('button', {
        onclick: async () => {
          if (confirm('Delete this notification?')) {
            try {
              await deleteNotification(account.id, notification.id);
              await loadAccountDetails(account.id);
            } catch (error) {
              alert(`❌ ${error.message}`);
            }
          }
        },
        style: 'background: #8B0000; color: white; border: none; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: pointer; margin-left: auto;'
      }, '🗑️')
    );

    container.appendChild(item);
  });
  console.log(document.querySelectorAll('#notificationsList textarea.notification-message')
  );
}

async function loadAccounts() {
  try {
    const accounts = await fetchAccounts();
    renderAccounts(accounts);
  } catch (error) {
    alert(`❌ Failed to load accounts: ${error.message}`);
  }
}

async function loadAccountDetails(accountId) {
  try {
    const token = getToken();
    const res = await fetch(`/api/accounts/${accountId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load account');

    renderAccountDetails(data.account);
  } catch (error) {
    alert(`❌ Failed to load account details: ${error.message}`);
  }
}

function showAccountDetails(account) {
  renderAccountDetails(account);
  $('#accountDetails').dataset.accountId = account.id;
  $('#accountsSection').hidden = true;
  $('#accountDetails').hidden = false;
}

function showAccountsList() {
  $('#accountDetails').hidden = true;
  $('#accountsSection').hidden = false;
}

async function loadAppointments() {
  try {
    const allAppointments = await fetchAppointments();
    accounts = await fetchAccounts();
    // Filter appointments for the current month view
    const startDate = formatDate(getMonthStart(currentDate));
    const endDate = formatDate(getMonthEnd(currentDate));
    appointments = allAppointments.filter(apt => apt.date >= startDate && apt.date <= endDate);
    renderCalendar();

    if (selectedDate) {
      const dayAppointments = allAppointments.filter(apt => apt.date === formatDate(selectedDate));
      renderDayAppointments(dayAppointments, accounts);
    }
  } catch (error) {
    alert(`❌ Failed to load appointments: ${error.message}`);
  }
}

function exportCsv(list) {
  const headers = ['id', 'createdAt', 'status', 'name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'date', 'timeWindow', 'tiresCount', 'notes'];
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
    // Try to load appointments, but handle invalid tokens
    loadAppointments().catch(error => {
      if (error.message.includes('Unauthorized')) {
        // Token is invalid, clear it and show login form
        clearToken();
        $('#loginSection').hidden = false;
        $('#adminSection').hidden = true;
      } else {
        alert(`❌ ${error.message}`);
      }
    });
  } else {
    // No token, show login form
    $('#loginSection').hidden = false;
    $('#adminSection').hidden = true;
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

  // Account management event listeners
  $('#manageAccounts').addEventListener('click', () => {
    $('#calendar').hidden = true;
    $('#appointmentDetails').hidden = true;
    $('#accountsSection').hidden = false;
    loadAccounts();
  });

  $('#refreshAccounts').addEventListener('click', loadAccounts);

  $('#searchAccounts').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const accountCards = document.querySelectorAll('.account-card');

    accountCards.forEach(card => {
      const name = card.querySelector('.account-name').textContent.toLowerCase();
      const email = card.querySelector('.account-email').textContent.toLowerCase();
      const visible = name.includes(searchTerm) || email.includes(searchTerm);
      card.style.display = visible ? 'block' : 'none';
    });
  });

  $('#backToAccounts').addEventListener('click', showAccountsList);

  $('#addNotification').addEventListener('click', async () => {
    const dateInput = $('#notificationDate');
    const messageInput = $('#notificationMessage');

    if (!dateInput.value || !messageInput.value.trim()) {
      alert('Please enter both date and message for the notification.');
      return;
    }

    try {
      const accountId = $('#accountDetails').dataset.accountId;
      await addNotification(accountId, messageInput.value.trim(), dateInput.value);
      await loadAccountDetails(accountId);
      dateInput.value = '';
      messageInput.value = '';
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  });

  $('#editAccount').addEventListener('click', () => {
    // TODO: Implement account editing
    alert('Account editing feature coming soon!');
  });

  $('#deleteAccount').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete this account? This action cannot be undone.')) {
      return;
    }

    try {
      const accountId = $('#accountDetails').dataset.accountId;
      await deleteAccount(accountId);
      showAccountsList();
      loadAccounts();
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  });

  $('#logout').addEventListener('click', () => {
    clearToken();
    location.reload();
  });

  $('#calendar-view').addEventListener('click', () => {
    renderCalendar();
    $('#calendar').hidden = false;
    $('#appointmentDetails').hidden = true;
    $('#accountsSection').hidden = true;
  });
})();

