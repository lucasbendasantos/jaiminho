// Estado global simples (useSyncExternalStore) + ações.
import { useSyncExternalStore } from 'react';

const api = window.jaiminho;
let state = {
  ws: null, tree: null, envs: [], activeEnvId: null, missingSecrets: [],
  tabs: [], activeTab: null, toasts: [], modal: null, sidebar: 'collections', selected: null, multi: [],
  theme: 'padrao', layout: 'vertical', mocks: { running: false }, booted: false,
};
const subs = new Set();
export function getState() { return state; }
export function setState(patch) { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; subs.forEach((f) => f()); }
export function useStore(sel = (s) => s) { return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => sel(state)); }

export const call = (op, args) => api.call(op, args);

let toastSeq = 0;
export function toast(text, kind = 'info', ms = 4500) {
  if (state.toasts.some((t) => t.text === String(text))) return;
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text: String(text), kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}
export async function safe(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; } catch (e) { toast(e.message || String(e), 'err', 8000); return undefined; }
}

export const THEMES = [
  { id: 'padrao', nome: 'Padrão', desc: 'Azul-marinho do Jaiminho', cores: ['#050a1c', '#0f1d40', '#7ED9F1'] },
  { id: 'preto', nome: 'Preto', desc: 'Preto puro, neutro', cores: ['#000000', '#121215', '#7ED9F1'] },
  { id: 'branco', nome: 'Branco', desc: 'Claro, alto contraste', cores: ['#eef0f5', '#ffffff', '#0e7490'] },
];
/** Aceita os valores antigos (dark/light) e qualquer lixo → um tema válido. */
export function normalizeTheme(t) { if (t === 'light') return 'branco'; if (t === 'dark') return 'padrao'; return THEMES.some((x) => x.id === t) ? t : 'padrao'; }
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* sem storage: tudo bem */ }
  try { window.jaiminho && window.jaiminho.setTheme && window.jaiminho.setTheme(t); } catch { /* ignore */ }
}
export async function setTheme(t) { t = normalizeTheme(t); applyTheme(t); setState({ theme: t }); try { await call('app:saveSettings', { theme: t }); } catch { /* ignore */ } }
export function cycleTheme() { const i = THEMES.findIndex((x) => x.id === getState().theme); return setTheme(THEMES[(i + 1) % THEMES.length].id); }
export function openHelp(section) { setState({ modal: { name: 'help', props: { section } } }); }
export function openModal(name, props = {}) { setState({ modal: { name, props } }); }
export function closeModal() { setState({ modal: null }); }

// ---------------- workspace ----------------
export async function applySummary(sum) {
  if (!sum) { setState({ ws: null, tree: null, envs: [], tabs: [], activeTab: null }); return; }
  const envs = await call('env:list');
  const app = await call('app:settings');
  const active = (app.activeEnv || {})[sum.dir];
  setState((s) => ({ ws: { dir: sum.dir, name: sum.name, settings: sum.settings }, tree: sum.tree, envs, missingSecrets: sum.missingSecrets || [], activeEnvId: envs.some((e) => e.id === active) ? active : (s.ws && s.ws.dir === sum.dir ? s.activeEnvId : null) }));
}
export async function refreshTree() {
  const tree = await call('ws:tree'); const envs = await call('env:list'); const missingSecrets = await call('secret:missing');
  setState((s) => ({ tree, envs, missingSecrets, tabs: s.tabs.filter((t) => !t.itemId || (t.type === 'environment' ? envs.some((e) => e.id === t.itemId) : existsInTree(tree, t.itemId))) }));
}
function existsInTree(tree, id) {
  const walk = (n) => n.id === id || (n.children || []).some(walk);
  return (tree.collections || []).some(walk);
}
export async function setActiveEnv(id) {
  setState({ activeEnvId: id || null });
  const app = await call('app:settings');
  await call('app:saveSettings', { activeEnv: { ...(app.activeEnv || {}), [state.ws.dir]: id || null } });
}

