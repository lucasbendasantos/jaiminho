'use strict';
// Motor do Jaiminho: fachada usada pelo app desktop, pela CLI e pelos testes.
const fs = require('fs');
const path = require('path');
const { Workspace, plainCipher, SECRET_MASK } = require('./store');
const model = require('./model');
const { sendHttp, listCookies, clearCookies } = require('./http');
const { buildScopes, effectiveList, makeResolver, unresolved } = require('./vars');
const grpcClient = require('./grpc/client');
const { sample } = require('./grpc/sample');
const { toProtoset, findMethod, clearCache, addProtoToWorkspace } = require('./grpc/schema');
const xml = require('./xml');
const postman = require('./io/postman');
const curl = require('./io/curl');
const openapi = require('./io/openapi');
const wsdl = require('./io/wsdl');
const grpcurl = require('./io/grpcurl');
const bundle = require('./io/bundle');
const { clone } = require('./util');

/** Busca texto por HTTP usando o próprio motor (proxy, TLS, certificados do workspace). */
function fetchTextVia(ws, opts = {}) {
  return async (url) => {
    const r = await sendHttp(ws, { request: model.newRequest({ name: 'fetch', method: 'GET', url, headers: opts.headers || [], settings: opts.settings || {} }), environmentId: opts.environmentId });
    if (!r.response) throw new Error(r.error || `Falha ao baixar ${url}`);
    return { status: r.response.code, body: r.response.body, contentType: r.response.contentType };
  };
}

/** Copia a request com {{variáveis}} resolvidas (para cURL, grpcurl, código). */
function resolveRequest(ws, req, { requestId, parentId, environmentId } = {}) {
  const scopes = buildScopes(ws, requestId && ws.index.has(requestId) ? requestId : parentId, { environmentId });
  for (const v of req.vars || []) if (v.enabled !== false && v.key) scopes.folderAndRequest.push({ key: v.key, value: v.value });
  const r = makeResolver(scopes);
  const walk = (o) => (typeof o === 'string' ? r(o) : Array.isArray(o) ? o.map(walk) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)])) : o);
  const out = walk(clone(req));
  // auth herdada → materializa (para o cURL sair com o header certo)
  if (!out.auth || out.auth.type === 'inherit') {
    const chain = requestId && ws.index.has(requestId) ? ws.chain(requestId).slice(0, -1).reverse() : [];
    const inherited = chain.find((n) => n.auth && n.auth.type && n.auth.type !== 'inherit');
    if (inherited) out.auth = walk(clone(inherited.auth));
  }
  return out;
}

/** Envia qualquer request (HTTP, SOAP, gRPC unário/server-stream). */
async function send(ws, opts) {
  const req = opts.request || ws.get(opts.requestId);
  if (req.kind === 'grpc') {
    const { done } = grpcClient.invoke(ws, { ...opts, request: req, autoEnd: true, initialMessages: opts.initialMessages || (req.grpc && req.grpc.message ? [req.grpc.message] : []) });
    return done;
  }
  const res = await sendHttp(ws, { ...opts, request: opts.request });
  if (req.kind === 'soap' && res.response) {
    res.soapFault = xml.soapFault(res.response.body);
    if (req.settings && req.settings.validateXsd && req.soap && req.soap.wsdl) {
      try {
        const text = fs.readFileSync(ws.resolvePath(req.soap.wsdl), 'utf8');
        const schemas = wsdl.extractXsd(text).map((c, i) => ({ fileName: `schema${i}.xsd`, contents: c }));
        const reqBody = xml.soapBody(res.request ? res.request.body : req.body.raw);
        const resBody = xml.soapBody(res.response.body);
        res.xsd = {};
        if (schemas.length && reqBody) res.xsd.request = await xml.validateXsd(reqBody, schemas);
        if (schemas.length && resBody && !res.soapFault) res.xsd.response = await xml.validateXsd(resBody, schemas);
      } catch (e) { res.xsd = { error: String(e.message || e) }; }
    }
  }
  return res;
}

