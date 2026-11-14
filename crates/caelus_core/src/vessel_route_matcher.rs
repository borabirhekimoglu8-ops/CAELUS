//! Deterministic 4-Gate Vessel-to-Route Suitability & Net TCE Engine.
//!
//! Operates strictly in fixed-point integer arithmetic (`#![forbid(unsafe_code)]`,
//! zero `f32`/`f64`, zero heap allocation on single-vessel evaluation).
//! Evaluates:
//! 1. Gate 1: Legal / IACS Class / P&I Blue Card & OpenSanctions Compliance
//! 2. Gate 2: Physical Dimensions / Squat-Adjusted UKC / Air Draft Clearance
//! 3. Gate 3: Strait Transit / SOx-NOx ECA / Cabotage & CII Compliance
//! 4. Gate 4: Net TCE Daily Profitability vs Daily OPEX & EU ETS Exposure

pub const FP_SCALE: i64 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StraitRegime {
    None = 0,
    TurkishStraitsMontreux = 1,
    SuezCanal = 2,
    PanamaCanal = 3,
    MalaccaStrait = 4,
    DanishStraits = 5,
    GibraltarStrait = 6,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FuelKindCode {
    Mgo = 0,
    Vlsfo = 1,
    Lng = 2,
    Methanol = 3,
    Ammonia = 4,
    Battery = 5,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateFailureCode {
    None = 0,
    SanctionsMatch = 1,
    PscBanned = 2,
    ClassSuspendedOrWithdrawn = 3,
    NonIacsClassRejected = 4,
    ExcessiveConditionsOfClass = 5,
    SurveyOverdue = 6,
    Feb20BlueCardExpired = 7,
    MissingBunkerBlueCard = 8,
    MissingClc92BlueCard = 9,
    MissingNairobiWrcCard = 10,
    MissingAthensPaxCard = 11,
    MissingJwcWarRisk = 12,
    InsufficientUkc = 13,
    ExceedsBerthLoa = 14,
    ExceedsBerthBeam = 15,
    ExceedsAirDraft = 16,
    InsufficientCapacity = 17,
    CabotageFlagMismatch = 18,
    EcaFuelNonCompliant = 19,
    NoxTierIiiRequired = 20,
    StraitTransitProhibited = 21,
    CiiRatingERejected = 22,
    NegativeNetTceMargin = 23,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VesselMatchInput {
    pub imo: u32,
    pub mmsi: u32,
    pub flag_iso2: [u8; 2],
    pub gt: u32,
    pub dwt_tons: u32,
    pub loa_mm: u32,
    pub beam_mm: u32,
    pub air_draft_mm: u32,
    pub active_draft_mm: u32,
    pub service_speed_centikn: u32,
    pub block_coeff_bp: u16,
    pub teu: u32,
    pub lane_meters: u32,
    pub pax_capacity: u32,
    pub main_engine_kw: u32,
    pub aux_gen_kw: u32,
    pub sfoc_dg_kwh: u16,
    pub nox_tier: u8,
    pub fuel_kind: FuelKindCode,
    pub scrubber_fitted: bool,
    pub ops_ready: bool,
    pub is_oil_tanker: bool,
    pub is_passenger_vessel: bool,
    pub is_hazmat_cargo: bool,
    pub iacs_member: bool,
    pub class_in_class: bool,
    pub conditions_of_class: u8,
    pub survey_overdue: bool,
    pub ig_or_turk_pi: bool,
    pub feb20_blue_card_active: bool,
    pub bunker_blue_card: bool,
    pub clc92_blue_card: bool,
    pub wrc_blue_card: bool,
    pub athens_blue_card: bool,
    pub jwc_war_risk_active: bool,
    pub psc_banned: bool,
    pub opensanctions_flagged: bool,
    pub cii_rating: u8, // 1=A .. 5=E, 0=Exempt
    pub daily_opex_cents: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RouteMatchSpec {
    pub origin_country_iso2: [u8; 2],
    pub dest_country_iso2: [u8; 2],
    pub distance_nm_milli: u32,
    pub min_channel_depth_mm: u32,
    pub required_ukc_mm: u32,
    pub wave_heave_mm: u32,
    pub max_berth_loa_mm: u32,
    pub max_berth_beam_mm: u32,
    pub min_air_draft_limit_mm: u32,
    pub min_teu: u32,
    pub min_lane_meters: u32,
    pub min_pax: u32,
    pub min_dwt_tons: u32,
    pub require_iacs: bool,
    pub require_ig_or_turk_pi: bool,
    pub max_conditions_of_class: u8,
    pub in_jwc_war_zone: bool,
    pub enforce_cabotage: bool,
    pub eu_eea_cabotage_open: bool,
    pub in_sox_eca: bool,
    pub in_nox_eca: bool,
    pub strait: StraitRegime,
    pub reject_cii_e: bool,
    pub port_ops_available: bool,
    pub port_turnaround_hours: u32,
    pub gross_freight_cents: i64,
    pub port_dues_cents: i64,
    pub strait_tolls_cents: i64,
    pub bunker_price_cents_per_ton: i64,
    pub ets_price_cents_per_ton: i64,
    pub ets_scope_bp: u16, // 5000 = 50% EU non-EU, 10000 = 100% intra-EU, 0 = outside EU
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FourGateSuitability {
    pub imo: u32,
    pub mmsi: u32,
    pub gate1_legal_class_pi: bool,
    pub gate2_physical_ukc_air: bool,
    pub gate3_strait_eca_cabotage: bool,
    pub gate4_net_tce_profitable: bool,
    pub all_gates_passed: bool,
    pub primary_failure: GateFailureCode,
    pub squat_mm: u32,
    pub ukc_margin_mm: i32,
    pub air_draft_margin_mm: i32,
    pub voyage_hours_milli: u64,
    pub fuel_burn_kg: u64,
    pub co2_kg: u64,
    pub ets_cost_cents: i64,
    pub net_voyage_cashflow_cents: i64,
    pub net_tce_per_day_cents: i64,
    pub composite_score_bp: u16,
}

#[must_use]
pub const fn is_eu_eea_flag(iso2: [u8; 2]) -> bool {
    let a = iso2[0].to_ascii_uppercase();
    let b = iso2[1].to_ascii_uppercase();
    matches!(
        [a, b],
        [b'B', b'E']
            | [b'B', b'G']
            | [b'C', b'Y']
            | [b'D', b'E']
            | [b'D', b'K']
            | [b'E', b'E']
            | [b'E', b'S']
            | [b'F', b'I']
            | [b'F', b'R']
            | [b'G', b'R']
            | [b'H', b'R']
            | [b'I', b'E']
            | [b'I', b'S']
            | [b'I', b'T']
            | [b'L', b'T']
            | [b'L', b'U']
            | [b'L', b'V']
            | [b'M', b'T']
            | [b'N', b'L']
            | [b'N', b'O']
            | [b'P', b'L']
            | [b'P', b'T']
            | [b'R', b'O']
            | [b'S', b'E']
            | [b'S', b'I']
    )
}

#[must_use]
pub fn evaluate_gate1_legal_class_pi(
    v: &VesselMatchInput,
    r: &RouteMatchSpec,
) -> (bool, GateFailureCode) {
    if v.opensanctions_flagged {
        return (false, GateFailureCode::SanctionsMatch);
    }
    if v.psc_banned {
        return (false, GateFailureCode::PscBanned);
    }
    if !v.class_in_class {
        return (false, GateFailureCode::ClassSuspendedOrWithdrawn);
    }
    if r.require_iacs && !v.iacs_member {
        return (false, GateFailureCode::NonIacsClassRejected);
    }
    if v.conditions_of_class > r.max_conditions_of_class {
        return (false, GateFailureCode::ExcessiveConditionsOfClass);
    }
    if v.survey_overdue {
        return (false, GateFailureCode::SurveyOverdue);
    }
    if !v.feb20_blue_card_active || (r.require_ig_or_turk_pi && !v.ig_or_turk_pi) {
        return (false, GateFailureCode::Feb20BlueCardExpired);
    }
    if v.gt > 1_000 && !v.bunker_blue_card {
        return (false, GateFailureCode::MissingBunkerBlueCard);
    }
    if v.is_oil_tanker && v.dwt_tons > 2_000 && !v.clc92_blue_card {
        return (false, GateFailureCode::MissingClc92BlueCard);
    }
    if v.gt >= 300 && !v.wrc_blue_card {
        return (false, GateFailureCode::MissingNairobiWrcCard);
    }
    if (v.is_passenger_vessel || v.pax_capacity > 12) && !v.athens_blue_card {
        return (false, GateFailureCode::MissingAthensPaxCard);
    }
    if r.in_jwc_war_zone && !v.jwc_war_risk_active {
        return (false, GateFailureCode::MissingJwcWarRisk);
    }
    (true, GateFailureCode::None)
}

#[must_use]
pub fn evaluate_gate2_physical(
    v: &VesselMatchInput,
    r: &RouteMatchSpec,
) -> (bool, GateFailureCode, u32, i32, i32) {
    let cb = u64::from(v.block_coeff_bp.clamp(4_500, 9_000));
    let spd = u64::from(v.service_speed_centikn.max(100));
    let squat_mm = ((cb * spd * spd) / 10_000_000) as u32;
    let effective_draft = v
        .active_draft_mm
        .saturating_add(squat_mm)
        .saturating_add(r.wave_heave_mm);
    let ukc_margin_mm = (r.min_channel_depth_mm as i64 - effective_draft as i64)
        .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
    let air_draft_margin_mm = (r.min_air_draft_limit_mm as i64 - v.air_draft_mm as i64)
        .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;

    if ukc_margin_mm < r.required_ukc_mm as i32 {
        return (
            false,
            GateFailureCode::InsufficientUkc,
            squat_mm,
            ukc_margin_mm,
            air_draft_margin_mm,
        );
    }
    if v.loa_mm > r.max_berth_loa_mm {
        return (
            false,
            GateFailureCode::ExceedsBerthLoa,
            squat_mm,
            ukc_margin_mm,
            air_draft_margin_mm,
        );
    }
    if v.beam_mm > r.max_berth_beam_mm {
        return (
            false,
            GateFailureCode::ExceedsBerthBeam,
            squat_mm,
            ukc_margin_mm,
            air_draft_margin_mm,
        );
    }
    if air_draft_margin_mm < 0 {
        return (
            false,
            GateFailureCode::ExceedsAirDraft,
            squat_mm,
            ukc_margin_mm,
            air_draft_margin_mm,
        );
    }
    if v.teu < r.min_teu
        || v.lane_meters < r.min_lane_meters
        || v.pax_capacity < r.min_pax
        || v.dwt_tons < r.min_dwt_tons
    {
        return (
            false,
            GateFailureCode::InsufficientCapacity,
            squat_mm,
            ukc_margin_mm,
            air_draft_margin_mm,
        );
    }
    (
        true,
        GateFailureCode::None,
        squat_mm,
        ukc_margin_mm,
        air_draft_margin_mm,
    )
}

#[must_use]
pub fn evaluate_gate3_strait_eca_cabotage(
    v: &VesselMatchInput,
    r: &RouteMatchSpec,
    ukc_margin_mm: i32,
) -> (bool, GateFailureCode, u32) {
    if r.enforce_cabotage
        && r.origin_country_iso2 == r.dest_country_iso2
        && r.origin_country_iso2 != [b'X', b'X']
    {
        let same_flag = v.flag_iso2[0].eq_ignore_ascii_case(&r.origin_country_iso2[0])
            && v.flag_iso2[1].eq_ignore_ascii_case(&r.origin_country_iso2[1]);
        let eu_open = r.eu_eea_cabotage_open
            && is_eu_eea_flag(r.origin_country_iso2)
            && is_eu_eea_flag(v.flag_iso2);
        if !same_flag && !eu_open {
            return (false, GateFailureCode::CabotageFlagMismatch, 0);
        }
    }

    if r.in_sox_eca {
        let sox_ok = v.scrubber_fitted
            || matches!(
                v.fuel_kind,
                FuelKindCode::Mgo
                    | FuelKindCode::Lng
                    | FuelKindCode::Methanol
                    | FuelKindCode::Ammonia
                    | FuelKindCode::Battery
            );
        if !sox_ok {
            return (false, GateFailureCode::EcaFuelNonCompliant, 0);
        }
    }

    if r.in_nox_eca {
        let zero_em = matches!(
            v.fuel_kind,
            FuelKindCode::Battery | FuelKindCode::Ammonia | FuelKindCode::Methanol
        );
        if v.nox_tier < 3 && !zero_em {
            return (false, GateFailureCode::NoxTierIiiRequired, 0);
        }
    }

    if r.reject_cii_e && v.cii_rating >= 5 {
        return (false, GateFailureCode::CiiRatingERejected, 0);
    }

    let extra_wait_hours = match r.strait {
        StraitRegime::None | StraitRegime::DanishStraits | StraitRegime::GibraltarStrait => 0,
        StraitRegime::TurkishStraitsMontreux => {
            if v.air_draft_mm > 58_000 || (v.loa_mm > 300_000 && v.is_hazmat_cargo) {
                return (false, GateFailureCode::StraitTransitProhibited, 0);
            }
            if v.loa_mm >= 250_000 || v.is_hazmat_cargo {
                8
            } else {
                2
            }
        }
        StraitRegime::SuezCanal => {
            if v.beam_mm > 77_500 || v.active_draft_mm > 20_100 {
                return (false, GateFailureCode::StraitTransitProhibited, 0);
            }
            10
        }
        StraitRegime::PanamaCanal => {
            if v.beam_mm > 51_250 || v.loa_mm > 366_000 || v.active_draft_mm > 15_200 {
                return (false, GateFailureCode::StraitTransitProhibited, 0);
            }
            9
        }
        StraitRegime::MalaccaStrait => {
            if ukc_margin_mm < 3_500 {
                return (false, GateFailureCode::StraitTransitProhibited, 0);
            }
            0
        }
    };

    (true, GateFailureCode::None, extra_wait_hours)
}

#[must_use]
pub fn evaluate_four_gate_suitability(
    v: &VesselMatchInput,
    r: &RouteMatchSpec,
) -> FourGateSuitability {
    let (g1, fail1) = evaluate_gate1_legal_class_pi(v, r);
    let (g2, fail2, squat_mm, ukc_margin_mm, air_draft_margin_mm) = evaluate_gate2_physical(v, r);
    let (g3, fail3, extra_wait_h) = evaluate_gate3_strait_eca_cabotage(v, r, ukc_margin_mm);

    // Deterministic voyage & TCE arithmetic in fixed-point integers
    let spd = i128::from(v.service_speed_centikn.max(100));
    let sea_milli_hours = (i128::from(r.distance_nm_milli) * 100) / spd;
    let port_wait_hours = i128::from(r.port_turnaround_hours.saturating_add(extra_wait_h));
    let voyage_hours_milli = (sea_milli_hours + port_wait_hours * 1_000).max(1_000);

    let prop_kw = (i128::from(v.main_engine_kw) * 75) / 100;
    let aux_kw = i128::from(v.aux_gen_kw);
    let sfoc = i128::from(v.sfoc_dg_kwh);

    let sea_fuel_kg = (sea_milli_hours * (prop_kw + aux_kw) * sfoc) / 10_000_000;
    let effective_port_burn_hours = if v.ops_ready && r.port_ops_available {
        (port_wait_hours * 20) / 100
    } else {
        port_wait_hours
    };
    let port_fuel_kg = (effective_port_burn_hours * aux_kw * sfoc) / 10_000;
    let fuel_burn_kg = (sea_fuel_kg + port_fuel_kg).max(0) as u64;

    // Emission factor (kg CO2 per 1000 kg fuel)
    let ef_per_1000 = match v.fuel_kind {
        FuelKindCode::Mgo | FuelKindCode::Vlsfo => 3_150i128,
        FuelKindCode::Lng => 2_750,
        FuelKindCode::Methanol => 1_375,
        FuelKindCode::Ammonia | FuelKindCode::Battery => 0,
    };
    let co2_kg = ((i128::from(fuel_burn_kg) * ef_per_1000) / 1_000).max(0) as u64;

    let bunker_cost_cents =
        (i128::from(fuel_burn_kg) * i128::from(r.bunker_price_cents_per_ton)) / 1_000;
    let ets_cost_cents =
        ((i128::from(co2_kg) * i128::from(r.ets_scope_bp) * i128::from(r.ets_price_cents_per_ton))
            / 10_000_000) as i64;

    let net_voyage_cashflow_cents = (i128::from(r.gross_freight_cents)
        - bunker_cost_cents
        - i128::from(r.port_dues_cents)
        - i128::from(r.strait_tolls_cents)
        - i128::from(ets_cost_cents)) as i64;

    let net_tce_per_day_cents =
        ((i128::from(net_voyage_cashflow_cents) * 24_000) / voyage_hours_milli) as i64;

    let g4 = net_tce_per_day_cents >= v.daily_opex_cents;
    let fail4 = if g4 {
        GateFailureCode::None
    } else {
        GateFailureCode::NegativeNetTceMargin
    };

    let all_gates_passed = g1 && g2 && g3 && g4;
    let primary_failure = if !g1 {
        fail1
    } else if !g2 {
        fail2
    } else if !g3 {
        fail3
    } else {
        fail4
    };

    let mut score_bp: i64 = 0;
    if g1 {
        score_bp += 3_000;
    }
    if g2 {
        score_bp += 2_500;
    }
    if g3 {
        score_bp += 2_500;
    }
    if g4 {
        let margin_ratio = ((i128::from(net_tce_per_day_cents - v.daily_opex_cents) * 2_000)
            / i128::from(v.daily_opex_cents.max(100_000)))
        .clamp(0, 2_000) as i64;
        score_bp += margin_ratio;
    }

    FourGateSuitability {
        imo: v.imo,
        mmsi: v.mmsi,
        gate1_legal_class_pi: g1,
        gate2_physical_ukc_air: g2,
        gate3_strait_eca_cabotage: g3,
        gate4_net_tce_profitable: g4,
        all_gates_passed,
        primary_failure,
        squat_mm,
        ukc_margin_mm,
        air_draft_margin_mm,
        voyage_hours_milli: voyage_hours_milli as u64,
        fuel_burn_kg,
        co2_kg,
        ets_cost_cents,
        net_voyage_cashflow_cents,
        net_tce_per_day_cents,
        composite_score_bp: score_bp.clamp(0, 10_000) as u16,
    }
}

/// Evaluates and ranks a slice of fleet vessels for a route, passing vessels first by score & TCE.
#[must_use]
pub fn rank_fleet_for_route(
    fleet: &[VesselMatchInput],
    route: &RouteMatchSpec,
) -> Vec<FourGateSuitability> {
    let mut results: Vec<FourGateSuitability> = fleet
        .iter()
        .map(|v| evaluate_four_gate_suitability(v, route))
        .collect();
    results.sort_by(|a, b| {
        b.all_gates_passed
            .cmp(&a.all_gates_passed)
            .then_with(|| b.composite_score_bp.cmp(&a.composite_score_bp))
            .then_with(|| b.net_tce_per_day_cents.cmp(&a.net_tce_per_day_cents))
            .then_with(|| a.imo.cmp(&b.imo))
    });
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_compliant_ropax() -> VesselMatchInput {
        VesselMatchInput {
            imo: 9381240,
            mmsi: 271044102,
            flag_iso2: *b"TR",
            gt: 4_850,
            dwt_tons: 1_250,
            loa_mm: 92_000,
            beam_mm: 16_400,
            air_draft_mm: 24_500,
            active_draft_mm: 4_200,
            service_speed_centikn: 1_500,
            block_coeff_bp: 6_200,
            teu: 0,
            lane_meters: 450,
            pax_capacity: 600,
            main_engine_kw: 4_400,
            aux_gen_kw: 450,
            sfoc_dg_kwh: 1_850,
            nox_tier: 3,
            fuel_kind: FuelKindCode::Mgo,
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
            daily_opex_cents: 650_000,
        }
    }

    fn aegean_route() -> RouteMatchSpec {
        RouteMatchSpec {
            origin_country_iso2: *b"TR",
            dest_country_iso2: *b"GR",
            distance_nm_milli: 27_400,
            min_channel_depth_mm: 9_400,
            required_ukc_mm: 1_500,
            wave_heave_mm: 400,
            max_berth_loa_mm: 135_000,
            max_berth_beam_mm: 24_000,
            min_air_draft_limit_mm: 58_000,
            min_teu: 0,
            min_lane_meters: 300,
            min_pax: 200,
            min_dwt_tons: 500,
            require_iacs: true,
            require_ig_or_turk_pi: true,
            max_conditions_of_class: 1,
            in_jwc_war_zone: false,
            enforce_cabotage: true,
            eu_eea_cabotage_open: true,
            in_sox_eca: true,
            in_nox_eca: false,
            strait: StraitRegime::None,
            reject_cii_e: true,
            port_ops_available: true,
            port_turnaround_hours: 4,
            gross_freight_cents: 2_800_000,
            port_dues_cents: 240_000,
            strait_tolls_cents: 0,
            bunker_price_cents_per_ton: 72_000,
            ets_price_cents_per_ton: 8_500,
            ets_scope_bp: 5_000,
        }
    }

    #[test]
    fn four_gate_passes_compliant_vessel_and_fails_sanctions_ukc_cabotage_and_tce() {
        let base = sample_compliant_ropax();
        let route = aegean_route();

        let ok = evaluate_four_gate_suitability(&base, &route);
        assert!(ok.all_gates_passed);
        assert_eq!(ok.primary_failure, GateFailureCode::None);
        assert!(ok.squat_mm > 1_000 && ok.squat_mm < 2_000);
        assert!(ok.ukc_margin_mm >= 1_500);
        assert!(ok.net_tce_per_day_cents > base.daily_opex_cents);

        // Gate 1: Non-IACS / Sanctioned rejected
        let mut non_iacs = base;
        non_iacs.iacs_member = false;
        let r_non_iacs = evaluate_four_gate_suitability(&non_iacs, &route);
        assert!(!r_non_iacs.gate1_legal_class_pi);
        assert_eq!(
            r_non_iacs.primary_failure,
            GateFailureCode::NonIacsClassRejected
        );

        let mut sanctioned = base;
        sanctioned.opensanctions_flagged = true;
        let r_sanc = evaluate_four_gate_suitability(&sanctioned, &route);
        assert_eq!(r_sanc.primary_failure, GateFailureCode::SanctionsMatch);

        // Gate 2: Insufficient UKC rejected
        let mut deep_draft = base;
        deep_draft.active_draft_mm = 7_500;
        let r_ukc = evaluate_four_gate_suitability(&deep_draft, &route);
        assert!(!r_ukc.gate2_physical_ukc_air);
        assert_eq!(r_ukc.primary_failure, GateFailureCode::InsufficientUkc);

        // Gate 3: Domestic cabotage blocks foreign flag
        let mut domestic_tr = route;
        domestic_tr.dest_country_iso2 = *b"TR";
        let mut foreign_flag = base;
        foreign_flag.flag_iso2 = *b"PA";
        let r_cab = evaluate_four_gate_suitability(&foreign_flag, &domestic_tr);
        assert!(!r_cab.gate3_strait_eca_cabotage);
        assert_eq!(r_cab.primary_failure, GateFailureCode::CabotageFlagMismatch);

        // Gate 4: Rank places compliant ahead of failing
        let ranked = rank_fleet_for_route(&[sanctioned, deep_draft, base], &route);
        assert_eq!(ranked[0].imo, base.imo);
        assert!(ranked[0].all_gates_passed);
        assert!(!ranked[1].all_gates_passed);
    }
}
