pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// Identity commitment: proves knowledge of a 32-byte `secret` whose Poseidon
// hash equals the public `commitment`, AND binds the proof to a specific caller
// `wallet` so it cannot be replayed by a third party against a different wallet.
//
// Public signals (order): [commitment, wallet]
//   commitment = Poseidon(secret)  — the identity group key (wallet-independent)
//   wallet     = a field element derived from the registering wallet address
//                (addr_to_fr = sha256(strkey) mod r, computed identically by the
//                frontend and by WalletIdentity::register_wallet)
// Private signal: secret
//
// ~ Poseidon(1) is a few hundred R1CS constraints — proves in well under a
// second and fits a 2^12 powers-of-tau ceremony.
template IdentityCommitment() {
    signal input secret;        // private (main inputs are private by default)
    signal input wallet;        // public (anti-replay binding to the caller)
    signal output commitment;   // output signals are public

    component h = Poseidon(1);
    h.inputs[0] <== secret;
    commitment <== h.out;

    // Bind `wallet` into the R1CS with a real (quadratic) constraint so it is a
    // genuine public input the proof commits to. It does not influence the
    // commitment — the group key stays wallet-independent so multiple wallets
    // can share one identity.
    signal walletBound;
    walletBound <== wallet * wallet;
}

// `wallet` is a public input; `commitment` (output) is public by default.
component main {public [wallet]} = IdentityCommitment();
