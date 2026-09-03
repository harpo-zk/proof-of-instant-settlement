import { describe, it } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";
import { toHex, pad } from "viem";

/**
 * SettlementV2 — maquina de estados do escrow-de-compromisso (lock/finalize/
 * cancel), achado H1 da revisao de Marco Tulio Rocha Nascimento: sem um
 * timeout, uma operacao Locked cujo PSP nunca assina fica travada para
 * sempre. cancel() fecha esse gap. Estes testes cobrem so a maquina de
 * estados (lock/cancel/Expired); o caminho feliz de finalize() com uma prova
 * real e exercitado em scripts/deploy-settlement-v2.ts e
 * scripts/apothem-negative-cases-v3.ts (evidencia on-chain real), nao aqui.
 */

const WINDOW = 3600n;

async function expectRevert(p: Promise<unknown>, re?: RegExp) {
  let reverted = false, msg = "";
  try { await p; } catch (e: any) { reverted = true; msg = String(e?.shortMessage || e?.details || e?.message || e); }
  expect(reverted, `esperava revert${re ? " ~ " + re : ""}`).to.equal(true);
  if (re) expect(msg).to.match(re);
}

describe("SettlementV2 — lock/cancel/Expired (achado H1)", () => {
  async function fx() {
    const conn = await network.connect();
    const { viem } = conn;
    const networkHelpers = (conn as any).networkHelpers;
    const [deployer] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const verifier = await viem.deployContract("SettlementVerifierV2", []);
    const oracle = await viem.deployContract("SettlementAttestationOracle", [
      deployer.account.address,
      WINDOW,
    ]);
    const domainKeyAnchor = pad(toHex(0x1234n), { size: 32 });
    const settlement = await viem.deployContract("SettlementV2", [
      verifier.address,
      oracle.address,
      domainKeyAnchor,
    ]);

    const now = BigInt((await publicClient.getBlock()).timestamp);
    const c0 = pad(toHex(0xc0c0n), { size: 32 });
    return { settlement, networkHelpers, now, c0 };
  }

  it("lock() registra a operacao com o deadline informado", async () => {
    const { settlement, now, c0 } = await fx();
    await settlement.write.lock([c0, now + WINDOW]);
    const op = await settlement.read.getOperation([c0]);
    expect(op.state).to.equal(1); // Locked
    expect(op.deadline).to.equal(now + WINDOW);
  });

  it("lock() rejeita c0 zero", async () => {
    const { settlement, now } = await fx();
    await expectRevert(
      settlement.write.lock([pad(toHex(0n), { size: 32 }), now + WINDOW]),
      /c0 zero/
    );
  });

  it("lock() rejeita deadline no passado", async () => {
    const { settlement, now, c0 } = await fx();
    await expectRevert(settlement.write.lock([c0, now]), /deadline no passado/);
  });

  it("lock() rejeita c0 ja registrado (double-lock)", async () => {
    const { settlement, now, c0 } = await fx();
    await settlement.write.lock([c0, now + WINDOW]);
    await expectRevert(settlement.write.lock([c0, now + WINDOW]), /ja registrada/);
  });

  it("cancel() reverte antes do deadline expirar", async () => {
    const { settlement, now, c0 } = await fx();
    await settlement.write.lock([c0, now + WINDOW]);
    await expectRevert(settlement.write.cancel([c0]), /prazo ainda nao expirou/);
  });

  it("cancel() reverte para uma operacao nunca travada", async () => {
    const { settlement, c0 } = await fx();
    await expectRevert(settlement.write.cancel([c0]), /operacao nao travada/);
  });

  it("cancel() apos o deadline expirar transiciona Locked -> Expired", async () => {
    const { settlement, networkHelpers, now, c0 } = await fx();
    await settlement.write.lock([c0, now + 60n]);
    await networkHelpers.time.increase(65);
    await settlement.write.cancel([c0]);
    expect(await settlement.read.isExpired([c0])).to.equal(true);
    const op = await settlement.read.getOperation([c0]);
    expect(op.state).to.equal(3); // Expired
  });

  it("cancel() e mutuamente exclusivo com finalize(): uma vez Expired, nao pode virar Expired de novo", async () => {
    const { settlement, networkHelpers, now, c0 } = await fx();
    await settlement.write.lock([c0, now + 60n]);
    await networkHelpers.time.increase(65);
    await settlement.write.cancel([c0]);
    await expectRevert(settlement.write.cancel([c0]), /operacao nao travada/);
  });

  it("isReleasable() e isExpired() sao false para uma operacao so travada", async () => {
    const { settlement, now, c0 } = await fx();
    await settlement.write.lock([c0, now + WINDOW]);
    expect(await settlement.read.isReleasable([c0])).to.equal(false);
    expect(await settlement.read.isExpired([c0])).to.equal(false);
  });
});
