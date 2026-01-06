const http = require('http');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { time } = require('console');

// Load environment variables from .env file
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    const envLines = envContent.split('\n');
    for (const line of envLines) {
      const [key, value] = line.split('=');
      if (key && key.trim() === 'ADMIN_PASSWORD') {
        ADMIN_PASSWORD = value ? value.trim() : '';
        break;
      }
    }
  } catch (e) {
    console.log('Could not load .env file');
  }
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const APPTS_FILE = path.join(DATA_DIR, 'appointments.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

// In-memory session tokens: token -> { role: 'admin', createdAt }
const sessions = new Map();

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const data = await fsp.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fsp.writeFile(file, JSON.stringify(data, null, 2));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        const json = JSON.parse(data);
        resolve(json);
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

function authAdmin(req) {
  const auth = req.headers['authorization'] || '';
  const [scheme, token] = auth.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  const sess = sessions.get(token);
  if (!sess || sess.role !== 'admin') return false;
  // optional: expire tokens after 24h
  const age = Date.now() - sess.createdAt;
  if (age > 24 * 60 * 60 * 1000) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function generateId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

async function getConfig() {
  const defaultConfig = {
    businessName: 'Used Tire Pickup Co.',
    businessPhone: '(555) 123-4567',
    capacityPerDay: 15,
    timeWindows: ['8-11 AM', '11 AM-2 PM', '2-5 PM'],
    blackoutDates: [],
    timezone: 'America/New_York'
  };
  const cfg = await readJson(CONFIG_FILE, null);
  if (!cfg) {
    ensureDirSync(DATA_DIR);
    await writeJson(CONFIG_FILE, defaultConfig);
    return defaultConfig;
  }
  return cfg;
}

async function getAppointments() {
  ensureDirSync(DATA_DIR);
  const list = await readJson(APPTS_FILE, []);
  if (!Array.isArray(list)) return [];
  return list;
}

async function saveAppointments(list) {
  ensureDirSync(DATA_DIR);
  await writeJson(APPTS_FILE, list);
}

async function getAccounts() {
  ensureDirSync(DATA_DIR);
  const list = await readJson(ACCOUNTS_FILE, []);
  if (!Array.isArray(list)) return [];
  return list;
}

async function saveAccounts(list) {
  ensureDirSync(DATA_DIR);
  await writeJson(ACCOUNTS_FILE, list);
}

function normalizeDateOnly(str) {
  // Accept YYYY-MM-DD only
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(str || '')) return null;
  return str;
}

function isBlackoutDate(cfg, dateStr) {
  return (cfg.blackoutDates || []).includes(dateStr);
}

function filterByDate(appts, dateStr) {
  return appts.filter(a => a.date === dateStr && a.status !== 'cancelled');
}

async function handleApi(req, res, parsed) {
  const method = req.method || 'GET';
  const pathname = parsed.pathname || '/';
  const cfg = await getConfig();

  if (method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, {
      businessName: cfg.businessName,
      businessPhone: cfg.businessPhone,
      capacityPerDay: cfg.capacityPerDay,
      timeWindows: cfg.timeWindows,
      blackoutDates: cfg.blackoutDates,
      timezone: cfg.timezone
    });
  }

  if (method === 'POST' && pathname === '/api/appointments') {
    try {
      const body = await parseBody(req);
      const {
        companyName, name, email, phone, address, city, state, zip,
        date, timeWindow, tiresCount, notes
      } = body || {};

      const dateOnly = normalizeDateOnly(date);
      if (!companyName || !name || !(email || phone) || !address || !zip || !dateOnly) {
        return sendJson(res, 400, { error: 'Missing required fields' });
      }
      if (timeWindow &&!cfg.timeWindows.includes(timeWindow)) {
        return sendJson(res, 400, { error: 'Invalid time window' });
      }
      if (isBlackoutDate(cfg, dateOnly)) {
        return sendJson(res, 409, { error: 'Selected date is unavailable' });
      }

      const appts = await getAppointments();
      const sameDay = filterByDate(appts, dateOnly);
      if (sameDay.length >= (cfg.capacityPerDay || 0)) {
        return sendJson(res, 409, { error: 'No availability on selected date' });
      }

      const appt = {
        id: generateId('apt_'),
        createdAt: new Date().toISOString(),
        status: 'scheduled',
        companyName, name, email, phone, address, city: city || '', state: state || '', zip,
        date: dateOnly, 
        timeWindow: timeWindow || '',
        tiresCount: Number(tiresCount) || 0,
        notes: notes || ''
      };
      appts.push(appt);
      await saveAppointments(appts);
      return sendJson(res, 201, { confirmation: appt.id, appointment: appt });
    } catch (e) {
      return sendJson(res, 400, { error: e.message || 'Invalid request' });
    }
  }

  if (method === 'POST' && pathname === '/api/admin/login') {
    try {
      const body = await parseBody(req);
      if (!body || typeof body.password !== 'string') {
        return sendJson(res, 400, { error: 'Password required' });
      }
      if (body.password !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: 'Invalid credentials' });
      }
      const token = generateId('adm_');
      sessions.set(token, { role: 'admin', createdAt: Date.now() });
      return sendJson(res, 200, { token });
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid request' });
    }
  }

  // Public account creation (used by /account.html)
  if (method === 'POST' && pathname === '/api/public/accounts') {
    try {
      const body = await parseBody(req);
      const company = (body?.company || '').trim();
      const contactName = (body?.contactName || '').trim();
      const email = (body?.email || '').trim();
      const phone = (body?.phone || '').trim();
      const address = (body?.address || '').trim();
      const city = (body?.city || '').trim();
      const state = (body?.state || '').trim();
      const zip = (body?.zip || '').trim();

      if (!company || !contactName || !phone || !address || !city || !state || !zip) {
        return sendJson(res, 400, { error: 'Missing required fields' });
      }

      const accounts = await getAccounts();
      if (email) {
        const existing = accounts.find(a => (a.email || '').toLowerCase() === email.toLowerCase());
        if (existing) return sendJson(res, 409, { error: 'Account already exists for this email' });
      }

      const account = {
        id: generateId('acc_'),
        createdAt: new Date().toISOString(),
        company,
        name: contactName,
        email,
        phone,
        address,
        city,
        state,
        zip,
        totalPickups: 0,
        lastPickup: null,
        notifications: [],
        notes: ''
      };

      accounts.push(account);
      await saveAccounts(accounts);
      return sendJson(res, 201, { account });
    } catch (e) {
      return sendJson(res, 400, { error: e.message || 'Invalid request' });
    }
  }

  if (method === 'GET' && pathname === '/api/admin/session') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/appointments' && method === 'GET') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const appts = await getAppointments();
    const q = parsed.query || {};
    const dateOnly = q.date ? normalizeDateOnly(q.date) : null;
    const list = dateOnly ? appts.filter(a => a.date === dateOnly) : appts;
    return sendJson(res, 200, { appointments: list });
  }

  if (pathname.startsWith('/api/appointments/') && method === 'PATCH') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const id = pathname.split('/').pop();
    const body = await parseBody(req).catch(() => ({}));
    const appts = await getAppointments();
    const idx = appts.findIndex(a => a.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Not found' });
    const allowed = ['status', 'notes', 'companyName', 'name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'date', 'timeWindow', 'tiresCount'];
    for (const key of allowed) {
      if (key in body) appts[idx][key] = body[key];
    }
    await saveAppointments(appts);
    return sendJson(res, 200, { appointment: appts[idx] });
  }

  // Validate date if updated
  if ('date' in body) {
    const dateOnly = normalizeDateOnly(appts[idx].date);
    if (!dateOnly) return sendJson(res, 400, { error: 'Invalid date' });
    appts[idx].date = dateOnly;
  }

  // Validate timeWindow if updated
  if ('timeWindow' in body) {
    const tw = appts[idx].timeWindow || '';
    if (tw && !cfg.timeWindows.includes(tw)) {
      return sendJson(res, 400, { error: 'Invalid time window' });
    }
  }

  if ('tiresCount' in body) {
    appts[idx].tiresCount = Number(appts[idx].tiresCount) || 0;
  }

  // Account management endpoints
  if (pathname === '/api/accounts' && method === 'GET') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const accounts = await getAccounts();
    return sendJson(res, 200, { accounts });
  }

  if (method === 'POST' && pathname === '/api/accounts') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    try {
      const body = await parseBody(req);
      if (!body || !body.appointmentId) {
        return sendJson(res, 400, { error: 'Appointment ID required' });
      }

      const appts = await getAppointments();
      const accounts = await getAccounts();
      const appointment = appts.find(a => a.id === body.appointmentId);

      if (!appointment) {
        return sendJson(res, 404, { error: 'Appointment not found' });
      }

      // Check if account already exists
      const existingAccount = accounts.find(a => a.email === appointment.email);
      if (existingAccount) {
        return sendJson(res, 409, { error: 'Account already exists for this email' });
      }

      // Create new account from appointment
      const account = {
        id: generateId('acc_'),
        createdAt: new Date().toISOString(),
        name: appointment.name,
        email: appointment.email,
        phone: appointment.phone,
        address: appointment.address,
        city: appointment.city,
        state: appointment.state,
        zip: appointment.zip,
        totalPickups: 1,
        lastPickup: appointment.date,
        notifications: [],
        notes: body.notes || ''
      };

      accounts.push(account);
      await saveAccounts(accounts);

      return sendJson(res, 201, { account });
    } catch (e) {
      return sendJson(res, 400, { error: e.message || 'Invalid request' });
    }
  }

  // Get all accounts
  if (pathname === '/api/accounts' && method === 'GET') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const accounts = await getAccounts();
    return sendJson(res, 200, { accounts });
  }

  if (pathname.startsWith('/api/accounts/') && !pathname.includes('/notifications/') && method === 'GET') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const id = pathname.split('/').pop();
    const accounts = await getAccounts();
    const account = accounts.find(a => a.id === id);
    if (!account) return sendJson(res, 404, { error: 'Account not found' });
    return sendJson(res, 200, { account });
  }

  if (pathname.startsWith('/api/accounts/') && !pathname.includes('/notifications/') && method === 'PATCH') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const id = pathname.split('/').pop();
    const body = await parseBody(req).catch(() => ({}));
    const accounts = await getAccounts();
    const idx = accounts.findIndex(a => a.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Account not found' });

    const allowed = ['company', 'name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'notes'];
    for (const key of allowed) {
      if (key in body) accounts[idx][key] = body[key];
    }

    await saveAccounts(accounts);
    return sendJson(res, 200, { account: accounts[idx] });
  }

  if (pathname.startsWith('/api/accounts/') && !pathname.includes('/notifications/') && method === 'DELETE') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const id = pathname.split('/').pop();
    const accounts = await getAccounts();
    const idx = accounts.findIndex(a => a.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Account not found' });

    accounts.splice(idx, 1);
    await saveAccounts(accounts);
    return sendJson(res, 200, { success: true });
  }

  // Notification management for accounts
  if (pathname.startsWith('/api/accounts/') && pathname.endsWith('/notifications') && method === 'POST') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const accountId = pathname.split('/')[3];
    const body = await parseBody(req).catch(() => ({}));

    if (!body.message || !body.date) {
      return sendJson(res, 400, { error: 'Message and date required' });
    }

    const accounts = await getAccounts();
    const idx = accounts.findIndex(a => a.id === accountId);
    if (idx === -1) return sendJson(res, 404, { error: 'Account not found' });

    const notification = {
      id: generateId('notif_'),
      message: body.message,
      date: body.date,
      createdAt: new Date().toISOString(),
      sent: false,
      recurring: body.recurring || false,
      recurrenceWeeks: body.recurrenceWeeks || 1
    };

    if (!accounts[idx].notifications) accounts[idx].notifications = [];
    accounts[idx].notifications.push(notification);

    // If recurring, create future notifications
    if (notification.recurring && notification.recurrenceWeeks > 0) {
      const baseDate = new Date(notification.date);
      // Create up to 12 future occurrences (1 year max)
      for (let i = 1; i <= 12; i++) {
        const futureDate = new Date(baseDate);
        futureDate.setDate(baseDate.getDate() + (i * notification.recurrenceWeeks * 7));
        const futureNotification = {
          id: generateId('notif_'),
          message: notification.message,
          date: futureDate.toISOString().split('T')[0], // YYYY-MM-DD format
          createdAt: new Date().toISOString(),
          sent: false,
          recurring: true,
          recurrenceWeeks: notification.recurrenceWeeks,
          parentId: notification.id // Reference to the original notification
        };
        accounts[idx].notifications.push(futureNotification);
      }
    }

    await saveAccounts(accounts);
    return sendJson(res, 201, { notification });
  }

  if (pathname.startsWith('/api/accounts/') && pathname.includes('/notifications/') && method === 'DELETE') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const parts = pathname.split('/');
    const accountId = parts[3];
    const notificationId = parts[5];

    const accounts = await getAccounts();
    const accountIdx = accounts.findIndex(a => a.id === accountId);
    if (accountIdx === -1) return sendJson(res, 404, { error: 'Account not found' });

    const notifIdx = accounts[accountIdx].notifications?.findIndex(n => n.id === notificationId);
    if (notifIdx === undefined || notifIdx === -1) return sendJson(res, 404, { error: 'Notification not found' });

    accounts[accountIdx].notifications.splice(notifIdx, 1);
    await saveAccounts(accounts);
    return sendJson(res, 200, { success: true });
  }

  if (pathname.startsWith('/api/accounts/') && pathname.includes('/notifications/') && method === 'PATCH') {
    if (!authAdmin(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const parts = pathname.split('/');
    const accountId = parts[3];
    const notificationId = parts[5];
    const body = await parseBody(req).catch(() => ({}));

    if (!body.message || !body.date) {
      return sendJson(res, 400, { error: 'Message and date required' });
    }

    const accounts = await getAccounts();
    const accountIdx = accounts.findIndex(a => a.id === accountId);
    if (accountIdx === -1) return sendJson(res, 404, { error: 'Account not found' });

    const notifIdx = accounts[accountIdx].notifications?.findIndex(n => n.id === notificationId);
    if (notifIdx === undefined || notifIdx === -1) return sendJson(res, 404, { error: 'Notification not found' });

    // Update the notification
    const notification = accounts[accountIdx].notifications[notifIdx];
    notification.message = body.message;
    notification.date = body.date;
    notification.recurring = body.recurring || false;
    notification.recurrenceWeeks = body.recurrenceWeeks || 1;

    await saveAccounts(accounts);
    return sendJson(res, 200, { notification });
  }

  if (method === 'GET' && (pathname === '/healthz' || pathname === '/api/healthz')) {
    return sendJson(res, 200, { ok: true });
  }

  return null; // not handled
}

async function serveStatic(req, res, parsed) {
  let pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  // prevent path traversal
  const safePath = path.normalize(pathname).replace(/^\.+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      const content = await fsp.readFile(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(content);
    } else {
      const content = await fsp.readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
      return res.end(content);
    }
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
}

async function requestListener(req, res) {
  const parsed = url.parse(req.url, true);
  // Simple CORS for API if needed by local files
  if ((req.headers['origin'] || '').startsWith('http://') || (req.headers['origin'] || '').startsWith('https://')) {
    res.setHeader('Access-Control-Allow-Origin', req.headers['origin']);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,PUT,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (parsed.pathname && (parsed.pathname.startsWith('/api/') || parsed.pathname === '/healthz')) {
    const handled = await handleApi(req, res, parsed);
    if (handled !== null) return;
  }
  return serveStatic(req, res, parsed);
}

async function bootstrap() {
  ensureDirSync(DATA_DIR);
  // Initialize files if missing
  const cfg = await getConfig();
  if (!fs.existsSync(APPTS_FILE)) await writeJson(APPTS_FILE, []);
  console.log(`[server] Using capacityPerDay=${cfg.capacityPerDay}, timezone=${cfg.timezone}`);
  console.log(`[server] Admin password ${ADMIN_PASSWORD === 'changeme' ? 'is default (set ADMIN_PASSWORD!)' : 'configured via env'}`);
}

bootstrap().then(() => {
  const server = http.createServer(requestListener);
  server.listen(PORT, () => {
    console.log(`Pickup scheduler listening on http://localhost:${PORT}`);
  });
});
