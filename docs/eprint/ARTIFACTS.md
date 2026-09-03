# Artifact manifest — Proof-of-Instant-Settlement

Every number in §9 of the manuscript is reproducible from this repository with
the commands below, and every on-chain claim points at a transaction a reader can
look up.

## Toolchain

| Tool | Version |
|---|---|
| circom | 2.2.3 |
| snarkjs | 0.7.6 |
| solc | 0.8.27 (evm target cancun, optimizer on, runs 200) |
| Julia (for Ecne) | 1.7.2 |
| Ecne | `github.com/franklynwang/EcneProject` @ `2593535` |
| CPU (all timings) | 11th Gen Intel Core i5-1135G7, containerized |

## Deployment — XDC Apothem, chainId 51

Deployer / attestor / registry owner: `0x7c20dcc2A644697c4bd400e5BEf4847981380A49`
(same key for all three roles in this prototype — see the reading note in §9.4 of
the manuscript).

| Contract | Address |
|---|---|
| `SettlementVerifierV2` (Groth16, 5 public signals) | `0x03E090aa6BA7a8B3991f9658dA61e0A7934D430A` |
| `SettlementAttestationOracle` (EIP-712 version `"3"`, receipt carries `partyCommitment`, 72 h dispute window) | `0xDd788A7693048fc8AD129f71b19Dca9d3E707fC6` |
| `SettlementV2` (cross-checks `c0` **and** `partyCommitment` via `bindingOf`; `lock`/`cancel` liveness timeout, achado H1) | `0x067E79Aa6c90DE097e6c10827B279fe667616849` |

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
| `setAttestor` (register the PSP key) | `0x8ee0c09f98e4e1950f34480fd363611bc93d323b9f8cf5d4698fd2c3a53d659a` | 49,155 |
| `lock(c0, deadline)` — escrow locks on the agreed terms, before any payment, with a liveness deadline | `0xdd2901d59ac08ef960cd090d529bc481b95d76b025f78f33ca240e0693334aa0` | 74,982 |
| `attest(receipt, signature)` — PSP receipt over `(c0, partyCommitment)` | `0xcaeaf5f54bc29184016bd2c3067cd2ff9eadd3085abed6393660fed3432f5e94` | 90,913 |
| `finalize(proof)` — **complete settlement call** | `0xece5e777879dd577e65663b208955bf022542ae8c4cefc787b30f2e572914ac4` | **353,315** |

The complete settlement transaction costs 353,315 gas. An isolated call to the
verifier alone costs 243,194 gas (see §9.2 below for why this is an upper bound
on its share of the complete call, not a subtractable component); the remainder
of the complete call is the oracle cross-check (`isAttested`,
`bindingOf(tag) == keccak256(c0, partyCommitment)`), the domain-anchor check,
the tag consumption and the state transition.

### Acceptance rules (all rejected on-chain)

Each was sent with explicit gas so that it would be **mined and revert**, leaving
a verifiable hash rather than being stopped by client-side simulation.

| Case | Transaction | Result | Gas |
|---|---|---|---|
| Receipt signed by a non-attestor | — reproduce with `apothem-negative-cases.ts` | reverted | — |
| `settled = false` | — reproduce with `apothem-negative-cases.ts` | reverted | — |
| Expired receipt (`deadline` in the past) | — reproduce with `apothem-negative-cases.ts` | reverted | — |
| Replay of an already-attested tag | — reproduce with `apothem-negative-cases.ts` | reverted | — |
| **5a — receipt's `c0` diverges from the one the proof opens** (value-consistency mechanism, §3.1) | `0x88c86b46c1c23e3a968c0e8ec53fa6c3a32ccd36d7f2b93ff116a333c60f2d7c` | reverted | 65,249 |
| **5b — receipt's `partyCommitment` diverges from the one the proof opens** | `0x2e29057b83aa33d3f25678ad4dbceb06afe876119ad929c5cb444e929e0ec9bb` | reverted | 65,249 |
| **6 — proof's domain anchor `K` diverges from the registered one** | `0x5305bca4ca67ad2cf867d9b9b51634fda76bf6e9e10918f2b3eecf064ad1e591` | reverted | 54,455 |

### Reversal path (case 7 — short-window instance, 600 s)

Deployed only to make the reversal exercisable on-chain in minutes; the reference
deployment above keeps the 72 h window.

| Step | Transaction | Gas |
|---|---|---|
| `finalize` (happy path, short-window instance) | `0xca5aa76f42df55bdc61f92ecb4a864c300d78b805ec1ca08cca8d446daf47240` | — |
| `attestReversal` within the window | `0x484171c1db1da22fb6230763dd5355eecd8ebe312e5b9edeefa9db681c995c30` | — |
| `isReleasable` after reversal | `false` (confirmed) | — |
| Control: 660 s after the reversal, `isIrrevocable(tag)` is still `false` — reversal blocks release **permanently**, not just until the window closes | confirmed | — |

### Liveness timeout path (case 8 — achado H1, new in this revision)

Isolated deployment (`scripts/apothem-liveness-case8.ts`), same main proof, so
that this evidence didn't require repeating case 7's 660 s real wait.
`SettlementV2` for this case: `0xbf393CA377F0Ef3F3ABBaeC1c48F7ca4F3D7ff48`.

