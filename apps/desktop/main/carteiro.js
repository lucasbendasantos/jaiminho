'use strict';
// "Carteiro": utility process que executa tudo do motor (disco do workspace, envios, gRPC, import/export).
// Se travar ou cair, o main recria; a janela continua respondendo.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const E = require('@jaiminho/engine');

let key; let userData; let ws = null; let mocks = null;
const execs = new Map(); // execId → { cancel, handle }
const proxyWaits = new Map(); let proxySeq = 0;

const post = (m) => process.parentPort.postMessage(m);
const emit = (event) => post({ type: 'event', event });

// AES-256-GCM com a chave protegida pelo safeStorage do main
const cipher = {
  encrypt(s) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64'); },
  decrypt(b) { const buf = Buffer.from(String(b), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28)); return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'); },
};

function globalsFile() { return path.join(userData, 'globals.yaml'); }
function settingsFile() { return path.join(userData, 'app-settings.json'); }
function appSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return { recent: [], theme: 'padrao' }; } }
function saveAppSettings(s) { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); return s; }
function remember(dir, name) { const s = appSettings(); s.recent = [{ dir, name, at: Date.now() }, ...(s.recent || []).filter((r) => r.dir !== dir)].slice(0, 12); s.lastWorkspace = dir; saveAppSettings(s); }

function need() { if (!ws) throw new Error('Nenhum workspace aberto'); return ws; }
E.sandboxPool.configure({ idleMs: 15 * 60 * 1000 }); // processo longo: mantém o motor de scripts quente
function openWs(dir) { ws = E.Workspace.open(dir, { cipher, globalsFile: globalsFile() }); remember(ws.dir, ws.name); E.sandboxPool.warmUp(); return summary(); }
function summary() { return { dir: ws.dir, name: ws.name, settings: ws.settings, tree: ws.tree(), missingSecrets: ws.missingSecrets(), problems: ws.problems || [] }; }

/** systemProxy para o postman-runtime: pergunta ao main (Chromium resolve PAC/WPAD do Windows). */
function systemProxy(url, cb) {
  const id = ++proxySeq; proxyWaits.set(id, (res) => {
    const m = /^PROXY\s+([^:;\s]+):(\d+)/i.exec(res || '');
    if (!m) return cb(null, undefined);
    const sdk = require('postman-collection');
    cb(null, new sdk.ProxyConfig({ host: m[1], port: Number(m[2]), match: 'http+https://*/*', tunnel: true }));
  });
  post({ type: 'proxy-req', id, url });
  setTimeout(() => { const f = proxyWaits.get(id); if (f) { proxyWaits.delete(id); f(null); } }, 3000);
}

function effectiveFor(itemId, environmentId, draft) {
  const scopes = E.vars.buildScopes(need(), itemId && ws.index.has(itemId) ? itemId : undefined, { environmentId });
  for (const v of (draft && draft.vars) || []) if (v.enabled !== false && v.key) scopes.folderAndRequest.push({ key: v.key, value: v.value, source: 'request' });
  return E.vars.effectiveList(scopes).map((v) => ({ ...v, value: v.secret ? '••••••' : v.value }));
}

function readMaybeFile(p) { return fs.readFileSync(p); }

/** Se sobrou {{variável}} sem valor, explica isso no erro (em vez de um "DNS" enganoso). */
function explainUnresolved(w, res, { requestId, request, parentId, environmentId }) {
  try {
    let names = [];
    try {
      const r = E.resolveRequest(w, request, { requestId, parentId, environmentId });
      names = E.vars.unresolved([r.url, ...(r.headers || []).map((h) => h.value), ...((r.grpc && r.grpc.metadata) || []).map((h) => h.value), JSON.stringify(r.auth || {})].join('\n'));
    } catch { /* cai para o texto enviado */ }
    if (!names.length) {
      const sent = res.request ? [res.request.url, ...(res.request.headers || []).map((h) => h.value)].join('\n') : '';
      names = E.vars.unresolved(sent);
    }
    names = names.filter((n) => !n.startsWith('$'));
    if (!names.length) return;
    res.unresolved = names;
    const envName = environmentId ? (w.listEnvironments().find((e) => e.id === environmentId) || {}).name : null;
    const msg = `Variável não definida: ${names.map((n) => `{{${n}}}`).join(', ')}. ${envName ? `Ela não existe no ambiente "${envName}" nem na coleção/globais.` : 'Nenhum ambiente está selecionado: escolha um no topo ou crie a variável.'}`;
    if (!res.ok) res.error = `${msg}\n\nErro original: ${res.error || ''}`;
    else res.warnings = [...(res.warnings || []), msg];
  } catch { /* ignore */ }
}

