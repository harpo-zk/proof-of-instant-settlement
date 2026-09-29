#!/usr/bin/env bash
#
# Harpo — cerimônia MPC phase-2 (Groth16) — RT-2.
# Tooling reproduzível que transforma o processo manual do docs/TRUSTED-SETUP.md
# em subcomandos. A segurança REAL vem de PARTES INDEPENDENTES rodando `contribute`
# em suas próprias máquinas (basta 1 honesta que descarte a entropia). O `demo`
# simula tudo local numa máquina só — serve p/ TESTE, NÃO dá garantia de produção.
#
# Uso:
#   ceremony.sh init      <circuit>                       # coordenador: cria a 0000.zkey
#   ceremony.sh contribute <in.zkey> <out.zkey> <nome>    # participante: 1 contribuição (entropia local)
#   ceremony.sh finalize  <circuit> <last.zkey> [beaconHex] [numIterExp]  # coordenador: beacon+verify+export
#   ceremony.sh demo      <circuit> [numContrib]          # cerimônia completa SIMULADA (teste)
#
# Env:
#   SNARKJS   caminho do snarkjs (default: snktool isolado)
#   PTAU_DIR  dir dos ptau (default: circuits)
#   CEREMONY_ENTROPY  (contribute) entropia secreta local; se ausente, lê de /dev/urandom
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SNARKJS="${SNARKJS:-node /tmp/snktool/node_modules/.bin/snarkjs}"
PTAU_DIR="${PTAU_DIR:-$ROOT/circuits}"

# Beacon público padrão (placeholder). Em produção, use uma fonte de aleatoriedade
# pública e verificável combinada pelas partes (ex.: hash de um bloco Bitcoin FUTURO).
DEFAULT_BEACON="0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"

rand_hex() { head -c 32 /dev/urandom | sha256sum | cut -d' ' -f1; }

# Escolhe o menor ptau que comporta o circuito.
pick_ptau() {
  local r1cs="$1"
  local n; n="$($SNARKJS r1cs info "$r1cs" 2>/dev/null | grep -oE 'Constraints: [0-9]+' | grep -oE '[0-9]+')"
  local p
  for p in 15 16 17 20; do
    if [ "$n" -le "$((2**p))" ]; then echo "$PTAU_DIR/powersOfTau28_hez_final_$p.ptau"; return; fi
  done
  echo "ERRO: circuito com $n constraints excede 2^20" >&2; exit 1
}

cmd_init() {
  local c="$1"; local out="$ROOT/build/circuits/$c"
  local r1cs="$out/$c.r1cs"; local ptau; ptau="$(pick_ptau "$r1cs")"
  echo "▸ init $c  (ptau: $(basename "$ptau"))"
  $SNARKJS groth16 setup "$r1cs" "$ptau" "$out/${c}_0000.zkey"
  echo "  → $out/${c}_0000.zkey (passe ao 1º participante)"
}

cmd_contribute() {
  local in="$1"; local out="$2"; local name="$3"
  local e="${CEREMONY_ENTROPY:-$(rand_hex)}"
  echo "▸ contribute [$name]"
  $SNARKJS zkey contribute "$in" "$out" --name="$name" -e="$e"
  unset e
  echo "  → $out  (publique o hash acima; NUNCA compartilhe a entropia; descarte-a)"
}

cmd_finalize() {
  local c="$1"; local last="$2"; local beacon="${3:-$DEFAULT_BEACON}"; local iters="${4:-10}"
  local out="$ROOT/build/circuits/$c"; local r1cs="$out/$c.r1cs"; local ptau; ptau="$(pick_ptau "$r1cs")"
  echo "▸ finalize $c  (beacon: ${beacon:0:16}…, 2^$iters iterações)"
  $SNARKJS zkey beacon "$last" "$out/${c}_final.zkey" "$beacon" "$iters" --name="beacon-final"
  echo "▸ verify (deve dizer 'ZKey Ok!')"
  $SNARKJS zkey verify "$r1cs" "$ptau" "$out/${c}_final.zkey"
  $SNARKJS zkey export verificationkey "$out/${c}_final.zkey" "$out/$c.vkey.json"
  $SNARKJS zkey export solidityverifier "$out/${c}_final.zkey" "$out/${c}_verifier.sol"
  cp "$out/${c}_final.zkey" "$out/$c.zkey"
  echo "  → $out/$c.zkey + $c.vkey.json + ${c}_verifier.sol (produção)."
  echo "    Copie o verifier p/ contracts/verifiers/ e renomeie 'contract Groth16Verifier' p/ o nome esperado."
}

# Cerimônia completa SIMULADA para TESTAR a tooling. Roda 100% isolada em /tmp e
# NÃO toca em nenhum artefato de produção (a entropia é de uma máquina só → sem
# garantia real; a cerimônia de verdade é distribuída, no piloto).
cmd_demo() {
  local c="$1"; local n="${2:-3}"
  local src="$ROOT/build/circuits/$c"; local r1cs="$src/$c.r1cs"; local ptau; ptau="$(pick_ptau "$r1cs")"
  local work; work="$(mktemp -d)"
  echo "════ CERIMÔNIA DEMO (SIMULADA, isolada em $work) — $c — $n contribuições ════"
  $SNARKJS groth16 setup "$r1cs" "$ptau" "$work/0000.zkey" >/dev/null
  local prev="$work/0000.zkey"
  for i in $(seq 1 "$n"); do
    local next="$work/000${i}.zkey"
    echo "  ▸ contribute demo-party-$i"
    $SNARKJS zkey contribute "$prev" "$next" --name="demo-party-$i" -e="$(rand_hex)" >/dev/null
    prev="$next"
  done
  echo "  ▸ beacon-final + verify:"
  $SNARKJS zkey beacon "$prev" "$work/final.zkey" "$DEFAULT_BEACON" 10 --name="beacon-final" >/dev/null
  $SNARKJS zkey verify "$r1cs" "$ptau" "$work/final.zkey" 2>&1 | grep -iE "contribution #|ZKey Ok|INVALID" | sed 's/^/    /'
  rm -rf "$work"
  echo "  → DEMO OK — nenhum artefato de produção tocado."
}

case "${1:-}" in
  init)       shift; cmd_init "$@" ;;
  contribute) shift; cmd_contribute "$@" ;;
  finalize)   shift; cmd_finalize "$@" ;;
  demo)       shift; cmd_demo "$@" ;;
  *) echo "uso: ceremony.sh {init|contribute|finalize|demo} ..."; exit 1 ;;
esac
