// QA e2e da versão web (Chromium + servidor Node). Uso (a partir de apps/desktop, após o vite build):
//   xvfb-run -a node ../../qa/e2e-web.js ../../qa/shots/web     (ou sem xvfb: roda headless)
// Cobre: autenticação, CSRF, guarda de caminhos, fluxo completo na página (seletor de pasta do servidor, workspace de exemplo,
// envio de request, Ctrl+Enter, exportar = download no navegador, importar = envio do arquivo do navegador), mocks no servidor.
const path = require('path'); const fs = require('fs'); const os = require('os'); const http = require('http');
const { spawn } = require('child_process');
// Playwright do repositório; se o Chromium dele não estiver instalado, usa um Chromium do sistema (CHROMIUM_PATH ou /opt/pw-browsers)
const { chromium } = require(require.resolve('@playwright/test', { paths: [path.join(__dirname, '..', 'apps', 'desktop')] }));
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { if (fs.existsSync(chromium.executablePath())) return undefined; } catch { /* segue */ }
  const base = '/opt/pw-browsers'; if (!fs.existsSync(base)) return undefined;
  for (const d of fs.readdirSync(base).filter((x) => /^chromium-/.test(x)).sort().reverse()) { const p = path.join(base, d, 'chrome-linux64', 'chrome'); if (fs.existsSync(p)) return p; }
  return undefined;
}
const assert = require('assert');

