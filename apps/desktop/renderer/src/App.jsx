import React, { useEffect, useState } from 'react';
import Sidebar, { ContextMenu } from './components/Sidebar';
import RequestEditor from './components/RequestEditor';
import { CollectionEditor, EnvironmentEditor, GlobalsEditor } from './components/ItemEditors';
import Modals, { VarsPanel, prompt } from './components/Modals';
import { useStore, setState, getState, call, boot, applySummary, openModal, closeTab, saveTab, newDraftRequest, setActiveEnv, toast, safe, isDirty, openSpecial, api$, THEMES, cycleTheme, openHelp } from './store';
import { sendTab, cancelTab } from './send';
import Icon from './icons';
import { showMenu } from './components/Sidebar';

function Welcome() {
  const [recent, setRecent] = useState([]);
  useEffect(() => { call('app:recent').then(setRecent).catch(() => {}); }, []);
  return (
    <div className="welcome" data-testid="welcome">
      <div className="inner">
        <img className="hero" src="./splash.png" alt="Jaiminho" />
        <div>
          <h1>Jaiminho</h1>
          <div className="tag">Entrega suas requests HTTP, XML/SOAP e gRPC. Local, sem conta e sem internet.</div>
          <div className="col">
            <button className="btn primary" onClick={newWorkspace} data-testid="welcome-new">Criar workspace…</button>
            <button className="btn" onClick={openWorkspace} data-testid="welcome-open">Abrir pasta de workspace…</button>
            <button className="btn" onClick={importFromPostman} data-testid="welcome-postman">Importar do Postman (backup ou coleções)…</button>
            <button className="btn" onClick={() => openModal('mocks')} data-testid="welcome-example">Experimentar com os servidores mock…</button>
            <button className="btn ghost" onClick={() => openHelp()} data-testid="welcome-help">Tutoriais e ajuda (F1)</button>
          </div>
          {recent.length > 0 && <div className="recent"><div className="hint">Recentes</div>{recent.map((r) => <button key={r.dir} onClick={() => openDir(r.dir)}><b>{r.name}</b><div className="faint mono" style={{ fontSize: 11 }}>{r.dir}</div></button>)}</div>}
          <div className="hint" style={{ marginTop: 18 }}>Um workspace é uma pasta com arquivos YAML: dá para pôr no git ou numa pasta de rede e partilhar com o time. Segredos ficam fora dela.</div>
        </div>
      </div>
    </div>
  );
}

async function openDir(dir) {
  const isWs = await call('ws:isWorkspace', { dir });
  let sum;
  if (!isWs) {
    const r = await api$.dialog.confirm({ message: 'Esta pasta ainda não é um workspace do Jaiminho.', detail: 'Criar um workspace nela?', buttons: ['Cancelar', 'Criar'] });
    if (r !== 1) return;
    const name = await prompt('Nome do workspace', dir.split(/[\\/]/).pop());
    if (!name) return;
    sum = await safe(() => call('ws:create', { dir, name }));
  } else sum = await safe(() => call('ws:open', { dir }));
  if (sum) { setState({ tabs: [], activeTab: null }); await applySummary(sum); if (sum.missingSecrets && sum.missingSecrets.length) toast(`Este workspace tem ${sum.missingSecrets.length} segredo(s) sem valor no seu PC (ex.: ${sum.missingSecrets[0].name} → ${sum.missingSecrets[0].key}). Preencha nos ambientes/coleções.`, 'info', 9000); if (sum.problems && sum.problems.length) toast(`${sum.problems.length} arquivo(s) com YAML inválido foram ignorados (ex.: ${sum.problems[0].file}: ${sum.problems[0].error}). Corrija o arquivo (conflito de git?) e reabra.`, 'error', 12000); }
}
export async function openWorkspace() { const dir = await api$.dialog.openDir({ title: 'Pasta do workspace' }); if (dir) openDir(dir); }
export async function newWorkspace() {
  const name = await prompt('Nome do novo workspace', 'Meu workspace', 'Depois você escolhe a pasta onde ele vai ficar (pode ser uma pasta de rede ou um repositório git).');
  if (!name) return false;
  const parent = await api$.dialog.openDir({ title: `Onde criar a pasta "${name}"?` });
  if (!parent) return false;
  if (await call('ws:isWorkspace', { dir: parent })) { await openDir(parent); return true; }
  const safeName = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 _.-]+/g, '').trim() || 'workspace';
  const dir = `${parent}${parent.includes('\\') ? '\\' : '/'}${safeName}`;
  const sum = await safe(() => call('ws:create', { dir, name }), 'Workspace criado');
  if (sum) { setState({ tabs: [], activeTab: null }); await applySummary(sum); return true; }
  return false;
}
async function importFromPostman() {
  const ok = await newWorkspace();
  if (ok) openModal('import', { initialMode: 'file' });
}

