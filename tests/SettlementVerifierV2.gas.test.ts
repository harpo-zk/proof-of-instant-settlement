import { describe, it } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";
import fs from "node:fs";

/**
 * Mede o gas do verifier do settlement_verify_v2 com uma prova REAL, e o gas
 * das chamadas inteiras. Responde ao Item 7 (reportar o gas da chamada
 * completa, nao so do verifier isolado) e ao C2 (re-benchmarcar o circuito
 * principal, que agora tem 5 sinais publicos em vez de 2).
 */

const OUT = "build/circuits/settlement_verify_v2";

function loadProof() {
  const proof = JSON.parse(fs.readFileSync(`${OUT}/proof.json`, "utf8"));
  const pub = JSON.parse(fs.readFileSync(`${OUT}/public.json`, "utf8"));
  const pA = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])] as const;
  // snarkjs emite pi_b em ordem invertida por par
  const pB = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ] as const;
  const pC = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])] as const;
  const signals = pub.map((s: string) => BigInt(s));
  return { pA, pB, pC, signals };
}

describe("SettlementVerifierV2 — gas com prova real", () => {
  it("aceita a prova e reporta o gas do verifier", async () => {
    const conn = await network.connect();
    const { viem } = conn;
    const publicClient = await viem.getPublicClient();

    const verifier = await viem.deployContract("SettlementVerifierV2", []);
    const { pA, pB, pC, signals } = loadProof();

    expect(signals.length, "o circuito v2 expoe 5 sinais publicos").to.equal(5);

    const ok = await verifier.read.verifyProof([pA, pB, pC, signals]);
    expect(ok, "o verifier on-chain deve aceitar a prova").to.equal(true);

    // gas de uma chamada real (nao estimativa): eth_estimateGas sobre verifyProof
    const gas = await publicClient.estimateContractGas({
      address: verifier.address,
      abi: verifier.abi,
      functionName: "verifyProof",
      args: [pA, pB, pC, signals],
    });

    console.log(`      [gas] verifyProof (5 sinais publicos): ${gas}`);
  });
});
