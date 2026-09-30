# Proof-of-Instant-Settlement

Reference implementation and reproducibility artifacts for the
Proof-of-Instant-Settlement paper: a construction that cryptographically
binds a PSP-attested instant payment (Pix, in the reference instantiation) to
a confidential on-chain commitment via a Groth16 circuit and an attestation
oracle, without ever putting the amount, payment identifiers or parties
on-chain.

Read the paper first: [`docs/eprint/instant-settlement.pdf`](docs/eprint/instant-settlement.pdf)
([source](docs/eprint/instant-settlement.tex)). Everything below reproduces
the numbers and on-chain evidence cited in its §9. The full list of
contract addresses, transaction hashes and exact commands is in
[`docs/eprint/ARTIFACTS.md`](docs/eprint/ARTIFACTS.md).

## Layout

- `contracts/` — `SettlementV2` (two-phase commitment escrow state machine,
  with a liveness timeout), `SettlementAttestationOracle` (PSP attestation,
  EIP-712), `SettlementVerifierV2` (Groth16 verifier, snarkjs-generated).
- `circuits/` — the settlement circuit (`settlement_verify_v2`), the
  confidential policy predicates (`compliance_range_verify`,
  `sanctions_exclusion_verify`, `kyc_inclusion_verify`), the keyed/unkeyed
  nullifier ablation pair (`pix_nullifier_verify`, `pix_payment_verify`), and
  the outputs-declared variants `settlement_verify_v2_out` and
  `kyc_inclusion_verify_out` used for the Ecne constraint analysis in §9.3 of
  the paper.
- `scripts/` — deployment and on-chain reproduction scripts for the XDC
  Apothem public testnet (chainId 51), the input generator, the proving
  benchmark `scripts/bench-prove.cjs` (§9.2 of the paper), and
  `scripts/ceremony/ceremony.sh`, the phase-2 setup ceremony tooling.
- `tests/` — local Hardhat test suite (`node:test`).
- `build/` — build artifacts of `settlement_verify_v2` (r1cs, wasm, zkey,
  verification key, a real proof/public signals pair, and the case-6 proof
  under a different domain key) and saved logs from the real Apothem runs,
  referenced by `docs/eprint/ARTIFACTS.md`. The other circuits ship as sources
  only.
- `circuits/powersOfTau28_hez_final_15.ptau` — the Hermez powers of tau used
  by the setup (its official download locations are no longer public; the
  blake2b to check it against is in `docs/eprint/ARTIFACTS.md`).

## Reproducing

```bash
npm ci
npx hardhat compile
npx hardhat test tests/SettlementV2.test.ts tests/SettlementAttestationOracle.test.ts tests/SettlementVerifierV2.gas.test.ts   # 21 tests
```

To check the Groth16 artifacts without any network access (the circuit
recompiles to the shipped R1CS, the `.zkey` verifies against the shipped
ptau, and a fresh proof verifies against the shipped verification key), follow
§9.2 of `docs/eprint/ARTIFACTS.md`; it needs circom 2.2.3 on the `PATH`.

To reproduce the on-chain evidence against a fresh deployment on XDC Apothem,
copy `.env.example` to `.env`, set `XDC_PRIVATE_KEY` to a funded Apothem
testnet key, then:

```bash
npx hardhat run scripts/deploy-settlement-v2.ts --network xdcTestnet
npx hardhat run scripts/apothem-negative-cases-v3.ts --network xdcTestnet
ORACLE_ADDRESS=<oracle printed by the deploy> npx hardhat run scripts/apothem-negative-cases-acceptance-v3.ts --network xdcTestnet
npx hardhat run scripts/apothem-liveness-case8.ts --network xdcTestnet
```

`docs/eprint/ARTIFACTS.md` lists every resulting address, transaction hash
and gas figure already captured, so you don't have to run these to check the
paper's numbers — only to independently re-derive them.

## Status

This is a research prototype: validated end-to-end on a public testnet and
not run in production. The paper's Availability section and the *Scope and
limitations* paragraph at the end of its Introduction state what the evidence
here does and does not establish.

## Provenance

This repository is a curated snapshot of the settlement/attestation work
from a larger internal monorepo, first published as a single snapshot commit
for the paper's reproducibility requirement; later commits update the
artifacts and the paper. It does not carry the monorepo's commit history,
which includes unrelated projects. The paper cites commit `0db97bf`, and its
reproducibility claims refer to that commit.

## License

MIT — see [`LICENSE`](LICENSE).
