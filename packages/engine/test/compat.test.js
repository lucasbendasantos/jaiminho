'use strict';
// Compatibilidade com arquivos reais: .proto aceitos pelo protoc e página do Swagger UI salva como HTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getMocks, closeMocks, tmpWorkspace } = require('./helpers');
const E = require('../src');

let m;
test.before(async () => { m = await getMocks(); });
test.after(closeMocks);

function writeProtos() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
  fs.mkdirSync(path.join(dir, 'validate'));
  fs.writeFileSync(path.join(dir, 'validate', 'validate.proto'), `syntax = "proto3";
package validate;
import "google/protobuf/descriptor.proto";
import "google/protobuf/duration.proto";
extend google.protobuf.FieldOptions { optional FieldRules rules = 1071; }
message FieldRules { optional StringRules string = 14; optional RepeatedRules repeated = 18; }
message StringRules { optional bool min_len = 1; }
message RepeatedRules { optional uint64 max_items = 2; }
`);
  fs.writeFileSync(path.join(dir, 'svc.proto'), `syntax = "proto3";
package demo.v1;
import "validate/validate.proto";
import "google/protobuf/wrappers.proto";
message Item {
  google.protobuf.BoolValue ok = 1 [(validate.rules) = {string:{min_len:true}}];
  repeated string tags = 2 [(validate.rules) = {repeated: {max_items: 100}}];;
}
message Empty {};
service Demo { rpc Get (Empty) returns (Item); };
`);
  return dir;
}

test('.proto com import de google/protobuf/descriptor.proto e ";;" (aceitos pelo protoc) carrega', async () => {
  const dir = writeProtos(); const ws = tmpWorkspace();
  const req = { kind: 'grpc', name: 'x', url: 'grpc://localhost:1', grpc: { method: '', message: '{}', metadata: [], schema: { source: 'proto', files: [path.join(dir, 'svc.proto')], importPaths: [dir] }, options: {} } };
  const d = await E.grpc.describe(ws, { request: req, refresh: true });
  const svc = (d.services || []).find((s) => s.name === 'demo.v1.Demo');
  assert.ok(svc, JSON.stringify(d.services));
  assert.equal(svc.methods.length, 1);
});

test('o patch de leitura de .proto não vaza para outros arquivos', () => {
  const f = path.join(os.tmpdir(), `x-${Date.now()}.txt`); fs.writeFileSync(f, 'a;;b');
  assert.equal(fs.readFileSync(f, 'utf8'), 'a;;b');
  const g = path.join(os.tmpdir(), `x-${Date.now()}.proto`); fs.writeFileSync(g, 'a;;b');
  assert.equal(fs.readFileSync(g, 'utf8'), 'a;;b');
});

const PAGE = (origin) => `<!DOCTYPE html>
<!-- saved from url=(0050)${origin}/swagger-ui/index.html?urls.primaryName=Orders -->
<html><body><div id="swagger-ui"><section class="swagger-ui"><div class="info"><hgroup class="main"><h2 class="title">Orders API<span><small><pre class="version"> 1.0 </pre></small></span></h2><a class="link"><span class="url"> /gw/api/v1/orders</span></a></hgroup></div>
<div class="opblock opblock-post" id="a"><div class="opblock-summary opblock-summary-post"><button class="opblock-summary-control"><span class="opblock-summary-method">POST</span><div class="opblock-summary-path-description-wrapper"><span class="opblock-summary-path" data-path="/v1/orders/create"><a><span>/v1/orders/create</span></a></span><div class="opblock-summary-description">Cria pedido</div></div></button></div></div>
<div class="opblock opblock-get" id="b"><div class="opblock-summary opblock-summary-get"><button class="opblock-summary-control"><span class="opblock-summary-method">GET</span><div class="opblock-summary-path-description-wrapper"><span class="opblock-summary-path" data-path="/v1/orders/list"><a><span>/v1/orders/list</span></a></span></div></button></div></div>
</section></div></body></html>`;

