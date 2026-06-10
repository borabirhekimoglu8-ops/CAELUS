// F2-3 — Motor invariant süpürme harness'ı (deterministik fuzz).
//
// İspat kataloğunun (docs/FIZIBILITE_ISPAT_VE_GOMULU.md §4.2) yürütülebilir
// yükümlülük katmanı: DetRng-sürümlü rastgele graflar üzerinde rastgele komut
// dizileri (tick / lever / inject_intel) koşulur ve HER ADIMDAN SONRA şu
// invariantlar denetlenir:
//
//   I-1 (P-7)  Aralık korunumu: 0 ≤ state ≤ capacity, 0 ≤ reported ≤ capacity,
//              0 ≤ trust ≤ 1.0 (fp); clamped_friction ∈ [1.0, 3.0] (fp).
//   I-2 (P-5)  Outage latch tek yönlülüğü: outage true→false geçişi YALNIZ
//              "başarılı + clear_irrecoverable taşıyan lever" adımında olabilir.
//   I-3 (P-6)  Histerezis tek-atımlılığı: flipped true→false asla olmaz.
//   I-4 (P-8)  regime_exceeded monotonluğu: true→false asla olmaz (reset hariç).
//   I-5        deadline_missed düğüm başına monotoniktir.
//   I-6        Snapshot tutarlılığı: outage ⇒ throughput=0; değilse 1/clamped;
//              any_flip/any_missed bayrakları iç duruma eşittir.
//   I-7        permanent_friction ≥ -1.0 (fp) (lever alt kelepçesi; flip'ler
//              yalnız ekler).
//
// MUTASYON KANITI (elle, F2 kabul kriteri): engine.rs'te check_deadlines
// içindeki latch_outage() çağrısı silinirse bu süit FAIL eder
// (perishable deadline outage'ı kurulamaz → I-6/I-2 beklentileri kırılır).

use caelus_core::*;

const SWEEP_SEEDS: u64 = 24;
const STEPS_PER_SEED: u32 = 300;

// ─── Rastgele graf üretimi ───────────────────────────────────────────────────

fn pick(rng: &mut DetRng, n: u64) -> u64 {
    rng.next() % n
}

fn node_id(i: u64) -> String {
    format!("N{i}")
}

fn build_random_engine(seed: u64) -> CausalEngine {
    let mut rng = DetRng::new(seed);
    let mut eng = CausalEngine::new();
    eng.set_prng_seed(seed ^ 0xCAE1_05DE_ADBE_EF00);

    let node_count = 3 + pick(&mut rng, 6); // 3..8
    for i in 0..node_count {
        let mut n = Node::default();
        n.id = node_id(i);
        n.kind = match pick(&mut rng, 6) {
            0 => NodeKind::Service,
            1 => NodeKind::Buffer,
            2 => NodeKind::Queue,
            3 => NodeKind::Perishable,
            4 => NodeKind::Gate,
            _ => NodeKind::Adversary,
        };
        n.capacity_fp = FP_ONE;
        n.state_fp = pick(&mut rng, FP_ONE as u64 + 1) as i64;
        n.reported_state_fp = pick(&mut rng, FP_ONE as u64 + 1) as i64;
        n.trust_fp = pick(&mut rng, FP_ONE as u64 + 1) as i64;
        n.weight_fp = pick(&mut rng, 500_001) as i64;
        if pick(&mut rng, 10) < 3 {
            n.deadline_tick = pick(&mut rng, 40) as i32;
        }
        eng.add_node(n);
    }

    let edge_count = pick(&mut rng, 10);
    for _ in 0..edge_count {
        let mut e = Edge::default();
        e.from = node_id(pick(&mut rng, node_count));
        // %40 agregasyon kenarı (to=""), %60 düğüme yayılım
        e.to = if pick(&mut rng, 10) < 4 {
            String::new()
        } else {
            node_id(pick(&mut rng, node_count))
        };
        e.multiplier_fp = pick(&mut rng, 4_000_001) as i64;
        e.lag_ticks = pick(&mut rng, 6) as i32;
        e.active = pick(&mut rng, 10) < 9;
        eng.add_edge(e);
    }

    let loop_count = pick(&mut rng, 3);
    for li in 0..loop_count {
        let mut f = FeedbackLoop::default();
        f.id = format!("FL{li}");
        let path_len = 1 + pick(&mut rng, 3);
        for _ in 0..path_len {
            f.path.push(node_id(pick(&mut rng, node_count)));
        }
        f.gain_fp = 900_000 + pick(&mut rng, 500_001) as i64; // 0.9 .. 1.4
        eng.add_loop(f);
    }

    let lever_count = 1 + pick(&mut rng, 3);
    for li in 0..lever_count {
        let mut l = Lever::default();
        l.id = format!("L{li}");
        l.success_p_fp = pick(&mut rng, FP_ONE as u64 + 1) as i64;
        l.lockout_ticks = pick(&mut rng, 3) as i32;
        l.cost_ticks = 1 + pick(&mut rng, 4) as i32;
        let mut mk_outcome = |rng: &mut DetRng| {
            let mut o = LeverOutcome::default();
            if pick(rng, 10) < 7 {
                o.target_node_id = node_id(pick(rng, node_count));
                o.state_delta_fp = pick(rng, 800_001) as i64 - 400_000;
                o.trust_delta_fp = pick(rng, 400_001) as i64 - 200_000;
            }
            o.friction_delta_fp = pick(rng, 600_001) as i64 - 300_000;
            o.clear_irrecoverable = pick(rng, 10) < 3;
            o
        };
        l.on_success = mk_outcome(&mut rng);
        l.on_failure = mk_outcome(&mut rng);
        eng.add_lever(l);
    }

    let hyst_count = pick(&mut rng, 4);
    for hi in 0..hyst_count {
        let mut h = Hysteresis::default();
        h.id = format!("H{hi}");
        h.threshold_tick = pick(&mut rng, 50) as i32;
        h.reversible = pick(&mut rng, 2) == 0;
        h.permanent_loss_fp = pick(&mut rng, 400_001) as i64;
        eng.add_hysteresis(h);
    }

    eng
}

