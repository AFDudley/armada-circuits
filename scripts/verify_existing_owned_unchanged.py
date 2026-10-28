#!/usr/bin/env python3
"""Acceptance probe for arx-213 clause c3: the three pre-existing owned
Transact shapes (1x1_owned, 1x2_owned, 1x3_owned) keep byte-identical
circuit files and unchanged verifying keys while the owned shape matrix
is filled out to the full 8x4 set.

Compares the real working tree with the baseline commit's recorded file
contents (no self-reported claim) for: (a) the three shapes' entry files,
and (b) any tracked verifying-key artifact (a zkey, a verification_key.json,
or anything under the real ceremony/ state) naming one of those three
shapes. A verifying-key file with no recorded baseline hash did not exist
at the baseline, so its presence counts as a change.

The gate judges a tree copied with no .git history (exophial D49.4), so the
probe cannot read the baseline commit's objects. BASELINES therefore records
the SHA-256 of each file at the baseline commit, taken with
`git show <sha>:<path> | sha256sum`. An unknown --baseline is an error.

Prints exactly one JSON object to stdout; judges nothing itself.

Usage:
  verify_existing_owned_unchanged.py --baseline <commit-sha>
"""

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

EXISTING_OWNED_SHAPES = ["1x1_owned", "1x2_owned", "1x3_owned"]
EXISTING_OWNED_FILES = [f"src/main/main_{shape}.circom" for shape in EXISTING_OWNED_SHAPES]

VERIFYING_KEY_MARKERS = ("verification_key", "vkey", ".zkey")

# SHA-256 of each file at the baseline commit. 614e3c8 tracked no verifying-key files.
BASELINES = {
    "614e3c8ee87cc81e0b6e2beb14f46fb303b4b2a6": {
        "src/main/main_1x1_owned.circom": "b684293cfdf33fe1e2fd51b01bf56ee060a7d1948e112096a93b403bc90b7433",
        "src/main/main_1x2_owned.circom": "0b570b2fa8b741307aa1fda4affa8a09c41bf98a5c8344d08414302790a2671a",
        "src/main/main_1x3_owned.circom": "0a2231bba569e36d0fead9f197091eeca9957a146119aeeec0fe869956ed3bb7",
    },
}


def emit(observations):
    print(json.dumps(observations))


def changed_against_baseline(baseline_hashes, path):
    expected = baseline_hashes.get(path)
    file = ROOT / path
    if expected is None or not file.is_file():
        return True
    return hashlib.sha256(file.read_bytes()).hexdigest() != expected


def tracked_verifying_key_paths():
    result = subprocess.run(
        ["git", "ls-files", "--", "*.zkey", "*verification_key*", "*vkey*", "ceremony"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    args = parser.parse_args()
    if args.baseline not in BASELINES:
        raise SystemExit(f"no recorded file hashes for baseline {args.baseline}")
    baseline_hashes = BASELINES[args.baseline]

    changed_files = sum(
        1 for path in EXISTING_OWNED_FILES if changed_against_baseline(baseline_hashes, path)
    )

    relevant_vkey_paths = [
        path
        for path in tracked_verifying_key_paths()
        if any(shape in path for shape in EXISTING_OWNED_SHAPES)
        or any(marker in path for marker in VERIFYING_KEY_MARKERS)
    ]
    changed_verifying_keys = sum(
        1
        for path in relevant_vkey_paths
        if changed_against_baseline(baseline_hashes, path)
    )

    emit({"changed_files": changed_files, "changed_verifying_keys": changed_verifying_keys})


if __name__ == "__main__":
    sys.exit(main())
