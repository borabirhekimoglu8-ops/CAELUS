//! Wave 7 Control Barrier Function (CBF-QP / Nagumo) deterministic safety barrier.
//! Validates or clamps autonomous maritime actions against keel clearance (UKC),
//! storm wave limits, and restricted navigational corridors.

use crate::active_inference::MaritimeAction;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CbfConstraints {
    pub min_ukc_m: f64,
    pub max_wave_m: f64,
    pub in_restricted_zone: bool,
}

impl Default for CbfConstraints {
    fn default() -> Self {
        Self {
            min_ukc_m: 1.5,
            max_wave_m: 3.5,
            in_restricted_zone: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CbfDecision {
    pub input_action: MaritimeAction,
    pub safe_action: MaritimeAction,
    pub clamped: bool,
    pub barrier_margin: f64,
    pub max_safe_speed_knots: f64,
    pub reason_code: &'static str,
}

/// Evaluates the Nagumo forward-invariance barrier `h(x) >= 0` and clamps unsafe commands.
#[must_use]
pub fn enforce_nagumo_barrier(
    action: MaritimeAction,
    requested_speed_knots: f64,
    ukc_m: f64,
    wave_height_m: f64,
    constraints: CbfConstraints,
) -> CbfDecision {
    let ukc_margin = ukc_m - constraints.min_ukc_m;
    let wave_margin = constraints.max_wave_m - wave_height_m;
    let mut barrier_margin = ukc_margin.min(wave_margin);
    if constraints.in_restricted_zone {
        barrier_margin = barrier_margin.min(-1.0);
    }

    if constraints.in_restricted_zone {
        return CbfDecision {
            input_action: action,
            safe_action: MaritimeAction::HoldAndVerifySensors,
            clamped: true,
            barrier_margin,
            max_safe_speed_knots: 0.0,
            reason_code: "RESTRICTED_ZONE_HOLD",
        };
    }

    if ukc_m < constraints.min_ukc_m {
        let clamped_action = if action == MaritimeAction::ProceedDirect {
            MaritimeAction::DivertToShelterPort
        } else {
            action
        };
        return CbfDecision {
            input_action: action,
            safe_action: clamped_action,
            clamped: true,
            barrier_margin,
            max_safe_speed_knots: requested_speed_knots.clamp(0.0, 6.0),
            reason_code: "UKC_BARRIER_CLAMP",
        };
    }

    if wave_height_m > constraints.max_wave_m {
        let clamped_action = if action == MaritimeAction::ProceedDirect {
            MaritimeAction::DivertToShelterPort
        } else {
            action
        };
        return CbfDecision {
            input_action: action,
            safe_action: clamped_action,
            clamped: true,
            barrier_margin,
            max_safe_speed_knots: requested_speed_knots.clamp(0.0, 8.5),
            reason_code: "STORM_BARRIER_CLAMP",
        };
    }

    let safe_speed = requested_speed_knots.clamp(0.0, 22.0);
    CbfDecision {
        input_action: action,
        safe_action: action,
        clamped: (safe_speed - requested_speed_knots).abs() > 1e-6,
        barrier_margin,
        max_safe_speed_knots: safe_speed,
        reason_code: "CBF_SAFE",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nominal_conditions_pass_without_clamp() {
        let d = enforce_nagumo_barrier(
            MaritimeAction::ProceedDirect,
            13.0,
            3.2,
            1.4,
            CbfConstraints::default(),
        );
        assert!(!d.clamped);
        assert_eq!(d.safe_action, MaritimeAction::ProceedDirect);
        assert_eq!(d.reason_code, "CBF_SAFE");
        assert!(d.barrier_margin > 0.0);
    }

    #[test]
    fn ukc_violation_and_restricted_zone_clamp_action() {
        let ukc_bad = enforce_nagumo_barrier(
            MaritimeAction::ProceedDirect,
            16.0,
            0.9,
            1.2,
            CbfConstraints::default(),
        );
        assert!(ukc_bad.clamped);
        assert_eq!(ukc_bad.safe_action, MaritimeAction::DivertToShelterPort);
        assert!(ukc_bad.max_safe_speed_knots <= 6.0);
        assert_eq!(ukc_bad.reason_code, "UKC_BARRIER_CLAMP");

        let zone_bad = enforce_nagumo_barrier(
            MaritimeAction::ProceedDirect,
            12.0,
            4.0,
            1.0,
            CbfConstraints {
                in_restricted_zone: true,
                ..CbfConstraints::default()
            },
        );
        assert!(zone_bad.clamped);
        assert_eq!(zone_bad.safe_action, MaritimeAction::HoldAndVerifySensors);
        assert_eq!(zone_bad.max_safe_speed_knots, 0.0);
    }
}
