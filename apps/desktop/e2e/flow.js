// Teste ponta a ponta do app desktop (Playwright + Electron). Uso: xvfb-run node e2e/flow.js [pastaScreenshots]
const { _electron: electron } = require('@playwright/test');
const assert = require('assert');
const path = require('path'); const fs = require('fs'); const os = require('os');

const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'jaiminho-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); console.log(`✗ ${name}: ${e.message.split('\n').slice(0, 3).join(' | ')}`); }
}

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jud-'));
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jws-'));
  const app = await electron.launch(process.env.JAIMINHO_EXE ? { executablePath: process.env.JAIMINHO_EXE, args: ['--no-sandbox'], env: { ...process.env, JAIMINHO_USERDATA: ud } } : { args: ['--no-sandbox', path.join(__dirname, '..')], env: { ...process.env, JAIMINHO_USERDATA: ud } });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = (n) => win.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  const stubDir = (dir) => app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, dir);
  const stubSave = (file) => app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
  const open = async (name) => { await win.click(`[data-testid="node-${name}"]`); await win.waitForTimeout(300); };
  const expand = async () => {};
  const waitDone = async (ms = 30000) => { await win.waitForTimeout(150); await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: ms }); await win.waitForTimeout(200); };
  const send = async () => { await win.click('[data-testid=btn-send]'); await waitDone(); };
  const statusText = () => win.textContent('[data-testid=resp-status]');

  await win.waitForSelector('[data-testid=welcome]');
  await shot('01-boas-vindas');

  await step('Criar workspace de exemplo (sobe os mocks)', async () => {
    await win.click('[data-testid=welcome-example]');
    await win.waitForSelector('[data-testid=modal-mocks]');
    await stubDir(wsDir);
    await win.click('text=Criar workspace de exemplo…');
    await win.waitForSelector('[data-testid=tree]', { timeout: 30000 });
    await win.waitForSelector('[data-testid="node-1. REST / JSON"]');
    assert.ok(fs.existsSync(path.join(wsDir, 'jaiminho.yaml')));
    await shot('02-workspace');
  });

  await step('REST: GET com variáveis do ambiente e testes pm.*', async () => {
    await expand('Viajantes (CRUD)');
    await open('Listar viajantes');
    await send();
    const st = await statusText();
    assert.match(st, /200/); assert.match(st, /2\/2 testes/);
    await shot('03-get-200');
  });

  await step('REST: POST cria e script grava variável de ambiente', async () => {
    await open('Criar viajante');
    await send();
    assert.match(await statusText(), /201/);
    const yaml = fs.readFileSync(path.join(wsDir, '.jaiminho', 'local-values.yaml'), 'utf8');
    assert.match(yaml, /id: "?\d+/);
  });

  await step('REST: path variable :id e Params', async () => {
    await open('Buscar viajante por id');
    await win.click('[data-testid=req-tab-params]');
    await send();
    assert.match(await statusText(), /200/);
  });

  await step('Auth Basic e Digest', async () => {
    await expand('Autenticação');
    await open('Basic'); await send(); assert.match(await statusText(), /200/);
    await open('Digest'); await send(); assert.match(await statusText(), /200/);
    await open('Bearer (herdado da coleção)'); await send(); assert.match(await statusText(), /200/, 'token secreto do ambiente');
    await open('API Key'); await send(); assert.match(await statusText(), /200/);
  });

  await step('HTTPS: CA própria, SSL desligado e mTLS', async () => {
    await open('HTTPS com CA própria'); await send(); assert.match(await statusText(), /200/);
    await open('HTTPS com verificação SSL desligada'); await send(); assert.match(await statusText(), /200/);
    await open('mTLS (certificado de cliente PEM)'); await send(); assert.match(await statusText(), /200/);
    const body = await win.textContent('[data-testid=resp-body]');
    assert.match(body, /jaiminho-client/);
    await shot('04-mtls');
  });

  await step('SOAP via WSDL: envio e XPath', async () => {
    await expand('TravellerService (SOAP 1.1)');
    await open('GetTraveller');
    await send();
    assert.match(await statusText(), /200/);
    assert.match(await statusText(), /XSD request ok/);
    await win.fill('[data-testid=resp-filter]', '//tns:firstName');
    await win.press('[data-testid=resp-filter]', 'Enter');
    await win.waitForTimeout(400);
    assert.match(await win.textContent('[data-testid=resp-body]'), /Jaime/);
    await shot('05-soap');
  });

  await step('gRPC unário via reflection', async () => {
    await expand('Reflection (4 tipos)');
    await open('GetTraveller (unário)');
    await send();
    const st = await statusText();
    assert.match(st, /OK \(0\)/, st);
    await shot('06-grpc-unario');
  });

  await step('gRPC server streaming', async () => {
    await open('ListTravellers (server streaming)');
    await send();
    assert.match(await statusText(), /5 mensagens/);
  });

  await step('gRPC bidi: abrir stream, enviar 2 mensagens, finalizar', async () => {
    await open('Chat (bidi)');
    await win.click('[data-testid=btn-send]');
    await win.waitForSelector('[data-testid=grpc-write]');
    await win.click('[data-testid=grpc-write]'); await win.waitForTimeout(150);
    await win.click('[data-testid=grpc-write]'); await win.waitForTimeout(300);
    await shot('07-grpc-bidi-aberto');
    await win.click('[data-testid=grpc-end]');
    await waitDone(15000);
    const st = await statusText();
    assert.match(st, /OK/); assert.match(st, /3 mensagens/);
    await win.click('[data-testid=resp-tab-timeline]');
    await shot('08-grpc-timeline');
  });

  await step('gRPC erro com detalhes', async () => {
    await open('Fail (erro com detalhes)');
    await send();
    const err = await win.textContent('[data-testid=resp-error]');
    assert.match(err, /INVALID_ARGUMENT/); assert.match(err, /BadRequest/);
  });

  await step('gRPC mTLS (.p12)', async () => {
    await expand('TLS e mTLS');
    await open('mTLS (.p12 com senha)');
    await send();
    assert.match(await statusText(), /OK/);
  });

  await step('Colar cURL na barra de URL preenche a request', async () => {
    await win.click('[data-testid=empty-new-http]').catch(async () => { await win.click('[data-testid=btn-new-tab]'); await win.click('text=HTTP / REST'); });
    await win.waitForSelector('[data-testid=req-url]');
    const curl = "curl -X POST 'http://127.0.0.1:4010/api/travellers' -H 'Content-Type: application/json' -H 'Authorization: Bearer jaiminho-token' --data-raw '{\"firstName\":\"Colado\",\"lastName\":\"DoCurl\"}'";
    await win.click('[data-testid=req-url]');
    await win.evaluate((text) => { const el = document.querySelector('[data-testid=req-url]'); const dt = new DataTransfer(); dt.setData('text', text); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, curl);
    await win.waitForTimeout(600);
    assert.equal(await win.inputValue('[data-testid=req-method]'), 'POST');
    await send();
    assert.match(await statusText(), /201/);
    await shot('09-curl-colado');
  });

  await step('Salvar request nova (escolher coleção)', async () => {
    await win.click('[data-testid=btn-save]');
    await win.waitForSelector('[data-testid=modal-saveas]');
    await win.click('[data-testid="saveas-1. REST / JSON"]');
    await win.click('[data-testid=saveas-ok]');
    await win.waitForTimeout(500);
    const files = fs.readdirSync(path.join(wsDir, 'collections'));
    assert.ok(files.length >= 4);
  });

  await step('Importar cURL pelo modal (cria em Rascunhos)', async () => {
    await win.click('[data-testid=btn-import]');
    await win.waitForSelector('[data-testid=modal-import]');
    await win.click('[data-testid=import-text] .cm-content');
    await win.keyboard.insertText('curl.exe -k ^\n  -u jaiminho:carteiro ^\n  "https://localhost:4443/auth/basic"');
    await win.click('[data-testid=import-go]');
    await win.waitForSelector('[data-testid=import-result]');
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-testid="node-Rascunhos"]');
    await send();
    assert.match(await statusText(), /200/);
  });

  await step('Importar Swagger por URL do Swagger UI', async () => {
    await win.click('[data-testid=btn-import]');
    await win.click('[data-testid=import-url]');
    await win.fill('[data-testid=import-url-input]', 'http://127.0.0.1:4010/swagger-ui/index.html');
    await win.click('[data-testid=import-url-go]');
    await win.waitForSelector('[data-testid=import-result]', { timeout: 20000 });
    assert.match(await win.textContent('[data-testid=import-result]'), /Swagger importado/);
    await shot('10-import-swagger');
    await win.keyboard.press('Escape');
  });

  await step('Código: cURL e PowerShell gerados', async () => {
    await open('Listar viajantes');
    await win.click('[data-testid=btn-code]');
    await win.waitForSelector('[data-testid=modal-code]');
    await win.waitForTimeout(600);
    assert.match(await win.textContent('[data-testid=code-out]'), /curl/);
    await win.selectOption('[data-testid=code-target]', 'curl:powershell');
    await win.waitForTimeout(500);
    assert.match(await win.textContent('[data-testid=code-out]'), /curl\.exe/);
    await shot('11-codigo');
    await win.keyboard.press('Escape');
  });

  await step('Exportar workspace .jaiminho sem segredos', async () => {
    const f = path.join(os.tmpdir(), `ex-${Date.now()}.jaiminho`);
    await stubSave(f);
    await win.click('[data-testid=btn-export-ws]');
    await win.waitForTimeout(1500);
    const buf = fs.readFileSync(f);
    assert.ok(buf.length > 1000);
    assert.ok(!buf.includes(Buffer.from('jaiminho-token')), 'token vazou no bundle');
  });

  await step('Ambiente: editar e painel de variáveis efetivas', async () => {
    await win.click('[data-testid=btn-vars]');
    await win.waitForSelector('[data-testid=vars-panel]');
    assert.match(await win.textContent('[data-testid=vars-panel]'), /baseUrl/);
    await shot('12-vars');
    await win.click('[data-testid=btn-vars]');
    await win.click('[data-testid=side-envs]');
    await win.click('[data-testid="env-Mocks locais"]');
    await win.waitForSelector('[data-testid=env-name]');
    await shot('13-ambiente');
    await win.click('[data-testid=side-collections]');
  });

  await step('Configurações: certificados e SSL', async () => {
    await win.click('[data-testid=btn-settings]');
    await win.click('[data-testid=settings-certs]');
    await shot('14-config-certs');
    await win.keyboard.press('Escape');
  });

  await step('Tema claro', async () => {
    await win.click('[data-testid=btn-settings]'); await win.click('[data-testid=settings-app]');
    await win.click('[data-testid=theme-branco]'); await win.keyboard.press('Escape');
    await open('Listar viajantes'); await send();
    await shot('15-tema-claro');
    await win.click('[data-testid=btn-settings]'); await win.click('[data-testid=settings-app]'); await win.click('[data-testid=theme-padrao]'); await win.keyboard.press('Escape');
  });

  await step('Runner da coleção REST', async () => {
    await win.click('[data-testid="node-1. REST / JSON"]', { button: 'right' });
    await win.click('[data-testid=ctx-run]');
    await win.waitForSelector('[data-testid=modal-runner]');
    await win.click('[data-testid=runner-start]');
    await win.waitForSelector('[data-testid=runner-summary]', { timeout: 60000 });
    await shot('16-runner');
    await win.keyboard.press('Escape');
  });

  if (errors.length) results.push({ name: 'Sem erros de JavaScript na página', ok: false, error: errors.join(' | ') });
  fs.writeFileSync(path.join(SHOTS, 'resultado.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passos ok`);
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
