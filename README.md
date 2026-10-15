# Armada Circuits

Custom zero-knowledge circuits for the Armada privacy pool.

## Status

**Phase 2 — Circuit Implementation ✅ COMPILED (1x2 shape)**

Circuit sources are written and compiling. Reference vectors captured. Dev trusted setup in progress.

### Milestones
- [x] Phase 0: Specification & Design
- [x] Phase 1: Reference vector capture (shield + transfer-1x2)
- [x] Phase 2: Circuit implementation — Transact.circomp compiled (1x2 shape, ~20k constraints)
- [ ] Phase 2b: Dev trusted setup + differential test against captured vectors
- [ ] Phase 3: All circuit shapes compiled + integrated

## Architecture

- `src/lib/` — reusable Circom primitives (MerkleTreeProof)
- `src/operations/` — operation-specific circuits parameterized by `(N, M)`
- `src/main/` — entry points (one per circuit shape)
- `docs/` — formal specifications and test vectors
- `scripts/` — deterministic compilation and trusted-setup helpers
- `tests/` — differential and negative tests

## Dependencies

- **circomlib** (GPL-3.0) — Poseidon, EdDSA, BabyJubJub, comparators primitives
- **circom** compiler v2.2.3 (GPL-3.0 build tool)
- **snarkjs** v0.7.6 (GPL-3.0 build tool)

## Proving System

- **Curve**: BN254
- **Protocol**: Groth16
- **Hash**: Poseidon
- **Tree**: binary Merkle tree, depth 16
- **Authorization**: EdDSA over BabyJubJub

## Circuit Shapes

| Nullifiers | Commitments | Operation |
|------------|-------------|-----------|
| 1 | 2 | Shield |
| 1 | 1 | Cross-contract adapt (lend/redeem) |
| 2 | 2 | Simple transfer |
| 2 | 3 | Transfer with change |
| N | 1 | Consolidation unshield |
| 8 | 4 | Medium consolidation / multi-recipient |

See `docs/SPEC.md` for the full matrix and public-input layout.

## Nullifier Disclosure Circuit

`src/operations/NullifierDisclosure.circom` (entry point `src/main/main_disclosure.circom`) supports voluntary selective disclosure (armada-laconic ADR-0020, `engineering/16-selective-disclosure.md`). A user proves that one published nullifier belongs to a note of their wallet, without revealing the `nullifyingKey`.

- **Public inputs:** `statementHash`, `masterPublicKey`, `nullifier`, `treeNumber`, `leafIndex`.
- **Private inputs:** `spendingPublicKey[2]`, `nullifyingKey`, `signature[3]`.
- **Constraints:** `masterPublicKey == Poseidon(Ax, Ay, nullifyingKey)`; `nullifier == Poseidon(nullifyingKey, leafIndex)`; `leafIndex` and `treeNumber` fit in 16 bits; both curve points are on BabyJubJub; the spending key signs `Poseidon(statementHash, masterPublicKey, nullifier, treeNumber, leafIndex)` (circomlib `EdDSAPoseidonVerifier`).
- **Size:** 8,248 non-linear and 1,835 linear constraints (`--O1`).
- **Tests:** `tests/disclosure.test.js`. It checks parity with armada-sdk's recorded engine vectors, reproduces the nullifier and note public key of every captured spend, and runs rejection cases and a Groth16 round trip. It reads the vectors from `../armada-sdk/test/vectors`, or from `ARMADA_SDK_VECTORS`.

## Build

```bash
npm install
CIRCOM_BIN=circom2 npm run compile   # compile all circuits (circom2 = the npm circom build)
npm run setup:dev     # generate dev ptau + zkey (unsafe — testing only)
npm run test          # static analysis + disclosure tests
```

## Security

This repo contains production-intent circuit sources. All changes require review, differential testing against reference test vectors, and formal/static analysis before any artifact is used on mainnet.
