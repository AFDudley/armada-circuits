# scripts/ceremony/

Phase-2 Groth16 trusted-setup ceremony tooling. See `docs/CEREMONY.md` for
the runbook. `lib.sh`'s `DEFAULT_SHAPES` names every shape onboarded to
this one ceremony so far (currently the three owned Transact shapes); it
grows as more shapes join — never fork a second ceremony implementation.

- `lib.sh` — shared constants (pinned ptau URL/sha256/power, shape list)
  and helpers. Sourced by every other script here.
- `fetch-ptau.sh` — downloads and checksums the pinned Hermez ptau into
  `build/ptau/` (gitignored).
- `init.sh` — coordinator: Phase-2 `groth16 setup` per shape, writes/updates
  `manifest.json`.
- `contribute.sh` — a contributor's one Phase-2 contribution to one shape.
- `verify.sh` — read-only: checks manifest integrity and the full
  cryptographic contribution chain (`snarkjs zkey verify`).
- `finalize.sh` — coordinator: applies the public random beacon once
  contributions close.
- `test-e2e.sh` — dry run of the full flow on a throwaway ptau; proves the
  mechanics without touching real ceremony state.
- `check_owned.py` — acceptance probe for pebble arx-a36 (owned shapes
  join this ceremony). Drives the scripts above for real, against the real
  pinned ptau, inside an isolated `.scratch/` directory; never reads or
  writes the real `ceremony/` directory. See `docs/CEREMONY.md` for the
  known external blocker on the pinned ptau mirror.

`CEREMONY_DIR` and `CEREMONY_SHAPES` env overrides exist so a script can
run against an isolated state instead of the real `ceremony/` directory —
every test/check script here uses one or both; never run the real flow
without understanding which directory it is pointed at.
