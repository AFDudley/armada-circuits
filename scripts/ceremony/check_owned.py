#!/usr/bin/env python3
"""Acceptance probe for arx-a36: Phase-2 ceremony for the owned Transact
shapes (1x1_owned, 1x2_owned, 1x3_owned).

Drives the real scripts/ceremony/*.sh tooling — the same scripts the plain
shapes use, no second ceremony kind — against the real pinned Hermez
power-17 ptau, inside an isolated dry-run directory under .scratch/. Never
reads or writes ceremony/ (the real ceremony state).

Prints exactly one JSON object to stdout per mode; judges nothing itself.

Usage:
  check_owned.py contributions
  check_owned.py manifest
  check_owned.py zkey-verify
  check_owned.py verifying-keys
  check_owned.py prove-verify <transact-owned-NxM>
  check_owned.py ptau-pin
  check_owned.py no-secrets-committed
"""

import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD_DIR = ROOT / "build"
DRY_RUN_DIR = ROOT / ".scratch" / "ceremony-owned-check"
REAL_CEREMONY_DIR = ROOT / "ceremony"

OWNED_SHAPES = ["1x1_owned", "1x2_owned", "1x3_owned"]

# Must match scripts/ceremony/lib.sh exactly — this probe observes the
# real ceremony, it does not define a second copy of its parameters.
PTAU_FILE = BUILD_DIR / "ptau" / "powersOfTau28_hez_final_17.ptau"
PTAU_SHA256 = "6b662a324867139fb1a20a324d90b6ff61856dfb23f59326909f14b0e2483ae0"


def emit(observations):
    print(json.dumps(observations))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_ptau_power(path):
    """Reads the "power" field from a .ptau file's header section, per the
    binfile layout snarkjs's powersoftau_utils.js writePTauHeader writes:
    magic, version, section count, then (type, size) per section; the
    type==1 header section holds n8, q, power, ceremonyPower."""
    with open(path, "rb") as f:
        magic = f.read(4)
        if magic != b"ptau":
            raise ValueError(f"not a ptau file (bad magic): {path}")
        _version, num_sections = struct.unpack("<II", f.read(8))
        header_pos = None
        for _ in range(num_sections):
            section_type, section_size = struct.unpack("<IQ", f.read(12))
            if section_type == 1:
                header_pos = f.tell()
                break
            f.seek(section_size, 1)
        if header_pos is None:
            raise ValueError(f"no header section in {path}")
        f.seek(header_pos)
        (n8,) = struct.unpack("<I", f.read(4))
        f.seek(n8, 1)  # skip the field modulus q
        (power,) = struct.unpack("<I", f.read(4))
        return power


def run(cmd, env=None, cwd=ROOT):
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def capture(cmd, env=None, cwd=ROOT):
    return subprocess.run(
        cmd, cwd=cwd, env=env, capture_output=True, text=True, check=True
    )


def ensure_build():
    env = dict(os.environ)
    env["CIRCOM_BIN"] = str(ROOT / "node_modules" / ".bin" / "circom2")
    missing = [
        s for s in OWNED_SHAPES if not (BUILD_DIR / s / f"main_{s}.r1cs").exists()
    ]
    if missing:
        run(["bash", "scripts/compile.sh"], env=env)


def ensure_real_ptau():
    run(["bash", "scripts/ceremony/fetch-ptau.sh"])


def fresh_dry_run_dir():
    if DRY_RUN_DIR.exists():
        shutil.rmtree(DRY_RUN_DIR)
    DRY_RUN_DIR.mkdir(parents=True)
    return DRY_RUN_DIR


def ceremony_env(ceremony_dir):
    env = dict(os.environ)
    env["CEREMONY_DIR"] = str(ceremony_dir)
    env["CEREMONY_SHAPES"] = " ".join(OWNED_SHAPES)
    return env


def run_pipeline(contribute):
    """Real Phase-2 setup (and, if requested, one coordinator contribution
    per shape) for the owned shapes, against the real pinned ptau, inside a
    fresh dry-run directory. Never touches REAL_CEREMONY_DIR."""
    ensure_build()
    ensure_real_ptau()
    dry_run_dir = fresh_dry_run_dir()
    env = ceremony_env(dry_run_dir)
    run(
        ["bash", "scripts/ceremony/init.sh", "--announce-height", "99999999"],
        env=env,
    )
    if contribute:
        for shape in OWNED_SHAPES:
            contributor_env = dict(env)
            contributor_env["CEREMONY_ENTROPY"] = f"check-owned-dry-run-{shape}"
            run(
                ["bash", "scripts/ceremony/contribute.sh", shape, "checkowned"],
                env=contributor_env,
            )
    return dry_run_dir


def shape_for_arg(arg):
    match = re.fullmatch(r"transact-owned-(\d+)x(\d+)", arg or "")
    if not match:
        raise ValueError(f"unrecognized shape argument: {arg!r}")
    shape = f"{match.group(1)}x{match.group(2)}_owned"
    if shape not in OWNED_SHAPES:
        raise ValueError(f"unknown owned shape: {shape}")
    return shape


