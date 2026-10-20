pragma circom 2.0.0;

// Entry point for the Ledger circuit (hidden-balance channel move).
// Ledger is not an Armada pool shape, so it is not in scripts/compile.sh's
// SHAPES array; it compiles on its own via scripts/compile-ledger.sh.
include "../operations/Ledger.circom";

component main {public [prevCommitment, nextCommitment]} = Ledger();
