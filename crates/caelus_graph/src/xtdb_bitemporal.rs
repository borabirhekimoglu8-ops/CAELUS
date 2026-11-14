//! XTDB-style Bitemporal Ledger, Parallel A vs B Branch Comparison,
//! Pinned Dossiers, and Zero-Copy `rkyv` Desk State Snapshots.

use caelus_core::commercial_intel::{evaluate_financials, evaluate_fueleu_ets, FinancialInput};
use caelus_core::domain::{haversine_distance_nm_km, CorridorKind, AEGEAN_PORTS};
use caelus_core::worker::{CoreParams, HeadlessCoreHandle};
use rkyv::{Archive, Deserialize as RkyvDeserialize, Serialize as RkyvSerialize};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fs;
use std::path::{Path, PathBuf};

/// Axiom A-2 compliant i64 serializer (always decimal ASCII string in JSON/MCP).
pub mod i64_str {
    use super::*;

    pub fn serialize<S>(val: &i64, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_str(&val.to_string())
    }

    pub fn deserialize<'de, D>(d: D) -> Result<i64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let text = String::deserialize(d)?;
        text.parse::<i64>().map_err(serde::de::Error::custom)
    }
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
)]
pub enum BranchId {
    BranchA,
    BranchB,
}

impl BranchId {
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::BranchA => "BRANCH-A",
            Self::BranchB => "BRANCH-B",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BitemporalEvent {
    #[serde(with = "i64_str")]
    pub valid_time_ms: i64,
    #[serde(with = "i64_str")]
    pub tx_time_ms: i64,
    pub entity_id: String,
    pub branch: BranchId,
    #[serde(with = "i64_str")]
    pub npv_keur: i64,
    #[serde(with = "i64_str")]
    pub co2_kg_voyage: i64,
    #[serde(with = "i64_str")]
    pub delay_min: i64,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchComparison {
    pub branch_a_label: String,
    pub branch_b_label: String,
    #[serde(with = "i64_str")]
    pub npv_a_keur: i64,
    #[serde(with = "i64_str")]
    pub npv_b_keur: i64,
    #[serde(with = "i64_str")]
    pub delta_npv_keur: i64,
    #[serde(with = "i64_str")]
    pub delta_delay_min: i64,
    #[serde(with = "i64_str")]
    pub delta_co2_kg: i64,
    #[serde(with = "i64_str")]
    pub delta_ukc_cm: i64,
    pub recommended_branch: BranchId,
    pub verdict_code: String,
}

fn route_distance_nm(corridor: CorridorKind) -> f64 {
    let start = match corridor {
        CorridorKind::SeferihisarSamos => &AEGEAN_PORTS[0], // TRSEF
        CorridorKind::IzmirSamos => &AEGEAN_PORTS[3],       // TRIZM
    };
    let end = &AEGEAN_PORTS[1]; // GRSMI
    let (nm, _) = haversine_distance_nm_km(start.lat_deg, start.lon_deg, end.lat_deg, end.lon_deg);
    nm
}

/// Evaluates two parameter branches side-by-side (`Branch A` vs `Branch B`)
/// using deterministic `caelus_core` snapshots and financial/FuelEU deltas.
#[must_use]
pub fn compare_branches(a: &CoreParams, b: &CoreParams) -> BranchComparison {
    let snap_a = HeadlessCoreHandle::initial_snapshot(*a);
    let snap_b = HeadlessCoreHandle::initial_snapshot(*b);

    let fin_a = evaluate_financials(FinancialInput {
        capex_keur: a.outlay_keur as f64,
        annual_opex_keur: if a.backup_pier_b { 60.0 } else { 72.0 },
        annual_revenue_keur: (a.monthly_savings_keur as f64) * 12.0,
        discount_rate: 0.08,
        horizon_years: 7,
        revenue_volatility: 0.14,
        seed: 42,
    });
    let fin_b = evaluate_financials(FinancialInput {
        capex_keur: b.outlay_keur as f64,
        annual_opex_keur: if b.backup_pier_b { 60.0 } else { 72.0 },
        annual_revenue_keur: (b.monthly_savings_keur as f64) * 12.0,
        discount_rate: 0.08,
        horizon_years: 7,
        revenue_volatility: 0.14,
        seed: 42,
    });

    let nm_a = route_distance_nm(a.corridor);
    let nm_b = route_distance_nm(b.corridor);
    let fuel_a = evaluate_fueleu_ets(nm_a, a.speed_knots, 0.30, 80.0);
    let fuel_b = evaluate_fueleu_ets(nm_b, b.speed_knots, 0.30, 80.0);

    // Derive voyage CO2 kg consistently from FuelEU intensity and ETS cost ratio.
    let co2_a_kg = (fuel_a.eu_ets_cost_eur / 0.04).round() as i64;
    let co2_b_kg = (fuel_b.eu_ets_cost_eur / 0.04).round() as i64;

    let npv_a = fin_a.npv_keur.round() as i64;
    let npv_b = fin_b.npv_keur.round() as i64;
    let delta_npv = npv_b - npv_a;
    let delta_delay =
        i64::from(snap_b.hub_eval.delay_minutes) - i64::from(snap_a.hub_eval.delay_minutes);
    let delta_co2 = co2_b_kg - co2_a_kg;
    let delta_ukc =
        i64::from(snap_b.hub_eval.ukc_margin_cm) - i64::from(snap_a.hub_eval.ukc_margin_cm);

    let score_a = npv_a - i64::from(snap_a.hub_eval.delay_minutes) * 2
        + if snap_a.cbf_clamped { -150 } else { 0 };
    let score_b = npv_b - i64::from(snap_b.hub_eval.delay_minutes) * 2
        + if snap_b.cbf_clamped { -150 } else { 0 };

    let (recommended_branch, verdict_code) = if score_b > score_a {
        (BranchId::BranchB, "XTDB_B_SUPERIOR".to_string())
    } else if score_a > score_b {
        (BranchId::BranchA, "XTDB_A_SUPERIOR".to_string())
    } else {
        (BranchId::BranchA, "XTDB_PARITY".to_string())
    };

    BranchComparison {
        branch_a_label: format!(
            "A({} {} {}kn)",
            snap_a.feasibility.corridor_code,
            if a.backup_pier_b { "PierB" } else { "PierA" },
            a.speed_knots.round() as i32
        ),
        branch_b_label: format!(
            "B({} {} {}kn)",
            snap_b.feasibility.corridor_code,
            if b.backup_pier_b { "PierB" } else { "PierA" },
            b.speed_knots.round() as i32
        ),
        npv_a_keur: npv_a,
        npv_b_keur: npv_b,
        delta_npv_keur: delta_npv,
        delta_delay_min: delta_delay,
        delta_co2_kg: delta_co2,
        delta_ukc_cm: delta_ukc,
        recommended_branch,
        verdict_code,
    }
}

#[derive(
    Debug, Clone, PartialEq, Eq, Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize,
)]
pub struct PinnedDossier {
    pub id: String,
    pub title: String,
    pub corridor_code: String,
    #[serde(with = "i64_str")]
    pub created_tx_ms: i64,
    #[serde(with = "i64_str")]
    pub pinned_npv_keur: i64,
    pub pinned_action: String,
    pub notes: String,
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    Default,
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
)]
pub struct XtdbDeskStateSnapshot {
    pub schema_version: u32,
    #[serde(with = "i64_str")]
    pub saved_tx_ms: i64,
    pub active_corridor: String,
    pub backup_pier_b: bool,
    pub pinned_dossiers: Vec<PinnedDossier>,
}

