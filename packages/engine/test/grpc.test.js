'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getMocks, closeMocks, tmpWorkspace } = require('./helpers');
const { grpc, send, grpcurl } = require('../src');

let m;
test.before(async () => { m = await getMocks(); });
test.after(closeMocks);

const SVC = 'jaiminho.mock.v1.TravellerService';
const req = (url, method, message = '{}', extra = {}) => ({ kind: 'grpc', name: method, url, grpc: { method: `${SVC}/${method}`, schema: { source: 'reflection' }, metadata: [], message, ...extra } });

test('Reflection lista serviços e os 4 tipos de método', async () => {
  const ws = tmpWorkspace();
  const d = await grpc.describe(ws, { request: req(`grpc://${m.urls.grpc}`, 'GetTraveller') });
  const svc = d.services.find((s) => s.name === SVC);
  assert.deepEqual(svc.methods.map((x) => x.kind).sort(), ['bidi', 'client-stream', 'server-stream', 'unary', 'unary', 'unary', 'unary']);
});

test('Unário com WKT (Timestamp), enum, map, oneof, headers e trailers', async () => {
  const ws = tmpWorkspace();
  const r = await send(ws, { request: req(`grpc://${m.urls.grpc}`, 'GetTraveller', '{"id":"1"}') });
  assert.equal(r.ok, true, r.error);
  const t = r.messages[0].data;
  assert.equal(t.first_name, 'Jaime'); assert.equal(t.documents[0].type, 'PASSPORT');
  assert.match(t.created_at, /^\d{4}-\d\d-\d\dT/); assert.deepEqual(t.tags, { vip: 'sim' }); assert.equal(t.email, 'jaime@correio.mx');
  assert.equal(r.headers.find((h) => h.key === 'x-request-echo').value, '1');
  assert.equal(r.trailers.find((h) => h.key === 'x-mock').value, 'jaiminho');
});

test('Server streaming, client streaming e bidi', async () => {
  const ws = tmpWorkspace();
  let r = await send(ws, { request: req(`grpc://${m.urls.grpc}`, 'ListTravellers', '{"limit":4}') });
  assert.equal(r.messages.length, 4);
  r = await send(ws, { request: req(`grpc://${m.urls.grpc}`, 'UploadTravellers'), initialMessages: ['{"id":"a"}', '{"id":"b"}', '{"id":"c"}'] });
  assert.deepEqual(r.messages[0].data, { received: 3, ids: ['a', 'b', 'c'] });
  const inv = grpc.invoke(ws, { request: req(`grpc://${m.urls.grpc}`, 'Chat') });
  inv.handle.write('{"text":"um"}'); inv.handle.write({ text: 'dois' });
  setTimeout(() => inv.handle.end(), 100);
  r = await inv.done;
  assert.deepEqual(r.messages.map((x) => x.data.text), ['recebi: um', 'recebi: dois', 'tchau']);
  assert.ok(r.events.some((e) => e.type === 'sent-request-data') && r.events.some((e) => e.type === 'received-response-data'));
});

test('Cancelar streaming', async () => {
  const ws = tmpWorkspace();
  const inv = grpc.invoke(ws, { request: req(`grpc://${m.urls.grpc}`, 'ListTravellers', '{}') });
  setTimeout(() => inv.handle.cancel(), 30);
  const r = await inv.done;
  assert.equal(r.status.name, 'CANCELLED');
});

test('Erro com grpc-status-details-bin decodificado (BadRequest, ErrorInfo)', async () => {
  const ws = tmpWorkspace();
  const r = await send(ws, { request: req(`grpc://${m.urls.grpc}`, 'Fail', '{"code":3,"message":"id ruim"}') });
  assert.equal(r.status.name, 'INVALID_ARGUMENT');
  const types = r.status.errorDetails.details.map((d) => d['@type'].split('.').pop());
  assert.deepEqual(types, ['BadRequest', 'ErrorInfo']);
  assert.equal(r.status.errorDetails.details[0].field_violations[0].field, 'id');
});

test('Deadline e campo inexistente', async () => {
  const ws = tmpWorkspace();
  let r = await send(ws, { request: req(`grpc://${m.urls.grpc}`, 'Slow', '{"delay_ms":2000}', { options: { deadlineMs: 200 } }) });
  assert.match(r.error, /DEADLINE_EXCEEDED/);
  r = await send(ws, { request: req(`grpc://${m.urls.grpc}`, 'GetTraveller', '{"idd":"1"}') });
  assert.match(r.error, /idd.*não existe/);
});

test('Metadata com variável de ambiente e scripts beforeInvoke/afterResponse', async () => {
  const ws = tmpWorkspace();
  const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'token', value: 'jaiminho-token' }] });
  const col = ws.createCollection('G');
  const id = ws.createRequest(col, { ...req(`grpc://${m.urls.grpc}`, 'Whoami'), grpc: { ...req('', 'Whoami').grpc, metadata: [{ key: 'authorization', value: 'Bearer {{token}}' }, { key: 'x-trace', value: '{{trace}}' }] }, scripts: { beforeInvoke: 'pm.variables.set("trace", "t-123")', afterResponse: 'pm.test("ok", () => pm.expect(pm.response.statusCode).to.eql(0)); pm.environment.set("user", pm.response.messages.all()[0].data.user)' } });
  const r = await send(ws, { requestId: id, environmentId: env });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.messages[0].data.metadata['x-trace'], 't-123');
  assert.equal(r.tests[0].passed, true);
  assert.equal(ws.getLocalValues()[`env:${env}`].user, 'jaiminho');
});

