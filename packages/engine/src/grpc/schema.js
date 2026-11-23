'use strict';
// Fontes de schema gRPC: reflection, arquivos .proto (com import paths) e protoset (FileDescriptorSet).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const protobuf = require('protobufjs');
const descriptor = require('protobufjs/ext/descriptor');
const { reflect } = require('./reflection');

const PROTOBUFJS_DIR = path.dirname(require.resolve('protobufjs/package.json'));

/** Remove ';' repetido (instrução vazia), fora de strings e comentários. */
function stripEmptyStatements(src) {
  let out = ''; let i = 0; const n = src.length; let lastSig = '';
  while (i < n) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; out += src.slice(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += src.slice(i, end); i = end; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; } out += src.slice(i, j + 1); i = j + 1; lastSig = c; continue; }
    if (c === ';' && lastSig === ';') { i++; continue; }
    out += c; if (!/\s/.test(c)) lastSig = c; i++;
  }
  return out;
}


/** Lista .proto de uma pasta (recursivo, com limites para não varrer o disco inteiro). */
function scanProtos(dir, { maxDepth = 6, max = 3000 } = {}) {
  const out = []; let visitadas = 0;
  const walk = (d, depth) => {
    if (out.length >= max || depth > maxDepth || visitadas > 20000) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      visitadas++;
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, depth + 1);
      else if (/\.proto$/i.test(e.name)) { out.push(f); if (out.length >= max) return; }
    }
  };
  walk(dir, 0);
  return out;
}