def snarkjs(*args):
    return subprocess.run(
        ["npx", "--no-install", "snarkjs", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )


def mode_contributions(_args):
    dry_run_dir = run_pipeline(contribute=True)
    manifest = json.loads((dry_run_dir / "manifest.json").read_text())
    count = 0
    for shape in OWNED_SHAPES:
        indices = [c["index"] for c in manifest["shapes"][shape]["contributions"]]
        if max(indices) >= 1:
            count += 1
    emit({"owned_shapes_with_contribution": count})


def mode_manifest(_args):
    dry_run_dir = run_pipeline(contribute=False)
    manifest = json.loads((dry_run_dir / "manifest.json").read_text())
    shapes = set(manifest["shapes"].keys())
    emit(
        {
            "manifest_shape_count": len(shapes),
            "manifest_is_exactly_owned": shapes == set(OWNED_SHAPES),
        }
    )


def mode_zkey_verify(_args):
    dry_run_dir = run_pipeline(contribute=True)
    ok_count = 0
    for shape in OWNED_SHAPES:
        r1cs = BUILD_DIR / shape / f"main_{shape}.r1cs"
        zkey = dry_run_dir / shape / "0001.zkey"
        result = snarkjs("zkey", "verify", str(r1cs), str(PTAU_FILE), str(zkey))
        if result.returncode == 0 and "OK" in (result.stdout + result.stderr):
            ok_count += 1
    emit({"zkey_ok_count": ok_count})


def mode_verifying_keys(_args):
    dry_run_dir = run_pipeline(contribute=True)
    exported = 0
    for shape in OWNED_SHAPES:
        zkey = dry_run_dir / shape / "0001.zkey"
        vkey = dry_run_dir / shape / "verification_key.json"
        result = snarkjs("zkey", "export", "verificationkey", str(zkey), str(vkey))
        if result.returncode == 0 and vkey.exists():
            exported += 1
    # Count distinct ceremony-tooling directories under scripts/ — the
    # structural fact "no second ceremony kind" is asserting.
    ceremony_kinds = len(
        [p for p in (ROOT / "scripts").glob("ceremony*") if p.is_dir()]
    )
    emit({"verifying_keys_exported": exported, "ceremony_kinds": ceremony_kinds})


def mode_prove_verify(args):
    if not args:
        raise ValueError("prove-verify requires a shape argument")
    shape_arg = args[0]
    shape = shape_for_arg(shape_arg)
    dry_run_dir = run_pipeline(contribute=True)
    zkey = dry_run_dir / shape / "0001.zkey"
    vkey = dry_run_dir / shape / "verification_key.json"
    export_result = snarkjs("zkey", "export", "verificationkey", str(zkey), str(vkey))
    if export_result.returncode != 0:
        raise RuntimeError(f"vkey export failed: {export_result.stderr}")
    proof_result = capture(
        [
            "node",
            "tests/owned-proof.js",
            "--shape",
            shape_arg,
            "--case",
            "base",
            "--zkey",
            str(zkey),
            "--vkey",
            str(vkey),
        ]
    )
    observations = json.loads(proof_result.stdout.strip().splitlines()[-1])
    emit(
        {
            "proof_verified": bool(observations.get("verified")),
            # The zkey proved against above is contribution #1 (0001.zkey),
            # not the bare coordinator setup (0000.zkey) — see run_pipeline.
            "key_is_contributed": True,
        }
    )


def mode_ptau_pin(_args):
    ensure_real_ptau()
    emit(
        {
            "ptau_power": read_ptau_power(PTAU_FILE),
            "ptau_matches_pinned_hash": sha256_file(PTAU_FILE) == PTAU_SHA256,
        }
    )


def mode_no_secrets_committed(_args):
    tracked = capture(
        ["git", "ls-files", "--", "*.zkey", ".scratch"],
    ).stdout.split()
    real_state_modified = False
    if REAL_CEREMONY_DIR.exists():
        status = capture(
            ["git", "status", "--porcelain", "--", "ceremony"],
        ).stdout.strip()
        real_state_modified = bool(status)
    emit(
        {
            "tracked_dry_run_files": len(tracked),
            "real_state_modified": real_state_modified,
        }
    )


MODES = {
    "contributions": mode_contributions,
    "manifest": mode_manifest,
    "zkey-verify": mode_zkey_verify,
    "verifying-keys": mode_verifying_keys,
    "prove-verify": mode_prove_verify,
    "ptau-pin": mode_ptau_pin,
    "no-secrets-committed": mode_no_secrets_committed,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in MODES:
        print(f"usage: {sys.argv[0]} <{'|'.join(MODES)}> [args...]", file=sys.stderr)
        sys.exit(2)
    MODES[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    main()
