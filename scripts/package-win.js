#!/usr/bin/env node
'use strict';
// Gera o Jaiminho para Windows (instalador NSIS + portátil + pasta "unpacked") a partir de qualquer SO.
// Uso: node scripts/package-win.js [--targets nsis,portable,dir]
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const desktop = path.join(root, 'apps', 'desktop');
const stage = path.join(root, 'release', 'stage');
const out = path.join(root, 'release');
const targets = (process.argv.find((a) => a.startsWith('--targets=')) || '--targets=nsis,portable').split('=')[1].split(',');
const run = (cmd, cwd = root) => { console.log(`$ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }); };
const copy = (src, dst, filter = () => true) => {
  if (!fs.existsSync(src)) return;
  if (fs.statSync(src).isDirectory()) { fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(src)) if (filter(path.join(src, f))) copy(path.join(src, f), path.join(dst, f), filter); }
  else fs.copyFileSync(src, dst);
};

run('npx vite build --config renderer/vite.config.mjs', desktop);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
copy(path.join(desktop, 'main'), path.join(stage, 'main'));
copy(path.join(desktop, 'renderer', 'dist'), path.join(stage, 'renderer', 'dist'));
copy(path.join(desktop, 'build'), path.join(stage, 'build'));
const noTests = (p) => !/[\\/](test|certs|node_modules)$/.test(p);
copy(path.join(root, 'packages', 'engine'), path.join(stage, 'packages', 'engine'), noTests);
copy(path.join(root, 'packages', 'mocks'), path.join(stage, 'packages', 'mocks'), noTests);
const pkg = require(path.join(desktop, 'package.json'));
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: 'jaiminho', productName: 'Jaiminho', version: pkg.version, description: pkg.description, author: pkg.author, license: 'Apache-2.0', main: 'main/main.js',
  dependencies: { '@jaiminho/engine': 'file:./packages/engine', '@jaiminho/mocks': 'file:./packages/mocks' },
}, null, 2));
run('npm install --omit=dev --install-links --no-audit --no-fund', stage);

const config = {
  appId: 'local.jaiminho.app', productName: 'Jaiminho', electronVersion,
  directories: { output: out, buildResources: 'build' },
  files: ['main/**', 'renderer/dist/**', 'build/icon.png', 'package.json', 'node_modules/**'],
  asar: true, asarUnpack: ['**/node_modules/xmllint-wasm/**'],
  win: { icon: 'build/icon.ico', signAndEditExecutable: true, artifactName: '${productName}-${version}-${arch}-${target}.${ext}' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, shortcutName: 'Jaiminho', installerIcon: 'build/icon.ico', uninstallerIcon: 'build/icon.ico', artifactName: 'Jaiminho-Setup-${version}.${ext}' },
  portable: { artifactName: 'Jaiminho-${version}-portatil.${ext}' },
  publish: null,
};
fs.writeFileSync(path.join(stage, 'electron-builder.json'), JSON.stringify(config, null, 2));
run(`npx --prefix "${root}" electron-builder --projectDir "${stage}" --config electron-builder.json --win ${targets.join(' ')} --x64`, root);
console.log(`\nPronto. Arquivos em ${out}`);