/** Nomes completos (pacote.Mensagem.Aninhada) declarados por um .proto, sem precisar do parser completo. */
function declaredNames(file) {
  let src; try { src = stripEmptyStatements(fs.readFileSync(file).toString('utf8')); } catch { return new Set(); } // (durante o load o readFileSync de .proto está remendado e devolve Buffer)
  src = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const pkg = (/^\s*package\s+([\w.]+)\s*;/m.exec(src) || [])[1] || '';
  const names = new Set(); const stack = [];
  const re = /\b(message|enum|service|extend|oneof)\s+([\w.]+)\s*\{|\{|\}/g; let m;
  while ((m = re.exec(src))) {
    if (m[0] === '}') { stack.pop(); continue; }
    if (m[0] === '{') { stack.push(null); continue; }
    const kind = m[1]; const nm = m[2];
    if (kind === 'message' || kind === 'enum') { stack.push(nm); names.add([pkg, ...stack.filter(Boolean)].filter(Boolean).join('.')); }
    else stack.push(null);
  }
  return names;
}

/** Procura, nas pastas dadas, um .proto que declare o tipo [name] (como escrito no .proto de [scope]). */
function locateType(name, scope, dirs, skip, cache) {
  const abs = name.startsWith('.');
  const w = name.replace(/^\./, '');
  const want = new Set();
  if (abs) want.add(w);
  else {
    const parts = (scope || '').replace(/^\./, '').split('.').filter(Boolean);
    for (let i = parts.length; i >= 0; i--) want.add([...parts.slice(0, i), w].join('.'));
  }
  const files = [];
  for (const d of dirs) for (const f of (cache.scan.get(d) || (cache.scan.set(d, scanProtos(d)), cache.scan.get(d)))) if (!files.includes(f)) files.push(f);
  const hits = [];
  for (const f of files) {
    if (skip.has(path.resolve(f))) continue;
    const names = cache.decl.get(f) || (cache.decl.set(f, declaredNames(f)), cache.decl.get(f));
    for (const n of names) { if (want.has(n) || (!scope && (n === w || n.endsWith('.' + w)))) { hits.push(f); break; } }
  }
  return hits;
}

/** Carrega .proto: procura na pasta do arquivo → import paths (na ordem) → WKT embutidos do protobufjs. */
function loadProtoFiles(files, importPaths = [], baseDir) {
  const absFiles = files.map((f) => (path.isAbsolute(f) ? f : path.join(baseDir || process.cwd(), f)));
  const dirs = importPaths.map((p) => (path.isAbsolute(p) ? p : path.join(baseDir || process.cwd(), p)));
  const resolvePath = (origin, target) => {
    if (path.isAbsolute(target) && fs.existsSync(target)) return target;
    if (protobuf.common[target] !== undefined) return target;
    const candidates = [];
    if (origin) candidates.push(path.join(path.dirname(origin), target));
    for (const d of dirs) candidates.push(path.join(d, target));
    for (const f of absFiles) candidates.push(path.join(path.dirname(f), target));
    // ancestrais do arquivo (import "pacote/x.proto" quando o arquivo está em raiz/pacote/y.proto)
    for (const f of [origin, ...absFiles].filter(Boolean)) { let d = path.dirname(f); for (let i = 0; i < 8 && d && d !== path.dirname(d); i++) { candidates.push(path.join(d, target)); d = path.dirname(d); } }
    for (const c of candidates) if (fs.existsSync(c)) return c;
    // WKT que o protobufjs não embute em `common` (descriptor, api, type, source_context): usa os .proto do pacote dele
    if (/^google\/protobuf\//.test(target)) { const own = path.join(PROTOBUFJS_DIR, target); if (fs.existsSync(own)) return own; }
    return target; // falha com erro claro
  };
  // protoc aceita ";;" (instrução vazia); o parser do protobufjs não. Corrige o texto só durante a leitura.
  const nodeFs = protobuf.util.fs; const origRead = nodeFs && nodeFs.readFileSync;
  if (origRead) nodeFs.readFileSync = function (f, ...rest) { const b = origRead.call(this, f, ...rest); return /\.proto$/i.test(String(f)) ? Buffer.from(stripEmptyStatements(b.toString('utf8')), 'utf8') : b; };
  // Imports que faltam no .proto (o protoc recusaria; Postman/Kreya não): acha o arquivo que declara o tipo e carrega junto.
  const searchDirs = [...new Set([...dirs, ...absFiles.flatMap((f) => { const o = []; let d = path.dirname(f); for (let i = 0; i < 6; i++) { const u = path.dirname(d); if (u === d || d === os.homedir()) break; o.push(d); d = u; } return o; })])];
  const cache = { scan: new Map(), decl: new Map() };
  const auto = []; let root;
  try {
    for (let tentativa = 0; ; tentativa++) {
      root = new protobuf.Root(); root.resolvePath = resolvePath;
      try {
        root.loadSync([...absFiles, ...auto], { keepCase: true, alternateCommentMode: true });
        root.resolveAll();
        break;
      } catch (e) {
        const falta = /no such (?:Type or Enum|Type|type|Enum|Service)[: ]+'?([.\w]+)'?(?: in (?:Type|Service|Method|Field|Message)? ?(\S+))?/.exec(e.message);
        if (falta && tentativa < 40) {
          const skip = new Set([...absFiles, ...auto].map((f) => path.resolve(f)));
          // 1º as pastas de import; só se não achar, as pastas ao redor do arquivo (mais lento)
          let hits = locateType(falta[1], falta[2], dirs, skip, cache);
          // pastas ao redor do arquivo: da mais perto para a mais longe; para na primeira que tiver o tipo
          for (let i = 0; !hits.length && i < searchDirs.length; i++) hits = locateType(falta[1], falta[2], [searchDirs[i]], skip, cache);
          if (hits.length) {
            // vários candidatos: o mais perto (em pastas) do arquivo que pediu o tipo
            const ref = absFiles[0]; const comum = (f) => { const a = path.dirname(f).split(path.sep), b = path.dirname(ref).split(path.sep); let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
            hits.sort((x, y) => comum(y) - comum(x));
            auto.push(hits[0]); continue;
          }
          throw new Error(`O tipo "${falta[1].replace(/^\./, '')}"${falta[2] ? ` (usado em ${falta[2].replace(/^\./, '')})` : ''} não está em nenhum .proto carregado e não achei nenhum arquivo que o declare nas pastas conhecidas. Adicione o .proto que o define, ou use "+ Pasta raiz" para apontar a pasta onde estão os protos.`);
        }
        const miss = /ENOENT[^']*'([^']+)'/.exec(e.message);
        if (miss) throw new Error(`Import não encontrado: "${miss[1]}". Adicione esse arquivo (ou a pasta raiz dos .proto) em Schema → Import paths, ou use "+ Adicionar .proto" que copia os imports junto.`);
        throw new Error(e.message.startsWith('O tipo ') ? e.message : `Erro ao ler .proto: ${e.message}`);
      }
    }
  } finally { if (origRead) nodeFs.readFileSync = origRead; }
  root.jaiminhoAuto = auto;
  return root;
}

function rootFromDescriptorFiles(files) {
  // files: [{name, bytes}] (FileDescriptorProto codificados)
  const decoded = files.map((f) => descriptor.FileDescriptorProto.decode(f.bytes));
  const names = new Set(decoded.map((d) => d.name));
  // WKT ausentes: completa com os do protobufjs
  const missing = new Set();
  for (const d of decoded) for (const dep of d.dependency || []) if (!names.has(dep) && /^google\/protobuf\//.test(dep)) missing.add(dep);
  if (missing.size) {
    const wktRoot = new protobuf.Root();
    for (const m of missing) { const key = m.replace(/^google\/protobuf\//, ''); if (protobuf.common[key]) { wktRoot.addJSON(protobuf.common[key].nested); } }
    const wktSet = wktRoot.toDescriptor('proto3');
    for (const f of wktSet.file) {
      if (missing.has(f.name)) { decoded.unshift(f); names.add(f.name); }
      else if (!names.has(f.name) && f.package === 'google.protobuf') {
        // protobufjs junta tudo num arquivo só; nomeia como o primeiro faltante
        const name = [...missing].find((m) => !names.has(m)); if (name) { f.name = name; decoded.unshift(f); names.add(name); }
      }
    }
  }
  const set = descriptor.FileDescriptorSet.create({ file: decoded });
  const root = protobuf.Root.fromDescriptor(set);
  root.resolveAll();
  return root;
}

function loadProtoset(file) {
  const buf = fs.readFileSync(file);
  const set = descriptor.FileDescriptorSet.decode(buf);
  const root = protobuf.Root.fromDescriptor(set);
  root.resolveAll();
  return { root, files: set.file.map((f) => ({ name: f.name, bytes: Buffer.from(descriptor.FileDescriptorProto.encode(f).finish()) })) };
}

/** FileDescriptorSet (protoset) a partir de um root ou de arquivos crus. */
function toProtoset(schema) {
  if (schema.files && schema.files.length) {
    const set = descriptor.FileDescriptorSet.create({ file: schema.files.map((f) => descriptor.FileDescriptorProto.decode(f.bytes)) });
    return Buffer.from(descriptor.FileDescriptorSet.encode(set).finish());
  }
  return Buffer.from(descriptor.FileDescriptorSet.encode(schema.root.toDescriptor('proto3')).finish());
}

function listServices(root) {
  const out = [];
  const walk = (ns) => {
    for (const obj of ns.nestedArray || []) {
      if (obj instanceof protobuf.Service) {
        const name = obj.fullName.replace(/^\./, '');
        if (/^grpc\.reflection\./.test(name) || /^grpc\.health\./.test(name) && false) continue;
        out.push({
          name,
          methods: obj.methodsArray.map((m) => {
            m.resolve();
            const kind = m.requestStream && m.responseStream ? 'bidi' : m.requestStream ? 'client-stream' : m.responseStream ? 'server-stream' : 'unary';
            return { name: m.name, fullName: `${name}/${m.name}`, path: `/${name}/${m.name}`, kind, requestStream: !!m.requestStream, responseStream: !!m.responseStream, inputType: m.resolvedRequestType.fullName.replace(/^\./, ''), outputType: m.resolvedResponseType.fullName.replace(/^\./, ''), comment: m.comment || undefined };
          }),
        });
      } else if (obj.nestedArray) walk(obj);
    }
  };
  walk(root);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function findMethod(root, fullName) {
  const [svc, method] = String(fullName).replace(/^\//, '').split('/');
  const s = root.lookupService(svc);
  const m = s && s.methods[method];
  if (!m) throw new Error(`Método ${fullName} não encontrado no schema`);
  m.resolve();
  return m;
}

// ---------- cache ----------
const cache = new Map();
function cacheKey(parts) { return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex'); }

/**
 * Obtém o schema conforme a fonte da request.
 * schemaCfg: { source: 'reflection'|'proto'|'protoset', files?: [], protoset?: path, importPaths?: [] }
 * conn: { target, credentials, metadata, channelOptions } (para reflection)
 */
async function getSchema(ws, schemaCfg = {}, conn = {}, { refresh = false } = {}) {
  const source = schemaCfg.source || 'reflection';
  const baseDir = ws ? ws.dir : process.cwd();
  if (source === 'proto') {
    const files = (schemaCfg.files || []).map((f) => (path.isAbsolute(f) ? f : path.join(baseDir, f)));
    const importPaths = [...(schemaCfg.importPaths || []), ...((ws && ws.settings.grpc && ws.settings.grpc.importPaths) || []), ws ? path.join(ws.dir, 'protos') : undefined].filter(Boolean);
    // "Carregar todos": todos os .proto das pastas raiz escolhidas pelo usuário (não da pasta protos/ do workspace)
    if (schemaCfg.loadAll) for (const d of schemaCfg.importPaths || []) for (const f of scanProtos(path.isAbsolute(d) ? d : path.join(baseDir, d))) if (!files.includes(f)) files.push(f);
    if (!files.length) throw new Error('Nenhum arquivo .proto selecionado');
    const stamp = files.concat(importPaths).map((f) => { try { return `${f}:${fs.statSync(f).mtimeMs}`; } catch { return f; } });
    const key = cacheKey(['proto', stamp, !!schemaCfg.loadAll]);
    if (!refresh && cache.has(key)) return cache.get(key);
    const root = loadProtoFiles(files, importPaths, baseDir);
    const schema = { source, root, services: listServices(root), autoAdded: root.jaiminhoAuto || [] };
    cache.set(key, schema); return schema;
  }
  if (source === 'protoset') {
    const file = ws ? ws.resolvePath(schemaCfg.protoset) : schemaCfg.protoset;
    if (!file || !fs.existsSync(file)) throw new Error(`Protoset não encontrado: ${schemaCfg.protoset}`);
    const key = cacheKey(['protoset', file, fs.statSync(file).mtimeMs]);
    if (!refresh && cache.has(key)) return cache.get(key);
    const { root, files } = loadProtoset(file);
    const schema = { source, root, files, services: listServices(root) };
    cache.set(key, schema); return schema;
  }
  // reflection
  const key = cacheKey(['reflection', conn.target, conn.cacheTag || '']);
  if (!refresh && cache.has(key)) return cache.get(key);
  try {
    const r = await reflect(conn.target, conn.credentials, conn.metadata, conn.channelOptions);
    const root = rootFromDescriptorFiles(r.files);
    const schema = { source, root, files: r.files, services: listServices(root), reflectionVersion: r.version };
    cache.set(key, schema); return schema;
  } catch (e) {
    if (schemaCfg.fallbackProtoset) return getSchema(ws, { source: 'protoset', protoset: schemaCfg.fallbackProtoset });
    throw e;
  }
}

function clearCache() { cache.clear(); }

/** Copia um .proto para protos/ do workspace preservando o caminho do pacote, junto com os imports que achar. */
function addProtoToWorkspace(wsDir, file) {
  const destRoot = path.join(wsDir, 'protos');
  const copied = [];
  const importsOf = (f) => [...fs.readFileSync(f, 'utf8').matchAll(/^\s*import\s+(?:public\s+|weak\s+)?"([^"]+)"/gm)].map((m) => m[1]);
  const findRoot = (f) => {
    // a raiz é o ancestral D onde todos os imports existem como D/<import>
    const imps = importsOf(f).filter((i) => !/^google\/protobuf\//.test(i));
    let d = path.dirname(f);
    for (let i = 0; i < 8; i++) { if (imps.every((im) => fs.existsSync(path.join(d, im)))) return d; const up = path.dirname(d); if (up === d) break; d = up; }
    return path.dirname(f);
  };
  const root = findRoot(file);
  const visit = (abs) => {
    const rel = path.relative(root, abs);
    const dest = path.join(destRoot, rel.startsWith('..') ? path.basename(abs) : rel);
    if (copied.some((c) => c.dest === dest)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (path.resolve(abs) !== path.resolve(dest)) fs.copyFileSync(abs, dest);
    copied.push({ src: abs, dest });
    for (const im of importsOf(abs)) { if (/^google\/protobuf\//.test(im)) continue; const dep = path.join(root, im); if (fs.existsSync(dep)) visit(dep); }
  };
  visit(file);
  return copied.map((c) => path.relative(wsDir, c.dest).split(path.sep).join('/'));
}

module.exports = { scanProtos, declaredNames, locateType, addProtoToWorkspace, getSchema, loadProtoFiles, loadProtoset, toProtoset, listServices, findMethod, rootFromDescriptorFiles, clearCache };
