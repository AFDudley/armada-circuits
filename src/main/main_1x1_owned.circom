pragma circom 2.0.0;

// Entry point for the 1x1_owned circuit shape (1 nullifier, 1 commitment)
include "../operations/TransactOwned.circom";

component main {public [merkleRoot, boundParamsHash, nullifiers, commitmentsOut, ownerField, npk]} = TransactOwned(1, 1);