// ---------------- abas ----------------
let tabSeq = 0;
export function findTab(itemId) { return state.tabs.find((t) => t.itemId === itemId); }
export async function openItem(itemId, type) {
  const existing = findTab(itemId);
  if (existing) { setState({ activeTab: existing.key, selected: itemId }); return existing; }
  let data; let info = null;
  if (type === 'environment') data = await call('env:get', { id: itemId });
  else { data = await call('item:get', { id: itemId }); info = await call('item:info', { id: itemId }); }
  const tab = { key: `t${++tabSeq}`, itemId, type: type || data.type, draft: data, saved: JSON.stringify(data), parentId: info && info.parentId, result: null, running: false, events: [] };
  // aba "provisória": substitui a provisória anterior não modificada (como o Postman)
  setState((s) => {
    const tabs = s.tabs.filter((t) => !(t.preview && !isDirty(t)));
    return { tabs: [...tabs, { ...tab, preview: true }], activeTab: tab.key, selected: itemId };
  });
  return tab;
}
export function openSpecial(type, title, extra = {}) {
  const ex = state.tabs.find((t) => t.type === type);
  if (ex) { setState({ activeTab: ex.key }); return ex; }
  const tab = { key: `t${++tabSeq}`, type, title, ...extra };
  setState((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.key }));
  return tab;
}
export function newDraftRequest(kind = 'http', parentId = null, patch = {}) {
  const base = { kind, name: kind === 'grpc' ? 'Nova request gRPC' : kind === 'soap' ? 'Nova request SOAP' : 'Nova request', method: kind === 'grpc' ? undefined : kind === 'soap' ? 'POST' : 'GET', url: '', params: [], headers: [], auth: { type: 'inherit' }, body: kind === 'soap' ? { mode: 'raw', language: 'xml', raw: '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n  <soapenv:Header/>\n  <soapenv:Body>\n  </soapenv:Body>\n</soapenv:Envelope>' } : { mode: 'none' }, scripts: {}, vars: [], settings: {} };
  if (kind === 'soap') base.soap = { version: '1.1', action: '' };
  if (kind === 'grpc') base.grpc = { method: '', schema: { source: 'reflection' }, metadata: [], message: '{\n  \n}', options: {} };
  const draft = { ...base, ...patch };
  const tab = { key: `t${++tabSeq}`, itemId: null, type: 'request', draft, saved: null, parentId, result: null, running: false, events: [] };
  setState((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.key }));
  return tab;
}
export function updateTab(key, patch) { setState((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch), preview: false } : t)) })); }
export function updateTabQuiet(key, patch) { setState((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)) })); }
export function updateDraft(key, fn) { updateTab(key, (t) => ({ draft: typeof fn === 'function' ? fn(t.draft) : { ...t.draft, ...fn } })); }
export function isDirty(t) { return t.type && ['request', 'collection', 'folder', 'environment'].includes(t.type) && (t.saved === null || JSON.stringify(t.draft) !== t.saved); }
export async function closeTab(key, force = false) {
  const t = state.tabs.find((x) => x.key === key); if (!t) return;
  if (!force && isDirty(t)) {
    const r = await api.dialog.confirm({ message: `Salvar as alterações em "${t.draft?.name || 'request'}"?`, buttons: ['Cancelar', 'Descartar', 'Salvar'] });
    if (r === 0) return;
    if (r === 2) { const ok = await saveTab(key); if (!ok) return; }
  }
  setState((s) => {
    const idx = s.tabs.findIndex((x) => x.key === key);
    const tabs = s.tabs.filter((x) => x.key !== key);
    const activeTab = s.activeTab === key ? (tabs[idx] || tabs[idx - 1] || {}).key || null : s.activeTab;
    return { tabs, activeTab };
  });
}

/** Salva a aba (request nova pede o destino). */
export async function saveTab(key) {
  const t = state.tabs.find((x) => x.key === key); if (!t) return false;
  if (t.type === 'environment') {
    const id = await safe(() => call('env:save', { ...t.draft, id: t.itemId || undefined }));
    if (!id) return false;
    const fresh = await call('env:get', { id });
    updateTabQuiet(key, { itemId: id, draft: fresh, saved: JSON.stringify(fresh) });
    await refreshTree(); toast('Ambiente salvo', 'ok', 2000); return true;
  }
  if (t.type === 'collection' && t.itemId) {
    const vars = t.draft.vars || [];
    await safe(() => call('item:save', { id: t.itemId, data: { ...t.draft } }));
    await safe(() => call('collection:saveVars', { id: t.itemId, vars }));
    const fresh = await call('item:get', { id: t.itemId });
    updateTabQuiet(key, { draft: fresh, saved: JSON.stringify(fresh) });
    await refreshTree(); toast('Coleção salva', 'ok', 2000); return true;
  }
  if (!t.itemId) {
    let parentId = t.parentId;
    if (!parentId) {
      const r = await new Promise((resolve) => openModal('saveAs', { name: t.draft.name, resolve }));
      if (!r) return false;
      parentId = r.parentId; t.draft = { ...t.draft, name: r.name };
    }
    const id = await safe(() => call('item:createRequest', { parentId, data: t.draft }));
    if (!id) return false;
    const fresh = await call('item:get', { id });
    updateTabQuiet(key, { itemId: id, parentId, draft: { ...fresh, id }, saved: JSON.stringify({ ...fresh, id }), preview: false });
    await refreshTree(); setState({ selected: id }); toast('Request salva', 'ok', 2000); return true;
  }
  const saved = await safe(() => call('item:save', { id: t.itemId, data: t.draft }));
  if (!saved) return false;
  updateTabQuiet(key, { draft: saved, saved: JSON.stringify(saved) });
  await refreshTree();
  return true;
}

export async function boot() {
  const theme = normalizeTheme((await call('app:settings')).theme);
  applyTheme(theme);
  const cur = await call('ws:current');
  await applySummary(cur);
  const mocks = await call('mocks:status');
  setState({ booted: true, theme, mocks });
}

export const api$ = api;
