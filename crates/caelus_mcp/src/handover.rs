//! `Proof-to-Prose` 60-Second Shift Handover & `DNV / EMSA` Audit Bundle Generator.
//!
//! Strictly enforces Axiom A-2 (stringified `i64` in JSON) and zero em-dash prose.

use crate::z3_gate::{evaluate_mutation_gate, Z3GateVerdict};
use caelus_core::i18n_seven::{phrase, GlassWallStage, Locale7, UiPhrase};
use caelus_core::maritime_security::sha512;
use caelus_core::worker::CoreSnapshot;
use caelus_graph::xtdb_bitemporal::i64_str;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShiftHandoverBrief {
    pub locale_code: String,
    #[serde(with = "i64_str")]
    pub generation: i64,
    pub corridor_code: String,
    pub headline: String,
    pub prose_60s: String,
    pub z3_verdict: Z3GateVerdict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DnvEmsaAuditBundle {
    pub standard: String,
    #[serde(with = "i64_str")]
    pub generation: i64,
    #[serde(with = "i64_str")]
    pub delay_minutes: i64,
    #[serde(with = "i64_str")]
    pub ukc_margin_cm: i64,
    #[serde(with = "i64_str")]
    pub pinned_dossiers: i64,
    pub active_kernels_count: String,
    pub raim_spoofed: bool,
    pub cbf_clamped: bool,
    pub sentinel_code: String,
    pub handover_prose: String,
    pub sha512_hex: String,
}

fn format_sha512_hex(digest: &[u8; 64]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(128);
    for &b in digest {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Generates a deterministic 60-second operator handover brief (no em-dash characters).
#[must_use]
pub fn generate_proof_to_prose_60s(
    snap: &CoreSnapshot,
    locale: Locale7,
    pinned_count: usize,
    human_signed: bool,
    stage: GlassWallStage,
) -> ShiftHandoverBrief {
    let gate = evaluate_mutation_gate(
        false,
        stage,
        human_signed,
        snap.cbf_clamped,
        snap.raim_spoofed,
    );
    let action_word = if snap.cbf_clamped {
        "CLAMPED"
    } else {
        "NOMINAL"
    };
    let pier_label = if snap.params.backup_pier_b {
        "Pier B Active"
    } else {
        "Pier A Fault"
    };
    let headline = format!(
        "{} | {} | {} | Gen {} | 10/10 + HAL",
        phrase(UiPhrase::AppHeader, locale),
        phrase(UiPhrase::HandoverSummary, locale),
        snap.feasibility.corridor_code,
        snap.generation
    );
    let prose_60s = format!(
        "Corridor {} ({}): Delay {}m, UKC {}cm, Wave {}cm. \
         Active-Inf {:?} [{} {}], V-JEPA {:.2}, RAIM {}, Sentinel {}. \
         GlassWall {:?} / Dossiers {}. Read-only Z3 {}.",
        snap.feasibility.corridor_code,
        pier_label,
        snap.hub_eval.delay_minutes,
        snap.hub_eval.ukc_margin_cm,
        snap.hub_eval.wave_exposure_cm,
        snap.ai_action,
        action_word,
        snap.cbf_reason,
        snap.vjepa_surprise,
        if snap.raim_spoofed { "SPOOF" } else { "OK" },
        snap.sentinel_code,
        stage,
        pinned_count,
        gate.reason_code
    )
    .replace('\u{2014}', "-");

    ShiftHandoverBrief {
        locale_code: locale.code().to_string(),
        generation: snap.generation as i64,
        corridor_code: snap.feasibility.corridor_code.to_string(),
        headline,
        prose_60s,
        z3_verdict: gate,
    }
}

/// Produces a deterministic DNV/EMSA verification bundle sealed with FIPS 180-4 SHA-512.
#[must_use]
pub fn build_dnv_emsa_audit_bundle(
    snap: &CoreSnapshot,
    locale: Locale7,
    pinned_count: usize,
    human_signed: bool,
    stage: GlassWallStage,
) -> DnvEmsaAuditBundle {
    let brief = generate_proof_to_prose_60s(snap, locale, pinned_count, human_signed, stage);
    let payload = format!(
        "CAELUS-DNV-EMSA|gen={}|corridor={}|delay={}|ukc={}|raim={}|cbf={}|sentinel={}|prose={}",
        snap.generation,
        snap.feasibility.corridor_code,
        snap.hub_eval.delay_minutes,
        snap.hub_eval.ukc_margin_cm,
        snap.raim_spoofed,
        snap.cbf_clamped,
        snap.sentinel_code,
        brief.prose_60s
    );
    let hash = sha512(payload.as_bytes());
    DnvEmsaAuditBundle {
        standard: "DNV-GL-ST-0050 / EMSA-SAFE-AUDIT-V1".to_string(),
        generation: snap.generation as i64,
        delay_minutes: i64::from(snap.hub_eval.delay_minutes),
        ukc_margin_cm: i64::from(snap.hub_eval.ukc_margin_cm),
        pinned_dossiers: pinned_count as i64,
        active_kernels_count: "10/10 + HAL".to_string(),
        raim_spoofed: snap.raim_spoofed,
        cbf_clamped: snap.cbf_clamped,
        sentinel_code: snap.sentinel_code.to_string(),
        handover_prose: brief.prose_60s,
        sha512_hex: format_sha512_hex(&hash),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use caelus_core::worker::{CoreParams, HeadlessCoreHandle};

    #[test]
    fn handover_prose_and_dnv_bundle_are_deterministic_and_zero_em_dash() {
        let snap = HeadlessCoreHandle::initial_snapshot(CoreParams::default());
        let b1 =
            build_dnv_emsa_audit_bundle(&snap, Locale7::Tr, 2, true, GlassWallStage::FieldMission);
        let b2 =
            build_dnv_emsa_audit_bundle(&snap, Locale7::Tr, 2, true, GlassWallStage::FieldMission);
        assert_eq!(b1, b2);
        assert!(!b1.handover_prose.contains('\u{2014}'));
        assert_eq!(b1.sha512_hex.len(), 128);

        let json = serde_json::to_string(&b1).expect("serialize");
        assert!(json.contains("\"pinned_dossiers\":\"2\""));
    }
}
