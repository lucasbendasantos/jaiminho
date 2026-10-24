'use strict';
// Bundle .jaiminho: zip com manifesto + hashes. Nunca leva .jaiminho/ (segredos, valores locais, histórico).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const YAML = require('yaml');
const { uuidv7 } = require('../util');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function listFiles(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir)) {
    if (e === '.jaiminho' || e === '.git' || e === 'node_modules') continue;
    const full = path.join(dir, e);
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full, base)); else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Exporta. scope: { type: 'workspace' } | { type: 'collection', id } | { type: 'environment', id }
 * Devolve Buffer do zip.
 */
async function exportBundle(ws, scope = { type: 'workspace' }, { createdBy } = {}) {
  const zip = new JSZip();
  let files = [];
  if (scope.type === 'workspace') files = listFiles(ws.dir);
  else if (scope.type === 'collection') {
    const n = ws.info(scope.id); files = listFiles(n.dir).map((f) => path.relative(ws.dir, path.join(n.dir, f)).split(path.sep).join('/'));
    files.push('jaiminho.yaml');
    // protos/wsdl referenciados
    for (const d of ['protos', 'wsdl']) files.push(...listFiles(path.join(ws.dir, d)).map((f) => `${d}/${f}`));
  } else if (scope.type === 'environment') {
    const n = ws.info(scope.id); files = [path.relative(ws.dir, n.file).split(path.sep).join('/')];
  }
  const contents = [];
  for (const f of [...new Set(files)]) {
    const buf = fs.readFileSync(path.join(ws.dir, f));
    zip.file(f, buf); contents.push({ path: f, sha256: sha(buf), size: buf.length });
  }
  const manifest = { format: 'jaiminho-bundle', version: 1, id: uuidv7(), workspace: { id: ws.manifest.id, name: ws.name }, scope, createdBy: createdBy || process.env.USERNAME || process.env.USER || 'desconhecido', createdAt: new Date().toISOString(), contents };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Lê o bundle e mostra o que vai entrar (sem gravar). */
/** Caminho de entrada de zip que poderia escapar do workspace (zip slip), em Linux OU Windows. */
function unsafePath(p) {
  const s = String(p);
  return s.includes('\\') || s.includes('\0') || /^[a-zA-Z]:/.test(s) || s.startsWith('/') || s.split('/').some((seg) => seg === '..' || /[:*?"<>|]/.test(seg));
}

async function previewBundle(buf) {
  const zip = await JSZip.loadAsync(buf);
  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('Arquivo não é um bundle do Jaiminho (falta manifest.json)');
  const manifest = JSON.parse(await mf.async('string'));
  const problems = [];
  for (const c of manifest.contents) {
    const f = zip.file(c.path);
    if (!f) { problems.push(`faltando: ${c.path}`); continue; }
    const b = await f.async('nodebuffer'); if (sha(b) !== c.sha256) problems.push(`hash não confere: ${c.path}`);
    if (c.path.startsWith('.jaiminho/')) problems.push(`conteúdo local não permitido: ${c.path}`);
    if (unsafePath(c.path)) problems.push(`caminho inseguro (sai do workspace): ${c.path}`);
  }
  for (const name of Object.keys(zip.files)) if (unsafePath(name)) problems.push(`caminho inseguro no zip: ${name}`);
  const collections = []; const environments = [];
  for (const c of manifest.contents) {
    if (/^collections\/[^/]+\/_collection\.yaml$/.test(c.path)) collections.push(YAML.parse(await zip.file(c.path).async('string')));
    if (/^environments\/.+\.env\.yaml$/.test(c.path)) environments.push(YAML.parse(await zip.file(c.path).async('string')));
  }
  return { manifest, problems, collections: collections.map((c) => ({ id: c.id, name: c.name })), environments: environments.map((e) => ({ id: e.id, name: e.name })) };
}

/**
 * Importa. strategy: 'keep-both' (padrão: ids que já existem ganham cópia) | 'overwrite' | 'skip'
 */
async function importBundle(ws, buf, { strategy = 'keep-both' } = {}) {
  const pv = await previewBundle(buf);
  if (pv.problems.length) throw new Error(`Bundle corrompido: ${pv.problems.join('; ')}`);
  const zip = await JSZip.loadAsync(buf);
  const result = { collections: [], environments: [], files: 0, skipped: [] };
  const existingCols = new Map([...ws.index].filter(([, n]) => n.type === 'collection').map(([id, n]) => [id, n]));
  const existingEnvs = new Map([...ws.index].filter(([, n]) => n.type === 'environment').map(([id, n]) => [id, n]));
  const colDirMap = new Map(); // dir no bundle → dir destino
  for (const c of pv.manifest.contents) {
    const m = /^collections\/([^/]+)\/_collection\.yaml$/.exec(c.path);
    if (!m) continue;
    const meta = YAML.parse(await zip.file(c.path).async('string'));
    let targetDir = m[1];
    if (existingCols.has(meta.id)) {
      if (strategy === 'skip') { result.skipped.push(meta.name); colDirMap.set(m[1], null); continue; }
      if (strategy === 'overwrite') { const n = existingCols.get(meta.id); fs.rmSync(n.dir, { recursive: true, force: true }); targetDir = path.basename(n.dir); }
      else { targetDir = `${m[1]}-importada-${Date.now() % 100000}`; }
    } else if (fs.existsSync(path.join(ws.dir, 'collections', targetDir))) targetDir = `${m[1]}-${Date.now() % 100000}`;
    colDirMap.set(m[1], targetDir);
    result.collections.push(meta.name);
  }
  for (const c of pv.manifest.contents) {
    if (c.path === 'jaiminho.yaml' || c.path === '.gitignore') continue;
    let dest = c.path;
    const m = /^collections\/([^/]+)\//.exec(c.path);
    if (m) { const t = colDirMap.get(m[1]); if (t === null) continue; dest = c.path.replace(`collections/${m[1]}/`, `collections/${t}/`); }
    const e = /^environments\/(.+)\.env\.yaml$/.exec(c.path);
    if (e) {
      const env = YAML.parse(await zip.file(c.path).async('string'));
      if (existingEnvs.has(env.id)) {
        if (strategy === 'skip') { result.skipped.push(env.name); continue; }
        if (strategy === 'overwrite') dest = path.relative(ws.dir, existingEnvs.get(env.id).file).split(path.sep).join('/');
        else { env.id = uuidv7(); env.name = `${env.name} (importado)`; fs.mkdirSync(path.join(ws.dir, 'environments'), { recursive: true }); fs.writeFileSync(path.join(ws.dir, 'environments', `${e[1]}-importado-${Date.now() % 100000}.env.yaml`), YAML.stringify(env)); result.environments.push(env.name); continue; }
      } else if (fs.existsSync(path.join(ws.dir, dest))) dest = `environments/${e[1]}-${Date.now() % 100000}.env.yaml`;
      result.environments.push(env.name);
    }
    if ((c.path.startsWith('protos/') || c.path.startsWith('wsdl/') || c.path.startsWith('data/')) && fs.existsSync(path.join(ws.dir, dest))) continue;
    const full = path.join(ws.dir, dest);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, await zip.file(c.path).async('nodebuffer'));
    result.files++;
  }
  // coleções duplicadas ("keep-both") precisam de ids novos
  if (strategy === 'keep-both') {
    for (const [src, t] of colDirMap) {
      if (!t || t === src) continue;
      const dir = path.join(ws.dir, 'collections', t);
      const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(req|)yaml$/.test(f) || f.endsWith('.yaml')) { const y = YAML.parse(fs.readFileSync(p, 'utf8')) || {}; if (y.id) { y.id = uuidv7(); if (f === '_collection.yaml') y.name = `${y.name} (importada)`; fs.writeFileSync(p, YAML.stringify(y)); } } } };
      walk(dir);
    }
  }
  ws.reload();
  return result;
}

module.exports = { exportBundle, importBundle, previewBundle };
