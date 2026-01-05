
import { initCalendar } from "./calendar.js";
import { initEventCreateButtons } from "./event-create-button.js";
import { initEventDeleteDialog } from "./event-delete-dialog.js";
import { initEventDetailsDialog } from "./event-details-dialog.js";
import { initEventFormDialog } from "./event-form-dialog.js";
import { initEventStore } from "./event-store.js";
import { initHamburger } from "./hamburger.js";
import { initMiniCalendars } from "./mini-calendar.js";
import { initMobileSidebar } from "./mobile-sidebar.js";
import { initNav } from "./nav.js";
import { initNotifications } from "./notifications.js";
import { initViewSelect } from "./view-select.js";
import { initResponsive } from "./responsive.js";
import { initUrl } from "./url.js";
import { initSync } from "./sync.js";

const eventStore = initEventStore();
initCalendar(eventStore);
initEventCreateButtons();
initEventDeleteDialog();
initEventDetailsDialog();
initEventFormDialog();
initHamburger();
initMiniCalendars();
initMobileSidebar();
initNav();
initNotifications();
initViewSelect();
initUrl();
initResponsive();
initSync();

// Immediately hide login section and show admin section when page loads
document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.querySelector('#loginSection');
  const adminSection = document.querySelector('#adminSection');
  if (loginSection) loginSection.hidden = true;
  if (adminSection) adminSection.hidden = false;
});

function $(sel) { return document.querySelector(sel); }
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k in n) n[k] = v; // value, checked, hidden, etc.
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }

  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    if (typeof c === 'string' || typeof c === 'number') n.appendChild(document.createTextNode(String(c)));
    else if (c instanceof Node) n.appendChild(c);
  };

  children.forEach(add);
  return n;
}




let calendarEventsInitialized = false;

function initCalendarEvents() {
  if (calendarEventsInitialized) return;

  const cal = $('#calendar');
  if (!cal) return;

  cal.addEventListener('click', (e) => {
    const moreLess = e.target.closest('[data-toggle-date]');
    if (moreLess) {
      toggleDayExpansion(new Date(moreLess.dataset.toggleDate));
      e.stopPropagation();
      return;
    }

    const aptEl = e.target.closest('[data-apt-id]');
    if (aptEl) {
      const apt = appointments.find(a => String(a.id) === aptEl.dataset.aptId);
      if (apt) selectAppointment(apt);
      e.stopPropagation();
      return;
    }

    const dayEl = e.target.closest('[data-date]');
    if (dayEl) selectDate(parseDate(dayEl.dataset.date));
  });

  calendarEventsInitialized = true;
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

function authHeaders() {
  // Authentication disabled - return empty headers
  return {};
  // const token = getToken();
  // if (!token) throw new Error('Not logged in');
  // return { Authorization: `Bearer ${token}` };
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Safer than res.json(): supports empty responses and non-JSON errors
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) throw new Error(data.error || `${method} ${path} failed`);
  return data;
}

async function authRequest(path, opts = {}) {
  return request(path, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers || {}) },
  });
}

async function login(password) {
  const data = await request('/api/admin/login', { method: 'POST', body: { password } });
  return data.token;
}

async function fetchAppointments() {
  const data = await authRequest('/api/appointments');
  return data.appointments || [];
}

async function patchAppointment(id, patch) {
  const data = await authRequest(`/api/appointments/${id}`, { method: 'PATCH', body: patch });
  return data.appointment;
}

async function fetchAccounts() {
  const data = await authRequest('/api/accounts');
  return data.accounts;
}

async function createAccount(appointmentId, notes = '') {
  const data = await authRequest('/api/accounts', {
    method: 'POST',
    body: { appointmentId, notes },
  });
  return data.account;
}

async function patchAccount(id, patch) {
  const data = await authRequest(`/api/accounts/${id}`, { method: 'PATCH', body: patch });
  return data.account;
}

async function deleteAccount(id) {
  await authRequest(`/api/accounts/${id}`, { method: 'DELETE' });
  return true;
}

async function addNotification(accountId, message, date, recurring = false, recurrenceWeeks = 1) {
  const data = await authRequest(`/api/accounts/${accountId}/notifications`, {
    method: 'POST',
    body: { message, date, recurring, recurrenceWeeks },
  });
  return data.notification;
}

async function deleteNotification(accountId, notificationId) {
  await authRequest(`/api/accounts/${accountId}/notifications/${notificationId}`, { method: 'DELETE' });
  return true;
}

async function updateNotification(accountId, notificationId, updates) {
  const data = await authRequest(`/api/accounts/${accountId}/notifications/${notificationId}`, {
    method: 'PATCH',
    body: updates,
  });
  return data.notification;
}

