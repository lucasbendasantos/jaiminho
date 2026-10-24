'use strict';
// QA: offline — intercepta DNS/TCP e confirma que o motor só conecta nos hosts pedidos (sem CDN/telemetria/fetch de schema).
const net = require('net');
const dns = require('dns');
const tls = require('tls');
const seen = [];
const origEmit = net.Socket.prototype.emit;
net.Socket.prototype.emit = function (ev, ...a) { if (ev === 'connect' && this.remoteAddress) seen.push(`${this.remoteAddress}:${this.remotePort}`); if (ev === 'lookup') seen.push(`dns:${a[3] || a[1]}`); return origEmit.call(this, ev, ...a); };
const origLookup = dns.lookup; dns.lookup = function (host, ...rest) { seen.push(`dns:${host}`); return origLookup.call(this, host, ...rest); };
const origPLookup = dns.promises.lookup; dns.promises.lookup = function (host, ...rest) { seen.push(`dns:${host}`); return origPLookup.call(this, host, ...rest); };
const fs = require('fs'); const path = require('path'); const os = require('os');
const { J, check, finish, getMocks, tmpWs } = require('./lib');
const local = (s) => /^(::ffff:)?127\./.test(s) || /^dns:(127\.0\.0\.1|localhost)$/.test(s) || /^(dns:)?(127\.0\.0\.1|localhost|::1|undefined)(:|$)/.test(s) || /^(127\.0\.0\.1|localhost):/.test(s);

(async () => {
  const m = await getMocks();
  const H = m.urls.http; const SVC = 'jaiminho.mock.v1.TravellerService';
  seen.length = 0;
  const ws = tmpWs();
  // operações típicas
  await J.send(ws, { request: J.model.newRequest({ url: `${H}/echo`, scripts: { pre: 'pm.variables.set("x", require("lodash").VERSION)', post: 'pm.test("t", () => pm.expect(pm.response.code).to.eql(200)); const cheerio = require("cheerio"); const $ = cheerio.load("<a>x</a>")' } }) });
  await J.importAuto(ws, { url: `${H}/v3/api-docs` });
  await J.importAuto(ws, { text: JSON.stringify({ openapi: '3.0.0', info: { title: 'R', version: '1' }, paths: { '/x': { post: { requestBody: { content: { 'application/json': { schema: { $ref: 'https://raw.githubusercontent.com/OAI/OpenAPI-Specification/main/examples/v3.0/petstore.yaml#/components/schemas/Pet' } } } }, responses: { 200: { description: 'ok' } } } } } }) }).catch(() => {});
  await J.importAuto(ws, { url: `${H}/soap/TravellerService?wsdl` });
  for (const [id, n] of ws.index) if (n.type === 'request' && ws.get(id).kind === 'soap') await J.send(ws, { requestId: id });
  await J.importAuto(ws, { text: `curl ${H}/echo -H 'a: b'` });
  await J.curl.generate(J.model.newRequest({ url: `${H}/echo` }), 'python', 'Requests');
  await J.send(ws, { request: { kind: 'grpc', name: 'g', url: `grpc://${m.urls.grpc}`, grpc: { method: `${SVC}/GetTraveller`, schema: { source: 'reflection' }, message: '{"id":"1"}' } } });
  await J.bundle.exportBundle(ws);
  await check('offline', 'Nenhuma conexão/DNS para fora de localhost durante envio HTTP/SOAP/gRPC, imports (Swagger/WSDL/cURL), XSD, codegen, bundle', async () => {
    const ext = [...new Set(seen.filter((s) => !local(s)))];
    return { pass: ext.length === 0, evidence: ext.length ? `externos: ${ext.join(', ')}` : `só local (${new Set(seen).size} destinos distintos)` };
  }, { timeoutMs: 60000 });
  await check('offline', 'Swagger com $ref remoto (http) NÃO é buscado na internet (informativo: como fica o body)', async () => {
    const ext = seen.filter((s) => /github|raw\./.test(s));
    return { pass: ext.length === 0, evidence: ext.join(',') || 'não buscou' };
  });
  await check('offline', 'Dependências do app/motor sem telemetria conhecida (grep em node_modules de pacotes de runtime)', async () => {
    const root = path.join(__dirname, '..', 'node_modules');
    const suspects = ['@sentry', 'analytics-node', 'applicationinsights', 'mixpanel', 'segment', 'posthog-node', '@amplitude', 'electron-updater', 'update-electron-app'];
    const found = suspects.filter((s) => fs.existsSync(path.join(root, s)));
    return { pass: found.length === 0, evidence: found.join(',') || 'nenhum pacote de telemetria/auto-update instalado' };
  });
  await finish('07-offline');
})();
