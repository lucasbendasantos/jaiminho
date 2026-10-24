const { launch } = require('./lib');
(async () => {
  const H = await launch(); const { win, app, shot, step, open, log } = H;
  await H.example();
  // contraste em-pagina
  const contrastFn = () => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0,0,0,0]; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
    const bgOf = (el) => { let layers = []; for (let e = el; e; e = e.parentElement) { const b = parse(getComputedStyle(e).backgroundColor); if (b[3] > 0) layers.push(b); if (b[3] >= 1) break; } let base = [255,255,255]; if (!layers.length || layers[layers.length-1][3] < 1) base = parse(getComputedStyle(document.body).backgroundColor).slice(0,3); for (let i = layers.length - 1; i >= 0; i--) { const l = layers[i]; base = base.map((v, k) => l[k] * l[3] + v * (1 - l[3])); } return base; };
    const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * f[0] + .7152 * f[1] + .0722 * f[2]; };
    const out = [];
    const sels = ['.tree-row .name', '.tree-row.sel', '.tree-row.sel .name', '.m-GET', '.m-POST', '.m-PUT', '.m-DELETE', '.m-PATCH', '.m-SOAP', '.m-gRPC', '.hint', '.faint', '.muted', '[data-testid=btn-send]', '.statusbar', '.tab.active', '.tab', '.pill', '.kbd', '.scope-tag', '.kind-tag', '.help-tip', '.error-box', '.sub-tab', '.subtab', '.reqname .crumbs', '[data-testid=req-url]', '.v-ok', '.v-bad', '.topbar .icon-btn', '.dir-st', '.count'];
    for (const s of sels) { const el = document.querySelector(s); if (!el) continue; const fg0 = parse(getComputedStyle(el).color); const bg = bgOf(el); const fg = fg0.slice(0,3).map((v, k) => v * fg0[3] + bg[k] * (1 - fg0[3])); const L1 = lum(fg), L2 = lum(bg); const cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05); out.push([s, +cr.toFixed(2), getComputedStyle(el).fontSize]); }
    return out;
  };
  const results = {};
  for (const t of ['padrao', 'preto', 'branco']) {
    await H.setTheme(t); log('== tema', t);
    // 1 workspace HTTP
    await step('ws', async () => { await win.click('[data-testid=side-collections]'); await open('Listar viajantes'); await win.click('[data-testid=btn-send]'); await H.waitDone(); await win.waitForTimeout(300); await shot(`t-${t}-1-workspace`);
      results[t + '_contrast'] = await win.evaluate(`(${contrastFn})()`);
      results[t + '_cm'] = await win.evaluate(() => { const ed = document.querySelector('.cm-editor'); if (!ed) return null; const bg = getComputedStyle(ed).backgroundColor; const content = ed.querySelector('.cm-content'); const spans = [...ed.querySelectorAll('.cm-line span')].slice(0, 40).map((s) => getComputedStyle(s).color); return { bg, gutter: ed.querySelector('.cm-gutters') ? getComputedStyle(ed.querySelector('.cm-gutters')).backgroundColor : null, text: content ? getComputedStyle(content).color : null, colors: [...new Set(spans)], active: ed.querySelector('.cm-activeLine') ? getComputedStyle(ed.querySelector('.cm-activeLine')).backgroundColor : null }; });
      results[t + '_scroll'] = await win.evaluate(() => { const el = document.querySelector('.cm-scroller') || document.querySelector('.tree'); return el ? [getComputedStyle(el).scrollbarColor] : null; });
    });
    // 2 ambiente
    await step('env', async () => { await win.click('[data-testid=side-envs]'); await win.click('[data-testid="env-Mocks locais"]'); await win.waitForTimeout(400); await shot(`t-${t}-2-ambiente`); await win.click('[data-testid=side-collections]'); });
    // 3 gRPC erro
    await step('grpc', async () => { await open('Fail (erro com detalhes)'); await win.click('[data-testid=btn-send]'); await H.waitDone(); await shot(`t-${t}-3-grpc-erro`); });
    // 4 import
    await step('import', async () => { await win.click('[data-testid=btn-import]'); await win.waitForTimeout(300); await shot(`t-${t}-4-importar`); await win.keyboard.press('Escape'); await win.waitForTimeout(200); });
    // 5 settings
    await step('settings', async () => { await win.click('[data-testid=btn-settings]'); await win.waitForTimeout(300); await shot(`t-${t}-5-config`); await win.keyboard.press('Escape'); await win.waitForTimeout(200); });
    // 6 ctx
    await step('ctx', async () => { await win.click('[data-testid="node-Listar viajantes"]', { button: 'right' }); await win.waitForTimeout(300); await shot(`t-${t}-6-menu-contexto`);
      results[t + '_ctx'] = await win.evaluate(() => { const m = document.querySelector('[data-testid=ctx-menu]'); return m ? { role: m.getAttribute('role'), focused: document.activeElement === m || m.contains(document.activeElement), items: [...m.querySelectorAll('button,[role=menuitem]')].length } : null; });
      await win.keyboard.press('Escape'); await win.waitForTimeout(200); });
    // extras: hover, foco, selecionado, desabilitado
    await step('estados', async () => {
      await win.hover('[data-testid="node-Erro 500"]'); await win.waitForTimeout(150);
      await win.focus('[data-testid=req-tab-headers]').catch(() => {}); await win.keyboard.press('Tab');
      await win.screenshot({ path: H_PATH(`t-${t}-7-estados`), clip: { x: 0, y: 0, width: 1440, height: 420 } });
    });
  }
  require('fs').writeFileSync(__dirname + '/s1-results.json', JSON.stringify(results, null, 1));
  log('ERROS JS:', H.errs.join(' | ') || 'nenhum');
  await H.quit();
})().catch((e) => { console.error(e); process.exit(2); });
function H_PATH(n) { return require('path').join(__dirname, 'shots', n + '.png'); }
