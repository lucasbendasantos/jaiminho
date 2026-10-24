'use strict';
// Workspace em arquivos YAML (partilhável em git/pasta de rede) + área local .jaiminho/ (nunca partilhada).
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { uuidv7, slug, clone, prune } = require('./util');
const { newRequest } = require('./model');

const FORMAT_VERSION = 1;
let histSeq = 0;
const STEP = 10;

const readYaml = (f) => YAML.parse(fs.readFileSync(f, 'utf8')) || {};
function writeYaml(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const text = YAML.stringify(prune(obj), { lineWidth: 0, blockQuote: 'literal' });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, text.replace(/\r\n/g, '\n'));
  fs.renameSync(tmp, f);
}
const pad = (n) => String(n).padStart(3, '0');
const isReq = (f) => f.endsWith('.req.yaml');

/** Cifra padrão (testes/CLI): só base64. O app desktop injeta o safeStorage do Electron. */
const plainCipher = { encrypt: (s) => Buffer.from(s, 'utf8').toString('base64'), decrypt: (b) => Buffer.from(String(b), 'base64').toString('utf8'), kind: 'base64' };

const DEFAULT_SETTINGS = { verifySsl: true, followRedirects: true, timeoutMs: 30000, useSystemCa: true, proxy: { mode: 'system' }, caCertificates: [], certificates: [], grpc: { importPaths: [] } };

class Workspace {
  constructor(dir, { cipher = plainCipher, globalsFile } = {}) {
    this.dir = path.resolve(dir);
    this.cipher = cipher;
    this.globalsFile = globalsFile || path.join(this.dir, '.jaiminho', 'globals.yaml');
    this.index = new Map(); // id → { type, file, dir, parentId, collectionId }
  }

  // ------------------------------------------------------------ abrir/criar
  static create(dir, name, opts) {
    fs.mkdirSync(dir, { recursive: true });
    const manifest = path.join(dir, 'jaiminho.yaml');
    if (!fs.existsSync(manifest)) {
      writeYaml(manifest, { formatVersion: FORMAT_VERSION, id: uuidv7(), name: name || path.basename(dir), settings: DEFAULT_SETTINGS });
    }
    for (const d of ['collections', 'environments', 'protos', 'wsdl', 'data']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    const gi = path.join(dir, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, '# Jaiminho: dados locais (segredos, valores locais, histórico) nunca vão para o git\n.jaiminho/\n');
    return Workspace.open(dir, opts);
  }

  static open(dir, opts) {
    const ws = new Workspace(dir, opts);
    if (!fs.existsSync(path.join(ws.dir, 'jaiminho.yaml'))) throw new Error(`Não é um workspace do Jaiminho (falta jaiminho.yaml): ${ws.dir}`);
    ws.reload();
    return ws;
  }

  static isWorkspace(dir) { return fs.existsSync(path.join(dir, 'jaiminho.yaml')); }

  reload() {
    this.manifest = readYaml(path.join(this.dir, 'jaiminho.yaml'));
    this.manifest.settings = { ...clone(DEFAULT_SETTINGS), ...(this.manifest.settings || {}) };
    this.index.clear(); this.problems = [];
    const colRoot = path.join(this.dir, 'collections');
    fs.mkdirSync(colRoot, { recursive: true });
    for (const d of this._sortedEntries(colRoot)) {
      const full = path.join(colRoot, d);
      if (!fs.statSync(full).isDirectory() || !fs.existsSync(path.join(full, '_collection.yaml'))) continue;
      const meta = this._safeRead(path.join(full, '_collection.yaml')); if (!meta) continue;
      if (!meta.id || this.index.has(meta.id)) { meta.id = uuidv7(); writeYaml(path.join(full, '_collection.yaml'), meta); }
      this.index.set(meta.id, { type: 'collection', dir: full, file: path.join(full, '_collection.yaml'), parentId: null, collectionId: meta.id });
      this._scanFolder(full, meta.id, meta.id);
    }
    const envRoot = path.join(this.dir, 'environments');
    fs.mkdirSync(envRoot, { recursive: true });
    for (const f of fs.readdirSync(envRoot).filter((f) => f.endsWith('.env.yaml')).sort()) {
      const file = path.join(envRoot, f); const e = this._safeRead(file); if (!e) continue;
      if (!e.id || this.index.has(e.id)) { e.id = uuidv7(); writeYaml(file, e); }
      this.index.set(e.id, { type: 'environment', file, parentId: null });
    }
    return this;
  }

  /** Lê YAML; se estiver corrompido (edição à mão, conflito de git) registra em this.problems e pula. */
  _safeRead(f) {
    try { return readYaml(f); } catch (e) { this.problems.push({ file: path.relative(this.dir, f).split(path.sep).join('/'), error: String(e.message).split('\n')[0] }); return null; }
  }

  _sortedEntries(dir) { return fs.readdirSync(dir).filter((f) => !f.startsWith('.') && !f.startsWith('_')).sort(); }

  _scanFolder(dir, parentId, collectionId) {
    for (const e of this._sortedEntries(dir)) {
      const full = path.join(dir, e);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        const metaFile = path.join(full, '_folder.yaml');
        const meta = fs.existsSync(metaFile) ? this._safeRead(metaFile) : { name: e.replace(/^\d+-/, '') };
        if (!meta) continue;
        if (!meta.id || this.index.has(meta.id)) { meta.id = uuidv7(); writeYaml(metaFile, meta); }
        this.index.set(meta.id, { type: 'folder', dir: full, file: metaFile, parentId, collectionId });
        this._scanFolder(full, meta.id, collectionId);
      } else if (isReq(e)) {
        const r = this._safeRead(full); if (!r) continue;
        if (!r.id || this.index.has(r.id)) { r.id = uuidv7(); writeYaml(full, r); }
        this.index.set(r.id, { type: 'request', file: full, parentId, collectionId });
      }
    }
  }

