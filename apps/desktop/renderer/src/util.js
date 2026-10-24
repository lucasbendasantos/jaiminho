// utilidades da UI
export function parseUrlParams(url) {
  const q = url.indexOf('?');
  if (q < 0) return { base: url, params: null };
  const params = url.slice(q + 1).split('&').filter((x) => x !== '').map((p) => { const i = p.indexOf('='); return { key: decodeSafe(i >= 0 ? p.slice(0, i) : p), value: decodeSafe(i >= 0 ? p.slice(i + 1) : ''), enabled: true }; });
  return { base: url.slice(0, q), params };
}
function decodeSafe(s) { try { return /\{\{/.test(s) ? s : decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } }
export function buildUrl(base, params) {
  const on = (params || []).filter((p) => p.enabled !== false && p.key);
  return on.length ? `${base}?${on.map((p) => `${p.key}${p.value !== '' ? `=${p.value}` : '='}`).join('&')}` : base;
}
export function pathVarNames(url) { return [...String(url || '').replace(/\?.*$/, '').matchAll(/\/:([A-Za-z0-9_]+)/g)].map((m) => m[1]); }
export function syncPathVars(url, current = []) {
  const names = pathVarNames(url);
  return names.map((n) => current.find((c) => c.key === n) || { key: n, value: '' });
}
export function prettyBytes(n) { if (n == null) return ''; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(2)} MB`; }
export function prettyMs(n) { if (n == null) return ''; return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`; }
export function statusClass(code) { if (!code) return 'serr'; return `s${String(code)[0]}`; }
export function tryPrettyJson(text) { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } }
export function langFromContentType(ct = '') {
  if (/json/i.test(ct)) return 'json'; if (/xml|soap/i.test(ct)) return 'xml'; if (/html/i.test(ct)) return 'html'; if (/javascript/i.test(ct)) return 'javascript'; if (/yaml/i.test(ct)) return 'yaml'; return 'text';
}
/** Filtro simples de JSON: $.a.b[0].c ou a.b */
export function jsonPath(obj, expr) {
  const path = expr.replace(/^\$\.?/, '').match(/[^.[\]]+|\[\d+\]/g) || [];
  let cur = obj;
  for (const p of path) { if (cur == null) return undefined; const m = /^\[(\d+)\]$/.exec(p); cur = m ? cur[Number(m[1])] : (p === '*' && Array.isArray(cur) ? cur : cur[p]); }
  return cur;
}
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const uid = () => Math.random().toString(36).slice(2, 10);