test('Sem reflection: .proto com imports e protoset; congelar reflection em protoset', async () => {
  const ws = tmpWorkspace();
  let r = await send(ws, { request: { ...req(m.urls.grpcNoReflection, 'GetTraveller', '{"id":"2"}'), grpc: { ...req('', 'GetTraveller', '{"id":"2"}').grpc, schema: { source: 'proto', files: [path.join(m.proto.dir, m.proto.file)], importPaths: [m.proto.dir] } } } });
  assert.equal(r.ok, true, r.error); assert.equal(r.messages[0].data.phone, '+351900000000');
  r = await send(ws, { request: req(m.urls.grpcNoReflection, 'GetTraveller', '{"id":"2"}') });
  assert.equal(r.ok, false, 'reflection desligada no servidor deve falhar');
  const d = await grpc.describe(ws, { request: req(`grpc://${m.urls.grpc}`, 'GetTraveller') });
  const file = path.join(ws.dir, 'protos', '_frozen', 'mock.protoset');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, grpc.toProtoset(d.schema));
  r = await send(ws, { request: { ...req(m.urls.grpcNoReflection, 'GetTraveller', '{"id":"3"}'), grpc: { ...req('', 'GetTraveller', '{"id":"3"}').grpc, schema: { source: 'protoset', protoset: 'protos/_frozen/mock.protoset' } } } });
  assert.equal(r.ok, true, r.error); assert.equal(r.messages[0].data.first_name, 'Lucas');
});

test('TLS: CA desconhecida falha; SSL desligado; CA própria; mTLS PEM e P12', async () => {
  const ws = tmpWorkspace();
  let r = await send(ws, { request: req(`grpcs://${m.urls.grpcTls}`, 'GetTraveller', '{"id":"1"}') });
  assert.equal(r.ok, false); assert.match(r.error, /certificado/);
  r = await send(ws, { request: { ...req(`grpcs://${m.urls.grpcTls}`, 'GetTraveller', '{"id":"1"}'), grpc: { ...req('', 'GetTraveller', '{"id":"1"}').grpc, tls: { verifySsl: false } } } });
  assert.equal(r.ok, true, r.error);
  ws.saveSettings({ caCertificates: [m.certs.ca] });
  r = await send(ws, { request: req(`grpcs://${m.urls.grpcTls}`, 'GetTraveller', '{"id":"1"}') });
  assert.equal(r.ok, true, r.error);
  r = await send(ws, { request: req(`grpcs://${m.urls.grpcMtls}`, 'GetTraveller', '{"id":"1"}') });
  assert.match(r.error, /certificado de cliente/);
  const port = m.urls.grpcMtls.split(':')[1];
  ws.saveSettings({ certificates: [{ host: `localhost:${port}`, cert: m.certs.clientCert, key: m.certs.clientKey }] });
  r = await send(ws, { request: req(`grpcs://${m.urls.grpcMtls}`, 'Whoami', '{}', { metadata: [{ key: 'authorization', value: 'Bearer jaiminho-token' }] }) });
  assert.equal(r.ok, true, r.error);
  ws.saveSettings({ certificates: [{ id: 'p', host: `localhost:${port}`, pfx: m.certs.clientP12 }] }); ws.setSecret('cert:p:passphrase', 'jaiminho');
  r = await send(ws, { request: req(`grpcs://${m.urls.grpcMtls}`, 'GetTraveller', '{"id":"1"}') });
  assert.equal(r.ok, true, r.error);
});

test('Mensagem de exemplo e grpcurl (exportar/importar)', async () => {
  const ws = tmpWorkspace();
  const d = await grpc.describe(ws, { request: req(`grpc://${m.urls.grpc}`, 'GetTraveller') });
  const method = grpc.findMethod(d.schema.root, `${SVC}/UploadTravellers`);
  const ex = grpc.sample(method.resolvedRequestType);
  assert.equal(ex.documents[0].type, 'PASSPORT'); assert.ok(ex.created_at); assert.ok('email' in ex && !('phone' in ex), 'oneof usa só um ramo');
  const cmd = grpcurl.exportGrpcurl({ ...req(`grpc://${m.urls.grpc}`, 'GetTraveller', '{"id":"1"}'), grpc: { ...req('', 'GetTraveller', '{"id":"1"}').grpc, metadata: [{ key: 'authorization', value: 'Bearer x' }] } });
  assert.match(cmd, /^grpcurl -plaintext -H 'authorization: Bearer x' -d '\{"id":"1"\}' 127\.0\.0\.1:\d+ jaiminho\.mock\.v1\.TravellerService\/GetTraveller$/);
  const back = grpcurl.importGrpcurl(cmd);
  assert.equal(back.grpc.method, `${SVC}/GetTraveller`); assert.equal(back.url, `grpc://${m.urls.grpc}`);
  const r = await send(ws, { request: back });
  assert.equal(r.ok, true, r.error);
});
