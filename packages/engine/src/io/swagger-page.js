'use strict';
// Página do Swagger UI salva como HTML ("Salvar como…" no navegador). Não contém a especificação,
// só o que o navegador renderizou. Estratégia: (1) baixar a especificação original, se a rede deixar;
// (2) senão, reconstruir as requests (método + caminho) a partir da página.
const openapi = require('./openapi');

const decode = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function detect(text) {
  const t = String(text || '');
  return /<div id="swagger-ui"/i.test(t) && /opblock/i.test(t);
}

function parse(text) {
  const t = String(text || '');
  let origin = null;
  const sv = /saved from url=\(\d+\)(\S+?)\s*-->/i.exec(t);
  if (sv) { try { origin = new URL(sv[1]).origin; } catch { /* ignore */ } }
  const specPath = (/<span class="url">\s*([^<]+)</i.exec(t) || [])[1]?.trim() || null;
  const title = decode((/<h2 class="title">([\s\S]*?)<span/i.exec(t) || [])[1]) || 'Swagger';
  const ops = [];
  const re = /<span class="opblock-summary-method">(\w+)<\/span>[\s\S]*?data-path="([^"]+)"([\s\S]*?)<\/button>/gi;
  let m;
  while ((m = re.exec(t))) {
    const summary = decode((/opblock-summary-description">([\s\S]*?)<\/div>/i.exec(m[3]) || [])[1]);
    ops.push({ method: m[1].toUpperCase(), path: m[2], summary });
  }
  let specUrl = null;
  if (specPath) { try { specUrl = /^https?:/i.test(specPath) ? specPath : origin ? new URL(specPath, origin).href : null; } catch { /* ignore */ } }
  return { origin, specPath, specUrl, title, ops };
}

/** Prefixo do gateway: parte do caminho da especificação que antecede o caminho das operações. */
function guessBase(origin, specPath, firstOpPath) {
  if (!origin) return '';
  const sp = (specPath || '').replace(/\/+$/, '');
  if (sp && firstOpPath) {
    for (let i = 0; i <= sp.length; i++) { const suf = sp.slice(i); if (suf.startsWith('/') && firstOpPath.startsWith(suf)) return origin + sp.slice(0, i); }
  }
  return origin;
}

async function importSavedPage(ws, text, { fetchText, name } = {}) {
  const p = parse(text);
  if (!p.ops.length && !p.specUrl) throw new Error('Esta é uma página salva do Swagger UI sem operações visíveis. Importe pela URL da página ou da especificação (api-docs).');
  const warnings = [];
  if (p.specUrl && fetchText) {
    try { const r = await openapi.importOpenApi(ws, { url: p.specUrl, fetchText }, { name }); return { ...r, fromSavedPage: 'spec', sourceUrl: p.specUrl, warnings: r.warnings || [] }; }
    catch (e) { warnings.push(`Não consegui baixar a especificação em ${p.specUrl} (${String(e.message).split('\n')[0]}). Reconstruí as requests só a partir da página salva (método e caminho; sem body nem parâmetros).`); }
  } else warnings.push('Reconstruí as requests só a partir da página salva (método e caminho; sem body nem parâmetros). Para importar tudo, use a URL da especificação.');
  if (!p.ops.length) throw new Error(warnings.join(' '));
  const baseUrl = guessBase(p.origin, p.specPath, p.ops[0].path);
  if (p.origin) warnings.push(`baseUrl estimado em ${baseUrl}; confira o prefixo do gateway.`);
  const colId = ws.createCollection(name || p.title, { vars: [{ key: 'baseUrl', value: baseUrl }] });
  for (const o of p.ops) {
    const withBody = !(o.method === 'GET' || o.method === 'DELETE' || o.method === 'HEAD');
    const req = { name: o.summary || `${o.method} ${o.path}`, method: o.method, url: `{{baseUrl}}${o.path}` };
    if (withBody) { req.headers = [{ key: 'Content-Type', value: 'application/json', enabled: true }]; req.body = { mode: 'raw', language: 'json', raw: '{}' }; }
    ws.createRequest(colId, req);
  }
  return { collections: [p.title], requests: p.ops.length, fromSavedPage: 'dom', warnings };
}

module.exports = { detect, parse, importSavedPage, guessBase };
