pragma circom 2.0.0;

/**
 * Armada TransactOwned Circuit (owned note variants)
 *
 * Owned variants: 1x1_owned, 1x2_owned, 1x3_owned.
 * A contract owns the shielded note:
 *   - ownerField = uint256(uint160(owner)) is a public input
 *   - The note's public key is derived as npk = Poseidon(ownerField, random)
 *   - Contains no EdDSA signature check (c5)
 *
 * Public inputs: [merkleRoot, boundParamsHash, nullifiers[N], commitmentsOut[M], ownerField]
 * Public input: npk (per input note, carried by the proof)
 *
 * c6: removing EdDSA leaves no unconstrained public input — boundParamsHash is
 * constrained to the transaction message hash below.
 */

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "../lib/merkle.circom";

template TransactOwned(N, M) {
  // ── Public inputs ──────────────────────────────────────
  signal input merkleRoot;
  signal input boundParamsHash;
  signal input nullifiers[N];
  signal input commitmentsOut[M];
  signal input ownerField;              // uint256(uint160(owner)) — public input for owned note

  // ── Private witness ──────────────────────────────────
  signal input token;
  signal input nullifyingKey;
  signal input randomIn[N];
  signal input valueIn[N];
  signal input pathElements[N * 16];
  signal input leavesIndices[N];
  signal input npkOut[M];
  signal input valueOut[M];

  // ── Public output: per-note public key ───────────────
  // npk[i] = Poseidon(ownerField, randomIn[i]) — the owned note's public key.
  signal input npk[N];
  component npkHashes[N];
  for (var i = 0; i < N; i++) {
    npkHashes[i] = Poseidon(2);
    npkHashes[i].inputs[0] <== ownerField;
    npkHashes[i].inputs[1] <== randomIn[i];
    npk[i] === npkHashes[i].out;
  }

  // 2. Compute input commitments
  component commHashes[N];
  for (var i = 0; i < N; i++) {
    commHashes[i] = Poseidon(3);
    commHashes[i].inputs[0] <== npk[i];
    commHashes[i].inputs[1] <== token;
    commHashes[i].inputs[2] <== valueIn[i];
  }

  // 3. Merkle membership
  component merkleProofs[N];
  for (var i = 0; i < N; i++) {
    merkleProofs[i] = MerkleTreeProof(16);
    merkleProofs[i].leaf <== commHashes[i].out;
    for (var j = 0; j < 16; j++) {
      merkleProofs[i].pathElements[j] <== pathElements[i * 16 + j];
    }
    merkleProofs[i].pathIndices <== leavesIndices[i];
    merkleRoot === merkleProofs[i].root;
  }

  // 4. Nullifiers
  component nullifierHashes[N];
  for (var i = 0; i < N; i++) {
    nullifierHashes[i] = Poseidon(2);
    nullifierHashes[i].inputs[0] <== nullifyingKey;
    nullifierHashes[i].inputs[1] <== leavesIndices[i];
    nullifiers[i] <== nullifierHashes[i].out;
  }

  // 5. Output commitments
  component outCommHashes[M];
  for (var j = 0; j < M; j++) {
    outCommHashes[j] = Poseidon(3);
    outCommHashes[j].inputs[0] <== npkOut[j];
    outCommHashes[j].inputs[1] <== token;
    outCommHashes[j].inputs[2] <== valueOut[j];
    commitmentsOut[j] <== outCommHashes[j].out;
  }

  // 6. Value conservation + range checks
  component valueInRange[N];
  for (var i = 0; i < N; i++) {
    valueInRange[i] = Num2Bits(120);
    valueInRange[i].in <== valueIn[i];
  }
  component valueOutRange[M];
  for (var j = 0; j < M; j++) {
    valueOutRange[j] = Num2Bits(120);
    valueOutRange[j].in <== valueOut[j];
  }
  signal sumIn;
  signal sumOut;
  var accIn = 0;
  var accOut = 0;
  for (var i = 0; i < N; i++) { accIn += valueIn[i]; }
  for (var j = 0; j < M; j++) { accOut += valueOut[j]; }
  sumIn <== accIn;
  sumOut <== accOut;
  sumIn === sumOut;

  // 7. Constrain boundParamsHash (c6: no unconstrained public input after EdDSA removal)
  // boundParamsHash is bound to the transaction message hash:
  // boundParamsHash === Poseidon(merkleRoot, nullifiers, commitmentsOut)
  component msgHash = Poseidon(1 + N + M);
  msgHash.inputs[0] <== merkleRoot;
  for (var i = 0; i < N; i++) {
    msgHash.inputs[1 + i] <== nullifiers[i];
  }
  for (var j = 0; j < M; j++) {
    msgHash.inputs[1 + N + j] <== commitmentsOut[j];
  }
  boundParamsHash === msgHash.out;
}

// Entry points for the owned variants live in src/main/ (main_1x*_owned.circom).
