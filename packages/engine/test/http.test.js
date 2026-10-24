'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getMocks, closeMocks, tmpWorkspace } = require('./helpers');
const { send, cookies } = require('../src');

let m;
test.before(async () => { m = await getMocks(); });
test.after(closeMocks);

const get = (url, extra = {}) => ({ kind: 'http', name: 't', method: 'GET', url, ...extra });

test('GET JSON com variáveis de coleção e ambiente, teste pm.* e variável gravada pelo script', async () => {
  const ws = tmpWorkspace();
  const col = ws.createCollection('API', { vars: [{ key: 'baseUrl', value: m.urls.http }] });
  const env = ws.saveEnvironment({ name: 'DEV', vars: [{ key: 'id', value: '1' }] });
  const r = ws.createRequest(col, { name: 'Get', url: '{{baseUrl}}/api/travellers/{{id}}', scripts: { post: 'pm.test("status 200", () => pm.response.to.have.status(200)); pm.environment.set("nome", pm.response.json().firstName);' } });
  const res = await send(ws, { requestId: r, environmentId: env });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.response.code, 200);
  assert.equal(JSON.parse(res.response.body).firstName, 'Jaime');
  assert.deepEqual(res.tests.map((t) => t.passed), [true]);
  assert.equal(ws.getLocalValues()[`env:${env}`].nome, 'Jaime', 'valor local gravado (current value)');
  assert.ok(res.response.timings && res.response.timings.total >= 0);
});

test('Precedência: request > pasta > ambiente > coleção > global', async () => {
  const ws = tmpWorkspace();
  ws.saveGlobals([{ key: 'x', value: 'global' }, { key: 'g', value: 'G' }]);
  const col = ws.createCollection('C', { vars: [{ key: 'x', value: 'colecao' }, { key: 'c', value: 'C' }] });
  const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'x', value: 'ambiente' }, { key: 'e', value: 'E' }] });
  const folder = ws.createFolder(col, 'F', { vars: [{ key: 'x', value: 'pasta' }, { key: 'f', value: 'F' }] });
  const r1 = ws.createRequest(folder, get(`${m.urls.http}/echo?x={{x}}&g={{g}}&c={{c}}&e={{e}}&f={{f}}`));
  let res = await send(ws, { requestId: r1, environmentId: env });
  assert.deepEqual(JSON.parse(res.response.body).query, { x: 'pasta', g: 'G', c: 'C', e: 'E', f: 'F' });
  const r2 = ws.createRequest(folder, get(`${m.urls.http}/echo?x={{x}}`, { vars: [{ key: 'x', value: 'request' }] }));
  res = await send(ws, { requestId: r2, environmentId: env });
  assert.equal(JSON.parse(res.response.body).query.x, 'request');
  const r3 = ws.createRequest(col, get(`${m.urls.http}/echo?x={{x}}`));
  res = await send(ws, { requestId: r3, environmentId: env });
  assert.equal(JSON.parse(res.response.body).query.x, 'ambiente');
  res = await send(ws, { requestId: r3 });
  assert.equal(JSON.parse(res.response.body).query.x, 'colecao');
});

test('Segredo: valor fora do YAML, usado no envio', async () => {
  const fs = require('fs');
  const ws = tmpWorkspace();
  const env = ws.saveEnvironment({ name: 'QUA', vars: [{ key: 'token', value: 'jaiminho-token', secret: true }] });
  const raw = fs.readFileSync(ws.info(env).file, 'utf8');
  assert.ok(!raw.includes('jaiminho-token'), 'segredo não pode ir para o YAML');
  const col = ws.createCollection('C');
  const r = ws.createRequest(col, get(`${m.urls.http}/auth/bearer`, { auth: { type: 'bearer', bearer: { token: '{{token}}' } } }));
  const res = await send(ws, { requestId: r, environmentId: env });
  assert.equal(res.response.code, 200);
  assert.deepEqual(ws.missingSecrets(), []);
});

test('Variáveis dinâmicas do Postman e {{$env.X}}', async () => {
  const ws = tmpWorkspace(); process.env.JAIMINHO_TESTE = 'ok';
  const res = await send(ws, { request: get(`${m.urls.http}/echo?g={{$guid}}&n={{$randomInt}}&e={{$env.JAIMINHO_TESTE}}`) });
  const q = JSON.parse(res.response.body).query;
  assert.match(q.g, /^[0-9a-f-]{36}$/); assert.match(q.n, /^\d+$/); assert.equal(q.e, 'ok');
});

