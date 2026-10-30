// QA da API da versão web (só Node, sem navegador): isolamento entre usuários, travessia de caminhos, uploads, SSE, bloqueio por senha errada.
// Uso: node qa/web-api.js
const path = require('path'); const fs = require('fs'); const os = require('os'); const http = require('http');
const { spawn } = require('child_process'); const assert = require('assert');
const results = [];
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const J = { 'content-type': 'application/json', 'x-jaiminho-web': '1' };
function start(env, port) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wapi-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'apps', 'web', 'server.js')], { env: { ...process.env, JAIMINHO_ROOT: root, JAIMINHO_PORT: String(port), ...env }, stdio: 'ignore' });
  return { root, srv, base: `http://127.0.0.1:${port}` };
}
const req = (base, method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request(base + p, { method, headers }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString('utf8'), headers: res.headers })); });
  r.on('error', reject); if (body) r.write(body); r.end();
});
async function up(base) { for (let i = 0; i < 60; i++) { try { if ((await req(base, 'GET', '/healthz')).status === 200) return; } catch { /* aguarda */ } await new Promise((r) => setTimeout(r, 100)); } throw new Error('servidor não subiu'); }
async function step(name, fn) { const t = Date.now(); try { const ev = await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`PASS [web-api] ${name}${ev ? ' :: ' + ev : ''}`); } catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); console.log(`FAIL [web-api] ${name} :: ${e.message.split('\n')[0]}`); } }
const call = async (base, auth, op, args) => JSON.parse((await req(base, 'POST', '/api/call', { headers: { authorization: auth, ...J }, body: JSON.stringify({ op, args }) })).text);

