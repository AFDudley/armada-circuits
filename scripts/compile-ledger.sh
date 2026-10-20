#!/usr/bin/env bash
set -euo pipefail

# Compile the Ledger circuit (hidden-balance channel move).
# Outputs: build/ledger/{main_ledger.r1cs, main_ledger_js/...wasm, main_ledger.sym}
#
# Ledger is not an Armada pool shape, so it is not in scripts/compile.sh's
# SHAPES array (that array is keyed by nullifier/commitment counts). It
# compiles on its own, with this script.
#
# The proving/verification keys for this circuit come from the UNSAFE dev
# ceremony in scripts/setup-dev.sh's ledger block, never the production
# Phase-2 MPC.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT/build/ledger"
MAIN_FILE="$ROOT/src/main/main_ledger.circom"

CIRCOM_BIN="${CIRCOM_BIN:-circom}"

echo "Compiling Ledger circuit..."
mkdir -p "$BUILD_DIR"
"$CIRCOM_BIN" "$MAIN_FILE" \
  --r1cs --wasm --sym \
  -o "$BUILD_DIR" \
  --O1

echo "  → $BUILD_DIR/main_ledger.r1cs"
echo "Done."
