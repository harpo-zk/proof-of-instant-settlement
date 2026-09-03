/**
 * Caso 8 isolado (achado H1 da revisao): liveness — PSP nunca assina,
 * cancel() destrava a operacao apos o prazo de lock(). Extraido de
 * apothem-negative-cases-v3.ts para poder ser re-rodado sozinho (o script
 * completo tem uma espera real de 660s no caso 7 que nao precisa ser
 * repetida so para validar este caso).
 *
 *   local  : node node_modules/hardhat/dist/src/cli.js run scripts/apothem-liveness-case8.ts
 *   apothem: ... run scripts/apothem-liveness-case8.ts --network xdcTestnet
 */
import { network } from "hardhat";
import fs from "node:fs";
import { pad, toHex, encodeFunctionData } from "viem";

const MAIN = "build/circuits/settlement_verify_v2";
const GAS = 500000n;

function loadProof(dir: string) {
  const proof = JSON.parse(fs.readFileSync(`${dir}/proof.json`, "utf8"));
  const pub = JSON.parse(fs.readFileSync(`${dir}/public.json`, "utf8")) as string[];
  return {
    pA: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])] as [bigint, bigint],
    pB: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ] as [[bigint, bigint], [bigint, bigint]],
    pC: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])] as [bigint, bigint],
    signals: pub.map((s) => BigInt(s)) as unknown as [bigint, bigint, bigint, bigint, bigint],
  };
}

async function main() {
  const conn = await network.connect();
  const { viem } = conn;
  const networkHelpers = (conn as any).networkHelpers;
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();
  const isLocal = chainId === 31337;

  const main_ = loadProof(MAIN);
  const c0 = pad(toHex(main_.signals[0]), { size: 32 });

  const log: string[] = [];
  const rec = (s: string) => { console.log(s); log.push(s); };

  /** Envia crua, com gas fixo: na Apothem real isto forca a transacao a ser
   *  MINERADA e revertida on-chain, em vez de barrada por simulacao
   *  client-side antes do envio. Na rede Hardhat local, `eth_sendTransaction`
   *  ainda recusa uma transacao que sabe que vai reverter (comportamento do
   *  proprio node local, diferente de uma rede real) — entao tratamos os
   *  dois casos, exatamente como o script principal ja faz. */
  async function sendRawExpectRevert(label: string, functionName: string, args: unknown[]) {
    const data = encodeFunctionData({ abi: settlement.abi, functionName, args });
    try {
      const hash = await deployer.sendTransaction({ to: settlement.address, data, gas: GAS });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      rec(`${label.padEnd(60)} tx=${hash} status=${rc.status.toUpperCase()} gas=${rc.gasUsed}`);
      if (rc.status !== "reverted") throw new Error(`${label}: esperava revert, mas ACEITOU`);
    } catch (e: any) {
      if (e?.message?.startsWith(label)) throw e;
      rec(`${label.padEnd(60)} REVERTEU (client-side, sem hash) — ${String(e?.shortMessage || e?.message || e).slice(0, 120)}`);
    }
  }

  const verifier = await viem.deployContract("SettlementVerifierV2", []);
  const oracle = await viem.deployContract("SettlementAttestationOracle", [
    deployer.account.address, 259200n,
  ]);
  const settlement = await viem.deployContract("SettlementV2", [
    verifier.address, oracle.address, pad(toHex(main_.signals[3]), { size: 32 }),
  ]);
  rec(`SettlementV2 (caso 8 isolado): ${settlement.address}`);
  rec("");

  const now8 = BigInt((await publicClient.getBlock()).timestamp);
  const shortDeadline = now8 + 60n;

  const hLock8 = await settlement.write.lock([c0, shortDeadline]);
  await publicClient.waitForTransactionReceipt({ hash: hLock8 });
  rec(`caso 8 — lock(c0, deadline=+60s)                          tx=${hLock8}`);

  await sendRawExpectRevert(
    "caso 8a — cancel() antes do prazo expirar",
    "cancel",
    [c0]
  );

  if (isLocal) {
    await networkHelpers.time.increase(65);
  } else {
    rec(`caso 8b — aguardando 70s (prazo real de lock() na Apothem)...`);
    await new Promise((res) => setTimeout(res, 70_000));
  }

  const hCancel = await settlement.write.cancel([c0]);
  await publicClient.waitForTransactionReceipt({ hash: hCancel });
  rec(`caso 8b — cancel() apos o prazo expirar                   tx=${hCancel}`);

  const expired = await settlement.read.isExpired([c0]);
  rec(`caso 8b — isExpired apos cancel (deve ser true)            ${expired}`);
  if (!expired) throw new Error("caso 8b: deveria estar Expired apos cancel()");

  await sendRawExpectRevert(
    "caso 8c — finalize() apos cancel() (Expired, nao mais Locked)",
    "finalize",
    [main_.pA, main_.pB, main_.pC, main_.signals]
  );

  const outFile = `build/apothem-liveness-case8-${chainId}.txt`;
  fs.writeFileSync(outFile, log.join("\n") + "\n");
  console.log(`\nregistro salvo em ${outFile}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