| Step | Transaction | Result | Gas |
|---|---|---|---|
| `lock(c0, deadline=+60s)` | `0x4849ebd853c38939a1e56aec1878ca87d58f78df230be98e033d6ec3095b669e` | succeeded | — |
| `cancel(c0)` before the `lock` deadline | `0x5164d0dbd8318c3b90eea69af09f757bf7275f52f4cbb0b48720ce79d1406835` | reverted (`"prazo ainda nao expirou"`) | 26,202 |
| `cancel(c0)` after the `lock` deadline (60 s, real wait) | `0xbad26608dc11bafcea86f61f7428aab25c685d897a628b9834f9c803ecb4b995` | succeeded, `state -> Expired` | — |
| `isExpired(c0)` after `cancel` | `true` (confirmed) | — | — |
| `finalize(proof)` with a genuinely valid proof, submitted after `cancel` | `0xffad291af5987735d74c3e5ccab2dcbd66b555056eb05c45c7bb3aac7b776177` | reverted (`"operacao nao travada"`) | 52,401 |

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
```

## §9.1 — Circuit sizes

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

## §9.2 — Proving and verification

```bash
OUT=build/circuits/settlement_verify_v2
circom circuits/settlement_verify_v2.circom --r1cs --wasm --sym --O2 -o $OUT -l node_modules
node scripts/gen-settlement-v2-input.cjs $OUT/input.json
node $OUT_js/generate_witness.cjs $OUT/settlement_verify_v2.wasm $OUT/input.json $OUT/witness.wtns
snarkjs groth16 setup $OUT/settlement_verify_v2.r1cs circuits/powersOfTau28_hez_final_15.ptau $OUT/settlement_verify_v2.zkey
snarkjs zkey export verificationkey $OUT/settlement_verify_v2.zkey $OUT/vkey.json
snarkjs groth16 prove $OUT/settlement_verify_v2.zkey $OUT/witness.wtns $OUT/proof.json $OUT/public.json
snarkjs groth16 verify $OUT/vkey.json $OUT/public.json $OUT/proof.json     # -> OK!
snarkjs zkey export solidityverifier $OUT/settlement_verify_v2.zkey contracts/SettlementVerifierV2.sol
```

The reference `SettlementVerifierV2.sol` in this repository was generated from
a development-grade Groth16 setup (no MPC ceremony) run for this repository;
its verification key is therefore specific to this artifact set, not portable
to a setup run elsewhere, even for the bit-identical circuit.

Timings below are **single warm runs** on the stated hardware, not a median
over repeated trials — see §9.2 of the manuscript for why, and for the one
`N=30` dispersion measurement we did run (on a separate, uncontrolled
machine, not usable as a substitute for these figures). A same-hardware
`N>=30` re-run is listed as future work, not reported here as if already done.

| Circuit | Prove | Verify (off-chain) |
|---|---|---|
| `settlement_verify_v2` | 151.2 ms | 13.6 ms |
| `pix_nullifier_verify` | 110.5 ms | 14.0 ms |
| `pix_payment_verify` (ablation) | 130.1 ms | 14.7 ms |

## §9.3 — ZK-circuit constraint analysis (Ecne)

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
circuit is otherwise identical.

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
node node_modules/hardhat/dist/src/cli.js test tests/SettlementV2.test.ts                    #  9 tests (lock/cancel/Expired, achado H1)
node node_modules/hardhat/dist/src/cli.js test tests/SettlementAttestationOracle.test.ts      # 11 tests
node node_modules/hardhat/dist/src/cli.js test tests/SettlementVerifierV2.gas.test.ts         #  1 test
node node_modules/hardhat/dist/src/cli.js test tests/AuditChannelGovernance.test.ts tests/ContratoSocialArvore.test.ts tests/ContratoSocialAttestor.test.ts tests/ContratoSocialExtrair.test.ts tests/FinanciamentoFlow.test.ts tests/StateMachineGovernance.test.ts   # suite completa do repositorio
```

All 63 tests pass (0 failures). `tests/SettlementAttestationOracle.test.ts`
includes a test that checks neither the settled amount **nor** the
counterparty's cleartext identifier appears in `attest`'s calldata.
`tests/SettlementV2.test.ts` is new in this revision: it covers `lock`
(deadline validation, double-lock rejection), `cancel` (before/after deadline,
mutual exclusion with a second `cancel`), and the `isExpired`/`isReleasable`
view predicates — all locally, with the real on-chain evidence for the
`cancel`/`finalize` mutual-exclusion property given by case 8 above.

## Pendências (não bloqueiam, mas não estão fechadas)

- **Gas por sinal** (delta entre o verifier de 2 sinais e o de 5 sinais):
  re-medir ambos a partir do mesmo codegen `snarkjs 0.7.6`, mesmo template.
- **Dispersão de tempo de prova**: re-rodar `scripts/bench-prove.cjs` no
  hardware declarado (i5-1135G7, containerizado) — a tentativa nesta sessão,
  numa máquina não controlada, teve ruído grande demais para publicar.
- **18 sinais do KYC**: cruzar com o `.sym` pra identificar o que são.
- **URL + commit do repositório público**: preencher antes de circular —
  `harpo-zk/proof-of-instant-settlement`, ainda não criado.
