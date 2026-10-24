// abre o app, tira screenshot da tela inicial
const { _electron: electron } = require('@playwright/test');
const path = require('path'); const fs = require('fs'); const os = require('os');
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jud-'));
  const app = await electron.launch({ args: ['--no-sandbox', path.join(__dirname, '..')], env: { ...process.env, JAIMINHO_USERDATA: ud } });
  app.process().stdout.on('data', (d) => process.stdout.write('[out] ' + d));
  app.process().stderr.on('data', (d) => process.stdout.write('[err] ' + d));
  const win = await app.firstWindow();
  win.on('console', (m) => console.log('[console]', m.type(), m.text()));
  win.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await win.waitForSelector('[data-testid=welcome]', { timeout: 20000 });
  await win.screenshot({ path: '/tmp/claude-0/-home-claude/c75225fd-0500-5d2a-8e22-fc50206918e2/scratchpad/welcome.png' });
  console.log('ok welcome');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
