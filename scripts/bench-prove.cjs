#!/usr/bin/env node
// uso: node scripts/bench-prove.cjs <dir-do-circuito> <wasm> <N>
// ex.:  node scripts/bench-prove.cjs build/circuits/settlement_verify_v2 settlement_verify_v2.wasm 30
const snarkjs = require("snarkjs");
const fs = require("fs");

const dir = process.argv[2];
const wasmName = process.argv[3];
const N = parseInt(process.argv[4] || "30", 10);

(async () => {
  const input = JSON.parse(fs.readFileSync(`${dir}/input.json`));
  const wasm = `${dir}/${wasmName}`;
  const zkeyFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".zkey"));
  const zkey = `${dir}/${zkeyFiles[0]}`;

  for (let i = 0; i < 3; i++) await snarkjs.groth16.fullProve(input, wasm, zkey); // warm-up

  const vkey = await snarkjs.zKey.exportVerificationKey(zkey);

  const prove = [], verify = [];
  for (let i = 0; i < N; i++) {
    let t0 = process.hrtime.bigint();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    prove.push(Number(process.hrtime.bigint() - t0) / 1e6);

    t0 = process.hrtime.bigint();
    await snarkjs.groth16.verify(vkey, publicSignals, proof);
    verify.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const stats = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const m = s[Math.floor(s.length / 2)];
    const mu = a.reduce((p, c) => p + c, 0) / a.length;
    const sd = Math.sqrt(a.reduce((p, c) => p + (c - mu) ** 2, 0) / (a.length - 1));
    return { median: m.toFixed(1), sd: sd.toFixed(1), min: s[0].toFixed(1), max: s.at(-1).toFixed(1) };
  };
  console.log(`circuito: ${dir} (N=${N})`);
  console.log("prove ", stats(prove));
  console.log("verify", stats(verify));
})();
