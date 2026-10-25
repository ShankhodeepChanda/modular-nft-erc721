// Behavioural security tests T1-T8 and a small seeded randomized invariant test (T9). Usage: node scripts/security_tests.js
const hre = require('hardhat'), { ethers } = require('ethers'), solc = require('solc'), fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');

const artPath = path.join(root, 'artifacts', 'compiled.json');
if (!fs.existsSync(artPath)) {
  console.log('artifacts/compiled.json not found; compiling contracts first...');
  require('./compile.js');
}
const art = JSON.parse(fs.readFileSync(artPath));

const n = 'V_base_G0P0C1';
const variantFile = path.join(root, 'variants', `${n}.sol`);
if (!fs.existsSync(variantFile)) {
  console.log('variants not found; generating variants first...');
  require('./gen_variants.js');
}

{ const src = { ['variants/' + n + '.sol']: { content: fs.readFileSync(variantFile, 'utf8') } };
  const o = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: src, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }), { import: (p) => ({ contents: fs.readFileSync(path.join(root, 'node_modules', p), 'utf8') }) }));
  const c = o.contracts['variants/' + n.concat('.sol')][n]; art[n] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }; }
const URI = 'ipfs://bafyexample/';
(async () => {
  const p = new ethers.BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 }) /* ethers v6 caches identical eth_call/estimateGas for 250 ms; disabled */; const S = []; for (let i = 0; i < 12; i++) S.push(await p.getSigner(i));
  const [own, a, b, c3] = S;
  const dep = async (n, ...x) => { const c = await new ethers.ContractFactory(art[n].abi, art[n].bytecode, own).deploy(...x); await c.waitForDeployment(); return c; };
  const IF = new ethers.Interface([...art.ModularNFT.abi, ...art.ReentrantOwner.abi]);
  const dec = (e) => { const d = e.data ?? e.error?.data ?? e.info?.error?.data ?? e.info?.error?.error?.data; try { const r = IF.parseError(d); return r.name + (r.args.length ? '(' + r.args.join(',') + ')' : ''); } catch (_) { return (e.shortMessage || e.message || '').slice(0, 70) + (d ? ' [' + String(d).slice(0, 10) + ']' : ''); } };
  const fails = async (pr) => { try { await (await pr).wait(); return null; } catch (e) { return dec(e); } };
  const M = (cap = 5, owner = own.address) => dep('ModularNFT', 'M', 'M', URI, cap, owner);
  const R = {}; const ok = (k, v) => { R[k] = v; console.log(k.padEnd(34), JSON.stringify(v)); };

  // T1 pause scope
  { const m = await M(); await (await m.mint(a.address)).wait(); await (await m.mint(a.address)).wait(); await (await m.pause()).wait();
    ok('T1_paused_mint', (await fails(m.mint(a.address))) ? 'reverted' : 'OK');
    ok('T1_paused_transfer', (await fails(m.connect(a).transferFrom(a.address, b.address, 0))) ? 'reverted' : 'allowed');
    ok('T1_paused_approve', (await fails(m.connect(a).approve(b.address, 1))) ? 'reverted' : 'allowed');
    ok('T1_paused_burn', (await fails(m.connect(a).burn(1))) ? 'reverted' : 'allowed');
    await (await m.unpause()).wait(); ok('T1_unpaused_mint', (await fails(m.mint(a.address))) ? 'reverted' : 'allowed'); }
  // T2 burn does not free supply cap (cap counts cumulative mints)
  { const m = await M(2); await (await m.mint(a.address)).wait(); await (await m.mint(a.address)).wait(); await (await m.connect(a).burn(0)).wait();
    ok('T2_mint_after_burn_at_cap', { error: await fails(m.mint(a.address)), totalMinted: Number(await m.totalMinted()), balanceOfA: Number(await m.balanceOf(a.address)) }); }
  // T3 batch boundaries
  { const m = await M(5);
    ok('T3_batch_zero', await fails(m.mintBatch(a.address, 0)));
    ok('T3_batch_cap_plus1', await fails(m.mintBatch(a.address, 6)));
    await (await m.mint(a.address)).wait();
    ok('T3_batch_overflow_nextId1', await fails(m.mintBatch(a.address, ethers.MaxUint256)));
    ok('T3_after_failures_totalMinted', Number(await m.totalMinted()));
    ok('T3_batch_exact_remaining', (await fails(m.mintBatch(a.address, 4))) || 'OK, totalMinted=' + Number(await m.totalMinted()));
    ok('T3_mint_after_full', await fails(m.mint(a.address))); }
  // T4 reentrancy: owner is a contract that re-enters mint in its receiver callback. Guarded vs unguarded (cap 2)
  { for (const n of ['ModularNFT', 'V_base_G0P0C1']) {
      const atk = await dep('ReentrantOwner'); const ad = await atk.getAddress(); const m = await dep(n, 'M', 'M', URI, 2, ad);
      const data = m.interface.encodeFunctionData('mint', [ad]); const e = await fails(atk.attack(await m.getAddress(), data));
      ok('T4_reenter_mint_' + n, { error: e, minted: m.totalMinted ? Number(await m.totalMinted()) : 'n/a (no getter)', balance: Number(await m.balanceOf(ad)) }); } }
  { const atk = await dep('ReentrantOwner'); const ad = await atk.getAddress(); const m = await dep('V_base_G0P0C1', 'M', 'M', URI, 1, ad);
    const e = await fails(atk.attack(await m.getAddress(), m.interface.encodeFunctionData('mint', [ad])));
    ok('T4b_unguarded_cap1_reenter', { error: e, balance: Number(await m.balanceOf(ad)) }); }
  // T5 callback re-enters transferFrom (not covered by nonReentrant): non-owner receiver forwards token during callback
  { const m = await M(); const rc = await dep('TestReceiver', c3.address);
    const e = await fails(m.mint(await rc.getAddress())); ok('T5_callback_forwards_token', { error: e, ownerOf0: await m.ownerOf(0), sinkIsOwner: (await m.ownerOf(0)) === c3.address }); }
  // T6 zero address + ownership
  { const m = await M(); ok('T6_mint_to_zero', await fails(m.mint(ethers.ZeroAddress)));
    await (await m.mint(a.address)).wait(); ok('T6_transfer_to_zero', await fails(m.connect(a).transferFrom(a.address, ethers.ZeroAddress, 0)));
    ok('T6_nonowner_pause', await fails(m.connect(a).pause())); ok('T6_nonowner_mintBatch', await fails(m.connect(a).mintBatch(a.address, 1)));
    await (await m.renounceOwnership()).wait(); ok('T6_mint_after_renounce', await fails(m.mint(a.address))); }
  // T7 ERC-721 conformance spot checks
  { const m = await M(); await (await m.mint(a.address)).wait();
    ok('T7_erc165', { erc721: await m.supportsInterface('0x80ac58cd'), metadata: await m.supportsInterface('0x5b5e139f'), random: await m.supportsInterface('0xffffffff') });
    ok('T7_tokenURI', await m.tokenURI(0)); ok('T7_ownerOf_nonexistent', await fails(m.ownerOf.staticCall(99).then(() => Promise.reject(new Error('no revert'))).catch((e) => ({ wait: async () => { throw e; } }))));
    ok('T7_tokenURI_nonexistent', await (async () => { try { await m.tokenURI(99); return null; } catch (e) { return dec(e); } })());
    ok('T7_unauthorized_transfer', await fails(m.connect(b).transferFrom(a.address, b.address, 0)));
    await (await m.connect(a).approve(b.address, 0)).wait(); await (await m.connect(b).burn(0)).wait(); ok('T7_approved_operator_burn', 'allowed (OK)'); }
  // T8 NaiveNFT/OZBaseline spot checks for the report
  { const nv = await dep('NaiveNFT'); await (await nv.connect(a).mint(a.address, 'x')).wait(); await (await nv.connect(b).burn(0)).wait(); ok('T8_naive_attacker_burned_victim', 'SUCCEEDED'); }
  // T9 seeded randomized invariant test on ModularNFT (NOT a coverage-guided fuzzer)
  { let seed = 12345; const rn = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; }; // high bits: low LCG bits are periodic
    const CAP = 40; const m = await M(CAP); const users = [a, b, c3, S[4]]; const owners = new Map(); let minted = 0, paused = false, ops = 0, viol = [];
    const H = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < 1500; i++) { const op = rn(6); H[op]++; if (process.env.TRACE && i < 30) console.log(i, op, 'paused', paused, 'minted', minted, 'owners', owners.size); try {
      if (op === 0) { const u = users[rn(4)]; const e = await fails(m.mint(u.address)); const should = !paused && minted < CAP; if (!!e === should) viol.push(['mint', i, e, paused, minted, 'chainPaused=' + await m.paused(), 'tm=' + Number(await m.totalMinted())]); if (!e) { owners.set(minted, u.address); minted++; } }
      else if (op === 1) { const q = 1 + rn(4), u = users[rn(4)]; const e = await fails(m.mintBatch(u.address, q)); const should = !paused && minted + q <= CAP; if (!!e === should) viol.push(['batch', i, e, paused, minted, q]); if (!e) { for (let k = 0; k < q; k++) owners.set(minted + k, u.address); minted += q; } }
      else if (op === 2 && owners.size) { const ids = [...owners.keys()]; const id = ids[rn(ids.length)]; const from = owners.get(id), to = users[rn(4)]; const s = users.find((x) => x.address === from); const e = await fails(m.connect(s).transferFrom(from, to.address, id)); if (e) viol.push(['transfer', i]); else owners.set(id, to.address); }
      else if (op === 3 && owners.size) { const ids = [...owners.keys()]; const id = ids[rn(ids.length)]; const from = owners.get(id); const s = users.find((x) => x.address === from); const e = await fails(m.connect(s).burn(id)); if (e) viol.push(['burn', i]); else owners.delete(id); }
      else if (op === 4) { if (!paused) { await (await m.pause()).wait(); paused = true; } } else if (op === 5) { if (paused) { await (await m.unpause()).wait(); paused = false; } }
      ops++; } catch (e) { if (!/Pausable|EnforcedPause|ExpectedPause/.test(e.message || '')) viol.push(['err', i, (e.message || '').slice(0, 60)]); } 
      if (i % 100 === 99) { const tm = Number(await m.totalMinted()); let sum = 0; for (const u of users) sum += Number(await m.balanceOf(u.address)); if (tm !== minted || tm > CAP || sum !== owners.size) viol.push(['inv', i, tm, minted, sum, owners.size]); } }
    for (const [id, o] of owners) if ((await m.ownerOf(id)) !== o) viol.push(['owner', id]);
    ok('T9_random_invariants', { ops, burnedOrMoved: 'see model', ops_hist: H, finalMinted: minted, live: owners.size, violations: viol.length, first: viol.slice(0, 3) });
    if (viol.length > 0) {
      console.error(`Invariant violations detected: ${viol.length}`);
      process.exitCode = 1;
    }
  }
  fs.mkdirSync(path.join(root, 'results'), { recursive: true });
  fs.writeFileSync(path.join(root, 'results', 'security_tests.json'), JSON.stringify(R, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