function TopBar({ showVars, setShowVars }) {
  const ws = useStore((s) => s.ws); const envs = useStore((s) => s.envs); const active = useStore((s) => s.activeEnvId);
  const [recent, setRecent] = useState([]);
  const theme = useStore((s) => s.theme);
  const env = envs.find((e) => e.id === active);
  return (
    <div className="topbar">
      <div className="brand"><img src="./logo.png" alt="" />Jaiminho</div>
      <select className="in" style={{ maxWidth: 260 }} value={ws?.dir || ''} onFocus={() => call('app:recent').then(setRecent)} onChange={(e) => { if (e.target.value === '__open') openWorkspace(); else if (e.target.value === '__new') newWorkspace(); else openDir(e.target.value); }} data-testid="ws-switch" title={ws?.dir}>
        <option value={ws?.dir}>{ws?.name}</option>
        {recent.filter((r) => r.dir !== ws?.dir).map((r) => <option key={r.dir} value={r.dir}>{r.name}</option>)}
        <option value="__open">Abrir outro workspace…</option>
        <option value="__new">Novo workspace…</option>
      </select>
      <button className="btn sm ghost" onClick={() => openModal('import')} title="Ctrl+I">Importar</button>
      <button className="btn sm ghost" title="Gera um arquivo .jaiminho com todo o workspace (sem segredos) para mandar aos amigos" onClick={async () => { const f = await api$.dialog.save({ defaultPath: `${ws.name}.jaiminho`, filters: [{ name: 'Jaiminho', extensions: ['jaiminho'] }] }); if (f) await safe(() => call('io:exportBundle', { scope: { type: 'workspace' }, file: f }), `Workspace exportado: ${f}`); }} data-testid="btn-export-ws">Exportar workspace…</button>
      <div className="spacer" />
      <span className="env-dot" style={{ background: env?.color || 'var(--farda)' }} />
      <select className="in" style={{ width: 220 }} value={active || ''} onChange={(e) => setActiveEnv(e.target.value)} data-testid="env-select">
        <option value="">Sem ambiente</option>
        {envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <button className={`icon-btn ${showVars ? 'on' : ''}`} onClick={() => setShowVars(!showVars)} title="Variáveis efetivas (Ctrl+E)" aria-label="Variáveis efetivas" data-testid="btn-vars"><Icon name="eye" /></button>
      <button className="btn sm ghost" onClick={() => openModal('mocks')} title="Servidores mock locais" aria-label="Servidores mock"><Icon name="server" /> Mocks</button>
      <button className="icon-btn" onClick={cycleTheme} title={`Tema: ${THEMES.find((t) => t.id === theme)?.nome} (clique para trocar)`} aria-label="Trocar tema" data-testid="btn-theme"><Icon name="palette" /></button>
      <button className="icon-btn" onClick={() => openHelp()} title="Tutoriais e ajuda (F1)" aria-label="Tutoriais e ajuda" data-testid="btn-help"><Icon name="help" /></button>
      <button className="icon-btn" onClick={() => openModal('settings')} title="Configurações (Ctrl+,)" aria-label="Configurações" data-testid="btn-settings"><Icon name="gear" /></button>
    </div>
  );
}

function TabsBar() {
  const tabs = useStore((s) => s.tabs); const active = useStore((s) => s.activeTab);
  const label = (t) => (t.type === 'globals' ? 'Globais' : t.title || t.draft?.name || 'sem nome');
  const method = (t) => (t.type !== 'request' ? null : t.draft.kind === 'grpc' ? 'gRPC' : t.draft.kind === 'soap' ? 'SOAP' : t.draft.method);
  return (
    <div className="tabs" data-testid="tabs" role="tablist">
      {tabs.map((t) => <div key={t.key} role="tab" aria-selected={active === t.key} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setState({ activeTab: t.key })} className={`tab ${active === t.key ? 'on' : ''}`} onClick={() => setState({ activeTab: t.key })}
        onContextMenu={(e) => showMenu(e, [
          { label: 'Fechar', run: () => closeTab(t.key) },
          { label: 'Fechar as outras', run: async () => { for (const x of getState().tabs.filter((y) => y.key !== t.key)) await closeTab(x.key); } },
          { label: 'Fechar as da direita', run: async () => { const all = getState().tabs; const i = all.findIndex((y) => y.key === t.key); for (const x of all.slice(i + 1)) await closeTab(x.key); } },
          ...(t.type === 'request' ? [{ label: 'Duplicar como rascunho', run: () => newDraftRequest(t.draft.kind, t.parentId, { ...t.draft, id: undefined, name: `${t.draft.name} (cópia)` }) }] : []),
        ])} onAuxClick={(e) => e.button === 1 && closeTab(t.key)} onDoubleClick={() => setState((s) => ({ tabs: s.tabs.map((x) => (x.key === t.key ? { ...x, preview: false } : x)) }))} title={label(t)} data-testid={`tab-${label(t)}`}>
        {method(t) ? <span className={`method m-${method(t)}`} style={{ width: 'auto' }}>{method(t)}</span> : <Icon name={t.type === 'environment' ? 'globe' : t.type === 'collection' ? 'collection' : t.type === 'folder' ? 'folder' : 'gear'} className={t.type === 'collection' ? 'ico-col' : t.type === 'folder' ? 'ico-folder' : ''} />}
        <span className="t-name" style={t.preview ? { fontStyle: 'italic' } : undefined}>{label(t)}</span>
        {isDirty(t) && <span className="dirty" title="Não salvo" />}
        {t.running && <span className="pulse" title="Enviando" />}
        <button className="icon-btn x" style={{ width: 24, height: 24 }} aria-label={`Fechar ${label(t)}`} onClick={(e) => { e.stopPropagation(); closeTab(t.key); }}><Icon name="x" size={13} /></button>
      </div>)}
      <button className="icon-btn" style={{ margin: '4px 6px' }} title="Nova request (Ctrl+N)" aria-label="Nova request" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setState({ ctx: { x: r.left, y: r.bottom, items: [{ label: 'HTTP / REST', run: () => newDraftRequest('http') }, { label: 'gRPC', run: () => newDraftRequest('grpc') }, { label: 'SOAP / XML', run: () => newDraftRequest('soap') }] } }); e.stopPropagation(); }} data-testid="btn-new-tab"><Icon name="plus" /></button>
    </div>
  );
}

