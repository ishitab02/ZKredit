pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// Identity commitment: proves knowledge of a 32-byte `secret` whose Poseidon
// hash equals the public `commitment`. Used to link a wallet to an identity
// group without revealing the secret.
//
// Public signal:  commitment  (Poseidon(secret))
// Private signal: secret
//
// ~ Poseidon(1) is a few hundred R1CS constraints — proves in well under a
// second and fits a 2^12 powers-of-tau ceremony.
template IdentityCommitment() {
    signal input secret;        // private (main inputs are private by default)
    signal output commitment;   // output signals are public

    component h = Poseidon(1);
    h.inputs[0] <== secret;
    commitment <== h.out;
}

component main = IdentityCommitment();
