const http = require('http');

const PORT = Number(process.env.PORT || 10000);
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = 'liderancaindigofabio-lab';
const GH_REPO = 'aroeiragfitness';
const GH_FILE = 'aroeira_data.json';
const GH_BRANCH = 'main';
const ALLOWED_ORIGIN = 'https://liderancaindigofabio-lab.github.io';

if (!GH_TOKEN) console.warn('[startup] GITHUB_TOKEN ausente');

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN || origin === 'http://localhost:3000' || origin === 'http://localhost:5500';
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function send(res, status, body, origin) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    ...corsHeaders(origin)
  });
  res.end(payload);
}

function githubUrl(path) {
  return `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
}

async function githubGet() {
  if (!GH_TOKEN) throw new Error('GITHUB_TOKEN ausente no servidor');
  const response = await fetch(`${githubUrl(GH_FILE)}?ref=${GH_BRANCH}&t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'aroeira-gfitness-sync' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`GitHub GET ${response.status}`);
  const file = await response.json();
  const content = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
  return { data: JSON.parse(content), sha: file.sha };
}

async function githubPut(data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64');
  const response = await fetch(githubUrl(GH_FILE), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'aroeira-gfitness-sync' },
    body: JSON.stringify({
      message: `sync: atualização ${new Date().toISOString()}`,
      content,
      branch: GH_BRANCH,
      sha
    })
  });
  if (!response.ok) throw new Error(`GitHub PUT ${response.status}`);
  return response.json();
}

// Mantém o SHA na memória para que cada salvamento não precise fazer
// GET + PUT no GitHub. O GitHub continua sendo o armazenamento persistente,
// mas o caminho normal fica muito mais rápido e serializado.
let cachedData = null;
let cachedSha = null;
let writeQueue = Promise.resolve();

async function loadLatest() {
  if (cachedData && cachedSha) return { data: cachedData, sha: cachedSha };
  const latest = await githubGet();
  cachedData = latest.data;
  cachedSha = latest.sha;
  return latest;
}

function queueWrite(data) {
  const job = writeQueue.then(async () => {
    let latest = await loadLatest();
    try {
      const result = await githubPut(data, latest.sha);
      cachedData = data;
      cachedSha = result.content && result.content.sha ? result.content.sha : null;
      // Se o retorno não trouxer SHA, força um GET antes do próximo PUT.
      if (!cachedSha) await loadLatest();
      return result;
    } catch (error) {
      // Se outra instância/tela salvou antes, recupera o SHA e tenta uma vez.
      if (!String(error.message).includes('409')) throw error;
      cachedData = null;
      cachedSha = null;
      latest = await loadLatest();
      const result = await githubPut(data, latest.sha);
      cachedData = data;
      cachedSha = result.content && result.content.sha ? result.content.sha : null;
      return result;
    }
  });
  writeQueue = job.catch(() => {});
  return job;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) reject(new Error('payload grande demais'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (_) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function validateData(data) {
  return Array.isArray(data.students) && Array.isArray(data.history);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  try {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    if (req.method === 'GET' && pathname === '/') {
      return send(res, 200, { ok: true, service: 'aroeira-gfitness-sync', version: '2.0.0', storage: 'github-persistent-cache' }, origin);
    }
    if (req.method === 'GET' && pathname === '/api/health') {
      return send(res, 200, { ok: true, storageReady: Boolean(cachedData && cachedSha), queue: 'serialized' }, origin);
    }
    if (req.method === 'GET' && pathname === '/api/sync') {
      const result = await loadLatest();
      return send(res, 200, { ok: true, ...result.data }, origin);
    }
    if (req.method === 'POST' && pathname === '/api/sync') {
      const data = await readBody(req);
      if (!validateData(data)) {
        return send(res, 400, { ok: false, error: 'students e history são obrigatórios' }, origin);
      }
      const clean = {
        students: data.students,
        history: data.history,
        password: typeof data.password === 'string' ? data.password : '123456',
        lastUpdate: new Date().toISOString()
      };
      await queueWrite(clean);
      return send(res, 200, { ok: true, lastUpdate: clean.lastUpdate, students: clean.students.length }, origin);
    }
    return send(res, 404, { ok: false, error: 'NOT_FOUND' }, origin);
  } catch (error) {
    console.error('[api]', error.message);
    return send(res, 500, { ok: false, error: 'SYNC_FAILED' }, origin);
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.listen(PORT, () => console.log(`Aroeira sync API v2 ouvindo na porta ${PORT}`));
