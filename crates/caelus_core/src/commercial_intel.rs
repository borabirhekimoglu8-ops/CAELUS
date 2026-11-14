//! Wave 6-9.1 Zero-Sale B2B/B2G Financial Feasibility, Ro-Pax Trim/Load,
//! FuelEU Maritime / EU ETS, MNL / EMSR-b Tariff Bands, Island Quota & PSO Subsidy Engine.

use crate::pbit_ising::XorShift64;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FinancialInput {
    pub capex_keur: f64,
    pub annual_opex_keur: f64,
    pub annual_revenue_keur: f64,
    pub discount_rate: f64,
    pub horizon_years: u32,
    pub revenue_volatility: f64,
    pub seed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FinancialSummary {
    pub npv_keur: f64,
    pub irr_pct: f64,
    pub payback_years: f64,
    pub mc_p10_npv: f64,
    pub mc_p50_npv: f64,
    pub mc_p90_npv: f64,
}

fn compute_npv(capex: f64, annual_cf: f64, rate: f64, years: u32) -> f64 {
    let mut npv = -capex;
    let r = rate.max(-0.5);
    let mut denom = 1.0 + r;
    for _ in 0..years {
        npv += annual_cf / denom;
        denom *= 1.0 + r;
    }
    npv
}

/// Evaluates deterministic NPV, IRR (bisection), payback, and 1,000-trial Monte Carlo P10/P50/P90.
#[must_use]
pub fn evaluate_financials(input: FinancialInput) -> FinancialSummary {
    let years = input.horizon_years.clamp(1, 30);
    let net_cf = input.annual_revenue_keur - input.annual_opex_keur;
    let npv_keur = compute_npv(input.capex_keur, net_cf, input.discount_rate, years);

    let payback_years = if net_cf > 1e-6 {
        input.capex_keur / net_cf
    } else {
        99.9
    };

    // Bisection for IRR in [-0.25, 1.50]
    let mut lo = -0.25;
    let mut hi = 1.50;
    for _ in 0..40 {
        let mid = 0.5 * (lo + hi);
        let val = compute_npv(input.capex_keur, net_cf, mid, years);
        if val > 0.0 {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let irr_pct = 0.5 * (lo + hi) * 100.0;

    // 1,000 deterministic Monte Carlo samples using sum of 6 uniforms (approx Gaussian zero-mean, std~sqrt(0.5))
    let mut rng = XorShift64::new(input.seed);
    let mut samples = [0.0f64; 1000];
    let vol = input.revenue_volatility.clamp(0.0, 0.5);
    for slot in &mut samples {
        let mut sum_u = 0.0;
        for _ in 0..6 {
            sum_u += rng.next_f64();
        }
        let approx_z = (sum_u - 3.0) * std::f64::consts::SQRT_2;
        let shocked_rev = (input.annual_revenue_keur * (1.0 + vol * approx_z)).max(0.0);
        let cf = shocked_rev - input.annual_opex_keur;
        *slot = compute_npv(input.capex_keur, cf, input.discount_rate, years);
    }
    samples.sort_by(f64::total_cmp);

    FinancialSummary {
        npv_keur,
        irr_pct,
        payback_years,
        mc_p10_npv: samples[100],
        mc_p50_npv: samples[500],
        mc_p90_npv: samples[900],
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RopaxTrimInput {
    pub lane_meters_used: f64,
    pub lane_meters_cap: f64,
    pub forward_load_tons: f64,
    pub aft_load_tons: f64,
    pub port_load_tons: f64,
    pub starboard_load_tons: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RopaxTrimResult {
    pub deck_utilization_pct: f64,
    pub trim_deg: f64,
    pub heel_deg: f64,
    pub gm_m: f64,
    pub stable: bool,
}

#[must_use]
pub fn evaluate_ropax_trim(input: RopaxTrimInput) -> RopaxTrimResult {
    let cap = input.lane_meters_cap.max(1.0);
    let util = ((input.lane_meters_used / cap) * 100.0).clamp(0.0, 120.0);
    let trim_deg = ((input.forward_load_tons - input.aft_load_tons) * 0.015).clamp(-6.0, 6.0);
    let heel_deg = ((input.starboard_load_tons - input.port_load_tons) * 0.025).clamp(-12.0, 12.0);
    let gm_m = (1.85 - (util / 100.0) * 0.45 - heel_deg.abs() * 0.08).max(0.05);
    let stable = util <= 100.0 && trim_deg.abs() <= 2.5 && heel_deg.abs() <= 3.0 && gm_m >= 0.35;
    RopaxTrimResult {
        deck_utilization_pct: util,
        trim_deg,
        heel_deg,
        gm_m,
        stable,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FuelEuEtsResult {
    pub fuel_intensity_g_co2e_mj: f64,
    pub target_g_co2e_mj: f64,
    pub eu_ets_cost_eur: f64,
    pub compliance_surplus: bool,
}

#[must_use]
pub fn evaluate_fueleu_ets(
    distance_nm: f64,
    speed_knots: f64,
    hybrid_shore_ratio: f64,
    ets_price_eur_per_ton: f64,
) -> FuelEuEtsResult {
    let target = 89.34; // FuelEU Maritime 2025 benchmark (gCO2e/MJ)
    let shore = hybrid_shore_ratio.clamp(0.0, 0.85);
    let speed_factor = (speed_knots / 13.0).max(0.5).powi(2);
    let intensity = (91.16 * (1.0 - shore * 0.45) * speed_factor.clamp(0.75, 1.35)).max(15.0);
    let tons_co2 = (distance_nm * 0.19 * speed_factor) * (1.0 - shore * 0.35);
    let eu_ets_cost_eur = tons_co2 * 0.50 * ets_price_eur_per_ton.max(0.0); // 50% EU non-EU scope
    FuelEuEtsResult {
        fuel_intensity_g_co2e_mj: intensity,
        target_g_co2e_mj: target,
        eu_ets_cost_eur,
        compliance_surplus: intensity <= target,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TariffBandResult {
    pub mnl_market_share: f64,
    pub emsr_b_protected_seats: u32,
    pub recommended_fare_eur: f64,
}

/// Multinomial Logit (MNL) market share + Littlewood/EMSR-b yield seat protection.
#[must_use]
pub fn compute_tariff_emsr_b(
    fare_eur: f64,
    competitor_fare_eur: f64,
    vessel_capacity: u32,
    high_yield_fare_eur: f64,
    mean_high_demand: f64,
) -> TariffBandResult {
    let util_ours = -0.045 * fare_eur + 1.2;
    let util_comp = -0.045 * competitor_fare_eur + 0.9;
    let exp_ours = util_ours.exp();
    let exp_comp = util_comp.exp();
    let mnl_market_share = (exp_ours / (exp_ours + exp_comp)).clamp(0.01, 0.99);

    let p_protect = 1.0 - (fare_eur / high_yield_fare_eur.max(fare_eur + 1.0));
    let protected =
        ((mean_high_demand * (0.65 + p_protect * 0.5)).round() as u32).min(vessel_capacity);
    let recommended_fare_eur =
        (fare_eur * (1.0 + (mnl_market_share - 0.5) * 0.15)).clamp(12.0, 220.0);
    TariffBandResult {
        mnl_market_share,
        emsr_b_protected_seats: protected,
        recommended_fare_eur,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuotaPsoCheck {
    pub island_code: &'static str,
    pub daily_pax: u32,
    pub daily_quota: u32,
    pub within_quota: bool,
    pub pso_subsidy_valid: bool,
}

#[must_use]
pub fn verify_island_quota_and_pso(
    island_code: &'static str,
    daily_pax: u32,
    annual_sailings: u32,
    off_peak_months: u32,
) -> QuotaPsoCheck {
    let daily_quota = match island_code {
        "GRJTR" => 8_000,  // Santorini daily cruise/visitor cap
        "ITVCE" => 25_000, // Venice daily threshold
        _ => 12_000,
    };
    QuotaPsoCheck {
        island_code,
        daily_pax,
        daily_quota,
        within_quota: daily_pax <= daily_quota,
        pso_subsidy_valid: annual_sailings >= 104 && off_peak_months >= 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monte_carlo_percentiles_and_irr_are_ordered() {
        let fin = evaluate_financials(FinancialInput {
            capex_keur: 240.0,
            annual_opex_keur: 65.0,
            annual_revenue_keur: 235.0,
            discount_rate: 0.08,
            horizon_years: 7,
            revenue_volatility: 0.14,
            seed: 42,
        });
        assert!(fin.npv_keur > 0.0);
        assert!(fin.irr_pct > 25.0);
        assert!(fin.mc_p10_npv <= fin.mc_p50_npv);
        assert!(fin.mc_p50_npv <= fin.mc_p90_npv);
    }

    #[test]
    fn ropax_fueleu_tariff_and_quota_checks_work() {
        let trim = evaluate_ropax_trim(RopaxTrimInput {
            lane_meters_used: 380.0,
            lane_meters_cap: 450.0,
            forward_load_tons: 210.0,
            aft_load_tons: 205.0,
            port_load_tons: 190.0,
            starboard_load_tons: 195.0,
        });
        assert!(trim.stable);

        let fuel = evaluate_fueleu_ets(18.0, 12.5, 0.35, 80.0);
        assert!(fuel.compliance_surplus);

        let tariff = compute_tariff_emsr_b(38.0, 44.0, 420, 72.0, 95.0);
        assert!(tariff.mnl_market_share > 0.5);
        assert!(tariff.emsr_b_protected_seats <= 420);

        let santorini = verify_island_quota_and_pso("GRJTR", 6_500, 140, 7);
        assert!(santorini.within_quota);
        assert!(santorini.pso_subsidy_valid);
    }
}
