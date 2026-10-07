# Artifact manifest — Cryptographic Settlement Binding for Confidential On-Chain State

Every number in the manuscript's "Implementation and Evaluation" section is
reproducible from this repository with the commands below, and every on-chain
claim points at a transaction a reader can look up.

## Paper snapshot vs. current repository state

This manifest documents the artifacts cited by **V3** of the manuscript,
*Cryptographic Settlement Binding for Confidential On-Chain State*
(`docs/eprint/instant-settlement-v3.tex`/`.pdf`), which supersedes the
pre-V3 draft previously shipped from this repository under the working
title *Proof-of-Instant-Settlement*.

- **Artifacts are unchanged.** `git diff --stat 0db97bf..HEAD` shows zero
  changes to `contracts/`, `circuits/`, `build/`, `scripts/` or `tests/`
  between the commit the manuscript cites and the current repository state —
  only the paper, `README.md` and this manifest were revised. Every
  constraint count, gas figure and deployed address below is still exactly
  what commit `0db97bf91ddc5be475e3d4175a62e241eb80df79` produced.
- **The proving/verification timing table below (§"Proving and
  verification") is not cited by V3.** The manuscript's own "Benchmark
  methodology" limitation states that an earlier single-warm-run timing
  pass was excluded because it is not a statistically meaningful benchmark
  (a proper $N\geq30$ run is left as future work). The table is kept here
  as repository-level historical evidence, not as a number the current
  manuscript reports.
- **The `cancel`/`attestReversal` gas figures are not in V3's on-chain-cost
  table**, for the same reason the manuscript gives: a local-network
  reproduction (28,115 / 57,541 gas, re-confirmed in this sync at ~57,553)
  does not exactly match the Apothem-recorded figures below (30,259 /
  63,529), and the discrepancy has not been attributed to a specific cause.
  The reversal and liveness-timeout path tables below remain valid
  repository-level reproducibility evidence; they are just not asserted as
  manuscript numbers.

## Toolchain

| Tool | Version |
|---|---|
| circom | 2.2.3 |
| snarkjs | 0.7.6 |
| circomlibjs (input generator) | 0.1.7 |
| solc | 0.8.27 (evm target cancun, optimizer on, runs 200) |
| Julia (for Ecne) | 1.7.2 |
| Ecne | `github.com/franklynwang/EcneProject` @ `2593535` |
| CPU (all timings) | 11th Gen Intel Core i5-1135G7, containerized |

**Toolchain reproducibility note.** The manuscript (§8.1) reports Circom
2.2.1 and snarkjs 0.7.5, the versions used to produce the artifacts cited in
the V3 submission. The repository was subsequently updated to newer
patch-level toolchain releases (Circom 2.2.3, snarkjs 0.7.6, as pinned
above and in `package-lock.json`). The current repository toolchain
reproduces the reported 1,251-constraint circuit, the 5/8 public/private
signal counts, and the 353,062-gas `finalize` measurement — these specific,
named figures were independently re-checked under Circom 2.2.3 / snarkjs
0.7.6 and found unchanged. This is a targeted reproduction of those figures,
not a claim that every result in the manuscript was re-derived under the
newer toolchain, and it is a patch-level toolchain update, not a downgrade
or a re-derivation of the construction; no circuit, contract or proving
artifact was regenerated or modified in this documentation-only sync.

## Deployment — XDC Apothem, chainId 51

Deployer / attestor / registry owner: `0xbE3cc4c4eF02F6851440823E5DeCB62f8Df0eE60`
(same key for all three roles in this prototype — see the reading note in
§8.4, "End-to-end deployment", of the manuscript).

**Post-ceremony deployment (2026-09-22).** The verifier below was regenerated
after a phase-2 setup ceremony for `settlement_verify_v2` (one participant
contribution + beacon; `snarkjs zkey verify` → `ZKey Ok!`), so that
`vk_delta_2 ≠ vk_gamma_2`. The earlier deployment (deployer
`0x7c20dcc2…80A49`; `SettlementVerifierV2` `0x03E090aa…D430A`,
`SettlementAttestationOracle` `0xDd788A76…07fC6`, `SettlementV2`
`0x067E79Aa…16849`) used a verifier exported directly from `groth16 setup` with
**no contribution, δ equal to the generator**, under which anyone can forge an
accepted proof. Those addresses are kept here only as a historical record and
**must not be cited as evidence** for any property in the manuscript
(Assumption S1). The public signals and the `input.json` are unchanged, so
`c0`, `c`, `tag`, `K` and `partyCommitment` are identical across both
deployments.

| Contract | Address |
|---|---|
| `SettlementVerifierV2` (Groth16, 5 public signals; post-ceremony key) | `0x8bc6c51d8c3430c49a0accf323f99ab66bcda72d` |
| `SettlementAttestationOracle` (EIP-712 version `"3"`, receipt carries `partyCommitment`, 72 h dispute window) | `0x9b44cfd2150e65292e462a964b7b4fda0dd8f41a` |
| `SettlementV2` (cross-checks `c0` **and** `partyCommitment` via `bindingOf`; `lock`/`cancel` liveness timeout) | `0x51a7359db8a021f788beafbd55678e4fce18d304` |

### Public signals of the settled operation

```
c0              0x0806d77914ff06f13d894509230087498b7124d361ddf0d7b73bfa23a4111f1c
c               0x14c060d623b9c922e4d89f7dccd9896d1aba49858c60ce353d0545d57912277e
tag (nu)        0x0e139e27d64cac607ce1837c83512e990b5f3b6b353e56a11e3c6150d610f127
K (domain key)  0x249b95f4a530e514abdd4e1c6c3b7d4c878d3ec8943ef72193544831947d9a15
partyCommitment 0x17c84d688c8a39c14bf1ba585355e115c70689550727378dfed8186e1dc7262a
```

No amount, no E2EID, no charge identifier and no debtor identifier appears in any
of the transactions below.

### Settlement path (accepted)

| Step | Transaction | Gas |
|---|---|---|
| `setAttestor` (register the PSP key) | `0x963cde21be325f2041e2f53ae79edca9ad89fb73fdef5f719bec60bf98508a03` | 49,219 |
| `lock(c0, deadline)` — escrow locks on the agreed terms, before any payment, with a liveness deadline | `0xaa0c778c4a2d8a362b90a4fab87be9137b2849aaff7a17c5687b31c44b32781f` | 74,982 |
| `attest(receipt, signature)` — PSP receipt over `(c0, partyCommitment)` | `0x6dac73604b481e1b8c8094bf466d2f1c60af637870bef84ffcb91a9e76928d9d` | 90,913 |
| `finalize(proof)` — **complete settlement call** | `0xf4081d54d6712fc6e02881c65cf762d5aaf9b4123c834513472b41924bef7529` | **353,062** |

Run log: `build/deploy-settlement-v2-51.txt`. Operation state after `finalize`:
`Finalized`, tag consumed, attested, not yet releasable (72 h window).

The complete settlement transaction costs 353,062 gas (the pre-ceremony
artifact measured 353,315 for the same operation; the difference is
proof-dependent calldata pricing, not a logic change). An isolated call to the
verifier alone costs 243,182 gas (`eth_estimateGas` of `verifyProof` with the
same proof and public signals against `0x8bc6c51d…`, no transaction retained;
see "Proving and verification" below for why this is an upper bound on its share of the complete
call, not a subtractable component); the remainder
of the complete call is the oracle cross-check (`isAttested`,
`bindingOf(tag) == keccak256(c0, partyCommitment)`), the domain-anchor check,
the tag consumption and the state transition.

### Setup-independence control (read-only calls, 2026-09-22)

To show that the post-ceremony and pre-ceremony deployments are genuinely
distinct verification keys — and not the same key under a new address — the
main proof was regenerated under the post-ceremony `.zkey` (same `input.json`,
hence identical public signals) and both proofs were submitted to both deployed
verifiers via `eth_call` (`verifyProof`, no transaction, no gas):

| Deployed verifier | Proof | Result |
|---|---|---|
| post-ceremony `0x8bc6c51d…da72d` | post-ceremony proof | `true` |
| post-ceremony `0x8bc6c51d…da72d` | pre-ceremony proof (δ = generator setup) | **`false`** |
| pre-ceremony `0x03e090aa…d430a` | pre-ceremony proof | `true` |
| pre-ceremony `0x03e090aa…d430a` | post-ceremony proof | `false` |

Each key accepts only proofs produced under its own setup. The row that matters
is the second: a proof from the setup with no contribution is rejected by the
verifier now cited as evidence. Reproduce with the `verifyProof` ABI in
`artifacts/contracts/SettlementVerifierV2.sol/` and the pre-ceremony proof from
git history (`git show 7fd9f5c:build/circuits/settlement_verify_v2/proof.json`).

### Acceptance rules (all rejected on-chain)

Each was sent with explicit gas so that it would be **mined and revert**, leaving
a verifiable hash rather than being stopped by client-side simulation. Cases 1–4
(acceptance rules) were re-run on 2026-09-22 against the post-ceremony happy-path
oracle `0x9b44cfd2…` (`scripts/apothem-negative-cases-acceptance-v3.ts`, log
`build/apothem-negative-cases-acceptance-v3-51.txt`; case 4 replays the very tag
attested in the happy path above). Cases 5–8 were re-run the same day against the
post-ceremony verifier bytecode (`scripts/apothem-negative-cases-v3.ts`;
one `SettlementVerifierV2` shared across the cases, `0x1f4cf5585deec847eb00ddfef1ccd766dde43eb6`,
with a fresh oracle + `SettlementV2` per case because the oracle refuses to
re-attest a tag). Run log: `build/apothem-negative-cases-v3-51.txt`.

| Case | Transaction | Result | Gas |
|---|---|---|---|
| Receipt signed by a non-attestor | `0xd9205162a70c8b9577aa41bb94a8df89e494ec8cac62f53c34deab87b26936f2` | reverted | 37,922 |
| `settled = false` | `0xbfbbcec38895cd96cca845f09efff3f3a1760b6534ddeb010a2b5f33fed46cd4` | reverted | 28,435 |
| Expired receipt (`deadline` in the past) | `0x16543606cb2ef5558d25fadc7a122f273289f336d8ca7701f2353a5eedcc9642` | reverted | 28,679 |
| Replay of the tag attested in the happy path | `0x6f00ce0b3eac5ac73038955e609fae1352fbb21e42ffc5e670e1e6812e2e7db6` | reverted | 36,468 |
| **5a — receipt's `c0` diverges from the one the proof opens** (value-consistency mechanism, §4.1) | `0x8340874357a1178d1fe5eba683bd2ea3c563546b4c8e66a46fa0809789d48df8` | reverted | 65,057 |
| **5b — receipt's `partyCommitment` diverges from the one the proof opens** | `0x85adc5e14a4380ce042bd48516bbf316b92016a072d63d34baca7b24e1b82173` | reverted | 65,057 |
| **6 — proof's domain anchor `K` diverges from the registered one** | `0xc856f56842702f8c9445bfb479de3ca75de3189d86d32396021dac38c1e2e34c` | reverted | 54,455 |

Cases 5a, 5b and 6 revert at the binding / anchor checks in `finalize`, which
run **before** `verifyProof`, so their gas is independent of the verification
key; the small change on 5a/5b versus the pre-ceremony run (65,249) is
proof-calldata pricing, and case 6 is byte-identical.

### Reversal path (case 7 — short-window instance, 600 s)

Deployed only to make the reversal exercisable on-chain in minutes; the reference
deployment above keeps the 72 h window.

| Step | Transaction | Gas |
|---|---|---|
| `finalize` (happy path, short-window instance) | `0x91de456a05b24d8343915f0d3e259e7b309ff22d31e2fb539e955ee45cf0932c` | 353,062 |
| `attestReversal` within the window | `0xc09942eccd60cddf24839c96464224af23129571b3cedd5ce9eab0871f5d5643` | 63,529 |
| `isReleasable` after reversal | `false` (confirmed) | — |
| Control: 660 s after the reversal, `isIrrevocable(tag)` is still `false` — reversal blocks release **permanently**, not just until the window closes | confirmed (re-confirmed 2026-09-22 on the post-ceremony re-run) | — |

### Liveness timeout path (case 8)

Isolated deployment (`scripts/apothem-liveness-case8.ts`), same main proof, so
that this evidence didn't require repeating case 7's 660 s real wait.
`SettlementV2` for this case: `0x5add4a3485ac2c4dc30cdf87b98f8e097757c30a` (re-run
2026-09-22 with the post-ceremony verifier; log `build/apothem-liveness-case8-51.txt`).

| Step | Transaction | Result | Gas |
|---|---|---|---|
| `lock(c0, deadline=+60s)` | `0x1818bdb0b93849b822eabd7b5f126d50e6b43365eacebfe7bbeb189e7d65f273` | succeeded | 74,982 |
| `cancel(c0)` before the `lock` deadline | `0x91763209061c6934bc44346001b0c2f24ac20121fff0d75d396e59b265fb5c5e` | reverted (`"prazo ainda nao expirou"`) | 26,202 |
| `cancel(c0)` after the `lock` deadline (60 s, real wait) | `0x82af79c0e339fb372f90dc55814cd2ba1f066690d450cbb3395705192c875df6` | succeeded, `state -> Expired` | 30,259 |
| `isExpired(c0)` after `cancel` | `true` (confirmed) | — | — |
| `finalize(proof)` with a genuinely valid proof, submitted after `cancel` | `0x853bdd1a2d2deabbf7f03e648d8674ce756219da99b05bad99d53ecc3bb5c323` | reverted (`"operacao nao travada"`) | 52,209 |

The `finalize`-after-`cancel` revert fires at the `Locked` state check, before
any verifier call; the change from the pre-ceremony 52,401 is proof-calldata
pricing only.

Reproduce case 8 alone with:

```bash
node node_modules/hardhat/dist/src/cli.js run scripts/apothem-liveness-case8.ts --network xdcTestnet
```

`cancel` and `finalize` are exercised as the mutually exclusive pair they are:
once `cancel` succeeds, a valid proof arriving late cannot re-open the
operation, on-chain — not merely asserted in the contract's NatSpec.

Reproduce with:

```bash
node node_modules/hardhat/dist/src/cli.js run scripts/deploy-settlement-v2.ts --network xdcTestnet
node node_modules/hardhat/dist/src/cli.js run scripts/apothem-negative-cases-v3.ts --network xdcTestnet
# cases 1-4, against the oracle printed by the deploy above (your key is its attestor):
ORACLE_ADDRESS=<oracle> node node_modules/hardhat/dist/src/cli.js run scripts/apothem-negative-cases-acceptance-v3.ts --network xdcTestnet
```

Case 1 signs its forged receipt with the fixed, publicly known throwaway key
`0x1111…1111` (it only needs to be a key that is not a registered attestor);
the transaction itself is sent and paid by your key.

## Circuit sizes (manuscript §8.1, "Reference implementation")

```bash
circom circuits/settlement_verify_v2.circom --r1cs --O2 -o /tmp/c -l node_modules
circom circuits/settlement_verify_v2.circom --r1cs --O1 -o /tmp/c -l node_modules
circom circuits/pix_nullifier_verify.circom --r1cs --O2 -o /tmp/c -l node_modules
circom circuits/pix_payment_verify.circom   --r1cs --O2 -o /tmp/c -l node_modules
```

| Circuit | `--O2` | `--O1` (non-linear + linear) | Public / private |
|---|---|---|---|
| `settlement_verify_v2` (primary) | 1,251 | 1,266 + 1,524 | 5 / 8 |
| `pix_nullifier_verify` (keyed) | 537 | 543 + 710 | 2 / 5 |
| `pix_payment_verify` (unkeyed, ablation) | 510 | 516 + 635 | 2 / 4 |

These are three distinct circuits, kept distinct in this table specifically so
none of the figures is misread as three measurements of one circuit.

## Proving and verification (repository-level artifact detail — not cited by V3; see "Paper snapshot vs. current repository state" above)

Check the shipped artifacts without re-running the ceremony (tested on
2026-09-29 in a clean clone after `npm ci`, with circom 2.2.3; `W` is a scratch
directory, so nothing under `build/` is overwritten):

```bash
OUT=build/circuits/settlement_verify_v2
PTAU=circuits/powersOfTau28_hez_final_15.ptau
W=$(mktemp -d)
circom circuits/settlement_verify_v2.circom --r1cs --wasm --sym --O2 -o $W -l node_modules
cmp $W/settlement_verify_v2.r1cs $OUT/settlement_verify_v2.r1cs && echo "r1cs identical"
npx snarkjs zkey verify $OUT/settlement_verify_v2.r1cs $PTAU $OUT/settlement_verify_v2.zkey     # -> ZKey Ok!
node scripts/gen-settlement-v2-input.cjs $W/input.json                                          # same as $OUT/input.json
npx snarkjs wtns calculate $W/settlement_verify_v2_js/settlement_verify_v2.wasm $W/input.json $W/witness.wtns
npx snarkjs groth16 prove $OUT/settlement_verify_v2.zkey $W/witness.wtns $W/proof.json $W/public.json
npx snarkjs groth16 verify $OUT/settlement_verify_v2.vkey.json $W/public.json $W/proof.json     # -> OK!
npx snarkjs zkey export solidityverifier $OUT/settlement_verify_v2.zkey $W/Verifier.sol
diff $W/Verifier.sol contracts/SettlementVerifierV2.sol    # only the contract name differs
```

`$W/public.json` equals the shipped `public.json` (the signals are
deterministic in `input.json`); the proof itself differs, as Groth16 proofs are
randomized.

How the ceremony was run (`scripts/ceremony/ceremony.sh` wraps these steps and
reads the snarkjs command from `SNARKJS`, e.g. `SNARKJS="npx snarkjs"`). A new
run produces a different `.zkey`, because the entropy is fresh; the shipped one
is the one transcribed below:

```bash
npx snarkjs groth16 setup $OUT/settlement_verify_v2.r1cs $PTAU $W/sv2_0000.zkey
npx snarkjs zkey contribute $W/sv2_0000.zkey $W/sv2_0001.zkey --name="<contributor>" -e="<local entropy, then discarded>"
npx snarkjs zkey beacon $W/sv2_0001.zkey $W/sv2_final.zkey <beaconHex> 10 --name="beacon-final"
```

`circuits/powersOfTau28_hez_final_15.ptau` is the Hermez powers-of-tau file
for circuits of up to 2^15 constraints. It is shipped in this repository
because both published download locations
(`storage.googleapis.com/zkevm/ptau/…` and the legacy
`hermez.s3-eu-west-1.amazonaws.com/…`) returned HTTP 403 on 2026-09-29.
Check it against the blake2b hash published in the snarkjs README:

```
982372c867d229c236091f767e703253249a9b432c1710b4f326306bfa2428a17b06240359606cfe4d580b10a5a1f63fbed499527069c18ae17060472969ae6e
```

The reference `SettlementVerifierV2.sol` in this repository was generated from
the single-contributor phase-2 ceremony transcribed below (not an MPC
ceremony); its verification key is therefore specific to this artifact set, not
portable to a setup run elsewhere, even for the bit-identical circuit. A
`groth16 setup` followed directly by `export solidityverifier`, with no
`contribute`/`beacon`, is exactly what produced the superseded δ = generator
artifact; do not reproduce the verifier that way.

### Ceremony transcript (2026-09-22)

Output of `snarkjs zkey verify` on the published `.zkey`:

```
Circuit hash:
  d7199e36 98c92892 d8578c7d 12d493bd 0f1e2111 ad426c19 a8cdbd25 5d2ad76e
  3d6e59c8 7122aed5 f837faf1 d02479b2 98bfe5c3 1fa11c6f bed42dbd ca61264e
contribution #1 mtrn87-2026-09-22:
  0ff67529 ae2b6552 3f86f896 136a2a2c 1ceb26d1 9a78803c 26d4432e b11ded5b
  9c3722c9 d27cf4e8 c26f8942 18fa2657 c92f5d7e d65d3bc4 4ccacccf 8f75a11d
contribution #2 beacon-final:
  07857d03 4fca3279 eac9510d 8ed06dd7 0141477b 4281c0c7 9fad63a2 d1cb8c50
  7f853826 c92794ac 9e3ff6c6 cd1d817c a904720e 38e60d0c d07fee77 218dc702
  Beacon generator: 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20
  Beacon iterations Exp: 10
ZKey Ok!
```

The beacon value is a fixed placeholder, not public verifiable randomness
(Assumption S1 of the manuscript). The contributor's entropy was discarded.
`SettlementVerifierV2.sol` was regenerated from this `.zkey`
(`vk_delta_2 ≠ vk_gamma_2`), and `0x1f4cf5585deec847eb00ddfef1ccd766dde43eb6`
(negative cases) and `0x8bc6c51d8c3430c49a0accf323f99ab66bcda72d` (happy path)
are two deployments of that same bytecode.

Timings below are **single warm runs** on the stated hardware, not a median
over repeated trials — see the manuscript's "Benchmark methodology" limitation
for why this table is not cited in the current paper, and for the one
`N=30` dispersion measurement we did run (on a separate, uncontrolled
machine, not usable as a substitute for these figures). A same-hardware
`N>=30` re-run is listed as future work, not reported here as if already done.

| Circuit | Prove | Verify (off-chain) |
|---|---|---|
| `settlement_verify_v2` | 151.2 ms | 13.6 ms |
| `pix_nullifier_verify` | 110.5 ms | 14.0 ms |
| `pix_payment_verify` (ablation) | 130.1 ms | 14.7 ms |

## ZK-circuit constraint analysis — Ecne (manuscript §8.3 and Appendix "Ecne Constraint-Analysis Methodology")

**Read this before citing the verification result.** The verdict Ecne prints is
only meaningful when the circuit has public *outputs*: the tool compares how many
target variables it determined against the number of targets, and the targets are
the R1CS public outputs. A circuit written as `signal input c; ...; c === h.out;`
compiles to `nPubOut = 0`, so the comparison is `0 == 0` and the verdict is
**vacuous**. This is a pitfall we caught in our own circuits by reading the Ecne
source, not a property of any external prior publication:

```bash
for c in pix_payment_verify pix_nullifier_verify compliance_range_verify sanctions_exclusion_verify; do
  snarkjs r1cs info build/circuits/$c/$c.r1cs | grep "of Outputs"   # -> 0
done
```

To obtain a meaningful result, declare the derived public signals as
`signal output` and analyse the **unoptimized** (`--O0`) system — the `--O2`
optimizer folds the linear structure Ecne's symbolic solver depends on. The
analysed files are `circuits/settlement_verify_v2_out.circom` and
`circuits/kyc_inclusion_verify_out.circom`: same constraint semantics as the
originals, derived signals declared as outputs (`<==` instead of `===`), no
`public` list. The `--O0` build directories below are not committed; the
commands regenerate them.

```bash
circom circuits/settlement_verify_v2_out.circom --r1cs --sym --O0 -o build/circuits/sv2_out_O0 -l node_modules
circom circuits/kyc_inclusion_verify_out.circom --r1cs --sym --O0 -o build/circuits/kyc_out_O0  -l node_modules

export JULIA_DEPOT_PATH=/tmp/julia-depot-17
julia --project=EcneProject EcneProject/src/Ecne.jl \
  --r1cs build/circuits/sv2_out_O0/settlement_verify_v2_out.r1cs \
  --name sv2_O0 --sym build/circuits/sv2_out_O0/settlement_verify_v2_out.sym
```

| Circuit | Outputs declared | Opt | Targets solved | Signals solved | Verdict |
|---|---|---|---|---|---|
| `settlement_verify_v2_out` | yes | `--O0` | **5 / 5** | 4,229 / 4,229 | sound, no trusted functions |
| `kyc_inclusion_verify_out` | yes | `--O0` | **1 / 1** | 18,230 / 18,248 | sound, no trusted functions |
| `settlement_verify_v2_out` | yes | `--O2` | 4 / 5 | 1,016 / 1,260 | inconclusive |

`kyc_inclusion_verify_out` keeps `kycRoot` as a public **input**: it is the
on-chain policy anchor, not a value derived from the witness, so declaring it as
an output would be wrong. The KYC circuit's target is solved (1/1), so none of
the 18 undetermined signals is a target — that follows from the count, not a
guess; what those 18 signals *are* is not yet identified against the `.sym`
file (open item, listed as future work rather than asserted).

## Test suites

```bash
npx hardhat test tests/SettlementV2.test.ts tests/SettlementAttestationOracle.test.ts tests/SettlementVerifierV2.gas.test.ts
```

21 tests pass (9 + 11 + 1, 0 failures; run on 2026-09-29 in a clean clone
after `npm ci`, and re-confirmed unchanged on 2026-10-07 as part of the V3
documentation sync). `tests/SettlementAttestationOracle.test.ts`
includes a test that checks neither the settled amount **nor** the
counterparty's cleartext identifier appears in `attest`'s calldata.
`tests/SettlementV2.test.ts` covers `lock`
(deadline validation, double-lock rejection), `cancel` (before/after deadline,
mutual exclusion with a second `cancel`), and the `isExpired`/`isReleasable`
view predicates — all locally, with the real on-chain evidence for the
`cancel`/`finalize` mutual-exclusion property given by case 8 above.

**Not covered by this suite — cross-instance replay (§8.4).** The manuscript
reports a replay/cross-instance experiment: two independent `(oracle,
Settle)` pairs, the same settlement tag (same \eeid/domain key), two
different proofs/terms, the replay rejected within the originating context
and accepted independently in the other instance, demonstrating that
uniqueness is instance-scoped rather than global. The cross-instance replay
experiment reported in §8.4 was executed in the authors' internal POC
repository and is not currently reproduced by an automated test in this
public repository. This is deliberate, not an oversight: the test is planned
for a separate, follow-up pull request rather than being added, copied, or
approximated as part of this documentation-only sync.

## Open items (not blocking)

- **Gas per public signal** (the delta between the two-signal and the
  five-signal verifier): re-measure both from the same snarkjs 0.7.6 codegen
  and template.
- **Proving-time dispersion:** re-run `scripts/bench-prove.cjs` on the stated
  hardware (i5-1135G7, containerized); the attempt on an uncontrolled machine
  was too noisy to publish. (Note: V3 no longer reports this figure in its
  main text either — see "Proving and verification" above.)
- **The 18 undetermined signals of the KYC circuit:** identify them against
  its `.sym` file.
- **Port the cross-instance/tag-replay test** described in manuscript §8.4
  into this repository's `tests/` directory (see "Not covered by this suite"
  above).

