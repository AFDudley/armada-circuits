#!/usr/bin/env bash
# Shared helpers for the Armada circuits trusted-setup ceremony tooling.
# Sourced by every script in scripts/ceremony/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$ROOT/build"

# CEREMONY_DIR can be overridden (used by test-e2e.sh to avoid touching the
# real ceremony state). Defaults to the committed ceremony/ directory.
CEREMONY_DIR="${CEREMONY_DIR:-$ROOT/ceremony}"
MANIFEST="$CEREMONY_DIR/manifest.json"

# Shapes onboarded to this ceremony on integrated so far: the three owned
# Transact variants (compile.sh's "1,1,1x1_owned" etc. entries). The 19
# plain shapes' ceremony is tracked on a separate branch and is out of
# scope here — this list grows when that work joins integrated; it does
# not become a second ceremony kind.
# Override with CEREMONY_SHAPES="1x1_owned ..." for partial runs (testing).
DEFAULT_SHAPES=(
  "1x1_owned" "1x2_owned" "1x3_owned"
)
if [ -n "${CEREMONY_SHAPES:-}" ]; then
  # shellcheck disable=SC2206
  SHAPES=($CEREMONY_SHAPES)
else
  SHAPES=("${DEFAULT_SHAPES[@]}")
fi

# Phase 1: public perpetual Powers of Tau (Hermez), power 17.
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_17.ptau"
PTAU_FILE="${PTAU_FILE:-$BUILD_DIR/ptau/powersOfTau28_hez_final_17.ptau}"
PTAU_POWER="${PTAU_POWER:-17}"
# SHA-256 of the canonical Hermez perpetual ptau (powersOfTau28_hez_final_17.ptau).
# PTAU_FILE/PTAU_SHA256/PTAU_POWER env overrides exist ONLY for test-e2e.sh,
# which runs the whole flow against a tiny throwaway ptau. Never override
# them for the real ceremony.
PTAU_SHA256="${PTAU_SHA256:-6b662a324867139fb1a20a324d90b6ff61856dfb23f59326909f14b0e2483ae0}"

log()  { echo "[ceremony] $*" >&2; }
die()  { echo "[ceremony] ERROR: $*" >&2; exit 1; }

sha256() { shasum -a 256 "$1" | awk '{print $1}'; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

snarkjs() { (cd "$ROOT" && npx --no-install snarkjs "$@"); }

r1cs_for()  { echo "$BUILD_DIR/$1/main_$1.r1cs"; }
zkey_for()  { echo "$CEREMONY_DIR/$1/$2.zkey"; }   # $1=shape $2=index (0000, 0001, ...)

require_manifest() {
  [ -f "$MANIFEST" ] || die "no manifest at $MANIFEST — run init.sh first"
}

# Read a value from the manifest. Usage: mget '.ptau.sha256'
# Extra jq args are passed through: mget --arg s "$shape" '.shapes[$s].status'
mget() { jq -r "$@" "$MANIFEST"; }

# Latest contribution index for a shape (integer).
shape_latest_index() { jq -r --arg s "$1" '.shapes[$s].contributions | map(.index) | max' "$MANIFEST"; }

shape_status() { jq -r --arg s "$1" '.shapes[$s].status' "$MANIFEST"; }

# Verify the local ptau file matches the pinned checksum.
check_ptau() {
  [ -f "$PTAU_FILE" ] || die "ptau not found at $PTAU_FILE — run fetch-ptau.sh first"
  local actual
  actual="$(sha256 "$PTAU_FILE")"
  [ "$actual" = "$PTAU_SHA256" ] || die "ptau checksum mismatch: got $actual, want $PTAU_SHA256"
}
