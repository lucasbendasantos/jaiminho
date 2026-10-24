const { launch } = require('./lib');
(async () => {
  const H = await launch(); const { win, app, shot, step, open, log } = H;
  const R = (k, v) => log('R', k, JSON.stringify(v));
  // UX-13 ordem do dialogo (antes do workspace)
  await win.waitForSelector('[data-testid=welcome]');
  await step('ux13', async () => {
    R('ux13-welcome-botoes', await win.$$eval('[data-testid=welcome] button', (b) => b.map((x) => x.textContent.trim())));
    await app.evaluate(({ dialog }) => { global.__order = []; dialog.showOpenDialog = async () => { global.__order.push('dialog'); return { canceled: true, filePaths: [] }; }; });
    await win.click('[data-testid=welcome-new]'); await win.waitForTimeout(600);
    R('ux13-prompt-visivel-antes', await win.locator('[data-testid=modal-prompt]').count());
    R('ux13-ordem', await app.evaluate(() => global.__order));
    await shot('ux13-welcome-novo'); await win.keyboard.press('Escape');
  });
  await H.example();
  // UX-01
  await step('ux01', async () => {
    const opts = await win.$$eval('[data-testid=env-select] option', (o) => o.map((x) => [x.value, x.textContent]));
    R('env-options', opts);
    await win.selectOption('[data-testid=env-select]', opts[0][0]); await win.waitForTimeout(300);
    await open('Listar viajantes');
    await win.waitForTimeout(500);
    R('ux01-classes', await win.$$eval('.url-hl span', (s) => s.map((x) => [x.className, x.textContent, getComputedStyle(x).color])));
    R('ux01-aviso', await win.locator('[data-testid=url-missing]').allTextContents());
    R('ux01-title', await win.$eval('.url-wrap', (e) => e.title));
    await win.click('[data-testid=btn-send]'); await H.waitDone(); await win.waitForTimeout(300);
    R('ux01-resp', (await win.locator('[data-testid=resp-error]').allTextContents()).map((t) => t.slice(0, 300)));
    await shot('ux01-sem-ambiente');
    await win.selectOption('[data-testid=env-select]', opts[opts.length - 1][0]); await win.waitForTimeout(300);
    R('ux01-hover-title-com-env', await win.$eval('.url-wrap', (e) => e.title));
  });
  // UX-02
  await step('ux02', async () => { await open('Bearer (herdado da coleção)'); await win.click('[data-testid=req-tab-auth]'); await win.waitForTimeout(300); R('ux02', await win.locator('[data-testid=auth-inherited]').allTextContents()); await shot('ux02-auth-herdada'); });
  // UX-12
  await step('ux12', async () => { await win.click('[data-testid=req-tab-headers]'); await win.waitForTimeout(200); await win.click('[data-testid=auto-headers] summary'); R('ux12', await win.$eval('[data-testid=auto-headers]', (e) => e.innerText.slice(0, 400))); await shot('ux12-headers-auto'); });
  // UX-04/05/16 gRPC
  await step('ux04', async () => {
    await open('GetTraveller (unário)');
    R('ux16-grpc-hint-vazio', await win.evaluate(() => document.querySelector('.empty, .resp-empty, [data-testid=resp-empty]')?.innerText || [...document.querySelectorAll('div')].filter((d) => /grpcurl|cURL/.test(d.innerText || '') && d.children.length < 4).map((d) => d.innerText.slice(0, 120)).slice(0, 3)));
    R('ux16-mascote-resposta', await win.evaluate(() => [...document.querySelectorAll('img')].map((i) => [i.src.split('/').pop(), !!i.closest('[data-testid=resp-status]'), i.closest('.split > *')?.className || '', i.width])));
    await shot('ux16-grpc-vazio');
    await win.click('[data-testid=grpc-method]'); await win.waitForTimeout(1200);
    R('ux04', await win.evaluate(() => { const p = document.querySelector('.method-picker'); const r = p?.getBoundingClientRect(); const i = document.querySelector('[data-testid=grpc-method-search]')?.getBoundingClientRect(); return { rect: r && [r.left, r.right, r.width], vw: innerWidth, search: i && i.width }; }));
    await shot('ux04-seletor-metodo');
    await win.keyboard.press('ArrowDown'); await win.keyboard.press('ArrowDown'); R('ux04-foco-apos-setas', await win.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
  });
  await step('ux05', async () => {
    await open('Fail (erro com detalhes)'); await win.click('[data-testid=btn-send]'); await H.waitDone();
    R('ux05', await win.evaluate(() => { const b = document.querySelector('[data-testid=resp-error]'); const t = document.querySelector('[data-testid=resp-tab-details], [data-testid="resp-tab-Detalhes do erro"]'); return { err: b && b.getBoundingClientRect().height, tabs: [...document.querySelectorAll('[data-testid^=resp-tab]')].map((x) => [x.textContent, Math.round(x.getBoundingClientRect().bottom)]) }; }));
    // detalhes do erro e se abre sozinha
    R('ux05-aba-ativa', await win.evaluate(() => document.querySelector('[data-testid^=resp-tab].on, [data-testid^=resp-tab].active')?.textContent));
  });
  // UX-16 carregando + testes chip
  await step('ux16', async () => {
    await open('Lento (2 s)'); await win.click('[data-testid=btn-send]'); await win.waitForTimeout(900); await shot('ux16-carregando');
    R('ux16-load', await win.evaluate(() => document.querySelector('[data-testid=resp-status]')?.innerText || document.body.innerText.match(/Entregando[^\n]*/)?.[0]));
    R('ux16-tab-label', await win.$$eval('[data-testid=tabs] .tab', (t) => t.map((x) => x.innerText)));
    await H.waitDone();
    await open('Erro 500'); await win.click('[data-testid=btn-send]'); await H.waitDone(); await shot('ux17-erro500');
    R('ux17-status', await win.$eval('[data-testid=resp-status]', (e) => e.innerText));
    R('ux16-chip-testes-tab', await win.$$eval('[data-testid=tabs] .tab', (t) => t.map((x) => x.innerText)));
  });
  // UX-08 painel vars + segredos
  await step('ux08', async () => {
    await win.click('[data-testid=side-envs]'); await win.click('[data-testid="env-Mocks locais"]'); await win.waitForTimeout(300);
    await win.click('[data-testid=btn-vars]'); await win.waitForTimeout(400); await shot('ux08-vars-painel-aba-ambiente');
    R('ux08-vars', await win.$eval('[data-testid=vars-panel]', (e) => e.innerText.slice(0, 700)));
    await win.click('[data-testid=btn-vars]').catch(() => {});
    R('ux07-cor', await win.$$eval('input[type=color]', (i) => i.map((x) => x.getBoundingClientRect().width)));
    R('ux08-olho', await win.evaluate(() => [...document.querySelectorAll('table.kv button, .kv button')].map((b) => [b.title, b.getAttribute('aria-label')]).slice(0, 4)));
    await win.click('[data-testid=side-collections]');
  });
  // UX-15 historico
  await step('ux15', async () => { await win.click('[data-testid=side-history]'); await win.waitForTimeout(300); await shot('ux15-historico'); R('ux15', await win.$eval('[data-testid=sidebar]', (e) => e.innerText.slice(0, 500))); R('ux15-filtro', await win.locator('[data-testid=sidebar] input').count()); await win.click('[data-testid=side-collections]'); });
  // UX-18 ctx colecao e abas, UX-09 teclado
  await step('ux18', async () => {
    await win.click('[data-testid="node-1. REST / JSON"]', { button: 'right' }); await win.waitForTimeout(250);
    R('ux18-ctx-colecao', await win.$eval('[data-testid=ctx-menu]', (e) => e.innerText)); await shot('ux18-ctx-colecao'); await win.keyboard.press('Escape');
    await win.click('[data-testid="node-4. gRPC"]', { button: 'right' }); R('ux18-ctx-colecao-grpc', await win.$eval('[data-testid=ctx-menu]', (e) => e.innerText)); await win.keyboard.press('Escape');
    await win.click('[data-testid=tabs] .tab >> nth=0', { button: 'right' }); await win.waitForTimeout(250); R('ux18-ctx-aba', await win.locator('[data-testid=ctx-menu]').allInnerTexts()); await shot('ux18-ctx-aba'); await win.keyboard.press('Escape');
    R('ux18-botoes-topo', await win.$$eval('.topbar button', (b) => b.map((x) => [x.innerText.trim(), x.title, x.getAttribute('aria-label')])));
  });
  await step('ux09', async () => {
    R('ux09-aria', await win.evaluate(() => ({ treeRole: document.querySelector('[data-testid=tree]')?.getAttribute('role'), treeitems: document.querySelectorAll('[role=treeitem]').length, withTab: document.querySelectorAll('[role=treeitem][tabindex]').length, tabsRole: document.querySelectorAll('[role=tab]').length, tablist: document.querySelectorAll('[role=tablist]').length, iconBtnsNoLabel: [...document.querySelectorAll('button')].filter((b) => !b.innerText.trim() && !b.getAttribute('aria-label')).map((b) => b.title || b.outerHTML.slice(0, 80)).slice(0, 15), closeBtn: (() => { const c = document.querySelector('[data-testid=tabs] .tab button, [data-testid=tabs] .tab .x'); const r = c?.getBoundingClientRect(); return r && [r.width, r.height, c.getAttribute('aria-label')]; })() })));
    // teclado na arvore
    await win.focus('[data-testid="node-Listar viajantes"]'); R('ux09-foco-no', await win.evaluate(() => document.activeElement?.getAttribute('data-testid')));
    await win.keyboard.press('ArrowDown'); R('ux09-seta-baixo', await win.evaluate(() => document.activeElement?.getAttribute('data-testid')));
    await win.keyboard.press('ArrowLeft'); await win.keyboard.press('Enter'); await win.waitForTimeout(300);
    await win.keyboard.press('F2'); await win.waitForTimeout(200); R('ux09-f2', await win.locator('[data-testid=rename-input]').count()); await win.keyboard.press('Escape');
    await shot('ux09-arvore-foco');
  });
  // modais: foco inicial, trap, restore, aria
  for (const [name, opener] of [['importar', () => win.click('[data-testid=btn-import]')], ['config', () => win.click('[data-testid=btn-settings]')], ['ajuda', () => win.click('[data-testid=btn-help]')], ['mocks', () => win.click('[data-testid=ws-switch]').then(() => {})]]) {
    await step('modal-' + name, async () => {
      await win.focus('[data-testid=btn-help]'); await opener(); await win.waitForTimeout(400);
      const info = await win.evaluate(() => { const m = document.querySelector('[role=dialog]'); return { role: m?.getAttribute('role'), modal: m?.getAttribute('aria-modal'), label: m?.getAttribute('aria-labelledby') || m?.getAttribute('aria-label'), focus: document.activeElement?.outerHTML.slice(0, 100), inside: !!m?.contains(document.activeElement) }; });
      let escaped = 0; for (let i = 0; i < 40; i++) { await win.keyboard.press('Tab'); if (!(await win.evaluate(() => !!document.activeElement.closest('[role=dialog]')))) { escaped = i + 1; break; } }
      await win.keyboard.press('Shift+Tab');
      await win.keyboard.press('Escape'); await win.waitForTimeout(300);
      R('modal-' + name, { ...info, tabSaiu: escaped, fechou: (await win.locator('[role=dialog]').count()) === 0, focoVolta: await win.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName) });
    });
  }
  // toasts vs modal
  await step('ux06', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('event', { type: 'menu:shortcuts' })); await win.waitForTimeout(300);
    await win.click('[data-testid=btn-settings]'); await win.click('[data-testid=settings-save]'); await win.waitForTimeout(300);
    R('ux06-toasts', await win.evaluate(() => { const t = document.querySelector('[data-testid=toasts]')?.getBoundingClientRect(); return t && [t.left, t.top, t.right, t.bottom]; }));
    await win.keyboard.press('Escape');
    await win.click('[data-testid=btn-settings]'); await win.waitForTimeout(200); R('ux14-tabs', await win.$$eval('[data-testid^=settings-]', (e) => e.map((x) => x.textContent))); await win.click('[data-testid=settings-certs]'); await win.waitForTimeout(200); R('ux14-certs', await win.$eval('[role=dialog]', (e) => e.innerText.slice(0, 900))); await shot('ux14-certs'); R('ux14-addcert', await win.locator('[data-testid=add-cert]').count()); await win.click('[data-testid=add-cert]').catch(() => {}); await win.waitForTimeout(200); R('ux14-cert-format', await win.locator('[data-testid=cert-format]').count()); await shot('ux14-mtls'); await win.keyboard.press('Escape');
  });
  // UX-20 tipografia
  await step('ux20', async () => { R('ux20', await win.evaluate(() => { const f = (s) => { const e = document.querySelector(s); return e ? [getComputedStyle(e).fontSize, getComputedStyle(e).width] : null; }; const h = document.querySelector('.hsplit'); return { method: f('.method'), kind: f('.kind-tag'), count: f('.count'), scope: f('.scope-tag'), hsplit: h && [getComputedStyle(h).height, getComputedStyle(h).width, getComputedStyle(h).backgroundColor] }; })); });
  // UX-11 emojis
  await step('ux11', async () => { R('ux11', await win.evaluate(() => { const t = document.body.innerText; const m = t.match(/\p{Extended_Pictographic}/gu); return { emojis: m ? [...new Set(m)] : [], svgIcons: document.querySelectorAll('svg').length }; })); });
  // UX-10 cm fundo
  R('erros', H.errs);
  await H.quit();
})().catch((e) => { console.error(e); process.exit(2); });
