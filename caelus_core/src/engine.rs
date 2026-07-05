// CausalEngine — include/causal_engine.h sınıfının SADIK no_std portu.
//
// SADAKAT NOTLARI (bilerek korunan C++ davranışları):
//   • remaining_lockout C++ ile aynı tick sırası içinde azalır: başarısız lever
//     lockout_ticks boyunca bloke edilir, sonra yeniden denenebilir.
//   • check_hysteresis/check_deadlines tick'i u64 sayaçla karşılaştırır; negatif
//     deadline sentinel'i korunur.
//   • propagate_edges delta uygulanan düğümde reported=state yazar (paketin
//     gözlemlenebilirlik maskesini o düğümde ezer — C++ ile aynı).
//   • build_snapshot tick_-1 yazar (wrapping; tick() sonrası çağrıldığından ≥1).
//   • Outage LATCHED durum makinesidir (T-20): yalnız latch_outage() kurar,
//     yalnız başarılı recovery lever'ı (clear_irrecoverable) temizler.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use crate::det_rng::DetRng;
use crate::fp::{
    d_to_fp, fp_add_saturating, fp_clamp, fp_div, fp_mul, fp_to_d, FP_ONE, FP_SCALE,
    FRICTION_MAX_FP, FRICTION_MIN_FP,
};

// ─────────────────────────────────────────────────────────────────────────────
// Veri modeli
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeKind {
    Service = 0,
    Buffer = 1,
    Queue = 2,
    Perishable = 3,
    Gate = 4,
    Adversary = 5,
}

impl NodeKind {
    pub fn from_str(s: &str) -> Self {
        match s {
            "Buffer" => NodeKind::Buffer,
            "Queue" => NodeKind::Queue,
            "Perishable" => NodeKind::Perishable,
            "Gate" => NodeKind::Gate,
            "Adversary" => NodeKind::Adversary,
            _ => NodeKind::Service, // varsayılan (C++ kind_from_str ile aynı)
        }
    }
}

#[derive(Clone, Debug)]
pub struct Node {
    pub id: String,
    pub kind: NodeKind,
    pub capacity_fp: i64,
    pub state_fp: i64,
    pub weight_fp: i64,
    pub reported_state_fp: i64,
    pub trust_fp: i64,
    pub deadline_tick: i32,
    pub deadline_missed: bool,
    pub irrecoverable: bool,
}