// Calendar state
let currentDate = new Date();
let appointments = [];
let accounts = [];
let selectedDate = null;
let selectedAppointment = null;

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
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

async function loadTodaysNotifications() {
  try {
    const accounts = await fetchAccounts();
    const allNotifications = [];

    // Collect all notifications from all accounts
    accounts.forEach(account => {
      if (account.notifications && account.notifications.length > 0) {
        account.notifications.forEach(notification => {
          allNotifications.push({
            ...notification,
            accountId: account.id,
            accountName: account.name,
            accountEmail: account.email
          });
        });
      }
    });

    renderNotificationsList(allNotifications);
  } catch (error) {
    console.error('Failed to load today\'s notifications:', error);
    // Show a more user-friendly message
    $('#notifications-list').innerHTML = '<div class="note">Unable to load today\'s notifications. Please refresh the page.</div>';
  }
}

function AppointmentChip(apt) {
  return el('div', {
    class: `appointment-item ${apt.status}`,
    title: `${apt.name} - ${apt.timeWindow}`,
    'data-apt-id': String(apt.id),
  }, `${apt.timeWindow}: ${apt.name}`);
}

function DayCell(dateObj, isCurrentMonth, isToday, dayAppointments) {
  const dateKey = formatDate(dateObj);

  const chips = dayAppointments.map(AppointmentChip);

  const appointmentsNode =
    chips.length > 3
      ? el('div', {},
        el('div', { class: 'calendar-appointments-limited', style: { display: 'block' } },
          ...chips.slice(0, 3),
          el('button', { class: 'appointment-more', 'data-toggle-date': dateKey, type: 'button' }, `+${chips.length - 3} more`)
        ),
        el('div', { class: 'calendar-appointments-expanded', style: { display: 'none' } },
          el('button', { class: 'appointment-more expanded', 'data-toggle-date': dateKey, type: 'button' }, 'Show less'),
          ...chips
        )
      )
      : el('div', {}, ...chips);

  const appointmentsEl = el('div', { class: 'calendar-appointments' }, appointmentsNode);

  return el('div', {
    class: `calendar-day ${isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''}`,
    'data-date': dateKey
  },
    el('div', { class: 'calendar-day-number' }, dateObj.getDate()),
    appointmentsEl
  );
}

function parseTime(timeStr) {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 0;
  let hour = parseInt(match[1]);
  const min = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return hour * 60 + min;
}

// function renderCalendar() {
//   const calendar = $('#calendar');

//   const monthStart = getMonthStart(currentDate);
//   const monthEnd = getMonthEnd(currentDate);

//   //Header text
//   // $('#currentMonth').textContent = currentDate.toLocaleDateString('en-US', {
//   //   year: 'numeric',
//   //   month: 'long'
//   // });

//   // Build date range to fill full weeks (Sun..Sat)
//   const startDate = new Date(monthStart);
//   startDate.setDate(startDate.getDate() - startDate.getDay()); // Sunday

//   const endDate = new Date(monthEnd);
//   endDate.setDate(endDate.getDate() + (6 - endDate.getDay())); // Saturday

//   // Map appointments by date once
//   const apptsByDate = new Map();
//   for (const apt of appointments) {
//     const arr = apptsByDate.get(apt.date) || [];
//     arr.push(apt);
//     apptsByDate.set(apt.date, arr);
//   }

//   const header = el('div', { class: 'calendar-header' },
//     ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => el('div', {}, d))
//   );

//   const grid = el('div', { class: 'calendar-grid' }, header);

//   const today = new Date();
//   today.setHours(0, 0, 0, 0);

//   for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
//     const dateKey = formatDate(d);
//     const dayAppointments = apptsByDate.get(dateKey) || [];
//     dayAppointments.sort((a, b) => parseTime(a.timeWindow) - parseTime(b.timeWindow));

//     const isToday = d.toDateString() === today.toDateString();
//     const isCurrentMonth = d.getMonth() === currentDate.getMonth();

//     grid.appendChild(DayCell(new Date(d), isCurrentMonth, isToday, dayAppointments));
//   }

//   calendar.replaceChildren(grid);
// }

// function toggleDayExpansion(date) {
//   const dateStr = formatDate(date);
//   const dayElement = document.querySelector(`[data-date="${dateStr}"]`);
//   if (!dayElement) return;

//   const appointmentsEl = dayElement.querySelector('.calendar-appointments');
//   const limited = dayElement.querySelector('.calendar-appointments-limited');
//   const expanded = dayElement.querySelector('.calendar-appointments-expanded');
//   if (!limited || !expanded || !appointmentsEl) return;