// ─── Invariant denetimi ──────────────────────────────────────────────────────

struct PrevState {
    outage: bool,
    regime: bool,
    flips: Vec<bool>,
    missed: Vec<bool>,
}

fn capture(eng: &CausalEngine) -> PrevState {
    PrevState {
        outage: eng.is_outage_active(),
        regime: eng.is_regime_exceeded(),
        flips: eng.hysteresis_list().iter().map(|h| h.flipped).collect(),
        missed: eng.nodes().iter().map(|n| n.deadline_missed).collect(),
    }
}

/// `cleared_by_recovery`: bu adım "başarılı + clear_irrecoverable lever" miydi?
fn check_invariants(
    ctx: &str,
    eng: &CausalEngine,
    snap: Option<&EngineSnapshot>,
    prev: &PrevState,
    cleared_by_recovery: bool,
) {
    // I-1 — aralık korunumu
    for n in eng.nodes() {
        assert!(
            n.state_fp >= 0 && n.state_fp <= n.capacity_fp,
            "{ctx}: I-1 state aralık dışı: {} state={} cap={}",
            n.id,
            n.state_fp,
            n.capacity_fp
        );
        assert!(
            n.reported_state_fp >= 0 && n.reported_state_fp <= n.capacity_fp,
            "{ctx}: I-1 reported aralık dışı: {}",
            n.id
        );
        assert!(
            n.trust_fp >= 0 && n.trust_fp <= FP_ONE,
            "{ctx}: I-1 trust aralık dışı: {} trust={}",
            n.id,
            n.trust_fp
        );
    }

    // I-2 — outage latch tek yönlülüğü
    if prev.outage && !eng.is_outage_active() {
        assert!(
            cleared_by_recovery,
            "{ctx}: I-2 İHLAL — outage, recovery lever DIŞINDA bir yolla temizlendi (T-20)"
        );
    }

    // I-3 — histerezis tek-atımlılığı
    for (i, h) in eng.hysteresis_list().iter().enumerate() {
        assert!(
            !(prev.flips[i] && !h.flipped),
            "{ctx}: I-3 İHLAL — {} flip geri alındı",
            h.id
        );
    }

    // I-4 — regime monotonluğu
    assert!(
        !(prev.regime && !eng.is_regime_exceeded()),
        "{ctx}: I-4 İHLAL — regime_exceeded geri alındı"
    );

    // I-5 — deadline_missed monotonluğu
    for (i, n) in eng.nodes().iter().enumerate() {
        assert!(
            !(prev.missed[i] && !n.deadline_missed),
            "{ctx}: I-5 İHLAL — {} deadline_missed geri alındı",
            n.id
        );
    }

    // I-6 — snapshot tutarlılığı
    if let Some(s) = snap {
        let want_flip = eng.hysteresis_list().iter().any(|h| h.flipped);
        let want_missed = eng.nodes().iter().any(|n| n.deadline_missed);
        assert_eq!(s.any_hysteresis_flip, want_flip, "{ctx}: I-6 any_flip");
        assert_eq!(s.any_deadline_missed, want_missed, "{ctx}: I-6 any_missed");
        assert!(
            s.clamped_friction_fp >= FRICTION_MIN_FP && s.clamped_friction_fp <= FRICTION_MAX_FP,
            "{ctx}: I-6 clamped aralık dışı: {}",
            s.clamped_friction_fp
        );
        if s.outage_active {
            assert_eq!(s.throughput_ratio, 0.0, "{ctx}: I-6 outage throughput");
        } else {
            let want = 1.0 / fp_to_d(s.clamped_friction_fp);
            assert_eq!(s.throughput_ratio, want, "{ctx}: I-6 throughput formülü");
        }
    }

    // I-7 — permanent friction alt sınırı
    assert!(
        eng.permanent_friction_fp() >= -FP_ONE,
        "{ctx}: I-7 İHLAL — permanent_friction < -1.0: {}",
        eng.permanent_friction_fp()
    );
}

