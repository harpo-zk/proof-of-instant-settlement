# Cryptographic Settlement Binding for Confidential On-Chain State

Reference implementation and reproducibility artifacts for *Cryptographic
Settlement Binding for Confidential On-Chain State*, submitted to the IACR
Cryptology ePrint Archive. The construction binds a PSP-attested external
settlement event to a confidential two-phase on-chain commitment — a public
EVM contract can verify that a real-world settlement occurred for exactly
this operation, without the amount, the payment identifier or the
counterparties ever appearing on-chain. Pix, Brazil's instant-payment system,
is provided as a concrete application profile; the construction itself does
not depend on Pix.

This repository was previously published under the working title
*Proof-of-Instant-Settlement*. That name, and the earlier draft of the paper
it shipped with, remain retrievable from git history; this `README` and the
repository's working tree now describe the submitted V3 manuscript.

## Paper

Read the paper first:
[`docs/eprint/instant-settlement-v3.pdf`](docs/eprint/instant-settlement-v3.pdf)
([source](docs/eprint/instant-settlement-v3.tex)). Everything below
reproduces the numbers and on-chain evidence cited in its "Implementation and
Evaluation" section. The full list of contract addresses, transaction hashes
and exact commands is in
[`docs/eprint/ARTIFACTS.md`](docs/eprint/ARTIFACTS.md), which also documents
exactly how this repository's current state relates to the commit the paper
cites.

## Abstract

> A recurring problem in confidential blockchain applications is the need to
> establish a cryptographic correspondence between a private on-chain
> obligation created before an external settlement event and an externally
> observed settlement event that becomes available only later. A
> zero-knowledge proof can establish the internal consistency of the on-chain
> state, but it does not by itself establish that an external payment
> actually occurred. Conversely, an institution may authenticate a statement
> about an external payment without revealing the payment details on-chain.
>
> We present **cryptographic settlement binding**, a construction that
> connects these two states while keeping the settlement amount, payment
> identifier, and counterparty identifier confidential. The construction is
> two-phase. Before settlement, a commitment `c0` binds the agreed amount and
> operation identifier to an on-chain obligation. After settlement, a second
> commitment `c` binds the same amount and operation identifier to the
> settlement-side payment identifier. A domain-keyed tag `ν` provides a
> deterministic, single-use reference to the settlement identifier without
> revealing it, while an on-chain domain anchor `K_D` binds the tag to the
> registered domain key. A registered payment service provider (PSP) signs an
> EIP-712 receipt over the commitments rather than over plaintext payment
> data.
>
> We formalize the resulting properties under Groth16 knowledge soundness,
> Poseidon and Keccak collision resistance, and ECDSA unforgeability. The
> construction proves cryptographic consistency and authenticates that a
> registered PSP signed the accepted statement; it does **not**
> cryptographically establish that the underlying payment rail was truthful.
> That remaining correspondence is stated explicitly as an institutional
> trust assumption.
>
> A reference implementation uses Circom, Groth16 and Solidity and is
> exercised on a public EVM testnet. The settlement circuit contains 1,251
> R1CS constraints at the reported optimization level, and the reference
> `finalize` transaction costs 353,062 gas. A concrete Pix instantiation is
> provided as an application profile; the construction itself is independent
> of Pix.

## Repository Structure

- `contracts/` — `SettlementV2` (two-phase commitment escrow state machine,
  with a liveness timeout), `SettlementAttestationOracle` (PSP attestation,
  EIP-712), `SettlementVerifierV2` (Groth16 verifier, snarkjs-generated).
- `circuits/` — the settlement circuit (`settlement_verify_v2`), the
  confidential policy predicates (`compliance_range_verify`,
  `sanctions_exclusion_verify`, `kyc_inclusion_verify`), the keyed/unkeyed
  nullifier ablation pair (`pix_nullifier_verify`, `pix_payment_verify`), and
  the outputs-declared variants `settlement_verify_v2_out` and
  `kyc_inclusion_verify_out` used for the Ecne constraint analysis
  (manuscript §8.3 and Appendix "Ecne Constraint-Analysis Methodology").
- `scripts/` — deployment and on-chain reproduction scripts for the XDC
  Apothem public testnet (chainId 51), the input generator, the proving
  benchmark `scripts/bench-prove.cjs`, and `scripts/ceremony/ceremony.sh`,
  the phase-2 setup ceremony tooling.
- `tests/` — local Hardhat test suite (`node:test`); see "Tests" below for
  what it covers and what it does not.
- `build/` — build artifacts of `settlement_verify_v2` (r1cs, wasm, zkey,
  verification key, a real proof/public signals pair, and the case-6 proof
  under a different domain key) and saved logs from the real Apothem runs,
  referenced by `docs/eprint/ARTIFACTS.md`. The other circuits ship as
  sources only.
