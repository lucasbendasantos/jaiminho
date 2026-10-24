'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startAll } = require('../../mocks/src');
const { Workspace } = require('../src');

let mocks;
async function getMocks() { if (!mocks) mocks = await startAll(); return mocks; }
async function closeMocks() { if (mocks) { await mocks.close(); mocks = null; } }
function tmpWorkspace(name = 'Teste') { return Workspace.create(fs.mkdtempSync(path.join(os.tmpdir(), 'jaiminho-ws-')), name); }

module.exports = { getMocks, closeMocks, tmpWorkspace };
