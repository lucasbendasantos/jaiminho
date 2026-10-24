const { launch, fs, os, path } = require('./lib');
(async () => {
  const H = await launch(); const { win, app, shot, step, open, log } = H;
  const R = (k, v) => log('R', k, JSON.stringify(v));
  await H.example();
  await step('help', async () => {
    await win.keyboard.press('F1'); await win.waitForTimeout(400);
    R('nav', await win.$$eval('.help-nav button', (b) => b.map((x) => x.textContent)));
    R('layout', await win.evaluate(() => { const m = document.querySelector('[role=dialog]').getBoundingClientRect(); const b = document.querySelector('[data-testid=help-body]'); return { modal: [m.width, m.height], bodyScroll: [b.scrollHeight, b.clientHeight], fs: getComputedStyle(b).fontSize }; }));
    for (const t of ['padrao', 'preto', 'branco']) { await win.keyboard.press('Escape'); await H.setTheme(t); await win.keyboard.press('F1'); await win.waitForTimeout(300); await win.click('[data-testid=help-variaveis]'); await shot(`help-${t}-variaveis`); }
    await win.click('[data-testid=help-grpc]'); await shot('help-branco-grpc');
    await win.click('[data-testid=help-importar]'); await shot('help-branco-importar');
    await win.keyboard.press('Escape'); await H.setTheme('padrao'); await win.keyboard.press('F1'); await win.waitForTimeout(300);
    for (const q of ['postman', 'curl', 'variavel', 'collection', 'environment', 'proxy', 'cookie', 'pre-request', 'mock', 'swagger', 'ctrl+s', 'atalho', 'xyz', 'historico', 'histórico', 'certificado', 'oauth', 'graphql', 'websocket', 'fork', 'sincroniz', 'cookies', 'snippet', 'codigo', 'duplicar', 'importar do postman']) {
      await win.fill('[data-testid=help-search]', q); await win.waitForTimeout(80);
      R('busca:' + q, await win.$$eval('.help-nav button', (b) => b.map((x) => x.textContent.split(' ')[0])));
    }
    await win.fill('[data-testid=help-search]', 'xyz'); await shot('help-busca-vazia'); await win.fill('[data-testid=help-search]', '');
    // teclado
    await win.focus('[data-testid=help-search]'); await win.keyboard.press('Tab'); R('tab-apos-busca', await win.evaluate(() => document.activeElement?.textContent));
    await win.keyboard.press('ArrowDown'); R('seta-baixo-no-nav', await win.evaluate(() => document.activeElement?.textContent));
    R('aria-current', await win.evaluate(() => [...document.querySelectorAll('.help-nav button')].some((b) => b.hasAttribute('aria-current') || b.hasAttribute('aria-selected'))));
    // abre ajuda a partir do tema? HelpLink existe?
    await win.keyboard.press('Escape');
    await win.setViewportSize({ width: 1100, height: 700 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700)); await win.waitForTimeout(300);
    await win.keyboard.press('F1'); await win.waitForTimeout(300); await shot('help-1100'); await win.keyboard.press('Escape');
  });
  await step('inline-rename', async () => {
    await win.setViewportSize({ width: 1440, height: 900 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await win.click('[data-testid=btn-new-collection]'); await win.waitForTimeout(500);
    R('ux18-nova-colecao', await win.evaluate(() => ({ modal: !!document.querySelector('[data-testid=modal-prompt]'), rename: !!document.querySelector('[data-testid=rename-input]') })));
    await shot('ux18-nova-colecao'); await win.keyboard.press('Enter'); await win.waitForTimeout(300);
    await win.click('[data-testid="node-5. Importado do Swagger"]', { button: 'right' }); R('ctx-swagger', await win.$eval('[data-testid=ctx-menu]', (e) => e.innerText.split('\n'))); await win.keyboard.press('Escape');
    await win.click('[data-testid="node-Chat (bidi)"]'); await win.waitForTimeout(400); R('ux16-hint-bidi', await win.evaluate(() => document.querySelector('.stream-bar')?.innerText)); 
    await win.click('[data-testid="node-Chat (bidi)"]', { button: 'right' }); R('ctx-grpc-req', await win.$eval('[data-testid=ctx-menu]', (e) => e.innerText.split('\n'))); await win.keyboard.press('Escape');
    // resizer
    R('resizer', await win.evaluate(() => { const r = document.querySelector('.resizer'); return r && [getComputedStyle(r).width, getComputedStyle(r).cursor, getComputedStyle(r).backgroundColor]; }));
  });
  await step('ux05-1100', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700)); await win.setViewportSize({ width: 1100, height: 700 }); await win.waitForTimeout(300);
    await win.click('[data-testid="node-Fail (erro com detalhes)"]'); await win.click('[data-testid=btn-send]'); await H.waitDone(); await shot('ux05-grpc-erro-1100');
    await win.click('[data-testid=btn-settings]'); await win.waitForTimeout(300); await shot('janela-1100-config'); await win.keyboard.press('Escape');
  });
  R('erros', H.errs); await H.quit();
})().catch((e) => { console.error(e); process.exit(2); });
