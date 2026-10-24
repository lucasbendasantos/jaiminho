import React from 'react';

/** Tabela chave/valor no estilo do Postman: linha vazia no fim, checkbox para ligar/desligar. */
export default function KVTable({ rows = [], onChange, keyPh = 'Chave', valPh = 'Valor', extraCols = [], testId, noToggle, readOnlyKeys }) {
  const list = [...rows, { key: '', value: '', __new: true }];
  const set = (i, patch) => {
    const next = rows.slice();
    if (i >= rows.length) next.push({ key: '', value: '', enabled: true, ...patch });
    else next[i] = { ...next[i], ...patch };
    onChange(next.filter((r, idx) => idx < rows.length || r.key || r.value));
  };
  const del = (i) => onChange(rows.filter((_, idx) => idx !== i));
  return (
    <table className="kv" data-testid={testId}>
      <thead><tr>{!noToggle && <th />}<th>{keyPh}</th><th>{valPh}</th>{extraCols.map((c) => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
      <tbody>
        {list.map((r, i) => (
          <tr key={i} className={r.enabled === false ? 'off' : ''}>
            {!noToggle && <td className="c">{!r.__new && <input type="checkbox" checked={r.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked })} title="Ligar/desligar" />}</td>}
            <td><input className="cell" value={r.key || ''} placeholder={r.__new ? keyPh : ''} readOnly={readOnlyKeys && !r.__new} onChange={(e) => set(i, { key: e.target.value })} /></td>
            <td><input className="cell" value={r.value ?? ''} placeholder={r.__new ? valPh : ''} onChange={(e) => set(i, { value: e.target.value })} /></td>
            {extraCols.map((c) => <td key={c.key} style={{ width: c.width }}>{!r.__new && c.render(r, (patch) => set(i, patch))}</td>)}
            <td className="a">{!r.__new && <button className="icon-btn" title="Remover" onClick={() => del(i)}>✕</button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
