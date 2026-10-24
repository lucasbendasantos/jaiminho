import React, { useEffect, useMemo, useState } from 'react';
import { useStore, setState, call, openItem, newDraftRequest, refreshTree, openModal, safe, toast, closeTab, getState, openSpecial, api$ } from '../store';
import { prompt } from './Modals';
import Icon from '../icons';

export function ContextMenu() {
  const m = useStore((s) => s.ctx);
  useEffect(() => { const f = () => setState({ ctx: null }); window.addEventListener('click', f); window.addEventListener('blur', f); return () => { window.removeEventListener('click', f); window.removeEventListener('blur', f); }; }, []);
  if (!m) return null;
  const x = Math.min(m.x, window.innerWidth - 230); const y = Math.min(m.y, window.innerHeight - m.items.length * 32 - 20);
  const onKey = (e) => {
    const btns = [...e.currentTarget.querySelectorAll('button')]; const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { setState({ ctx: null }); e.preventDefault(); }
    if (e.key === 'ArrowDown') { (btns[i + 1] || btns[0]).focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { (btns[i - 1] || btns[btns.length - 1]).focus(); e.preventDefault(); }
  };
  return <div className="ctx" role="menu" style={{ left: x, top: y }} data-testid="ctx-menu" onKeyDown={onKey} ref={(el) => { if (el && !el.contains(document.activeElement)) { const b = el.querySelector('button'); if (b) b.focus(); } }}>{m.items.map((it, i) => (it === '-' ? <hr key={i} /> : <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} onClick={(e) => { e.stopPropagation(); setState({ ctx: null }); it.run(); }} data-testid={`ctx-${it.id || i}`}>{it.label}</button>))}</div>;
}
export function showMenu(e, items) { e.preventDefault(); e.stopPropagation(); setState({ ctx: { x: e.clientX, y: e.clientY, items } }); }

export async function renameItem(node, name) {
  if (!name || name === node.name) return;
  const d = await call('item:get', { id: node.id });
  await safe(() => call('item:save', { id: node.id, data: { ...d, name } }));
  await refreshTree();
  setState((s) => ({ tabs: s.tabs.map((x) => (x.itemId === node.id ? { ...x, draft: { ...x.draft, name }, saved: x.saved ? JSON.stringify({ ...JSON.parse(x.saved), name }) : x.saved } : x)) }));
}

async function removeItem(node) {
  const r = await api$.dialog.confirm({ message: `Apagar "${node.name}"?`, detail: node.type === 'request' ? 'A request vai para a lixeira do workspace (.jaiminho/lixeira).' : 'A pasta/coleção e tudo dentro dela vão para a lixeira do workspace (.jaiminho/lixeira).', buttons: ['Cancelar', 'Apagar'] });
  if (r !== 1) return;
  await safe(() => call('item:remove', { id: node.id }));
  for (const t of getState().tabs.filter((tt) => tt.itemId === node.id)) await closeTab(t.key, true);
  await refreshTree();
}

function nodeMenu(node) {
  const container = node.type !== 'request';
  const items = [];
  if (container) {
    items.push({ id: 'new-http', label: '＋ Nova request HTTP', run: () => newDraftRequest('http', node.id) });
    items.push({ id: 'new-grpc', label: '＋ Nova request gRPC', run: () => newDraftRequest('grpc', node.id) });
    items.push({ id: 'new-soap', label: '＋ Nova request SOAP', run: () => newDraftRequest('soap', node.id) });
    items.push({ id: 'new-folder', label: '＋ Nova pasta', run: async () => { const name = await prompt('Nome da pasta', 'Nova pasta'); if (name) { await safe(() => call('item:createFolder', { parentId: node.id, name })); await refreshTree(); } } });
    items.push({ id: 'paste-curl', label: '＋ Colar cURL aqui', run: async () => { const text = await api$.clipboard.read(); const r = await safe(() => call('io:import', { text, parentId: node.id })); if (r) { await refreshTree(); if (r.requestId) openItem(r.requestId, 'request'); toast('Request criada a partir do cURL', 'ok'); } } });
    items.push('-');
    items.push({ id: 'run', label: '▶ Rodar (Runner)', run: () => openModal('runner', { id: node.id, name: node.name }) });
    items.push({ id: 'settings', label: 'Editar (auth, scripts, variáveis)', run: () => openItem(node.id, node.type) });
  }
  if (node.type === 'collection') {
    items.push({ id: 'export-postman', label: 'Exportar para Postman (v2.1)…', run: async () => { const f = await api$.dialog.save({ defaultPath: `${node.name}.postman_collection.json`, filters: [{ name: 'Postman', extensions: ['json'] }] }); if (f) await safe(() => call('io:exportPostman', { id: node.id, file: f }), `Exportado: ${f}`); } });
    items.push({ id: 'export-bundle', label: 'Exportar .jaiminho (para os amigos)…', run: async () => { const f = await api$.dialog.save({ defaultPath: `${node.name}.jaiminho`, filters: [{ name: 'Jaiminho', extensions: ['jaiminho'] }] }); if (f) await safe(() => call('io:exportBundle', { scope: { type: 'collection', id: node.id }, file: f }), `Exportado: ${f}`); } });
    if (node.originType === 'openapi') items.push({ id: 'sync', label: 'Sincronizar com o Swagger…', run: () => openModal('sync', { id: node.id, name: node.name }) });
  }
  if (node.type === 'request') {
    items.push({ id: 'open', label: 'Abrir', run: () => openItem(node.id, 'request') });
    items.push({ id: 'copy-curl', label: node.kind === 'grpc' ? 'Copiar como grpcurl' : 'Copiar como cURL', run: async () => { const req = await call('item:get', { id: node.id }); const c = await safe(() => call('io:curl', { request: req, requestId: node.id, environmentId: getState().activeEnvId, flavor: 'bash' })); if (c) { await api$.clipboard.write(c); toast('Copiado', 'ok', 1500); } } });
  }
  items.push('-');
  items.push({ id: 'rename', label: 'Renomear (F2)', run: () => setState({ renaming: node.id }) });
  items.push({ id: 'duplicate', label: 'Duplicar', run: async () => { await safe(() => call('item:duplicate', { id: node.id })); await refreshTree(); } });
  items.push({ id: 'delete', label: 'Apagar (Del)', danger: true, run: () => removeItem(node) });
  return items;
}

