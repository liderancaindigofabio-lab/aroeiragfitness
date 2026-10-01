'use strict';

const ALLOWED_ORIGIN = 'https://liderancaindigofabio-lab.github.io';
const USERNAME = 'Admin';
const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 1024 * 1024;
const VAULT_FORMAT = 'aroeira-gfitness-encrypted-backup';
const VAULT_VERSION = 1;
const VAULT_KDF = 'PBKDF2-SHA256';
const VAULT_ITERATIONS = 600000;

const encoder = new TextEncoder();

function cors(origin) {
  if (!origin || origin !== ALLOWED_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

function headers(origin) {
  return {
    ...cors(origin),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY'
  };
}

function response(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64(value) {
  try {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(normalized), ch => ch.charCodeAt(0));
  } catch { return new Uint8Array(); }
}

function hex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value));
}

function constantTimeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  let diff = left.length ^ right.length;
  const count = Math.max(left.length, right.length);
  for (let i = 0; i < count; i++) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}

async function passwordDigest(salt, password) {
  return hex(await sha256(`${salt}:${password}`));
}

async function requestBody(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  const text = await request.text();
  if (encoder.encode(text).length > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  try { return JSON.parse(text || '{}'); }
  catch { throw new Error('INVALID_JSON'); }
}

function validVaultRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.format !== VAULT_FORMAT || record.version !== VAULT_VERSION || record.kdf !== VAULT_KDF || Number(record.iterations) !== VAULT_ITERATIONS) return false;
  if (record.id && record.id !== 'main') return false;
  const salt = fromBase64(record.salt);
  const iv = fromBase64(record.iv);
  const ciphertext = fromBase64(record.ciphertext);
  return salt.length === 16 && iv.length === 12 && ciphertext.length >= 16;
}

async function getSession(request, db) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (token.length < 40 || token.length > 200) return null;
  const tokenHash = hex(await sha256(token));
  const now = Math.floor(Date.now() / 1000);
  const session = await db.prepare('SELECT token_hash, username, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(tokenHash, now).first();
  return session || null;
}

async function loginLimit(request, db) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = hex(await sha256(`aroeira-login:${ip}`));
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare('SELECT attempts, reset_at FROM login_attempts WHERE ip_hash = ?').bind(ipHash).first();
  if (row && row.reset_at > now && row.attempts >= 8) return { blocked: true, ipHash };
  await db.prepare(`INSERT INTO login_attempts (ip_hash, attempts, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(ip_hash) DO UPDATE SET
      attempts = CASE WHEN login_attempts.reset_at <= ? THEN 1 ELSE login_attempts.attempts + 1 END,
      reset_at = CASE WHEN login_attempts.reset_at <= ? THEN ? ELSE login_attempts.reset_at END`)
    .bind(ipHash, now + 900, now, now, now + 900).run();
  return { blocked: false, ipHash };
}