## Provenance

This repository is a curated snapshot of the settlement and attestation work
of a larger internal repository, published for the manuscript's
reproducibility requirement. The manuscript (§8.4) cites commit
`0db97bf91ddc5be475e3d4175a62e241eb80df79`, and its reproducibility claims
refer to that commit.

Three commits were made to this repository after `0db97bf`, all documentation
only (`74aa204`, `1389b55`, `b968db9` — revisions to a pre-V3 draft of the
paper, the README and this manifest). None touched `contracts/`, `circuits/`,
`build/`, `scripts/` or `tests/`. The commit that performs the V3
documentation sync (this one) continues that pattern: it replaces the pre-V3
paper with the actual submitted V3 manuscript and brings the README and this
manifest in line with it, again without touching any artifact.

Consequently, two commit references are both correct, for different claims:

- **`0db97bf91ddc5be475e3d4175a62e241eb80df79`** — cite this for any
  artifact-level reproducibility claim (R1CS, zkey, deployed addresses, gas
  and constraint figures): it is the commit the manuscript names, and it is
  bit-for-bit what `contracts/`, `circuits/` and `build/` still contain today.
- **The current `main` HEAD** — cite this to find the actual V3 manuscript
  text and the documentation that describes it; the pre-V3 draft that
  `0db97bf` shipped alongside is retained in git history (`git show
  0db97bf:docs/eprint/instant-settlement.tex`) but is no longer the paper
  presented by this repository's working tree.

Gas figures for the reversal and liveness paths above were read back from the
transaction receipts on 2026-09-29 (`eth_getTransactionReceipt`, chainId 51);
all 17 transaction hashes in this manifest resolve, with the statuses shown.