impl Default for Node {
    fn default() -> Self {
        Node {
            id: String::new(),
            kind: NodeKind::Service,
            capacity_fp: FP_ONE,
            state_fp: 0,
            weight_fp: 0,
            reported_state_fp: 0,
            trust_fp: FP_ONE,
            deadline_tick: -1,
            deadline_missed: false,
            irrecoverable: false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Edge {
    pub from: String,
    pub to: String, // "" = sürtünme agregasyon kenarı
    pub multiplier_fp: i64,
    pub lag_ticks: i32,
    pub active: bool,
}

impl Default for Edge {
    fn default() -> Self {
        Edge {
            from: String::new(),
            to: String::new(),
            multiplier_fp: FP_ONE,
            lag_ticks: 0,
            active: true,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct FeedbackLoop {
    pub id: String,
    pub path: Vec<String>,
    pub gain_fp: i64,
}

#[derive(Clone, Debug, Default)]
pub struct LeverOutcome {
    pub target_node_id: String,
    pub state_delta_fp: i64,
    pub trust_delta_fp: i64,
    pub friction_delta_fp: i64,
    pub clear_irrecoverable: bool,
}

#[derive(Clone, Debug)]
pub struct Lever {
    pub id: String,
    pub target: String,
    pub success_p_fp: i64,
    pub cost_ticks: i32,
    pub lockout_ticks: i32,
    pub on_success: LeverOutcome,
    pub on_failure: LeverOutcome,
    pub remaining_lockout: i32,
    pub available: bool,
}

impl Default for Lever {
    fn default() -> Self {
        Lever {
            id: String::new(),
            target: String::new(),
            success_p_fp: 500_000,
            cost_ticks: 1,
            lockout_ticks: 0,
            on_success: LeverOutcome::default(),
            on_failure: LeverOutcome::default(),
            remaining_lockout: 0,
            available: true,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Hysteresis {
    pub id: String,
    pub threshold_tick: i32,
    pub reversible: bool,
    pub permanent_loss_fp: i64,
    pub flipped: bool,
}

#[derive(Clone, Debug)]
pub struct EngineSnapshot {
    pub tick: u64,
    pub raw_friction_fp: i64,
    pub clamped_friction_fp: i64,
    pub regime_exceeded: bool,
    pub any_deadline_missed: bool,
    pub any_hysteresis_flip: bool,
    pub outage_active: bool,
    pub throughput_ratio_fp: i64,
    pub throughput_ratio: f64,
    pub summary: String,
}

impl EngineSnapshot {
    pub fn raw_friction_d(&self) -> f64 {
        fp_to_d(self.raw_friction_fp)
    }
    pub fn clamped_friction_d(&self) -> f64 {
        fp_to_d(self.clamped_friction_fp)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CausalEngine
// ─────────────────────────────────────────────────────────────────────────────

pub struct CausalEngine {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
    loops: Vec<FeedbackLoop>,
    levers: Vec<Lever>,
    hysts: Vec<Hysteresis>,

    tick_: u64,
    friction_fp: i64,
    permanent_friction_fp: i64,
    regime_exceeded: bool,
    outage: bool,
    prng_seed: u64,
}

impl Default for CausalEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CausalEngine {
    pub fn new() -> Self {
        CausalEngine {
            nodes: Vec::new(),
            edges: Vec::new(),
            loops: Vec::new(),
            levers: Vec::new(),
            hysts: Vec::new(),
            tick_: 0,
            friction_fp: FP_ONE,
            permanent_friction_fp: 0,
            regime_exceeded: false,
            outage: false,
            prng_seed: 0,
        }
    }

    // ── Graf yapılandırma ────────────────────────────────────────────────────

    pub fn add_node(&mut self, n: Node) {
        self.nodes.push(n);
    }
    pub fn add_edge(&mut self, e: Edge) {
        self.edges.push(e);
    }
    pub fn add_loop(&mut self, f: FeedbackLoop) {
        self.loops.push(f);
    }
    pub fn add_lever(&mut self, l: Lever) {
        self.levers.push(l);
    }
    pub fn add_hysteresis(&mut self, h: Hysteresis) {
        self.hysts.push(h);
    }

    /// Deterministik lever zarı için PRNG tohumu (0 = gerçek CSPRNG yolu yok;
    /// bu çekirdek hostsuz olduğundan 0 → tick tabanlı tohum kullanılır).
    pub fn set_prng_seed(&mut self, seed: u64) {
        self.prng_seed = seed;
    }

    /// Graf + çalışma zamanı durumunu sıfırla. prng_seed KORUNUR (C++ ile aynı).
    pub fn reset(&mut self) {
        self.nodes.clear();
        self.edges.clear();
        self.loops.clear();
        self.levers.clear();
        self.hysts.clear();
        self.tick_ = 0;
        self.friction_fp = FP_ONE;
        self.permanent_friction_fp = 0;
        self.regime_exceeded = false;
        self.outage = false;
    }

    /// Evrensel boş şablon (AWAITING_SCENARIO_INJECTION durumu) — C++ birebir.
    pub fn load_universal_blank_slate(&mut self) {
        self.nodes.clear();
        self.edges.clear();
        self.loops.clear();
        self.levers.clear();
        self.hysts.clear();
        self.tick_ = 0;
        self.friction_fp = FP_ONE;
        self.regime_exceeded = false;
        self.outage = false;
        self.permanent_friction_fp = 0;

        let mut mk = |id: &str, kind: NodeKind, weight: f64| {
            let mut n = Node::default();
            n.id = String::from(id);
            n.kind = kind;
            n.capacity_fp = FP_ONE;
            n.state_fp = 0;
            n.weight_fp = d_to_fp(weight);
            n.reported_state_fp = 0;
            n.trust_fp = FP_ONE;
            self.nodes.push(n);
        };
        mk("Regulatory_Gate", NodeKind::Gate, 0.30);
        mk("Actor_Alpha", NodeKind::Service, 0.35);
        mk("Transit_Node", NodeKind::Queue, 0.20);
        mk("Friction_Entity", NodeKind::Service, 0.15);
        mk("Buffer_Node", NodeKind::Buffer, 0.25);
    }

    // ── Saha verisi enjeksiyonu (evrensel düğüm adları; paket graflarında no-op) ──

    pub fn inject_intel(&mut self, field_coeff: f64, crisis_level: i32, _memo: &str) {
        let field_coeff = field_coeff.clamp(0.0, 1.0);
        self.inject_intel_fp(d_to_fp(field_coeff), crisis_level, _memo);
    }

    pub fn inject_intel_fp(&mut self, field_coeff_fp: i64, crisis_level: i32, _memo: &str) {
        let field_coeff_fp = fp_clamp(field_coeff_fp, 0, FP_ONE);
        let crisis_level = crisis_level.clamp(0, 3);

        if let Some(actor) = self.get_node_mut("Actor_Alpha") {
            if field_coeff_fp > actor.state_fp {
                actor.state_fp = field_coeff_fp;
            }
            actor.reported_state_fp = actor.state_fp;
        }
        if let Some(gate) = self.get_node_mut("Regulatory_Gate") {
            let bump = d_to_fp(crisis_level as f64 * 0.10);
            gate.state_fp = fp_clamp(fp_add_saturating(gate.state_fp, bump), 0, gate.capacity_fp);
            gate.reported_state_fp = gate.state_fp;
        }
        if crisis_level >= 3 {
            if let Some(transit) = self.get_node_mut("Transit_Node") {
                let bump = d_to_fp(0.20);
                transit.state_fp = fp_clamp(
                    fp_add_saturating(transit.state_fp, bump),
                    0,
                    transit.capacity_fp,
                );
                transit.reported_state_fp = transit.state_fp;
            }
        }
    }

    // ── Tick yayılımı ────────────────────────────────────────────────────────

    pub fn tick(&mut self) -> EngineSnapshot {
        self.propagate_edges();
        self.apply_feedback_loops();
        self.update_trust();
        self.decay_lever_lockouts();

        let raw = self.aggregate_friction();
        self.friction_fp = fp_add_saturating(raw, self.permanent_friction_fp);

        self.check_regime(self.friction_fp);
        self.check_hysteresis();
        self.check_deadlines();
        self.tick_ += 1;

        self.build_snapshot()
    }

    pub fn run_ticks(&mut self, n: u32) -> EngineSnapshot {
        let mut snap = self.build_snapshot();
        for _ in 0..n {
            snap = self.tick();
        }
        snap
    }

    // ── İkna kaldıracı ──────────────────────────────────────────────────────

    pub fn apply_lever(&mut self, lever_id: &str, seed: u64) -> bool {
        let li = match self.levers.iter().position(|l| l.id == lever_id) {
            Some(i) => i,
            None => return false,
        };
        if !self.levers[li].available || self.levers[li].remaining_lockout > 0 {
            return false;
        }

        // Deterministik olasılık — C++: seed ? seed : (prng_seed_ ? prng_seed_+tick_ : tick_)
        let s = if seed != 0 {
            seed
        } else if self.prng_seed != 0 {
            self.prng_seed.wrapping_add(self.tick_)
        } else {
            self.tick_
        };
        let mut rng = DetRng::new(s);
        let roll = (rng.next() % (FP_SCALE as u64)) as i64;
        let success = roll < self.levers[li].success_p_fp;

        let outcome = if success {
            self.levers[li].on_success.clone()
        } else {
            self.levers[li].on_failure.clone()
        };

        if !outcome.target_node_id.is_empty() {
            if let Some(n) = self
                .nodes
                .iter_mut()
                .find(|n| n.id == outcome.target_node_id)
            {
                n.state_fp = fp_clamp(
                    fp_add_saturating(n.state_fp, outcome.state_delta_fp),
                    0,
                    n.capacity_fp,
                );
                n.trust_fp = fp_clamp(
                    fp_add_saturating(n.trust_fp, outcome.trust_delta_fp),
                    0,
                    FP_ONE,
                );
                n.reported_state_fp = n.state_fp;
                if success && outcome.clear_irrecoverable {
                    n.irrecoverable = false;
                }
            }
        }
        if success && outcome.clear_irrecoverable {
            self.clear_outage_recovery();
        }
        if outcome.friction_delta_fp != 0 {
            self.permanent_friction_fp = fp_clamp(
                fp_add_saturating(self.permanent_friction_fp, outcome.friction_delta_fp),
                -FP_ONE,
                FRICTION_MAX_FP,
            );
        }
        let action_cost_lockout = if self.levers[li].cost_ticks > 1 {
            self.levers[li].cost_ticks - 1
        } else {
            0
        };
        self.levers[li].remaining_lockout = if success {
            action_cost_lockout
        } else {
            core::cmp::max(action_cost_lockout, self.levers[li].lockout_ticks)
        };
        success
    }

    // ── Sorgulama ────────────────────────────────────────────────────────────

    pub fn current_tick(&self) -> u64 {
        self.tick_
    }
    pub fn friction_fp(&self) -> i64 {
        self.friction_fp
    }
    pub fn is_regime_exceeded(&self) -> bool {
        self.regime_exceeded
    }
    pub fn is_outage_active(&self) -> bool {
        self.outage
    }

    pub fn friction_multiplier(&self) -> f64 {
        fp_to_d(fp_clamp(self.friction_fp, FRICTION_MIN_FP, FRICTION_MAX_FP))
    }

    pub fn get_node(&self, id: &str) -> Option<&Node> {
        self.nodes.iter().find(|n| n.id == id)
    }

    // ── Salt-okunur iç durum erişimcileri (invariant doğrulama / UI için) ────
    // Motor semantiğini DEĞİŞTİRMEZLER; F2 invariant süpürme harness'ı bunlarla
    // her adımda P-5/P-6/P-7/P-8 yükümlülüklerini denetler.

    pub fn nodes(&self) -> &[Node] {
        &self.nodes
    }
    pub fn edges(&self) -> &[Edge] {
        &self.edges
    }
    pub fn hysteresis_list(&self) -> &[Hysteresis] {
        &self.hysts
    }
    pub fn levers_list(&self) -> &[Lever] {
        &self.levers
    }
    pub fn permanent_friction_fp(&self) -> i64 {
        self.permanent_friction_fp
    }
    fn get_node_mut(&mut self, id: &str) -> Option<&mut Node> {
        self.nodes.iter_mut().find(|n| n.id == id)
    }

    // ── Özel hesaplama fonksiyonları ─────────────────────────────────────────

    fn aggregate_friction(&self) -> i64 {
        let mut total = FP_ONE; // taban 1.0x

        // Düğüm ağırlık katkıları (raporlanan durum × güven × ağırlık)
        for node in &self.nodes {
            if node.weight_fp == 0 || node.capacity_fp == 0 {
                continue;
            }
            let utilization = fp_div(node.reported_state_fp, node.capacity_fp);
            let trusted_util = fp_mul(node.trust_fp, utilization);
            total = fp_add_saturating(total, fp_mul(trusted_util, node.weight_fp));
        }

        // Agregasyon kenarları (to == "")
        for edge in &self.edges {
            if !edge.active || !edge.to.is_empty() {
                continue;
            }
            if edge.lag_ticks > 0 && self.tick_ < edge.lag_ticks as u64 {
                continue;
            }
            let from = match self.get_node(&edge.from) {
                Some(n) if n.capacity_fp != 0 => n,
                _ => continue,
            };
            let util = fp_div(from.reported_state_fp, from.capacity_fp);
            total = fp_add_saturating(
                total,
                fp_mul(fp_mul(from.trust_fp, util), edge.multiplier_fp),
            );
        }

        // Geri besleme döngüsü güçlendirmesi (gerçek durum üzerinden min sinyal)
        for lp in &self.loops {
            if lp.path.is_empty() || lp.gain_fp <= FP_ONE {
                continue;
            }
            let mut signal = FP_ONE;
            for nid in &lp.path {
                let n = match self.get_node(nid) {
                    Some(n) if n.capacity_fp != 0 => n,
                    _ => continue,
                };
                let u = fp_div(n.state_fp, n.capacity_fp);
                if u < signal {
                    signal = u;
                }
            }
            total = fp_add_saturating(total, fp_mul(lp.gain_fp - FP_ONE, signal));
        }

        total
    }

    fn propagate_edges(&mut self) {
        const DAMP_FP: i64 = 50_000; // 0.05 per tick

        struct Delta {
            idx: usize,
            val: i64,
        }
        let mut deltas: Vec<Delta> = Vec::with_capacity(self.edges.len());

        for edge in &self.edges {
            if !edge.active || edge.to.is_empty() {
                continue;
            }
            if edge.lag_ticks > 0 && self.tick_ < edge.lag_ticks as u64 {
                continue;
            }
            let from = match self.get_node(&edge.from) {
                Some(n) if n.capacity_fp != 0 => n,
                _ => continue,
            };
            let to_idx = match self.nodes.iter().position(|n| n.id == edge.to) {
                Some(i) => i,
                None => continue,
            };

            let utilization = fp_div(from.state_fp, from.capacity_fp);
            let trusted_u = fp_mul(from.trust_fp, utilization);
            let delta = fp_mul(fp_mul(trusted_u, edge.multiplier_fp), DAMP_FP);
            deltas.push(Delta {
                idx: to_idx,
                val: delta,
            });
        }

        for d in &deltas {
            let n = &mut self.nodes[d.idx];
            n.state_fp = fp_clamp(fp_add_saturating(n.state_fp, d.val), 0, n.capacity_fp);
            n.reported_state_fp = n.state_fp; // gizleme yoksa raporlanan = gerçek
        }
    }

    fn apply_feedback_loops(&mut self) {
        const LOOP_DAMP_FP: i64 = 10_000; // 0.01 per tick

        for lpi in 0..self.loops.len() {
            if self.loops[lpi].path.is_empty() || self.loops[lpi].gain_fp <= FP_ONE {
                continue;
            }

            let mut min_signal = FP_ONE;
            for ni in 0..self.loops[lpi].path.len() {
                let nid = &self.loops[lpi].path[ni];
                let n = match self.get_node(nid) {
                    Some(n) if n.capacity_fp != 0 => n,
                    _ => continue,
                };
                let u = fp_div(n.state_fp, n.capacity_fp);
                if u < min_signal {
                    min_signal = u;
                }
            }

            let gain = self.loops[lpi].gain_fp;
            let first_id = self.loops[lpi].path[0].clone();
            if let Some(first) = self.get_node_mut(&first_id) {
                let amplification = fp_mul(fp_mul(gain - FP_ONE, min_signal), LOOP_DAMP_FP);
                first.state_fp = fp_clamp(
                    fp_add_saturating(first.state_fp, amplification),
                    0,
                    first.capacity_fp,
                );
                first.reported_state_fp = first.state_fp;
            }
        }
    }

    fn update_trust(&mut self) {
        const DEVIATION_THRESHOLD_FP: i64 = 180_000; // 0.18

        for node in &mut self.nodes {
            if node.capacity_fp == 0 {
                continue;
            }
            let diff = fp_add_saturating(node.reported_state_fp, -node.state_fp);
            let mag = diff.unsigned_abs();
            let abs_diff = if mag > i64::MAX as u64 {
                i64::MAX
            } else {
                mag as i64
            };
            let deviation = fp_div(abs_diff, node.capacity_fp);

            if deviation > DEVIATION_THRESHOLD_FP {
                // Güven katsayısını azalt (minimum %10) — C++ ile aynı düz çıkarma
                node.trust_fp = fp_clamp(node.trust_fp - 10_000, 100_000, FP_ONE);
            }
        }
    }

    fn decay_lever_lockouts(&mut self) {
        for lever in &mut self.levers {
            if lever.remaining_lockout > 0 {
                lever.remaining_lockout -= 1;
            }
        }
    }

    fn check_regime(&mut self, raw_fp: i64) {
        if raw_fp > FRICTION_MAX_FP && !self.regime_exceeded {
            self.regime_exceeded = true;
        }
    }

    fn check_hysteresis(&mut self) {
        let mut latch = false;
        for h in &mut self.hysts {
            let threshold = if h.threshold_tick <= 0 {
                0
            } else {
                h.threshold_tick as u64
            };
            if h.flipped || self.tick_ < threshold {
                continue;
            }
            h.flipped = true;
            if !h.reversible {
                self.permanent_friction_fp =
                    fp_add_saturating(self.permanent_friction_fp, h.permanent_loss_fp);
                latch = true;
            }
        }
        if latch {
            self.latch_outage();
        }
    }

    fn check_deadlines(&mut self) {
        let mut latch = false;
        for node in &mut self.nodes {
            if node.deadline_tick < 0 || node.deadline_missed {
                continue;
            }
            if self.tick_ >= node.deadline_tick as u64 {
                node.deadline_missed = true;
                if node.kind == NodeKind::Perishable {
                    // Perishable deadline → açık recovery'ye dek LATCHED outage.
                    node.irrecoverable = true;
                    latch = true;
                }
            }
        }
        if latch {
            self.latch_outage();
        }
    }

    /// Outage durum makinesi: kritik olaylar yalnızca LATCH eder.
    fn latch_outage(&mut self) {
        self.outage = true;
    }

    /// Başarılı recovery lever'ı outage latch'ini ve irrecoverable bayraklarını temizler.
    fn clear_outage_recovery(&mut self) {
        self.outage = false;
        for node in &mut self.nodes {
            node.irrecoverable = false;
        }
    }

    /// Mevcut durumdan EngineSnapshot üret — C++ build_snapshot birebir.
    pub fn build_snapshot(&self) -> EngineSnapshot {
        let clamped = fp_clamp(self.friction_fp, FRICTION_MIN_FP, FRICTION_MAX_FP);
        let any_flip = self.hysts.iter().any(|h| h.flipped);
        let any_missed = self.nodes.iter().any(|n| n.deadline_missed);

        let (throughput_ratio_fp, throughput_ratio, summary) = if self.outage {
            (0, 0.0, format!("OUTAGE: throughput=0, tick={}", self.tick_))
        } else {
            let ratio_fp = fp_div(FP_ONE, clamped);
            (
                ratio_fp,
                fp_to_d(ratio_fp),
                format!(
                    "mu={:.3}x{}",
                    fp_to_d(clamped),
                    if self.regime_exceeded {
                        " REGIME_EXCEEDED"
                    } else {
                        ""
                    }
                ),
            )
        };

        EngineSnapshot {
            tick: self.tick_.wrapping_sub(1),
            raw_friction_fp: self.friction_fp,
            clamped_friction_fp: clamped,
            regime_exceeded: self.regime_exceeded,
            any_deadline_missed: any_missed,
            any_hysteresis_flip: any_flip,
            outage_active: self.outage,
            throughput_ratio_fp,
            throughput_ratio,
            summary,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Birim testleri — doctest vakaları + T-20 latch invariantları
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_slate_stays_neutral_until_scenario_injection() {
        let mut eng = CausalEngine::new();
        eng.load_universal_blank_slate();
        let snap = eng.run_ticks(3);
        assert_eq!(snap.raw_friction_fp, FP_ONE);
        assert_eq!(snap.clamped_friction_fp, FP_ONE);
        assert_eq!(snap.throughput_ratio_fp, FP_ONE);
        assert!(!snap.regime_exceeded);
        assert!(!snap.outage_active);
        assert!((snap.throughput_ratio - 1.0).abs() < 1e-12);
    }

    #[test]
    fn intel_injection_can_change_causal_friction() {
        let mut eng = CausalEngine::new();
        eng.load_universal_blank_slate();
        eng.inject_intel(0.82, 2, "test");
        let snap = eng.run_ticks(1);
        assert!(snap.raw_friction_fp > FP_ONE);
    }

    #[test]
    fn perishable_deadline_latches_outage_until_recovery_lever() {
        let mut eng = CausalEngine::new();
        let mut n = Node::default();
        n.id = String::from("P");
        n.kind = NodeKind::Perishable;
        n.deadline_tick = 2;
        eng.add_node(n);

        let mut lever = Lever::default();
        lever.id = String::from("L-RECOVER");
        lever.success_p_fp = FP_ONE; // kesin başarı
        lever.on_success.target_node_id = String::from("P");
        lever.on_success.clear_irrecoverable = true;
        eng.add_lever(lever);

        let snap = eng.run_ticks(3);
        assert!(snap.outage_active, "deadline latch etmeli");
        // Sonraki tick'ler latch'i SİLEMEZ (T-20)
        let snap2 = eng.run_ticks(5);
        assert!(snap2.outage_active, "latch yan etkiyle silinemez");
        // Yalnız başarılı recovery lever temizler
        assert!(eng.apply_lever("L-RECOVER", 0));
        assert!(!eng.is_outage_active());
    }

    #[test]
    fn non_reversible_flip_latches_and_is_one_shot() {
        let mut eng = CausalEngine::new();
        let mut h = Hysteresis::default();
        h.id = String::from("H");
        h.threshold_tick = 3;
        h.reversible = false;
        h.permanent_loss_fp = 220_000;
        eng.add_hysteresis(h);

        // Eşik karşılaştırması PRE-INCREMENT sayaçla yapılır: threshold=3,
        // flip tick_=3 görüldüğünde (4. tick çağrısı) gerçekleşir — C++ ile aynı.
        let s = eng.run_ticks(3); // checks at tick_=0,1,2
        assert!(!s.any_hysteresis_flip);
        let s = eng.run_ticks(1); // check at tick_=3 → flip
        assert!(s.any_hysteresis_flip);
        assert!(s.outage_active);
        // Tick sırası gereği friction histerezis kontrolünden ÖNCE hesaplanır:
        // flip tick'inin snapshot'ı kalıcı kaybı HENÜZ içermez (C++ ile aynı)...
        assert_eq!(s.raw_friction_fp, FP_ONE);
        // ...kayıp bir SONRAKİ tick'te görünür: 1.0 + 0.22 = 1.22
        let s = eng.run_ticks(1);
        assert_eq!(s.raw_friction_fp, FP_ONE + 220_000);
        // flip tek atımlık: tekrar eklenmez
        let s = eng.run_ticks(4);
        assert_eq!(s.raw_friction_fp, FP_ONE + 220_000);
    }

    #[test]
    fn failed_lever_with_lockout_expires_after_ticks() {
        let mut eng = CausalEngine::new();
        let mut lever = Lever::default();
        lever.id = String::from("L");
        lever.success_p_fp = 0; // first attempt is certainly unsuccessful
        lever.lockout_ticks = 2;
        eng.add_lever(lever);

        assert!(!eng.apply_lever("L", 0));
        assert!(!eng.apply_lever("L", 0), "same tick is still locked");
        let _ = eng.run_ticks(1);
        assert!(!eng.apply_lever("L", 0), "one tick of lockout remains");
        let _ = eng.run_ticks(1);
        eng.levers[0].success_p_fp = FP_ONE;
        assert!(
            eng.apply_lever("L", 0),
            "lockout expires after lockout_ticks"
        );
    }

    #[test]
    fn successful_lever_observes_cost_tick_cooldown() {
        let mut eng = CausalEngine::new();
        let mut node = Node::default();
        node.id = String::from("N");
        eng.add_node(node);

        let mut lever = Lever::default();
        lever.id = String::from("L");
        lever.success_p_fp = FP_ONE;
        lever.cost_ticks = 3;
        lever.on_success.target_node_id = String::from("N");
        lever.on_success.state_delta_fp = 100_000;
        eng.add_lever(lever);

        assert!(eng.apply_lever("L", 0));
        assert_eq!(eng.get_node("N").unwrap().state_fp, 100_000);
        assert!(!eng.apply_lever("L", 0));
        assert_eq!(eng.get_node("N").unwrap().state_fp, 100_000);
        let _ = eng.run_ticks(2);
        assert!(eng.apply_lever("L", 0));
        assert_eq!(eng.get_node("N").unwrap().state_fp, 200_000);
    }
}
