/* Jaiminho Web: implementa no navegador a mesma ponte (window.jaiminho) que o preload do Electron oferece.
   call() → POST /api/call; eventos → SSE; diálogos de pasta/arquivo/salvar → seletores dentro da página. */
(() => {
  'use strict';
  const H = { 'content-type': 'application/json', 'x-jaiminho-web': '1' };
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body || {}), credentials: 'same-origin' });
    if (r.status === 401) { location.reload(); throw new Error('Sessão expirada'); }
    return r.json();
  };
  const get = async (url) => { const r = await fetch(url, { credentials: 'same-origin' }); if (r.status === 401) { location.reload(); throw new Error('Sessão expirada'); } return r.json(); };
  let infoP = null;
  const info = () => (infoP = infoP || get('/api/info'));
  const basename = (p) => String(p || '').split(/[\\/]/).pop();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2, 10));

  // ---------- exportações: o servidor grava em downloads/ e o navegador baixa quando a chamada termina
  const pendingSaves = new Set();
  function findPending(v, depth = 0) {
    if (typeof v === 'string') return pendingSaves.has(v) ? v : null;
    if (!v || typeof v !== 'object' || depth > 3) return null;
    for (const x of Object.values(v)) { const f = findPending(x, depth + 1); if (f) return f; }
    return null;
  }
  const download = (p) => { const a = document.createElement('a'); a.href = `/api/download?path=${encodeURIComponent(p)}`; a.download = basename(p); document.body.appendChild(a); a.click(); a.remove(); };

  // ---------- eventos do servidor (progresso do runner, streams gRPC...)
  const listeners = new Set();
  const es = new EventSource('/api/events');
  es.onmessage = (m) => { let ev; try { ev = JSON.parse(m.data); } catch { return; } for (const l of listeners) { try { l(ev); } catch (e) { console.error(e); } } };

  // ---------- janelinhas (usam as variáveis de cor do tema do app)
  function modal(title, build, buttons, opts = {}) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px';
      const box = document.createElement('div');
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
      const prevFocus = document.activeElement;
      box.style.cssText = `background:var(--bg2,#14203f);color:var(--text,#e8ecf8);border:1px solid var(--line,#2a3558);border-radius:10px;width:${opts.width || 460}px;max-width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.5);font:14px var(--sans,system-ui,sans-serif)`;
      const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'padding:12px 16px;font-weight:600;border-bottom:1px solid var(--line,#2a3558)';
      const body = document.createElement('div'); body.tabIndex = -1; body.style.cssText = 'padding:12px 16px;overflow:auto;flex:1;min-height:0';
      const foot = document.createElement('div'); foot.style.cssText = 'padding:10px 16px;border-top:1px solid var(--line,#2a3558);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';
      const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey, true); try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch { /* ignore */ } resolve(v); };
      const api = { body, foot, close };
      const btn = (b, i) => { const e = document.createElement('button'); e.textContent = b.label; e.className = `btn ${b.primary ? 'primary' : ''}`; e.disabled = !!b.disabled; e.onclick = () => (b.onClick ? b.onClick(api) : close(b.value !== undefined ? b.value : i)); if (b.ref) b.ref(e); return e; };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(opts.cancelValue); return; }
        if (e.key === 'Tab') { // mantém o foco dentro da janela (e não deixa o app por baixo tratar a tecla)
          e.stopPropagation();
          const f = [...box.querySelectorAll('button:not([disabled]),input:not([type=hidden]),textarea,select,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
          if (!f.length) return; const a = document.activeElement;
          if (!box.contains(a)) { e.preventDefault(); f[0].focus(); }
          else if (e.shiftKey && (a === f[0] || !!(a.compareDocumentPosition(f[0]) & Node.DOCUMENT_POSITION_FOLLOWING))) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && (a === f[f.length - 1] || !!(a.compareDocumentPosition(f[f.length - 1]) & Node.DOCUMENT_POSITION_PRECEDING))) { e.preventDefault(); f[0].focus(); }
        }
      };
      document.addEventListener('keydown', onKey, true);
      build(body, api);
      for (const [i, b] of buttons.entries()) foot.appendChild(btn(b, i));
      box.append(h, body, foot); ov.appendChild(box); ov.addEventListener('mousedown', (e) => { if (e.target === ov && opts.dismiss !== false) close(opts.cancelValue); });
      document.body.appendChild(ov);
      const first = foot.querySelector('.primary') || foot.lastChild; if (first) first.focus();
      if (opts.afterMount) opts.afterMount(api);
    });
  }

  function confirmDialog({ message, detail, buttons = ['Cancelar', 'OK'] }) {
    return modal(message || '', (body) => { if (detail) { const p = document.createElement('div'); p.textContent = detail; p.style.cssText = 'color:var(--muted,#9aa6c8);white-space:pre-wrap'; body.appendChild(p); } else body.style.display = 'none'; },
      buttons.map((label, i) => ({ label, value: i, primary: i === buttons.length - 1 })), { cancelValue: 0 });
  }

  // ---------- seletor de pasta/arquivo do SERVIDOR (+ envio do computador do usuário)
  async function picker({ mode, title, multi, filters }) {
    const i = await info();
    let cur = null; try { cur = localStorage.getItem(mode === 'dir' ? 'web:lastdir' : 'web:lastfile'); } catch { /* ignore */ }
    let path = cur || i.workspacesDir; let showAll = false; const chosen = new Set();
    const exts = (filters || []).flatMap((f) => f.extensions || []).filter((e) => e && e !== '*').map((e) => e.toLowerCase());
    return modal(title || (mode === 'dir' ? 'Escolher pasta no servidor' : 'Escolher arquivo'), (body, api) => {
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:8px';
      const up = document.createElement('button'); up.className = 'btn sm'; up.style.minHeight = '30px'; up.style.minWidth = '30px'; up.textContent = '↑'; up.title = 'Pasta de cima'; up.setAttribute('aria-label', 'Pasta de cima');
      const loc = document.createElement('div'); loc.className = 'mono'; loc.style.cssText = 'flex:1;font-size:12px;word-break:break-all;color:var(--muted,#9aa6c8)';
      bar.append(up, loc); body.appendChild(bar);
      const list = document.createElement('div'); list.style.cssText = 'border:1px solid var(--line,#2a3558);border-radius:6px;height:300px;overflow:auto'; body.appendChild(list);
      let parent = null; let selDir = null;
      const row = (txt, cls) => { const d = document.createElement('div'); d.textContent = txt; d.style.cssText = 'padding:5px 10px;cursor:pointer;display:flex;gap:8px;align-items:center'; d.onmouseenter = () => { if (!d.dataset.sel) d.style.background = 'var(--bg3,#1c2a52)'; }; d.onmouseleave = () => { if (!d.dataset.sel) d.style.background = ''; }; d.className = cls || ''; return d; };
      const load = async (p) => {
        list.textContent = 'Carregando…';
        let r; try { r = await get(`/api/fs?path=${encodeURIComponent(p)}${mode === 'file' ? '&files=1' : ''}`); } catch (e) { list.textContent = e.message; return; }
        if (r.ok === false) { if (p !== i.workspacesDir) return load(i.workspacesDir); list.textContent = r.error; return; }
        path = r.path; parent = r.parent; loc.textContent = r.path; up.disabled = !parent; list.textContent = ''; selDir = null;
        if (mode === 'file') chosen.clear();
        for (const e of r.entries) {
          if (e.type === 'file' && exts.length && !showAll && !exts.includes(e.name.split('.').pop().toLowerCase())) continue;
          const d = row(`${e.type === 'dir' ? (e.workspace ? '🗂 ' : '📁 ') : '📄 '}${e.name}`);
          if (e.type === 'dir') { d.ondblclick = () => load(`${path}/${e.name}`); d.onclick = () => { if (mode === 'dir') { for (const x of list.children) { x.dataset.sel = ''; x.style.background = ''; } d.dataset.sel = '1'; d.style.background = 'var(--azul-profundo,#1b3a8a)'; selDir = `${path}/${e.name}`; } else load(`${path}/${e.name}`); }; }
          else {
            d.onclick = () => { const full = `${path}/${e.name}`; if (!multi) { chosen.clear(); for (const x of list.children) { x.dataset.sel = ''; x.style.background = ''; } } if (chosen.has(full)) { chosen.delete(full); d.dataset.sel = ''; d.style.background = ''; } else { chosen.add(full); d.dataset.sel = '1'; d.style.background = 'var(--azul-profundo,#1b3a8a)'; } };
            d.ondblclick = () => { if (!multi) { chosen.clear(); chosen.add(`${path}/${e.name}`); api.close([...chosen]); } };
          }
          list.appendChild(d);
        }
        if (!list.children.length) { const d = document.createElement('div'); d.textContent = mode === 'dir' ? 'Nenhuma subpasta.' : 'Nada por aqui.'; d.style.cssText = 'padding:12px;color:var(--faint,#7a86a8)'; list.appendChild(d); }
      };
      up.onclick = () => parent && load(parent);
      api.reload = () => load(path); api.cwd = () => path; api.selDir = () => selDir;
      if (mode === 'file' && exts.length) { const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:8px;color:var(--muted,#9aa6c8);font-size:12px'; const c = document.createElement('input'); c.type = 'checkbox'; c.onchange = () => { showAll = c.checked; load(path); }; l.append(c, `Mostrar todos os arquivos (filtro: ${exts.map((e) => '.' + e).join(' ')})`); body.appendChild(l); }
      if (mode === 'dir') { const h = document.createElement('div'); h.textContent = 'Clique numa pasta para selecioná-la (duplo clique entra nela). Sem seleção, usa a pasta aberta.'; h.style.cssText = 'margin-top:8px;font-size:12px;color:var(--faint,#7a86a8)'; body.appendChild(h); }
      load(path);
    }, [
      { label: 'Cancelar', value: null },
      ...(mode === 'dir' ? [{ label: 'Nova pasta…', onClick: async (api) => { const n = await promptName('Nome da nova pasta'); if (!n) return; const r = await post('/api/fs/mkdir', { path: api.cwd(), name: n }); if (r.ok === false) alert(r.error); else api.reload(); } }] : [{
        label: 'Enviar do meu computador…', onClick: (api) => {
          const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = !!multi; if (exts.length) inp.accept = exts.map((e) => '.' + e).join(',');
          inp.onchange = async () => {
            const batch = uid(); const out = [];
            for (const f of inp.files) { const r = await fetch(`/api/upload?batch=${batch}&name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'x-jaiminho-web': '1' }, body: f, credentials: 'same-origin' }).then((x) => x.json()); if (!r.ok) { alert(r.error); return; } out.push(r.path); }
            if (out.length) api.close(out);
          };
          inp.click();
        },
      }]),
      { label: mode === 'dir' ? 'Escolher' : 'Abrir', primary: true, onClick: (api) => { if (mode === 'dir') { const p = api.selDir() || api.cwd(); try { localStorage.setItem('web:lastdir', p); } catch { /* ignore */ } api.close([p]); } else if (chosen.size) { api.close([...chosen]); } } },
    ], { width: 560, cancelValue: null }).then((r) => {
      if (!r || !r.length) return null;
      if (mode === 'file') { try { localStorage.setItem('web:lastfile', r[0].slice(0, r[0].lastIndexOf('/'))); } catch { /* ignore */ } }
      return multi ? r : r[0];
    });
  }
  function promptName(title, text = '') {
    let input;
    return modal(title, (body) => { input = document.createElement('input'); input.className = 'in'; input.style.width = '100%'; input.value = text; input.onkeydown = (e) => { if (e.key === 'Enter') input.closest('[role=dialog]').querySelector('.primary').click(); }; body.appendChild(input); },
      [{ label: 'Cancelar', value: null }, { label: 'OK', primary: true, onClick: (api) => api.close(input.value.trim()) }], { afterMount: () => input && input.focus(), cancelValue: null });
  }

  async function clipRead() {
    try { return await navigator.clipboard.readText(); } catch { /* sem permissão ou HTTP sem TLS */ }
    let ta;
    return modal('Colar', (body) => { const h = document.createElement('div'); h.textContent = 'O navegador não deixou ler a área de transferência (precisa de HTTPS ou permissão). Cole aqui com Ctrl+V:'; h.style.cssText = 'margin-bottom:8px;color:var(--muted,#9aa6c8)'; ta = document.createElement('textarea'); ta.className = 'in'; ta.style.cssText = 'width:100%;height:140px'; body.append(h, ta); },
      [{ label: 'Cancelar', value: '' }, { label: 'Usar', primary: true, onClick: (api) => api.close(ta.value) }], { afterMount: () => ta && ta.focus(), cancelValue: '' });
  }
  async function clipWrite(t) {
    try { await navigator.clipboard.writeText(String(t)); return true; } catch { /* fallback */ }
    const ta = document.createElement('textarea'); ta.value = String(t); ta.style.cssText = 'position:fixed;top:-100px'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); return ok;
  }

  window.__jaiminhoWeb = true;
  window.jaiminho = {
    call: async (op, args) => {
      const r = await post('/api/call', { op, args });
      if (!r.ok) throw new Error(r.error);
      const f = findPending(args); if (f) { pendingSaves.delete(f); download(f); }
      return r.result;
    },
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    dialog: {
      openFile: (o = {}) => picker({ mode: 'file', title: o.title, multi: !!o.multi, filters: o.filters }),
      openDir: (o = {}) => picker({ mode: 'dir', title: o.title }),
      save: async (o = {}) => { const i = await info(); const p = `${i.downloadsDir}/${basename(o.defaultPath || 'arquivo')}`; pendingSaves.add(p); return p; },
      confirm: confirmDialog,
    },
    clipboard: { write: clipWrite, read: clipRead },
    showItem: (p) => { clipWrite(p); return Promise.resolve(true); },
    info: async () => { const i = await info(); return { version: i.version, userData: i.userData, platform: 'web', electron: 'navegador', node: i.node, secretsProtection: i.secretsProtection }; },
    setTheme: () => Promise.resolve(true),
    closeOk: () => Promise.resolve(true),
    closeAck: () => Promise.resolve(true),
    resolveProxy: () => Promise.resolve('DIRECT'),
  };
})();
