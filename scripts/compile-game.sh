#!/usr/bin/env bash
set -euo pipefail

# Compile the Battleship game circuit and produce its development key.
# Outputs: build/battleship/{Battleship.r1cs, Battleship_js/...wasm,
#          Battleship.sym, final.zkey, vkey.json}
#
# Battleship is not an Armada pool shape, so it is not in scripts/compile.sh's
# SHAPES array (that array is keyed by nullifier/commitment counts). It
# compiles on its own, with this script.
#
# The development key uses a dedicated SMALL Powers-of-Tau at power 14
# (16384 constraints, which covers Battleship's few thousand), never the
# larger pool-shapes ptau: that larger build runs for several minutes,
# while this power-14 build completes in under a minute. This is the
# UNSAFE dev ceremony — deterministic entropy, for local testing and CI
# only. Production artifacts require a secure multi-party ceremony.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT/build/battleship"
PTAU_DIR="$ROOT/build/ptau"
MAIN_FILE="$ROOT/src/operations/Battleship.circom"

CIRCOM_BIN="${CIRCOM_BIN:-circom}"

POT_POWER=14
POT_FILE="$PTAU_DIR/pot${POT_POWER}_final.ptau"

echo "Compiling Battleship circuit..."
mkdir -p "$BUILD_DIR"
"$CIRCOM_BIN" "$MAIN_FILE" \
  --r1cs --wasm --sym \
  -o "$BUILD_DIR" \
  --O1

echo "  → $BUILD_DIR/Battleship.r1cs"

mkdir -p "$PTAU_DIR"

if [ ! -f "$POT_FILE" ]; then
  echo "Phase 1: Powers of Tau (bn128, power ${POT_POWER})..."
  echo "armada-dev-entropy" | snarkjs powersoftau new bn128 "$POT_POWER" \
    "$PTAU_DIR/pot${POT_POWER}_0000.ptau"
  echo "armada-contribution-entropy" | snarkjs powersoftau contribute \
    "$PTAU_DIR/pot${POT_POWER}_0000.ptau" "$PTAU_DIR/pot${POT_POWER}_0001.ptau" \
    --name="dev"
  snarkjs powersoftau prepare phase2 "$PTAU_DIR/pot${POT_POWER}_0001.ptau" \
    "$POT_FILE"
  echo "  → $POT_FILE"
else
  echo "Phase 1: Using existing $POT_FILE"
fi

echo "Phase 2: battleship..."
snarkjs groth16 setup "$BUILD_DIR/Battleship.r1cs" "$POT_FILE" "$BUILD_DIR/0000.zkey"
echo "armada-zkey-contribution" | snarkjs zkey contribute "$BUILD_DIR/0000.zkey" \
  "$BUILD_DIR/final.zkey" --name="dev"
snarkjs zkey export verificationkey "$BUILD_DIR/final.zkey" "$BUILD_DIR/vkey.json"

echo "  → $BUILD_DIR/final.zkey"
echo "  → $BUILD_DIR/vkey.json"
echo "Done."
