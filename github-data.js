'use strict';
/*
 * Copia comments.json, customers.json y comprobantes.json a una rama de GitHub
 * que no es main, para que sobrevivan al disco efímero de Render.
 * Solo usa el módulo https. Sin GITHUB_TOKEN no hace nada.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILES = ['comments.json', 'customers.json', 'comprobantes.json'];
const MAX_BODY = 1500000;

function create(options) {
  const opts = options || {};
  const token = String(opts.token != null ? opts.token : (process.env.GITHUB_TOKEN || '')).trim();
  const repo = String(opts.repo || process.env.GITHUB_REPO || 'mubdorex0-coder/Mundorex-').trim();
  const branch = String(opts.branch || process.env.GITHUB_DATA_BRANCH || 'datos').trim();
  const root = opts.root || __dirname;
  const request = opts.request || defaultRequest;
  const debounceMs = opts.debounceMs != null ? opts.debounceMs : 2000;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 8000;
  const tokenSet = !!token;
  const safeBranch = !!branch && branch.toLowerCase() !== 'main' && branch.toLowerCase() !== 'master';
  const enabled = tokenSet && safeBranch;
  const pending = new Set();
  let timer = null;
  let chain = Promise.resolve();
  let branchReady = false;

  if (tokenSet && !safeBranch) {
    console.error('GITHUB_DATA_BRANCH no puede ser main. No se guardan datos en esa rama.');
  }

  function safeMessage(err) {
    let msg = String((err && err.message) || err || 'error');
    if (token) msg = msg.split(token).join('[token]');
    return msg.slice(0, 240);
  }

  function repoPath() {
    const parts = repo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('GITHUB_REPO no es válido');
    return encodeURIComponent(parts[0]) + '/' + encodeURIComponent(parts[1]);
  }

  function enqueue(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }

  async function ensureBranch() {
    if (branchReady) return;
    const base = '/repos/' + repoPath();
    try {
      await request('GET', base + '/git/ref/heads/' + encodeURIComponent(branch), null, token);
      branchReady = true;
      return;
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    const main = await request('GET', base + '/git/ref/heads/main', null, token);
    const sha = main && main.object && main.object.sha;
    if (!sha) throw new Error('No se encontró la rama main');
    try {
      await request('POST', base + '/git/refs', { ref: 'refs/heads/' + branch, sha }, token);
    } catch (err) {
      if (err.status !== 422) throw err;
    }
    branchReady = true;
  }

  async function pullAll() {
    if (!enabled) return false;
    let aborted = false;
    let timerId;
    const work = (async () => {
      await ensureBranch();
      for (const name of FILES) {
        if (aborted) return false;
        try { await pullFile(name, () => aborted); }
        catch (err) {
          if (aborted) return false;
          console.error('No se pudo leer ' + name + ':', safeMessage(err));
        }
      }
      if (!aborted) console.log('Datos permanentes conectados a la rama ' + branch + '.');
      return true;
    })();
    const timeout = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        aborted = true;
        reject(new Error('tiempo de espera al cargar datos'));
      }, timeoutMs);
      if (timerId.unref) timerId.unref();
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timerId);
    }
  }

  async function pullFile(name, isAborted) {
    let cur;
    try {
      cur = await request('GET', '/repos/' + repoPath() + '/contents/' + encodeURIComponent(name) + '?ref=' + encodeURIComponent(branch), null, token);
    } catch (err) {
      if (err.status === 404) return;
      throw err;
    }
    if (isAborted()) return;
    if (!cur || !cur.content) return;
    const buf = Buffer.from(String(cur.content).replace(/\s/g, ''), 'base64');
    const parsed = JSON.parse(buf.toString('utf8'));
    if (!Array.isArray(parsed)) throw new Error(name + ' no es una lista');
    if (isAborted()) return;
    const dest = path.join(root, name);
    const tmp = dest + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, dest);
  }

  function schedule(name) {
    if (!enabled || FILES.indexOf(name) === -1) return;
    pending.add(name);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      kick();
    }, debounceMs);
    if (timer.unref) timer.unref();
  }

  function kick() {
    const names = Array.from(pending);
    pending.clear();
    if (!names.length) return chain;
    return enqueue(() => pushNames(names));
  }

  function flushNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    return kick();
  }

  async function pushNames(names) {
    try {
      await ensureBranch();
    } catch (err) {
      console.error('No se pudo preparar la rama de datos:', safeMessage(err));
      return;
    }
    for (const name of names) {
      try { await putFile(name, false); }
      catch (err) { console.error('No se pudo guardar ' + name + ':', safeMessage(err)); }
    }
  }

  async function putFile(name, retrying) {
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath);
    let sha = '';
    try {
      const cur = await request('GET', '/repos/' + repoPath() + '/contents/' + encodeURIComponent(name) + '?ref=' + encodeURIComponent(branch), null, token);
      sha = (cur && cur.sha) || '';
      if (cur && cur.content) {
        const remote = Buffer.from(String(cur.content).replace(/\s/g, ''), 'base64');
        if (remote.equals(raw)) return;
      }
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    const body = {
      message: 'Actualizar ' + name,
      content: raw.toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;
    try {
      await request('PUT', '/repos/' + repoPath() + '/contents/' + encodeURIComponent(name), body, token);
    } catch (err) {
      if (!retrying && (err.status === 409 || err.status === 422)) return putFile(name, true);
      throw err;
    }
  }

  return { enabled, tokenSet, pullAll, schedule, flushNow, safeMessage };
}

function defaultRequest(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'User-Agent': 'mundorex',
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { req.destroy(new Error('respuesta demasiado grande')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const text = Buffer.concat(chunks).toString('utf8');
          try { resolve(text ? JSON.parse(text) : {}); }
          catch (err) { reject(err); }
          return;
        }
        const err = new Error('GitHub respondió ' + res.statusCode);
        err.status = res.statusCode;
        reject(err);
      });
    });
    req.setTimeout(7000, () => req.destroy(new Error('tiempo de espera')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { create, FILES };
