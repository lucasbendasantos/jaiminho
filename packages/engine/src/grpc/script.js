'use strict';
// Sandbox de scripts gRPC com a API pm do Postman (beforeInvoke / onIncomingMessage / afterResponse).
// Segurança: NENHUM objeto/função do processo entra no contexto (só JSON). Toda a API (pm, chai, console)
// é criada DENTRO do contexto, então `this.constructor.constructor('return process')()` não alcança o host.
const vm = require('vm');
const fs = require('fs');

let chaiSource = null;
function chaiCode() {
  if (chaiSource === null) { try { chaiSource = fs.readFileSync(require.resolve('chai/chai.js'), 'utf8'); } catch { chaiSource = ''; } }
  return chaiSource;
}

const PRELUDE = `
(function () {
  var D = JSON.parse(__input); var OUT = { tests: [], console: [], changed: { environment: {}, globals: {}, collection: {} }, local: {} };
  globalThis.__out = OUT;
  var S = D.scopes; var pending = [];
  function str(v) { return typeof v === 'string' ? v : JSON.stringify(v); }
  function api(store, name) {
    return {
      get: function (k) { return store[k]; },
      set: function (k, v) { store[k] = str(v); if (name) OUT.changed[name][k] = store[k]; },
      unset: function (k) { delete store[k]; if (name) OUT.changed[name][k] = null; },
      has: function (k) { return Object.prototype.hasOwnProperty.call(store, k); },
      toObject: function () { return Object.assign({}, store); },
      clear: function () { Object.keys(store).forEach(function (k) { delete store[k]; if (name) OUT.changed[name][k] = null; }); },
      replaceIn: function (s) { return String(s).replace(/\\{\\{([^{}]+)\\}\\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : m; }); }
    };
  }
  function merged() { return Object.assign({}, S.globals, S.collection, S.environment, S.local); }
  var lv = { get: function (k) { return merged()[k]; }, set: function (k, v) { S.local[k] = str(v); OUT.local[k] = S.local[k]; }, has: function (k) { return k in merged(); }, toObject: merged,
    replaceIn: function (s) { var m = merged(); return String(s).replace(/\\{\\{([^{}]+)\\}\\}/g, function (x, k) { return k in m ? m[k] : x; }); } };
  var c = {};
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (l) { c[l] = function () { var a = []; for (var i = 0; i < arguments.length; i++) a.push(typeof arguments[i] === 'string' ? arguments[i] : (function (x) { try { return JSON.stringify(x); } catch (e) { return String(x); } })(arguments[i])); OUT.console.push({ level: l, args: a }); }; });
  globalThis.console = c;
  function md(list) { list = list || []; return { get: function (k) { k = String(k).toLowerCase(); for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i].value; }, toObject: function () { var o = {}; list.forEach(function (h) { o[h.key] = h.value; }); return o; }, all: function () { return list.slice(); } }; }
  var R = D.response;
  var response = R ? {
    statusCode: R.statusCode, status: R.status, responseTime: R.responseTime,
    messages: { all: function () { return R.messages.slice(); }, count: function () { return R.messages.length; }, idx: function (i) { return R.messages[i]; } },
    metadata: md(R.metadata), trailers: md(R.trailers),
    json: function () { return R.messages[0] ? R.messages[0].data : undefined; },
    to: { have: { statusCode: function (n) { if (R.statusCode !== n) throw new Error('esperado status ' + n + ', veio ' + R.statusCode); } } }
  } : undefined;
  var pm = {
    environment: Object.assign(api(S.environment, 'environment'), { name: D.environmentName }),
    collectionVariables: api(S.collection, 'collection'),
    globals: api(S.globals, 'globals'),
    variables: lv,
    request: D.request, response: response, message: D.message,
    expect: globalThis.chai ? globalThis.chai.expect : function () { throw new Error('chai indisponível'); },
    info: { eventName: D.eventName, requestName: D.request && D.request.name },
    sendRequest: function () { throw new Error('pm.sendRequest ainda não está disponível em scripts gRPC; use um script de coleção HTTP antes'); },
    test: function (name, fn) {
      var t = { name: String(name), passed: true };
      OUT.tests.push(t);
      try {
        var r = fn && fn.length ? new Promise(function (res, rej) { try { fn(function (err) { err ? rej(err) : res(); }); } catch (e) { rej(e); } }) : (fn && fn());
        if (r && typeof r.then === 'function') pending.push(r.then(function () {}, function (e) { t.passed = false; t.error = String(e && e.message || e); }));
      } catch (e) { t.passed = false; t.error = String(e && e.message || e); }
    }
  };
  pm.test.skip = function (name) { OUT.tests.push({ name: String(name), passed: true, skipped: true }); };
  globalThis.pm = pm;
  globalThis.__pending = pending;
})();
`;

/**
 * Roda um script. ctx = { scopes: {environment, collection, globals, local} (k→v), request, response, message, eventName, environmentName }
 * Retorna { tests, console, error?, changed } e aplica as mudanças em ctx.scopes.
 */
async function runScript(code, ctx, { timeoutMs = 10000 } = {}) {
  const out = { tests: [], console: [], changed: { environment: {}, globals: {}, collection: {} } };
  if (!code || !String(code).trim()) return out;
  const input = JSON.stringify({
    scopes: ctx.scopes, request: ctx.request || null, message: ctx.message || null, eventName: ctx.eventName, environmentName: ctx.environmentName,
    response: ctx.response ? { statusCode: ctx.response.statusCode, status: ctx.response.status, responseTime: ctx.response.responseTime, messages: ctx.response.messagesList || [], metadata: ctx.response.metadataList || [], trailers: ctx.response.trailersList || [] } : null,
  });
  // sandbox com protótipo nulo: o global do contexto não herda nada do realm do host
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
  try {
    vm.runInContext(`var __input = ${JSON.stringify(input)};`, context);
    vm.runInContext(chaiCode(), context, { timeout: timeoutMs });
    vm.runInContext('globalThis.chai = globalThis.chai || (typeof module !== "undefined" ? module.exports : undefined);', context);
    vm.runInContext(PRELUDE, context, { timeout: timeoutMs });
    vm.runInContext(`(async function(){ ${'\n'}${String(code)}${'\n'} })().catch(function(e){ __out.error = String(e && e.stack || e); }).then(function(){ return Promise.all(__pending); });`, context, { timeout: timeoutMs, displayErrors: true, filename: `script-${ctx.eventName || 'grpc'}.js` });
  } catch (e) { out.error = String(e && e.message || e); }
  let res;
  try { res = JSON.parse(vm.runInContext('JSON.stringify(__out)', context, { timeout: 1000 })); } catch { res = { tests: [], console: [], changed: out.changed, local: {} }; }
  if (res.error && !out.error) out.error = res.error.split('\n')[0];
  out.tests = res.tests; out.console = res.console; out.changed = res.changed;
  // aplica as mudanças nos escopos do host
  for (const scope of ['environment', 'globals', 'collection']) for (const [k, v] of Object.entries(res.changed[scope] || {})) { if (v === null) delete ctx.scopes[scope][k]; else ctx.scopes[scope][k] = v; }
  for (const [k, v] of Object.entries(res.local || {})) ctx.scopes.local[k] = v;
  return out;
}

function hooksOf(scripts = {}) {
  return { beforeInvoke: scripts.beforeInvoke || scripts.pre || '', onIncomingMessage: scripts.onIncomingMessage || '', afterResponse: scripts.afterResponse || scripts.post || '' };
}

module.exports = { runScript, hooksOf };
