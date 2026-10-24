// QA de performance da INTERFACE (Electron + Playwright). Mede travamentos reais com PerformanceObserver("longtask").
// Uso (em apps/desktop, após o vite build):  xvfb-run -a -s "-screen 0 1440x900x24" node ../../qa/perf-ui.js
// Critérios: clique/digitação < 300 ms de tarefa longa; resposta de 20 MB e gRPC de 5.000 mensagens < 2 s de bloqueio.
const path = require('path'); const fs = require('fs'); const os = require('os');
const { _electron: electron } = require(require.resolve('@playwright/test', { paths: ['/home/claude/jaiminho/apps/desktop'] }));
const J = require('/home/claude/jaiminho/packages/engine/src');
const { startAll } = require('/home/claude/jaiminho/packages/mocks/src');

const results = [];
const SVC = 'jaiminho.mock.v1.TravellerService';

(async () => {
  const m = await startAll();
  // workspace grande: 3.000 requests + 3 requests "reais" para os testes pesados
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-ws-'));
  const ws = J.Workspace.create(dir, 'Gigante');
  const col = ws.createCollection('Enorme');
  for (let f = 0; f < 60; f++) { const fo = ws.createFolder(col, `Pasta ${f}`); for (let r = 0; r < 50; r++) ws.createRequest(fo, { name: `Req ${f}-${r}`, url: `${m.urls.http}/echo?i=${r}`, method: ['GET', 'POST', 'PUT', 'DELETE'][r % 4] }); }
  const real = ws.createFolder(col, 'Reais');
  ws.createRequest(real, { name: 'JSON 20MB', url: `${m.urls.http}/big?mb=20` });
  ws.createRequest(real, { name: 'JSON 2MB', url: `${m.urls.http}/big?mb=2` });
  ws.createRequest(real, { kind: 'grpc', name: 'gRPC 5000', url: m.urls.grpc, grpc: { method: `${SVC}/ListTravellers`, message: '{"limit":5000}', metadata: [], schema: { source: 'reflection' }, options: { deadlineMs: 60000 } } });

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-ud-'));
  const t0 = Date.now();
  const app = await electron.launch({ args: ['--no-sandbox', '/home/claude/jaiminho/apps/desktop'], env: { ...process.env, JAIMINHO_USERDATA: ud } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForSelector('[data-testid=welcome]');
  const startup = Date.now() - t0;
  const errors = []; win.on('pageerror', (e) => errors.push(e.message));

  const lt = async (fn) => {
    await win.evaluate(() => { window.__lt = []; window.__po && window.__po.disconnect(); window.__po = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }); window.__po.observe({ entryTypes: ['longtask'] }); });
    const t = Date.now(); const extra = await fn(); const wall = Date.now() - t;
    await win.waitForTimeout(250);
    const tasks = await win.evaluate(() => window.__lt.slice());
    return { wall, max: Math.round(Math.max(0, ...tasks)), total: Math.round(tasks.reduce((a, b) => a + b, 0)), n: tasks.length, extra };
  };
  async function step(name, limits, fn) {
    try {
      const r = await lt(fn);
      const bad = [];
      if (limits.wall && r.wall > limits.wall) bad.push(`tempo ${r.wall}ms > ${limits.wall}`);
      if (limits.max && r.max > limits.max) bad.push(`maior travamento ${r.max}ms > ${limits.max}`);
      const ok = bad.length === 0;
      results.push({ name, ok, ...r, bad });
      console.log(`${ok ? 'PASS' : 'FAIL'} [perf-ui] ${name} :: tempo=${r.wall}ms maior-travamento=${r.max}ms soma-travamentos=${r.total}ms (${r.n}) ${r.extra || ''}${bad.length ? ' !! ' + bad.join('; ') : ''}`);
    } catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`FAIL [perf-ui] ${name} :: ${e.message.split('\n')[0]}`); }
  }

  console.log(`INFO inicialização até a tela inicial: ${startup}ms`);
  await app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, dir);

  await step('Abrir workspace com 3.000 requests (árvore aparece)', { wall: 6000, max: 700 }, async () => {
    await win.click('[data-testid=welcome-open]');
    await win.waitForSelector('[data-testid="node-Pasta 0"]', { timeout: 30000 });
    const rows = await win.$$eval('[role=treeitem]', (r) => r.length);
    return `linhas no DOM=${rows}`;
  });

  await win.screenshot({ path: __dirname + '/shots/perf-arvore-3000.png' });
  await step('Expandir uma pasta de 50 itens', { wall: 1000, max: 250 }, async () => {
    await win.click('[data-testid="node-Pasta 0"]'); await win.waitForSelector('[data-testid="node-Req 0-1"]');
    return '';
  });

  await step('Clicar numa request da árvore (seleção + abrir aba)', { wall: 1500, max: 300 }, async () => {
    await win.click('[data-testid="node-Req 0-1"]');
    return '';
  });

  await step('Recolher a pasta', { wall: 1000, max: 250 }, async () => {
    await win.click('[data-testid="node-Pasta 0"]'); await win.locator('[data-testid="node-Req 0-1"]').waitFor({ state: 'detached' });
    return '';
  });

  await step('Digitar no filtro da árvore (busca "Req 59-4")', { wall: 2500, max: 400 }, async () => {
    await win.fill('[data-testid=tree-filter]', 'Req 59-4');
    await win.waitForSelector('[data-testid="node-Req 59-4"]');
    const rows = await win.$$eval('[role=treeitem]', (r) => r.length);
    await win.fill('[data-testid=tree-filter]', '');
    await win.waitForSelector('[data-testid="node-Pasta 0"]');
    return `linhas filtradas=${rows}`;
  });

  await step('Navegar na árvore com as setas (20 teclas)', { wall: 4000, max: 300 }, async () => {
    await win.focus('[data-testid="node-Pasta 0"]');
    for (let i = 0; i < 20; i++) await win.keyboard.press('ArrowDown');
    return '';
  });

  const pick = async (name) => { await win.fill('[data-testid=tree-filter]', name); await win.waitForSelector(`[data-testid="node-${name}"]`, { timeout: 10000 }); await win.click(`[data-testid="node-${name}"]`); };

  await step('Resposta JSON de 2 MB: enviar e mostrar', { wall: 6000, max: 1000 }, async () => {
    await pick('JSON 2MB'); await win.click('[data-testid=btn-send]');
    await win.waitForSelector('[data-testid=resp-status]', { timeout: 30000 });
    await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 30000 });
    return await win.textContent('[data-testid=resp-status]');
  });

  await step('Resposta JSON de 20 MB: enviar e mostrar', { wall: 15000, max: 3000 }, async () => {
    await pick('JSON 20MB'); await win.click('[data-testid=btn-send]');
    await win.waitForSelector('[data-testid=resp-status]', { timeout: 60000 });
    await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 60000 });
    return await win.textContent('[data-testid=resp-status]');
  });

  await step('Trocar de aba com a resposta de 20 MB aberta', { wall: 3000, max: 1500 }, async () => {
    await pick('JSON 2MB'); await pick('JSON 20MB');
    return '';
  });

  await step('gRPC server-streaming com 5.000 mensagens: invocar e mostrar', { wall: 15000, max: 3000 }, async () => {
    await pick('gRPC 5000');
    await win.waitForSelector('[data-testid=btn-send]', { timeout: 15000 });
    await win.waitForTimeout(1500);
    await win.click('[data-testid=btn-send]');
    await win.waitForSelector('[data-testid=resp-status]', { timeout: 60000 });
    await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 60000 });
    return await win.textContent('[data-testid=resp-status]');
  });

  await step('Reenviar a mesma request 5 vezes seguidas (sem acumular lentidão)', { wall: 25000, max: 3000 }, async () => {
    for (let i = 0; i < 5; i++) { await win.click('[data-testid=btn-send]'); await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 60000 }); }
    return '';
  });

  const heap = await win.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));
  await win.screenshot({ path: __dirname + '/shots/perf-final.png' }); console.log(`INFO heap do renderer no fim: ${heap}MB`);
  results.push({ name: 'heap final do renderer < 700MB', ok: heap < 0 || heap < 700, heap });
  console.log(`${heap < 0 || heap < 700 ? 'PASS' : 'FAIL'} [perf-ui] heap final do renderer < 700MB :: ${heap}MB`);
  results.push({ name: 'Sem erros de JavaScript', ok: errors.length === 0 });
  console.log(`${errors.length === 0 ? 'PASS' : 'FAIL'} [perf-ui] Sem erros de JavaScript ${errors.join(' | ')}`);

  fs.writeFileSync(path.join(__dirname, 'perf.json'), JSON.stringify(results, null, 2));
  const f = results.filter((r) => !r.ok).length;
  console.log(`\n== perf-ui: ${results.length - f} passaram, ${f} falharam`);
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await m.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