function Work() {
  const tab = useStore((s) => s.tabs.find((t) => t.key === s.activeTab));
  if (!tab) return <div className="resp-empty"><div><img src="./logo.png" alt="" style={{ width: 96 }} /><div style={{ fontSize: 15, marginBottom: 6 }}>Nada aberto</div><div className="hint">Escolha uma request na esquerda, <b>Ctrl+N</b> para uma nova, ou cole um cURL em Importar.</div><div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn" onClick={() => newDraftRequest('http')} data-testid="empty-new-http">Nova request HTTP</button><button className="btn" onClick={() => newDraftRequest('grpc')} data-testid="empty-new-grpc">Nova request gRPC</button><button className="btn" onClick={() => newDraftRequest('soap')}>Nova request SOAP</button></div></div></div>;
  if (tab.type === 'request') return <RequestEditor key={tab.key} tab={tab} />;
  if (tab.type === 'collection' || tab.type === 'folder') return <CollectionEditor key={tab.key} tab={tab} />;
  if (tab.type === 'environment') return <EnvironmentEditor key={tab.key} tab={tab} />;
  if (tab.type === 'globals') return <GlobalsEditor key={tab.key} />;
  return null;
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div className="toasts" data-testid="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} onClick={() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))}>{t.text}</div>)}</div>;
}

function StatusBar() {
  const ws = useStore((s) => s.ws); const mocks = useStore((s) => s.mocks); const missing = useStore((s) => s.missingSecrets);
  const envs = useStore((s) => s.envs); const active = useStore((s) => s.activeEnvId); const env = envs.find((e) => e.id === active);
  return <div className="statusbar">
    <span title={ws?.dir}><span className="dot" style={{ background: env?.color || 'var(--farda)' }} />Ambiente: <b>{env ? env.name : 'nenhum'}</b></span>
    <span className="grow" />
    {missing.length > 0 && <span style={{ color: 'var(--dourado)' }} title={missing.map((m) => `${m.name}: ${m.key}`).join('\n')}>⚠ {missing.length} segredo(s) sem valor</span>}
    <span onClick={() => openModal('mocks')} style={{ cursor: 'pointer' }}><span className="dot" style={{ background: mocks.running ? 'var(--verde)' : 'var(--farda)' }} />mocks {mocks.running ? 'ligados' : 'desligados'}</span>
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', color: ws?.settings?.verifySsl === false ? 'var(--dourado)' : undefined }}><Icon name={ws?.settings?.verifySsl === false ? 'unlock' : 'lock'} size={12} />{ws?.settings?.verifySsl === false ? 'SSL sem verificação' : 'SSL verificado'}</span>
    <span>offline-first · sem telemetria</span>
  </div>;
}

