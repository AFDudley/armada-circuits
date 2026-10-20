pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../lib/game-template.circom";

/**
 * Armada Battleship Circuit
 *
 * Proves one conserved hidden-balance move of a turn-based Battleship game.
 * N = 9 cells (a 3x3 grid) and SHIPS = 3 are the minimal pedagogical
 * instance; a real board shape (contiguous ships, no overlap) is out of
 * scope for this circuit.
 *
 * Public inputs, in declaration order:
 *   prevCommitment, nextCommitment, boardCommitment, target, result, stake
 * Private witness:
 *   balance0Prev, balance1Prev, saltPrev, saltNext, cell[N], boardSalt,
 *   selector[N]
 *
 * The defender committed its board once as Poseidon(boardPacked, boardSalt),
 * where boardPacked packs the N cell bits into one field element. On a
 * turn, the attacker names a cell `target`; the defender proves the public
 * `result` (1 hit, 0 miss) equals its committed board's cell at `target`,
 * without revealing any other cell. A hit moves `stake` from the defender
 * (player 1) to the attacker (player 0); a miss moves nothing. The balances
 * commit and conserve through GameTemplate.
 */
template Battleship() {
    var N = 9;
    var SHIPS = 3;

    // ── Public inputs ──────────────────────────────────────────
    signal input prevCommitment;
    signal input nextCommitment;
    signal input boardCommitment;
    signal input target;
    signal input result;
    signal input stake;

    // ── Private witness ────────────────────────────────────────
    signal input balance0Prev;
    signal input balance1Prev;
    signal input saltPrev;
    signal input saltNext;
    signal input cell[N];
    signal input boardSalt;
    signal input selector[N];

    // ════════════════════════════════════════════════════════════
    // CONSTRAINTS
    // ════════════════════════════════════════════════════════════

    // 1. Each board cell is a bit: water (0) or ship (1).
    for (var i = 0; i < N; i++) {
        cell[i] * (cell[i] - 1) === 0;
    }

    // 2. Fixed ship count. Blocks the empty-board cheat, where a defender
    //    with no ships always answers "miss".
    var shipSum = 0;
    for (var i = 0; i < N; i++) {
        shipSum += cell[i];
    }
    shipSum === SHIPS;

    // 3. Board commitment binds the hidden board. Pack the bits into one
    //    field element, then commit to the packed board and its salt.
    var packedSum = 0;
    for (var i = 0; i < N; i++) {
        packedSum += cell[i] * (2 ** i);
    }
    signal boardPacked;
    boardPacked <== packedSum;

    component bc = Poseidon(2);
    bc.inputs[0] <== boardPacked;
    bc.inputs[1] <== boardSalt;
    boardCommitment === bc.out;

    // 4. selector is one-hot and points at target.
    for (var i = 0; i < N; i++) {
        selector[i] * (selector[i] - 1) === 0;
    }
    var selSum = 0;
    var targetSum = 0;
    for (var i = 0; i < N; i++) {
        selSum += selector[i];
        targetSum += i * selector[i];
    }
    // Route the one-hot sum through a signal: circomspect's side-effect
    // analysis does not recognize a bare `var === <constant>` constraint
    // as using the var, and flags it as dead despite circom enforcing it.
    signal selectorSum;
    selectorSum <== selSum;
    selectorSum === 1;
    targetSum === target;

    // 5. result is the committed cell at target. A lying defender who
    //    claims a miss on a ship cell fails this constraint.
    signal prod[N];
    signal acc[N];
    prod[0] <== selector[0] * cell[0];
    acc[0] <== prod[0];
    for (var i = 1; i < N; i++) {
        prod[i] <== selector[i] * cell[i];
        acc[i] <== acc[i - 1] + prod[i];
    }
    result === acc[N - 1];

    // 6. Payoff. A hit (result = 1) moves stake from the defender to the
    //    attacker; a miss (result = 0) moves nothing.
    signal balance0Next;
    signal balance1Next;
    balance0Next <== balance0Prev + stake * result;
    balance1Next <== balance1Prev - stake * result;

    // 7. GameTemplate: balance commitments, conservation, 120-bit range
    //    checks all apply to the payoff computed above.
    component core = GameTemplate();
    core.prevCommitment <== prevCommitment;
    core.nextCommitment <== nextCommitment;
    core.balance0Prev <== balance0Prev;
    core.balance1Prev <== balance1Prev;
    core.balance0Next <== balance0Next;
    core.balance1Next <== balance1Next;
    core.saltPrev <== saltPrev;
    core.saltNext <== saltNext;
}

component main {public [prevCommitment, nextCommitment, boardCommitment, target, result, stake]} = Battleship();
