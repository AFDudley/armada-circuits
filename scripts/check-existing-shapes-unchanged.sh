#!/usr/bin/env bash
set -euo pipefail

# Acceptance probe for arx-aa4 clause c7: the existing Transact circuit and
# the non-owned main entry files are byte-identical to the base commit.
# Emits one stdout_json object; judges nothing itself.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

BASE_REF="$(git merge-base HEAD integrated)"

FILES=("src/operations/Transact.circom")
for f in src/main/main_*.circom; do
  case "$f" in
  *_owned.circom) ;;
  *) FILES+=("$f") ;;
  esac
done

changed=0
for f in "${FILES[@]}"; do
  if ! git diff --quiet "$BASE_REF" -- "$f"; then
    changed=$((changed + 1))
  fi
done

printf '{"changed_existing_files": %d}\n' "$changed"
