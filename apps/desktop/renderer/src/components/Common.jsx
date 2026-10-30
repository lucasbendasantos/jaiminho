import React, { useEffect, useRef, useState } from 'react';
import { call, updateDraft, saveTab, openModal, isDirty, useStore, setState } from '../store';
import Icon from '../icons';

export function Splitter({ storageKey, children, horizontal }) {
  const ref = useRef(null);
  const [size, setSize] = useState(() => Number(localStorage.getItem(storageKey)) || 46);
  const drag = (e) => {
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    const move = (ev) => { const pct = horizontal ? ((ev.clientX - rect.left) / rect.width) * 100 : ((ev.clientY - rect.top) / rect.height) * 100; const v = Math.min(80, Math.max(15, pct)); setSize(v); try { localStorage.setItem(storageKey, String(v)); } catch { /* ignore */ } };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  return <div ref={ref} className={`split ${horizontal ? 'horizontal' : ''}`} style={horizontal ? { '--req-w': `${size}%` } : { '--req-h': `${size}%` }}>{children[0]}<div className="hsplit" onMouseDown={drag} />{children[1]}</div>;
}

export function setLayout(next) { setState({ layout: next }); call('app:saveSettings', { layout: next }).catch(() => {}); }

export function NameBar({ tab, kindLabel }) {
  const layout = useStore((s) => s.layout);
  const [chain, setChain] = useState([]);
  useEffect(() => { if (tab.itemId) call('item:chain', { id: tab.itemId }).then(setChain).catch(() => {}); }, [tab.itemId]);
  const d = tab.draft;
  return (
    <div className="reqname">
      <span className="crumbs">{chain.slice(0, -1).map((c) => c.name).join(' / ') || (tab.itemId ? '' : 'não salva')}{chain.length > 1 ? ' /' : ''}</span>
      <input value={d.name || ''} onChange={(e) => updateDraft(tab.key, { name: e.target.value })} data-testid="req-name" />
      {kindLabel && <span className="kind-tag">{kindLabel}</span>}
      <span className="grow" />
      <button className="icon-btn" onClick={() => setLayout(layout === 'horizontal' ? 'vertical' : 'horizontal')} title={layout === 'horizontal' ? 'Resposta embaixo da request' : 'Resposta ao lado da request'} aria-label="Alternar layout request/resposta" data-testid="btn-layout"><Icon name={layout === 'horizontal' ? 'rows' : 'columns'} /></button>
      <button className="btn sm ghost" onClick={() => openModal('code', { tabKey: tab.key })} data-testid="btn-code" title="cURL, grpcurl e código">{'</>'} Código</button>
      <button className="btn sm" onClick={() => saveTab(tab.key)} disabled={!isDirty(tab)} data-testid="btn-save" title="Ctrl+S">Salvar</button>
    </div>
  );
}

