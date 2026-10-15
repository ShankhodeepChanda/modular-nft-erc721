const solc = require('solc'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'contracts');
const sources = {};
for (const f of fs.readdirSync(dir)) if (f.endsWith('.sol')) sources['contracts/' + f] = { content: fs.readFileSync(path.join(dir, f), 'utf8') };
const input = { language: 'Solidity', sources,
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
function findImports(p) {
  try { return { contents: fs.readFileSync(path.join(__dirname, '..', 'node_modules', p), 'utf8') }; }
  catch (e) { return { error: 'not found: ' + p }; }
}
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
let bad = false;
for (const e of out.errors || []) { console.log(e.severity + ': ' + e.formattedMessage); if (e.severity === 'error') bad = true; }
if (bad) process.exit(1);
const art = {};
for (const file in out.contracts) for (const c in out.contracts[file]) {
  if (!file.startsWith('contracts/')) continue;
  art[c] = { abi: out.contracts[file][c].abi, bytecode: '0x' + out.contracts[file][c].evm.bytecode.object };
}
fs.mkdirSync(path.join(__dirname, '..', 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'compiled.json'), JSON.stringify(art));
console.log('compiled with solc', solc.version(), Object.keys(art).join(', '));
