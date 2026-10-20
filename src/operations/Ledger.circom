pragma circom 2.0.0;

/**
 * Armada Ledger Circuit
 *
 * Proves a valid hidden-balance move between two channel participants.
 *
 * Public inputs:  prevCommitment, nextCommitment
 * Private witness: balance0Prev, balance1Prev, balance0Next, balance1Next,
 *                   saltPrev, saltNext
 *
 * prevCommitment === Poseidon(balance0Prev, balance1Prev, saltPrev)
 * nextCommitment === Poseidon(balance0Next, balance1Next, saltNext)
 * Conservation:    balance0Prev + balance1Prev === balance0Next + balance1Next
 *
 * Conservation is the only move rule this circuit enforces. It says nothing
 * about which party's balance changes, or by how much — a game circuit
 * narrows that further.
 */

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";

template Ledger() {
  // ── Public inputs ──────────────────────────────────────────
  signal input prevCommitment;
  signal input nextCommitment;

  // ── Private witness: balances and salts ────────────────────
  signal input balance0Prev;
  signal input balance1Prev;
  signal input balance0Next;
  signal input balance1Next;
  signal input saltPrev;
  signal input saltNext;

  // ════════════════════════════════════════════════════════════
  // CONSTRAINTS
  // ════════════════════════════════════════════════════════════

  // 1. Range checks on all four balances: < 2^120, matching Transact.circom,
  //    to prevent modular-arithmetic wraparound in the conservation check.
  component balance0PrevRange = Num2Bits(120);
  balance0PrevRange.in <== balance0Prev;

  component balance1PrevRange = Num2Bits(120);
  balance1PrevRange.in <== balance1Prev;

  component balance0NextRange = Num2Bits(120);
  balance0NextRange.in <== balance0Next;

  component balance1NextRange = Num2Bits(120);
  balance1NextRange.in <== balance1Next;

  // 2. Bind the old state to its public commitment.
  component prevHash = Poseidon(3);
  prevHash.inputs[0] <== balance0Prev;
  prevHash.inputs[1] <== balance1Prev;
  prevHash.inputs[2] <== saltPrev;
  prevCommitment === prevHash.out;

  // 3. Bind the new state to its public commitment.
  component nextHash = Poseidon(3);
  nextHash.inputs[0] <== balance0Next;
  nextHash.inputs[1] <== balance1Next;
  nextHash.inputs[2] <== saltNext;
  nextCommitment === nextHash.out;

  // 4. Conservation: the move redistributes the total between the two
  //    parties. It does not create or destroy balance.
  balance0Prev + balance1Prev === balance0Next + balance1Next;
}

// Entry point is in src/main/main_ledger.circom.
