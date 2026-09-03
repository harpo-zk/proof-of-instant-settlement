/**
 * Casos negativos do oraculo v2, executados on-chain para que a rejeicao seja
 * evidencia verificavel e nao apenas um teste local.
 *
 *   node node_modules/hardhat/dist/src/cli.js run scripts/apothem-negative-cases.ts --network xdcTestnet
 *
 * Envia cada transacao com gas explicito para que ela seja MINERADA e reverta na
 * cadeia (em vez de ser barrada na simulacao do cliente), deixando um hash que
 * um leitor pode consultar.
 */
import { network } from "hardhat";
import fs from "node:fs";
import { encodeFunctionData, pad, toHex } from "viem";

const ORACLE = process.env.ORACLE_ADDRESS as `0x${string}`;
const GAS = 300000n;

async function main() {
  if (!ORACLE) throw new Error("defina ORACLE_ADDRESS");

  const conn = await network.connect();
  const { viem } = conn;
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  // O "forjador" so precisa ASSINAR — a transacao e enviada pelo deployer, que
  // paga o gas. Uma conta local sem fundos basta, e e o cenario realista: um
  // terceiro qualquer tentando passar um recibo por um PSP registrado.
  const { privateKeyToAccount } = await import("viem/accounts");
  const outsider = privateKeyToAccount(
    "0x1111111111111111111111111111111111111111111111111111111111111111"
  );

  const oracle = await viem.getContractAt("SettlementAttestationOracle", ORACLE);
  const now = BigInt((await publicClient.getBlock()).timestamp);

  const domain = {
    name: "SettlementAttestationOracle",
    version: "2",
    chainId,
    verifyingContract: ORACLE,
  } as const;
  const types = {
    Receipt: [
      { name: "c0", type: "bytes32" },
      { name: "tag", type: "bytes32" },
      { name: "settled", type: "bool" },
      { name: "deadline", type: "uint64" },
    ],
  } as const;

  const log: string[] = [];
  const rec = (s: string) => { console.log(s); log.push(s); };

  /** Envia crua, com gas fixo, e reporta se reverteu on-chain. */
  async function sendRaw(label: string, receipt: any, signature: `0x${string}`) {
    const data = encodeFunctionData({
      abi: oracle.abi,
      functionName: "attest",
      args: [receipt, signature],
    });
    const hash = await deployer.sendTransaction({ to: ORACLE, data, gas: GAS });
    const rc = await publicClient.getTransactionReceipt({ hash }).catch(async () => {
      return publicClient.waitForTransactionReceipt({ hash });
    });
    const status = rc.status === "reverted" ? "REVERTEU (esperado)" : "ACEITOU";
    rec(`${label.padEnd(34)} tx=${hash} status=${status} gas=${rc.gasUsed}`);
    return rc.status;
  }

  const c0 = pad(toHex(0xdeadbeefn), { size: 32 });

  // 1. recibo assinado por quem nao e attestor
  {
    const tag = pad(toHex(0x1001n), { size: 32 });
    const r = { c0, tag, settled: true, deadline: now + 3600n };
    const sig = await outsider.signTypedData({ domain, types, primaryType: "Receipt", message: r });
    await sendRaw("recibo forjado (nao-attestor)", r, sig);
  }

  // 2. settled = false
  {
    const tag = pad(toHex(0x1002n), { size: 32 });
    const r = { c0, tag, settled: false, deadline: now + 3600n };
    const sig = await deployer.signTypedData({ domain, types, primaryType: "Receipt", message: r });
    await sendRaw("settled=false", r, sig);
  }

  // 3. recibo expirado (deadline no passado)
  {
    const tag = pad(toHex(0x1003n), { size: 32 });
    const r = { c0, tag, settled: true, deadline: now - 1n };
    const sig = await deployer.signTypedData({ domain, types, primaryType: "Receipt", message: r });
    await sendRaw("recibo expirado (deadline)", r, sig);
  }

  // 4. replay da tag ja atestada na liquidacao principal
  {
    const proofPub = JSON.parse(
      fs.readFileSync("build/circuits/settlement_verify_v2/public.json", "utf8")
    ) as string[];
    const tag = pad(toHex(BigInt(proofPub[2])), { size: 32 });
    const realC0 = pad(toHex(BigInt(proofPub[0])), { size: 32 });
    const r = { c0: realC0, tag, settled: true, deadline: now + 3600n };
    const sig = await deployer.signTypedData({ domain, types, primaryType: "Receipt", message: r });
    await sendRaw("replay de tag ja atestada", r, sig);
  }

  const outFile = `build/apothem-negative-cases-${chainId}.txt`;
  fs.writeFileSync(outFile, log.join("\n") + "\n");
  console.log(`\nregistro salvo em ${outFile}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