test('Página salva do Swagger UI (HTML): sem rede reconstrói requests e estima o baseUrl', async () => {
  const ws = tmpWorkspace();
  const r = await E.importAuto(ws, { text: PAGE('http://127.0.0.1:1'), fileName: 'Swagger UI.html' });
  assert.equal(r.fromSavedPage, 'dom'); assert.equal(r.requests, 2);
  assert.ok(r.warnings.some((w) => /estimado/.test(w)));
  const col = ws.tree().collections[0];
  assert.equal(col.name, 'Orders API');
  const reqs = col.children.map((c) => ws.get(c.id));
  assert.deepEqual(reqs.map((x) => x.method).sort(), ['GET', 'POST']);
  assert.ok(reqs.every((x) => x.url.startsWith('{{baseUrl}}/v1/orders/')));
  assert.equal(ws.get(col.id).vars.find((v) => v.key === 'baseUrl').value, 'http://127.0.0.1:1/gw/api');
  assert.equal(reqs.find((x) => x.method === 'POST').name, 'Cria pedido');
});

test('Página salva do Swagger UI: com rede baixa a especificação de verdade', async () => {
  const ws = tmpWorkspace();
  const html = PAGE(m.urls.http).replace('/gw/api/v1/orders', '/v3/api-docs');
  const r = await E.importAuto(ws, { text: html, fileName: 'Swagger UI.html' });
  assert.equal(r.fromSavedPage, 'spec');
  assert.equal(ws.tree().collections[0].name, 'Jaiminho Mock - Travellers API');
});

test('Any com tipo embutido (StringValue) que nenhum .proto importou: JSON → bytes → JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'any-'));
  fs.writeFileSync(path.join(dir, 'a.proto'), `syntax = "proto3";
package demo.v1;
import "google/protobuf/any.proto";
message Msg { map<string, google.protobuf.Any> attrs = 1; bytes img = 2; }
service S { rpc Do (Msg) returns (Msg); }
`);
  const ws = tmpWorkspace();
  const req = { kind: 'grpc', name: 'x', url: 'grpc://localhost:1', grpc: { method: '', message: '{}', metadata: [], schema: { source: 'proto', files: [path.join(dir, 'a.proto')], importPaths: [dir] }, options: {} } };
  const d = await E.grpc.describe(ws, { request: req, refresh: true });
  const { jsonToMessage, messageToJson } = require('../src/grpc/json');
  const T = d.schema.root.lookupType('demo.v1.Msg');
  const sample = E.grpc.sample(T);
  const msg = jsonToMessage(T, sample, d.schema.root);
  const bytes = T.encode(msg).finish();
  const back = messageToJson(T, T.decode(bytes), d.schema.root);
  assert.equal(back.attrs.chave['@type'], 'type.googleapis.com/google.protobuf.StringValue');
  assert.equal(back.attrs.chave.value, 'texto');
  assert.equal(back.img, 'AQID');
});

test('URL da página do Swagger UI com ?urls.primaryName= importa o grupo certo (springdoc)', async () => {
  const mk = (t) => JSON.stringify({ openapi: '3.0.0', info: { title: t, version: '1' }, paths: { [`/${t}/ping`]: { get: { summary: t } } } });
  const fetchText = async (u) => {
    const p = new URL(u).pathname;
    if (p === '/swagger-ui/index.html') return { status: 200, body: '<html>swagger-ui</html>' };
    if (p === '/v3/api-docs/swagger-config') return { status: 200, body: JSON.stringify({ urls: [{ name: 'Alpha', url: '/g/alpha' }, { name: 'Beta', url: '/g/beta' }] }) };
    if (p === '/g/alpha') return { status: 200, body: mk('alpha') };
    if (p === '/g/beta') return { status: 200, body: mk('beta') };
    return { status: 404, body: '' };
  };
  const base = 'https://x.local/swagger-ui/index.html';
  const ws = tmpWorkspace();
  await E.openapi.importOpenApi(ws, { url: `${base}?urls.primaryName=Beta`, fetchText }, {});
  assert.equal(ws.tree().collections[0].name, 'beta');
  await assert.rejects(() => E.openapi.importOpenApi(tmpWorkspace(), { url: `${base}?urls.primaryName=Zeta`, fetchText }, {}), /Grupo "Zeta" não existe.*Alpha, Beta/);
  const ws2 = tmpWorkspace();
  await E.openapi.importOpenApi(ws2, { url: base, fetchText }, {});
  assert.equal(ws2.tree().collections[0].name, 'alpha');
});
