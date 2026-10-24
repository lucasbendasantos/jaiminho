'use strict';
// Executor gRPC: unário, server/client streaming e bidi; TLS/mTLS/SSL off; metadata; deadline; detalhes de erro; scripts.
const fs = require('fs');
const grpc = require('@grpc/grpc-js');
const protobuf = require('protobufjs');
const { getSchema, findMethod } = require('./schema');
const { jsonToMessage, messageToJson } = require('./json');
const { decodeStatusDetails } = require('./details');
const { runScript, hooksOf } = require('./script');
const { buildScopes, makeResolver } = require('../vars');
const { trustedCaPem, clientCertFor, certPassphrase } = require('../tls');

const STATUS_NAMES = Object.fromEntries(Object.entries(grpc.status).map(([k, v]) => [v, k]));

/** "grpcs://host:443", "grpc://host:50051", "host:50051", "dns:///host" → { target, tls, host, port } */
function parseTarget(url) {
  let u = String(url || '').trim();
  const un = (u.match(/\{\{([^{}]+)\}\}/g) || []);
  if (un.length) throw new Error(`Variável não definida no endereço: ${un.join(', ')}. Selecione um ambiente ou crie a variável.`);
  if (!u) throw new Error('Endereço do servidor vazio (ex.: grpc://localhost:50051)');
  let tls;
  const m = /^(grpcs?|https?):\/\//i.exec(u);
  if (m) { tls = /^(grpcs|https)$/i.test(m[1]); u = u.slice(m[0].length); }
  u = u.replace(/^dns:\/{0,3}/i, '');
  u = u.replace(/\/.*$/, '');
  let host; let portStr;
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(u);
  if (v6) { host = v6[1]; portStr = v6[2]; }
  else { const i = u.lastIndexOf(':'); if (i > 0 && /^\d+$/.test(u.slice(i + 1))) { host = u.slice(0, i); portStr = u.slice(i + 1); } else host = u; }
  const port = portStr ? Number(portStr) : (tls ? 443 : 80);
  if (tls === undefined) tls = port === 443;
  return { target: host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`, tls, host, port };
}

function pemFromPfx(pfxPath, passphrase) {
  const forge = require('node-forge');
  const der = fs.readFileSync(pfxPath).toString('binary');
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), passphrase || '');
  const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0] || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  return { key: Buffer.from(forge.pki.privateKeyToPem(keyBag.key)), cert: Buffer.from(certBags.map((b) => forge.pki.certificateToPem(b.cert)).join('\n')) };
}

/** Credenciais do canal conforme TLS, verificação SSL e certificado de cliente configurados. */
function channelCredentials(ws, parsed, tlsCfg = {}) {
  const useTls = tlsCfg.mode === 'plaintext' ? false : tlsCfg.mode === 'tls' ? true : parsed.tls;
  if (!useTls) return { credentials: grpc.credentials.createInsecure(), tls: false };
  const verify = tlsCfg.verifySsl !== undefined ? tlsCfg.verifySsl !== false : (ws ? ws.settings.verifySsl !== false : true);
  const ca = ws ? trustedCaPem(ws) : null;
  let key = null; let cert = null;
  const cc = ws && clientCertFor(ws, parsed.host, parsed.port);
  if (cc) {
    if (cc.pfx) { const p = pemFromPfx(ws.resolvePath(cc.pfx), certPassphrase(ws, cc)); key = p.key; cert = p.cert; }
    else { key = fs.readFileSync(ws.resolvePath(cc.key)); cert = fs.readFileSync(ws.resolvePath(cc.cert)); }
  }
  const verifyOptions = verify ? {} : { rejectUnauthorized: false, checkServerIdentity: () => undefined };
  return { credentials: grpc.credentials.createSsl(ca, key, cert, verifyOptions), tls: true, clientCert: cc ? (cc.name || cc.host) : undefined, verify };
}

function toMetadata(list, resolve) {
  const md = new grpc.Metadata();
  for (const h of list || []) {
    if (h.enabled === false || !h.key) continue;
    const k = String(resolve ? resolve(h.key) : h.key).toLowerCase().trim();
    const v = resolve ? resolve(String(h.value ?? '')) : String(h.value ?? '');
    if (k.endsWith('-bin')) md.add(k, Buffer.from(v, 'base64')); else md.add(k, v);
  }
  return md;
}
function mdToList(md) {
  if (!md) return [];
  const out = [];
  for (const [k, v] of Object.entries(md.getMap())) out.push({ key: k, value: Buffer.isBuffer(v) ? v.toString('base64') : String(v) });
  return out;
}

function channelOptions(ws, opts = {}) {
  const o = {
    'grpc.max_receive_message_length': opts.maxMessageBytes || 64 * 1024 * 1024,
    'grpc.max_send_message_length': opts.maxMessageBytes || 64 * 1024 * 1024,
    'grpc.primary_user_agent': 'Jaiminho/0.1',
  };
  if (opts.authority) { o['grpc.ssl_target_name_override'] = opts.authority; o['grpc.default_authority'] = opts.authority; }
  if (opts.keepaliveMs) o['grpc.keepalive_time_ms'] = opts.keepaliveMs;
  const proxy = ws && ws.settings.proxy;
  if (!proxy || proxy.mode === 'none') o['grpc.enable_http_proxy'] = proxy && proxy.mode === 'none' ? 0 : 1;
  if (opts.compression === 'gzip') o['grpc.default_compression_algorithm'] = 2;
  return o;
}

/** Contexto comum: variáveis resolvidas, credenciais, metadata, schema. */
async function prepare(ws, opts) {
  const req = opts.request;
  const g = req.grpc || {};
  const scopeItem = opts.requestId && ws && ws.index.has(opts.requestId) ? opts.requestId : opts.parentId;
  const scopes = ws ? buildScopes(ws, scopeItem, { environmentId: opts.environmentId, data: opts.data || {} }) : { globals: [], collection: [], environment: [], folderAndRequest: [], data: {}, local: {} };
  for (const v of req.vars || []) if (v.enabled !== false && v.key) scopes.folderAndRequest.push({ key: v.key, value: v.value });
  const toObj = (l) => Object.fromEntries((l || []).map((v) => [v.key, String(v.value ?? '')]));
  const scriptScopes = { environment: toObj(scopes.environment), collection: toObj(scopes.collection), globals: toObj(scopes.globals), local: { ...toObj(scopes.folderAndRequest), ...(opts.data || {}) } };
  return { req, g, scopes, scriptScopes };
}

function resolverFor(scopes, scriptScopes) {
  const merged = { ...scopes, environment: Object.entries(scriptScopes.environment).map(([key, value]) => ({ key, value })), collection: Object.entries(scriptScopes.collection).map(([key, value]) => ({ key, value })), globals: Object.entries(scriptScopes.globals).map(([key, value]) => ({ key, value })), local: scriptScopes.local };
  return makeResolver(merged);
}

/** Descobre serviços/métodos (para o seletor de método). */
async function describe(ws, opts) {
  const { req, g, scopes, scriptScopes } = await prepare(ws, opts);
  const resolve = resolverFor(scopes, scriptScopes);
  const parsed = parseTarget(resolve(req.url));
  const { credentials } = channelCredentials(ws, parsed, g.tls);
  const schema = await getSchema(ws, g.schema, { target: parsed.target, credentials, metadata: toMetadata(g.metadata, resolve), channelOptions: channelOptions(ws, g.options), cacheTag: JSON.stringify(g.tls || {}) }, { refresh: !!opts.refresh });
  return { services: schema.services, source: schema.source, reflectionVersion: schema.reflectionVersion, schema };
}

/**
 * Invoca o método. Para streaming do cliente/bidi, devolve { handle, done }: handle.write(json), handle.end(), handle.cancel().
 * Para unário/server stream, as mensagens do cliente vêm de request.grpc.message.
 */
function invoke(ws, opts) {
  const events = [];
  const emit = (type, data = {}) => { const e = { type, t: Date.now(), ...data }; events.push(e); try { opts.onEvent && opts.onEvent(e); } catch { /* ignore */ } };
  let call; let cancelled = false; let ended = false;
  const queue = [];
  let resolvedType; let registryRoot;
  const handle = {
    write(json) {
      if (!call) { queue.push(json); return; }
      try { const msg = jsonToMessage(resolvedType, typeof json === 'string' ? resolver(json) : json, registryRoot); call.write(msg); emit('sent-request-data', { message: messageToJson(resolvedType, msg, registryRoot) }); }
      catch (e) {
        emit('error', { message: `Mensagem inválida (não enviada): ${e.message}` });
        if (opts.autoEnd) { writeError = `Mensagem inválida: ${e.message}`; if (call) call.cancel(); }
      }
    },
    end() { ended = true; if (call && call.end) { call.end(); emit('half-close'); } },
    cancel() { cancelled = true; if (call) call.cancel(); },
  };
  let resolver = (s) => s; const tlsInfo = {};
  let writeError = null;

  const done = (async () => {
    const started = Date.now();
    const result = { ok: false, messages: [], tests: [], console: [], variablesChanged: [] };
    let ctx;
    try {
      ctx = await prepare(ws, opts);
      const { req, g, scopes, scriptScopes } = ctx;
      const hooks = hooksOf(req.scripts || {});
      const scriptBase = { scopes: scriptScopes, environmentName: scopes.environmentName, request: { name: req.name, url: req.url, method: g.method, metadata: g.metadata, message: g.message } };
      // beforeInvoke (coleção → pastas → request, como no Postman)
      const chain = ws && opts.requestId && ws.index.has(opts.requestId) ? ws.chain(opts.requestId).slice(0, -1) : [];
      for (const node of [...chain, { scripts: req.scripts }]) {
        const code = hooksOf(node.scripts || {}).beforeInvoke; if (!code) continue;
        const r = await runScript(code, { ...scriptBase, eventName: 'beforeInvoke' }); collect(result, r);
        if (r.error) throw new Error(`Script beforeInvoke: ${r.error}`);
      }
      resolver = resolverFor(scopes, scriptScopes);
      const parsed = parseTarget(resolver(req.url));
      const cred = channelCredentials(ws, parsed, g.tls); tlsInfo.tls = cred.tls !== undefined ? cred.tls : parsed.tls;
      const chOpts = channelOptions(ws, g.options);
      const metadata = toMetadata(g.metadata, resolver);
      const schema = await getSchema(ws, g.schema, { target: parsed.target, credentials: cred.credentials, metadata: toMetadata(g.metadata, resolver), channelOptions: chOpts, cacheTag: JSON.stringify(g.tls || {}) }, { refresh: !!opts.refreshSchema });
      registryRoot = schema.root;
      const method = findMethod(schema.root, g.method);
      resolvedType = method.resolvedRequestType;
      const outType = method.resolvedResponseType;
      const kind = method.requestStream && method.responseStream ? 'bidi' : method.requestStream ? 'client-stream' : method.responseStream ? 'server-stream' : 'unary';
      result.kind = kind; result.target = parsed.target; result.tls = cred.tls; result.clientCert = cred.clientCert;
      const svcName = method.parent.fullName.replace(/^\./, '');
      const Client = grpc.makeGenericClientConstructor({
        [method.name]: {
          path: `/${svcName}/${method.name}`, requestStream: !!method.requestStream, responseStream: !!method.responseStream,
          requestSerialize: (m) => Buffer.from(resolvedType.encode(m).finish()), responseDeserialize: (b) => outType.decode(b),
          requestDeserialize: (b) => resolvedType.decode(b), responseSerialize: (m) => Buffer.from(outType.encode(m).finish()),
        },
      }, svcName);
      const client = new Client(parsed.target, cred.credentials, chOpts);
      const deadlineMs = g.options && g.options.deadlineMs !== undefined ? Number(g.options.deadlineMs) : (kind === 'unary' ? 30000 : 0);
      const callOpts = deadlineMs > 0 ? { deadline: Date.now() + deadlineMs } : {};
      emit('invoke', { method: `${svcName}/${method.name}`, kind, target: parsed.target, tls: cred.tls });
      emit('sent-request-header', { metadata: mdToList(metadata) });

      const showDefaults = !!(g.options && g.options.showDefaults);
      const msgScripts = [];
      let firstMsgCache;
      const firstMessage = () => { if (!firstMsgCache) firstMsgCache = jsonToMessage(resolvedType, resolver(g.message || '{}'), registryRoot); return firstMsgCache; };
      const onMessage = (msg) => {
        const json = messageToJson(outType, msg, registryRoot, { defaults: showDefaults });
        const m = { data: json, timestamp: Date.now(), size: outType.encode(msg).finish().length };
        result.messages.push(m);
        emit('received-response-data', { message: json, size: m.size });
        const code = hooks.onIncomingMessage;
        if (code) msgScripts.push(runScript(code, { ...scriptBase, eventName: 'onIncomingMessage', message: { data: json } }).then((r) => collect(result, r, emit)));
      };

      const status = await new Promise((resolve) => {
        let headersSeen = false;
        const onMeta = (md) => { headersSeen = true; result.headers = mdToList(md); emit('received-response-header', { metadata: result.headers }); };
        const onStatus = (st) => resolve(st);
        if (kind === 'unary' || kind === 'client-stream') {
          const cb = (err, msg) => {
            if (msg) onMessage(msg);
            if (err) resolve({ code: err.code, details: err.details, metadata: err.metadata, error: err });
          };
          call = kind === 'unary' ? client[method.name](firstMessage(), metadata, callOpts, cb) : client[method.name](metadata, callOpts, cb);
        } else {
          call = kind === 'server-stream' ? client[method.name](firstMessage(), metadata, callOpts) : client[method.name](metadata, callOpts);
          call.on('data', onMessage);
          call.on('error', (err) => resolve({ code: err.code, details: err.details, metadata: err.metadata, error: err }));
        }
        call.on('metadata', onMeta);
        call.on('status', onStatus);
        if (kind === 'unary' || kind === 'server-stream') emit('sent-request-data', { message: messageToJson(resolvedType, firstMessage(), registryRoot) });
        if (kind === 'client-stream' || kind === 'bidi') {
          // mensagem inicial do editor (se houver) + fila; streams ficam abertos até end()
          const initial = (opts.initialMessages || []);
          for (const m of initial) handle.write(m);
          while (queue.length) handle.write(queue.shift());
          if (opts.autoEnd || ended) handle.end();
        }
        if (cancelled) call.cancel();
      });
      client.close();
      await Promise.all(msgScripts);
      result.status = { code: status.code, name: STATUS_NAMES[status.code] || String(status.code), details: status.details };
      result.trailers = mdToList(status.metadata);
      const detailsBin = status.metadata && status.metadata.get('grpc-status-details-bin')[0];
      if (detailsBin) result.status.errorDetails = decodeStatusDetails(detailsBin, registryRoot);
      result.ok = status.code === grpc.status.OK && !writeError;
      if (writeError) result.error = writeError;
      else if (!result.ok) result.error = humanGrpcError(status, tlsInfo);
      emit('status', { status: result.status, trailers: result.trailers });
      // afterResponse
      const response = { statusCode: status.code, status: result.status.name, responseTime: Date.now() - started, messagesList: result.messages.map((m) => ({ data: m.data, timestamp: m.timestamp })), metadataList: result.headers || [], trailersList: result.trailers || [] };
      for (const node of [...chain, { scripts: req.scripts }]) {
        const code = hooksOf(node.scripts || {}).afterResponse; if (!code) continue;
        collect(result, await runScript(code, { ...scriptBase, eventName: 'afterResponse', response }), emit);
      }
    } catch (e) {
      result.ok = false; result.error = humanGrpcError({ error: e, details: e.message, code: e.code }, tlsInfo);
      emit('error', { message: result.error });
    } finally {
      result.time = Date.now() - started;
      result.events = events;
      if (ws && ctx) persistVars(ws, opts, ctx.scriptScopes, ctx.scopes, result);
    }
    return result;
  })();
  return { handle, done };
}

function collect(result, r, emit) {
  result.tests.push(...r.tests); result.console.push(...r.console);
  if (emit) for (const t of r.tests) emit('test', t);
  if (r.error) result.console.push({ level: 'error', args: [`Erro no script: ${r.error}`] });
}

function persistVars(ws, opts, after, scopes, result) {
  const before = { environment: Object.fromEntries(scopes.environment.map((v) => [v.key, String(v.value)])), collection: Object.fromEntries(scopes.collection.map((v) => [v.key, String(v.value)])), globals: Object.fromEntries(scopes.globals.map((v) => [v.key, String(v.value)])) };
  const sync = (name, scopeKey) => { if (!scopeKey) return; for (const [k, v] of Object.entries(after[name])) if (before[name][k] !== v) { ws.setLocalValue(scopeKey, k, v); result.variablesChanged.push({ scope: name, key: k, value: v }); } };
  if (opts.environmentId) sync('environment', `env:${opts.environmentId}`);
  if (scopes.collectionId) sync('collection', `col:${scopes.collectionId}`);
  sync('globals', 'glo');
}

function humanGrpcError(st, cred) {
  const e = st.error || {};
  const msg = String(st.details || e.message || '');
  const code = st.code;
  if (/self[- ]signed|unable to verify|certificate verify failed|UNABLE_TO_VERIFY|unable to get local issuer/i.test(msg)) return `${STATUS_NAMES[code] || 'TLS'}: certificado do servidor não é confiável: adicione a CA em Configurações → Certificados ou desligue a verificação SSL (${msg})`;
  if (/certificate required|alert number 116|handshake/i.test(msg)) return `UNAVAILABLE: o servidor exige certificado de cliente (mTLS): configure em Configurações → Certificados (${msg})`;
  if (/ECONNREFUSED/i.test(msg)) return `UNAVAILABLE: conexão recusada (servidor desligado ou porta errada) (${msg})`;
  if (/No connection established|Failed to connect/i.test(msg)) return `UNAVAILABLE: não foi possível conectar. Verifique host/porta${cred && cred.tls === false ? '; se o servidor usa TLS, use grpcs:// (ou ligue o cadeado)' : cred && cred.tls ? '; se o servidor é plaintext, use grpc:// (ou desligue o cadeado)' : ''} (${msg})`;
  if (/wrong version number|packet length too long|http2.*protocol/i.test(msg)) return `UNAVAILABLE: TLS/plaintext trocados (use grpc:// para plaintext e grpcs:// para TLS) (${msg})`;
  if (code !== undefined && STATUS_NAMES[code]) return `${STATUS_NAMES[code]} (${code}): ${msg}`;
  return msg || 'Erro gRPC';
}

module.exports = { invoke, describe, parseTarget, channelCredentials, toMetadata, STATUS_NAMES };
