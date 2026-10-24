const path = require('path'), fs = require('fs'), os = require('os');
const { _electron: electron } = require('/home/claude/jaiminho/node_modules/@playwright/test');
const J = require('/home/claude/jaiminho/packages/engine/src'); const { startAll } = require('/home/claude/jaiminho/packages/mocks/src');
(async () => {
  const m = await startAll();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf2-')); const ws = J.Workspace.create(dir, 'Gigante'); const col = ws.createCollection('Enorme');
  for (let f = 0; f < 60; f++) { const fo = ws.createFolder(col, `Pasta ${f}`); for (let r = 0; r < 50; r++) ws.createRequest(fo, { name: `Req ${f}-${r}`, url: `${m.urls.http}/echo?i=${r}`, method: 'GET' }); }
  const real = ws.createFolder(col, 'Reais'); ws.createRequest(real, { name: 'JSON 20MB', url: `${m.urls.http}/big?mb=20` });
  const app = await electron.launch({ args: ['--no-sandbox', '/home/claude/jaiminho/apps/desktop'], env: { ...process.env, JAIMINHO_USERDATA: fs.mkdtempSync(path.join(os.tmpdir(), 'perf2-ud-')) } });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForSelector('[data-testid=welcome]');
  await app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, dir);
  await win.click('[data-testid=welcome-open]'); await win.waitForSelector('[data-testid="node-Pasta 0"]');
  const lt = async (n, fn) => { await win.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); }); const t = Date.now(); const x = await fn(); const w = Date.now() - t; await win.waitForTimeout(300); const a = await win.evaluate(() => window.__lt); console.log(n, 'tempo', w, 'ms; maior longtask', Math.round(Math.max(0, ...a)), 'ms', x || ''); };
  await lt('filtro "Req" (3000 resultados)', async () => { await win.fill('[data-testid=tree-filter]', 'Req'); await win.waitForTimeout(400); await win.screenshot({ path: __dirname + '/shots/perf-filtro-req.png' }); return 'linhas DOM=' + await win.$$eval('[role=treeitem]', (r) => r.length); });
  await lt('digitar filtro char a char "Req 12-3"', async () => { await win.fill('[data-testid=tree-filter]', ''); await win.focus('[data-testid=tree-filter]'); await win.keyboard.type('Req 12-3', { delay: 40 }); });
  await win.fill('[data-testid=tree-filter]', '');
  await lt('rolar a árvore (3000, tudo expandido?)', async () => { for (let i = 0; i < 20; i++) { await win.mouse.move(150, 400); await win.mouse.wheel(0, 600); await win.waitForTimeout(30); } });
  await lt('expandir 10 pastas em sequência', async () => { for (let i = 0; i < 10; i++) { await win.click(`[data-testid="node-Pasta ${i}"]`).catch(() => {}); } return 'linhas=' + await win.$$eval('[role=treeitem]', (r) => r.length); });
  await win.fill('[data-testid=tree-filter]', 'JSON 20MB'); await win.click('[data-testid="node-JSON 20MB"]'); await win.click('[data-testid=btn-send]'); await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 60000 }); await win.waitForTimeout(800);
  await win.screenshot({ path: __dirname + '/shots/perf-20mb.png' });
  await lt('filtrar resposta 20MB por $[0].id', async () => { await win.fill('[data-testid=resp-filter]', '$[0]'); await win.waitForTimeout(500); });
  await lt('aba Headers->Corpo com 20MB', async () => { await win.click('[data-testid=resp-tab-headers]').catch(() => {}); await win.click('[data-testid=resp-tab-body]').catch(() => {}); });
  await lt('rolar editor 20MB', async () => { await win.mouse.move(800, 700); for (let i = 0; i < 20; i++) { await win.mouse.wheel(0, 2000); await win.waitForTimeout(30); } });
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {}); await m.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
