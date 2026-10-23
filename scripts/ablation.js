// Experiments A-D: factorial ablation, batch workloads, repeated trials. Usage: node scripts/ablation.js [R_mint] [R_w10]
const hre = require('hardhat'), { ethers } = require('ethers'), solc = require('solc'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), R1 = +process.argv[2] || 30, R2 = +process.argv[3] || 10;
// ---- compile variants with the SAME settings as scripts/compile.js
const names = JSON.parse(fs.readFileSync(root + '/variants/variants.json'));
const sources = {}; for (const f of [...names.map(n => n + '.sol'), 'Looper.sol']) sources['variants/' + f] = { content: fs.readFileSync(root + '/variants/' + f, 'utf8') };
const imp = (p) => { try { return { contents: fs.readFileSync(root + '/node_modules/' + p, 'utf8') }; } catch (e) { return { error: p }; } };
const co = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }), { import: imp }));
for (const e of co.errors || []) if (e.severity === 'error') { console.log(e.formattedMessage); process.exit(1); }
const art = JSON.parse(fs.readFileSync(root + '/artifacts/compiled.json'));
for (const f in co.contracts) if (f.startsWith('variants/')) for (const c in co.contracts[f]) art[c] = { abi: co.contracts[f][c].abi, bytecode: '0x' + co.contracts[f][c].evm.bytecode.object };
const URI = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/';
const rnd = (tag) => ethers.getAddress('0x' + ethers.keccak256(ethers.toUtf8Bytes(tag)).slice(-40)); // seeded pseudo-random address
const stat = (a) => { const n = a.length, m = a.reduce((x, y) => x + y, 0) / n; return { n, mean: m, sd: n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : 0, min: Math.min(...a), max: Math.max(...a) }; };