/** Quantos nós a árvore tem (para decidir se abre tudo ou só o 1º nível). */
function countNodes(n) { return 1 + (n.children || []).reduce((a, c) => a + countNodes(c), 0); }
const BIG_TREE = 400;

const TreeNode = React.memo(function TreeNode({ node, depth, filter, parentId, index, big }) {
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(`open:${node.id}`); if (v !== null) return v !== '0'; } catch { /* ignore */ }
    return !big || depth === 0; // árvore grande: só a coleção abre sozinha (mil linhas no DOM travam a tela)
  });
  const selected = useStore((s) => s.selected === node.id);
  const renaming = useStore((s) => s.renaming === node.id);
  const [drop, setDrop] = useState(false);
  const isContainer = node.type !== 'request';
  const toggle = () => { setOpen(!open); try { localStorage.setItem(`open:${node.id}`, open ? '0' : '1'); } catch { /* ignore */ } };
  const match = (n) => !filter || n.name.toLowerCase().includes(filter) || (n.children || []).some(match);
  if (!match(node)) return null;
  const onDrop = async (e) => {
    e.preventDefault(); e.stopPropagation(); setDrop(false);
    const id = e.dataTransfer.getData('jaiminho/id'); if (!id || id === node.id) return;
    if (isContainer) await safe(() => call('item:move', { id, parentId: node.id }));
    else await safe(() => call('item:move', { id, parentId, index }));
    await refreshTree();
  };
  return (
    <div>
      <div className={`tree-row ${selected ? 'sel' : ''} ${drop ? 'drop' : ''} ${node.deprecated ? 'deprecated' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}
        draggable={node.type !== 'collection'} onDragStart={(e) => e.dataTransfer.setData('jaiminho/id', node.id)}
        onDragOver={(e) => { e.preventDefault(); setDrop(true); }} onDragLeave={() => setDrop(false)} onDrop={onDrop}
        onClick={() => { if (isContainer) toggle(); else openItem(node.id, 'request'); setState({ selected: node.id }); }}
        onDoubleClick={() => isContainer && openItem(node.id, node.type)}
        onContextMenu={(e) => showMenu(e, nodeMenu(node))} data-testid={`node-${node.name}`} title={node.name}
        role="treeitem" aria-expanded={isContainer ? open : undefined} aria-selected={selected} tabIndex={0} data-node-id={node.id}
        onKeyDown={(e) => {
          if (renaming) return;
          if (e.key === 'Enter') { if (isContainer) openItem(node.id, node.type); else openItem(node.id, 'request'); e.preventDefault(); }
          else if (e.key === 'F2') { setState({ renaming: node.id }); e.preventDefault(); }
          else if (e.key === 'Delete') { removeItem(node); e.preventDefault(); }
          else if (e.key === 'ArrowRight' && isContainer && !open) { toggle(); e.preventDefault(); }
          else if (e.key === 'ArrowLeft' && isContainer && open) { toggle(); e.preventDefault(); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const rows = [...document.querySelectorAll('[role=treeitem]')]; const i = rows.indexOf(e.currentTarget); const n = rows[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { n.focus(); setState({ selected: n.dataset.nodeId }); } e.preventDefault(); }
          else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const r = e.currentTarget.getBoundingClientRect(); showMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left + 40, clientY: r.bottom }, nodeMenu(node)); e.preventDefault(); }
        }}>
        <span className="caret">{isContainer ? <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /> : ''}</span>
        {node.type === 'request' ? <span className={`method m-${node.method}`}>{node.method === 'DELETE' ? 'DEL' : node.method === 'OPTIONS' ? 'OPT' : node.method}</span> : <Icon name={node.type === 'collection' ? 'collection' : 'folder'} className={node.type === 'collection' ? 'ico-col' : 'ico-folder'} />}
        {renaming ? <input className="rename" autoFocus defaultValue={node.name} onClick={(e) => e.stopPropagation()} data-testid="rename-input"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { const v = e.target.value.trim(); setState({ renaming: null }); renameItem(node, v); } if (e.key === 'Escape') setState({ renaming: null }); }}
          onBlur={(e) => { const v = e.target.value.trim(); setState({ renaming: null }); renameItem(node, v); }} /> : <span className="name">{node.name}</span>}
        <button className="icon-btn more" onClick={(e) => showMenu(e, nodeMenu(node))} title="Mais ações" aria-label={`Mais ações para ${node.name}`} tabIndex={-1}><Icon name="more" /></button>
      </div>
      {isContainer && (open || filter) && (node.children || []).map((c, i) => <TreeNode key={c.id} node={c} depth={depth + 1} filter={filter} parentId={node.id} index={i} big={big} />)}
      {isContainer && open && !filter && !(node.children || []).length && <div className="row" style={{ padding: '3px 0 3px ' + (30 + depth * 14) + 'px', fontSize: 12 }}><span className="faint">Nenhuma carta por aqui.</span><button className="btn sm ghost" onClick={() => newDraftRequest('http', node.id)}>＋ Request</button><button className="btn sm ghost" onClick={async () => { const text = await api$.clipboard.read(); const r = await safe(() => call('io:import', { text, parentId: node.id })); if (r) { await refreshTree(); if (r.requestId) openItem(r.requestId, 'request'); } }}>Colar cURL</button></div>}
    </div>
  );
});

function Collections() {
  const tree = useStore((s) => s.tree);
  const [filter, setFilter] = useState('');
  const deferredFilter = React.useDeferredValue(filter); // digitar nunca espera a árvore redesenhar
  const big = useMemo(() => (tree?.collections || []).reduce((a, c) => a + countNodes(c), 0) > BIG_TREE, [tree]);
  const newCollection = async () => { const id = await safe(() => call('item:createCollection', { name: 'Nova coleção' })); await refreshTree(); if (id) setState({ selected: id, renaming: id }); };
  return (
    <>
      <div className="side-tools">
        <button className="btn sm" onClick={newCollection} data-testid="btn-new-collection" title="Nova coleção">＋ Coleção</button>
        <button className="btn sm" onClick={() => openModal('import')} data-testid="btn-import">Importar</button>
        <input className="in grow" style={{ height: 24 }} placeholder="Filtrar" value={filter} onChange={(e) => setFilter(e.target.value.toLowerCase())} data-testid="tree-filter" />
      </div>
      <div className="side-body" data-testid="tree" role="tree" aria-label="Coleções">
        {(tree?.collections || []).map((c) => <TreeNode key={c.id} node={c} depth={0} filter={deferredFilter} parentId={null} big={big} />)}
        {!(tree?.collections || []).length && <div className="empty">Sem coleções.<br /><br /><button className="btn sm" onClick={newCollection}>Criar coleção</button> <button className="btn sm" onClick={() => openModal('import')}>Importar</button><div className="hint" style={{ marginTop: 10 }}>Swagger, Postman, cURL, WSDL ou .jaiminho</div></div>}
      </div>
    </>
  );
}

function Environments() {
  const envs = useStore((s) => s.envs); const active = useStore((s) => s.activeEnvId);
  const create = async () => { const name = await prompt('Nome do ambiente', 'DEV'); if (name) { const id = await safe(() => call('env:save', { name, vars: [] })); await refreshTree(); if (id) openItem(id, 'environment'); } };
  return (
    <>
      <div className="side-tools"><button className="btn sm" onClick={create} data-testid="btn-new-env">＋ Ambiente</button><button className="btn sm" onClick={() => openSpecial('globals', 'Globais')}>Globais</button></div>
      <div className="side-body">
        {envs.map((e) => <div key={e.id} className="tree-row" onClick={() => openItem(e.id, 'environment')} data-testid={`env-${e.name}`}
          onContextMenu={(ev) => showMenu(ev, [
            { label: 'Ativar', run: async () => { const { setActiveEnv } = await import('../store'); setActiveEnv(e.id); } },
            { label: 'Duplicar', run: async () => { await call('env:duplicate', { id: e.id }); await refreshTree(); } },
            { label: 'Exportar (Postman)…', run: async () => { const f = await api$.dialog.save({ defaultPath: `${e.name}.postman_environment.json` }); if (f) await safe(() => call('io:exportEnvironment', { id: e.id, file: f }), `Exportado: ${f}`); } },
            { label: 'Exportar .jaiminho…', run: async () => { const f = await api$.dialog.save({ defaultPath: `${e.name}.jaiminho` }); if (f) await safe(() => call('io:exportBundle', { scope: { type: 'environment', id: e.id }, file: f }), `Exportado: ${f}`); } },
            '-', { label: 'Apagar', danger: true, run: async () => { if ((await api$.dialog.confirm({ message: `Apagar o ambiente "${e.name}"?`, buttons: ['Cancelar', 'Apagar'] })) === 1) { await call('env:remove', { id: e.id }); await refreshTree(); } } },
          ])}>
          <span className="env-dot" style={{ background: e.color || 'var(--farda)' }} />
          <span className="name">{e.name}</span>{active === e.id && <span className="scope-tag">ativo</span>}
        </div>)}
        {!envs.length && <div className="empty">Nenhum ambiente.<div className="hint">Ambientes guardam variáveis como baseUrl e token (DEV, QUA, PRD).</div></div>}
      </div>
    </>
  );
}

function History() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const load = () => call('history:list').then(setItems).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);
  const day = (iso) => { const d = new Date(iso); const today = new Date(); const y = new Date(Date.now() - 864e5); if (d.toDateString() === today.toDateString()) return 'Hoje'; if (d.toDateString() === y.toDateString()) return 'Ontem'; return d.toLocaleDateString(); };
  const filtered = items.filter((h) => !q || `${h.name} ${h.url} ${h.method}`.toLowerCase().includes(q.toLowerCase()));
  let last = null;
  return (
    <>
      <div className="side-tools"><input className="in grow" style={{ height: 24 }} placeholder="Filtrar histórico" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn sm" onClick={async () => { if ((await api$.dialog.confirm({ message: 'Limpar todo o histórico deste workspace?', buttons: ['Cancelar', 'Limpar'] })) === 1) { await call('history:clear'); load(); } }}>Limpar</button></div>
      <div className="side-body">
        {filtered.map((h) => {
          const dd = day(h.at); const header = dd !== last ? <div className="hist-day">{dd}</div> : null; last = dd;
          return <React.Fragment key={h.id}>{header}<div className="tree-row" tabIndex={0} title={`${h.url}\nClique para abrir como rascunho`} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()} onClick={() => { if (h.request) newDraftRequest(h.request.kind || 'http', null, { ...h.request, id: undefined, name: h.name || 'Do histórico' }); }}
            onContextMenu={(e) => showMenu(e, [{ label: 'Abrir como rascunho', run: () => h.request && newDraftRequest(h.request.kind || 'http', null, { ...h.request, id: undefined, name: h.name }) }, { label: 'Abrir a request salva', run: () => h.requestId && openItem(h.requestId, 'request') }])}>
            <span className={`method m-${h.kind === 'grpc' ? 'gRPC' : h.kind === 'soap' ? 'SOAP' : h.method}`}>{h.kind === 'grpc' ? 'gRPC' : h.kind === 'soap' ? 'SOAP' : h.method}</span>
            <span className="name">{h.name}<span className="faint"> · {h.url}</span></span>
            <span className="faint" style={{ fontSize: 11 }}>{new Date(h.at).toLocaleTimeString().slice(0, 5)}</span>
            <span className={h.ok ? 'badge-ok' : 'badge-fail'} style={{ fontSize: 11 }}>{h.code || '✕'}</span>
          </div></React.Fragment>;
        })}
        {!filtered.length && <div className="empty">Caixa de saída vazia.</div>}
      </div>
    </>
  );
}

export default function Sidebar() {
  const tab = useStore((s) => s.sidebar);
  return (
    <div className="sidebar" data-testid="sidebar">
      <div className="side-tabs" role="tablist">
        {[['collections', 'Coleções'], ['envs', 'Ambientes'], ['history', 'Histórico']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setState({ sidebar: k })} data-testid={`side-${k}`}>{l}</button>)}
      </div>
      {tab === 'collections' && <Collections />}
      {tab === 'envs' && <Environments />}
      {tab === 'history' && <History />}
    </div>
  );
}