/** Collection Runner: roda pasta/coleção em ordem, com iterações e arquivo de dados (CSV/JSON). */
async function runCollection(ws, { id, environmentId, iterations = 1, data, delayMs = 0, stopOnFailure = false, onEvent } = {}) {
  const ids = [];
  const collect = (nid) => { const n = ws.info(nid); if (n.type === 'request') ids.push(nid); else for (const c of ws.children(nid)) collect(c); };
  collect(id);
  const rows = data && data.length ? data : Array.from({ length: iterations }, () => ({}));
  const report = { startedAt: new Date().toISOString(), iterations: rows.length, results: [], totals: { requests: 0, failed: 0, tests: 0, testsFailed: 0 } };
  outer: for (let it = 0; it < rows.length; it++) {
    for (const rid of ids) {
      const req = ws.get(rid);
      onEvent && onEvent({ type: 'item-start', iteration: it, id: rid, name: req.name });
      const res = await send(ws, { requestId: rid, environmentId, data: rows[it] });
      const tests = res.tests || [];
      const failed = !res.ok || tests.some((t) => !t.passed);
      const row = { iteration: it, id: rid, name: req.name, kind: req.kind, ok: res.ok, code: res.response ? res.response.code : res.status ? res.status.name : undefined, time: res.time, error: res.error, tests };
      report.results.push(row);
      report.totals.requests++; if (failed) report.totals.failed++;
      report.totals.tests += tests.length; report.totals.testsFailed += tests.filter((t) => !t.passed).length;
      onEvent && onEvent({ type: 'item-done', ...row });
      if (failed && stopOnFailure) break outer;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

/** CSV (vírgula, ponto-e-vírgula ou tab; aspas com quebra de linha) ou JSON → linhas de dados do runner. */
function parseDataFile(text, fileName = '') {
  const t = String(text || '').replace(/^\uFEFF/, '');
  if (fileName.endsWith('.json') || /^\s*\[/.test(t)) return JSON.parse(t);
  const firstLine = t.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some((x) => x !== '')) rows.push(row); }
  const head = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

function junitReport(report, name = 'Jaiminho') {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const cases = report.results.map((r) => {
    const fails = r.tests.filter((t) => !t.passed);
    const err = !r.ok ? `<failure message="${esc(r.error || 'falhou')}"/>` : fails.map((f) => `<failure message="${esc(f.name)}: ${esc(f.error)}"/>`).join('');
    return `  <testcase classname="${esc(name)}" name="${esc(r.name)} [it ${r.iteration + 1}]" time="${(r.time || 0) / 1000}">${err}</testcase>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${esc(name)}" tests="${report.totals.requests}" failures="${report.totals.failed}">\n${cases}\n</testsuite>\n`;
}

/** Detecta e importa: cURL, grpcurl, coleção/ambiente/backup Postman, Swagger/OpenAPI, WSDL, bundle .jaiminho. */
async function importAuto(ws, { text, buffer, fileName = '', url, parentId, environmentId, name, createEnvironments } = {}) {
  if (url) {
    const fetchText = fetchTextVia(ws, { environmentId });
    if (/[?&](single)?wsdl\b|\.wsdl$/i.test(url)) { const r = await fetchText(url); return { type: 'wsdl', ...wsdl.importWsdl(ws, r.body, { sourceUrl: url, name }) }; }
    try { return { type: 'openapi', ...(await openapi.importOpenApi(ws, { url, fetchText }, { name, createEnvironments })) }; } catch (e) {
      const r = await fetchText(url).catch(() => null);
      if (r && /<(\w+:)?definitions\b[\s\S]*schemas\.xmlsoap\.org\/wsdl/.test(r.body || '')) return { type: 'wsdl', ...wsdl.importWsdl(ws, r.body, { sourceUrl: url, name }) };
      throw e;
    }
  }
  if (buffer && (fileName.endsWith('.jaiminho') || (buffer[0] === 0x50 && buffer[1] === 0x4b))) return { type: 'bundle', ...(await bundle.importBundle(ws, buffer)) };
  const t = text !== undefined ? String(text) : buffer ? buffer.toString('utf8') : '';
  if (curl.isCurl(t)) {
    const { request, extras } = await curl.importCurl(t);
    const target = parentId || ensureScratchCollection(ws);
    const id = ws.createRequest(target, request);
    return { type: 'curl', requestId: id, extras };
  }
  if (grpcurl.isGrpcurl(t)) { const target = parentId || ensureScratchCollection(ws); return { type: 'grpcurl', requestId: ws.createRequest(target, grpcurl.importGrpcurl(t)) }; }
  if (/<(\w+:)?definitions\b[\s\S]*schemas\.xmlsoap\.org\/wsdl/.test(t)) return { type: 'wsdl', ...wsdl.importWsdl(ws, t, { name }) };
  const trimmed = t.trim();
  let json; try { json = trimmed.startsWith('{') || trimmed.startsWith('[') ? JSON.parse(trimmed) : undefined; } catch { json = undefined; }
  if (json && (json.openapi || json.swagger)) return { type: 'openapi', ...(await openapi.importOpenApi(ws, { text: trimmed, baseDir: fileName ? require('path').dirname(fileName) : undefined }, { name, createEnvironments })) };
  if (json && postman.detect(json)) return postman.importAny(ws, json, { name });
  if (!json && /^(openapi|swagger)\s*:/m.test(trimmed)) return { type: 'openapi', ...(await openapi.importOpenApi(ws, { text: trimmed, baseDir: fileName ? require('path').dirname(fileName) : undefined }, { name, createEnvironments })) };
  throw new Error('Formato não reconhecido. Aceito: cURL, grpcurl, coleção/ambiente/backup do Postman, Swagger/OpenAPI (JSON/YAML), WSDL, bundle .jaiminho');
}

function ensureScratchCollection(ws) {
  for (const [id, n] of ws.index) if (n.type === 'collection' && ws.get(id).name === 'Rascunhos') return id;
  return ws.createCollection('Rascunhos', { description: 'Requests coladas (cURL/grpcurl) e avulsas' });
}

module.exports = {
  Workspace, plainCipher, SECRET_MASK, model,
  sandboxPool: require('./sandbox-pool'),
  send, sendHttp, runCollection, parseDataFile, junitReport,
  grpc: { ...grpcClient, sample, toProtoset, findMethod, clearCache, addProtoToWorkspace },
  xml, postman, curl, openapi, wsdl, grpcurl, bundle,
  vars: { buildScopes, effectiveList, makeResolver, unresolved },
  cookies: { list: listCookies, clear: clearCookies },
  resolveRequest, importAuto, fetchTextVia, ensureScratchCollection,
};
