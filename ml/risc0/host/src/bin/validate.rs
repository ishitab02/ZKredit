//! Diagnostic: parse vk.bin + seal.bin (groth16.rs blob layout) and check each
//! BN254 point is on-curve / in-subgroup, to pinpoint a bad VK coordinate.
use ark_bn254::{Fq, Fq2, G1Affine, G2Affine};
use ark_ff::PrimeField;
use std::fs;

fn fq(b: &[u8]) -> Fq {
    Fq::from_be_bytes_mod_order(b)
}

fn check_g1(name: &str, b: &[u8]) {
    let p = G1Affine::new_unchecked(fq(&b[0..32]), fq(&b[32..64]));
    println!(
        "{name:8} G1  on_curve={} subgroup={}",
        p.is_on_curve(),
        p.is_in_correct_subgroup_assuming_on_curve()
    );
}

fn check_g2(name: &str, b: &[u8]) {
    // blob layout: x.c1 | x.c0 | y.c1 | y.c0  → Fq2::new(c0, c1)
    let x = Fq2::new(fq(&b[32..64]), fq(&b[0..32]));
    let y = Fq2::new(fq(&b[96..128]), fq(&b[64..96]));
    let p = G2Affine::new_unchecked(x, y);
    println!(
        "{name:8} G2  on_curve={} subgroup={}",
        p.is_on_curve(),
        p.is_in_correct_subgroup_assuming_on_curve()
    );
}

fn main() {
    let dir = "../../../contracts/shared/src/risc0_vectors";
    let vk = fs::read(format!("{dir}/vk.bin")).unwrap();
    check_g1("alpha", &vk[0..64]);
    check_g2("beta", &vk[64..192]);
    check_g2("gamma", &vk[192..320]);
    check_g2("delta", &vk[320..448]);
    for i in 0..6 {
        let off = 452 + i * 64;
        check_g1(&format!("ic{i}"), &vk[off..off + 64]);
    }
    if let Ok(seal) = fs::read(format!("{dir}/seal.bin")) {
        check_g1("proof_a", &seal[0..64]);
        check_g2("proof_b", &seal[64..192]);
        check_g1("proof_c", &seal[192..256]);
        // Alt interpretation of proof_b: read the 128 bytes as c0||c1 per coord.
        let b = &seal[64..192];
        let x = Fq2::new(fq(&b[0..32]), fq(&b[32..64]));
        let y = Fq2::new(fq(&b[64..96]), fq(&b[96..128]));
        let p = G2Affine::new_unchecked(x, y);
        println!(
            "proof_b(alt c0||c1) on_curve={} subgroup={}",
            p.is_on_curve(),
            p.is_in_correct_subgroup_assuming_on_curve()
        );
    }
}
