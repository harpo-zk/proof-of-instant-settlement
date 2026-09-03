import { describe, it } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";
import { encodeFunctionData, toHex, pad, keccak256, encodePacked } from "viem";

/**
 * Oraculo de atestacao v3 — responde aos achados C1, C5, Item 9 e A1 da revisao.
 *
 * C1 era o mais grave: na v1 o recibo assinado carregava amount e txid, entao
 * ambos iam em claro no calldata publico de attest() e o amount ainda era
 * emitido no evento. Como a tag e a mesma que o circuito expoe, isso ligava
 * valor a liquidacao para qualquer observador. Ha um teste abaixo que verifica
 * exatamente isso: o valor liquidado nao aparece no calldata.
 *
 * A1 (revisao de Marco Tulio Rocha Nascimento, rev.3): o recibo v2 nao carregava
 * partyCommitment, entao o abstract/Sec.5/Sec.8 do paper afirmavam "contraparte
 * atestada pelo PSP" sem o artefato sustentar isso - o mesmo formato do erro do
 * Ecne (Sec.9.3), um nivel acima. O recibo v3 carrega partyCommitment e o
 * identificador do devedor tambem nao pode aparecer no calldata.
 */

const WINDOW = 3600n; // 1h de janela de disputa nos testes

async function expectRevert(p: Promise<unknown>, re?: RegExp) {
  let reverted = false, msg = "";
  try { await p; } catch (e: any) { reverted = true; msg = String(e?.shortMessage || e?.details || e?.message || e); }
  expect(reverted, `esperava revert${re ? " ~ " + re : ""}`).to.equal(true);
  if (re) expect(msg).to.match(re);
}

