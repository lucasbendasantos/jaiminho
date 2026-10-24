'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getMocks, closeMocks, tmpWorkspace } = require('./helpers');
const E = require('../src');

let m;
test.before(async () => { m = await getMocks(); });
test.after(closeMocks);

const fetchText = () => E.fetchTextVia(tmpWorkspace());

test('Swagger por URL (OpenAPI 3): pastas por tag, requests, baseUrl, e enviar funciona', async () => {
  const ws = tmpWorkspace();
  const r = await E.openapi.importOpenApi(ws, { url: `${m.urls.http}/v3/api-docs`, fetchText: E.fetchTextVia(ws) }, { createEnvironments: true });
  const tree = ws.tree().collections[0];
  assert.equal(tree.name, 'Jaiminho Mock - Travellers API');
  const names = (n) => (n.children || []).flatMap((c) => [c.name, ...names(c)]);
  const all = names(tree);
  for (const n of ['travellers', 'Listar viajantes', 'Criar viajante', 'Buscar viajante por id', 'Apagar viajante']) assert.ok(all.includes(n), `faltou ${n}: ${all}`);
  assert.ok(r.environments.length >= 1);
  const col = ws.get(r.collectionId);
  assert.equal(col.vars.find((v) => v.key === 'baseUrl').value, m.urls.http);
  const getId = [...ws.index].find(([id, n]) => n.type === 'request' && ws.get(id).name === 'Buscar viajante por id')[0];
  const req = ws.get(getId);
  assert.ok(req.url.includes('{{baseUrl}}/api/travellers/'), req.url);
  const res = await E.send(ws, { requestId: getId, environmentId: undefined });
  assert.equal(res.response.code, 200, res.error);
});

test('Swagger UI (springdoc) e Swagger 2.0 por arquivo/texto e YAML', async () => {
  let ws = tmpWorkspace();
  let r = await E.openapi.importOpenApi(ws, { url: `${m.urls.http}/swagger-ui/index.html`, fetchText: E.fetchTextVia(ws) });
  assert.ok(r.collectionId);
  ws = tmpWorkspace();
  const f = path.join(ws.dir, 'data', 'sw2.json');
  fs.writeFileSync(f, (await (E.fetchTextVia(ws))(`${m.urls.http}/v2/swagger.json`)).body);
  r = await E.openapi.importOpenApi(ws, { file: f });
  assert.equal(ws.get(r.collectionId).name, 'Jaiminho Mock - Swagger 2');
  ws = tmpWorkspace();
  r = await E.importAuto(ws, { text: (await (E.fetchTextVia(ws))(`${m.urls.http}/v3/api-docs.yaml`)).body });
  assert.equal(r.type, 'openapi');
});

test('Sincronizar com o Swagger: detecta e aplica mudanças mantendo scripts', async () => {
  const ws = tmpWorkspace();
  const spec = JSON.parse((await (E.fetchTextVia(ws))(`${m.urls.http}/v3/api-docs`)).body);
  const r = await E.openapi.importOpenApi(ws, { text: JSON.stringify(spec) });
  const getId = [...ws.index].find(([id, n]) => n.type === 'request' && ws.get(id).name === 'Buscar viajante por id')[0];
  ws.save(getId, { ...ws.get(getId), scripts: { post: 'pm.test("meu teste", ()=>{})' } });
  spec.paths['/api/novos'] = { get: { tags: ['travellers'], operationId: 'novos', summary: 'Novos', responses: { 200: { description: 'ok' } } } };
  delete spec.paths['/xml/traveller'];
  spec.paths['/api/travellers/{id}'].get.parameters = [{ name: 'expand', in: 'query', schema: { type: 'boolean' } }];
  const diff = await E.openapi.syncOpenApi(ws, r.collectionId, { text: JSON.stringify(spec), apply: true });
  assert.deepEqual(diff.added.map((a) => a.name), ['Novos']);
  assert.deepEqual(diff.removed.map((a) => a.name), ['Viajante em XML']);
  assert.ok(diff.changed.some((c) => c.name === 'Buscar viajante por id'));
  const after = ws.get(getId);
  assert.equal(after.scripts.post, 'pm.test("meu teste", ()=>{})');
  assert.ok(after.params.some((p) => p.key === 'expand'));
});

