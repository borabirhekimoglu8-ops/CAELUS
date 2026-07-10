// CAELUS OS — caelus_core: Nedensel Çekirdek (no_std + alloc)
//
// include/causal_engine.h (C++17) motorunun SADIK Rust portu.
// Tasarım sözleşmesi (F1, docs/FIZIBILITE_ISPAT_VE_GOMULU.md):
//
//   1. BİT-BİT EŞDEĞERLİK — aynı senaryo grafı + aynı tick akışı + aynı seed,
//      C++ motoruyla AYNI sabit-nokta değerlerini ve snapshot alanlarını
//      üretmek ZORUNDADIR. Eşitlik tests/run_bs_exec_golden.py diferansiyel
//      koşumuyla (üç BS senaryosunda SHA-256 hash eşitliği) doğrulanır.
//
//   2. no_std + alloc — çekirdek hiçbir std API'si kullanmaz; Cortex-M sınıfı
//      hedeflere (F3) taşınabilir. Harness/test katmanı "std" feature'ı ister.
//
//   3. Sadakat > şıklık — motor semantiği iki dile birlikte iner. Lockout
//      expiry, u64 tick karşılaştırmaları ve fixed-point snapshot alanları
//      C++ ile Rust'ta aynı test/diferansiyel kapıdan geçmek ZORUNDADIR.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod det_rng;
pub mod engine;
pub mod fp;
pub mod neural_contract;
pub mod neural_gate;
pub mod neural_hash;
pub mod neural_runtime;

pub use det_rng::DetRng;
pub use engine::{
    CausalEngine, Edge, EngineSnapshot, FeedbackLoop, Hysteresis, Lever, LeverOutcome, Node,
    NodeKind,
};
pub use fp::{
    d_to_fp, fp_add_saturating, fp_clamp, fp_div, fp_mul, fp_to_d, FP_ONE, FP_SCALE,
    FRICTION_MAX_FP, FRICTION_MIN_FP, FRICTION_OUTAGE_FP,
};
