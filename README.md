# ModularNFT: gas and security study of ERC-721 contracts

Code, test scripts and raw results for the project **"Enhancing the Efficiency and Security of NFT Smart Contracts: An Analytical Study of the NFTY Framework"** (DSE2170 Project Based Learning, Department of Data Science and Engineering, Manipal University Jaipur).

Authors: Abhinav Aryan, Piyush Priyadarshi, Shankhodeep Chanda, Shreya Aigal. Guide: Dr. Sanjeev Kumar Ojha.

This repository compares three ERC-721 contracts on a local Ethereum Virtual Machine (EVM):

| Contract | What it is |
|---|---|
| `NaiveNFT` | Hand-written baseline with **deliberate defects** (anyone can mint, anyone can burn, no supply cap, per-token URI on-chain). **Never deploy it.** |
| `OZBaselineNFT` | A typical OpenZeppelin build: `ERC721`, `ERC721URIStorage`, `ERC721Burnable`, `Ownable`. |
| `ModularNFT` | The proposed design: OpenZeppelin base plus an immutable supply cap, a shared base URI (no per-token URI storage), batch minting, pausable minting, a reentrancy guard and an authorization-checked burn. |

## Results (local Hardhat EVM, Solidity 0.8.26, optimizer 200 runs, OpenZeppelin 5.0.2)

Gas is the `gasUsed` value from each transaction receipt (includes the 21,000 gas base cost).

| Operation | NaiveNFT | OZBaselineNFT | ModularNFT |
|---|---:|---:|---:|
| Deployment | 723,735 | 1,276,590 | 1,366,715 |
| Mint, 1 token (mean of 20) | 165,156 | 171,661 | **82,012** |
| Mint 10 tokens (10 transactions) | 1,489,300 | 1,554,350 | 657,680 |
| Mint 10 tokens (1 batch transaction) | n/a | n/a | **326,468** |
| Transfer (mean of 10) | 39,421 | 39,655 | 39,744 |
| Burn by owner (mean of 10) | 45,414 | 29,322 | 29,340 |

Compared with `OZBaselineNFT`, `ModularNFT` uses 52.2% less gas per single mint and 79.0% less for ten tokens in one batch transaction. Transfer and burn are essentially unchanged and deployment costs 7.1% more.

![Gas comparison](docs/gas_comparison.png)

Security behavior tests:

| Test | NaiveNFT | OZBaselineNFT | ModularNFT |
|---|---|---|---|
| Unauthorized mint | Succeeded | Blocked | Blocked |
| Burn another user's token | Succeeded | Blocked | Blocked |
| Supply cap (cap 5, 6 attempts) | None | None | Enforced |
| Mint while paused | n/a | n/a | Blocked |
| Reentrant mint from receiver callback | n/a | Accepted | Blocked |
| Slither high / medium findings | 0 / 0 | 0 / 0 | 0 / 0 |

Slither 0.11.6 did not flag the open mint and burn in `NaiveNFT` (access-control design flaws are not patterns its detectors recognize); the behavior tests did. Raw Slither output is in [`results/`](results/).

## Design: what is reused and what is new

![UML class diagram](docs/uml_class_diagram.png)

Grey classes come from OpenZeppelin; green is code written for this study. More diagrams: [`docs/uml_mint_flow.png`](docs/uml_mint_flow.png) (flow of `mint()`) and [`docs/uml_reused_vs_new.png`](docs/uml_reused_vs_new.png) (the three contracts side by side). Graphviz sources (`.dot`) are included.

## Run it locally

Requires Node.js 18 or newer (tested on Node 22).

```bash
npm install                   # exact versions are pinned
node scripts/compile.js       # compiles the contracts in contracts/
node scripts/experiment.js    # runs gas + security tests, writes results.json
```

Expected: `ModularNFT` single mint = 82,012 gas and 10-token batch = 326,468 gas.

Optional static analysis:

```bash
pip install slither-analyzer
solc-select install 0.8.26 && solc-select use 0.8.26
slither contracts/ModularNFT.sol --solc-remaps "@openzeppelin=node_modules/@openzeppelin" --filter-paths node_modules
```

## Run it in Remix IDE

Use the files in [`remix/`](remix/) (OpenZeppelin imports are pinned to 5.0.2, otherwise Remix pulls the latest version, which does not compile with these settings).

1. Open https://remix.ethereum.org and upload the `.sol` files from `remix/`.
2. Compiler 0.8.26, enable optimization with 200 runs, compile.
3. Deploy & Run: environment **Remix VM**. Deploy `ModularNFT` with name `ModularNFT`, symbol `MOD`, base URI `ipfs://bafyexample/`, max supply `3`, and your first account as owner.
4. Call `mint` (about 82,000 gas), then call it again until the fourth mint reverts with `MaxSupplyReached`. Try `mint` from a non-owner account (reverts) and after `pause()` (reverts).

Gas shown in Remix may differ slightly from the table above because the Remix VM and Hardhat can use different protocol versions.

## Limitations (please read)

- Measured on a **local EVM only**. Confirmation time, network fees and Layer-2 deployment were not evaluated.
- The comparison covers contracts written for this study. **NFTY-generated contracts were not measured**, so these results say nothing about NFTY itself.
- `NaiveNFT` is an illustrative baseline with deliberate defects. The test set is small and Mythril was not run.
- Not audited. Do not deploy to mainnet.
- ERC-721 only; ERC-1155 is future work.

## How this was produced

The contracts, test scripts and diagrams were developed with the assistance of an AI model (Claude, by Anthropic). Every number above is produced by the scripts in this repository and can be reproduced with the commands in "Run it locally".

## Layout

```
contracts/    Solidity sources (Hardhat / solc-js build)
remix/        Same contracts with pinned imports for Remix IDE
scripts/      compile.js, experiment.js
results/      gas_results.csv and raw Slither output
results.json  Output of scripts/experiment.js
docs/         UML diagrams (PNG + Graphviz source) and gas chart
```

## License

MIT, see [LICENSE](LICENSE).