test('cURL: colar → request pronta (bash, cmd, PowerShell), -k, -u, Bearer, body JSON; e enviar', async () => {
  const ws = tmpWorkspace();
  const bash = `curl -X POST '${m.urls.http}/api/travellers?origem=curl' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer jaiminho-token' \\\n  --data-raw '{"firstName":"Ana","lastName":"Lima"}'`;
  let r = await E.importAuto(ws, { text: bash });
  assert.equal(r.type, 'curl');
  let req = ws.get(r.requestId);
  assert.equal(req.method, 'POST'); assert.equal(req.auth.type, 'bearer'); assert.equal(req.body.language, 'json');
  assert.deepEqual(req.params.map((p) => [p.key, p.value]), [['origem', 'curl']]);
  assert.equal(ws.get(ws.info(r.requestId).parentId).name, 'Rascunhos');
  const res = await E.send(ws, { requestId: r.requestId });
  assert.equal(res.response.code, 201);
  const cmd = `curl.exe -k ^\n  -u jaiminho:carteiro ^\n  "${m.urls.https}/auth/basic"`;
  r = await E.importAuto(ws, { text: cmd });
  req = ws.get(r.requestId);
  assert.equal(req.settings.verifySsl, false); assert.equal(req.auth.type, 'basic');
  assert.equal((await E.send(ws, { requestId: r.requestId })).response.code, 200);
  const ps = `curl.exe \`\n  -X GET \`\n  "${m.urls.http}/headers" \`\n  -H "X-Teste: ps"`;
  r = await E.importAuto(ws, { text: ps });
  assert.ok(ws.get(r.requestId).headers.some((h) => h.key === 'X-Teste' && h.value === 'ps'));
});

