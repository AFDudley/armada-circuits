pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";

/**
 * Reusable two-party balance-conservation core for a ZK game move.
 *
 * A game circuit includes this file and instantiates GameTemplate() to get
 * the commitment and conservation checks, then adds its own move-validity
 * constraints and wires its own computed balances to balance0Next /
 * balance1Next.
 *
 * Public inputs:  prevCommitment, nextCommitment
 * Private witness: balance0Prev, balance1Prev, balance0Next, balance1Next,
 *                   saltPrev, saltNext
 *
 * prevCommitment === Poseidon(balance0Prev, balance1Prev, saltPrev)
 * nextCommitment === Poseidon(balance0Next, balance1Next, saltNext)
 * Conservation:    balance0Prev + balance1Prev === balance0Next + balance1Next
 *
 * Conservation is the only move rule this template enforces. It says nothing
 * about which party's balance changes, or by how much — the including game
 * circuit narrows that further.
 */
template GameTemplate() {
    signal input prevCommitment;   // public
    signal input nextCommitment;   // public
    signal input balance0Prev;
    signal input balance1Prev;
    signal input balance0Next;
    signal input balance1Next;
    signal input saltPrev;
    signal input saltNext;

    component prevHash = Poseidon(3);
    prevHash.inputs[0] <== balance0Prev;
    prevHash.inputs[1] <== balance1Prev;
    prevHash.inputs[2] <== saltPrev;
    prevCommitment === prevHash.out;

    component nextHash = Poseidon(3);
    nextHash.inputs[0] <== balance0Next;
    nextHash.inputs[1] <== balance1Next;
    nextHash.inputs[2] <== saltNext;
    nextCommitment === nextHash.out;

    balance0Prev + balance1Prev === balance0Next + balance1Next;

    component r0 = Num2Bits(120); r0.in <== balance0Prev;
    component r1 = Num2Bits(120); r1.in <== balance1Prev;
    component r2 = Num2Bits(120); r2.in <== balance0Next;
    component r3 = Num2Bits(120); r3.in <== balance1Next;
}
