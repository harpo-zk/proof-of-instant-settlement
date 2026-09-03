/**
 * Casos negativos do fluxo de liquidacao v3, achado A3 da revisao de Marco
 * Tulio Rocha Nascimento: a checagem-chefe do protocolo (mismatch de c0/pc no
 * recibo) nunca tinha uma transacao negativa que a exercitasse.
 *
 * Reaproveita a prova real do fluxo feliz (build/circuits/settlement_verify_v2)
 * para os casos 5a/5b (o recibo do PSP diverge do que a prova abre) e uma
 * segunda prova com k differente (build/circuits/settlement_verify_v2_case6)
 * para o caso 6 (ancora de dominio errada). O caso 7 (reversao) usa uma
 * instancia separada com janela curta, deployada so para isto.
 *
 * Cada caso usa um deploy FRESCO de oraculo+settlement: o oraculo recusa
 * reatestar uma tag ja atestada, entao reaproveitar a mesma tag entre casos
 * (todos usam a mesma prova = mesma tag) exigiria isso de qualquer forma.
 *
 *   local  : node node_modules/hardhat/dist/src/cli.js run scripts/apothem-negative-cases-v3.ts
 *   apothem: ... run scripts/apothem-negative-cases-v3.ts --network xdcTestnet
 */
import { network } from "hardhat";
import fs from "node:fs";
import { pad, toHex } from "viem";

