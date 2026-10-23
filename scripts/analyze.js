// Derives all tables/percentages used in the paper from results.json and results/ablation.json. Prints JSON + writes results/derived.json
const fs = require('fs'), r = JSON.parse(fs.readFileSync(__dirname + '/../results.json')), a = JSON.parse(fs.readFileSync(__dirname + '/../results/ablation.json'));
const pct = (base, x) => +(((base - x) / base) * 100).toFixed(2);   // percentage reduction (negative = increase)
const G = r.gas, d = {};
d.reduction_vs_OZ = { single_mint: pct(G.OZBaselineNFT.mint_single, G.ModularNFT.mint_single), ten_separate: pct(G.OZBaselineNFT.mint10_separate, G.ModularNFT.mint10_separate), batch_vs_OZ_ten_separate: pct(G.OZBaselineNFT.mint10_separate, G.ModularNFT.mint10_batch), deploy: pct(G.OZBaselineNFT.deploy, G.ModularNFT.deploy), transfer: pct(G.OZBaselineNFT.transfer, G.ModularNFT.transfer), burn: pct(G.OZBaselineNFT.burn, G.ModularNFT.burn) };
d.reduction_vs_Naive = { single_mint: pct(G.NaiveNFT.mint_single, G.ModularNFT.mint_single), ten_separate: pct(G.NaiveNFT.mint10_separate, G.ModularNFT.mint10_separate), deploy: pct(G.NaiveNFT.deploy, G.ModularNFT.deploy), transfer: pct(G.NaiveNFT.transfer, G.ModularNFT.transfer), burn: pct(G.NaiveNFT.burn, G.ModularNFT.burn) };
d.batch_vs_ten_tx_modular = pct(G.ModularNFT.mint10_separate, G.ModularNFT.mint10_batch);
d.per_token = { naive_sep: G.NaiveNFT.mint10_separate / 10, oz_sep: G.OZBaselineNFT.mint10_separate / 10, mod_sep: G.ModularNFT.mint10_separate / 10, mod_batch: G.ModularNFT.mint10_batch / 10 };
// break-even: extra deployment / per-mint saving (single-mint figure, and ten-token figure)
const be = (b) => { const ex = G.ModularNFT.deploy - G[b].deploy; const s = G[b].mint_single - G.ModularNFT.mint_single; return { extra_deploy: ex, saving_per_mint: s, n_star: +(ex / s).toFixed(3), min_mints: Math.ceil(ex / s) }; };
d.break_even = { vs_OZBaselineNFT: be('OZBaselineNFT'), vs_NaiveNFT: be('NaiveNFT') };
// ablation tables
const m = a.mint, f = (n, k) => m[n][k].mean;
const feats = { guard: 'G', pause: 'P', cap: 'C' }; const eff = {};
for (const uri of ['base', 'token']) for (const [fn, L] of Object.entries(feats)) for (const k of ['deploy', 'mint_fresh_recipient_steady', 'mint_same_recipient_rest']) {
  const diffs = []; for (const g of [0, 1]) for (const p of [0, 1]) for (const c of [0, 1]) { const st = { G: g, P: p, C: c }; if (st[L] === 1) continue; const off = `V_${uri}_G${st.G}P${st.P}C${st.C}`; const on = `V_${uri}_G${L === 'G' ? 1 : st.G}P${L === 'P' ? 1 : st.P}C${L === 'C' ? 1 : st.C}`; diffs.push(f(on, k) - f(off, k)); }
  (eff[uri] ||= {})[fn] ||= {}; eff[uri][fn][k] = { mean: +(diffs.reduce((x, y) => x + y, 0) / 4).toFixed(1), min: Math.min(...diffs).toFixed(1), max: Math.max(...diffs).toFixed(1) };
}
d.feature_effects = eff;
d.metadata_effect = {}; for (const k of ['deploy', 'mint_fresh_recipient_steady', 'mint_same_recipient_rest']) { const diffs = []; for (const g of [0, 1]) for (const p of [0, 1]) for (const c of [0, 1]) diffs.push(f(`V_token_G${g}P${p}C${c}`, k) - f(`V_base_G${g}P${p}C${c}`, k)); d.metadata_effect[k] = { mean: +(diffs.reduce((x, y) => x + y, 0) / 8).toFixed(1), min: Math.min(...diffs).toFixed(1), max: Math.max(...diffs).toFixed(1) }; }
d.validation = { V_base_G1P1C1_vs_ModularNFT_mint: [f('V_base_G1P1C1', 'mint_fresh_recipient_steady'), f('ModularNFT', 'mint_fresh_recipient_steady')], V_token_G0P0C0_vs_OZBaseline_mint: [f('V_token_G0P0C0', 'mint_fresh_recipient_steady'), f('OZBaselineNFT', 'mint_fresh_recipient_steady')] };
d.w10 = a.w10.ModularNFT; d.w10_all_warm = Object.fromEntries(Object.entries(a.w10).map(([k, v]) => [k, { sep: v.warm.sep.mean, loop: v.warm.loop.mean, batch: v.warm.batch.mean }]));
d.uri_len = a.uri_len;
const modSteady = m['V_base_G1P1C1'].mint_fresh_recipient_steady.mean, depDelta = G.ModularNFT.deploy - G.OZBaselineNFT.deploy;
d.break_even_by_uri_len = a.uri_len.map((u) => { const sv = u.gas - modSteady; return { len: u.len, saving_per_mint: +sv.toFixed(0), n_star: +(depDelta / sv).toFixed(2), min_mints: sv > 0 ? Math.max(1, Math.ceil(depDelta / sv)) : null }; });
d.cumulative = {}; for (const N of [1, 10, 100, 1000]) d.cumulative[N] = { Naive: G.NaiveNFT.deploy + N * m.NaiveNFT.mint_fresh_recipient_steady.mean, OZ: G.OZBaselineNFT.deploy + N * m.OZBaselineNFT.mint_fresh_recipient_steady.mean, Modular: G.ModularNFT.deploy + N * m.ModularNFT.mint_fresh_recipient_steady.mean };
d.steady_reduction_vs_OZ = pct(m.OZBaselineNFT.mint_fresh_recipient_steady.mean, m.ModularNFT.mint_fresh_recipient_steady.mean);
d.steady_reduction_vs_Naive = pct(m.NaiveNFT.mint_fresh_recipient_steady.mean, m.ModularNFT.mint_fresh_recipient_steady.mean);
const w = a.w10.ModularNFT; d.w10_pct = { cold: { batch_vs_sep: pct(w.cold.sep.mean, w.cold.batch.mean), loop_vs_sep: pct(w.cold.sep.mean, w.cold.loop.mean), batch_vs_loop: pct(w.cold.loop.mean, w.cold.batch.mean) }, warm: { batch_vs_sep: pct(w.warm.sep.mean, w.warm.batch.mean), loop_vs_sep: pct(w.warm.sep.mean, w.warm.loop.mean), batch_vs_loop: pct(w.warm.loop.mean, w.warm.batch.mean) } };
d.first_mint_penalty = { Modular: m.ModularNFT.first_mint_fresh_contract.mean - m.ModularNFT.mint_fresh_recipient_steady.mean, OZ: m.OZBaselineNFT.first_mint_fresh_contract.mean - m.OZBaselineNFT.mint_fresh_recipient_steady.mean };
fs.writeFileSync(__dirname + '/../results/derived.json', JSON.stringify(d, null, 1));
console.log(JSON.stringify(d, null, 1));