async function handle(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (origin && origin !== ALLOWED_ORIGIN) return response({ ok: false, error: 'FORBIDDEN_ORIGIN' }, 403, '');
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403, headers: headers('') });
    return new Response(null, { status: 204, headers: headers(origin) });
  }

  if (request.method === 'GET' && path === '/api/health') {
    await env.DB.prepare('SELECT 1 AS ok').first();
    return response({ ok: true, storage: 'cloudflare-d1-encrypted', version: '1.0.0' }, 200, origin);
  }

  if (request.method === 'POST' && path === '/api/auth/login') {
    const attempt = await loginLimit(request, env.DB);
    if (attempt.blocked) return response({ ok: false, error: 'RATE_LIMITED' }, 429, origin);
    const body = await requestBody(request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const admin = await env.DB.prepare('SELECT username, password_salt, password_hash FROM admin WHERE id = 1').first();
    const supplied = admin ? await passwordDigest(admin.password_salt, password) : '';
    if (!admin || username.toLowerCase() !== USERNAME.toLowerCase() || !password || !constantTimeEqual(supplied, admin.password_hash)) {
      return response({ ok: false, error: 'INVALID_CREDENTIALS' }, 401, origin);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash = ?').bind(attempt.ipHash).run();
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = base64url(tokenBytes);
    const tokenHash = hex(await sha256(token));
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('INSERT INTO sessions (token_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, USERNAME, now, now + TOKEN_TTL_SECONDS).run();
    return response({ ok: true, token, expiresIn: TOKEN_TTL_SECONDS }, 200, origin);
  }

  if (request.method === 'POST' && path === '/api/auth/logout') {
    const session = await getSession(request, env.DB);
    if (session) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.token_hash).run();
    return response({ ok: true }, 200, origin);
  }

  if (request.method === 'GET' && path === '/api/vault') {
    if (!await getSession(request, env.DB)) return response({ ok: false, error: 'UNAUTHORIZED' }, 401, origin);
    const row = await env.DB.prepare('SELECT record_json, revision, updated_at FROM vault WHERE id = ?').bind('main').first();
    if (!row) return response({ ok: true, record: null, revision: 0, updatedAt: null }, 200, origin);
    let record;
    try { record = JSON.parse(row.record_json); } catch { return response({ ok: false, error: 'VAULT_CORRUPT' }, 500, origin); }
    return response({ ok: true, record, revision: row.revision, updatedAt: row.updated_at }, 200, origin);
  }

  if (request.method === 'PUT' && path === '/api/vault') {
    if (!await getSession(request, env.DB)) return response({ ok: false, error: 'UNAUTHORIZED' }, 401, origin);
    const body = await requestBody(request);
    const expected = Number(body.expectedRevision);
    if (!Number.isSafeInteger(expected) || expected < 0 || !validVaultRecord(body.record)) return response({ ok: false, error: 'INVALID_VAULT' }, 400, origin);
    const serialized = JSON.stringify({ ...body.record, id: 'main' });
    const now = new Date().toISOString();
    if (expected === 0) {
      const result = await env.DB.prepare('INSERT INTO vault (id, record_json, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(id) DO NOTHING')
        .bind('main', serialized, now).run();
      if (Number(result.meta?.changes || 0) !== 1) return response({ ok: false, error: 'CONFLICT' }, 409, origin);
      return response({ ok: true, revision: 1, updatedAt: now }, 200, origin);
    }
    const result = await env.DB.prepare('UPDATE vault SET record_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
      .bind(serialized, now, 'main', expected).run();
    if (Number(result.meta?.changes || 0) !== 1) return response({ ok: false, error: 'CONFLICT' }, 409, origin);
    return response({ ok: true, revision: expected + 1, updatedAt: now }, 200, origin);
  }

  if (request.method === 'POST' && path === '/api/auth/change-password') {
    const session = await getSession(request, env.DB);
    if (!session) return response({ ok: false, error: 'UNAUTHORIZED' }, 401, origin);
    const body = await requestBody(request);
    const newPassword = String(body.newPassword || '');
    const expected = Number(body.expectedRevision);
    if (newPassword.length < 24 || !Number.isSafeInteger(expected) || expected < 1 || !validVaultRecord(body.record)) return response({ ok: false, error: 'INVALID_PASSWORD_OR_VAULT' }, 400, origin);
    const current = await env.DB.prepare('SELECT revision FROM vault WHERE id = ?').bind('main').first();
    if (!current || Number(current.revision) !== expected) return response({ ok: false, error: 'CONFLICT' }, 409, origin);
    const salt = base64url(crypto.getRandomValues(new Uint8Array(16)));
    const digest = await passwordDigest(salt, newPassword);
    const serialized = JSON.stringify({ ...body.record, id: 'main' });
    const now = new Date().toISOString();
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE vault SET record_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').bind(serialized, now, 'main', expected),
      env.DB.prepare(`UPDATE admin SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = 1
        AND EXISTS (SELECT 1 FROM vault WHERE id = 'main' AND revision = ? AND record_json = ?)`)
        .bind(salt, digest, now, expected + 1, serialized),
      env.DB.prepare('DELETE FROM sessions WHERE token_hash <> ?').bind(session.token_hash)
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) return response({ ok: false, error: 'CONFLICT' }, 409, origin);
    return response({ ok: true, revision: expected + 1, updatedAt: now }, 200, origin);
  }

  return response({ ok: false, error: 'NOT_FOUND' }, 404, origin);
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (error) {
      const code = error?.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : error?.message === 'INVALID_JSON' ? 'INVALID_JSON' : 'SERVER_ERROR';
      const status = code === 'PAYLOAD_TOO_LARGE' ? 413 : code === 'INVALID_JSON' ? 400 : 500;
      return response({ ok: false, error: code }, status, request.headers.get('Origin') || '');
    }
  }
};
