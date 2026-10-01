(() => {
  'use strict';

  const OWNER = 'liderancaindigofabio-lab';
  const REPO = 'aroeiragfitness-data';
  const FILE = 'aroeira_data.json';
  const BRANCH = 'main';
  const API_VERSION = '2022-11-28';
  const TOKEN_KEY = 'aroeiraGfitness.githubToken';
  const PENDING_KEY = 'aroeiraGfitness.pending';
  const CONTENTS_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

  let remoteSha = null;
  let remoteData = null;

  function token() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  }

  function setToken(value) {
    sessionStorage.setItem(TOKEN_KEY, value);
  }

  function clearToken() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    remoteSha = null;
    remoteData = null;
  }

  function makeError(message, status = 0, code = '') {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
  }

  async function githubFetch(url, options = {}, tokenValue = token()) {
    if (!tokenValue) throw makeError('Entre com o token do GitHub.', 401);
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('Authorization', `Bearer ${tokenValue}`);
    headers.set('X-GitHub-Api-Version', API_VERSION);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try { response = await fetch(url, { ...options, headers, signal: controller.signal, cache: 'no-store' }); }
    finally { clearTimeout(timer); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof body.message === 'string' ? body.message : `GitHub respondeu ${response.status}`;
      throw makeError(message, response.status, body.errors?.[0]?.code || '');
    }
    return body;
  }

  function decodeContent(content) {
    const binary = atob(String(content || '').replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function encodeContent(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function parsePending() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { raw = null; }
    if (!raw) return [];
    if (Array.isArray(raw.snapshots)) return raw.snapshots.filter(item => item && item.snapshot).map(item => ({ ...item, legacy: raw.version !== 2 || item.legacy === true }));
    if (Array.isArray(raw.students)) return [{ snapshot: raw, baseSha: raw.baseSha || null, createdAt: raw.createdAt || null, legacy: true }];
    return [{ snapshot: raw, baseSha: null, createdAt: null, legacy: true }];
  }

  function hasPending() {
    return parsePending().length > 0;
  }

  function appendPending(snapshot, baseSha, reason) {
    const snapshots = parsePending();
    snapshots.push({
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      baseSha: baseSha || null,
      createdAt: new Date().toISOString(),
      reason: String(reason || 'not-synchronized')
    });
    localStorage.setItem(PENDING_KEY, JSON.stringify({ version: 2, snapshots }));
  }

  async function readRemote(tokenValue = token()) {
    const body = await githubFetch(`${CONTENTS_URL}?ref=${encodeURIComponent(BRANCH)}`, {
      method: 'GET'
    }, tokenValue);
    if (!body || typeof body.sha !== 'string' || typeof body.content !== 'string') {
      throw makeError('O arquivo privado de dados não pôde ser lido.', 502);
    }
    let data;
    try { data = JSON.parse(decodeContent(body.content)); }
    catch { throw makeError('O arquivo de dados do GitHub não contém JSON válido.', 422); }
    if (!data || !Array.isArray(data.students)) {
      throw makeError('O arquivo de dados não possui a lista de alunos esperada.', 422);
    }
    return { sha: body.sha, data };
  }

  async function writeRemote(data, sha, tokenValue = token()) {
    const body = await githubFetch(CONTENTS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Sincronização Aroeira G Fitness ${new Date().toISOString()}`,
        content: encodeContent(`${JSON.stringify(data, null, 2)}\n`),
        sha,
        branch: BRANCH
      })
    }, tokenValue);
    if (!body?.content?.sha) throw makeError('O GitHub não confirmou a gravação dos dados.', 502);
    remoteSha = body.content.sha;
    remoteData = data;
    return { sha: remoteSha, data };
  }

  async function connect(tokenValue) {
    const value = String(tokenValue || '').trim();
    if (!value.startsWith('github_pat_')) {
      throw makeError('Use um token Fine-grained do GitHub (prefixo github_pat_).', 400);
    }
    const remote = await readRemote(value);
    setToken(value);
    remoteSha = remote.sha;
    remoteData = remote.data;
    return remote;
  }

  async function load() {
    const remote = await readRemote();
    remoteSha = remote.sha;
    remoteData = remote.data;
    return remote;
  }

  async function save(snapshot) {
    if (hasPending()) {
      appendPending(snapshot, remoteSha, 'existing-local-pending');
      return { ok: false, pending: true, sha: remoteSha, data: remoteData };
    }

    let current;
    try { current = await readRemote(); }
    catch (error) {
      appendPending(snapshot, remoteSha, 'github-unavailable');
      throw error;
    }

    if (remoteSha && current.sha !== remoteSha) {
      appendPending(snapshot, remoteSha, 'remote-version-changed');
      remoteSha = current.sha;
      remoteData = current.data;
      return { ok: false, conflict: true, sha: current.sha, data: current.data };
    }

    const nextData = {
      ...current.data,
      students: snapshot.students,
      history: snapshot.history,
      lastUpdate: new Date().toISOString()
    };

    try {
      const result = await writeRemote(nextData, current.sha);
      return { ok: true, sha: result.sha, data: result.data };
    } catch (error) {
      if (error.status === 409 || error.status === 422) {
        appendPending(snapshot, current.sha, 'github-write-conflict');
        try {
          const latest = await readRemote();
          remoteSha = latest.sha;
          remoteData = latest.data;
          return { ok: false, conflict: true, sha: latest.sha, data: latest.data };
        } catch {}
      }
      appendPending(snapshot, current.sha, 'github-write-failed');
      throw error;
    }
  }

  async function sync() {
    const remote = await load();
    const pending = parsePending();
    if (!pending.length) return { ...remote, pendingConflict: false, pendingSynced: false };

    const canReplay = pending.every(item =>
      !item.legacy && item.baseSha && item.baseSha === remote.sha &&
      item.snapshot && Array.isArray(item.snapshot.students) &&
      Array.isArray(item.snapshot.history)
    );

    if (!canReplay) return { ...remote, pendingConflict: true, pendingSynced: false };

    const latestSnapshot = pending[pending.length - 1].snapshot;
    const nextData = {
      ...remote.data,
      students: latestSnapshot.students,
      history: latestSnapshot.history,
      lastUpdate: new Date().toISOString()
    };

    try {
      const result = await writeRemote(nextData, remote.sha);
      localStorage.removeItem(PENDING_KEY);
      return { ...result, pendingConflict: false, pendingSynced: true };
    } catch (error) {
      if (error.status === 409 || error.status === 422) {
        const latest = await load();
        return { ...latest, pendingConflict: true, pendingSynced: false };
      }
      throw error;
    }
  }

  function exportPending() {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    return raw;
  }

  function clearPending() {
    localStorage.removeItem(PENDING_KEY);
  }

  window.AGFStorage = {
    token,
    clearToken,
    connect,
    load,
    save,
    sync,
    hasPending,
    exportPending,
    clearPending
  };
})();