#[must_use]
pub fn default_desk_snapshot_path() -> PathBuf {
    PathBuf::from("data")
        .join("offline_cache")
        .join("xtdb_desk_snapshot.rkyv")
}

/// Persists `XtdbDeskStateSnapshot` using compact `rkyv` framing.
pub fn save_desk_snapshot(path: &Path, state: &XtdbDeskStateSnapshot) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create_dir_all failed: {e}"))?;
    }
    let bytes =
        rkyv::to_bytes::<rkyv::rancor::Error>(state).map_err(|e| format!("rkyv serialize: {e}"))?;
    fs::write(path, bytes).map_err(|e| format!("write snapshot failed: {e}"))
}

/// Loads `XtdbDeskStateSnapshot` from `rkyv` bytes on disk.
pub fn load_desk_snapshot(path: &Path) -> Result<XtdbDeskStateSnapshot, String> {
    let bytes = fs::read(path).map_err(|e| format!("read snapshot failed: {e}"))?;
    rkyv::from_bytes::<XtdbDeskStateSnapshot, rkyv::rancor::Error>(&bytes)
        .map_err(|e| format!("rkyv deserialize: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_a_vs_b_comparison_detects_pier_b_delay_improvement() {
        let a = CoreParams {
            backup_pier_b: false,
            storm_drill: false,
            ..CoreParams::default()
        };
        let b = CoreParams {
            backup_pier_b: true,
            storm_drill: false,
            ..CoreParams::default()
        };
        let cmp = compare_branches(&a, &b);
        assert!(cmp.delta_delay_min < 0, "Pier B must reduce delay");
        assert_eq!(cmp.recommended_branch, BranchId::BranchB);

        let json = serde_json::to_string(&cmp).expect("serialize");
        assert!(json.contains("\"delta_delay_min\":\""));
    }

    #[test]
    fn desk_snapshot_rkyv_roundtrip_preserves_pinned_dossiers() {
        let dir = std::env::temp_dir().join("caelus_graph_xtdb_test");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("desk_snapshot_test.rkyv");
        let state = XtdbDeskStateSnapshot {
            schema_version: 1,
            saved_tx_ms: 1_794_689_000_000,
            active_corridor: "TR-SEF -> GR-SMI".to_string(),
            backup_pier_b: true,
            pinned_dossiers: vec![PinnedDossier {
                id: "DOS-001".to_string(),
                title: "Seferihisar Pier B Recovery".to_string(),
                corridor_code: "TR-SEF -> GR-SMI".to_string(),
                created_tx_ms: 1_794_689_000_000,
                pinned_npv_keur: 512,
                pinned_action: "ProceedDirect".to_string(),
                notes: "SHISA-KANKO verified".to_string(),
            }],
        };
        save_desk_snapshot(&path, &state).expect("save");
        let loaded = load_desk_snapshot(&path).expect("load");
        assert_eq!(loaded, state);
        let _ = fs::remove_file(&path);
    }
}
