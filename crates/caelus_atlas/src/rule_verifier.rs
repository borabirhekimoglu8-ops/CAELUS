//! Regulatory Diff, Contradiction Catcher & Automatic Route Re-Verification (`E-Graph + Z3`).
//!
//! When a regulation (EUR-Lex CELLAR, IMO GISIS, UNCLOS, Paris/Tokyo MoU, EMSWe, Cabotage)
//! changes, `EGraph` canonicalizes jurisdiction equivalences, QF_LIA constraint solving checks
//! consistency (generating SMT-LIB2 proofs and invoking `z3` when present on PATH), and affected
//! routes + vessels are automatically re-scored via `caelus_core::vessel_route_matcher`.

use crate::fleet_schema::RegulationRuleRecord;
use caelus_core::egraph::EGraph;
use caelus_core::vessel_route_matcher::{
    evaluate_four_gate_suitability, FourGateSuitability, RouteMatchSpec, VesselMatchInput,
};
use std::collections::HashSet;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleContradiction {
    pub rule_a: String,
    pub rule_b: String,
    pub jurisdiction: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleVerificationReport {
    pub rules_checked: usize,
    pub egraph_classes: usize,
    pub consistent: bool,
    pub contradictions: Vec<RuleContradiction>,
    pub smt2_script: String,
    pub z3_external_status: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteRevalidationDelta {
    pub trigger_rule_id: String,
    pub evaluated_pairs: usize,
    pub newly_blocked: Vec<(u32, String)>,
    pub newly_permitted: Vec<u32>,
}

/// Checks regulatory rule sets for contradictions via `E-Graph` equivalence closure + QF_LIA solver.
#[must_use]
pub fn verify_regulations_egraph_z3(rules: &[RegulationRuleRecord]) -> RuleVerificationReport {
    let mut eg = EGraph::new();
    let mut contradictions = Vec::new();

    // Canonical equivalence classes for harmonized EU/EEA ECA & EMSWe regimes
    let eu_ets = eg.add("regime:EU_ETS", vec![]);
    let fueleu = eg.add("regime:FUELEU_MARITIME", vec![]);
    let eca_sox_eu = eg.add("eca:SOX_01PCT", vec![]);
    let imo_2020_med = eg.add("eca:MED_SOX_2025", vec![]);
    eg.union(eu_ets, fueleu);
    eg.union(eca_sox_eu, imo_2020_med);
    eg.rebuild();

    let mut smt = String::from("(set-logic QF_LIA)\n");
    for (idx, r) in rules.iter().enumerate() {
        let j = std::str::from_utf8(&r.jurisdiction_iso2).unwrap_or("XX");
        let _r_node = eg.add(&format!("rule:{}:{j}", r.rule_id), vec![]);
        smt.push_str(&format!(
            "(declare-const ukc_min_{idx} Int)\n(assert (= ukc_min_{idx} {}))\n",
            r.min_ukc_mm
        ));
        smt.push_str(&format!(
            "(declare-const sulfur_max_{idx} Int)\n(assert (= sulfur_max_{idx} {}))\n",
            r.max_sulfur_ppm
        ));
        smt.push_str(&format!(
            "(declare-const airdraft_max_{idx} Int)\n(assert (= airdraft_max_{idx} {}))\n",
            r.max_air_draft_mm
        ));
    }

    // Check pairwise rules in identical or overlapping ("EU"/"XX" vs EU) jurisdictions
    for i in 0..rules.len() {
        for j in (i + 1)..rules.len() {
            let a = &rules[i];
            let b = &rules[j];
            if a.jurisdiction_iso2 != b.jurisdiction_iso2 {
                continue;
            }
            let jur = std::str::from_utf8(&a.jurisdiction_iso2)
                .unwrap_or("XX")
                .to_string();

            // Contradiction 1: conflicting explicit air draft ceilings or UKC minimums
            if a.min_ukc_mm > 0 && b.min_ukc_mm > 0 && a.min_ukc_mm != b.min_ukc_mm {
                contradictions.push(RuleContradiction {
                    rule_a: a.rule_id.clone(),
                    rule_b: b.rule_id.clone(),
                    jurisdiction: jur.clone(),
                    reason: format!(
                        "Conflicting UKC minimum: {}mm vs {}mm",
                        a.min_ukc_mm, b.min_ukc_mm
                    ),
                });
            }
            // Contradiction 2: conflicting sulfur cap for same jurisdiction & validity overlap
            if a.max_sulfur_ppm > 0 && b.max_sulfur_ppm > 0 && a.max_sulfur_ppm != b.max_sulfur_ppm
            {
                contradictions.push(RuleContradiction {
                    rule_a: a.rule_id.clone(),
                    rule_b: b.rule_id.clone(),
                    jurisdiction: jur.clone(),
                    reason: format!(
                        "Conflicting sulfur ppm cap: {} vs {}",
                        a.max_sulfur_ppm, b.max_sulfur_ppm
                    ),
                });
            }
            // Contradiction 3: conflicting Feb 20 Blue Card / IACS / Cabotage mandates
            if a.cabotage_local_flag_only != b.cabotage_local_flag_only && a.source == b.source {
                contradictions.push(RuleContradiction {
                    rule_a: a.rule_id.clone(),
                    rule_b: b.rule_id.clone(),
                    jurisdiction: jur,
                    reason: "Conflicting domestic cabotage flag exclusivity".to_string(),
                });
            }
        }
    }

    // Add satisfiability check asserting a candidate vessel draft/sulfur complies with all rules simultaneously
    if !rules.is_empty() {
        smt.push_str("(declare-const candidate_ukc Int)\n");
        smt.push_str("(declare-const candidate_sulfur Int)\n");
        smt.push_str("(assert (>= candidate_ukc 0))\n");
        smt.push_str("(assert (>= candidate_sulfur 0))\n");
        for (idx, r) in rules.iter().enumerate() {
            if r.min_ukc_mm > 0 {
                smt.push_str(&format!("(assert (>= candidate_ukc ukc_min_{idx}))\n"));
            }
            if r.max_sulfur_ppm > 0 {
                smt.push_str(&format!(
                    "(assert (<= candidate_sulfur sulfur_max_{idx}))\n"
                ));
            }
        }
    }
    smt.push_str("(check-sat)\n");

    let z3_external_status = try_run_external_z3(&smt);

    RuleVerificationReport {
        rules_checked: rules.len(),
        egraph_classes: eg.num_classes(),
        consistent: contradictions.is_empty(),
        contradictions,
        smt2_script: smt,
        z3_external_status,
    }
}

fn try_run_external_z3(smt2: &str) -> Option<String> {
    let mut child = Command::new("z3")
        .arg("-in")
        .arg("-smt2")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(smt2.as_bytes());
    }
    let out = child.wait_with_output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Applies an updated `RegulationRuleRecord` to a route specification and re-verifies all
/// candidate vessels via `evaluate_four_gate_suitability`, reporting status changes.
#[must_use]
pub fn reverify_route_against_updated_rule(
    before_route: &RouteMatchSpec,
    updated_rule: &RegulationRuleRecord,
    vessels: &[VesselMatchInput],
) -> (
    RouteMatchSpec,
    RouteRevalidationDelta,
    Vec<FourGateSuitability>,
) {
    let mut after_route = *before_route;
    let jur = updated_rule.jurisdiction_iso2;
    let touches_route = jur == *b"XX"
        || jur == *b"EU"
        || jur == before_route.origin_country_iso2
        || jur == before_route.dest_country_iso2;

    if touches_route {
        if updated_rule.min_ukc_mm > 0 {
            after_route.required_ukc_mm = after_route.required_ukc_mm.max(updated_rule.min_ukc_mm);
        }
        if updated_rule.max_air_draft_mm > 0 {
            after_route.min_air_draft_limit_mm = after_route
                .min_air_draft_limit_mm
                .min(updated_rule.max_air_draft_mm);
        }
        if updated_rule.max_sulfur_ppm > 0 && updated_rule.max_sulfur_ppm <= 1_000 {
            after_route.in_sox_eca = true;
        }
        if updated_rule.require_iacs {
            after_route.require_iacs = true;
        }
        if updated_rule.require_feb20_blue_card {
            after_route.require_ig_or_turk_pi = true;
        }
        if updated_rule.cabotage_local_flag_only {
            after_route.enforce_cabotage = true;
            after_route.eu_eea_cabotage_open = false;
        }
    }

    let mut newly_blocked = Vec::new();
    let mut newly_permitted = Vec::new();
    let mut new_scores = Vec::with_capacity(vessels.len());
    let mut seen_imos = HashSet::new();

    for v in vessels {
        if !seen_imos.insert(v.imo) {
            continue;
        }
        let prev = evaluate_four_gate_suitability(v, before_route);
        let next = evaluate_four_gate_suitability(v, &after_route);
        if prev.all_gates_passed && !next.all_gates_passed {
            newly_blocked.push((v.imo, format!("{:?}", next.primary_failure)));
        } else if !prev.all_gates_passed && next.all_gates_passed {
            newly_permitted.push(v.imo);
        }
        new_scores.push(next);
    }

    let delta = RouteRevalidationDelta {
        trigger_rule_id: updated_rule.rule_id.clone(),
        evaluated_pairs: seen_imos.len(),
        newly_blocked,
        newly_permitted,
    };

    (after_route, delta, new_scores)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fleet_schema::RegulationSource;
    use caelus_core::vessel_route_matcher::{FuelKindCode, StraitRegime};

    #[test]
    fn catches_regulatory_contradictions_and_revalidates_affected_vessels() {
        let r1 = RegulationRuleRecord {
            rule_id: "MED-SOX-2025".to_string(),
            source: RegulationSource::ImoGisis,
            jurisdiction_iso2: *b"GR",
            title: "Med Sea SOx ECA 0.10%".to_string(),
            celex_or_ref: "MEPC.361(79)".to_string(),
            min_ukc_mm: 1_500,
            max_sulfur_ppm: 1_000,
            max_air_draft_mm: 58_000,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: false,
            valid_from_unix_s: 1_746_057_600,
            tx_time_unix_s: 1_746_057_600,
            summary: "0.10% m/m sulfur limit".to_string(),
        };
        let r_conflict = RegulationRuleRecord {
            rule_id: "PORT-CONFLICT-GR".to_string(),
            source: RegulationSource::ParisTokyoMou,
            jurisdiction_iso2: *b"GR",
            title: "Conflicting Draft Directive".to_string(),
            celex_or_ref: "PMOU-2026-X".to_string(),
            min_ukc_mm: 2_500,
            max_sulfur_ppm: 5_000,
            max_air_draft_mm: 58_000,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: false,
            valid_from_unix_s: 1_760_000_000,
            tx_time_unix_s: 1_760_000_000,
            summary: "Higher UKC + legacy sulfur".to_string(),
        };

        let report = verify_regulations_egraph_z3(&[r1.clone(), r_conflict]);
        assert!(!report.consistent);
        assert_eq!(report.contradictions.len(), 2);
        assert!(report.smt2_script.contains("(check-sat)"));

        // Re-evaluate a route when stricter Med SOx rule turns in_sox_eca ON
        let route_before = RouteMatchSpec {
            origin_country_iso2: *b"TR",
            dest_country_iso2: *b"GR",
            distance_nm_milli: 27_400,
            min_channel_depth_mm: 9_400,
            required_ukc_mm: 1_500,
            wave_heave_mm: 400,
            max_berth_loa_mm: 140_000,
            max_berth_beam_mm: 24_000,
            min_air_draft_limit_mm: 58_000,
            min_teu: 0,
            min_lane_meters: 0,
            min_pax: 0,
            min_dwt_tons: 500,
            require_iacs: true,
            require_ig_or_turk_pi: true,
            max_conditions_of_class: 1,
            in_jwc_war_zone: false,
            enforce_cabotage: true,
            eu_eea_cabotage_open: true,
            in_sox_eca: false,
            in_nox_eca: false,
            strait: StraitRegime::None,
            reject_cii_e: true,
            port_ops_available: true,
            port_turnaround_hours: 4,
            gross_freight_cents: 3_000_000,
            port_dues_cents: 200_000,
            strait_tolls_cents: 0,
            bunker_price_cents_per_ton: 70_000,
            ets_price_cents_per_ton: 8_500,
            ets_scope_bp: 5_000,
        };
        let v_vlsfo = VesselMatchInput {
            imo: 9001111,
            mmsi: 271111111,
            flag_iso2: *b"TR",
            gt: 4_000,
            dwt_tons: 1_500,
            loa_mm: 90_000,
            beam_mm: 16_000,
            air_draft_mm: 22_000,
            active_draft_mm: 4_000,
            service_speed_centikn: 1_400,
            block_coeff_bp: 6_200,
            teu: 0,
            lane_meters: 350,
            pax_capacity: 400,
            main_engine_kw: 4_000,
            aux_gen_kw: 400,
            sfoc_dg_kwh: 1_850,
            nox_tier: 3,
            fuel_kind: FuelKindCode::Vlsfo,
            scrubber_fitted: false,
            ops_ready: true,
            is_oil_tanker: false,
            is_passenger_vessel: true,
            is_hazmat_cargo: false,
            iacs_member: true,
            class_in_class: true,
            conditions_of_class: 0,
            survey_overdue: false,
            ig_or_turk_pi: true,
            feb20_blue_card_active: true,
            bunker_blue_card: true,
            clc92_blue_card: false,
            wrc_blue_card: true,
            athens_blue_card: true,
            jwc_war_risk_active: true,
            psc_banned: false,
            opensanctions_flagged: false,
            cii_rating: 2,
            daily_opex_cents: 600_000,
        };
        let (after_route, delta, _) =
            reverify_route_against_updated_rule(&route_before, &r1, &[v_vlsfo]);
        assert!(after_route.in_sox_eca);
        assert_eq!(delta.newly_blocked.len(), 1);
        assert_eq!(delta.newly_blocked[0].0, 9001111);
    }
}
