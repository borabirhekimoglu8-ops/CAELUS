fn main() {
    println!("cargo:rustc-check-cfg=cfg(caelus_neural_differential_harness)");
    println!("cargo:rustc-cfg=caelus_neural_differential_harness");
}
