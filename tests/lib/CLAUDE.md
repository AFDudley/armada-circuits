# tests/lib/

Shared helpers for the owned-Transact acceptance scripts under `tests/` and
`scripts/` (pebble arx-aa4). Each acceptance script is self-contained — it
compiles or sets up whatever artifact it needs instead of assuming another
script ran first — and this module holds the logic they share so that stays
true without duplication.

- `owned-circuit.js` — compiles an owned shape (`1x1_owned`, `1x2_owned`,
  `1x3_owned`) with the repo's own `circom2`, builds a small dev-only
  trusted setup and zkey for proving, exports a compiled r1cs to JSON (via
  the `snarkjs` CLI — its `r1csfile` library never returns in this
  environment), and parses `.sym` files to map circuit signal names to
  witness indices. All outputs cache under `build/`, keyed by source file
  mtime, so repeat calls across scripts are cheap.
