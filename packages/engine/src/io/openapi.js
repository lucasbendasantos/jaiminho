'use strict';
// Swagger/OpenAPI (2.0, 3.0, 3.1) → coleção, por arquivo, texto ou URL (inclusive URL do Swagger UI / springdoc).
// Usa o conversor do próprio Postman (openapi-to-postmanv2, Apache-2.0).
const fs = require('fs');
const crypto = require('crypto');
const YAML = require('yaml');
const o2p = require('openapi-to-postmanv2');
const { importCollection } = require('./postman');
const { requestFromPostmanItem } = require('../model');

const CONVERT_OPTS = { folderStrategy: 'Tags', requestNameSource: 'Fallback', parametersResolution: 'Example', includeAuthInfoInExample: true, enableOptionalParameters: false, keepImplicitHeaders: false, alwaysInheritAuthentication: true };

function parseSpec(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Swagger vazio');
  let obj;
  try { obj = t.startsWith('{') ? JSON.parse(t) : YAML.parse(t); } catch (e) { throw new Error(`Não consegui ler o Swagger (JSON/YAML inválido): ${e.message}`); }
  if (!obj || (!obj.openapi && !obj.swagger)) throw new Error('O conteúdo não é um Swagger/OpenAPI (falta "openapi" ou "swagger")');
  return obj;
}

/** Resolve $ref para arquivos externos (./schemas.yaml#/X) a partir da pasta do arquivo principal. */
function inlineExternalRefs(obj, baseDir, depth = 0, cache = new Map()) {
  if (!baseDir || depth > 20) return obj;
  const load = (f) => { if (!cache.has(f)) { const t = fs.readFileSync(f, 'utf8'); cache.set(f, f.endsWith('.json') ? JSON.parse(t) : YAML.parse(t)); } return cache.get(f); };
  const walk = (o, dir, d) => {
    if (Array.isArray(o)) return o.map((x) => walk(x, dir, d));
    if (!o || typeof o !== 'object') return o;
    if (typeof o.$ref === 'string' && !o.$ref.startsWith('#')) {
      const [file, ptr = ''] = o.$ref.split('#');
      const full = require('path').resolve(dir, file);
      if (!fs.existsSync(full) || d > 20) return o;
      let target = load(full);
      for (const part of ptr.split('/').filter(Boolean)) target = target == null ? target : target[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      return walk(JSON.parse(JSON.stringify(target ?? {})), require('path').dirname(full), d + 1);
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v, dir, d)]));
  };
  return walk(obj, baseDir, depth);
}

function convert(specObj, opts = {}) {
  return new Promise((resolve, reject) => {
    o2p.convertV2({ type: 'json', data: specObj }, { ...CONVERT_OPTS, ...opts }, (err, res) => {
      if (err) return reject(new Error(`Swagger inválido: ${err.message || err}`));
      if (!res.result) return reject(new Error(`Swagger inválido: ${res.reason}`));
      resolve(res.output[0].data);
    });
  });
}

const opKey = (method, url) => `${String(method).toUpperCase()} ${String(url).replace(/^\{\{baseUrl\}\}/, '').replace(/\?.*$/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`;

/** Marca cada item com a chave da operação (para sincronizar depois). */
function tagOrigins(items) {
  for (const it of items || []) {
    if (Array.isArray(it.item)) tagOrigins(it.item);
    else if (it.request) {
      const raw = typeof it.request.url === 'string' ? it.request.url : (it.request.url.raw || `{{baseUrl}}/${[].concat(it.request.url.path || []).join('/')}`);
      it._jaiminhoOrigin = { type: 'openapi', key: opKey(it.request.method, raw) };
    }
  }
}

/**
 * Busca o texto do Swagger por URL. fetchText(url) → Promise<{status, body, contentType}> (vem do motor HTTP, com proxy/TLS do workspace).
 * Aceita: URL direta do JSON/YAML, URL do Swagger UI (springdoc), ou só a base do serviço.
 */
