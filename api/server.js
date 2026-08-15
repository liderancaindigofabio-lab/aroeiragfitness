'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 10000);
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_OWNER || 'liderancaindigofabio-lab';
const GH_REPO = process.env.GITHUB_REPO || 'aroeiragfitness-data';
const GH_FILE = process.env.GITHUB_FILE || 'aroeira_data.json';
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const STORAGE_MODE = process.env.STORAGE_MODE || 'github';
const LOCAL_DATA_FILE = process.env.LOCAL_DATA_FILE || path.join(__dirname, '..', 'private-data', 'aroeira_data.json');
const ALLOWED_ORIGINS = new Set([
  process.env.FRONTEND_ORIGIN || 'https://liderancaindigofabio-lab.github.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
]);

if (STORAGE_MODE === 'github' && !GH_TOKEN) console.warn('[startup] GITHUB_TOKEN ausente');

const loginAttempts = new Map();
let cachedData = null;
let cachedSha = null;
let writeQueue = Promise.resolve();

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Cache-Control': 'no-store'
  };
}

function send(res, status, body, origin, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...securityHeaders(),
    ...corsHeaders(origin),
    ...extra,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Connection': 'keep-alive'
  });
  res.end(payload);
}

function githubUrl(path) {
  return `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
}

async function githubGet() {
  if (STORAGE_MODE === 'local') {
    const data = normalizeData(JSON.parse(fs.readFileSync(LOCAL_DATA_FILE, 'utf8')));
    return { data, sha: 'local' };
  }
  if (!GH_TOKEN) throw new Error('GITHUB_TOKEN ausente no servidor');
  const response = await fetch(`${githubUrl(GH_FILE)}?ref=${encodeURIComponent(GH_BRANCH)}&t=${Date.now()}`, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aroeira-gfitness-sync/3.0'
    },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`GitHub GET ${response.status}`);
  const file = await response.json();
  const content = Buffer.from(String(file.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  return { data: normalizeData(JSON.parse(content)), sha: file.sha };
}

async function githubPut(data, sha, message = 'chore: atualização dos dados da academia') {
  if (STORAGE_MODE === 'local') {
    fs.writeFileSync(LOCAL_DATA_FILE, JSON.stringify(normalizeData(data), null, 2) + '\n', 'utf8');
    return { content: { sha: 'local' } };
  }
  const content = Buffer.from(JSON.stringify(normalizeData(data), null, 2) + '\n', 'utf8').toString('base64');
  const response = await fetch(githubUrl(GH_FILE), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'aroeira-gfitness-sync/3.0'
    },
    body: JSON.stringify({ message, content, branch: GH_BRANCH, sha })
  });
  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`GitHub PUT ${response.status}`);
    err.status = response.status;
    err.details = text.slice(0, 500);
    throw err;
  }
  return response.json();
}

function normalizePlan(plan) {
  const value = String(plan ?? '').trim();
  if (!value) return '';
  if (/CR.*DITO\s*15\s*DIAS/i.test(value) || /CR[�]+DITO\s*15/i.test(value)) return 'CRÉDITO 15 DIAS';
  return value.replace(/\s+/g, ' ').toUpperCase();
}

function normalizeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(2));
  const raw = String(value ?? '').trim().replace(/^R\$\s*/i, '').replace(',', '.').replace('’', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function normalizeData(data) {
  const students = (Array.isArray(data?.students) ? data.students.map((s, index) => ({
    id: s?.id ?? Date.now() + index,
    name: String(s?.name ?? '').trim().toUpperCase(),
    email: String(s?.email ?? '').trim(),
    phone: String(s?.phone ?? '').trim(),
    plan: normalizePlan(s?.plan),
    value: normalizeValue(s?.value),
    due: /^\d{4}-\d{2}-\d{2}$/.test(String(s?.due ?? '')) ? String(s.due) : '',
    payment: String(s?.payment ?? '').trim(),
    evaluations: Array.isArray(s?.evaluations) ? s.evaluations : [],
    paymentHistory: Array.isArray(s?.paymentHistory) ? s.paymentHistory.map(p => ({
      month: String(p?.month ?? '').trim(),
      value: normalizeValue(p?.value),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(p?.date ?? '')) ? String(p.date) : ''
    })) : [],
    gymHistory: Array.isArray(s?.gymHistory) ? s.gymHistory : []
  })).filter(s => s.name) : []);

  const result = {
    students,
    history: Array.isArray(data?.history) ? data.history : [],
    lastUpdate: data?.lastUpdate || new Date().toISOString()
  };
  if (typeof data?.passwordHash === 'string' && data.passwordHash) result.passwordHash = data.passwordHash;
  if (typeof data?.password === 'string' && data.password && !result.passwordHash) result.password = data.password;
  return result;
}

function deduplicateExactStudents(students) {
  const seen = new Set();
  return students.filter(student => {
    const copy = { ...student };
    delete copy.id;
    const signature = JSON.stringify(copy, Object.keys(copy).sort());
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error('payload grande demais'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signToken(payload) {
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function auth(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, expected] = stored.split('$');
    const actual = crypto.scryptSync(password, salt, 64).toString('hex');
    return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }
  return password === stored;
}

function rateLimitKey(req) {
  return req.socket.remoteAddress || 'unknown';
}

function loginAllowed(req) {
  const key = rateLimitKey(req);
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 15 * 60 * 1000; }
  if (entry.count >= 10) return false;
  entry.count += 1;
  loginAttempts.set(key, entry);
  return true;
}

async function loadLatest(force = false) {
  if (!force && cachedData && cachedSha) return { data: cachedData, sha: cachedSha };
  const latest = await githubGet();
  cachedData = latest.data;
  cachedSha = latest.sha;
  return latest;
}

function queueWrite(data, message) {
  const job = writeQueue.then(async () => {
    let latest = await loadLatest(true);
    try {
      const clean = normalizeData(data);
      const result = await githubPut(clean, latest.sha, message);
      cachedData = clean;
      cachedSha = result?.content?.sha || null;
      if (!cachedSha) {
        const refreshed = await githubGet();
        cachedData = refreshed.data;
        cachedSha = refreshed.sha;
      }
      return result;
    } catch (error) {
      if (error.status !== 409) throw error;
      latest = await loadLatest(true);
      const clean = normalizeData(data);
      const result = await githubPut(clean, latest.sha, message);
      cachedData = clean;
      cachedSha = result?.content?.sha || null;
      return result;
    }
  });
  writeQueue = job.catch(() => {});
  return job;
}

function publicData(data) {
  const clean = normalizeData(data);
  delete clean.password;
  delete clean.passwordHash;
  return clean;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...securityHeaders(), ...corsHeaders(origin) });
    return res.end();
  }

  try {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;

    if (req.method === 'GET' && pathname === '/') {
      return send(res, 200, { ok: true, service: 'aroeira-gfitness-sync', version: '3.0.0' }, origin);
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      return send(res, 200, { ok: true, storageReady: STORAGE_MODE === 'local' || Boolean(GH_TOKEN), storage: STORAGE_MODE, cached: Boolean(cachedData && cachedSha), version: '3.0.0' }, origin);
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      if (!loginAllowed(req)) return send(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.' }, origin);
      const body = await readBody(req);
      const username = String(body.username || '');
      const password = String(body.password || '');
      if (username !== ADMIN_USER || !password) return send(res, 401, { ok: false, error: 'Usuário ou senha inválidos.' }, origin);
      const latest = await loadLatest(true);
      const stored = latest.data.passwordHash || latest.data.password || ADMIN_PASSWORD || '';
      if (!verifyPassword(password, stored)) return send(res, 401, { ok: false, error: 'Usuário ou senha inválidos.' }, origin);

      // Migra automaticamente a senha legada em texto para um hash.
      if (!ADMIN_PASSWORD && !latest.data.passwordHash) {
        const migrated = { ...latest.data, passwordHash: hashPassword(password) };
        delete migrated.password;
        migrated.lastUpdate = new Date().toISOString();
        await queueWrite(migrated, 'security: migrar credencial administrativa para hash');
      }

      const token = signToken({ sub: ADMIN_USER, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 });
      return send(res, 200, { ok: true, token, expiresIn: 8 * 60 * 60 }, origin);
    }

    if (req.method === 'GET' && pathname === '/api/sync') {
      if (!auth(req)) return send(res, 401, { ok: false, error: 'UNAUTHORIZED' }, origin);
      const result = await loadLatest();
      return send(res, 200, { ok: true, ...publicData(result.data) }, origin);
    }

    if (req.method === 'POST' && pathname === '/api/sync') {
      if (!auth(req)) return send(res, 401, { ok: false, error: 'UNAUTHORIZED' }, origin);
      const data = await readBody(req);
      if (!Array.isArray(data.students) || !Array.isArray(data.history)) {
        return send(res, 400, { ok: false, error: 'students e history são obrigatórios' }, origin);
      }
      const clean = normalizeData({ ...data, students: deduplicateExactStudents(data.students), lastUpdate: new Date().toISOString() });
      const current = await loadLatest(true);
      clean.passwordHash = current.data.passwordHash || undefined;
      await queueWrite(clean, 'data: atualização do sistema');
      return send(res, 200, { ok: true, lastUpdate: clean.lastUpdate, students: clean.students.length }, origin);
    }

    if (req.method === 'POST' && pathname === '/api/auth/change-password') {
      const session = auth(req);
      if (!session) return send(res, 401, { ok: false, error: 'UNAUTHORIZED' }, origin);
      const body = await readBody(req);
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 6) return send(res, 400, { ok: false, error: 'A nova senha precisa ter pelo menos 6 caracteres.' }, origin);
      const latest = await loadLatest(true);
      const stored = latest.data.passwordHash || latest.data.password || ADMIN_PASSWORD || '';
      if (!verifyPassword(currentPassword, stored)) return send(res, 401, { ok: false, error: 'Senha atual inválida.' }, origin);
      const updated = { ...latest.data, passwordHash: hashPassword(newPassword) };
      delete updated.password;
      updated.lastUpdate = new Date().toISOString();
      await queueWrite(updated, 'security: alteração da senha administrativa');
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { ok: false, error: 'NOT_FOUND' }, origin);
  } catch (error) {
    console.error('[api]', error.message, error.details || '');
    return send(res, error.status === 409 ? 409 : 500, { ok: false, error: error.status === 409 ? 'CONFLICT' : 'SERVER_ERROR' }, origin);
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;
server.listen(PORT, () => console.log(`Aroeira G Fitness API v3 ouvindo na porta ${PORT}`));
