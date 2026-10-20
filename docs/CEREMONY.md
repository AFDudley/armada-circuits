# Armada Circuits — Phase-2 Ceremony for the Owned Transact Shapes

This document covers the Phase-2 Groth16 ceremony tooling in
`scripts/ceremony/`, as onboarded to `integrated` for the three owned
Transact shapes: `1x1_owned`, `1x2_owned`, `1x3_owned`.

The 19 plain shapes' production ceremony lives on a separate branch and is
out of scope here. The owned shapes use the exact same scripts and manifest
format — `scripts/ceremony/lib.sh`'s `DEFAULT_SHAPES` currently lists only
the shapes onboarded so far. Adding the plain shapes later means extending
that list, not building a second ceremony.

## Phase 1: the pinned Powers of Tau

Like the plain shapes, the owned shapes' setup uses the public Hermez
perpetual Powers-of-Tau file at power 17
(`powersOfTau28_hez_final_17.ptau`), pinned by sha256 in
`scripts/ceremony/lib.sh`. `scripts/ceremony/fetch-ptau.sh` downloads and
checksums it into `build/ptau/` (gitignored).

**Known issue, as of 2026-10-20:** the pinned URL
(`storage.googleapis.com/zkevm/ptau/...`) and its documented S3 mirror
(`hermez.s3-eu-west-1.amazonaws.com/...`) both now return HTTP 403 — the
objects are no longer publicly readable. `fetch-ptau.sh` fails loudly
against both; no working alternate mirror for this exact pinned file was
found. Anyone resuming this work needs either a currently-public mirror
whose contents hash-match the pinned sha256, or a trusted copy of the
original file to re-host.

## Running the ceremony for the owned shapes

```bash
npm ci && npm run compile
scripts/ceremony/fetch-ptau.sh
CEREMONY_DIR=<a dir outside the real ceremony state> \
  scripts/ceremony/init.sh --announce-height <H>
CEREMONY_ENTROPY="..." scripts/ceremony/contribute.sh 1x2_owned <handle>
scripts/ceremony/verify.sh --all
```

`CEREMONY_DIR` defaults to the committed `ceremony/` directory, which does
not exist on `integrated` yet — this task does not create it. The real,
public, multi-party ceremony for these shapes (contributor PRs per
`ceremony/<shape>/NNNN-<handle>.md`, as the plain shapes' ceremony does)
is a follow-up, not part of this change.

## Proving the mechanism: `scripts/ceremony/check_owned.py`

`scripts/ceremony/check_owned.py` is the acceptance probe for this task
(pebble arx-a36). Each mode drives the real `scripts/ceremony/*.sh` tooling
end to end — setup, one coordinator contribution, `snarkjs zkey verify`,
verification-key export, and a real proof against the contributed key —
inside a fresh dry-run directory under `.scratch/` (gitignored, recreated
each run). It never reads or writes the real `ceremony/` directory, and
never commits a zkey (zkeys and ptau files are gitignored repo-wide).

```bash
python3 scripts/ceremony/check_owned.py contributions
python3 scripts/ceremony/check_owned.py manifest
python3 scripts/ceremony/check_owned.py zkey-verify
python3 scripts/ceremony/check_owned.py verifying-keys
python3 scripts/ceremony/check_owned.py prove-verify transact-owned-1x2
python3 scripts/ceremony/check_owned.py ptau-pin
python3 scripts/ceremony/check_owned.py no-secrets-committed
```

Every mode except `no-secrets-committed` needs the real pinned ptau, so
each currently fails at the `fetch-ptau.sh` step described above — a
confirmed external-resource blocker, not a defect in the tooling. The
mechanics were validated locally against a structurally identical
power-17 ptau (same format, different — non-pinned — contents) with every
downstream step passing: setup, contribution, `ZKey Ok!` verification,
verification-key export, and a real `groth16.verify` of a proof built
against the contributed key.