export default function App() {
  const booted = useStore((s) => s.booted); const ws = useStore((s) => s.ws);
  const [showVars, setShowVars] = useState(false);
  const [sideW, setSideW] = useState(() => Number(localStorage.getItem('side-w')) || 290);
  useEffect(() => { boot().then(async () => { const a = await call('app:settings'); if (a.layout) setState({ layout: a.layout }); }); }, []);
  useEffect(() => api$.on(async (e) => {
    const s = getState();
    const active = s.tabs.find((t) => t.key === s.activeTab);
    switch (e.type) {
      case 'menu:new-request': if (s.ws) newDraftRequest('http'); break;
      case 'menu:open-workspace': openWorkspace(); break;
      case 'menu:new-workspace': newWorkspace(); break;
      case 'menu:import': if (s.ws) openModal('import'); break;
      case 'menu:export-workspace': if (s.ws) { const f = await api$.dialog.save({ defaultPath: `${s.ws.name}.jaiminho` }); if (f) await safe(() => call('io:exportBundle', { scope: { type: 'workspace' }, file: f }), `Exportado: ${f}`); } break;
      case 'menu:save': if (active) saveTab(active.key); break;
      case 'menu:settings': if (s.ws) openModal('settings'); break;
      case 'menu:mocks': case 'menu:example': openModal('mocks'); break;
      case 'menu:runner': { const sel = s.selected; if (sel) openModal('runner', { id: sel, name: 'seleção' }); else toast('Selecione uma coleção ou pasta na árvore', 'info'); break; }
      case 'menu:cookies': if (s.ws) openModal('cookies'); break;
      case 'menu:help': openHelp(); break;
      case 'menu:shortcuts': openModal('shortcuts'); break;
      case 'menu:about': openModal('about'); break;
      case 'app:before-close': {
        if (api$.closeAck) api$.closeAck();
        const dirty = s.tabs.filter(isDirty);
        if (!dirty.length) return api$.closeOk();
        const r = await api$.dialog.confirm({ message: `${dirty.length} aba(s) com alterações não salvas.`, detail: dirty.map((t) => t.draft?.name).join(', '), buttons: ['Cancelar', 'Sair sem salvar', 'Salvar tudo e sair'] });
        if (r === 1) api$.closeOk();
        if (r === 2) { for (const t of dirty) { const ok = await saveTab(t.key); if (!ok) return; } api$.closeOk(); }
        break;
      }
      default:
    }
  }), []);
  useEffect(() => {
    const onKey = (e) => {
      const s = getState(); const active = s.tabs.find((t) => t.key === s.activeTab);
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'Enter') { e.preventDefault(); if (active && active.type === 'request') sendTab(active.key); }
      else if (ctrl && e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (active && active.type === 'request') { const t = newDraftRequest(active.draft.kind, null, { ...active.draft, id: undefined, name: `${active.draft.name} (cópia)` }); saveTab(t.key); } }
      else if (ctrl && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (active) saveTab(active.key); }
      else if (ctrl && e.key === 'o') { e.preventDefault(); openWorkspace(); }
      else if (ctrl && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); if (active) closeTab(active.key); }
      else if (e.key === 'F1') { e.preventDefault(); openHelp(); }
      else if (ctrl && e.key === 'n') { e.preventDefault(); if (s.ws) newDraftRequest('http'); }
      else if (ctrl && e.key === 'l') { e.preventDefault(); window.dispatchEvent(new Event('jaiminho:focus-url')); }
      else if (ctrl && e.key === 'e') { e.preventDefault(); setShowVars((v) => !v); }
      else if (ctrl && e.key === 'i') { e.preventDefault(); if (s.ws) openModal('import'); }
      else if (ctrl && e.key === ',') { e.preventDefault(); if (s.ws) openModal('settings'); }
      else if (ctrl && e.key === 'Tab') { e.preventDefault(); const i = s.tabs.findIndex((t) => t.key === s.activeTab); const n = s.tabs[(i + (e.shiftKey ? -1 : 1) + s.tabs.length) % s.tabs.length]; if (n) setState({ activeTab: n.key }); }
      else if (e.key === 'Escape' && active && active.running && !s.modal) cancelTab(active.key);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  const dragSide = (e) => { e.preventDefault(); const move = (ev) => { const w = Math.min(560, Math.max(200, ev.clientX)); setSideW(w); try { localStorage.setItem('side-w', String(w)); } catch { /* ignore */ } }; const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); };
  if (!booted) return <div className="welcome"><img src="./logo.png" alt="" /></div>;
  if (!ws) return <><Welcome /><Modals /><Toasts /></>;
  return (
    <div className="app">
      <TopBar showVars={showVars} setShowVars={setShowVars} />
      <div className="main" style={{ '--sidebar-w': `${sideW}px`, position: 'relative' }}>
        <Sidebar />
        <div className="resizer" onMouseDown={dragSide} />
        <div className="work"><TabsBar /><Work /></div>
        {showVars && <VarsPanel onClose={() => setShowVars(false)} />}
      </div>
      <StatusBar />
      <Modals /><Toasts /><ContextMenu />
    </div>
  );
}