  // ------------------------------------------------------------ leitura
  get name() { return this.manifest.name; }
  get settings() { return this.manifest.settings; }

  saveSettings(patch) {
    this.manifest.settings = { ...this.manifest.settings, ...patch };
    writeYaml(path.join(this.dir, 'jaiminho.yaml'), this.manifest);
    return this.manifest.settings;
  }
  rename(name) { this.manifest.name = name; writeYaml(path.join(this.dir, 'jaiminho.yaml'), this.manifest); }

  info(id) { return this.index.get(id); }

  get(id) {
    const n = this.index.get(id);
    if (!n) throw new Error(`Item não encontrado: ${id}`);
    const data = readYaml(n.file);
    if (n.type === 'request' && data.bodyFile) {
      const bf = path.join(path.dirname(n.file), data.bodyFile);
      if (fs.existsSync(bf)) { data.body = { ...(data.body || {}), raw: fs.readFileSync(bf, 'utf8') }; }
    }
    return { ...data, id, type: n.type };
  }

  children(parentId) {
    return [...this.index.entries()].filter(([, n]) => n.parentId === parentId && (n.type === 'folder' || n.type === 'request'))
      .map(([id, n]) => ({ id, n, order: path.basename(n.type === 'folder' ? n.dir : n.file) }))
      .sort((a, b) => a.order.localeCompare(b.order)).map((x) => x.id);
  }

  tree() {
    const build = (id) => {
      const n = this.index.get(id); const d = readYaml(n.file);
      const node = { id, type: n.type, name: d.name || '(sem nome)' };
      if (n.type === 'request') { node.kind = d.kind || 'http'; node.method = d.kind === 'grpc' ? 'gRPC' : d.kind === 'soap' ? 'SOAP' : (d.method || 'GET'); node.deprecated = !!d.deprecated; }
      else { node.children = this.children(id).map(build); if (n.type === 'collection' && d.origin) node.originType = d.origin.type; }
      return node;
    };
    const collections = [...this.index.entries()].filter(([, n]) => n.type === 'collection')
      .sort((a, b) => path.basename(a[1].dir).localeCompare(path.basename(b[1].dir))).map(([id]) => build(id));
    return { id: this.manifest.id, name: this.manifest.name, collections, environments: this.listEnvironments().map((e) => ({ id: e.id, name: e.name, color: e.color })) };
  }

  /** Cadeia [coleção, pasta..., request] de metadados (para herança de auth/scripts/vars). */
  chain(id) {
    const out = []; let cur = id;
    while (cur) { const n = this.index.get(cur); if (!n) break; out.unshift({ ...this.get(cur) }); cur = n.parentId; }
    return out;
  }

