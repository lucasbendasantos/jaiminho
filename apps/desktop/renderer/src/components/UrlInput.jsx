import React, { useRef } from 'react';
import { useEffectiveVars } from '../hooks';

const SCOPE_PT = { global: 'global', collection: 'coleção', environment: 'ambiente', 'folder/request': 'pasta/request', data: 'dados', local: 'local' };
export const scopePt = (s) => SCOPE_PT[s] || s;

/** Barra de URL com {{variáveis}} destacadas (dourado = definida, vermelho = não existe) e valores no tooltip. */
export function UrlInput({ tab, value, onChange, onPaste, onEnter, placeholder, inputRef }) {
  const vars = useEffectiveVars(tab);
  const hlRef = useRef(null);
  const known = new Map(vars.map((v) => [v.key, v]));
  const parts = String(value || '').split(/(\{\{[^{}]+\}\})/g);
  const used = [...new Set((String(value || '').match(/\{\{([^{}]+)\}\}/g) || []).map((m) => m.slice(2, -2)))];
  const title = used.length ? used.map((n) => (n.startsWith('$') ? `{{${n}}} → valor dinâmico` : known.has(n) ? `{{${n}}} = ${known.get(n).value} (${scopePt(known.get(n).scope)})` : `{{${n}}} → NÃO DEFINIDA`)).join('\n') : undefined;
  const missing = used.filter((n) => !n.startsWith('$') && !known.has(n));
  return (
    <div className="url-wrap" title={title}>
      <div className="url-hl" ref={hlRef} aria-hidden="true">
        {parts.map((p, i) => {
          const m = /^\{\{([^{}]+)\}\}$/.exec(p);
          if (!m) return <span key={i}>{p}</span>;
          const ok = m[1].startsWith('$') || known.has(m[1]);
          return <span key={i} className={ok ? 'v-ok' : 'v-bad'}>{p}</span>;
        })}
      </div>
      <input ref={inputRef} className="in url" value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder={placeholder} data-testid="req-url" spellCheck={false}
        aria-label="URL da request" aria-invalid={missing.length ? 'true' : undefined}
        onScroll={(e) => { if (hlRef.current) hlRef.current.scrollLeft = e.target.scrollLeft; }}
        onKeyUp={(e) => { if (hlRef.current) hlRef.current.scrollLeft = e.target.scrollLeft; }}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }} />
      {missing.length > 0 && <div className="hint" style={{ position: 'absolute', top: 36, left: 2, color: 'var(--erro)', fontSize: 11.5, zIndex: 2 }} data-testid="url-missing">Variável não definida: {missing.map((n) => `{{${n}}}`).join(', ')}</div>}
    </div>
  );
}

/** Headers que o Jaiminho coloca sozinho (o "hidden headers" do Postman). */
export function AutoHeaders({ draft, inherited }) {
  const has = (k) => (draft.headers || []).some((h) => h.enabled !== false && h.key && h.key.toLowerCase() === k);
  const rows = [];
  const b = draft.body || {};
  if (draft.kind === 'soap') {
    if (!has('content-type')) rows.push(['Content-Type', draft.soap?.version === '1.2' ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8', 'versão SOAP']);
    if (draft.soap?.version !== '1.2' && !has('soapaction')) rows.push(['SOAPAction', `"${draft.soap?.action || ''}"`, 'versão SOAP']);
  } else if (!has('content-type')) {
    if (b.mode === 'urlencoded') rows.push(['Content-Type', 'application/x-www-form-urlencoded', 'body']);
    if (b.mode === 'formdata') rows.push(['Content-Type', 'multipart/form-data; boundary=…', 'body']);
    if (b.mode === 'raw' && b.language === 'json') rows.push(['Content-Type', 'application/json', 'body']);
  }
  const auth = draft.auth && draft.auth.type !== 'inherit' ? { auth: draft.auth, label: 'auth da request' } : inherited ? { auth: inherited.auth, label: `auth herdada (${inherited.label})` } : null;
  if (auth && auth.auth.type !== 'none') {
    const t = auth.auth.type; const p = auth.auth[t] || {};
    if (t === 'apikey') { if ((p.in || 'header') === 'header') rows.push([p.key || '(nome)', '••••', auth.label]); else rows.push([`?${p.key || ''}= na URL`, '••••', auth.label]); }
    else rows.push(['Authorization', t === 'basic' ? 'Basic ••••' : t === 'bearer' ? 'Bearer ••••' : `(${t})`, auth.label]);
  }
  rows.push(['User-Agent', 'Jaiminho/0.1 (+carteiro)', 'padrão']);
  rows.push(['Accept-Encoding', 'gzip, deflate, br', 'padrão']);
  rows.push(['Cookie', '(do pote de cookies, se houver)', 'cookies']);
  if (b.mode && b.mode !== 'none') rows.push(['Content-Length', '(calculado no envio)', 'body']);
  return (
    <details className="auto-headers" data-testid="auto-headers">
      <summary>{rows.length} headers automáticos (o Jaiminho coloca sozinho; os seus ganham se tiverem o mesmo nome)</summary>
      <table className="kv"><tbody>{rows.map(([k, v, o]) => <tr key={k}><td>{k}</td><td>{v}</td><td>{o}</td></tr>)}</tbody></table>
    </details>
  );
}