//   const limitedShowing = limited.style.display !== 'none';
//   limited.style.display = limitedShowing ? 'none' : 'block';
//   expanded.style.display = limitedShowing ? 'block' : 'none';
//   appointmentsEl.style.maxHeight = limitedShowing ? 'none' : '120px';
//   if (!limitedShowing) appointmentsEl.scrollTop = 0;
// }

// function selectDate(date) {
//   selectedDate = new Date(date);
//   selectedAppointment = null; // Clear appointment selection when selecting a date
//   const dayAppointments = appointments.filter(apt => apt.date === formatDate(selectedDate));

//   $('#selectedDate').textContent = formatDisplayDate(selectedDate);
//   $('#appointmentDetails').hidden = false;

//   renderDayAppointments(dayAppointments, accounts);
// }

// function selectAppointment(appointment) {
//   selectedDate = parseDate(appointment.date);
//   selectedAppointment = appointment;
//   const dayAppointments = appointments.filter(apt => apt.date === formatDate(selectedDate));

//   $('#selectedDate').textContent = formatDisplayDate(selectedDate);
//   $('#appointmentDetails').hidden = false;

//   renderDayAppointments(dayAppointments, accounts);
// }

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

  // Sort notifications by date
  notifications.sort((a, b) => new Date(a.date) - new Date(b.date));

  notifications.forEach(notification => {
    const date = new Date(notification.date).toLocaleDateString();
    let displayText = `📅 ${date}: ${notification.message}`;
    if (notification.recurring) {
      displayText += ` 🔄 (Repeats every ${notification.recurrenceWeeks} week${notification.recurrenceWeeks !== 1 ? 's' : ''})`;
    }

    const notificationItem = el('div', {
      class: 'notification-item',
      onclick: () => editNotification(notification, account.id)
    },
      el('div', { class: 'notification-content' }, displayText),
      el('div', { class: 'notification-actions' },
        el('button', {
          class: 'edit-btn',
          onclick: (e) => {
            e.stopPropagation();
            editNotification(notification, account.id);
          }
        }, '✏️'),
        el('button', {
          class: 'delete-btn',
          onclick: async (e) => {
            e.stopPropagation();
            if (confirm('Delete this notification?')) {
              try {
                await deleteNotification(account.id, notification.id);
                await loadAccountDetails(account.id);
                await loadTodaysNotifications();
              } catch (error) {
                alert(`❌ ${error.message}`);
              }
            }
          }
        }, '🗑️')
      )
    );

    container.appendChild(notificationItem);
  });
}

