# Proof-of-Instant-Settlement

Reference implementation and reproducibility artifacts for the
Proof-of-Instant-Settlement eprint: a construction that cryptographically
binds a PSP-attested instant payment (Pix, in the reference instantiation) to
a confidential on-chain commitment via a Groth16 circuit and an attestation
oracle, without ever putting the amount, payment identifiers or parties
on-chain.

Read the paper first: [`docs/eprint/instant-settlement.pdf`](docs/eprint/instant-settlement.pdf)
([source](docs/eprint/instant-settlement.tex)). Everything below reproduces
the numbers and on-chain evidence cited in its §9 — the full list of
contract addresses, transaction hashes and exact commands is
[`docs/eprint/ARTIFACTS.md`](docs/eprint/ARTIFACTS.md).

## Layout

- `contracts/` — `SettlementV2` (two-phase commitment escrow state machine,
  with a liveness timeout), `SettlementAttestationOracle` (PSP attestation,
  EIP-712), `SettlementVerifierV2` (Groth16 verifier, snarkjs-generated).
- `circuits/` — the settlement circuit (`settlement_verify_v2`, plus an
  outputs-declared variant used for the Ecne constraint analysis in §9.3 of
  the paper), the confidential policy predicates (`compliance_range_verify`,
  `sanctions_exclusion_verify`, `kyc_inclusion_verify`), and the keyed/unkeyed
  nullifier ablation pair (`pix_nullifier_verify`, `pix_payment_verify`).
- `scripts/` — deployment and on-chain reproduction scripts for the XDC
  Apothem public testnet (chainId 51).
- `tests/` — local Hardhat test suite (`node:test`).
- `build/` — circuit build artifacts (r1cs, wasm, zkey, a real proof/public
  signals pair) and saved logs from the real Apothem runs, referenced by
  `docs/eprint/ARTIFACTS.md`.

## Reproducing

```bash
npm install
npx hardhat compile
npx hardhat test tests/SettlementV2.test.ts tests/SettlementAttestationOracle.test.ts tests/SettlementVerifierV2.gas.test.ts
```

To reproduce the on-chain evidence against a fresh deployment on XDC Apothem,
copy `.env.example` to `.env`, set `XDC_PRIVATE_KEY` to a funded Apothem
testnet key, then:

```bash
npx hardhat run scripts/deploy-settlement-v2.ts --network xdcTestnet
npx hardhat run scripts/apothem-negative-cases-v3.ts --network xdcTestnet
npx hardhat run scripts/apothem-liveness-case8.ts --network xdcTestnet
```

`docs/eprint/ARTIFACTS.md` lists every resulting address, transaction hash
and gas figure already captured, so you don't have to run these to check the
paper's numbers — only to independently re-derive them.

## Status

This is a research prototype: validated end-to-end on a public testnet, not
run in production, and maintained by a single maintainer. The paper's
Availability and Honesty Statement, and the claim-boundary box after its
abstract, state precisely what is and is not established by the evidence
here.

## Provenance

This repository is a curated snapshot of the settlement/attestation work
from a larger internal monorepo, published as a single initial commit
specifically for this eprint's reproducibility requirement — it does not
carry that monorepo's full commit history, which includes unrelated
projects.

## License

MIT — see [`LICENSE`](LICENSE).
