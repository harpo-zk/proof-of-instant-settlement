/**
 * Casos negativos das REGRAS DE ACEITACAO do oraculo v3, registrados on-chain
 * contra o oraculo do fluxo feliz pos-cerimonia (docs/eprint/ARTIFACTS.md):
 *
 *   1. recibo assinado por quem nao e attestor
 *   2. settled = false
 *   3. recibo expirado (deadline no passado)
 *   4. replay de uma tag ja atestada (a do fluxo feliz)
 *
 * Sao os quatro casos que o manifesto listava como "reproduzir com o script"
 * sem hash pos-cerimonia. Cada transacao sai com gas explicito para ser
 * MINERADA e reverter na cadeia, deixando um hash consultavel, em vez de ser
 * barrada na simulacao do cliente.
 *
 *   ORACLE_ADDRESS=0x9b44cfd2150e65292e462a964b7b4fda0dd8f41a \
 *   node node_modules/hardhat/dist/src/cli.js run scripts/apothem-negative-cases-acceptance-v3.ts --network xdcTestnet
 */
import { network } from "hardhat";
import fs from "node:fs";
import { encodeFunctionData, pad, toHex } from "viem";

const ORACLE = (process.env.ORACLE_ADDRESS ?? "0x9b44cfd2150e65292e462a964b7b4fda0dd8f41a") as `0x${string}`;
const GAS = 300000n;

async function main() {
  const conn = await network.connect();
  const { viem } = conn;
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  // O "forjador" so precisa ASSINAR: a transacao e enviada pelo deployer, que
  // paga o gas. Uma conta sem fundos basta, e e o cenario realista.
  const { privateKeyToAccount } = await import("viem/accounts");
  const outsider = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");

  const oracle = await viem.getContractAt("SettlementAttestationOracle", ORACLE);
  const now = BigInt((await publicClient.getBlock()).timestamp);

  const domain = { name: "SettlementAttestationOracle", version: "3", chainId, verifyingContract: ORACLE } as const;
  const types = {
    Receipt: [
      { name: "c0", type: "bytes32" },
      { name: "tag", type: "bytes32" },
      { name: "partyCommitment", type: "bytes32" },
      { name: "settled", type: "bool" },
      { name: "deadline", type: "uint64" },
    ],
  } as const;

  const log: string[] = [];
  const rec = (s: string) => { console.log(s); log.push(s); };
  rec(`SettlementAttestationOracle: ${ORACLE} (chainId ${chainId}) · deployer/attestor ${deployer.account.address}`);
  rec("");

  async function sendRaw(label: string, receipt: any, signature: `0x${string}`) {
    const data = encodeFunctionData({ abi: oracle.abi, functionName: "attest", args: [receipt, signature] });
    const hash = await deployer.sendTransaction({ to: ORACLE, data, gas: GAS });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    const status = rc.status === "reverted" ? "REVERTED (esperado)" : "ACEITOU (INESPERADO)";
    rec(`${label.padEnd(40)} tx=${hash} status=${status} gas=${rc.gasUsed}`);
    return rc.status;
  }

  const pub = JSON.parse(fs.readFileSync("build/circuits/settlement_verify_v2/public.json", "utf8")) as string[];
  const realC0 = pad(toHex(BigInt(pub[0])), { size: 32 });
  const realTag = pad(toHex(BigInt(pub[2])), { size: 32 });
  const realPc = pad(toHex(BigInt(pub[4])), { size: 32 });
  const c0 = pad(toHex(0xdeadbeefn), { size: 32 });
  const pc = pad(toHex(0xfeedn), { size: 32 });

  const results: string[] = [];
  {
    const r = { c0, tag: pad(toHex(0x1001n), { size: 32 }), partyCommitment: pc, settled: true, deadline: now + 3600n };
    const sig = await outsider.signTypedData({ domain, types, primaryType: "Receipt", message: r });
    results.push(await sendRaw("1 · recibo forjado (nao-attestor)", r, sig));
  }
  {
    const r = { c0, tag: pad(toHex(0x1002n), { size: 32 }), partyCommitment: pc, settled: false, deadline: now + 3600n };
    const sig = await deployer.signTypedData({ domain, types, primaryType: "Receipt", message: r });
    results.push(await sendRaw("2 · settled = false", r, sig));
  }
  {
    const r = { c0, tag: pad(toHex(0x1003n), { size: 32 }), partyCommitment: pc, settled: true, deadline: now - 1n };
    const sig = await deployer.signTypedData({ domain, types, primaryType: "Receipt", message: r });
    results.push(await sendRaw("3 · recibo expirado (deadline passado)", r, sig));
  }
  {
    const r = { c0: realC0, tag: realTag, partyCommitment: realPc, settled: true, deadline: now + 3600n };
    const sig = await deployer.signTypedData({ domain, types, primaryType: "Receipt", message: r });
    results.push(await sendRaw("4 · replay da tag ja atestada", r, sig));
  }

  const ok = results.every((s) => s === "reverted");
  rec("");
  rec(ok ? "4/4 rejeitados on-chain" : "ATENCAO: algum caso foi aceito");
  const outFile = `build/apothem-negative-cases-acceptance-v3-${chainId}.txt`;
  fs.writeFileSync(outFile, log.join("\n") + "\n");
  console.log(`\nregistro salvo em ${outFile}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