function renderNotificationsList(notifications) {
  const container = $('#notifications-list');
  container.innerHTML = '';

  if (notifications.length === 0) {
    container.appendChild(el('div', { class: 'note' }, 'No notifications for today.'));
    return;
  }

  // Sort by date
  notifications.sort((a, b) => new Date(a.date) - new Date(b.date));

  notifications.forEach(notification => {
    const date = new Date(notification.date).toLocaleDateString();
    let displayText = `📅 ${date}: ${notification.message} (${notification.accountName})`;
    if (notification.recurring) {
      displayText += ` 🔄 (Repeats every ${notification.recurrenceWeeks} week${notification.recurrenceWeeks !== 1 ? 's' : ''})`;
    }

    const notificationItem = el('div', { class: 'notification-item' },
      el('div', { class: 'notification-content' }, displayText)
    );

    container.appendChild(notificationItem);
  });
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
    // Ensure the dataset is set with the correct account ID
    $('#accountDetails').dataset.accountId = data.account.id;
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

function editNotification(notification, accountId) {
  // Create edit form
  const editForm = el('div', { class: 'notification-edit-form' },
    el('h4', {}, 'Edit Notification'),
    el('div', { class: 'form-group' },
      el('label', {}, 'Date:'),
      el('input', {
        type: 'date',
        id: 'editNotificationDate',
        value: notification.date.split('T')[0] // Extract date part
      })
    ),
    el('div', { class: 'form-group' },
      el('label', {}, 'Message:'),
      el('textarea', {
        id: 'editNotificationMessage',
        rows: 3,
        placeholder: 'Notification message...'
      }, notification.message)
    ),
    el('div', { class: 'form-group' },
      el('label', {},
        el('input', {
          type: 'checkbox',
          id: 'editNotificationRecurring',
          checked: notification.recurring || false
        }),
        ' Make recurring'
      )
    ),
    el('div', {
      class: 'form-group recurrence-interval',
      id: 'editRecurrenceInterval',
      style: notification.recurring ? 'display: block;' : 'display: none;'
    },
      el('label', {}, 'Repeat every '),
      el('input', {
        type: 'number',
        id: 'editNotificationWeeks',
        min: '1',
        max: '52',
        value: notification.recurrenceWeeks || 1
      }),
      el('span', {}, ' week(s)')
    ),
    el('div', { class: 'form-actions' },
      el('button', {
        id: 'saveNotificationEdit',
        onclick: () => saveNotificationEdit(notification.id, accountId)
      }, '💾 Save'),
      el('button', {
        id: 'cancelNotificationEdit',
        onclick: () => cancelNotificationEdit()
      }, '❌ Cancel')
    )
  );

  // Show edit form in a modal or replace the notifications list temporarily
  const container = $('#notificationsList');
  container.innerHTML = '';
  container.appendChild(editForm);

  // Add event listener for recurring checkbox
  $('#editNotificationRecurring').addEventListener('change', (e) => {
    $('#editRecurrenceInterval').style.display = e.target.checked ? 'block' : 'none';
  });
}

async function saveNotificationEdit(notificationId, accountId) {
  // Get the accountId from the dataset to ensure consistency
  const currentAccountId = $('#accountDetails').dataset.accountId;

  const date = $('#editNotificationDate').value;
  const message = $('#editNotificationMessage').value.trim();
  const recurring = $('#editNotificationRecurring').checked;
  const recurrenceWeeks = parseInt($('#editNotificationWeeks').value) || 1;

  if (!date || !message) {
    alert('Please enter both date and message for the notification.');
    return;
  }

  try {
    await updateNotification(currentAccountId, notificationId, { message, date, recurring, recurrenceWeeks });
    await loadAccountDetails(currentAccountId);
    await loadTodaysNotifications();
  } catch (error) {
    alert(`❌ ${error.message}`);
  }
}

function cancelNotificationEdit() {
  // This will be called when cancelling edit, but we need to reload the account details
  const accountId = $('#accountDetails').dataset.accountId;
  loadAccountDetails(accountId);
}

async function loadAppointments() {
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

async function init() {
  // Authentication disabled - bypass token check
  // const token = getToken();

  // Show/hide sections up front - always show admin section
  $('#loginSection').hidden = true;
  $('#adminSection').hidden = false;

  // Bind calendar delegation once
  initCalendarEvents();

  // Load data without token check
  try {
    await loadAppointments();
    await loadTodaysNotifications();
  } catch (error) {
    alert(`❌ ${error.message}`);
  }

  // Login
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('⏳ Signing in...', 'loading');

    const pwd = new FormData(e.currentTarget).get('password');

    try {
      const t = await login(pwd);
      setToken(t);

      setStatus('✅ Login successful!', 'success');

      $('#loginSection').hidden = true;
      $('#adminSection').hidden = false;

      initCalendarEvents(); // safe because you have init-once guard
      await loadAppointments();
      await loadTodaysNotifications();
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'error');
    }
  });

  // Calendar navigation
  $('#prevMonth').addEventListener('click', async () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    await loadAppointments();
  });

  $('#nextMonth').addEventListener('click', async () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    await loadAppointments();
  });

  $('#refresh').addEventListener('click', async () => {
    await loadAppointments();
    await loadTodaysNotifications();
  });

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

  // Handle recurring notification checkbox
  $('#notificationRecurring').addEventListener('change', (e) => {
    const recurrenceDiv = $('#recurrenceInterval');
    recurrenceDiv.style.display = e.target.checked ? 'block' : 'none';
  });

  $('#addNotification').addEventListener('click', async () => {
    const dateInput = $('#notificationDate');
    const messageInput = $('#notificationMessage');
    const recurringCheckbox = $('#notificationRecurring');
    const weeksInput = $('#notificationWeeks');

    if (!dateInput.value || !messageInput.value.trim()) {
      alert('Please enter both date and message for the notification.');
      return;
    }

    try {
      const accountId = $('#accountDetails').dataset.accountId;
      const notificationData = {
        message: messageInput.value.trim(),
        date: dateInput.value
      };

      if (recurringCheckbox.checked) {
        notificationData.recurring = true;
        notificationData.recurrenceWeeks = parseInt(weeksInput.value) || 1;
      }

      await addNotification(accountId, notificationData.message, notificationData.date, notificationData.recurring, notificationData.recurrenceWeeks);
      await loadAccountDetails(accountId);
      await loadTodaysNotifications();
      dateInput.value = '';
      messageInput.value = '';
      recurringCheckbox.checked = false;
      weeksInput.value = '1';
      $('#recurrenceInterval').style.display = 'none';
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
}

init();