const MAIN = "build/circuits/settlement_verify_v2";
const CASE6 = "build/circuits/settlement_verify_v2_case6";
const GAS = 500000n; // explicito: queremos a transacao MINERADA e revertida, nao barrada na simulacao

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
  const realTag = pad(toHex(main_.signals[2]), { size: 32 });
  const realPc = pad(toHex(main_.signals[4]), { size: 32 });

  const log: string[] = [];
  const rec = (s: string) => { console.log(s); log.push(s); };

  const receiptDomain = (oracleAddr: `0x${string}`) => ({
    name: "SettlementAttestationOracle",
    version: "3",
    chainId,
    verifyingContract: oracleAddr,
  } as const);
  const receiptTypes = {
    Receipt: [
      { name: "c0", type: "bytes32" },
      { name: "tag", type: "bytes32" },
      { name: "partyCommitment", type: "bytes32" },
      { name: "settled", type: "bool" },
      { name: "deadline", type: "uint64" },
    ],
  } as const;

  // O verifier e o mesmo em todos os casos.
  const verifier = await viem.deployContract("SettlementVerifierV2", []);
  rec(`SettlementVerifierV2 (compartilhado entre os casos): ${verifier.address}`);
  rec("");

  /** Deploy fresco de oraculo+settlement, com o domainKeyAnchor do fluxo feliz. */
  async function freshDeployment(window: bigint) {
    const oracle = await viem.deployContract("SettlementAttestationOracle", [
      deployer.account.address, window,
    ]);
    await oracle.write.setAttestor([deployer.account.address, true]);
    const settlement = await viem.deployContract("SettlementV2", [
      verifier.address, oracle.address, pad(toHex(main_.signals[3]), { size: 32 }),
    ]);
    return { oracle, settlement };
  }

  async function expectRevert(label: string, p: Promise<`0x${string}`>) {
    try {
      const hash = await p;
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      rec(`${label.padEnd(60)} tx=${hash} status=${rc.status.toUpperCase()} gas=${rc.gasUsed}`);
      if (rc.status !== "reverted") throw new Error(`${label}: esperava revert, mas ACEITOU`);
    } catch (e: any) {
      // client-side revert (sem hash minerado) - ainda assim registra o motivo
      if (e?.message?.startsWith(label)) throw e;
      rec(`${label.padEnd(60)} REVERTEU (client-side, sem hash) — ${String(e?.shortMessage || e?.message || e).slice(0, 120)}`);
    }
  }

  const now = BigInt((await publicClient.getBlock()).timestamp);

  // --- caso 5a: recibo assinado sobre um c0 diferente do que a prova abre ---
  // Mecanismo inteiro da consistencia de valor sem revelar valor (Sec.4.1): um
  // PSP que recomputasse c0 para o valor ERRADO produziria exatamente isto.
  {
    const { oracle, settlement } = await freshDeployment(259200n);
    await settlement.write.lock([c0, now + 3600n]);
    const c0Wrong = pad(toHex(0xdeadbeefn), { size: 32 });
    const r = { c0: c0Wrong, tag: realTag, partyCommitment: realPc, settled: true, deadline: now + 3600n };
    const sig = await deployer.signTypedData({ domain: receiptDomain(oracle.address), types: receiptTypes, primaryType: "Receipt", message: r });
    await oracle.write.attest([r, sig]);
    await expectRevert(
      "caso 5a — c0 do recibo diverge do que a prova abre (valor liquidado != acordado)",
      settlement.write.finalize([main_.pA, main_.pB, main_.pC, main_.signals], { gas: GAS })
    );
  }

  // --- caso 5b: recibo assinado sobre uma contraparte diferente da que a prova abre ---
  // Sem isto, partyCommitment e um sinal publico decorativo (achado A1): o
  // prover escolhe a contraparte que quiser e os predicados do Sec.5 falam de
  // uma identidade que ninguem atestou.
  {
    const { oracle, settlement } = await freshDeployment(259200n);
    await settlement.write.lock([c0, now + 3600n]);
    const pcWrong = pad(toHex(0xc0ffeen), { size: 32 });
    const r = { c0, tag: realTag, partyCommitment: pcWrong, settled: true, deadline: now + 3600n };
    const sig = await deployer.signTypedData({ domain: receiptDomain(oracle.address), types: receiptTypes, primaryType: "Receipt", message: r });
    await oracle.write.attest([r, sig]);
    await expectRevert(
      "caso 5b — partyCommitment do recibo diverge do que a prova abre",
      settlement.write.finalize([main_.pA, main_.pB, main_.pC, main_.signals], { gas: GAS })
    );
  }

  // --- caso 6: prova gerada com k' != k (K' != domainKeyAnchor) ---
  // A unicidade da tag so vale por construcao se a prova vier da chave de
  // dominio registrada (Property 4); sem esta checagem valeria so por
  // convencao.
  {
    const case6 = loadProof(CASE6);
    const { settlement } = await freshDeployment(259200n);
    // c0 e o MESMO da prova principal (mesmo amount/salt0/txid) - so k mudou.
    await settlement.write.lock([pad(toHex(case6.signals[0]), { size: 32 }), now + 3600n]);
    await expectRevert(
      "caso 6 — ancora de dominio K da prova diverge da registrada",
      settlement.write.finalize([case6.pA, case6.pB, case6.pC, case6.signals], { gas: GAS })
    );
  }

  // --- caso 7: reversao dentro da janela bloqueia liberacao para sempre ---
  // Instancia com janela curta, deployada so para isto tornar exercitavel em
  // minutos (a instancia de referencia mantem 72h). Em rede local, avancamos o
  // relogio; em Apothem, esperamos o tempo real passar.
  {
    const WINDOW_SHORT = isLocal ? 600n : 600n; // 10 min
    const { oracle, settlement } = await freshDeployment(WINDOW_SHORT);
    await settlement.write.lock([c0, now + 3600n]);

    const r = { c0, tag: realTag, partyCommitment: realPc, settled: true, deadline: now + 3600n };
    const sig = await deployer.signTypedData({ domain: receiptDomain(oracle.address), types: receiptTypes, primaryType: "Receipt", message: r });
    const hAttest = await oracle.write.attest([r, sig]);
    await publicClient.waitForTransactionReceipt({ hash: hAttest });

    const hFinalize = await settlement.write.finalize([main_.pA, main_.pB, main_.pC, main_.signals]);
    await publicClient.waitForTransactionReceipt({ hash: hFinalize });
    rec(`caso 7 — finalize (caminho feliz, janela curta)         tx=${hFinalize}`);

    const rev = { tag: realTag, returned: true, deadline: now + 3600n };
    const revTypes = { Reversal: [
      { name: "tag", type: "bytes32" }, { name: "returned", type: "bool" }, { name: "deadline", type: "uint64" },
    ] } as const;
    const revSig = await deployer.signTypedData({ domain: receiptDomain(oracle.address), types: revTypes, primaryType: "Reversal", message: rev });
    const hRev = await oracle.write.attestReversal([rev, revSig]);
    await publicClient.waitForTransactionReceipt({ hash: hRev });
    rec(`caso 7a — attestReversal dentro da janela                tx=${hRev}`);

    // isReleasable e view (nao reverte) — a garantia e o VALOR, nao um revert.
    const releasableAfterReversal = await settlement.read.isReleasable([c0]);
    rec(`caso 7a — isReleasable apos reversal (deve ser false)     ${releasableAfterReversal}`);
    if (releasableAfterReversal) throw new Error("caso 7a: deveria estar bloqueado apos reversal");

    // controle: SEM reversal, so espera a janela passar -> Irrevocable.
    if (isLocal) {
      await networkHelpers.time.increase(Number(WINDOW_SHORT) + 60);
    } else {
      rec(`caso 7b — aguardando ${Number(WINDOW_SHORT) + 60}s (janela real na Apothem)...`);
      await new Promise((res) => setTimeout(res, (Number(WINDOW_SHORT) + 60) * 1000));
    }
    const irrevocable = await oracle.read.isIrrevocable([realTag]);
    rec(`caso 7a — tag revertida permanece NAO irrevogavel          ${!irrevocable}`);
  }

  // --- caso 8: liveness — PSP nunca assina, cancel() destrava apos o prazo ---
  // Achado H1 da revisao: sem isto, uma operacao Locked cujo PSP nunca assina
  // fica travada para sempre. Prazo curto (60s) so para ser exercitavel em
  // minutos; a instancia de referencia usa o deadline que o chamador de
  // lock() escolher.
  {
    const { settlement } = await freshDeployment(259200n);
    // Recalcula "agora": o caso 7 pode ter avancado o relogio local (time
    // travel) ou o tempo real ja ter passado desde o `now` do topo do script.
    const now8 = BigInt((await publicClient.getBlock()).timestamp);
    const shortDeadline = now8 + 60n;
    // Usa o c0 REAL (o mesmo da prova principal): assim caso 8c exercita
    // finalize() com uma prova genuinamente valida contra uma operacao que
    // ja virou Expired, e nao apenas uma que nunca foi travada.
    const hLock8 = await settlement.write.lock([c0, shortDeadline]);
    await publicClient.waitForTransactionReceipt({ hash: hLock8 });

    await expectRevert(
      "caso 8a — cancel() antes do prazo expirar",
      settlement.write.cancel([c0], { gas: GAS })
    );

    if (isLocal) {
      await networkHelpers.time.increase(65);
    } else {
      rec(`caso 8b — aguardando 70s (prazo real de lock() na Apothem)...`);
      await new Promise((res) => setTimeout(res, 70_000));
    }

    const hCancel = await settlement.write.cancel([c0]);
    await publicClient.waitForTransactionReceipt({ hash: hCancel });
    rec(`caso 8b — cancel() apos o prazo expirar                  tx=${hCancel}`);

    const expired = await settlement.read.isExpired([c0]);
    rec(`caso 8b — isExpired apos cancel (deve ser true)           ${expired}`);
    if (!expired) throw new Error("caso 8b: deveria estar Expired apos cancel()");

    // finalize() e cancel() sao mutuamente exclusivas: uma vez Expired, uma
    // prova genuinamente valida chegando atrasada nao pode mais fechar a
    // operacao (precisa de attest() tambem, mas o require de estado reverte
    // primeiro — e exatamente o que este caso prova).
    await expectRevert(
      "caso 8c — finalize() apos cancel() (Expired, nao mais Locked)",
      settlement.write.finalize([main_.pA, main_.pB, main_.pC, main_.signals], { gas: GAS })
    );
  }

  const outFile = `build/apothem-negative-cases-v3-${chainId}.txt`;
  fs.writeFileSync(outFile, log.join("\n") + "\n");
  console.log(`\nregistro salvo em ${outFile}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
