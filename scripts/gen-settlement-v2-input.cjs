/**
 * Gera o input.json do settlement_verify_v2, computando os cinco sinais
 * publicos a partir das entradas privadas com a mesma Poseidon que o circuito
 * usa (circomlibjs).
 *
 * Uso: node scripts/gen-settlement-v2-input.cjs <caminho/input.json>
 *
 * Os valores privados sao de exemplo — o ponto e que sejam coerentes entre si,
 * de modo que c0 e c compartilhem amount e txid, que e a amarracao de duas
 * fases que o circuito prova.
 */
const fs = require("node:fs");
const path = require("node:path");

const out = process.argv[2];
if (!out) {
  console.error("uso: node scripts/gen-settlement-v2-input.cjs <caminho/input.json>");
  process.exit(1);
}

async function main() {
  // circomlibjs e ESM; carrega por import dinamico para funcionar em .cjs
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (xs) => F.toObject(poseidon(xs));

  const amount = 123456n; // R$ 1.234,56 em centavos
  const salt0 = 111111111111111111n; // blinding da fase 0 (compartilhado com o PSP)
  const salt = 222222222222222222n; // blinding da liquidacao
  const e2eId = 333333333333333333n; // identificador do pagamento
  const txid = 444444444444444444n; // identificador da cobranca
  const k = 555555555555555555n; // chave de dominio
  const party = 666666666666666666n; // contraparte (CPF/CNPJ)
  const partySalt = 777777777777777777n;

  const signals = {
    amount, salt0, salt, e2eId, txid, k, party, partySalt,
    c0: H([amount, salt0, txid]),
    c: H([amount, salt, e2eId, txid]),
    nu: H([e2eId, k]),
    K: H([k]),
    partyCommitment: H([party, partySalt]),
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      Object.fromEntries(Object.entries(signals).map(([key, v]) => [key, v.toString()])),
      null,
      2
    )
  );

  console.log(`input escrito em ${out}`);
  console.log(`  c0 = ${signals.c0}`);
  console.log(`  c  = ${signals.c}`);
  console.log(`  nu = ${signals.nu}`);
  console.log(`  K  = ${signals.K}`);
  console.log(`  pc = ${signals.partyCommitment}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