(async () => {
  const provider = new ethers.BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 }) /* ethers v6 caches identical eth_call/estimateGas for 250 ms; disabled */;
  const S = []; for (let i = 0; i < 40; i++) S.push(await provider.getSigner(i));
  const dep = async (name, ...args) => { const c = await new ethers.ContractFactory(art[name].abi, art[name].bytecode, S[0]).deploy(...args); const r = await c.deploymentTransaction().wait(); return { c, gas: Number(r.gasUsed) }; };
  const g = async (p) => Number((await (await p).wait()).gasUsed);
  const all = [...names, 'NaiveNFT', 'OZBaselineNFT', 'ModularNFT'];
  const isTok = (n) => n === 'NaiveNFT' || n === 'OZBaselineNFT' || n.includes('_token_');
  const mk = (n, owner) => n === 'NaiveNFT' ? dep(n) : n === 'OZBaselineNFT' ? dep(n, owner) : n === 'ModularNFT' ? dep(n, 'M', 'M', URI, 100000, owner) : dep(n, 'M', 'M', n.includes('_token_') ? undefined : URI, 100000, owner);
  const mkargs = (n, owner) => {
    if (n === 'NaiveNFT') return [n];
    if (n === 'OZBaselineNFT') return [n, owner];
    if (n === 'ModularNFT') return [n, 'M', 'M', URI, 100000, owner];
    return n.includes('_token_') ? [n, 'M', 'M', '', 100000, owner] : [n, 'M', 'M', URI, 100000, owner];
  };
  const D = (n, owner) => dep(...mkargs(n, owner));
  const mint = (n, c, to, i, uriLen) => isTok(n) ? c.mint ? c.mint(to, (URI + i + '.json').padEnd(uriLen || 0, 'x')) : c.safeMint(to, URI + i + '.json') : c.mint(to);
  const mintCall = (n, c, to, i, uriLen) => n === 'OZBaselineNFT' ? c.safeMint(to, URI + i + '.json') : mint(n, c, to, i, uriLen);
  const out = { config: { R_mint: R1, R_w10: R2, solc: solc.version(), evmVersion_compile: 'paris', hardfork: 'shanghai', optimizer_runs: 200 }, mint: {}, w10: {}, uri_len: [], fixed_repeat: {} };

  // ---- Experiment A/C/D: per-variant mint workloads, R1 fresh deployments, seeded random recipients
  for (const n of all) {
    const dep_g = [], first = [], steady = [], same_first = [], same_rest = [];
    for (let t = 0; t < R1; t++) {
      const { c, gas } = await D(n, S[0].address); dep_g.push(gas);
      const gs = []; for (let i = 0; i < 20; i++) gs.push(await g(mintCall(n, c, rnd(`${n}/${t}/f${i}`), i)));
      first.push(gs[0]); steady.push(gs.slice(1).reduce((a, b) => a + b, 0) / 19);
      const one = rnd(`${n}/${t}/same`); const hs = []; for (let i = 0; i < 10; i++) hs.push(await g(mintCall(n, c, one, 20 + i)));
      same_first.push(hs[0]); same_rest.push(hs.slice(1).reduce((a, b) => a + b, 0) / 9);
    }
    out.mint[n] = { deploy: stat(dep_g), first_mint_fresh_contract: stat(first), mint_fresh_recipient_steady: stat(steady), mint_same_recipient_first: stat(same_first), mint_same_recipient_rest: stat(same_rest) };
    console.log('mint', n, out.mint[n].mint_fresh_recipient_steady.mean.toFixed(1));
  }
  // ---- Experiment B: W10 = ten tokens to one fresh recipient: (sep) 10 txs, (loop) 10 mints in 1 tx via proxy, (batch) 1 mintBatch tx
  const baseVars = [...names.filter(n => n.includes('_base_')), 'ModularNFT'];
  for (const n of baseVars) {
    const res = { cold: { sep: [], loop: [], batch: [] }, warm: { sep: [], loop: [], batch: [] } };
    for (let t = 0; t < R2; t++) for (const mode of ['cold', 'warm']) {
      const to = rnd(`${n}/${t}/w10${mode}`), warmTo = rnd(`${n}/${t}/warmup${mode}`);
      const prep = async (c) => { if (mode === 'warm') await (await c.mint(warmTo)).wait(); };
      { const { c } = await D(n, S[0].address); await prep(c); let s = 0; for (let i = 0; i < 10; i++) s += await g(c.mint(to)); res[mode].sep.push(s); }
      { const { c: lp } = await dep('Looper'); const { c } = await D(n, await lp.getAddress());
        if (mode === 'warm') await (await lp.run(await c.getAddress(), warmTo, 1)).wait();
        res[mode].loop.push(await g(lp.run(await c.getAddress(), to, 10))); }
      { const { c } = await D(n, S[0].address); await prep(c); res[mode].batch.push(await g(c.mintBatch(to, 10))); }
    }
    out.w10[n] = Object.fromEntries(Object.entries(res).map(([m, o]) => [m, Object.fromEntries(Object.entries(o).map(([k, a]) => [k, stat(a)]))]));
    console.log('w10', n, out.w10[n].warm.sep.mean, out.w10[n].warm.loop.mean, out.w10[n].warm.batch.mean);
  }
  // ---- URI-length sensitivity (per-token metadata, otherwise minimal contract): steady-state mint, 5 mints averaged excluding the first
  for (const L of [0, 20, 40, 67, 100, 150, 200]) {
    const { c } = await D('V_token_G0P0C0', S[0].address); await (await c.mint(rnd('u/w'), 'x'.repeat(L))).wait();
    const gs = []; for (let i = 0; i < 5; i++) gs.push(await g(c.mint(rnd(`u/${L}/${i}`), 'x'.repeat(L))));
    out.uri_len.push({ len: L, gas: stat(gs).mean });
  }
  // ---- fixed-account repeat of the original experiment's single-mint/transfer/burn workload (determinism check)
  for (const n of ['NaiveNFT', 'OZBaselineNFT', 'ModularNFT']) {
    const m = [], tr = [], bu = [];
    for (let t = 0; t < R1; t++) {
      const { c } = await D(n, S[0].address); const q = n === 'ModularNFT' ? (i) => c.mint(S[10 + i].address) : n === 'NaiveNFT' ? (i) => c.mint(S[10 + i].address, URI + i + '.json') : (i) => c.safeMint(S[10 + i].address, URI + i + '.json');
      const gs = []; for (let i = 0; i < 20; i++) gs.push(await g(q(i))); m.push(gs.reduce((a, b) => a + b, 0) / 20);
      const ts = []; for (let i = 0; i < 10; i++) ts.push(await g(c.connect(S[10 + i]).transferFrom(S[10 + i].address, S[3].address, i))); tr.push(ts.reduce((a, b) => a + b, 0) / 10);
      const bs = []; for (let i = 10; i < 20; i++) bs.push(await g(c.connect(S[10 + i]).burn(i))); bu.push(bs.reduce((a, b) => a + b, 0) / 10);
    }
    out.fixed_repeat[n] = { mint_avg20: stat(m), transfer_avg10: stat(tr), burn_avg10: stat(bu) };
  }
  fs.writeFileSync(root + '/results/ablation.json', JSON.stringify(out, null, 1));
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
