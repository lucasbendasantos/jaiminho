// Captura de telas para a revisão de UX. Uso: xvfb-run -a -s "-screen 0 1440x900x24" node uxreview/capturar.js
const { _electron: electron } = require('/home/claude/jaiminho/node_modules/@playwright/test') ;
const path = require('path'); const fs = require('fs'); const os = require('os');
const APP = '/home/claude/jaiminho/apps/desktop';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log(...a);
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-ud-'));
  const emptyWs = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-ws-'));
  const exWs = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-ex-'));
  const app = await electron.launch({ args: ['--no-sandbox', APP], env: { ...process.env, JAIMINHO_USERDATA: ud } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = async (n) => { await win.waitForTimeout(250); await win.screenshot({ path: path.join(SHOTS, `${n}.png`) }); log('shot', n); };
  const tryStep = async (n, fn) => { try { await fn(); } catch (e) { log('FALHOU', n, e.message.split('\n')[0]); } };
  const stubDir = (d) => app.evaluate(({ dialog }, x) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [x] }); }, d);
  const stubConfirm = (r) => app.evaluate(({ dialog }, x) => { dialog.showMessageBox = async () => ({ response: x }); }, r);
  const waitDone = async (ms = 30000) => { await win.waitForTimeout(150); await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: ms }); await win.waitForTimeout(200); };
  const open = async (n) => { await win.click(`[data-testid="node-${n}"]`); await win.waitForTimeout(350); };
  const setTheme = async (t) => { await win.click('[data-testid=btn-settings]'); await win.click('[data-testid=settings-app]'); await win.click(`[data-testid=theme-${t === 'light' ? 'branco' : t === 'dark' ? 'padrao' : t}]`); await win.keyboard.press('Escape'); await win.waitForTimeout(200); };

  await win.waitForSelector('[data-testid=welcome]');
  // Foco por teclado na boas-vindas
  await tryStep('foco-welcome', async () => { await win.keyboard.press('Tab'); await win.keyboard.press('Tab'); await shot('u01-welcome-foco-teclado'); });

  // Workspace vazio
  await tryStep('ws-vazio', async () => {
    await stubDir(emptyWs);
    await win.click('[data-testid=welcome-new]');
    await win.waitForSelector('[data-testid=modal-prompt]'); await shot('u02-prompt-nome-workspace');
    await win.click('[data-testid=prompt-ok]');
    await win.waitForSelector('[data-testid=sidebar]'); await shot('u03-workspace-vazio');
  });
  await tryStep('nova-request', async () => {
    await win.click('[data-testid=empty-new-http]'); await win.waitForSelector('[data-testid=req-url]');
    await shot('u04-request-nova-vazia');
    await win.fill('[data-testid=req-url]', '{{baseUrl}}/api/x?q=1');
    await win.click('[data-testid=btn-send]'); await waitDone(); await shot('u05-variavel-inexistente');
    await win.fill('[data-testid=req-url]', 'http://127.0.0.1:1/naoexiste');
    await win.click('[data-testid=btn-send]'); await waitDone(); await shot('u06-nao-entregue');
    await win.click('[data-testid=req-tab-body]'); await win.click('[data-testid=body-json]'); await shot('u07-body-json-vazio');
    await win.keyboard.press('Control+s'); await win.waitForSelector('[data-testid=modal-saveas]'); await shot('u08-salvar-sem-colecao');
    await win.keyboard.press('Escape');
  });
  await tryStep('tab-teclado', async () => {
    await win.click('[data-testid=req-url]');
    for (let i = 0; i < 3; i++) await win.keyboard.press('Tab');
    await shot('u09-foco-teclado-subabas');
  });
  await tryStep('nova-colecao', async () => {
    await win.click('[data-testid=btn-new-collection]'); await win.waitForSelector('[data-testid=modal-prompt]'); await win.click('[data-testid=prompt-ok]');
    await win.waitForTimeout(400); await shot('u10-colecao-vazia');
    await win.click('[data-testid="node-Nova coleção"]', { button: 'right' }); await shot('u11-menu-contexto-colecao');
    await win.keyboard.press('Escape'); await win.mouse.click(700, 500);
  });
  await tryStep('env-novo', async () => {
    await win.click('[data-testid=side-envs]'); await shot('u12-ambientes-vazio');
    await win.click('[data-testid=btn-new-env]'); await win.click('[data-testid=prompt-ok]'); await win.waitForTimeout(500); await shot('u13-ambiente-novo');
    await win.click('[data-testid=side-history]'); await shot('u14-historico');
    await win.click('[data-testid=side-collections]');
  });
  await tryStep('atalhos', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('event', { type: 'menu:shortcuts' }));
    await win.waitForTimeout(300); await shot('u15-atalhos'); await win.keyboard.press('Escape');
  });

  // Workspace de exemplo
  await tryStep('exemplo', async () => {
    await win.click('[data-testid=ws-switch]').catch(() => {});
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('event', { type: 'menu:example' }));
    await win.waitForSelector('[data-testid=modal-mocks]'); await stubDir(exWs);
    await win.click('text=Criar workspace de exemplo…');
    await win.waitForSelector('[data-testid="node-1. REST / JSON"]', { timeout: 30000 }); await win.waitForTimeout(500);
  });
  await tryStep('carregando', async () => {
    await open('Lento (2 s)'); await win.click('[data-testid=btn-send]'); await win.waitForTimeout(500); await shot('u16-carregando'); await waitDone();
    await open('Erro 500'); await win.click('[data-testid=btn-send]'); await waitDone(); await shot('u17-erro-500');
  });
  await tryStep('dirty', async () => {
    await open('Listar viajantes'); await win.click('[data-testid=req-tab-headers]');
    await win.fill('[data-testid=req-name]', 'Listar viajantes (editado)'); await shot('u18-aba-nao-salva');
  });
  await tryStep('auth', async () => { await open('Bearer (herdado da coleção)'); await win.click('[data-testid=req-tab-auth]'); await shot('u19-auth-herdada'); });
  await tryStep('soap', async () => { await open('GetTraveller'); await win.click('[data-testid=btn-send]'); await waitDone(); await shot('u20-soap'); });
  await tryStep('grpc', async () => {
    await open('GetTraveller (unário)'); await win.click('[data-testid=grpc-method]'); await win.waitForTimeout(1200); await shot('u21-grpc-seletor-metodo');
    await win.keyboard.press('Escape'); await win.mouse.click(900, 300);
    await open('Fail (erro com detalhes)'); await win.click('[data-testid=btn-send]'); await waitDone(); await shot('u22-grpc-erro');
    await win.click('[data-testid=req-tab-schema]'); await shot('u23-grpc-schema');
  });
  await tryStep('colecao', async () => { await win.dblclick('[data-testid="node-1. REST / JSON"]'); await win.waitForTimeout(400); await shot('u24-editor-colecao'); });
  await tryStep('settings-proxy', async () => { await win.click('[data-testid=btn-settings]'); await win.click('text=Proxy'); await shot('u25-config-proxy'); await win.click('[data-testid=settings-geral]'); await shot('u26-config-geral'); await win.keyboard.press('Escape'); });
  await tryStep('import-texto', async () => { await win.click('[data-testid=btn-import]'); await shot('u27-importar-texto'); await win.keyboard.press('Escape'); });

  // Tema claro
  await tryStep('claro', async () => {
    await setTheme('light');
    await open('Listar viajantes'); await win.click('[data-testid=btn-send]'); await waitDone(); await shot('u28-claro-request');
    await open('Chat (bidi)'); await win.click('[data-testid=btn-send]'); await win.waitForSelector('[data-testid=grpc-write]'); await win.click('[data-testid=grpc-write]'); await win.waitForTimeout(300); await shot('u29-claro-grpc-bidi');
    await win.click('[data-testid=grpc-end]'); await waitDone();
    await win.click('[data-testid=side-envs]'); await win.click('[data-testid="env-Mocks locais"]'); await win.waitForTimeout(300); await shot('u30-claro-ambiente');
    await win.click('[data-testid=side-collections]');
    await win.click('[data-testid=btn-import]'); await win.click('[data-testid=import-url]'); await shot('u31-claro-importar'); await win.keyboard.press('Escape');
    await win.click('[data-testid=btn-vars]'); await shot('u32-claro-vars'); await win.click('[data-testid=btn-vars]');
    // contraste: cores computadas
    const c = await win.evaluate(() => { const g = (sel, p) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[p] : null; }; return { selBg: g('.tree-row.sel', 'backgroundColor'), selColor: g('.tree-row.sel', 'color'), sendBg: g('[data-testid=btn-send]', 'backgroundColor'), sendColor: g('[data-testid=btn-send]', 'color'), faint: getComputedStyle(document.documentElement).getPropertyValue('--faint') }; });
    log('CORES-CLARO', JSON.stringify(c));
    await setTheme('dark');
  });
  // Janela estreita
  await tryStep('estreita', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700));
    await win.setViewportSize({ width: 1100, height: 700 }).catch(() => {});
    await open('GetTraveller (unário)'); await win.waitForTimeout(400); await shot('u33-janela-1100-grpc');
    await open('Listar viajantes'); await shot('u34-janela-1100-http');
    await win.click('[data-testid=btn-settings]'); await win.click('[data-testid=settings-certs]'); await shot('u35-janela-1100-config'); await win.keyboard.press('Escape');
  });
  log('ERROS JS:', errs.join(' | ') || 'nenhum');
  await stubConfirm(1);
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