for (const [name, auth, url] of [
  ['basic', { type: 'basic', basic: { username: 'jaiminho', password: 'carteiro' } }, '/auth/basic'],
  ['bearer', { type: 'bearer', bearer: { token: 'jaiminho-token' } }, '/auth/bearer'],
  ['apikey header', { type: 'apikey', apikey: { key: 'x-api-key', value: 'chave-123', in: 'header' } }, '/auth/apikey'],
  ['apikey query', { type: 'apikey', apikey: { key: 'api_key', value: 'chave-123', in: 'query' } }, '/auth/apikey'],
  ['digest', { type: 'digest', digest: { username: 'jaiminho', password: 'carteiro', algorithm: 'MD5' } }, '/auth/digest'],
]) {
  test(`Auth ${name}`, async () => {
    const ws = tmpWorkspace();
    const res = await send(ws, { request: get(m.urls.http + url, { auth }) });
    assert.equal(res.response.code, 200, res.error || res.response.body);
  });
}

test('Auth OAuth2 client credentials via script pre-request (pm.sendRequest) e auth herdada da coleção', async () => {
  const ws = tmpWorkspace();
  const col = ws.createCollection('C', {
    auth: { type: 'bearer', bearer: { token: '{{accessToken}}' } },
    scripts: { pre: `pm.sendRequest({ url: '${m.urls.http}/oauth/token', method: 'POST', header: {'Content-Type':'application/x-www-form-urlencoded'}, body: { mode: 'urlencoded', urlencoded: [{key:'grant_type',value:'client_credentials'},{key:'client_id',value:'jaiminho-app'},{key:'client_secret',value:'segredo'}] } }, (err, res) => { pm.collectionVariables.set('accessToken', res.json().access_token); });` },
  });
  const r = ws.createRequest(col, get(`${m.urls.http}/auth/bearer`));
  const res = await send(ws, { requestId: r });
  assert.equal(res.response.code, 200, res.error);
});

test('Body: JSON, urlencoded, form-data com arquivo, XML', async () => {
  const fs = require('fs'); const path = require('path');
  const ws = tmpWorkspace();
  let res = await send(ws, { request: { kind: 'http', name: 'p', method: 'POST', url: `${m.urls.http}/api/travellers`, headers: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', language: 'json', raw: '{"firstName":"Ana","lastName":"Lima"}' } } });
  assert.equal(res.response.code, 201); assert.equal(JSON.parse(res.response.body).firstName, 'Ana');
  res = await send(ws, { request: { kind: 'http', name: 'u', method: 'POST', url: `${m.urls.http}/echo`, body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }, { key: 'b', value: 'dois', enabled: false }] } } });
  assert.deepEqual(JSON.parse(res.response.body).form, { a: '1' });
  const f = path.join(ws.dir, 'data', 'arq.txt'); fs.writeFileSync(f, 'conteudo');
  res = await send(ws, { request: { kind: 'http', name: 'f', method: 'POST', url: `${m.urls.http}/echo`, body: { mode: 'formdata', formdata: [{ key: 'nome', value: 'Jaiminho', type: 'text' }, { key: 'arquivo', type: 'file', src: f }] } } });
  const form = JSON.parse(res.response.body).form;
  assert.equal(form.find((x) => x.name === 'nome').value, 'Jaiminho'); assert.equal(form.find((x) => x.name === 'arquivo').filename, 'arq.txt');
  res = await send(ws, { request: { kind: 'http', name: 'x', method: 'POST', url: `${m.urls.http}/xml/echo`, headers: [{ key: 'Content-Type', value: 'application/xml' }], body: { mode: 'raw', language: 'xml', raw: '<a><b>1</b></a>' } } });
  assert.equal(res.response.body, '<a><b>1</b></a>');
});