async function fetchSpec(url, fetchText) {
  const tried = [];
  const tryUrl = async (u) => {
    tried.push(u);
    const r = await fetchText(u);
    if (r.status >= 200 && r.status < 300 && r.body) {
      const b = String(r.body).trim();
      if (/^\{|^openapi:|^swagger:|^---/m.test(b.slice(0, 200)) && /"?(openapi|swagger)"?\s*:/.test(b)) return { url: u, text: b };
      if (/swagger-ui|swagger ui/i.test(b)) return { ui: true, url: u, html: b };
    }
    return null;
  };
  const first = await tryUrl(url);
  if (first && !first.ui) return first;
  const u = new URL(url);
  let basePath = u.pathname;
  if (/\/swagger-ui/i.test(basePath)) basePath = basePath.replace(/\/swagger-ui.*$/i, '');
  else if (/\.html?$/i.test(basePath)) basePath = basePath.replace(/\/[^/]*$/, '');
  basePath = basePath.replace(/\/$/, '');
  const base = `${u.protocol}//${u.host}${basePath}`;
  // springdoc: swagger-config lista os grupos
  let cfg = await fetchText(`${base}/v3/api-docs/swagger-config`).catch(() => null);
  const cfgRoot = cfg && cfg.status === 200 ? cfg : await fetchText(`${u.protocol}//${u.host}/v3/api-docs/swagger-config`).catch(() => null);
  if (cfgRoot && cfgRoot.status === 200 && (cfg = cfgRoot)) {
    try {
      const c = JSON.parse(cfg.body);
      const list = (c.urls || []).map((x) => x.url).concat(c.url ? [c.url] : []);
      for (const p of list) { const full = new URL(p, `${u.protocol}//${u.host}`).toString(); const r = await tryUrl(full); if (r && !r.ui) return { ...r, groups: c.urls }; }
    } catch { /* segue */ }
  }
  for (const b of [...new Set([base, `${u.protocol}//${u.host}`])]) for (const p of ['/v3/api-docs', '/v2/api-docs', '/openapi.json', '/swagger.json', '/openapi.yaml', '/api-docs', '/swagger/v1/swagger.json']) {
    const r = await tryUrl(`${b}${p}`).catch(() => null);
    if (r && !r.ui) return r;
  }
  throw new Error(`Não encontrei o Swagger. Tentei: ${tried.join(', ')}`);
}

/** Importa e cria a coleção. source = { text } | { file } | { url, fetchText } */
async function importOpenApi(ws, source, { name, createEnvironments = false } = {}) {
  let text; let url;
  if (source.text) text = source.text;
  else if (source.file) text = fs.readFileSync(source.file, 'utf8');
  else if (source.url) { const r = await fetchSpec(source.url, source.fetchText); text = r.text; url = r.url; }
  let spec = parseSpec(text);
  if (source.file || source.baseDir) spec = inlineExternalRefs(spec, source.baseDir || require('path').dirname(source.file));
  if (!spec.paths || !Object.keys(spec.paths).length) throw new Error('Swagger inválido: não tem nenhuma rota em "paths"');
  const col = await convert(spec);
  tagOrigins(col.item);
  // cópia do contrato dentro do workspace (vai junto ao partilhar; serve para sincronizar depois)
  const pathMod = require('path');
  const specRel = pathMod.join('data', 'specs', `${require('../util').slug(name || spec.info?.title || 'swagger')}.${source.file && /\.ya?ml$/i.test(source.file) ? 'yaml' : 'json'}`);
  fs.mkdirSync(pathMod.join(ws.dir, 'data', 'specs'), { recursive: true });
  fs.writeFileSync(pathMod.join(ws.dir, specRel), /\.yaml$/.test(specRel) ? YAML.stringify(spec) : JSON.stringify(spec, null, 2));
  // baseUrl: se for relativo e veio de URL, completa com o host
  for (const v of col.variable || []) if (v.key === 'baseUrl' && url && (!v.value || v.value.startsWith('/'))) { const u = new URL(url); v.value = `${u.protocol}//${u.host}${v.value || ''}`; }
  const fileRel = source.file && pathMod.resolve(source.file).startsWith(pathMod.resolve(ws.dir)) ? pathMod.relative(ws.dir, source.file).split(pathMod.sep).join('/') : undefined;
  const origin = { type: 'openapi', url, file: fileRel || specRel.split(pathMod.sep).join('/'), sha256: crypto.createHash('sha256').update(text).digest('hex'), importedAt: new Date().toISOString(), version: spec.openapi || spec.swagger };
  const res = importCollection(ws, col, { name: name || spec.info?.title, origin });
  const envs = [];
  if (createEnvironments) {
    const servers = spec.servers || (spec.host ? [{ url: `${(spec.schemes || ['http'])[0]}://${spec.host}${spec.basePath || ''}`, description: spec.host }] : []);
    for (const s of servers) {
      let su = s.url; for (const [k, v] of Object.entries(s.variables || {})) su = su.replace(`{${k}}`, v.default);
      envs.push(ws.saveEnvironment({ name: `${spec.info?.title || 'API'} — ${s.description || su}`, vars: [{ key: 'baseUrl', value: su }] }));
    }
  }
  return { ...res, environments: envs, spec: { title: spec.info?.title, version: spec.info?.version, openapi: spec.openapi || spec.swagger } };
}

/** Compara o Swagger atual com a coleção e (opcional) aplica: novas entram, alteradas atualizam o contrato e mantêm scripts/auth/vars. */
async function syncOpenApi(ws, collectionId, { text, fetchText, apply = false } = {}) {
  const col = ws.get(collectionId);
  const origin = col.origin || {};
  let specText = text;
  if (!specText && origin.url) specText = (await fetchSpec(origin.url, fetchText)).text;
  const originFile = origin.file && (require('path').isAbsolute(origin.file) ? origin.file : require('path').join(ws.dir, origin.file));
  if (!specText && originFile && fs.existsSync(originFile)) specText = fs.readFileSync(originFile, 'utf8');
  if (!specText) throw new Error('Esta coleção não tem origem Swagger (URL/arquivo) para sincronizar');
  const spec = parseSpec(specText);
  const fresh = await convert(spec); tagOrigins(fresh.item);
  const freshOps = new Map(); const folderOf = new Map();
  const walk = (items, folder) => { for (const it of items) { if (Array.isArray(it.item)) walk(it.item, it.name); else { freshOps.set(it._jaiminhoOrigin.key, it); folderOf.set(it._jaiminhoOrigin.key, folder); } } };
  walk(fresh.item, null);
  const existing = new Map();
  for (const [id, n] of ws.index) if (n.type === 'request' && n.collectionId === collectionId) { const r = ws.get(id); if (r.origin && r.origin.key) existing.set(r.origin.key, { id, r }); }
  const diff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [key, it] of freshOps) {
    const ex = existing.get(key);
    const nr = requestFromPostmanItem(it);
    if (!ex) { diff.added.push({ key, name: it.name, folder: folderOf.get(key) }); continue; }
    const contract = (r) => JSON.stringify({ m: r.method, u: r.url, p: (r.params || []).map((x) => x.key).sort(), h: (r.headers || []).map((x) => x.key).sort(), b: r.body && r.body.mode });
    if (contract(ex.r) !== contract(nr)) diff.changed.push({ key, id: ex.id, name: ex.r.name }); else diff.unchanged++;
  }
  for (const [key, ex] of existing) if (!freshOps.has(key)) diff.removed.push({ key, id: ex.id, name: ex.r.name });
  if (apply) {
    const folderIds = new Map(); for (const id of ws.children(collectionId)) if (ws.info(id).type === 'folder') folderIds.set(ws.get(id).name, id);
    for (const a of diff.added) {
      let parent = collectionId; const f = a.folder;
      if (f) { parent = folderIds.get(f) || ws.createFolder(collectionId, f); folderIds.set(f, parent); }
      const it = freshOps.get(a.key); const nr = requestFromPostmanItem(it); nr.origin = it._jaiminhoOrigin; ws.createRequest(parent, nr);
    }
    for (const c of diff.changed) {
      const it = freshOps.get(c.key); const nr = requestFromPostmanItem(it); const cur = ws.get(c.id);
      const keepVals = (newList, oldList) => (newList || []).map((p) => { const o = (oldList || []).find((x) => x.key === p.key); return o ? { ...p, value: o.value, enabled: o.enabled } : p; });
      ws.save(c.id, { ...cur, method: nr.method, url: nr.url, params: keepVals(nr.params, cur.params), headers: keepVals(nr.headers, cur.headers), body: cur.body && cur.body.mode === nr.body.mode ? cur.body : nr.body, origin: it._jaiminhoOrigin });
    }
    if (diff.removed.length) {
      let trash = ws.children(collectionId).find((id) => ws.info(id).type === 'folder' && ws.get(id).name === '_removidas no Swagger');
      if (!trash) trash = ws.createFolder(collectionId, '_removidas no Swagger');
      for (const r of diff.removed) ws.move(r.id, trash);
    }
    ws.save(collectionId, { ...ws.get(collectionId), origin: { ...origin, sha256: crypto.createHash('sha256').update(specText).digest('hex'), syncedAt: new Date().toISOString() } });
  }
  return diff;
}

module.exports = { importOpenApi, syncOpenApi, fetchSpec, parseSpec, convert };