describe("SettlementAttestationOracle — atestacao sem vazar valor (C1/C5/Item 9)", () => {
  async function fx() {
    const conn = await network.connect();
    const { viem } = conn;
    const networkHelpers = (conn as any).networkHelpers;
    const [deployer, psp, outroPsp, relayer] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const oracle = await viem.deployContract("SettlementAttestationOracle", [
      deployer.account.address,
      WINDOW,
    ]);
    await oracle.write.setAttestor([psp.account.address, true]);

    const chainId = await publicClient.getChainId();
    const domain = {
      name: "SettlementAttestationOracle",
      version: "3",
      chainId,
      verifyingContract: oracle.address,
    } as const;

    const receiptTypes = {
      Receipt: [
        { name: "c0", type: "bytes32" },
        { name: "tag", type: "bytes32" },
        { name: "partyCommitment", type: "bytes32" },
        { name: "settled", type: "bool" },
        { name: "deadline", type: "uint64" },
      ],
    } as const;

    const reversalTypes = {
      Reversal: [
        { name: "tag", type: "bytes32" },
        { name: "returned", type: "bool" },
        { name: "deadline", type: "uint64" },
      ],
    } as const;

    const now = BigInt((await publicClient.getBlock()).timestamp);

    async function signReceipt(signer: any, message: any) {
      return signer.signTypedData({ domain, types: receiptTypes, primaryType: "Receipt", message });
    }
    async function signReversal(signer: any, message: any) {
      return signer.signTypedData({ domain, types: reversalTypes, primaryType: "Reversal", message });
    }

    return {
      oracle, publicClient, networkHelpers, deployer, psp, outroPsp, relayer,
      signReceipt, signReversal, now,
    };
  }

  const C0 = pad(toHex(0x1234n), { size: 32 });
  const TAG = pad(toHex(0xabcdn), { size: 32 });
  const PC = pad(toHex(0x5678n), { size: 32 }); // partyCommitment de exemplo

  it("aceita recibo de attestor registrado e registra a atestacao", async () => {
    const { oracle, psp, relayer, signReceipt, now, publicClient } = await fx();
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 3600n };
    const sig = await signReceipt(psp, r);

    const hash = await oracle.write.attest([r, sig], { account: relayer.account });
    const rc = await publicClient.getTransactionReceipt({ hash });

    expect(await oracle.read.isAttested([TAG])).to.equal(true);
    expect((await oracle.read.attestorOf([TAG])).toLowerCase())
      .to.equal(psp.account.address.toLowerCase());
    expect(await oracle.read.bindingOf([TAG])).to.equal(
      keccak256(encodePacked(["bytes32", "bytes32"], [C0, PC]))
    );
    console.log(`      [gas] attest() completo: ${rc.gasUsed}`);
  });

  it("C1/A1: valor liquidado E identificador da contraparte NAO aparecem no calldata de attest()", async () => {
    const { oracle, psp, signReceipt, now } = await fx();

    // Valor real liquidado: R$ 1.234,56 = 123456 centavos. Vive dentro de c0,
    // nunca no recibo. Na v1 ele era um campo uint256 do struct assinado.
    const amountCents = 123456n;
    // CPF canonico (11 digitos ASCII, sem pontuacao — regra do Sec.2/N1 da
    // revisao). Vive dentro de partyCommitment, nunca em claro no recibo.
    const cpfCanonico = "12345678909";
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 3600n };
    const sig = await signReceipt(psp, r);

    const calldata = encodeFunctionData({
      abi: oracle.abi,
      functionName: "attest",
      args: [r, sig],
    });

    const amountWord = pad(toHex(amountCents), { size: 32 }).slice(2).toLowerCase();
    expect(calldata.toLowerCase()).to.not.contain(amountWord);
    const cpfBytes = Buffer.from(cpfCanonico, "utf8").toString("hex");
    expect(calldata.toLowerCase()).to.not.contain(cpfBytes);
    // e nao ha nenhum campo do struct que seja o valor ou o identificador em claro
    const receiptAbi: any = (oracle.abi as any[]).find((e) => e.name === "attest");
    const fields = receiptAbi.inputs[0].components.map((c: any) => c.name);
    expect(fields).to.deep.equal(["c0", "tag", "partyCommitment", "settled", "deadline"]);
  });

  it("recusa assinante nao registrado", async () => {
    const { oracle, outroPsp, signReceipt, now } = await fx();
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 3600n };
    const sig = await signReceipt(outroPsp, r);
    await expectRevert(oracle.write.attest([r, sig]), /nao e attestor/i);
  });

  it("recusa settled=false", async () => {
    const { oracle, psp, signReceipt, now } = await fx();
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: false, deadline: now + 3600n };
    const sig = await signReceipt(psp, r);
    await expectRevert(oracle.write.attest([r, sig]), /nao liquidado/i);
  });

  it("Item 9: recibo expirado e recusado (contem dano de chave comprometida)", async () => {
    const { oracle, psp, signReceipt, now, networkHelpers } = await fx();
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 60n };
    const sig = await signReceipt(psp, r);
    await networkHelpers.time.increase(120);
    await expectRevert(oracle.write.attest([r, sig]), /expirado/i);
  });

  it("recusa replay da mesma tag", async () => {
    const { oracle, psp, signReceipt, now } = await fx();
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 3600n };
    const sig = await signReceipt(psp, r);
    await oracle.write.attest([r, sig]);
    await expectRevert(oracle.write.attest([r, sig]), /ja atestada/i);
  });

  it("C5: devolucao dentro da janela reverte a atestacao", async () => {
    const { oracle, psp, signReceipt, signReversal, now, publicClient } = await fx();
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 3600n };
    await oracle.write.attest([r, await signReceipt(psp, r)]);

    const rev = { tag: TAG, returned: true, deadline: now + 3600n };
    const hash = await oracle.write.attestReversal([rev, await signReversal(psp, rev)]);
    const rc = await publicClient.getTransactionReceipt({ hash });

    expect(await oracle.read.isReversed([TAG])).to.equal(true);
    expect(await oracle.read.isAttested([TAG])).to.equal(false);
    console.log(`      [gas] attestReversal() completo: ${rc.gasUsed}`);
  });

  it("C5: so vira irrevogavel apos a janela de devolucao", async () => {
    const { oracle, psp, signReceipt, now, networkHelpers } = await fx();
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 3600n };
    await oracle.write.attest([r, await signReceipt(psp, r)]);

    expect(await oracle.read.isAttested([TAG])).to.equal(true);
    expect(await oracle.read.isIrrevocable([TAG]), "nao pode ser final dentro da janela")
      .to.equal(false);

    await networkHelpers.time.increase(Number(WINDOW) + 1);
    expect(await oracle.read.isIrrevocable([TAG])).to.equal(true);
  });

  it("C5: encerrada a janela, a devolucao nao e mais aceita", async () => {
    const { oracle, psp, signReceipt, signReversal, now, networkHelpers } = await fx();
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 3600n };
    await oracle.write.attest([r, await signReceipt(psp, r)]);

    await networkHelpers.time.increase(Number(WINDOW) + 1);
    const rev = { tag: TAG, returned: true, deadline: now + 100000n };
    await expectRevert(
      oracle.write.attestReversal([rev, await signReversal(psp, rev)]),
      /janela encerrada/i
    );
  });

  it("devolucao assinada por outro attestor e recusada", async () => {
    const { oracle, psp, outroPsp, signReceipt, signReversal, now } = await fx();
    await oracle.write.setAttestor([outroPsp.account.address, true]);
    const r = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 3600n };
    await oracle.write.attest([r, await signReceipt(psp, r)]);

    const rev = { tag: TAG, returned: true, deadline: now + 3600n };
    await expectRevert(
      oracle.write.attestReversal([rev, await signReversal(outroPsp, rev)]),
      /outro attestor/i
    );
  });

  it("Item 9: revogar attestor bloqueia novas atestacoes sem invalidar as passadas", async () => {
    const { oracle, psp, signReceipt, now } = await fx();
    const r1 = { c0: C0, tag: TAG, partyCommitment: PC, settled: true, deadline: now + 3600n };
    await oracle.write.attest([r1, await signReceipt(psp, r1)]);

    await oracle.write.revokeAttestor([psp.account.address]);

    // a atestacao anterior continua valendo
    expect(await oracle.read.isAttested([TAG])).to.equal(true);

    // uma nova, do mesmo PSP, nao
    const TAG2 = pad(toHex(0xbeefn), { size: 32 });
    const r2 = { c0: C0, tag: TAG2, partyCommitment: PC, settled: true, deadline: now + 3600n };
    await expectRevert(oracle.write.attest([r2, await signReceipt(psp, r2)]), /nao e attestor/i);
  });
});