const ops = {
  // ---------- app ----------
  'app:settings': () => appSettings(),
  'app:saveSettings': (patch) => saveAppSettings({ ...appSettings(), ...patch }),
  'app:recent': () => (appSettings().recent || []).filter((r) => fs.existsSync(path.join(r.dir, 'jaiminho.yaml'))),

  // ---------- workspace ----------
  'ws:open': ({ dir }) => openWs(dir),
  'ws:create': ({ dir, name }) => { E.Workspace.create(dir, name); return openWs(dir); },
  'ws:isWorkspace': ({ dir }) => E.Workspace.isWorkspace(dir),
  'ws:current': () => (ws ? summary() : null),
  'ws:reload': () => { need().reload(); return summary(); },
  'ws:tree': () => need().tree(),
  'ws:rename': ({ name }) => { need().rename(name); remember(ws.dir, name); return summary(); },
  'ws:saveSettings': (patch) => need().saveSettings(patch),
  'ws:close': () => { ws = null; const s = appSettings(); delete s.lastWorkspace; saveAppSettings(s); return true; },

  // ---------- itens ----------
  'item:get': ({ id }) => need().get(id),
  'item:info': ({ id }) => { const n = need().info(id); return n ? { type: n.type, parentId: n.parentId, collectionId: n.collectionId, file: n.file } : null; },
  'item:save': ({ id, data }) => { need().save(id, data); return ws.get(id); },
  'item:createCollection': ({ name, data }) => need().createCollection(name, data || {}),
  'item:createFolder': ({ parentId, name }) => need().createFolder(parentId, name),
  'item:createRequest': ({ parentId, data }) => need().createRequest(parentId, data),
  'item:remove': ({ id }) => { need().remove(id); return true; },
  'item:duplicate': ({ id }) => need().duplicate(id),
  'item:move': ({ id, parentId, index }) => { need().move(id, parentId, index); return true; },
  'item:chain': ({ id }) => need().chain(id).map((n) => ({ id: n.id, type: n.type, name: n.name, auth: n.auth })),
  'collection:saveVars': ({ id, vars }) => { need().saveCollectionVars(id, vars); return ws.get(id); },

  // ---------- variáveis ----------
  'env:list': () => need().listEnvironments(),
  'env:get': ({ id }) => need().getEnvironment(id),
  'env:save': (env) => need().saveEnvironment(env),
  'env:remove': ({ id }) => { need().remove(id); return true; },
  'env:duplicate': ({ id }) => need().duplicate(id),
  'globals:get': () => need().getGlobals(),
  'globals:save': ({ vars }) => { need().saveGlobals(vars); return ws.getGlobals(); },
  'locals:get': () => need().getLocalValues(),
  'locals:set': ({ scope, key: k, value }) => { need().setLocalValue(scope, k, value); return true; },
  'locals:clear': ({ scope }) => { need().clearLocalValues(scope); return true; },
  'secret:set': ({ key: k, value }) => { need().setSecret(k, value); return true; },
  'secret:get': ({ key: k }) => need().getSecret(k),
  'secret:has': ({ key: k }) => need().getSecret(k) !== undefined,
  'secret:missing': () => need().missingSecrets(),
  'vars:effective': ({ itemId, environmentId, draft }) => effectiveFor(itemId, environmentId, draft),

  // ---------- envio ----------
  'exec:send': async ({ execId, requestId, request, parentId, environmentId }) => {
    const w = need();
    const ac = new AbortController();
    const entry = { cancel: () => ac.abort() };
    execs.set(execId, entry);
    const onEvent = (e) => emit({ type: 'exec:event', execId, event: e });
    try {
      let res;
      if (request.kind === 'grpc') {
        const inv = E.grpc.invoke(w, { requestId, request, parentId, environmentId, onEvent, autoEnd: false, initialMessages: [] });
        entry.handle = inv.handle; entry.cancel = () => inv.handle.cancel();
        // unário/server-stream: começam sozinhos. client-stream/bidi: a UI manda write/end.
        res = await inv.done;
      } else {
        res = await E.send(w, { requestId, request, parentId, environmentId, onEvent, signal: ac.signal, systemProxy });
      }
      explainUnresolved(w, res, { requestId, request, parentId, environmentId });
      try { w.addHistory({ requestId, name: request.name, kind: request.kind, method: request.kind === 'grpc' ? request.grpc?.method : request.method, url: request.url, environmentId, ok: res.ok, code: res.response ? res.response.code : res.status ? res.status.name : undefined, time: res.time, request }); } catch { /* ignore */ }
      return res;
    } finally { execs.delete(execId); }
  },
  'exec:cancel': ({ execId }) => { const e = execs.get(execId); if (e) e.cancel(); return !!e; },
  'grpc:write': ({ execId, message }) => { const e = execs.get(execId); if (!e || !e.handle) throw new Error('Stream não está aberto'); e.handle.write(message); return true; },
  'grpc:end': ({ execId }) => { const e = execs.get(execId); if (e && e.handle) e.handle.end(); return !!e; },
  'grpc:describe': async ({ request, requestId, environmentId, refresh }) => { const d = await E.grpc.describe(need(), { request, requestId, environmentId, refresh }); return { services: d.services, source: d.source, reflectionVersion: d.reflectionVersion }; },
  'grpc:sample': async ({ request, requestId, environmentId, method }) => {
    const d = await E.grpc.describe(need(), { request, requestId, environmentId });
    const m = E.grpc.findMethod(d.schema.root, method);
    return JSON.stringify(E.grpc.sample(m.resolvedRequestType), null, 2);
  },
  'grpc:freeze': async ({ request, requestId, environmentId, name }) => {
    const d = await E.grpc.describe(need(), { request, requestId, environmentId, refresh: true });
    const rel = path.join('protos', '_frozen', `${(name || 'schema').replace(/[^a-z0-9_.-]+/gi, '_')}.protoset`);
    const full = path.join(ws.dir, rel); fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, E.grpc.toProtoset(d.schema));
    return rel.split(path.sep).join('/');
  },
  'grpc:listProtos': () => { const dir = path.join(need().dir, 'protos'); const out = []; const walk = (d) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(proto|protoset|pb)$/.test(f)) out.push(path.relative(ws.dir, p).split(path.sep).join('/')); } }; walk(dir); return out; },
  'grpc:addProto': ({ file }) => {
    if (/\.proto$/i.test(file)) return E.grpc.addProtoToWorkspace(need().dir, file);
    const dest = path.join(need().dir, 'protos', path.basename(file)); fs.mkdirSync(path.dirname(dest), { recursive: true }); if (path.resolve(file) !== path.resolve(dest)) fs.copyFileSync(file, dest); return [path.relative(ws.dir, dest).split(path.sep).join('/')];
  },

  // ---------- histórico e cookies ----------
  'history:list': () => need().listHistory(300),
  'history:clear': () => { need().clearHistory(); return true; },
  'cookies:list': () => E.cookies.list(need()),
  'cookies:clear': ({ domain } = {}) => { E.cookies.clear(need(), domain); return true; },

  // ---------- import/export ----------
  'io:import': async ({ text, file, url, parentId, environmentId, createEnvironments }) => {
    const w = need();
    const args = { parentId, environmentId, createEnvironments };
    if (url) args.url = url;
    else if (file) { args.buffer = readMaybeFile(file); args.fileName = file; }
    else args.text = text;
    const r = await E.importAuto(w, args);
    return { ...r, tree: w.tree(), missingSecrets: w.missingSecrets() };
  },
  'io:previewBundle': async ({ file }) => E.bundle.previewBundle(fs.readFileSync(file)),
  'io:exportBundle': async ({ scope, file }) => { fs.writeFileSync(file, await E.bundle.exportBundle(need(), scope)); return file; },
  'io:exportPostman': ({ id, file }) => { fs.writeFileSync(file, JSON.stringify(E.postman.exportCollection(need(), id), null, 2)); return file; },
  'io:exportEnvironment': ({ id, file }) => { fs.writeFileSync(file, JSON.stringify(E.postman.exportEnvironment(need(), id), null, 2)); return file; },
  'io:curl': async ({ request, requestId, parentId, environmentId, flavor, resolve = true }) => {
    const r = resolve ? E.resolveRequest(need(), request, { requestId, parentId, environmentId }) : request;
    if (r.kind === 'grpc') return E.grpcurl.exportGrpcurl(r, { flavor, multiLine: true });
    return E.curl.exportCurl(r, { flavor });
  },
  'io:codegen': async ({ request, requestId, parentId, environmentId, language, variant }) => E.curl.generate(E.resolveRequest(need(), request, { requestId, parentId, environmentId }), language, variant, { followRedirect: true }),
  'io:languages': () => E.curl.languages(),
  'io:parseCurl': async ({ text }) => {
    if (E.grpcurl.isGrpcurl(text)) return { request: E.grpcurl.importGrpcurl(text) };
    return E.curl.importCurl(text);
  },
  'io:syncOpenApi': async ({ id, apply }) => E.openapi.syncOpenApi(need(), id, { fetchText: E.fetchTextVia(ws), apply }),

  // ---------- runner ----------
  'runner:start': async ({ runId, id, environmentId, iterations, dataFile, delayMs, stopOnFailure }) => {
    const data = dataFile ? E.parseDataFile(fs.readFileSync(dataFile, 'utf8'), dataFile) : undefined;
    return E.runCollection(need(), { id, environmentId, iterations, data, delayMs, stopOnFailure, onEvent: (e) => emit({ type: 'runner:event', runId, event: e }) });
  },
  'runner:junit': ({ report, file, name }) => { fs.writeFileSync(file, E.junitReport(report, name)); return file; },

  // ---------- XML ----------
  'xml:pretty': ({ text }) => E.xml.pretty(text),
  'xml:xpath': ({ text, expr }) => E.xml.evaluate(text, expr),

  // ---------- mocks ----------
  'mocks:status': () => (mocks ? { running: true, urls: mocks.urls, certs: mocks.certs, secrets: mocks.secrets, proto: mocks.proto } : { running: false }),
  'mocks:start': async () => {
    if (mocks) return ops['mocks:status']();
    const { startAll } = require('@jaiminho/mocks');
    mocks = await startAll({ fixed: true, certDir: path.join(userData, 'mock-certs') });
    return ops['mocks:status']();
  },
  'mocks:stop': async () => { if (mocks) { await mocks.close(); mocks = null; } return { running: false }; },
  'example:create': async ({ dir }) => {
    const st = await ops['mocks:start']();
    const { createExample } = require('./example');
    await createExample(E, dir, st, { cipher, globalsFile: globalsFile() });
    return openWs(dir);
  },
};

process.parentPort.on('message', async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    key = Buffer.from(msg.key, 'base64'); userData = msg.userData;
    const last = appSettings().lastWorkspace;
    if (last && fs.existsSync(path.join(last, 'jaiminho.yaml'))) { try { openWs(last); } catch { /* ignore */ } }
    return post({ type: 'ready' });
  }
  if (msg.type === 'proxy-res') { const f = proxyWaits.get(msg.id); if (f) { proxyWaits.delete(msg.id); f(msg.result); } return; }
  if (msg.type !== 'call') return;
  const fn = ops[msg.op];
  try {
    if (!fn) throw new Error(`Operação desconhecida: ${msg.op}`);
    const result = await fn(msg.args || {});
    post({ id: msg.id, result });
  } catch (err) {
    post({ id: msg.id, error: String((err && err.message) || err), stack: err && err.stack });
  }
});

process.on('uncaughtException', (err) => { console.error('uncaught', err); });
process.on('unhandledRejection', (err) => { console.error('unhandled', err); });
