const { _electron: electron } = require('/home/claude/jaiminho/node_modules/@playwright/test');
const path = require('path'); const fs = require('fs'); const os = require('os');
const APP = '/home/claude/jaiminho/apps/desktop';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
async function launch() {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ux2-ud-'));
  const app = await electron.launch({ args: ['--no-sandbox', APP], env: { ...process.env, JAIMINHO_USERDATA: ud } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const H = {
    app, win, errs,
    log: (...a) => console.log(...a),
    shot: async (n) => { await win.waitForTimeout(300); await win.screenshot({ path: path.join(SHOTS, `${n}.png`) }); console.log('shot', n); },
    step: async (n, fn) => { try { await fn(); } catch (e) { console.log('FALHOU', n, e.message.split('\n')[0]); } },
    stubDir: (d) => app.evaluate(({ dialog }, x) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [x] }); }, d),
    waitDone: async (ms = 30000) => { await win.waitForTimeout(150); await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: ms }); await win.waitForTimeout(200); },
    open: async (n) => { await win.click(`[data-testid="node-${n}"]`); await win.waitForTimeout(350); },
    setTheme: async (t) => { await win.click('[data-testid=btn-settings]'); await win.click('[data-testid=settings-app]'); await win.click(`[data-testid=theme-${t}]`); await win.keyboard.press('Escape'); await win.waitForTimeout(250); },
    example: async () => {
      const ex = fs.mkdtempSync(path.join(os.tmpdir(), 'ux2-ex-'));
      await win.waitForSelector('[data-testid=welcome]');
      await win.click('[data-testid=welcome-example]');
      await win.waitForSelector('[data-testid=modal-mocks]', { timeout: 5000 }).catch(() => {});
      await H.stubDir(ex);
      await win.click('text=Criar workspace de exemplo…');
      await win.waitForSelector('[data-testid="node-1. REST / JSON"]', { timeout: 40000 }); await win.waitForTimeout(500);
    },
    quit: async () => { await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {}); process.exit(0); },
  };
  return H;
}
module.exports = { launch, SHOTS, path, fs, os };