  // ------------------------------------------------------------ escrita
  _nextOrder(dir) {
    const nums = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => parseInt(f, 10)).filter((n) => !isNaN(n)) : [];
    return (nums.length ? Math.max(...nums) : 0) + STEP;
  }

  createCollection(name, extra = {}) {
    const id = extra.id || uuidv7();
    let dir = path.join(this.dir, 'collections', slug(name));
    let i = 2; while (fs.existsSync(dir)) dir = path.join(this.dir, 'collections', `${slug(name)}-${i++}`);
    const meta = { id, name, ...clone(extra), id }; delete meta.type;
    writeYaml(path.join(dir, '_collection.yaml'), meta);
    this.index.set(id, { type: 'collection', dir, file: path.join(dir, '_collection.yaml'), parentId: null, collectionId: id });
    return id;
  }

  _parentDir(parentId) {
    const p = this.index.get(parentId);
    if (!p || (p.type !== 'collection' && p.type !== 'folder')) throw new Error('Pai inválido (precisa ser coleção ou pasta)');
    return p;
  }

  createFolder(parentId, name, extra = {}) {
    const p = this._parentDir(parentId);
    const id = extra.id || uuidv7();
    const dir = path.join(p.dir, `${pad(this._nextOrder(p.dir))}-${slug(name)}`);
    const fmeta = { ...clone(extra), id, name }; delete fmeta.type;
    writeYaml(path.join(dir, '_folder.yaml'), fmeta);
    this.index.set(id, { type: 'folder', dir, file: path.join(dir, '_folder.yaml'), parentId, collectionId: p.collectionId });
    return id;
  }

  createRequest(parentId, req) {
    const p = this._parentDir(parentId);
    const r = newRequest(req);
    const file = path.join(p.dir, `${pad(this._nextOrder(p.dir))}-${slug(r.name)}.req.yaml`);
    this._writeRequest(file, r);
    this.index.set(r.id, { type: 'request', file, parentId, collectionId: p.collectionId });
    return r.id;
  }

  _writeRequest(file, r) {
    const data = clone(r); delete data.type;
    const raw = data.body && data.body.raw;
    const bodyFile = path.basename(file).replace(/\.req\.yaml$/, `.body.${data.body?.language === 'xml' || data.kind === 'soap' ? 'xml' : data.body?.language === 'json' ? 'json' : 'txt'}`);
    const bfPath = path.join(path.dirname(file), bodyFile);
    const baseNoExt = file.replace(/\.req\.yaml$/, '');
    for (const ext of ['.body.xml', '.body.json', '.body.txt']) if (baseNoExt + ext !== bfPath && fs.existsSync(baseNoExt + ext)) fs.unlinkSync(baseNoExt + ext);
    if (raw && raw.length > 4096) {
      fs.writeFileSync(bfPath, raw.replace(/\r\n/g, '\n'));
      delete data.body.raw; data.bodyFile = bodyFile;
    } else {
      delete data.bodyFile;
      if (fs.existsSync(bfPath)) fs.unlinkSync(bfPath);
    }
    writeYaml(file, data);
  }

  save(id, data) {
    const n = this.index.get(id);
    if (!n) throw new Error(`Item não encontrado: ${id}`);
    const prev = readYaml(n.file);
    const merged = { ...data, id };
    delete merged.type;
    if (n.type === 'request') this._writeRequest(n.file, merged);
    else writeYaml(n.file, { ...prev, ...merged });
    if (prev.name !== merged.name && merged.name) this._renameOnDisk(id, merged.name);
    return id;
  }

  _renameOnDisk(id, name) {
    const n = this.index.get(id);
    if (n.type === 'environment') return;
    if (n.type === 'collection') return; // pasta da coleção mantém o nome original (estável para git)
    if (n.type === 'folder') {
      const prefix = (path.basename(n.dir).match(/^\d+/) || [pad(STEP)])[0];
      const nd = path.join(path.dirname(n.dir), `${prefix}-${slug(name)}`);
      if (nd !== n.dir && !fs.existsSync(nd)) { fs.renameSync(n.dir, nd); this.reload(); }
      return;
    }
    const prefix = (path.basename(n.file).match(/^\d+/) || [pad(STEP)])[0];
    const nf = path.join(path.dirname(n.file), `${prefix}-${slug(name)}.req.yaml`);
    if (nf !== n.file && !fs.existsSync(nf)) {
      const oldBody = n.file.replace(/\.req\.yaml$/, '');
      for (const ext of ['.body.xml', '.body.json', '.body.txt']) if (fs.existsSync(oldBody + ext)) fs.renameSync(oldBody + ext, nf.replace(/\.req\.yaml$/, ext));
      fs.renameSync(n.file, nf); n.file = nf;
      const d2 = readYaml(nf);
      if (d2.bodyFile) { d2.bodyFile = path.basename(nf).replace(/\.req\.yaml$/, '.body' + path.extname(d2.bodyFile)); writeYaml(nf, d2); }
    }
  }

  /** Apaga movendo para .jaiminho/lixeira (recuperável). */
  remove(id) {
    const n = this.index.get(id);
    if (!n) return;
    const trash = path.join(this.dir, '.jaiminho', 'lixeira', `${Date.now()}-${uuidv7().slice(-8)}`);
    fs.mkdirSync(trash, { recursive: true });
    const src = n.type === 'request' || n.type === 'environment' ? n.file : n.dir;
    fs.renameSync(src, path.join(trash, path.basename(src)));
    if (n.type === 'request') {
      const base = n.file.replace(/\.req\.yaml$/, '');
      for (const ext of ['.body.xml', '.body.json', '.body.txt']) if (fs.existsSync(base + ext)) fs.renameSync(base + ext, path.join(trash, path.basename(base + ext)));
    }
    this.reload();
  }

  duplicate(id) {
    const n = this.index.get(id);
    if (n.type === 'request') { const r = this.get(id); delete r.id; r.name = `${r.name} (cópia)`; return this.createRequest(n.parentId, r); }
    if (n.type === 'folder') {
      const f = this.get(id); const nid = this.createFolder(n.parentId, `${f.name} (cópia)`, { ...f, id: undefined, name: `${f.name} (cópia)` });
      this._copyChildren(id, nid); return nid;
    }
    if (n.type === 'collection') {
      const c = this.get(id); const nid = this.createCollection(`${c.name} (cópia)`, { ...c, id: undefined, name: `${c.name} (cópia)` });
      for (const v of c.vars || []) if (v.secret) { const sv = this.getSecret(`col:${id}:${v.key}`); if (sv !== undefined) this.setSecret(`col:${nid}:${v.key}`, sv); }
      this._copyChildren(id, nid); return nid;
    }
    if (n.type === 'environment') {
      const e = this.get(id);
      const vars = (e.vars || []).map((v) => (v.secret ? { ...v, value: this.getSecret(`env:${id}:${v.key}`) } : v));
      return this.saveEnvironment({ ...e, vars, id: undefined, name: `${e.name} (cópia)` });
    }
  }
  _copyChildren(fromId, toId) {
    for (const cid of this.children(fromId)) {
      const c = this.index.get(cid); const d = this.get(cid); delete d.id;
      if (c.type === 'request') this.createRequest(toId, d);
      else { const nf = this.createFolder(toId, d.name, d); this._copyChildren(cid, nf); }
    }
  }

  /** Move item para outro pai e/ou posição. */
  move(id, newParentId, index) {
    const n = this.index.get(id);
    if (!n || (n.type !== 'request' && n.type !== 'folder')) throw new Error('Só requests e pastas podem ser movidas');
    let anc = newParentId; while (anc) { if (anc === id) throw new Error('Não dá para mover uma pasta para dentro dela mesma'); anc = this.index.get(anc)?.parentId; }
    const p = this._parentDir(newParentId);
    const siblings = this.children(newParentId).filter((s) => s !== id);
    const pos = index == null ? siblings.length : Math.max(0, Math.min(index, siblings.length));
    siblings.splice(pos, 0, id);
    // move fisicamente para o novo pai com nome temporário e renumera todos
    const src = n.type === 'folder' ? n.dir : n.file;
    const tmpName = `__mv_${Date.now()}_${path.basename(src)}`;
    const tmp = path.join(p.dir, tmpName);
    fs.renameSync(src, tmp);
    if (n.type === 'request') { const base = src.replace(/\.req\.yaml$/, ''); for (const ext of ['.body.xml', '.body.json', '.body.txt']) if (fs.existsSync(base + ext)) fs.renameSync(base + ext, tmp.replace(/\.req\.yaml$/, ext)); }
    if (n.type === 'folder') n.dir = tmp; else n.file = tmp;
    siblings.forEach((sid, i) => {
      const s = this.index.get(sid);
      const cur = s.type === 'folder' ? s.dir : s.file;
      const name = path.basename(cur).replace(/^__mv_\d+_/, '').replace(/^\d+-/, '');
      const target = path.join(p.dir, `${pad((i + 1) * STEP)}-${name}`);
      if (cur !== target) {
        const t2 = fs.existsSync(target) ? target + '.swap' : target;
        fs.renameSync(cur, t2);
        if (s.type === 'request') { const b = cur.replace(/\.req\.yaml$/, ''); for (const ext of ['.body.xml', '.body.json', '.body.txt']) if (fs.existsSync(b + ext)) fs.renameSync(b + ext, t2.replace(/\.req\.yaml$/, ext)); }
        if (s.type === 'folder') s.dir = t2; else s.file = t2;
      }
    });
    for (const f of fs.readdirSync(p.dir).filter((f) => f.endsWith('.swap'))) fs.renameSync(path.join(p.dir, f), path.join(p.dir, f.replace(/\.swap$/, '')));
    // corrigir bodyFile após renomes
    this.reload();
    for (const [rid, rn] of this.index) if (rn.type === 'request') { const d = readYaml(rn.file); if (d.bodyFile) { const want = path.basename(rn.file).replace(/\.req\.yaml$/, '.body' + path.extname(d.bodyFile)); if (want !== d.bodyFile) { d.bodyFile = want; writeYaml(rn.file, d); } } }
  }

  // ------------------------------------------------------------ ambientes
  listEnvironments() {
    return [...this.index.entries()].filter(([, n]) => n.type === 'environment').map(([id, n]) => ({ ...readYaml(n.file), id }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  getEnvironment(id) { return this.get(id); }
  saveEnvironment(env) {
    const id = env.id || uuidv7();
    let n = this.index.get(id);
    const data = { id, name: env.name || 'Ambiente', color: env.color, vars: (env.vars || []).map((v) => this._stripSecret(`env:${id}`, v)) };
    if (!n) {
      let file = path.join(this.dir, 'environments', `${slug(data.name)}.env.yaml`);
      let i = 2; while (fs.existsSync(file)) file = path.join(this.dir, 'environments', `${slug(data.name)}-${i++}.env.yaml`);
      n = { type: 'environment', file, parentId: null }; this.index.set(id, n);
    }
    writeYaml(n.file, data);
    return id;
  }

  /** Segredo nunca vai para o YAML: o valor vai para .jaiminho/secrets.enc. */
  _stripSecret(scope, v) {
    if (!v.secret) return { key: v.key, value: v.value ?? '', enabled: v.enabled === false ? false : undefined, description: v.description };
    if (v.value !== undefined && v.value !== '' && v.value !== SECRET_MASK) this.setSecret(`${scope}:${v.key}`, v.value);
    return { key: v.key, secret: true, enabled: v.enabled === false ? false : undefined, description: v.description };
  }

  /** Variáveis de coleção (com segredos tirados do YAML). */
  saveCollectionVars(collectionId, vars) {
    const c = this.get(collectionId);
    c.vars = (vars || []).map((v) => this._stripSecret(`col:${collectionId}`, v));
    this.save(collectionId, c);
  }

  // ------------------------------------------------------------ globais (por usuário)
  getGlobals() { return fs.existsSync(this.globalsFile) ? (readYaml(this.globalsFile).vars || []) : []; }
  saveGlobals(vars) { writeYaml(this.globalsFile, { vars: (vars || []).map((v) => this._stripSecret('glo', v)) }); }

  // ------------------------------------------------------------ valores locais e segredos (.jaiminho/)
  _localFile() { return path.join(this.dir, '.jaiminho', 'local-values.yaml'); }
  getLocalValues() { return fs.existsSync(this._localFile()) ? readYaml(this._localFile()) : {}; }
  /** value === UNSET marca a variável como removida por script (pm.*.unset), sem mexer no valor partilhado. */
  setLocalValue(scope, key, value) {
    const lv = this.getLocalValues(); lv[scope] = lv[scope] || {};
    if (value === undefined || value === null) delete lv[scope][key]; else lv[scope][key] = String(value);
    writeYaml(this._localFile(), lv);
  }
  clearLocalValues(scope) { const lv = this.getLocalValues(); delete lv[scope]; writeYaml(this._localFile(), lv); }

  _secretsFile() { return path.join(this.dir, '.jaiminho', 'secrets.enc'); }
  _readSecrets() {
    if (!fs.existsSync(this._secretsFile())) return {};
    try { return JSON.parse(this.cipher.decrypt(fs.readFileSync(this._secretsFile(), 'utf8'))); } catch { return {}; }
  }
  setSecret(key, value) {
    const s = this._readSecrets(); if (value === undefined || value === null) delete s[key]; else s[key] = String(value);
    fs.mkdirSync(path.dirname(this._secretsFile()), { recursive: true });
    fs.writeFileSync(this._secretsFile(), this.cipher.encrypt(JSON.stringify(s)));
  }
  getSecret(key) { return this._readSecrets()[key]; }
  missingSecrets() {
    const s = this._readSecrets(); const out = [];
    for (const e of this.listEnvironments()) for (const v of e.vars || []) if (v.secret && s[`env:${e.id}:${v.key}`] === undefined) out.push({ scope: 'environment', id: e.id, name: e.name, key: v.key });
    for (const [id, n] of this.index) if (n.type === 'collection') for (const v of (this.get(id).vars || [])) if (v.secret && s[`col:${id}:${v.key}`] === undefined) out.push({ scope: 'collection', id, name: this.get(id).name, key: v.key });
    return out;
  }

  /**
   * Valores efetivos de um escopo: partilhado → local → segredo.
   * scope: 'env:<id>' | 'col:<id>' | 'glo'
   */
  effectiveVars(scope, vars) {
    const lv = this.getLocalValues()[scope] || {};
    const sec = this._readSecrets();
    const declared = (vars || []).filter((v) => v.key);
    const out = declared.filter((v) => v.enabled !== false && lv[v.key] !== UNSET).map((v) => {
      let value = v.secret ? sec[`${scope}:${v.key}`] : v.value;
      if (lv[v.key] !== undefined) value = lv[v.key];
      return { key: v.key, value: value ?? '', secret: !!v.secret, source: lv[v.key] !== undefined ? 'local' : v.secret ? 'secret' : 'shared' };
    });
    // variáveis criadas por script (pm.environment.set de chave nova) existem só como valor local
    const known = new Set(declared.map((v) => v.key));
    for (const [k, v] of Object.entries(lv)) if (!known.has(k) && v !== UNSET) out.push({ key: k, value: v, secret: false, source: 'local', onlyLocal: true });
    return out;
  }

  // ------------------------------------------------------------ histórico
  _historyDir() { return path.join(this.dir, '.jaiminho', 'history'); }
  addHistory(entry) {
    const d = this._historyDir(); fs.mkdirSync(d, { recursive: true });
    const id = uuidv7();
    histSeq = (histSeq + 1) % 1e6;
    fs.writeFileSync(path.join(d, `${String(Date.now()).padStart(15, '0')}-${String(histSeq).padStart(6, '0')}-${id}.json`), JSON.stringify({ id, at: new Date().toISOString(), ...entry }));
    const files = fs.readdirSync(d).sort();
    if (files.length > 2000) for (const f of files.slice(0, files.length - 2000)) fs.unlinkSync(path.join(d, f));
    return id;
  }
  listHistory(limit = 200) {
    const d = this._historyDir(); if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).sort().reverse().slice(0, limit).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch { return null; } }).filter(Boolean);
  }
  clearHistory() { const d = this._historyDir(); if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f)); }

  resolvePath(p) { return p ? (path.isAbsolute(p) ? p : path.join(this.dir, p)) : p; }
}

const SECRET_MASK = '••••••';
const UNSET = '\u0000unset';

module.exports = { UNSET, Workspace, plainCipher, FORMAT_VERSION, readYaml, writeYaml, SECRET_MASK, DEFAULT_SETTINGS };