- `circuits/powersOfTau28_hez_final_15.ptau` — the Hermez powers of tau used
  by the setup (its official download locations are no longer public; the
  blake2b to check it against is in `docs/eprint/ARTIFACTS.md`).

## Reproducibility

```bash
npm ci
npx hardhat compile
npx hardhat test tests/SettlementV2.test.ts tests/SettlementAttestationOracle.test.ts tests/SettlementVerifierV2.gas.test.ts   # 21 tests
```

To check the Groth16 artifacts without any network access (the circuit
recompiles to the shipped R1CS, the `.zkey` verifies against the shipped
ptau, and a fresh proof verifies against the shipped verification key), see
"Proving and verification" in `docs/eprint/ARTIFACTS.md`.

`docs/eprint/ARTIFACTS.md` lists every on-chain address, transaction hash and
gas figure already captured, so you don't have to run anything against a live
network to check the paper's numbers — only to independently re-derive them.
It also states precisely which artifacts are unchanged since the commit the
manuscript cites, and which figures in this repository are *not* currently
asserted by the manuscript (e.g. the single-warm-run proving-time table).

## Toolchain

| Tool | Version used by this repository |
|---|---|
| circom | 2.2.3 |
| snarkjs | 0.7.6 |
| circomlibjs (input generator) | 0.1.7 |
| solc | 0.8.27 (evm target cancun, optimizer on, runs 200) |

The manuscript's §8.1 ("Reference implementation") reports Circom 2.2.1 and
snarkjs 0.7.5, the versions used to produce the artifacts cited in the V3
submission. The repository was subsequently updated to newer patch-level
toolchain releases. The current repository toolchain (Circom 2.2.3 / snarkjs
0.7.6) reproduces the specific figures the manuscript reports — the
1,251-constraint circuit, the 5/8 public/private signal counts, and the
353,062-gas `finalize` measurement — but this is a targeted reproduction of
those three figures, not a claim that every number or artifact in the
manuscript was re-derived under the newer toolchain. No cryptographic
artifact was regenerated or modified in this documentation-only sync. See
`docs/eprint/ARTIFACTS.md` for the full toolchain table and the reproduction
commands.

## Circuit

The primary circuit is `settlement_verify_v2`:

- 1,251 R1CS constraints at optimization level `-O2` (1,266 non-linear +
  1,524 linear at `-O1`).
- 5 public signals, 8 private witness values.
- 5 Poseidon gadgets, arities 3, 4, 2, 1, 2, corresponding to the two
  commitments, the settlement tag, the domain anchor, and the counterparty
  commitment.

Three auxiliary circuits ship as sources for the ablation/constraint-analysis
discussion in the paper: `pix_nullifier_verify` (537 constraints, keyed),
`pix_payment_verify` (510 constraints, unkeyed ablation), and the
outputs-declared variants used by the Ecne analysis. Exact figures and
reproduction commands are in `docs/eprint/ARTIFACTS.md`.

## Smart Contracts

- **`SettlementV2`** — two-phase commitment escrow: `lock(c0, deadline)` →
  `finalize(proof)` or `cancel(c0)` after expiry, with a liveness timeout.
- **`SettlementAttestationOracle`** — accepts an EIP-712 receipt from a
  registered PSP attesting `(c0, partyCommitment, settled, deadline)`,
  without the settled amount or the counterparty's cleartext identifier ever
  appearing in its calldata.
- **`SettlementVerifierV2`** — Groth16 verifier, generated with snarkjs from
  a single-contributor phase-2 ceremony (research-prototype ceremony, not a
  production multi-party ceremony — see the Limitations section below).

## Tests

```bash
npx hardhat test tests/SettlementV2.test.ts tests/SettlementAttestationOracle.test.ts tests/SettlementVerifierV2.gas.test.ts
```

21 tests pass (9 + 11 + 1, 0 failures), re-confirmed during this
documentation sync. They cover: `lock`/`cancel`/`Expired` transitions and
double-lock rejection; attestation acceptance, non-attestor rejection,
`settled = false` rejection, expired-receipt rejection, tag-replay rejection,
and attestor revocation; confidentiality of the calldata (neither the
settled amount nor the counterparty identifier appears in `attest()`); and
Groth16 verification gas for a real proof.

**Not covered by this suite:** the cross-instance replay experiment reported
in the manuscript's §8.4 (two independently deployed `(oracle, Settle)`
pairs, same settlement tag, replay rejected in the originating instance and
accepted independently in the other) was executed in the authors' internal
POC repository and is not currently reproduced by an automated test in this
public repository. This is deliberate — it is planned for a separate,
follow-up pull request — not a hidden gap; see
`docs/eprint/ARTIFACTS.md` for the full note.

## Experimental Results

All figures below are from the real XDC Apothem deployment (chainId 51);
full transaction hashes are in `docs/eprint/ARTIFACTS.md`.