(async () => {
  const A = basic('ana', 'senha-a'); const B = basic('beto', 'senha:b:com:dois');
  const S = start({ JAIMINHO_USERS: 'ana:senha-a,beto:senha:b:com:dois', JAIMINHO_MAX_UPLOAD_MB: '1' }, 18101);
  await up(S.base);

  await step('Dois usuários: cada um tem o seu motor, o seu workspace aberto e as suas configurações', async () => {
    const dirA = path.join(S.root, 'workspaces', 'da-ana'); const dirB = path.join(S.root, 'workspaces', 'do-beto');
    assert.equal((await call(S.base, A, 'ws:create', { dir: dirA, name: 'Da Ana' })).ok, true);
    assert.equal((await call(S.base, B, 'ws:create', { dir: dirB, name: 'Do Beto' })).ok, true);
    assert.equal((await call(S.base, A, 'ws:current')).result.name, 'Da Ana');
    assert.equal((await call(S.base, B, 'ws:current')).result.name, 'Do Beto');
    await call(S.base, A, 'app:saveSettings', { layout: 'horizontal' });
    assert.notEqual((await call(S.base, B, 'app:settings')).result.layout, 'horizontal', 'configuração vazou entre usuários');
    assert.ok(fs.existsSync(path.join(S.root, 'users', 'ana')) && fs.existsSync(path.join(S.root, 'users', 'beto')));
  });
  await step('O mesmo workspace pode ser aberto pelos dois (compartilhado em disco) e o segredo cifrado funciona', async () => {
    const dir = path.join(S.root, 'workspaces', 'da-ana');
    const r = await call(S.base, B, 'ws:open', { dir }); assert.equal(r.ok, true); assert.equal(r.result.name, 'Da Ana');
  });
  await step('Travessia de caminho: mkdir, listagem, download, ws:create e import com ".." ou fora da raiz são recusados', async () => {
    for (const bad of ['/etc', '/', `${S.root}/..`, `${S.root}/workspaces/../../etc`]) {
      assert.equal((await req(S.base, 'GET', `/api/fs?path=${encodeURIComponent(bad)}`, { headers: { authorization: A } })).status, 400, bad);
    }
    const mk = await req(S.base, 'POST', '/api/fs/mkdir', { headers: { authorization: A, ...J }, body: JSON.stringify({ path: `${S.root}/workspaces`, name: '..' }) }); assert.equal(mk.status, 400);
    const mk2 = await req(S.base, 'POST', '/api/fs/mkdir', { headers: { authorization: A, ...J }, body: JSON.stringify({ path: `${S.root}/workspaces`, name: '../fora' }) });
    assert.ok(!fs.existsSync(path.join(S.root, 'fora')), 'criou pasta fora de workspaces'); assert.ok([200, 400].includes(mk2.status));
    assert.equal((await call(S.base, A, 'ws:create', { dir: '/tmp/fora-da-raiz', name: 'x' })).ok, false);
    assert.equal((await call(S.base, A, 'runner:start', { dataFile: '/etc/passwd', id: 'x' })).ok, false);
  });
  await step('Link simbólico para fora da raiz não vaza arquivos (listagem e download)', async () => {
    const link = path.join(S.root, 'workspaces', 'link-etc'); fs.symlinkSync('/etc', link);
    assert.equal((await req(S.base, 'GET', `/api/fs?path=${encodeURIComponent(link)}&files=1`, { headers: { authorization: A } })).status, 400);
    const dl = path.join(S.root, 'users', 'ana', 'downloads'); fs.mkdirSync(dl, { recursive: true }); fs.symlinkSync('/etc/hostname', path.join(dl, 'x.txt'));
    assert.equal((await req(S.base, 'GET', `/api/download?path=${encodeURIComponent(path.join(dl, 'x.txt'))}`, { headers: { authorization: A } })).status, 400);
  });
  await step('Download: um usuário não baixa o arquivo gerado para o outro', async () => {
    const dl = path.join(S.root, 'users', 'ana', 'downloads'); fs.writeFileSync(path.join(dl, 'segredo.txt'), 'so da ana');
    assert.equal((await req(S.base, 'GET', `/api/download?path=${encodeURIComponent(path.join(dl, 'segredo.txt'))}`, { headers: { authorization: A } })).status, 200);
    assert.equal((await req(S.base, 'GET', `/api/download?path=${encodeURIComponent(path.join(dl, 'segredo.txt'))}`, { headers: { authorization: B } })).status, 400);
  });
  await step('Upload: nome com caminho vira só o nome, lote inválido é recusado e arquivo acima do limite falha', async () => {
    const ok = JSON.parse((await req(S.base, 'POST', '/api/upload?batch=abcdef12-3456&name=..%2F..%2Fx.proto', { headers: { authorization: A, 'x-jaiminho-web': '1' }, body: 'syntax="proto3";' })).text);
    assert.ok(ok.ok && ok.path.startsWith(path.join(S.root, 'users', 'ana', 'uploads', 'abcdef12-3456')) && path.basename(ok.path) === 'x.proto', ok.path);
    assert.equal((await req(S.base, 'POST', '/api/upload?batch=../../etc&name=x', { headers: { authorization: A, 'x-jaiminho-web': '1' }, body: 'x' })).status, 400);
    const big = await req(S.base, 'POST', '/api/upload?batch=abcdef12-9999&name=grande.bin', { headers: { authorization: A, 'x-jaiminho-web': '1' }, body: Buffer.alloc(2 * 1024 * 1024) }).catch((e) => ({ status: 0, err: e.code }));
    assert.ok(big.status === 400 || big.status === 0 || big.status === 413, `status ${big.status}`);
    assert.equal(fs.existsSync(path.join(S.root, 'users', 'ana', 'uploads', 'abcdef12-9999', 'grande.bin')), false);
  });
  await step('SSE: sem senha 401; com senha recebe o canal de eventos', async () => {
    assert.equal((await req(S.base, 'GET', '/api/events')).status, 401);
    const got = await new Promise((resolve, reject) => { const r = http.get(`${S.base}/api/events`, { headers: { authorization: A } }, (res) => { res.once('data', (d) => { resolve({ status: res.statusCode, type: res.headers['content-type'], first: String(d) }); r.destroy(); }); }); r.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e))); setTimeout(() => reject(new Error('sem dados')), 4000); });
    assert.equal(got.status, 200); assert.match(got.type, /event-stream/);
  });
  await step('Rota desconhecida e método errado não derrubam o servidor', async () => {
    assert.equal((await req(S.base, 'POST', '/api/nada', { headers: { authorization: A, ...J }, body: '{}' })).status, 404);
    assert.equal((await req(S.base, 'POST', '/api/call', { headers: { authorization: A, ...J }, body: '{json quebrado' })).status, 400);
    assert.equal((await call(S.base, A, 'op:que:nao:existe')).ok, false);
    assert.equal((await req(S.base, 'GET', '/healthz')).status, 200);
  });
  await step('Bloqueio: 10 senhas erradas seguidas travam o IP (429); requisições sem credencial não contam', async () => {
    const S2 = start({ JAIMINHO_USER: 'x', JAIMINHO_PASSWORD: 'y' }, 18102); await up(S2.base);
    for (let i = 0; i < 30; i++) await req(S2.base, 'GET', '/'); // sem Authorization: não conta
    assert.equal((await req(S2.base, 'GET', '/', { headers: { authorization: basic('x', 'y') } })).status, 200, 'usuário legítimo bloqueado por requisições sem credencial');
    let last; for (let i = 0; i < 11; i++) last = await req(S2.base, 'GET', '/', { headers: { authorization: basic('x', 'errada') } });
    assert.equal(last.status, 429);
    S2.srv.kill();
  });
  await step('JAIMINHO_AUTH=none libera sem senha (uso atrás de proxy autenticado)', async () => {
    const S3 = start({ JAIMINHO_AUTH: 'none' }, 18103); await up(S3.base);
    assert.equal((await req(S3.base, 'GET', '/')).status, 200);
    assert.equal(JSON.parse((await req(S3.base, 'GET', '/api/info')).text).user, 'local');
    S3.srv.kill();
  });
  await step('Senha gerada na 1ª subida fica em auth.json (0600) e permite entrar', async () => {
    const S4 = start({}, 18104); await up(S4.base);
    const f = path.join(S4.root, 'auth.json'); const a = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal((fs.statSync(f).mode & 0o777).toString(8), '600');
    assert.equal((await req(S4.base, 'GET', '/', { headers: { authorization: basic(a.user, a.password) } })).status, 200);
    assert.equal(((fs.statSync(path.join(S4.root, 'secrets.key')).mode) & 0o777).toString(8), '600');
    S4.srv.kill();
  });

  S.srv.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`== web-api: ${results.length - failed.length} passaram, ${failed.length} falharam`);
  fs.writeFileSync(path.join(__dirname, 'results', 'web-api.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
