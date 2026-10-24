'use strict';
// Escopos de variáveis (mesma precedência do Postman + pasta/request) e resolução de {{ }}.
const sdk = require('postman-collection');

/**
 * Monta os escopos efetivos para um item.
 * Precedência (menor → maior): global < coleção < ambiente < pasta < request < data < local
 */
function buildScopes(ws, itemId, { environmentId, data = {}, local = {} } = {}) {
  const chain = itemId && ws.index.has(itemId) ? ws.chain(itemId) : [];
  const col = chain[0];
  const globals = ws.effectiveVars('glo', ws.getGlobals());
  const collection = col ? ws.effectiveVars(`col:${col.id}`, col.vars) : [];
  let environment = [];
  let envName;
  if (environmentId && ws.index.has(environmentId)) {
    const env = ws.getEnvironment(environmentId); envName = env.name;
    environment = ws.effectiveVars(`env:${environmentId}`, env.vars);
  }
  const folderAndRequest = [];
  for (const node of chain.slice(1)) for (const v of node.vars || []) if (v.enabled !== false && v.key) folderAndRequest.push({ key: v.key, value: v.value ?? '', source: node.type });
  return { globals, collection, environment, environmentName: envName, folderAndRequest, data, local, collectionId: col && col.id };
}

/** Lista "achatada" com origem de cada variável (para o painel 👁). */
function effectiveList(scopes) {
  const map = new Map();
  const put = (list, scope) => list.forEach((v) => map.set(v.key, { key: v.key, value: v.value, scope, secret: !!v.secret, source: v.source }));
  put(scopes.globals, 'global'); put(scopes.collection, 'collection'); put(scopes.environment, 'environment');
  put(scopes.folderAndRequest.map((v) => ({ ...v })), 'folder/request');
  put(Object.entries(scopes.data || {}).map(([key, value]) => ({ key, value })), 'data');
  put(Object.entries(scopes.local || {}).map(([key, value]) => ({ key, value })), 'local');
  return [...map.values()];
}

/** Resolve {{var}} (inclui variáveis dinâmicas do Postman: $guid, $timestamp, $randomInt...). */
function makeResolver(scopes) {
  const toList = (arr) => new sdk.VariableList(null, arr.map((v) => ({ key: v.key, value: String(v.value ?? '') })));
  const layers = [
    toList(Object.entries(scopes.local || {}).map(([key, value]) => ({ key, value }))),
    toList(Object.entries(scopes.data || {}).map(([key, value]) => ({ key, value }))),
    toList(scopes.folderAndRequest || []),
    toList(scopes.environment || []),
    toList(scopes.collection || []),
    toList(scopes.globals || []),
  ];
  const scope = new sdk.VariableScope({}, layers);
  const envVars = (process && process.env) || {};
  return function resolve(value) {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'string') return value;
    let out = value.replace(/\{\{\$env\.([A-Za-z0-9_]+)\}\}/g, (_, k) => (envVars[k] !== undefined ? envVars[k] : `{{$env.${k}}}`));
    for (let i = 0; i < 10 && /\{\{[^{}]+\}\}/.test(out); i++) {
      const next = scope.replaceIn(out);
      if (next === out) break;
      out = next;
    }
    return out;
  };
}

/** Variáveis não resolvidas que sobraram num texto. */
function unresolved(text) { return [...new Set((String(text || '').match(/\{\{[^{}]+\}\}/g) || []).map((m) => m.slice(2, -2)))]; }

module.exports = { buildScopes, effectiveList, makeResolver, unresolved };
