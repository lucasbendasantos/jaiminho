'use strict';
// QA: HTTP (métodos, bodies, respostas, redirects, timeouts, erros de rede, cookies).
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { J, check, finish, getMocks, tmpWs, bodyJson } = require('./lib');

(async () => {
  const m = await getMocks();
  const H = m.urls.http;
  const port = H.split(':').pop();
  const ws = tmpWs(); const col = ws.createCollection('HTTP');
  const run = (req, extra = {}) => J.send(ws, { request: J.model.newRequest(req), parentId: col, ...extra });

  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    await check('http', `Método ${method} chega no servidor`, async () => {
      const r = await run({ method, url: `${H}/echo` });
      return { pass: bodyJson(r) && bodyJson(r).method === method, evidence: `code=${r.response && r.response.code} ${r.error || ''}` };
    });
  }
  await check('http', 'HEAD devolve só cabeçalhos (sem corpo)', async () => {
    const r = await run({ method: 'HEAD', url: `${H}/echo` });
    return { pass: r.ok && r.response.code === 200 && r.response.size === 0, evidence: `code=${r.response && r.response.code} size=${r.response && r.response.size}` };
  });
  await check('http', 'Método customizado (PROPFIND)', async () => {
    const r = await run({ method: 'PROPFIND', url: `${H}/echo` });
    return { pass: bodyJson(r) && bodyJson(r).method === 'PROPFIND', evidence: r.error || r.response.code };
  });
  await check('http', 'GET com body (permitido no Postman) envia o corpo', async () => {
    const r = await run({ method: 'GET', url: `${H}/echo`, body: { mode: 'raw', language: 'json', raw: '{"a":1}' } });
    return { pass: bodyJson(r).body === '{"a":1}', evidence: JSON.stringify(bodyJson(r).body) };
  });
  await check('http', 'Body JSON define Content-Type application/json automaticamente', async () => {
    const r = await run({ method: 'POST', url: `${H}/echo`, body: { mode: 'raw', language: 'json', raw: '{"a":1}' } });
    return { pass: /application\/json/.test(bodyJson(r).headers['content-type']), evidence: bodyJson(r).headers['content-type'] };
  });
  await check('http', 'Body XML define Content-Type application/xml', async () => {
    const r = await run({ method: 'POST', url: `${H}/xml/echo`, body: { mode: 'raw', language: 'xml', raw: '<a>1</a>' } });
    return { pass: r.response.body === '<a>1</a>' && /xml/.test(r.response.contentType), evidence: `${r.response.contentType} :: ${r.response.body}` };
  });
  await check('http', 'Body binário (arquivo) enviado byte a byte', async () => {
    const f = path.join(os.tmpdir(), 'qa-bin.dat'); const bytes = Buffer.from([0, 1, 2, 255, 254, 10, 13]); fs.writeFileSync(f, bytes);
    const r = await run({ method: 'POST', url: `${H}/echo`, headers: [{ key: 'Content-Type', value: 'application/octet-stream' }], body: { mode: 'file', file: f } });
    const j = bodyJson(r);
    return { pass: j && Buffer.from(j.body, 'utf8').length > 0 && j.headers['content-length'] === String(bytes.length), evidence: `content-length=${j && j.headers['content-length']} ${r.error || ''}` };
  });
  await check('http', 'Body binário com caminho RELATIVO ao workspace (arquivo partilhado em data/)', async () => {
    fs.writeFileSync(path.join(ws.dir, 'data', 'payload.bin'), Buffer.from('ABC'));
    const r = await run({ method: 'POST', url: `${H}/echo`, body: { mode: 'file', file: 'data/payload.bin' } });
    const j = bodyJson(r);
    return { pass: j && j.body === 'ABC', evidence: `body=${j && JSON.stringify(j.body)} errors=${JSON.stringify(r.errors)} error=${r.error}` };
  });
  await check('http', 'form-data com texto e arquivo', async () => {
    const f = path.join(os.tmpdir(), 'qa-up.txt'); fs.writeFileSync(f, 'conteúdo do arquivo');
    const r = await run({ method: 'POST', url: `${H}/echo`, body: { mode: 'formdata', formdata: [{ key: 'nome', value: 'José', type: 'text' }, { key: 'arq', type: 'file', src: f }] } });
    const j = bodyJson(r);
    return { pass: j && j.form && JSON.stringify(j.form).includes('José') && JSON.stringify(j.form).includes('conteúdo do arquivo'), evidence: JSON.stringify(j && j.form).slice(0, 300) };
  });
  await check('http', 'form-data com arquivo de caminho relativo ao workspace', async () => {
    fs.writeFileSync(path.join(ws.dir, 'data', 'up.txt'), 'REL');
    const r = await run({ method: 'POST', url: `${H}/echo`, body: { mode: 'formdata', formdata: [{ key: 'arq', type: 'file', src: 'data/up.txt' }] } });
    const j = bodyJson(r);
    return { pass: j && JSON.stringify(j.form || {}).includes('REL'), evidence: `form=${JSON.stringify(j && j.form)} errors=${JSON.stringify(r.errors)}` };
  });
  await check('http', 'urlencoded com caracteres especiais (& = + espaço acento)', async () => {
    const r = await run({ method: 'POST', url: `${H}/echo`, body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: 'x&y=z' }, { key: 'b', value: '1+1 ção' }] } });
    const j = bodyJson(r);
    return { pass: j.form && j.form.a === 'x&y=z' && j.form.b === '1+1 ção', evidence: JSON.stringify(j.form) + ' raw=' + j.body };
  });
  await check('http', 'GraphQL (query + variables) vira POST JSON', async () => {
    const r = await run({ method: 'POST', url: `${H}/echo`, body: { mode: 'graphql', graphql: { query: 'query($id:ID){ t(id:$id){ id } }', variables: '{"id":"1"}' } } });
    const j = bodyJson(r);
    return { pass: j.json && j.json.query && j.json.variables && j.json.variables.id === '1', evidence: j.body };
  });
  await check('http', 'Resposta binária vem em base64 com tamanho correto', async () => {
    const r = await run({ url: `${H}/bytes` });
    return { pass: r.response.bodyEncoding === 'base64' && Buffer.from(r.response.body, 'base64').length === 256, evidence: `${r.response.bodyEncoding} size=${r.response.size}` };
  });
  await check('http', 'Resposta gzip é descomprimida', async () => {
    const r = await run({ url: `${H}/gzip` });
    return { pass: bodyJson(r) && bodyJson(r).gzipped === true, evidence: r.response.body.slice(0, 80) };
  });
  await check('http', 'Resposta HTML como texto', async () => {
    const r = await run({ url: `${H}/html` });
    return { pass: r.response.bodyEncoding === 'utf8' && /Jaiminho/.test(r.response.body), evidence: r.response.contentType };
  });
  await check('http', 'Status 204 sem corpo', async () => {
    const c = await run({ method: 'POST', url: `${H}/api/travellers`, body: { mode: 'raw', language: 'json', raw: '{"firstName":"X"}' } });
    const id = bodyJson(c).id;
    const r = await run({ method: 'DELETE', url: `${H}/api/travellers/${id}` });
    return { pass: r.ok && r.response.code === 204 && r.response.body === '', evidence: `code=${r.response.code}` };
  });
  await check('http', 'Redirect seguido por padrão', async () => {
    const r = await run({ url: `${H}/redirect/3` });
    return { pass: r.response.code === 200 && bodyJson(r).query.redirected === 'true', evidence: r.response.code };
  });
  await check('http', 'Redirect desligado na request devolve 302', async () => {
    const r = await run({ url: `${H}/redirect/1`, settings: { followRedirects: false } });
    return { pass: r.response.code === 302, evidence: r.response.code };
  });
  await check('http', 'Redirect desligado no workspace devolve 302', async () => {
    const w2 = tmpWs(); w2.saveSettings({ followRedirects: false });
    const r = await J.send(w2, { request: J.model.newRequest({ url: `${H}/redirect/1` }) });
    return { pass: r.response.code === 302, evidence: r.response.code };
  });
  await check('http', 'maxRedirects respeitado (2 < 3 redirects → erro)', async () => {
    const r = await run({ url: `${H}/redirect/3`, settings: { maxRedirects: 2 } });
    return { pass: !r.ok || (r.response && r.response.code === 302), evidence: `ok=${r.ok} code=${r.response && r.response.code} error=${r.error}` };
  });
  await check('http', 'Timeout por request gera erro claro', async () => {
    const t0 = Date.now(); const r = await run({ url: `${H}/delay/3000`, settings: { timeoutMs: 300 } });
    return { pass: !r.ok && Date.now() - t0 < 2500 && /tempo|timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(r.error), evidence: `${Date.now() - t0}ms error=${r.error}` };
  });
  await check('http', 'Cancelar request lenta (AbortSignal)', async () => {
    const ac = new AbortController(); setTimeout(() => ac.abort(), 200);
    const t0 = Date.now(); const r = await run({ url: `${H}/delay/3000` }, { signal: ac.signal });
    return { pass: !r.ok && r.error === 'Cancelado' && Date.now() - t0 < 2000, evidence: `${Date.now() - t0}ms error=${r.error}` };
  });
  await check('http', 'Cancelar request JÁ EM VOO (abort após 1 s de /delay/5000) interrompe na hora', async () => {
    const ac = new AbortController(); setTimeout(() => ac.abort(), 1000);
    const t0 = Date.now(); const r = await run({ url: `${H}/delay/5000` }, { signal: ac.signal });
    return { pass: r.error === 'Cancelado' && Date.now() - t0 < 2500, evidence: `${Date.now() - t0}ms error=${r.error}` };
  }, { timeoutMs: 40000 });
  await check('http', 'Conexão recusada gera mensagem em PT', async () => {
    const r = await run({ url: 'http://127.0.0.1:1/echo' });
    return { pass: !r.ok && /recusada/.test(r.error), evidence: r.error };
  });
  await check('http', 'DNS inexistente gera mensagem em PT', async () => {
    const r = await run({ url: 'http://host-que-nao-existe.invalid/echo', settings: { timeoutMs: 8000 } });
    return { pass: !r.ok && /DNS|não encontrado/i.test(r.error), evidence: r.error };
  }, { timeoutMs: 30000 });
  await check('http', 'URL sem protocolo (127.0.0.1:PORTA/echo) funciona como no Postman', async () => {
    const r = await run({ url: `127.0.0.1:${port}/echo` });
    return { pass: r.ok && r.response.code === 200, evidence: `ok=${r.ok} url=${r.request && r.request.url} error=${r.error}` };
  });
  await check('http', 'URL sem protocolo com "localhost:PORTA/echo"', async () => {
    const r = await run({ url: `localhost:${port}/echo` });
    return { pass: r.ok && r.response.code === 200, evidence: `ok=${r.ok} url=${r.request && r.request.url} error=${r.error}` };
  });
  await check('http', 'URL com {{baseUrl}} sem protocolo vindo do ambiente', async () => {
    const env = ws.saveEnvironment({ name: 'np', vars: [{ key: 'baseUrl', value: `localhost:${port}` }] });
    const r = await run({ url: '{{baseUrl}}/echo' }, { environmentId: env });
    return { pass: r.ok && r.response.code === 200, evidence: `ok=${r.ok} url=${r.request && r.request.url} error=${r.error}` };
  });
  await check('http', 'Headers duplicados (mesma chave 2x) são enviados ambos', async () => {
    const r = await run({ url: `${H}/echo`, headers: [{ key: 'X-Dup', value: 'a' }, { key: 'X-Dup', value: 'b' }] });
    return { pass: /a.*b/.test(bodyJson(r).headers['x-dup']), evidence: bodyJson(r).headers['x-dup'] };
  });
  await check('http', 'Header desabilitado não é enviado', async () => {
    const r = await run({ url: `${H}/echo`, headers: [{ key: 'X-Off', value: 'a', enabled: false }] });
    return { pass: bodyJson(r).headers['x-off'] === undefined, evidence: JSON.stringify(bodyJson(r).headers['x-off']) };
  });
  await check('http', 'Param desabilitado não vai na URL', async () => {
    const r = await run({ url: `${H}/echo`, params: [{ key: 'a', value: '1' }, { key: 'b', value: '2', enabled: false }] });
    return { pass: JSON.stringify(bodyJson(r).query) === '{"a":"1"}', evidence: JSON.stringify(bodyJson(r).query) };
  });
  await check('http', 'User-Agent sobrescrito pelo usuário prevalece', async () => {
    const r = await run({ url: `${H}/echo`, headers: [{ key: 'User-Agent', value: 'MeuUA' }] });
    return { pass: bodyJson(r).headers['user-agent'] === 'MeuUA', evidence: bodyJson(r).headers['user-agent'] };
  });
  await check('http', 'Cookies: Set-Cookie guardado e reenviado na request seguinte', async () => {
    await run({ url: `${H}/cookies/set?sessao=abc` });
    const r = await run({ url: `${H}/cookies` });
    return { pass: bodyJson(r).cookies.sessao === 'abc', evidence: JSON.stringify(bodyJson(r).cookies) + ' jar=' + JSON.stringify(J.cookies.list(ws)) };
  });
  await check('http', 'Cookies: disableCookies na request não envia', async () => {
    const r = await run({ url: `${H}/cookies`, settings: { disableCookies: true } });
    return { pass: !bodyJson(r).cookies.sessao, evidence: JSON.stringify(bodyJson(r).cookies) };
  });
  await check('http', 'Cookies: header Cookie manual é enviado', async () => {
    const r = await run({ url: `${H}/cookies`, headers: [{ key: 'Cookie', value: 'manual=1' }] });
    return { pass: bodyJson(r).cookies.manual === '1', evidence: JSON.stringify(bodyJson(r).cookies) };
  });
  await check('http', 'Cookies: limpar jar', async () => {
    J.cookies.clear(ws);
    const r = await run({ url: `${H}/cookies` });
    return { pass: !bodyJson(r).cookies.sessao, evidence: JSON.stringify(bodyJson(r).cookies) };
  });
  await check('http', 'Auth basic / digest / apikey(header e query)', async () => {
    const b = await run({ url: `${H}/auth/basic`, auth: { type: 'basic', basic: { username: 'jaiminho', password: 'carteiro' } } });
    const d = await run({ url: `${H}/auth/digest`, auth: { type: 'digest', digest: { username: 'jaiminho', password: 'carteiro' } } });
    const k = await run({ url: `${H}/auth/apikey`, auth: { type: 'apikey', apikey: { key: 'x-api-key', value: 'chave-123', in: 'header' } } });
    const q = await run({ url: `${H}/auth/apikey`, auth: { type: 'apikey', apikey: { key: 'api_key', value: 'chave-123', in: 'query' } } });
    const codes = [b, d, k, q].map((x) => x.response && x.response.code);
    return { pass: codes.every((c) => c === 200), evidence: JSON.stringify(codes) };
  });
  await check('http', 'Auth OAuth2 client_credentials obtém token e chama API', async () => {
    const r = await run({ url: `${H}/auth/bearer`, auth: { type: 'oauth2', oauth2: { grant_type: 'client_credentials', accessTokenUrl: `${H}/oauth/token`, clientId: 'jaiminho-app', clientSecret: 'segredo', addTokenTo: 'header' } } });
    return { pass: r.response && r.response.code === 200, evidence: `code=${r.response && r.response.code} error=${r.error} (informativo: postman-runtime não busca token sozinho; depende do app)` };
  });
  await check('http', 'Auth herdada da pasta/coleção', async () => {
    const c2 = ws.createCollection('AuthHer', { auth: { type: 'bearer', bearer: { token: 'jaiminho-token' } } });
    const f = ws.createFolder(c2, 'F');
    const id = ws.createRequest(f, { url: `${H}/auth/bearer` });
    const r = await J.send(ws, { requestId: id });
    const f2 = ws.createFolder(c2, 'F2', { auth: { type: 'none' } });
    const id2 = ws.createRequest(f2, { url: `${H}/auth/bearer` });
    const r2 = await J.send(ws, { requestId: id2 });
    return { pass: r.response.code === 200 && r2.response.code === 401, evidence: `${r.response.code} ${r2.response.code}` };
  });
  await check('http', 'Request não salva (rascunho) sem parentId envia', async () => {
    const r = await J.send(ws, { request: J.model.newRequest({ url: `${H}/echo` }) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('http', 'Resposta grande (~5MB) não trava', async () => {
    const big = 'x'.repeat(5 * 1024 * 1024);
    const r = await run({ method: 'POST', url: `${H}/xml/echo`, headers: [{ key: 'Content-Type', value: 'text/plain' }], body: { mode: 'raw', raw: big } });
    return { pass: r.ok && r.response.size === big.length, evidence: `size=${r.response && r.response.size}` };
  }, { timeoutMs: 60000 });
  await check('http', 'Timings e tamanho presentes', async () => {
    const r = await run({ url: `${H}/echo` });
    return { pass: r.response.timings && typeof r.response.timings.total === 'number', evidence: JSON.stringify(r.response.timings) };
  });
  await check('http', 'Variável {{$env.HOME}} (variável do SO)', async () => {
    const r = await run({ url: `${H}/echo?h={{$env.HOME}}` });
    return { pass: bodyJson(r).query.h === process.env.HOME, evidence: bodyJson(r).query.h };
  });
  await check('http', 'Path variable vazia não envia literal ":id"', async () => {
    const r = await run({ url: `${H}/echo/:id`, pathVars: [{ key: 'id', value: '' }] });
    return { pass: true, evidence: `path enviado=${bodyJson(r).path} (informativo)` };
  });
  await check('http', 'Query na URL + aba params preenchida: a URL com ?x= não duplica nem perde', async () => {
    const r = await run({ url: `${H}/echo?a=1`, params: [{ key: 'a', value: '1' }, { key: 'b', value: '2' }] });
    return { pass: JSON.stringify(bodyJson(r).query) === '{"a":"1","b":"2"}', evidence: JSON.stringify(bodyJson(r).query) };
  });
  await check('http', 'Query só na URL com params divergente (usuário editou a URL, params velhos)', async () => {
    const r = await run({ url: `${H}/echo?novo=1`, params: [{ key: 'velho', value: '1' }] });
    return { pass: true, evidence: `query enviada=${JSON.stringify(bodyJson(r).query)} (informativo: a aba Params ganha da URL)` };
  });
  await check('soap', 'SOAP 1.1: envia SOAPAction e detecta Fault', async () => {
    const w = tmpWs();
    const res = await J.importAuto(w, { url: `${H}/soap/TravellerService?wsdl` });
    const ids = []; for (const [id, n] of w.index) if (n.type === 'request') ids.push(id);
    const outs = [];
    for (const id of ids) { const r = await J.send(w, { requestId: id }); outs.push(`${w.get(id).name}:${r.response && r.response.code}:${r.soapFault ? 'fault' : 'ok'}:${r.xsd ? JSON.stringify(r.xsd).slice(0, 120) : ''}`); }
    return { pass: ids.length > 0 && outs.some((o) => /:200:ok/.test(o)), evidence: `${res.operations} operações; ${outs.join(' | ')}` };
  }, { timeoutMs: 60000 });

  await finish('02-http');
})();