// ─── Süpürme ─────────────────────────────────────────────────────────────────

#[test]
fn invariant_sweep_random_graphs_and_command_streams() {
    for seed in 1..=SWEEP_SEEDS {
        let mut eng = build_random_engine(seed * 7919);
        let lever_ids: Vec<String> = eng.levers_list().iter().map(|l| l.id.clone()).collect();
        let mut cmd_rng = DetRng::new(seed.wrapping_mul(0x9E37_79B9));

        let mut prev = capture(&eng);
        for step in 0..STEPS_PER_SEED {
            let ctx = format!("seed={seed} step={step}");
            match pick(&mut cmd_rng, 9) {
                // %66 tick
                0..=5 => {
                    let snap = eng.tick();
                    check_invariants(&ctx, &eng, Some(&snap), &prev, false);
                }
                // %11 inject_intel (evrensel adlar — rastgele grafta çoğunlukla no-op)
                6 => {
                    let coeff = pick(&mut cmd_rng, 1001) as f64 / 1000.0;
                    let level = pick(&mut cmd_rng, 5) as i32 - 1; // -1..3 (clamp testi)
                    eng.inject_intel(coeff, level, "sweep");
                    check_invariants(&ctx, &eng, None, &prev, false);
                }
                // %22 lever
                _ => {
                    let lid = &lever_ids[pick(&mut cmd_rng, lever_ids.len() as u64) as usize];
                    let clears_on_success = eng
                        .levers_list()
                        .iter()
                        .find(|l| l.id == *lid)
                        .map(|l| l.on_success.clear_irrecoverable)
                        .unwrap_or(false);
                    let success = eng.apply_lever(lid, 0);
                    let cleared = success && clears_on_success;
                    check_invariants(&ctx, &eng, None, &prev, cleared);
                }
            }
            prev = capture(&eng);
        }
    }
}

/// Hedefli P-5 senaryosu: perishable deadline latch'i, lever'sız hiçbir komut
/// dizisiyle (tick/intel karışımı) temizlenemez.
#[test]
fn latched_outage_survives_arbitrary_non_lever_streams() {
    for seed in 1..=8u64 {
        let mut eng = CausalEngine::new();
        let mut n = Node::default();
        n.id = String::from("P");
        n.kind = NodeKind::Perishable;
        n.deadline_tick = 1;
        eng.add_node(n);

        let mut h = Hysteresis::default();
        h.id = String::from("H");
        h.threshold_tick = 5;
        h.reversible = false;
        h.permanent_loss_fp = 100_000;
        eng.add_hysteresis(h);

        let _ = eng.run_ticks(2); // deadline_tick=1 → tick_=1'de latch
        assert!(eng.is_outage_active(), "seed={seed}: latch kurulmalıydı");

        let mut rng = DetRng::new(seed);
        for step in 0..200 {
            if pick(&mut rng, 3) == 0 {
                eng.inject_intel(pick(&mut rng, 1001) as f64 / 1000.0, 3, "x");
            } else {
                let _ = eng.tick();
            }
            assert!(
                eng.is_outage_active(),
                "seed={seed} step={step}: I-2 İHLAL — latch lever'sız temizlendi"
            );
        }
    }
}
