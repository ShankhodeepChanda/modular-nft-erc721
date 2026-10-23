const hre = require('hardhat');
const { ethers } = require('ethers');
const fs = require('fs');
const art = JSON.parse(fs.readFileSync(__dirname + '/../artifacts/compiled.json'));
const URI = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/';

(async () => {
  const provider = new ethers.BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 }) /* ethers v6 caches identical eth_call/estimateGas for 250 ms; disabled */;
  const S = []; for (let i = 0; i < 40; i++) S.push(await provider.getSigner(i));
  const [deployer, attacker, user] = S;
  const addr = (s) => s.address;
  async function deploy(name, signer, ...args) {
    const f = new ethers.ContractFactory(art[name].abi, art[name].bytecode, signer);
    const c = await f.deploy(...args); const r = await c.deploymentTransaction().wait();
    return { c, gas: Number(r.gasUsed) };
  }
  const g = async (txp) => Number((await (await txp).wait()).gasUsed);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const N = 20;

  // contract-specific adapters
  const kinds = {
    NaiveNFT:     { dep: () => deploy('NaiveNFT', deployer),
                    mint: (c, to, i) => c.mint(to, URI + i + '.json'),
                    burnBy: (c, id) => c.burn(id) },
    OZBaselineNFT:{ dep: () => deploy('OZBaselineNFT', deployer, addr(deployer)),
                    mint: (c, to, i) => c.safeMint(to, URI + i + '.json'),
                    burnBy: (c, id) => c.burn(id) },
    ModularNFT:   { dep: () => deploy('ModularNFT', deployer, 'ModularNFT', 'MOD', URI, 100000, addr(deployer)),
                    mint: (c, to) => c.mint(to),
                    burnBy: (c, id) => c.burn(id) },
  };

  const R = { gas: {}, security: {} };
  for (const k of Object.keys(kinds)) {
    const K = kinds[k]; const { c, gas: depGas } = await K.dep();
    const row = { deploy: depGas };
    // single mints to N distinct fresh recipients
    const mg = []; for (let i = 0; i < N; i++) mg.push(await g(K.mint(c.connect(deployer), addr(S[10 + i]), i)));
    row.mint_single = Math.round(mean(mg));
    // 10 tokens to one recipient via 10 separate transactions
    let sum = 0; for (let i = 0; i < 10; i++) sum += await g(K.mint(c.connect(deployer), addr(S[5]), 100 + i));
    row.mint10_separate = sum;
    // transfers: owner of token i -> user
    const tg = []; for (let i = 0; i < 10; i++) tg.push(await g(c.connect(S[10 + i]).transferFrom(addr(S[10 + i]), addr(user), i)));
    row.transfer = Math.round(mean(tg));
    // burn by owner (tokens 10..19 held by S[20..29])
    const bg = []; for (let i = 10; i < 20; i++) bg.push(await g(K.burnBy(c.connect(S[10 + i]), i)));
    row.burn = Math.round(mean(bg));
    R.gas[k] = row;
  }
  // batch mint (proposed only)
  { const { c } = await kinds.ModularNFT.dep();
    R.gas.ModularNFT.mint10_batch = await g(c.connect(deployer).mintBatch(addr(S[5]), 10)); }

  // ---------- security behaviour tests ----------
  async function reverts(p) { try { await (await p).wait(); return false; } catch (e) { return true; } }
  const sec = {};
  // 1. unauthorized mint
  { sec.unauthorized_mint = {};
    for (const k of Object.keys(kinds)) { const { c } = await kinds[k].dep();
      sec.unauthorized_mint[k] = (await reverts(kinds[k].mint(c.connect(attacker), addr(attacker), 0))) ? 'blocked' : 'SUCCEEDED'; } }
  // 2. burn someone else's token
  { sec.burn_others_token = {};
    for (const k of Object.keys(kinds)) { const { c } = await kinds[k].dep();
      await (await kinds[k].mint(c.connect(deployer), addr(user), 0)).wait();
      sec.burn_others_token[k] = (await reverts(c.connect(attacker).burn(0))) ? 'blocked' : 'SUCCEEDED'; } }
  // 3. supply cap: cap of 5, try 6 mints as owner
  { sec.supply_cap = {};
    for (const k of Object.keys(kinds)) {
      let c; if (k === 'ModularNFT') ({ c } = await deploy('ModularNFT', deployer, 'M', 'M', URI, 5, addr(deployer))); else ({ c } = await kinds[k].dep());
      let ok = 0; for (let i = 0; i < 6; i++) { if (!(await reverts(kinds[k].mint(c.connect(deployer), addr(user), i)))) ok++; }
      sec.supply_cap[k] = ok === 6 ? 'no cap (6 of 6 minted)' : `cap enforced (${ok} of 6 minted)`; } }
  // 4. mint while paused (proposed only)
  { const { c } = await kinds.ModularNFT.dep(); await (await c.pause()).wait();
    sec.pause_blocks_mint = { ModularNFT: (await reverts(c.mint(addr(user)))) ? 'blocked' : 'SUCCEEDED', NaiveNFT: 'n/a (no pause)', OZBaselineNFT: 'n/a (no pause)' }; }
  // 5. reentrancy during safeMint callback, contract owned by attacker contract
  { sec.reentrant_mint = {};
    const iface = { OZBaselineNFT: new ethers.Interface(art.OZBaselineNFT.abi), ModularNFT: new ethers.Interface(art.ModularNFT.abi) };
    for (const k of ['OZBaselineNFT', 'ModularNFT']) {
      const { c: atk } = await deploy('ReentrantOwner', deployer); const atkAddr = await atk.getAddress();
      let c; if (k === 'ModularNFT') ({ c } = await deploy('ModularNFT', deployer, 'M', 'M', URI, 100, atkAddr)); else ({ c } = await deploy('OZBaselineNFT', deployer, atkAddr));
      const data = k === 'ModularNFT' ? iface[k].encodeFunctionData('mint', [atkAddr]) : iface[k].encodeFunctionData('safeMint', [atkAddr, 'x']);
      const blocked = await reverts(atk.attack(await c.getAddress(), data));
      const bal = Number(await c.balanceOf(atkAddr));
      sec.reentrant_mint[k] = blocked ? 'blocked (tx reverted)' : `reentrant mint accepted (balance ${bal})`; }
    sec.reentrant_mint.NaiveNFT = 'n/a (no receiver callback)'; }
  R.security = sec;
  fs.writeFileSync(__dirname + '/../results.json', JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
