'use strict';
// QA: import/export — cURL (bash/cmd/PowerShell), Postman v2.1, ambiente, Swagger, WSDL, bundle .jaiminho.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const JSZip = require(require.resolve('jszip', { paths: [path.join(__dirname, '..', 'packages', 'engine')] }));
const { J, check, finish, getMocks, tmpWs, bodyJson } = require('./lib');

(async () => {
  const m = await getMocks();
  const H = m.urls.http; const port = H.split(':').pop();

  // ---------------- cURL ----------------
  const curlCase = async (desc, text, verify, { send = true } = {}) => check('curl', desc, async () => {
    const ws = tmpWs();
    let res; try { res = await J.importAuto(ws, { text }); } catch (e) { return { pass: false, evidence: `import falhou: ${e.message}` }; }
    const req = ws.get(res.requestId);
    let r; if (send) r = await J.send(ws, { requestId: res.requestId });
    return verify(req, r && bodyJson(r), r, res);
  });
  await curlCase('bash multilinha com \\, -H, --data-raw JSON aninhado com aspas', `curl -X POST '${H}/echo?x=1' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-A: b' \\\n  --data-raw '{"a":{"b":"c \\"q\\""},"l":[1,2]}'`,
    (req, j) => ({ pass: j.json && j.json.a.b === 'c "q"' && j.headers['x-a'] === 'b' && j.query.x === '1', evidence: `${req.method} ${req.url} body=${j.body}` }));
  await curlCase('cmd do Windows ("Copy as cURL (cmd)" do Chrome: ^ e ^\\^" e ^{)', `curl ^"${H}/echo^" ^\n  -H ^"content-type: application/json^" ^\n  -H ^"X-A: 1^" ^\n  --data-raw ^"^{^\\^"a^\\^":1^}^"`,
    (req, j) => ({ pass: j && j.headers['x-a'] === '1' && j.method === 'POST' && j.json && j.json.a === 1, evidence: `${req.method} ${req.url} body enviado=${j && j.body}` }));
  await curlCase('PowerShell com crase e curl.exe', `curl.exe -X PUT "${H}/echo" \`\n  -H "X-A: 1" \`\n  -d "a=1"`,
    (req, j) => ({ pass: j && j.method === 'PUT' && j.headers['x-a'] === '1', evidence: `${req.method} ${req.url} body=${j && j.body}` }));
  await curlCase('--data-urlencode (2x) vira urlencoded e chega decodificado', `curl ${H}/echo --data-urlencode 'q=a b&c' --data-urlencode 'n=ç'`,
    (req, j) => ({ pass: j && j.form && j.form.q === 'a b&c' && j.form.n === 'ç', evidence: `mode=${req.body.mode} form=${JSON.stringify(j && j.form)} raw=${j && j.body}` }));
  await curlCase('-G com -d vira query string GET', `curl -G ${H}/echo -d 'a=1' -d 'b=2'`,
    (req, j) => ({ pass: j && j.method === 'GET' && j.query.a === '1' && j.query.b === '2', evidence: `${req.method} url=${req.url} params=${JSON.stringify(req.params)} body=${JSON.stringify(req.body)}` }));
  await curlCase('-F texto e -F arquivo (@)', `curl ${H}/echo -F 'nome=José' -F 'arq=@${path.join(os.tmpdir(), 'qa-curl-up.txt')}'`,
    (req, j) => ({ pass: req.body.mode === 'formdata' && req.body.formdata.some((f) => f.type === 'file') && j && j.form, evidence: JSON.stringify(req.body) }));
  fs.writeFileSync(path.join(os.tmpdir(), 'qa-curl-up.txt'), 'oi');
  await curlCase('--compressed é aceito (Accept-Encoding)', `curl --compressed ${H}/gzip`,
    (req, j) => ({ pass: j && j.gzipped === true, evidence: JSON.stringify(req.headers) }));
  await curlCase('-X DELETE sem body', `curl -X DELETE ${H}/echo`, (req, j) => ({ pass: j && j.method === 'DELETE' && req.body.mode === 'none', evidence: JSON.stringify(req.body) }));
  await curlCase("-H 'Cookie: a=1; b=2' é enviado", `curl ${H}/cookies -H 'Cookie: a=1; b=2'`, (req, j) => ({ pass: j && j.cookies.a === '1' && j.cookies.b === '2', evidence: JSON.stringify(j && j.cookies) }));
  await curlCase('-b (cookie) é enviado', `curl ${H}/cookies -b 'a=1'`, (req, j) => ({ pass: j && j.cookies.a === '1', evidence: `headers=${JSON.stringify(req.headers)} cookies=${JSON.stringify(j && j.cookies)}` }));
  await curlCase('-u user:senha vira Basic auth', `curl -u jaiminho:carteiro ${H}/auth/basic`, (req, j, r) => ({ pass: r.response.code === 200 && req.auth.type === 'basic', evidence: JSON.stringify(req.auth) }));
  await curlCase('Authorization: Bearer vira auth Bearer', `curl ${H}/auth/bearer -H 'Authorization: Bearer jaiminho-token'`, (req, j, r) => ({ pass: r.response.code === 200 && req.auth.type === 'bearer', evidence: JSON.stringify(req.auth) }));
  await curlCase('-k vira SSL off', `curl -k ${m.urls.https}/echo`, (req, j, r) => ({ pass: req.settings.verifySsl === false && r.ok, evidence: JSON.stringify(req.settings) }));
  await curlCase('-sSk (flags combinadas) vira SSL off', `curl -sSk ${m.urls.https}/echo`, (req, j, r) => ({ pass: (req.settings || {}).verifySsl === false && r.ok, evidence: `settings=${JSON.stringify(req.settings)} error=${r.error}` }));
  await curlCase('-L e -I (HEAD)', `curl -I ${H}/echo`, (req) => ({ pass: req.method === 'HEAD', evidence: req.method }), { send: false });
  await curlCase('URL sem protocolo (curl localhost:porta/echo)', `curl localhost:${port}/echo`, (req, j, r) => ({ pass: r.ok, evidence: `url=${req.url} error=${r.error}` }));
  await curlCase('cURL com {{variável}} preservada', `curl '{{baseUrl}}/echo' -H 'X: {{tok}}'`, (req) => ({ pass: req.url.includes('{{baseUrl}}') && req.headers[0].value === '{{tok}}', evidence: `${req.url} ${JSON.stringify(req.headers)}` }), { send: false });
  await curlCase('cURL do DevTools Chrome ("Copy as cURL (bash)") com $\'..\' e --data-raw', `curl '${H}/echo' \\\n  -H 'accept: application/json' \\\n  -H 'content-type: application/json' \\\n  --data-raw $'{"t":"linha1\\\\nlinha2"}'`,
    (req, j) => ({ pass: j && j.method === 'POST' && j.json && j.json.t === 'linha1\nlinha2', evidence: `body=${JSON.stringify(req.body)} recebido=${j && j.body}` }));
  await curlCase('SOAP colado via cURL vira request SOAP', `curl -X POST '${H}/soap/TravellerService' -H 'Content-Type: text/xml; charset=utf-8' -H 'SOAPAction: "urn:GetTraveller"' -d '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body/></soapenv:Envelope>'`,
    (req) => ({ pass: req.kind === 'soap' && req.soap.action === 'urn:GetTraveller', evidence: JSON.stringify({ kind: req.kind, soap: req.soap }) }), { send: false });
  await curlCase('Texto "$ curl ..." (prompt copiado) é reconhecido', `$ curl ${H}/echo`, (req, j) => ({ pass: !!j, evidence: 'ok' }));
  await check('curl', 'Export cURL bash/cmd/PowerShell → reimport preserva método/headers/corpo JSON com aspas e acento', async () => {
    const req = J.model.newRequest({ method: 'POST', url: `${H}/echo?a=1&b=ç`, headers: [{ key: 'X-A', value: 'v "q"' }], body: { mode: 'raw', language: 'json', raw: '{"a":"it\'s \\"x\\" ç"}' }, settings: { verifySsl: false } });
    const out = {};
    for (const flavor of ['bash', 'cmd', 'powershell']) {
      const txt = await J.curl.exportCurl(req, { flavor });
      let back; try { back = (await J.curl.importCurl(txt)).request; } catch (e) { out[flavor] = { ok: false, err: e.message, txt }; continue; }
      const ok = back.method === 'POST' && back.headers.some((h) => h.key === 'X-A' && h.value === 'v "q"') && (() => { try { return JSON.parse(back.body.raw).a === 'it\'s "x" ç'; } catch { return false; } })() && back.settings.verifySsl === false;
      out[flavor] = { ok, txt: ok ? undefined : txt, back: ok ? undefined : { h: back.headers, b: back.body.raw, s: back.settings } };
    }
    return { pass: Object.values(out).every((o) => o.ok), evidence: JSON.stringify(out) };
  });
  await check('curl', 'Export cURL bash executado de verdade no shell chega igual no servidor', async () => {
    const req = J.model.newRequest({ method: 'POST', url: `${H}/echo`, headers: [{ key: 'X-A', value: "it's" }], body: { mode: 'raw', language: 'json', raw: '{"a":"it\'s ç"}' } });
    const txt = await J.curl.exportCurl(req, { flavor: 'bash' });
    const out = await new Promise((res, rej) => require('child_process').exec(txt + ' -s', { shell: '/bin/bash', timeout: 10000, env: { ...process.env, no_proxy: '*' } }, (e, so) => (e ? rej(e) : res(so))));
    const j = JSON.parse(out);
    return { pass: j.headers['x-a'] === "it's" && j.json.a === "it's ç", evidence: txt };
  });
  await check('curl', 'Export cURL com auth herdada da coleção (resolveRequest materializa)', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C', { auth: { type: 'bearer', bearer: { token: '{{tok}}' } } });
    const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'tok', value: 'T1' }] });
    const id = ws.createRequest(col, { url: `${H}/echo` });
    const rr = J.resolveRequest(ws, ws.get(id), { requestId: id, environmentId: env });
    const txt = await J.curl.exportCurl(rr, { flavor: 'bash' });
    return { pass: /Authorization: Bearer T1/.test(txt), evidence: txt };
  });
  await check('curl', 'Export cURL de form-data com arquivo e de body binário', async () => {
    const req = J.model.newRequest({ method: 'POST', url: `${H}/echo`, body: { mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: '/tmp/a b.txt' }, { key: 't', value: 'v', type: 'text' }] } });
    const txt = await J.curl.exportCurl(req, { flavor: 'bash' });
    return { pass: /--form 'f=@"\/tmp\/a b.txt"'|-F 'f=@/.test(txt) || /f=@/.test(txt), evidence: txt };
  });
  await check('curl', 'Codegen (Python requests, Node axios, Java OkHttp) gera código', async () => {
    const req = J.model.newRequest({ method: 'POST', url: `${H}/echo`, body: { mode: 'raw', language: 'json', raw: '{"a":1}' } });
    const outs = [];
    for (const [l, v] of [['python', 'Requests'], ['nodejs', 'Axios'], ['java', 'OkHttp']]) outs.push(((await J.curl.generate(req, l, v)) || '').length > 20);
    return { pass: outs.every(Boolean), evidence: JSON.stringify(outs) };
  });

  // ---------------- Postman ----------------
  const pmCol = {
    info: { _postman_id: 'abc', name: 'Coleção QA ç', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', description: 'desc' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tok}}', type: 'string' }] },
    event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ['pm.variables.set("colPre", "1")'] } }],
    variable: [{ key: 'baseUrl', value: H }, { key: 'senha', value: 's3gr3d0', type: 'secret' }, { key: 'off', value: 'x', disabled: true }],
    item: [
      { name: 'Pasta A', auth: { type: 'apikey', apikey: [{ key: 'key', value: 'x-api-key' }, { key: 'value', value: 'chave-123' }, { key: 'in', value: 'header' }] },
        event: [{ listen: 'test', script: { exec: ['pm.test("pasta", () => {})'] } }],
        item: [
          { name: 'Get com path var', request: { method: 'GET', url: { raw: '{{baseUrl}}/echo/:id?q=1&off=2', host: ['{{baseUrl}}'], path: ['echo', ':id'], query: [{ key: 'q', value: '1' }, { key: 'off', value: '2', disabled: true }], variable: [{ key: 'id', value: '77', description: 'o id' }] }, header: [{ key: 'X-H', value: 'h' }, { key: 'X-Off', value: 'n', disabled: true }] },
            response: [{ name: 'Exemplo 200', code: 200, status: 'OK', header: [{ key: 'Content-Type', value: 'application/json' }], body: '{"ok":true}' }] },
          { name: 'Auth apikey herdada', request: { method: 'GET', url: '{{baseUrl}}/auth/apikey' } },
          { name: 'Subpasta', item: [{ name: 'Form', request: { method: 'POST', url: '{{baseUrl}}/echo', body: { mode: 'formdata', formdata: [{ key: 'a', value: '1', type: 'text' }, { key: 'f', type: 'file', src: '/tmp/nao-existe.txt' }] } } }] },
        ] },
      { name: 'Sem auth', request: { method: 'GET', auth: { type: 'noauth' }, url: '{{baseUrl}}/auth/bearer' } },
      { name: 'Basic', request: { method: 'GET', auth: { type: 'basic', basic: [{ key: 'username', value: 'jaiminho' }, { key: 'password', value: 'carteiro' }] }, url: '{{baseUrl}}/auth/basic' } },
      { name: 'urlencoded', request: { method: 'POST', url: '{{baseUrl}}/echo', body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: 'b c' }] } } },
      { name: 'GraphQL', request: { method: 'POST', url: '{{baseUrl}}/echo', body: { mode: 'graphql', graphql: { query: '{ a }', variables: '{"x":1}' } } } },
      { name: 'SSL off', protocolProfileBehavior: { strictSSL: false, followRedirects: false }, request: { method: 'GET', url: '{{baseUrl}}/redirect/1' } },
      { name: 'SOAP', request: { method: 'POST', url: '{{baseUrl}}/soap/TravellerService', header: [{ key: 'Content-Type', value: 'text/xml' }, { key: 'SOAPAction', value: '"urn:x"' }], body: { mode: 'raw', raw: '<x/>' } } },
    ],
  };
  let imported; const wsP = tmpWs();
  await check('postman', 'Import coleção v2.1 completa (pastas, auth multinível, scripts, vars, path vars, examples, form-data)', async () => {
    imported = await J.importAuto(wsP, { text: JSON.stringify(pmCol) });
    const t = wsP.tree(); const c = t.collections[0];
    const cnt = (n) => (n.children || []).reduce((a, x) => a + (x.type === 'request' ? 1 : cnt(x)), 0);
    return { pass: imported.type === 'collection' && cnt(c) === 9 && c.name === 'Coleção QA ç', evidence: JSON.stringify(imported.report) };
  });
  const findReq = (name) => { for (const [id, n] of wsP.index) if (n.type === 'request' && wsP.get(id).name === name) return id; };
  await check('postman', 'Coleção importada: segredo não fica no YAML e var disabled preservada', async () => {
    const yaml = fs.readFileSync(wsP.info(imported.collectionId).file, 'utf8');
    const vars = wsP.get(imported.collectionId).vars;
    return { pass: !yaml.includes('s3gr3d0') && vars.find((v) => v.key === 'senha').secret && vars.find((v) => v.key === 'off').enabled === false, evidence: yaml };
  });
  await check('postman', 'Request importada com path var + query desabilitada + header desabilitado envia certo', async () => {
    const id = findReq('Get com path var'); const r = await J.send(wsP, { requestId: id }); const j = bodyJson(r);
    return { pass: j.path === '/echo/77' && JSON.stringify(j.query) === '{"q":"1"}' && j.headers['x-h'] === 'h' && !j.headers['x-off'] && j.headers.authorization === undefined && j.headers['x-api-key'] === 'chave-123', evidence: JSON.stringify({ path: j.path, q: j.query, h: j.headers['x-h'], off: j.headers['x-off'], key: j.headers['x-api-key'] }) };
  });
  await check('postman', 'Auth herdada (apikey da pasta) e noauth/basic por request', async () => {
    const a = await J.send(wsP, { requestId: findReq('Auth apikey herdada') }); const b = await J.send(wsP, { requestId: findReq('Sem auth') }); const c = await J.send(wsP, { requestId: findReq('Basic') });
    return { pass: a.response.code === 200 && b.response.code === 401 && c.response.code === 200, evidence: [a, b, c].map((x) => x.response.code).join(',') };
  });
  await check('postman', 'Script de pasta (test) e de coleção (pre) rodam na request importada', async () => {
    const r = await J.send(wsP, { requestId: findReq('Get com path var') });
    return { pass: r.tests.some((t) => t.name === 'pasta'), evidence: JSON.stringify(r.tests) };
  });
  await check('postman', 'protocolProfileBehavior (strictSSL/followRedirects) importado', async () => {
    const r = await J.send(wsP, { requestId: findReq('SSL off') });
    return { pass: r.response.code === 302, evidence: `${r.response.code} settings=${JSON.stringify(wsP.get(findReq('SSL off')).settings)}` };
  });
  await check('postman', 'SOAP do Postman vira request SOAP', async () => {
    const r = wsP.get(findReq('SOAP'));
    return { pass: r.kind === 'soap' && r.soap.action === 'urn:x', evidence: JSON.stringify({ kind: r.kind, soap: r.soap }) };
  });
  await check('postman', 'Examples (responses salvas) importados', async () => {
    const r = wsP.get(findReq('Get com path var'));
    return { pass: r.examples && r.examples[0] && r.examples[0].status === 200, evidence: JSON.stringify(r.examples) };
  });
  await check('postman', 'Export Postman → reimport no Postman-format (ida e volta) mantém tudo', async () => {
    const exp = J.postman.exportCollection(wsP, imported.collectionId);
    const ws2 = tmpWs(); const res = await J.importAuto(ws2, { text: JSON.stringify(exp) });
    const exp2 = J.postman.exportCollection(ws2, res.collectionId);
    const strip = (o) => JSON.stringify(o, (k, v) => (k === 'id' || k === '_postman_id' ? undefined : v));
    return { pass: strip(exp) === strip(exp2), evidence: strip(exp) === strip(exp2) ? 'idêntico' : `difere: ${strip(exp).length} vs ${strip(exp2).length}` };
  });
  await check('postman', 'Export Postman passa no validador de schema do postman-collection (sdk)', async () => {
    const exp = J.postman.exportCollection(wsP, imported.collectionId);
    const sdk = require(require.resolve('postman-collection', { paths: [path.join(__dirname, '..', 'packages', 'engine')] }));
    const c = new sdk.Collection(exp);
    return { pass: c.items.count() > 0 && JSON.stringify(c.toJSON()).includes('Get com path var'), evidence: `itens=${c.items.count()}` };
  });
  await check('postman', 'Export Postman de request gRPC → reimport no Jaiminho continua gRPC', async () => {
    const ws = tmpWs(); const col = ws.createCollection('G');
    ws.createRequest(col, { kind: 'grpc', name: 'g', url: `grpc://${m.urls.grpc}`, grpc: { method: 'jaiminho.mock.v1.TravellerService/GetTraveller', schema: { source: 'reflection' }, metadata: [], message: '{"id":"1"}' } });
    const exp = J.postman.exportCollection(ws, col);
    const ws2 = tmpWs(); const res = await J.importAuto(ws2, { text: JSON.stringify(exp) });
    const id = ws2.children(res.collectionId)[0]; const r = ws2.get(id);
    return { pass: r.kind === 'grpc', evidence: `kind após reimport=${r.kind} method=${r.method} url=${r.url}` };
  });
  await check('postman', 'Export Postman de request com vars de pasta (Jaiminho) — informativo', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const f = ws.createFolder(col, 'F', { vars: [{ key: 'fv', value: '1' }] });
    ws.createRequest(f, { url: '{{fv}}' });
    const exp = J.postman.exportCollection(ws, col);
    return { pass: true, evidence: `vars de pasta no export: ${JSON.stringify(exp.item[0].variable)} (Postman v2.1 aceita "variable" em pasta)` };
  });
  await check('postman', 'Import ambiente Postman com secret (valor vai para o cofre, não para o YAML)', async () => {
    const ws = tmpWs();
    const res = await J.importAuto(ws, { text: JSON.stringify({ id: 'e', name: 'Prod', values: [{ key: 'url', value: H, enabled: true }, { key: 'pwd', value: 'p@ss', type: 'secret', enabled: true }, { key: 'off', value: '1', enabled: false }], _postman_variable_scope: 'environment' }) });
    const yaml = fs.readFileSync(ws.info(res.environmentId).file, 'utf8');
    const eff = ws.effectiveVars(`env:${res.environmentId}`, ws.getEnvironment(res.environmentId).vars);
    return { pass: !yaml.includes('p@ss') && eff.find((v) => v.key === 'pwd').value === 'p@ss' && !eff.find((v) => v.key === 'off'), evidence: yaml };
  });
  await check('postman', 'Export ambiente: segredo sai vazio', async () => {
    const ws = tmpWs(); const id = ws.saveEnvironment({ name: 'E', vars: [{ key: 's', value: 'x', secret: true }, { key: 'p', value: 'y' }] });
    const e = J.postman.exportEnvironment(ws, id);
    return { pass: e.values.find((v) => v.key === 's').value === '' && e.values.find((v) => v.key === 'p').value === 'y', evidence: JSON.stringify(e.values) };
  });
  await check('postman', 'Import globals do Postman', async () => {
    const ws = tmpWs(); await J.importAuto(ws, { text: JSON.stringify({ name: 'Globals', _postman_variable_scope: 'globals', values: [{ key: 'g', value: '1', enabled: true }] }) });
    return { pass: ws.getGlobals().some((v) => v.key === 'g'), evidence: JSON.stringify(ws.getGlobals()) };
  });
  await check('postman', 'Import Postman Collection v2.0 (formato antigo, auth como objeto)', async () => {
    const ws = tmpWs();
    const res = await J.importAuto(ws, { text: JSON.stringify({ info: { name: 'v2.0', schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' }, item: [{ name: 'b', request: { url: `${H}/auth/basic`, method: 'GET', auth: { type: 'basic', basic: { username: 'jaiminho', password: 'carteiro' } } } }] }) });
    const id = ws.children(res.collectionId)[0]; const r = await J.send(ws, { requestId: id });
    return { pass: r.response.code === 200, evidence: `${r.response.code} auth=${JSON.stringify(ws.get(id).auth)}` };
  });
  await check('postman', 'Import Postman com URL como objeto sem raw (host/path arrays)', async () => {
    const ws = tmpWs();
    const res = await J.importAuto(ws, { text: JSON.stringify({ info: { name: 'x', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: 'n', request: { method: 'GET', url: { protocol: 'http', host: ['127', '0', '0', '1'], port: port, path: ['echo'], query: [{ key: 'a', value: '1' }] } } }] }) });
    const id = ws.children(res.collectionId)[0]; const r = await J.send(ws, { requestId: id });
    return { pass: r.ok && bodyJson(r).query.a === '1', evidence: `url=${ws.get(id).url} ${r.error || JSON.stringify(bodyJson(r).query)}` };
  });
  await check('postman', 'Import Postman com request description objeto e item sem request', async () => {
    const ws = tmpWs();
    const res = await J.importAuto(ws, { text: JSON.stringify({ info: { name: 'x', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: 'só nome' }, { name: 'd', request: { method: 'GET', url: H, description: { content: 'texto', type: 'text/markdown' } } }] }) });
    return { pass: res.report.requests === 1, evidence: JSON.stringify(res.report) };
  });

  // ---------------- Swagger / OpenAPI ----------------
  await check('openapi', 'Swagger 3 por URL direta (JSON) com createEnvironments', async () => {
    const ws = tmpWs(); const res = await J.importAuto(ws, { url: `${H}/v3/api-docs`, createEnvironments: true });
    const reqs = [...ws.index.values()].filter((n) => n.type === 'request').length;
    return { pass: res.type === 'openapi' && reqs > 0, evidence: `${reqs} requests, envs=${res.environments.length} spec=${JSON.stringify(res.spec)}` };
  });
  await check('openapi', 'Swagger por URL YAML', async () => {
    const ws = tmpWs(); const res = await J.importAuto(ws, { url: `${H}/v3/api-docs.yaml` });
    return { pass: res.type === 'openapi', evidence: JSON.stringify(res.spec) };
  });
  await check('openapi', 'Swagger 2.0 por URL', async () => {
    const ws = tmpWs(); const res = await J.importAuto(ws, { url: `${H}/v2/swagger.json` });
    return { pass: res.type === 'openapi' && res.spec.openapi === '2.0', evidence: JSON.stringify(res.spec) };
  });
  await check('openapi', 'Swagger pela URL do Swagger UI (springdoc) e pela base do serviço', async () => {
    const ws = tmpWs(); const a = await J.importAuto(ws, { url: `${H}/swagger-ui/index.html` }); const b = await J.importAuto(ws, { url: `${H}/` });
    return { pass: a.type === 'openapi' && b.type === 'openapi', evidence: `${JSON.stringify(a.spec)} ${JSON.stringify(b.spec)}` };
  });
  await check('openapi', 'Requests importadas do Swagger funcionam (baseUrl resolvido)', async () => {
    const ws = tmpWs(); const res = await J.importAuto(ws, { url: `${H}/v3/api-docs` });
    const out = [];
    for (const [id, n] of ws.index) if (n.type === 'request') { const rq = ws.get(id); if (rq.method === 'GET') { const r = await J.send(ws, { requestId: id }); out.push(`${rq.name}:${r.response ? r.response.code : r.error}`); } }
    return { pass: out.length > 0 && out.some((o) => /:200/.test(o)), evidence: out.join(' | ') };
  });
  // servidor springdoc com context-path /api
  const ctxSrv = http.createServer((rq, rs) => {
    const base = `http://${rq.headers.host}`;
    if (rq.url === '/api/swagger-ui/index.html') { rs.writeHead(200, { 'content-type': 'text/html' }); return rs.end('<html><title>Swagger UI</title><div id="swagger-ui"></div></html>'); }
    if (rq.url === '/api/v3/api-docs/swagger-config') { rs.writeHead(200, { 'content-type': 'application/json' }); return rs.end(JSON.stringify({ url: '/api/v3/api-docs', urls: [{ name: 'g', url: '/api/v3/api-docs' }] })); }
    if (rq.url === '/api/v3/api-docs') { rs.writeHead(200, { 'content-type': 'application/json' }); return rs.end(JSON.stringify({ openapi: '3.0.1', info: { title: 'Ctx', version: '1' }, servers: [{ url: `${base}/api` }], paths: { '/ping': { get: { responses: { 200: { description: 'ok' } } } } } })); }
    rs.writeHead(404); rs.end('nao');
  });
  await new Promise((r) => ctxSrv.listen(0, '127.0.0.1', r));
  const ctxPort = ctxSrv.address().port;
  await check('openapi', 'Swagger UI com context-path (/api/swagger-ui/index.html) — springdoc atrás de context path', async () => {
    const ws = tmpWs();
    try { const res = await J.importAuto(ws, { url: `http://127.0.0.1:${ctxPort}/api/swagger-ui/index.html` }); return { pass: res.type === 'openapi', evidence: JSON.stringify(res.spec) }; } catch (e) { return { pass: false, evidence: e.message }; }
  });
  await check('openapi', 'Swagger por arquivo com $ref (componentes) gera body de exemplo', async () => {
    const spec = { openapi: '3.0.0', info: { title: 'Ref', version: '1' }, servers: [{ url: H }], paths: { '/echo': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/T' } } } }, responses: { 200: { description: 'ok' } } } } }, components: { schemas: { T: { type: 'object', properties: { nome: { type: 'string', example: 'Ana' }, idade: { type: 'integer' } } } } } };
    const f = path.join(os.tmpdir(), 'qa-ref.json'); fs.writeFileSync(f, JSON.stringify(spec));
    const ws = tmpWs(); const res = await J.importAuto(ws, { buffer: fs.readFileSync(f), fileName: f });
    const ids = [...ws.index].filter(([, n]) => n.type === 'request').map(([id]) => id); const rq = ws.get(ids[0]);
    return { pass: /Ana/.test(rq.body.raw || ''), evidence: JSON.stringify(rq.body) };
  });
  await check('openapi', 'Swagger com $ref para ARQUIVO externo (./schemas.yaml) — informativo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ext-')); fs.writeFileSync(path.join(dir, 'schemas.yaml'), 'T:\n  type: object\n  properties:\n    nome: { type: string, example: Bia }\n');
    const spec = `openapi: 3.0.0\ninfo: { title: Ext, version: '1' }\npaths:\n  /echo:\n    post:\n      requestBody:\n        content:\n          application/json:\n            schema: { $ref: './schemas.yaml#/T' }\n      responses: { '200': { description: ok } }\n`;
    fs.writeFileSync(path.join(dir, 'api.yaml'), spec);
    const ws = tmpWs();
    try { const res = await J.importAuto(ws, { buffer: fs.readFileSync(path.join(dir, 'api.yaml')), fileName: path.join(dir, 'api.yaml') }); const id = [...ws.index].find(([, n]) => n.type === 'request')[0]; return { pass: /Bia/.test(ws.get(id).body.raw || ''), evidence: JSON.stringify(ws.get(id).body) }; } catch (e) { return { pass: false, evidence: e.message }; }
  });
  await check('openapi', 'Coleção importada por arquivo não grava caminho ABSOLUTO no YAML partilhado', async () => {
    const ws = tmpWs(); const res = await J.openapi.importOpenApi(ws, { file: path.join(os.tmpdir(), 'qa-ref.json') });
    const yaml = fs.readFileSync(ws.info(res.collectionId).file, 'utf8');
    return { pass: !yaml.includes(os.tmpdir()), evidence: yaml.split('\n').filter((l) => /file|url/.test(l)).join(' | ') };
  });
  await check('openapi', 'Sincronizar Swagger (importado por URL): detecta nova/alterada/removida e aplica mantendo scripts', async () => {
    let version = 1;
    const srv = http.createServer((rq, rs) => {
      const paths = version === 1 ? { '/a': { get: { responses: { 200: { description: 'ok' } } } }, '/b': { get: { responses: { 200: { description: 'ok' } } } } }
        : { '/a': { get: { parameters: [{ name: 'novo', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'ok' } } } }, '/c': { post: { responses: { 200: { description: 'ok' } } } } };
      rs.writeHead(200, { 'content-type': 'application/json' }); rs.end(JSON.stringify({ openapi: '3.0.0', info: { title: 'S', version: String(version) }, servers: [{ url: 'http://x' }], paths }));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/v3/api-docs`;
    const ws = tmpWs(); const res = await J.importAuto(ws, { url });
    const aId = [...ws.index].find(([id, n]) => n.type === 'request' && ws.get(id).url.endsWith('/a'))[0];
    ws.save(aId, { ...ws.get(aId), scripts: { post: 'pm.test("meu", () => {})' } });
    version = 2;
    const diff = await J.openapi.syncOpenApi(ws, res.collectionId, { fetchText: J.fetchTextVia(ws), apply: true });
    srv.close();
    const a = ws.get(aId);
    return { pass: diff.added.length === 1 && diff.removed.length === 1 && diff.changed.length === 1 && a.scripts.post && a.params.some((p) => p.key === 'novo'), evidence: JSON.stringify({ added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length, scripts: a.scripts, params: a.params }) };
  });
  await check('openapi', 'Sincronizar Swagger importado por ARQUIVO/colado (como o app faz: texto) sem reenviar o texto', async () => {
    const ws = tmpWs(); const res = await J.importAuto(ws, { buffer: fs.readFileSync(path.join(os.tmpdir(), 'qa-ref.json')), fileName: path.join(os.tmpdir(), 'qa-ref.json') });
    try { const d = await J.openapi.syncOpenApi(ws, res.collectionId, { fetchText: J.fetchTextVia(ws) }); return { pass: true, evidence: JSON.stringify(d) }; } catch (e) { return { pass: false, evidence: e.message }; }
  });
  await check('openapi', 'Swagger inválido → erro claro', async () => {
    const ws = tmpWs(); try { await J.importAuto(ws, { text: '{"openapi":"3.0.0","info":{}}' }); return { pass: false, evidence: 'aceitou' }; } catch (e) { return { pass: /Swagger|Conversão|inválid|falhou/i.test(e.message), evidence: e.message }; }
  });

  // ---------------- WSDL ----------------
  await check('wsdl', 'WSDL por URL (?wsdl) cria operações SOAP 1.1 e 1.2', async () => {
    const ws = tmpWs(); const res = await J.importAuto(ws, { url: `${H}/soap/TravellerService?wsdl` });
    const vers = new Set([...ws.index].filter(([, n]) => n.type === 'request').map(([id]) => ws.get(id).soap.version));
    return { pass: res.type === 'wsdl' && vers.has('1.1') && vers.has('1.2'), evidence: `${res.operations} ops versões=${[...vers]}` };
  });
  await check('wsdl', 'WSDL por URL "?singleWsdl" (WCF/.NET) ou "?WSDL" maiúsculo', async () => {
    const ws = tmpWs(); const out = [];
    for (const u of [`${H}/soap/TravellerService?WSDL`, `${H}/soap/TravellerService?singleWsdl`]) { try { const r = await J.importAuto(ws, { url: u }); out.push(`${u.split('?')[1]}:${r.type}`); } catch (e) { out.push(`${u.split('?')[1]}:ERRO ${e.message.slice(0, 80)}`); } }
    return { pass: out.every((o) => /:wsdl$/.test(o)), evidence: out.join(' | ') };
  });
  await check('wsdl', 'WSDL colado como texto', async () => {
    const r = await J.send(tmpWs(), { request: J.model.newRequest({ url: `${H}/soap/TravellerService?wsdl` }) });
    const ws = tmpWs(); const res = await J.importAuto(ws, { text: r.response.body });
    return { pass: res.type === 'wsdl' && res.operations > 0, evidence: `${res.operations}` };
  });
  await check('wsdl', 'WSDL com prefixo de binding SOAP 1.2 diferente de "soap12:" (ex.: "s12:")', async () => {
    const r = await J.send(tmpWs(), { request: J.model.newRequest({ url: `${H}/soap/TravellerService?wsdl` }) });
    const t = r.response.body.replace(/xmlns:soap12=/g, 'xmlns:s12=').replace(/soap12:/g, 's12:');
    const info = J.wsdl.parseWsdl(t);
    const vers = info.services.flatMap((s) => s.ports.map((p) => p.version));
    return { pass: vers.includes('1.2'), evidence: `versões detectadas=${vers}` };
  });
  await check('wsdl', 'WSDL 2.0 → mensagem clara', async () => {
    const ws = tmpWs();
    try { await J.importAuto(ws, { text: '<description xmlns="http://www.w3.org/ns/wsdl"><types/></description>' }); return { pass: false, evidence: 'aceitou' }; } catch (e) { return { pass: /WSDL|reconhecido/i.test(e.message), evidence: e.message }; }
  });

  // ---------------- Bundle ----------------
  await check('bundle', 'Bundle workspace: ida e volta entre dois workspaces sem segredos nem .jaiminho/', async () => {
    const a = tmpWs('A'); const col = a.createCollection('Col B'); a.createRequest(col, { name: 'r', url: `${H}/echo` });
    a.saveEnvironment({ name: 'E', vars: [{ key: 's', value: 'SUPERSEGREDO', secret: true }] }); a.setLocalValue('glo', 'x', 'LOCALVAL'); a.addHistory({ name: 'h' });
    const buf = await J.bundle.exportBundle(a);
    const zip = await JSZip.loadAsync(buf); const names = Object.keys(zip.files);
    const all = (await Promise.all(names.filter((n) => !zip.files[n].dir).map((n) => zip.file(n).async('string')))).join('\n');
    const b = tmpWs('B'); const res = await J.importAuto(b, { buffer: buf, fileName: 'x.jaiminho' });
    return { pass: !names.some((n) => n.startsWith('.jaiminho')) && !all.includes('SUPERSEGREDO') && !all.includes('LOCALVAL') && b.tree().collections.length === 1 && b.missingSecrets().length === 1, evidence: `arquivos=${names.join(',')} res=${JSON.stringify(res)}` };
  });
  await check('bundle', 'Bundle reimportado no MESMO workspace (keep-both) cria cópia com ids novos', async () => {
    const a = tmpWs('A'); const col = a.createCollection('X'); const f = a.createFolder(col, 'F'); a.createRequest(f, { name: 'r', url: `${H}/echo` });
    const buf = await J.bundle.exportBundle(a, { type: 'collection', id: col });
    await J.bundle.importBundle(a, buf);
    const ids = [...a.index.keys()];
    const cols = a.tree().collections.map((c) => c.name);
    return { pass: new Set(ids).size === ids.length && cols.length === 2 && a.index.size === 6, evidence: `coleções=${JSON.stringify(cols)} itens=${a.index.size}` };
  });
  await check('bundle', 'Bundle com conflito: overwrite e skip', async () => {
    const a = tmpWs('A'); const col = a.createCollection('X'); a.createRequest(col, { name: 'r1', url: 'u' });
    const buf = await J.bundle.exportBundle(a, { type: 'collection', id: col });
    a.createRequest(col, { name: 'r2', url: 'u' });
    const sk = await J.bundle.importBundle(a, buf, { strategy: 'skip' });
    const afterSkip = a.children(col).length;
    await J.bundle.importBundle(a, buf, { strategy: 'overwrite' });
    return { pass: sk.skipped.length === 1 && afterSkip === 2 && a.children(col).length === 1 && a.tree().collections.length === 1, evidence: `skip=${JSON.stringify(sk)} filhos após overwrite=${a.children(col).length}` };
  });
  await check('bundle', 'Bundle corrompido (byte alterado) é recusado com mensagem', async () => {
    const a = tmpWs('A'); a.createCollection('X'); const buf = await J.bundle.exportBundle(a);
    const zip = await JSZip.loadAsync(buf); const name = Object.keys(zip.files).find((n) => n.endsWith('_collection.yaml'));
    zip.file(name, 'name: hackeado\n'); const bad = await zip.generateAsync({ type: 'nodebuffer' });
    try { await J.bundle.importBundle(tmpWs(), bad); return { pass: false, evidence: 'aceitou' }; } catch (e) { return { pass: /corrompido|hash/i.test(e.message), evidence: e.message }; }
  });
  await check('bundle', 'Arquivo .jaiminho que não é zip → erro claro', async () => {
    try { await J.importAuto(tmpWs(), { buffer: Buffer.from('lixo'), fileName: 'a.jaiminho' }); return { pass: false, evidence: 'aceitou' }; } catch (e) { return { pass: /bundle|zip|corrompido/i.test(e.message), evidence: e.message }; }
  });
  await check('bundle', 'SEGURANÇA: bundle malicioso com caminho "../" não escreve fora do workspace (zip slip)', async () => {
    const target = path.join(os.tmpdir(), `qa-zipslip-${Date.now()}.txt`);
    const ws = tmpWs(); const rel = path.relative(ws.dir, target).split(path.sep).join('/');
    const zip = new JSZip(); const content = Buffer.from('pwned');
    zip.file(rel, content, { createFolders: false });
    zip.file('manifest.json', JSON.stringify({ format: 'jaiminho-bundle', version: 1, contents: [{ path: rel, sha256: require('crypto').createHash('sha256').update(content).digest('hex'), size: 5 }] }));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    let err; try { await J.bundle.importBundle(ws, buf); } catch (e) { err = e.message; }
    const escaped = fs.existsSync(target);
    return { pass: !escaped, evidence: escaped ? `ESCREVEU FORA DO WORKSPACE: ${target} (path no zip: ${rel})` : `bloqueado: ${err}` };
  });
  await check('bundle', 'SEGURANÇA: bundle com "collections/../.jaiminho/secrets.enc" não sobrescreve segredos locais', async () => {
    const ws = tmpWs(); ws.setSecret('k', 'v'); const before = fs.readFileSync(path.join(ws.dir, '.jaiminho', 'secrets.enc'), 'utf8');
    const zip = new JSZip(); const content = Buffer.from('lixo'); const rel = 'collections/../.jaiminho/secrets.enc';
    zip.file(rel, content);
    zip.file('manifest.json', JSON.stringify({ format: 'jaiminho-bundle', version: 1, contents: [{ path: rel, sha256: require('crypto').createHash('sha256').update(content).digest('hex'), size: 4 }] }));
    let err; try { await J.bundle.importBundle(ws, await zip.generateAsync({ type: 'nodebuffer' })); } catch (e) { err = e.message; }
    const after = fs.readFileSync(path.join(ws.dir, '.jaiminho', 'secrets.enc'), 'utf8');
    return { pass: before === after, evidence: before === after ? `bloqueado: ${err}` : 'secrets.enc foi SOBRESCRITO pelo bundle' };
  });
  await check('bundle', 'Bundle de coleção leva os .proto/.protoset usados', async () => {
    const a = tmpWs('A'); const col = a.createCollection('G'); fs.writeFileSync(path.join(a.dir, 'protos', 'x.protoset'), 'abc');
    const buf = await J.bundle.exportBundle(a, { type: 'collection', id: col });
    const zip = await JSZip.loadAsync(buf);
    return { pass: Object.keys(zip.files).includes('protos/x.protoset'), evidence: Object.keys(zip.files).join(',') };
  });
  await check('bundle', 'Bundle de coleção leva o arquivo de body grande (>4KB) e o reimport lê o body', async () => {
    const a = tmpWs('A'); const col = a.createCollection('Big'); const big = '{"x":"' + 'a'.repeat(6000) + '"}';
    a.createRequest(col, { name: 'grande', method: 'POST', url: `${H}/echo`, body: { mode: 'raw', language: 'json', raw: big } });
    const buf = await J.bundle.exportBundle(a, { type: 'collection', id: col });
    const b = tmpWs('B'); await J.bundle.importBundle(b, buf);
    const id = [...b.index].find(([, n]) => n.type === 'request')[0];
    return { pass: b.get(id).body.raw === big, evidence: `len=${(b.get(id).body.raw || '').length}` };
  });
  await check('bundle', 'Bundle de ambiente sozinho', async () => {
    const a = tmpWs('A'); const e = a.saveEnvironment({ name: 'Prod', vars: [{ key: 'u', value: '1' }] });
    const buf = await J.bundle.exportBundle(a, { type: 'environment', id: e });
    const b = tmpWs('B'); await J.bundle.importBundle(b, buf);
    return { pass: b.listEnvironments().length === 1 && b.listEnvironments()[0].name === 'Prod', evidence: JSON.stringify(b.listEnvironments()) };
  });
  await check('import', 'importAuto com texto aleatório → erro claro', async () => {
    try { await J.importAuto(tmpWs(), { text: 'oi tudo bem' }); return { pass: false }; } catch (e) { return { pass: /não reconhecido/i.test(e.message), evidence: e.message }; }
  });

  ctxSrv.close();
  await finish('05-import-export');
})();
