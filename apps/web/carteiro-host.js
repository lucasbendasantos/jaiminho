'use strict';
// Roda o mesmo "carteiro" do desktop como processo Node comum (child_process.fork), adaptando o canal de mensagens
// que no Electron é process.parentPort (utilityProcess).
if (!process.send) { console.error('carteiro-host precisa ser iniciado pelo server.js'); process.exit(1); }
process.parentPort = {
  postMessage: (m) => process.send(m),
  on: (ev, fn) => { if (ev === 'message') process.on('message', (data) => fn({ data })); },
};
process.on('disconnect', () => process.exit(0));
require('../desktop/main/carteiro.js');
