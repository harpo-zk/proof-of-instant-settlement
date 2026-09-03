/**
 * Deploy + fluxo completo da liquidacao v2, com registro de hashes e gas.
 *
 *   local  : node node_modules/hardhat/dist/src/cli.js run scripts/deploy-settlement-v2.ts
 *   apothem: ... run scripts/deploy-settlement-v2.ts --network xdcTestnet
 *
 * Fases: lock(c0) -> attest(recibo do PSP sobre c0) -> finalize(prova).
 * Nada de valor ou identificador de pagamento aparece em nenhuma das chamadas.
 */
import { network } from "hardhat";
import fs from "node:fs";
import { pad, toHex } from "viem";

const OUT = "build/circuits/settlement_verify_v2";
const DISPUTE_WINDOW = 259200n; // 72h — bloqueio cautelar do trilho

function loadProof() {
  const proof = JSON.parse(fs.readFileSync(`${OUT}/proof.json`, "utf8"));
  const pub = JSON.parse(fs.readFileSync(`${OUT}/public.json`, "utf8")) as string[];
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
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  const { pA, pB, pC, signals } = loadProof();
  const c0 = pad(toHex(signals[0]), { size: 32 });
  const cSettle = pad(toHex(signals[1]), { size: 32 });
  const tag = pad(toHex(signals[2]), { size: 32 });
  const anchorK = pad(toHex(signals[3]), { size: 32 });
  const partyCommitment = pad(toHex(signals[4]), { size: 32 });

  const log: string[] = [];
  const rec = (s: string) => { console.log(s); log.push(s); };

  rec(`chainId        : ${chainId}`);
  rec(`deployer       : ${deployer.account.address}`);
  rec(`c0             : ${c0}`);
  rec(`c (settlement) : ${cSettle}`);
  rec(`tag (nu)       : ${tag}`);
  rec(`K (anchor)     : ${anchorK}`);
  rec(`partyCommitment: ${partyCommitment}`);
  rec("");

  // --- deploys ---
  const verifier = await viem.deployContract("SettlementVerifierV2", []);
  rec(`SettlementVerifierV2       : ${verifier.address}`);

  const oracle = await viem.deployContract("SettlementAttestationOracle", [
    deployer.account.address,
    DISPUTE_WINDOW,
  ]);
  rec(`SettlementAttestationOracle: ${oracle.address}`);

  const settlement = await viem.deployContract("SettlementV2", [
    verifier.address,
    oracle.address,
    anchorK,
  ]);
  rec(`SettlementV2               : ${settlement.address}`);
  rec("");

  const gasOf = async (hash: `0x${string}`) =>
    (await publicClient.getTransactionReceipt({ hash })).gasUsed;

  // O deployer atua como PSP atestador nesta demonstracao.
  const hSetAttestor = await oracle.write.setAttestor([deployer.account.address, true]);
  await publicClient.waitForTransactionReceipt({ hash: hSetAttestor });
  rec(`setAttestor      tx=${hSetAttestor} gas=${await gasOf(hSetAttestor)}`);

  // --- fase 0: o escrow trava nos termos acordados, com prazo de liveness ---
  const lockDeadline = BigInt((await publicClient.getBlock()).timestamp) + 3600n;
  const hLock = await settlement.write.lock([c0, lockDeadline]);
  await publicClient.waitForTransactionReceipt({ hash: hLock });
  rec(`lock(c0, deadline) tx=${hLock} gas=${await gasOf(hLock)}`);

  // --- atestacao: o PSP assina sobre (c0, partyCommitment), nunca sobre o
  //     valor ou o identificador em claro da contraparte (achado A1) ---
  const now = BigInt((await publicClient.getBlock()).timestamp);
  const receipt = { c0, tag, partyCommitment, settled: true, deadline: now + 3600n };
  const signature = await deployer.signTypedData({
    domain: {
      name: "SettlementAttestationOracle",
      version: "3",
      chainId,
      verifyingContract: oracle.address,
    },
    types: {
      Receipt: [
        { name: "c0", type: "bytes32" },
        { name: "tag", type: "bytes32" },
        { name: "partyCommitment", type: "bytes32" },
        { name: "settled", type: "bool" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "Receipt",
    message: receipt,
  });

  const hAttest = await oracle.write.attest([receipt, signature]);
  await publicClient.waitForTransactionReceipt({ hash: hAttest });
  rec(`attest           tx=${hAttest} gas=${await gasOf(hAttest)}`);

  // --- fase 1: liquidacao ---
  const hFinalize = await settlement.write.finalize([pA, pB, pC, signals]);
  await publicClient.waitForTransactionReceipt({ hash: hFinalize });
  rec(`finalize (ZK)    tx=${hFinalize} gas=${await gasOf(hFinalize)}`);
  rec("");

  const op = await settlement.read.getOperation([c0]);
  rec(`estado da operacao : ${["None", "Locked", "Finalized"][Number((op as any).state)]}`);
  rec(`tag consumida      : ${await settlement.read.tagUsed([tag])}`);
  rec(`liberavel agora    : ${await settlement.read.isReleasable([c0])}  (falso ate a janela de 72h fechar)`);
  rec(`atestada           : ${await oracle.read.isAttested([tag])}`);
  rec(`irrevogavel        : ${await oracle.read.isIrrevocable([tag])}`);

  const outFile = `build/deploy-settlement-v2-${chainId}.txt`;
  fs.writeFileSync(outFile, log.join("\n") + "\n");
  console.log(`\nregistro salvo em ${outFile}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