test('SSL: CA desconhecida falha; desligar verificação (por request e global) funciona; CA própria funciona', async () => {
  const ws = tmpWorkspace();
  let res = await send(ws, { request: get(`${m.urls.https}/api/health`) });
  assert.equal(res.ok, false); assert.match(res.error, /CA|certificado/i);
  res = await send(ws, { request: get(`${m.urls.https}/api/health`, { settings: { verifySsl: false } }) });
  assert.equal(res.response.code, 200);
  ws.saveSettings({ verifySsl: false });
  res = await send(ws, { request: get(`${m.urls.https}/api/health`) });
  assert.equal(res.response.code, 200);
  ws.saveSettings({ verifySsl: true, caCertificates: [m.certs.ca] });
  res = await send(ws, { request: get(`${m.urls.https}/api/health`) });
  assert.equal(res.response.code, 200, res.error);
});

test('mTLS: sem certificado falha com mensagem clara; PEM e PFX (.p12 com senha) funcionam', async () => {
  const ws = tmpWorkspace();
  const port = m.urls.mtls.split(':').pop();
  ws.saveSettings({ caCertificates: [m.certs.ca] });
  let res = await send(ws, { request: get(`${m.urls.mtls}/api/health`) });
  assert.equal(res.ok, false); assert.match(res.error, /certificado de cliente/);
  ws.saveSettings({ certificates: [{ host: `localhost:${port}`, cert: m.certs.clientCert, key: m.certs.clientKey }] });
  res = await send(ws, { request: get(`${m.urls.mtls}/api/health`) });
  assert.equal(JSON.parse(res.response.body).clientCert, 'jaiminho-client');
  ws.saveSettings({ certificates: [{ id: 'c1', host: `localhost:${port}`, pfx: m.certs.clientP12 }] });
  ws.setSecret('cert:c1:passphrase', 'jaiminho');
  res = await send(ws, { request: get(`${m.urls.mtls}/api/health`) });
  assert.equal(JSON.parse(res.response.body).clientCert, 'jaiminho-client', res.error);
});

test('Redirects: segue por padrão; desligado devolve 302', async () => {
  const ws = tmpWorkspace();
  let res = await send(ws, { request: get(`${m.urls.http}/redirect/2`) });
  assert.equal(res.response.code, 200); assert.equal(JSON.parse(res.response.body).query.redirected, 'true');
  res = await send(ws, { request: get(`${m.urls.http}/redirect/2`, { settings: { followRedirects: false } }) });
  assert.equal(res.response.code, 302);
});

test('Cookies: guardados no jar do workspace e reenviados; limpar funciona', async () => {
  const ws = tmpWorkspace();
  await send(ws, { request: get(`${m.urls.http}/cookies/set?sessao=abc`) });
  let res = await send(ws, { request: get(`${m.urls.http}/cookies`) });
  assert.equal(JSON.parse(res.response.body).cookies.sessao, 'abc');
  assert.ok(cookies.list(ws).some((c) => c.name === 'sessao'));
  cookies.clear(ws);
  res = await send(ws, { request: get(`${m.urls.http}/cookies`) });
  assert.deepEqual(JSON.parse(res.response.body).cookies, {});
});

test('Timeout, conexão recusada e gzip', async () => {
  const ws = tmpWorkspace();
  let res = await send(ws, { request: get(`${m.urls.http}/delay/1500`, { settings: { timeoutMs: 300 } }) });
  assert.equal(res.ok, false); assert.match(res.error, /tempo|timed? ?out|ESOCKETTIMEDOUT|ETIMEDOUT/i);
  res = await send(ws, { request: get('http://127.0.0.1:1/x') });
  assert.equal(res.ok, false); assert.match(res.error, /recusada/);
  res = await send(ws, { request: get(`${m.urls.http}/gzip`) });
  assert.equal(JSON.parse(res.response.body).gzipped, true);
});

test('Scripts de coleção e pasta rodam na ordem coleção → pasta → request', async () => {
  const ws = tmpWorkspace();
  const col = ws.createCollection('C', { scripts: { pre: 'console.log("1-colecao")' } });
  const f = ws.createFolder(col, 'F', { scripts: { pre: 'console.log("2-pasta")' } });
  const r = ws.createRequest(f, get(`${m.urls.http}/api/health`, { scripts: { pre: 'console.log("3-request")' } }));
  const res = await send(ws, { requestId: r });
  assert.deepEqual(res.console.map((c) => c.args[0]), ['1-colecao', '2-pasta', '3-request']);
});
