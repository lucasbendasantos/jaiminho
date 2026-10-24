'use strict';
// Import/export no formato público do Postman (Collection v2.0/v2.1, Environment, Globals, data dump).
const { requestToPostmanItem, requestFromPostmanItem, authToPostman, authFromPostman, scriptsToEvents, scriptsFromEvents } = require('../model');

const SCHEMA_21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

function varsFromPostman(list = []) {
  return (list || []).filter((v) => v && v.key).map((v) => ({ key: v.key, value: v.value == null ? '' : String(v.value), ...(v.type === 'secret' ? { secret: true } : {}), ...(v.disabled || v.enabled === false ? { enabled: false } : {}), ...(v.description ? { description: typeof v.description === 'string' ? v.description : v.description.content } : {}) }));
}

function detect(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.info && (json.item || json.info.schema)) return 'collection';
  if (Array.isArray(json.values) && (json._postman_variable_scope === 'environment' || json.name !== undefined) && json._postman_variable_scope !== 'globals') return 'environment';
  if (Array.isArray(json.values) && json._postman_variable_scope === 'globals') return 'globals';
  if (Array.isArray(json.collections) || Array.isArray(json.environments)) return 'dump';
  if (json.collection && json.collection.info) return 'collection-wrapped';
  return null;
}

/** Importa uma coleção Postman. Devolve { collectionId, report }. */
function importCollection(ws, json, { name, origin } = {}) {
  if (json.collection && json.collection.info) json = json.collection;
  const report = { requests: 0, folders: 0, warnings: [] };
  const vars = varsFromPostman(json.variable);
  const colId = ws.createCollection(name || json.info?.name || 'Coleção importada', {
    description: typeof json.info?.description === 'string' ? json.info.description : json.info?.description?.content,
    auth: authFromPostman(json.auth), scripts: scriptsFromEvents(json.event), origin,
  });
  ws.saveCollectionVars(colId, vars);
  const walk = (items, parentId) => {
    for (const it of items || []) {
      if (Array.isArray(it.item)) {
        const fid = ws.createFolder(parentId, it.name || 'pasta', { description: typeof it.description === 'string' ? it.description : it.description?.content, auth: authFromPostman(it.auth), scripts: scriptsFromEvents(it.event) });
        report.folders++; walk(it.item, fid);
      } else if (it.request && it._jaiminho && it._jaiminho.kind === 'grpc') {
        const { newRequest } = require('../model');
        ws.createRequest(parentId, newRequest({ kind: 'grpc', name: it.name, url: typeof it.request.url === 'string' ? it.request.url : it.request.url.raw, grpc: it._jaiminho.grpc, scripts: it._jaiminho.scripts }));
        report.requests++;
      } else if (it.request) {
        const r = requestFromPostmanItem(it);
        if (it._jaiminhoOrigin) r.origin = it._jaiminhoOrigin;
        if (r.auth && !['inherit', 'none', 'basic', 'bearer', 'apikey', 'digest', 'oauth1', 'oauth2', 'ntlm', 'awsv4', 'hawk', 'jwt', 'edgegrid', 'asap', 'akamai'].includes(r.auth.type)) report.warnings.push(`${it.name}: auth "${r.auth.type}" não suportada`);
        const code = `${r.scripts.pre || ''}\n${r.scripts.post || ''}`;
        if (/pm\.vault|pm\.require\(|pm\.visualizer/.test(code)) report.warnings.push(`${it.name}: script usa recurso do Postman que pode não existir aqui (pm.vault / pm.require / pm.visualizer)`);
        ws.createRequest(parentId, r); report.requests++;
      }
    }
  };
  walk(json.item, colId);
  return { collectionId: colId, report };
}

/** Exporta a coleção em Collection v2.1 (segredos saem vazios). */
function exportCollection(ws, collectionId) {
  const col = ws.get(collectionId);
  const build = (id) => {
    const n = ws.info(id); const d = ws.get(id);
    if (n.type === 'request') {
      if (d.kind === 'grpc') {
        return { name: d.name, request: { method: 'POST', url: d.url, header: (d.grpc?.metadata || []).map((h) => ({ key: h.key, value: h.value })), body: { mode: 'raw', raw: d.grpc?.message || '{}' }, description: `gRPC ${d.grpc?.method || ''} (exportado do Jaiminho; o Postman importa gRPC só pelo próprio formato)` }, _jaiminho: { kind: 'grpc', grpc: d.grpc, scripts: d.scripts } };
      }
      const it = requestToPostmanItem(d, { forExport: true }); it.id = d.id; return it;
    }
    return { id, name: d.name, description: d.description, auth: authToPostman(d.auth), event: scriptsToEvents(d.scripts), item: ws.children(id).map(build) };
  };
  return {
    info: { _postman_id: col.id, name: col.name, description: col.description, schema: SCHEMA_21 },
    auth: authToPostman(col.auth), event: scriptsToEvents(col.scripts),
    variable: (col.vars || []).map((v) => ({ key: v.key, value: v.secret ? '' : v.value, type: v.secret ? 'secret' : 'default', disabled: v.enabled === false || undefined })),
    item: ws.children(collectionId).map(build),
  };
}

function importEnvironment(ws, json) {
  return ws.saveEnvironment({ name: json.name || 'Ambiente importado', vars: varsFromPostman(json.values) });
}

function exportEnvironment(ws, envId) {
  const e = ws.getEnvironment(envId);
  return { id: e.id, name: e.name, _postman_variable_scope: 'environment', values: (e.vars || []).map((v) => ({ key: v.key, value: v.secret ? '' : v.value, type: v.secret ? 'secret' : 'default', enabled: v.enabled !== false })) };
}

function importGlobals(ws, json) {
  const cur = ws.getGlobals(); const add = varsFromPostman(json.values);
  const map = new Map(cur.map((v) => [v.key, v])); for (const v of add) map.set(v.key, v);
  ws.saveGlobals([...map.values()]);
}

/** Importa qualquer JSON do Postman (detecta o tipo). */
function importAny(ws, json, opts) {
  const type = detect(json);
  if (type === 'collection' || type === 'collection-wrapped') return { type: 'collection', ...importCollection(ws, json, opts) };
  if (type === 'environment') return { type: 'environment', environmentId: importEnvironment(ws, json) };
  if (type === 'globals') { importGlobals(ws, json); return { type: 'globals' }; }
  if (type === 'dump') {
    const out = { type: 'dump', collections: [], environments: [] };
    for (const c of json.collections || []) out.collections.push(importCollection(ws, c).collectionId);
    for (const e of json.environments || []) out.environments.push(importEnvironment(ws, e));
    return out;
  }
  throw new Error('Arquivo não reconhecido como coleção, ambiente ou backup do Postman');
}

module.exports = { importCollection, exportCollection, importEnvironment, exportEnvironment, importGlobals, importAny, detect, SCHEMA_21 };