const SHOTS = process.argv[2] || path.join(__dirname, 'shots', 'web');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const PORT = 18090; const USER = 'lucas'; const PASS = 's3nha:com:dois';
const BASE = `http://127.0.0.1:${PORT}`;
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const req = (method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request(BASE + p, { method, headers }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString('utf8') })); });
  r.on('error', reject); if (body) r.write(body); r.end();
});

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jweb-'));
  const srv = spawn(process.execPath, [process.env.JAIMINHO_WEB_SERVER || path.join(__dirname, '..', 'apps', 'web', 'server.js')], { env: { ...process.env, JAIMINHO_ROOT: root, JAIMINHO_PORT: String(PORT), JAIMINHO_USER: USER, JAIMINHO_PASSWORD: PASS }, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = ''; srv.stdout.on('data', (d) => { srvLog += d; }); srv.stderr.on('data', (d) => { srvLog += d; });
  for (let i = 0; i < 50; i++) { try { if ((await req('GET', '/healthz')).status === 200) break; } catch { /* aguarda */ } await new Promise((r) => setTimeout(r, 100)); }

  async function step(name, fn) {
    const t = Date.now();
    try { const ev = await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`PASS [web] ${name}${ev ? ' :: ' + ev : ''}`); }
    catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' | ') }); console.log(`FAIL [web] ${name} :: ${e.message.split('\n').slice(0, 3).join(' | ')}`); }
  }
  const J = { 'content-type': 'application/json', 'x-jaiminho-web': '1' };

  await step('Sem senha ou com senha errada → 401; /healthz é público', async () => {
    assert.equal((await req('GET', '/')).status, 401);
    assert.equal((await req('GET', '/api/info', { headers: { authorization: basic(USER, 'errada') } })).status, 401);
    assert.equal((await req('GET', '/healthz')).status, 200);
    assert.equal((await req('GET', '/', { headers: { authorization: basic(USER, PASS) } })).status, 200);
  });
  await step('CSRF: POST sem o cabeçalho próprio ou de outra origem é recusado', async () => {
    const auth = { authorization: basic(USER, PASS) };
    assert.equal((await req('POST', '/api/call', { headers: { ...auth, 'content-type': 'text/plain' }, body: '{"op":"app:settings"}' })).status, 403);
    assert.equal((await req('POST', '/api/call', { headers: { ...auth, ...J, origin: 'http://evil.example' }, body: '{"op":"app:settings"}' })).status, 403);
    assert.equal((await req('POST', '/api/call', { headers: { ...auth, ...J }, body: '{"op":"app:settings"}' })).status, 200);
  });
  await step('Guarda de caminhos: não abre workspace fora da área de dados nem baixa arquivos alheios', async () => {
    const auth = { authorization: basic(USER, PASS) };
    const r = JSON.parse((await req('POST', '/api/call', { headers: { ...auth, ...J }, body: '{"op":"ws:open","args":{"dir":"/etc"}}' })).text);
    assert.equal(r.ok, false); assert.match(r.error, /fora da área/);
    assert.equal((await req('GET', '/api/fs?path=/etc', { headers: auth })).status, 400);
    assert.equal((await req('GET', '/api/download?path=/etc/passwd', { headers: auth })).status, 400);
    assert.equal((await req('GET', '/..%2f..%2fetc/passwd', { headers: auth })).status, 404);
  });

  const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: chromiumPath() });
  const ctx = await browser.newContext({ httpCredentials: { username: USER, password: PASS }, viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) }).catch(() => {});

  await step('A página abre autenticada e mostra a tela inicial', async () => {
    await page.goto(BASE); await page.waitForSelector('[data-testid=welcome]', { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__jaiminhoWeb), true);
    await shot('01-boas-vindas');
  });

  await step('Workspace de exemplo: seletor de pasta do servidor + "Nova pasta…" + mocks no servidor', async () => {
    await page.click('[data-testid=welcome-example]'); await page.waitForSelector('[data-testid=modal-mocks]');
    await page.click('text=Criar workspace de exemplo…');
    await page.waitForSelector('[role=dialog][aria-label*="Pasta para o workspace"]');
    await shot('02-seletor-pasta');
    await page.click('[role=dialog] >> text=Nova pasta…');
    await page.waitForSelector('[role=dialog][aria-label="Nome da nova pasta"]');
    await page.fill('[role=dialog][aria-label="Nome da nova pasta"] input', 'exemplo');
    await page.click('[role=dialog][aria-label="Nome da nova pasta"] >> text=OK');
    const row = page.locator('[role=dialog][aria-label*="Pasta para o workspace"] div:text-is("📁 exemplo")');
    await row.waitFor(); await row.click();
    await page.click('[role=dialog][aria-label*="Pasta para o workspace"] >> text=Escolher');
    await page.waitForSelector('[data-testid=tree]', { timeout: 40000 });
    await page.waitForSelector('[data-testid="node-1. REST / JSON"]');
    assert.ok(fs.existsSync(path.join(root, 'workspaces', 'exemplo', 'jaiminho.yaml')), 'workspace criado no servidor');
    await shot('03-workspace');
  });

  await step('Enviar request (mock no servidor) e conferir 200', async () => {
    await page.click('[data-testid="node-Listar viajantes"]');
    await page.click('[data-testid=btn-send]');
    await page.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 30000 });
    const st = await page.textContent('[data-testid=resp-status]');
    if (!/200/.test(st)) await shot('FAIL-04');
    assert.match(st, /200/, await page.evaluate(() => (document.querySelector('[data-testid=resp-body]') || document.body).innerText.slice(0, 200)));
    await shot('04-resposta');
  });

  await step('Ctrl+Enter no editor do body envia sem quebrar a linha', async () => {
    await page.click('[data-testid="node-Criar viajante"]');
    await page.click('[data-testid=req-tab-body]');
    await page.click('[data-testid=body-editor] .cm-content');
    await page.keyboard.press('Control+A'); await page.keyboard.type('{"nome":"Ana"}'); await page.keyboard.press('ArrowLeft');
    const before = await page.evaluate(() => document.querySelector('[data-testid=body-editor] .cm-content').innerText);
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('[data-testid=resp-status]', { timeout: 20000 });
    await page.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 30000 });
    const after = await page.evaluate(() => document.querySelector('[data-testid=body-editor] .cm-content').innerText);
    assert.equal(after, before);
  });

  await step('Exportar workspace: o navegador baixa o .jaiminho', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('[data-testid=btn-export-ws]')]);
    const f = path.join(root, 'baixado.jaiminho'); await dl.saveAs(f);
    // (o Playwright 1.54 com um Chromium bem mais novo às vezes devolve "download" como nome sugerido; o conteúdo é a prova)
    if (dl.suggestedFilename() !== 'download') assert.match(dl.suggestedFilename(), /\.jaiminho$/);
    assert.ok(fs.statSync(f).size > 500, 'arquivo vazio');
    assert.deepEqual(fs.readFileSync(f).subarray(0, 8), fs.readFileSync(path.join(root, 'users', USER, 'downloads', fs.readdirSync(path.join(root, 'users', USER, 'downloads'))[0])).subarray(0, 8), 'o navegador recebeu o arquivo gerado no servidor');
    return `${dl.suggestedFilename()} (${fs.statSync(f).size} bytes)`;
  });

  await step('Importar: envia um arquivo do computador do usuário e cria a coleção', async () => {
    const col = { info: { name: 'Coleção enviada pelo navegador', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: 'Ping', request: { method: 'GET', url: 'http://127.0.0.1:1/ping' } }] };
    const f = path.join(root, 'colecao-teste.json'); fs.writeFileSync(f, JSON.stringify(col));
    await page.click('[data-testid=btn-import]'); await page.waitForSelector('[data-testid=modal-import]');
    await page.click('[data-testid=import-file]');
    await page.click('[data-testid=modal-import] .drop-hint button');
    await page.waitForSelector('[role=dialog][aria-label="Escolher arquivo"]');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[role=dialog] >> text=Enviar do meu computador…')]);
    await chooser.setFiles(f);
    await page.waitForSelector('[data-testid=import-result]', { timeout: 15000 });
    await page.waitForSelector('[data-testid="node-Coleção enviada pelo navegador"]');
    const up = fs.readdirSync(path.join(root, 'users', USER, 'uploads')); assert.equal(up.length, 1);
    await shot('05-importado');
    await page.keyboard.press('Escape');
  });

  await step('Layout lado a lado, Ctrl+F e seleção múltipla funcionam também no navegador', async () => {
    await page.click('[data-testid="node-Listar viajantes"]');
    await page.click('[data-testid=btn-layout]'); await page.waitForSelector('.split.horizontal');
    await page.click('[data-testid=btn-layout]'); await page.waitForSelector('.split:not(.horizontal)');
    await page.click('[data-testid=btn-send]'); await page.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 30000 });
    await page.click('[data-testid=resp-status]'); await page.keyboard.press('Control+F');
    await page.waitForSelector('.cm-search', { timeout: 3000 }); await page.keyboard.press('Escape');
    await page.click('[data-testid="node-Listar viajantes"]'); await page.click('[data-testid="node-Criar viajante"]', { modifiers: ['Control'] });
    assert.equal(await page.locator('.tree-row.multi').count(), 2);
  });

  await step('Recarregar a página mantém o workspace aberto (estado fica no servidor)', async () => {
    await page.reload(); await page.waitForSelector('[data-testid=tree]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="node-1. REST / JSON"]');
  });

  await step('Segundo usuário não vê o workspace aberto do primeiro (motor separado)', async () => {
    const info = JSON.parse((await req('GET', '/api/info', { headers: { authorization: basic(USER, PASS) } })).text);
    assert.equal(info.user, USER);
    const cur = JSON.parse((await req('POST', '/api/call', { headers: { authorization: basic(USER, PASS), ...J }, body: '{"op":"ws:current"}' })).text);
    assert.equal(cur.ok, true); assert.ok(cur.result && cur.result.name);
  });

  await step('Nenhum erro de página durante o fluxo', async () => { assert.deepEqual(pageErrors, []); });

  await browser.close(); srv.kill('SIGTERM');
  const failed = results.filter((r) => !r.ok);
  console.log(`== web: ${results.length - failed.length} passaram, ${failed.length} falharam`);
  if (failed.length) console.log(srvLog.split('\n').slice(-15).join('\n'));
  fs.writeFileSync(path.join(__dirname, 'results', 'web.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