| Operation | Gas |
|---|---|
| `lock(c0, deadline)` | 74,982 |
| `attest(receipt, signature)` | 90,913 |
| `finalize(proof)` (complete settlement) | **353,062** |
| isolated `verifyProof` call | 243,182 |

Ecne well-determinedness analysis (`--O0`, outputs declared):

| Circuit | Targets solved | Signals | Result |
|---|---|---|---|
| `settlement_verify_v2_out` | 5/5 | 4,229/4,229 | Sound |
| `kyc_inclusion_verify_out` | 1/1 | 18,230/18,248 | Sound |
| `settlement_verify_v2_out` (`--O2`) | 4/5 | 1,016/1,260 | Inconclusive (not unsound) |

The off-chain proving/verification timing table from the pre-V3 draft is not
reported by the current manuscript (its "Benchmark methodology" limitation
explains why) and is kept only as repository-level evidence in
`docs/eprint/ARTIFACTS.md`.

## XDC Apothem Deployment

| Contract | Address |
|---|---|
| `SettlementVerifierV2` (post-ceremony key) | `0x8bc6c51d8c3430c49a0accf323f99ab66bcda72d` |
| `SettlementAttestationOracle` | `0x9b44cfd2150e65292e462a964b7b4fda0dd8f41a` |
| `SettlementV2` | `0x51a7359db8a021f788beafbd55678e4fce18d304` |

Negative/acceptance cases (non-attestor signature, `settled = false`, expired
receipt, tag replay, mismatched `c0`/`partyCommitment`, wrong domain anchor)
all revert on-chain as intended; transaction hashes and gas for each case are
in `docs/eprint/ARTIFACTS.md`. The reversal and liveness-timeout paths are
also exercised on-chain there, with a flagged, unresolved gas discrepancy
between the Apothem-recorded and locally-reproduced figures for `cancel` and
`attestReversal` specifically (the manuscript excludes those two figures from
its main table for the same reason).

To redeploy and reproduce against a fresh Apothem deployment, copy
`.env.example` to `.env`, set `XDC_PRIVATE_KEY` to a funded Apothem testnet
key, then:

```bash
npx hardhat run scripts/deploy-settlement-v2.ts --network xdcTestnet
npx hardhat run scripts/apothem-negative-cases-v3.ts --network xdcTestnet
ORACLE_ADDRESS=<oracle printed by the deploy> npx hardhat run scripts/apothem-negative-cases-acceptance-v3.ts --network xdcTestnet
npx hardhat run scripts/apothem-liveness-case8.ts --network xdcTestnet
```

## Security Scope

The construction proves cryptographic consistency (Groth16 knowledge
soundness, Poseidon/Keccak collision resistance, ECDSA unforgeability) and
authenticates that a *registered* PSP signed the accepted statement. It does
**not** cryptographically establish that the underlying payment rail was
truthful — that a registered PSP's attestation corresponds to an actual,
correctly settled payment is an explicit institutional trust assumption, not
a property the on-chain verification derives. See the manuscript's "Security
Analysis" and "Privacy Analysis" sections, and its "Threat Model Matrix"
appendix, for the formal treatment.

## Limitations

The manuscript dedicates a full section to this (its "Limitations and Open
Problems" section); in summary, it names and discusses: the trusted-PSP
assumption; instance-scoped uniqueness (the single-use tag property does not
extend across independently deployed `(oracle, Settle)` pairs); domain-key
compromise and rotation; the trusted-setup ceremony (this reference
deployment used a single-contributor ceremony, not a production multi-party
one); economic finality; the absence of atomic delivery-versus-payment; its
benchmark methodology (see "Experimental Results" above); the scope of the
well-determinedness analysis; and the preliminary, non-production status of
the post-quantum audit-disclosure construction. Read the manuscript's own
section for the precise claims — this list is not a substitute for it.

## Citation

This repository accompanies a manuscript submitted to the IACR Cryptology
ePrint Archive. The ePrint identifier/URL had not been assigned at the time
of this documentation sync; it should be added here once available.

```bibtex
@misc{harpo2026settlementbinding,
  title        = {Cryptographic Settlement Binding for Confidential On-Chain State},
  author       = {Sales, Juliano Pereira and Nascimento, Marco Tulio Rocha},
  year         = {2026},
  howpublished = {IACR Cryptology ePrint Archive},
  note         = {ePrint identifier to be assigned}
}
```

## Status

This is a research prototype: validated end-to-end on a public testnet and
not run in production. The manuscript's own Limitations section states what
the evidence here does and does not establish.

## Provenance

This repository is a curated snapshot of the settlement/attestation work
from a larger internal monorepo, first published as a single snapshot commit
for the paper's reproducibility requirement; later commits update the
artifacts and the paper. It does not carry the monorepo's commit history,
which includes unrelated projects. See `docs/eprint/ARTIFACTS.md` for exactly
which commit the manuscript cites, what changed since, and why that commit
reference is still correct for every artifact-level claim.

## License

MIT — see [`LICENSE`](LICENSE).
