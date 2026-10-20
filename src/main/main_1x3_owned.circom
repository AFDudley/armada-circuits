pragma circom 2.0.0;

// Entry point for the 1x3_owned circuit shape (3 nullifiers, 3 commitments)
include "../operations/TransactOwned.circom";

component main {public [merkleRoot, boundParamsHash, nullifiers, commitmentsOut, ownerField, npk[3]]} = TransactOwned(3, 3);
