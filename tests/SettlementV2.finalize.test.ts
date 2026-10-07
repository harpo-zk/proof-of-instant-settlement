import { describe, it } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";
import { pad, toHex } from "viem";
import fs from "node:fs";

/**
 * Reproduces, with real Groth16 proofs, the §8.4 ("End-to-end deployment")
 * cross-instance replay claim: settlement-tag uniqueness is enforced within
 * a single Oracle/Settlement deployment, not globally across independent
 * deployments.
 *
 * The second proof (tests/fixtures/settlement_verify_v2_case9, carried over
 * unmodified from the authors' internal POC repository, where it was
 * generated against the exact same settlement_verify_v2 circuit and zkey
 * shipped in this repository — see build/circuits/settlement_verify_v2/)
 * shares the main proof's e2eId and domain key — hence the same settlement
 * tag nu and the same domain anchor K — but has a different amount/salt0/
 * salt/txid, hence a different c0 (a distinct operation). No proof,
 * circuit, or key was regenerated to produce this test.
 */

const MAIN_DIR = "build/circuits/settlement_verify_v2";
const CASE9_DIR = "tests/fixtures/settlement_verify_v2_case9";

function loadProof(dir: string) {
  const proof = JSON.parse(fs.readFileSync(`${dir}/proof.json`, "utf8"));
  const pub = JSON.parse(fs.readFileSync(`${dir}/public.json`, "utf8")) as string[];
  const pA = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])] as const;
  // snarkjs emite pi_b em ordem invertida por par
  const pB = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ] as const;
  const pC = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])] as const;
  const signals = pub.map((s) => BigInt(s));
  return { pA, pB, pC, signals };
}

async function expectRevert(p: Promise<unknown>, re?: RegExp) {
  let reverted = false, msg = "";
  try { await p; } catch (e: any) { reverted = true; msg = String(e?.shortMessage || e?.details || e?.message || e); }
  expect(reverted, `esperava revert${re ? " ~ " + re : ""}`).to.equal(true);
  if (re) expect(msg).to.match(re);
}

const receiptTypes = {
  Receipt: [
    { name: "c0", type: "bytes32" },
    { name: "tag", type: "bytes32" },
    { name: "partyCommitment", type: "bytes32" },
    { name: "settled", type: "bool" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

describe("SettlementV2 — cross-instance settlement-tag replay (manuscript §8.4)", () => {
  async function fx() {
    const conn = await network.connect();
    const { viem } = conn;
    const publicClient = await viem.getPublicClient();
    const [deployer] = await viem.getWalletClients();
    const chainId = await publicClient.getChainId();

    const main_ = loadProof(MAIN_DIR);
    const case9 = loadProof(CASE9_DIR);

    // Pre-condicao do fixture: mesma tag (indice 2) e mesma ancora de
    // dominio (indice 3); c0 (indice 0) diferente — a mesma relacao que a
    // auditoria confirmou no POC original.
    expect(case9.signals[2], "tag deve ser identica entre os dois proofs").to.equal(main_.signals[2]);
    expect(case9.signals[3], "ancora de dominio deve ser identica").to.equal(main_.signals[3]);
    expect(case9.signals[0], "c0 deve ser diferente (operacao distinta)").to.not.equal(main_.signals[0]);

    const c0 = pad(toHex(main_.signals[0]), { size: 32 });
    const c0b = pad(toHex(case9.signals[0]), { size: 32 });
    const tag = pad(toHex(main_.signals[2]), { size: 32 });
    const domainAnchor = pad(toHex(main_.signals[3]), { size: 32 });
    const pc = pad(toHex(main_.signals[4]), { size: 32 });
    const pcB = pad(toHex(case9.signals[4]), { size: 32 });

    const now = BigInt((await publicClient.getBlock()).timestamp);

    async function deployPair() {
      const verifier = await viem.deployContract("SettlementVerifierV2", []);
      const oracle = await viem.deployContract("SettlementAttestationOracle", [
        deployer.account.address, 259200n,
      ]);
      await oracle.write.setAttestor([deployer.account.address, true]);
      const settlement = await viem.deployContract("SettlementV2", [
        verifier.address, oracle.address, domainAnchor,
      ]);
      return { verifier, oracle, settlement };
    }

    function receiptDomainFor(oracleAddr: `0x${string}`) {
      return { name: "SettlementAttestationOracle", version: "3", chainId, verifyingContract: oracleAddr } as const;
    }

    async function attestFor(oracle: any, forC0: `0x${string}`, forPc: `0x${string}`) {
      const receipt = { c0: forC0, tag, partyCommitment: forPc, settled: true, deadline: now + 3600n };
      const sig = await deployer.signTypedData({
        domain: receiptDomainFor(oracle.address), types: receiptTypes, primaryType: "Receipt", message: receipt,
      });
      return oracle.write.attest([receipt, sig]);
    }

    return { publicClient, main_, case9, c0, c0b, pc, pcB, now, deployPair, attestFor };
  }

  it("rejects replay within the same Oracle/Settlement instance (different operation, same tag), but allows the same tag in an independent instance", async () => {
    const { publicClient, main_, c0, c0b, pc, pcB, now, deployPair, attestFor } = await fx();

    // --- A: mesma instancia, segunda operacao com a mesma tag e recusada ---
    const { oracle, settlement } = await deployPair();

    await settlement.write.lock([c0, now + 3600n]);
    await attestFor(oracle, c0, pc);
    const hash = await settlement.write.finalize([main_.pA, main_.pB, main_.pC, main_.signals]);
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    expect(rc.status, "finalize() deve ser aceito na primeira chamada").to.equal("success");

    await settlement.write.lock([c0b, now + 3600n]);
    await expectRevert(attestFor(oracle, c0b, pcB), /tag ja atestada/);

    // --- B: segunda instancia independente aceita a MESMA tag/prova ---
    const pairB = await deployPair();
    await pairB.settlement.write.lock([c0, now + 3600n]);
    await attestFor(pairB.oracle, c0, pc);
    const hashB = await pairB.settlement.write.finalize([main_.pA, main_.pB, main_.pC, main_.signals]);
    const rcB = await publicClient.waitForTransactionReceipt({ hash: hashB });

    expect(
      rcB.status,
      "instancia B (oraculo proprio, nunca viu esta tag) tambem aceita: a unicidade da tag e " +
        "garantida por instancia de Oracle/Settlement, nao globalmente entre deployments " +
        "independentes — nao afirme unicidade global a partir deste resultado",
    ).to.equal("success");
  });
});
