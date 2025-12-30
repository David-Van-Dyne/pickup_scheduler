const http = require('http');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const APPTS_FILE = path.join(DATA_DIR, 'appointments.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

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
        name, email, phone, address, city, state, zip,
        date, timeWindow, tiresCount, notes
      } = body || {};

      const dateOnly = normalizeDateOnly(date);
      if (!name || !(email || phone) || !address || !zip || !dateOnly || !timeWindow) {
        return sendJson(res, 400, { error: 'Missing required fields' });
      }
      if (!cfg.timeWindows.includes(timeWindow)) {
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
        name, email, phone, address, city: city || '', state: state || '', zip,
        date: dateOnly, timeWindow,
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
    const allowed = ['status', 'notes'];
    for (const key of allowed) {
      if (key in body) appts[idx][key] = body[key];
    }
    await saveAppointments(appts);
    return sendJson(res, 200, { appointment: appts[idx] });
  }

  if (method === 'GET' && pathname === '/healthz') {
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (parsed.pathname && parsed.pathname.startsWith('/api/')) {
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