test('cURL exportado (bash/cmd/PowerShell) com variáveis resolvidas e reimportável', async () => {
  const ws = tmpWorkspace();
  const col = ws.createCollection('C', { vars: [{ key: 'baseUrl', value: m.urls.http }], auth: { type: 'bearer', bearer: { token: 'jaiminho-token' } } });
  const id = ws.createRequest(col, { name: 'p', method: 'POST', url: '{{baseUrl}}/echo', headers: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', language: 'json', raw: '{"a":1}' }, settings: { verifySsl: false } });
  const resolved = E.resolveRequest(ws, ws.get(id), { requestId: id });
  const bash = await E.curl.exportCurl(resolved, { flavor: 'bash' });
  assert.match(bash, /^curl -k /); assert.ok(bash.includes(`${m.urls.http}/echo`)); assert.ok(bash.includes('Authorization: Bearer jaiminho-token'));
  const cmd = await E.curl.exportCurl(resolved, { flavor: 'cmd' }); assert.ok(cmd.includes('^'));
  const ps = await E.curl.exportCurl(resolved, { flavor: 'powershell' }); assert.match(ps, /^curl\.exe /);
  const r = await E.importAuto(ws, { text: bash });
  const res = await E.send(ws, { requestId: r.requestId });
  assert.equal(JSON.parse(res.response.body).json.a, 1);
  const java = await E.curl.generate(resolved, 'java', 'OkHttp'); assert.ok(java.includes('OkHttpClient'));
});

test('Postman v2.1: exportar e importar ida-e-volta (pastas, auth, scripts, variáveis, segredo vazio)', async () => {
  const ws = tmpWorkspace();
  const col = ws.createCollection('Origem', { auth: { type: 'bearer', bearer: { token: '{{t}}' } }, scripts: { pre: 'console.log(1)' } });
  ws.saveCollectionVars(col, [{ key: 'baseUrl', value: m.urls.http }, { key: 't', value: 'segredo!', secret: true }]);
  const f = ws.createFolder(col, 'Pasta');
  ws.createRequest(f, { name: 'Um', method: 'PUT', url: '{{baseUrl}}/api/travellers/1', params: [{ key: 'a', value: '1' }, { key: 'b', value: '2', enabled: false }], body: { mode: 'raw', language: 'json', raw: '{"x":1}' }, scripts: { post: 'pm.test("t", ()=>{})' }, settings: { verifySsl: false } });
  ws.createRequest(col, { kind: 'soap', name: 'Soap', url: '{{baseUrl}}/soap/TravellerService', soap: { version: '1.1', action: 'urn:Get' }, body: { mode: 'raw', language: 'xml', raw: '<x/>' } });
  const json = E.postman.exportCollection(ws, col);
  assert.equal(json.info.schema, E.postman.SCHEMA_21);
  assert.equal(json.variable.find((v) => v.key === 't').value, '', 'segredo não sai no export');
  const ws2 = tmpWorkspace();
  const r = E.postman.importAny(ws2, JSON.parse(JSON.stringify(json)));
  const tree = ws2.tree().collections[0];
  assert.equal(tree.children[0].name, 'Pasta');
  const um = ws2.get(tree.children[0].children[0].id);
  assert.equal(um.method, 'PUT'); assert.equal(um.params.find((p) => p.key === 'b').enabled, false);
  assert.equal(um.scripts.post, 'pm.test("t", ()=>{})'); assert.equal(um.settings.verifySsl, false);
  const soap = ws2.get(tree.children[1].id);
  assert.equal(soap.kind, 'soap'); assert.equal(soap.soap.action, 'urn:Get');
  assert.equal(ws2.get(r.collectionId).auth.type, 'bearer');
  assert.deepEqual(ws2.missingSecrets().map((x) => x.key), ['t']);
});

test('Postman: ambiente e backup (dump) com tipo secret', async () => {
  const ws = tmpWorkspace();
  const env = { name: 'QUA', _postman_variable_scope: 'environment', values: [{ key: 'url', value: 'http://x', enabled: true }, { key: 'senha', value: 'abc', type: 'secret', enabled: true }] };
  const r = E.postman.importAny(ws, env);
  const e = ws.getEnvironment(r.environmentId);
  assert.equal(e.vars.find((v) => v.key === 'senha').secret, true);
  assert.equal(E.vars.buildScopes(ws, null, { environmentId: r.environmentId }).environment.find((v) => v.key === 'senha').value, 'abc');
  const out = E.postman.exportEnvironment(ws, r.environmentId);
  assert.equal(out.values.find((v) => v.key === 'senha').value, '');
  const dump = { version: 1, collections: [{ info: { name: 'D1', schema: E.postman.SCHEMA_21 }, item: [{ name: 'r', request: { method: 'GET', url: 'http://x' } }] }], environments: [env] };
  const d = E.postman.importAny(tmpWorkspace(), dump);
  assert.equal(d.collections.length, 1); assert.equal(d.environments.length, 1);
});

test('WSDL por URL: coleção SOAP 1.1 e 1.2, envelope de exemplo, envio, Fault e validação XSD', async () => {
  const ws = tmpWorkspace();
  const r = await E.importAuto(ws, { url: `${m.urls.http}/soap/TravellerService?wsdl` });
  assert.equal(r.type, 'wsdl'); assert.equal(r.operations, 4);
  const reqs = [...ws.index].filter(([, n]) => n.type === 'request').map(([id]) => ws.get(id));
  const get11 = reqs.find((x) => x.name === 'GetTraveller' && x.soap.version === '1.1');
  assert.ok(get11.body.raw.includes('<tns:id>1</tns:id>'), get11.body.raw);
  let res = await E.send(ws, { request: get11 });
  assert.equal(res.response.code, 200, res.error);
  assert.deepEqual(E.xml.evaluate(res.response.body, '//tns:firstName'), ['Jaime']);
  assert.equal(res.xsd.request.valid, true, JSON.stringify(res.xsd));
  assert.equal(res.xsd.response.valid, true, JSON.stringify(res.xsd));
  const get12 = reqs.find((x) => x.name === 'GetTraveller' && x.soap.version === '1.2');
  res = await E.send(ws, { request: get12 });
  assert.match(res.response.headers.find((h) => /content-type/i.test(h.key)).value, /soap\+xml/);
  res = await E.send(ws, { request: { ...get11, body: { ...get11.body, raw: get11.body.raw.replace('<tns:id>1</tns:id>', '<tns:id>999</tns:id>') } } });
  assert.match(res.soapFault.message, /não encontrado/);
  const create = reqs.find((x) => x.name === 'CreateTraveller' && x.soap.version === '1.1');
  res = await E.send(ws, { request: { ...create, body: { ...create.body, raw: create.body.raw.replace('<tns:nationality>MX</tns:nationality>', '<tns:nationality>XX</tns:nationality>') } } });
  assert.equal(res.xsd.request.valid, false, 'XX não está no enum do XSD');
});

test('XML: formatar e XPath', () => {
  assert.equal(E.xml.pretty('<a><b>1</b><c/></a>'), '<a>\n  <b>1</b>\n  <c/>\n</a>');
  assert.deepEqual(E.xml.evaluate('<a xmlns:x="urn:x"><x:b>1</x:b><x:b>2</x:b></a>', '//x:b'), ['1', '2']);
  assert.equal(E.xml.evaluate('<a><b>1</b><b>2</b></a>', 'count(//b)'), 2);
});

test('Bundle .jaiminho: exporta sem segredos/valores locais e importa em outro workspace (com e sem conflito)', async () => {
  const ws = tmpWorkspace('Ana');
  const col = ws.createCollection('Pagamentos', { vars: [{ key: 'baseUrl', value: m.urls.http }] });
  ws.createRequest(col, { name: 'Health', url: '{{baseUrl}}/api/health' });
  const env = ws.saveEnvironment({ name: 'QUA', vars: [{ key: 'token', value: 'nao-pode-vazar', secret: true }] });
  ws.setLocalValue(`env:${env}`, 'x', 'local');
  const buf = await E.bundle.exportBundle(ws, { type: 'workspace' });
  assert.ok(!buf.includes(Buffer.from('nao-pode-vazar')), 'segredo vazou');
  const pv = await E.bundle.previewBundle(buf);
  assert.deepEqual(pv.problems, []); assert.ok(!pv.manifest.contents.some((c) => c.path.startsWith('.jaiminho')));
  const amigo = tmpWorkspace('Amigo');
  const r = await E.importAuto(amigo, { buffer: buf, fileName: 'amigo.jaiminho' });
  assert.deepEqual(r.collections, ['Pagamentos']); assert.deepEqual(r.environments, ['QUA']);
  assert.deepEqual(amigo.missingSecrets().map((x) => x.key), ['token']);
  const id = [...amigo.index].find(([, n]) => n.type === 'request')[0];
  assert.equal((await E.send(amigo, { requestId: id })).response.code, 200);
  await E.bundle.importBundle(amigo, buf); // de novo: mantém os dois
  assert.equal(amigo.tree().collections.length, 2);
  assert.ok(amigo.tree().collections.some((c) => c.name === 'Pagamentos (importada)'));
  const JSZip = require('jszip'); const z = await JSZip.loadAsync(buf);
  const reqPath = Object.keys(z.files).find((p) => p.endsWith('.req.yaml'));
  z.file(reqPath, 'adulterado'); const corrupted = await z.generateAsync({ type: 'nodebuffer' });
  assert.match((await E.bundle.previewBundle(corrupted)).problems[0], /hash não confere/);
  await assert.rejects(E.bundle.importBundle(tmpWorkspace(), corrupted), /corrompido/);
});

test('Runner: coleção com iterações e arquivo de dados CSV, relatório JUnit', async () => {
  const ws = tmpWorkspace();
  const col = ws.createCollection('R', { vars: [{ key: 'baseUrl', value: m.urls.http }] });
  ws.createRequest(col, { name: 'Busca', url: '{{baseUrl}}/api/travellers/{{id}}', scripts: { post: 'pm.test("200", () => pm.response.to.have.status(200))' } });
  ws.createRequest(col, { kind: 'grpc', name: 'gRPC', url: `grpc://${m.urls.grpc}`, grpc: { method: 'jaiminho.mock.v1.TravellerService/GetTraveller', schema: { source: 'reflection' }, message: '{"id":"{{id}}"}' }, scripts: { afterResponse: 'pm.test("grpc ok", () => pm.expect(pm.response.statusCode).to.eql(0))' } });
  const data = E.parseDataFile('id\n1\n2\n999');
  const rep = await E.runCollection(ws, { id: col, data });
  assert.equal(rep.totals.requests, 6);
  assert.equal(rep.totals.failed, 2, JSON.stringify(rep.results.map((x) => [x.name, x.ok, x.error])));
  assert.match(E.junitReport(rep), /<testsuite name="Jaiminho" tests="6" failures="2">/);
});
