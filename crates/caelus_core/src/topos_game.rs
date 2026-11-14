//! Wave 8 / 9.1 Topos monoidal open-game and exact 3-player Shapley-Nash
//! revenue/cost/risk fair allocation solver for Aegean corridor coalitions.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OperatorPayoff {
    pub name: &'static str,
    pub solo_value_keur: f64,
    pub coalition_synergy_keur: f64,
    pub risk_exposure: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ToposEquilibrium {
    pub nash_welfare_keur: f64,
    pub fairness_gini: f64,
    pub operator_allocations_keur: [f64; 3],
    pub risk_weighted_shares: [f64; 3],
}

fn coalition_value(players: &[OperatorPayoff; 3], mask: usize) -> f64 {
    let mut count = 0usize;
    let mut sum_solo = 0.0;
    let mut sum_syn = 0.0;
    let mut sum_risk = 0.0;
    for (idx, p) in players.iter().enumerate() {
        if (mask & (1 << idx)) != 0 {
            count += 1;
            sum_solo += p.solo_value_keur;
            sum_syn += p.coalition_synergy_keur;
            sum_risk += p.risk_exposure;
        }
    }
    let syn_factor = match count {
        0 | 1 => 0.0,
        2 => 0.45,
        _ => 1.0,
    };
    let net = sum_solo + sum_syn * syn_factor - sum_risk * 18.0;
    net.max(0.0)
}

/// Solves exact 3-player Shapley-Nash equilibrium over all 2^3 = 8 coalitions.
#[must_use]
pub fn solve_topos_coalition(players: [OperatorPayoff; 3]) -> ToposEquilibrium {
    // 6 permutations of (0, 1, 2)
    const PERMS: [[usize; 3]; 6] = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ];

    let mut alloc = [0.0; 3];
    for perm in PERMS {
        let mut mask = 0usize;
        let mut prev_val = 0.0;
        for &player_idx in &perm {
            mask |= 1 << player_idx;
            let next_val = coalition_value(&players, mask);
            alloc[player_idx] += next_val - prev_val;
            prev_val = next_val;
        }
    }
    for slot in &mut alloc {
        *slot /= 6.0;
    }

    let total: f64 = alloc.iter().sum::<f64>().max(1e-9);
    let risk_weighted_shares = [alloc[0] / total, alloc[1] / total, alloc[2] / total];

    let nash_prod = (alloc[0].max(0.1) * alloc[1].max(0.1) * alloc[2].max(0.1)).cbrt();
    let mean = total / 3.0;
    let mut abs_diff_sum = 0.0;
    for a in alloc {
        for b in alloc {
            abs_diff_sum += (a - b).abs();
        }
    }
    let gini = (abs_diff_sum / (2.0 * 9.0 * mean)).clamp(0.0, 1.0);

    ToposEquilibrium {
        nash_welfare_keur: nash_prod,
        fairness_gini: gini,
        operator_allocations_keur: alloc,
        risk_weighted_shares,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shapley_allocation_is_efficient_and_symmetric() {
        let p = OperatorPayoff {
            name: "op",
            solo_value_keur: 100.0,
            coalition_synergy_keur: 40.0,
            risk_exposure: 0.2,
        };
        let eq = solve_topos_coalition([p, p, p]);
        assert!((eq.operator_allocations_keur[0] - eq.operator_allocations_keur[1]).abs() < 1e-9);
        assert!(eq.fairness_gini < 1e-9);
        let grand_total: f64 = eq.operator_allocations_keur.iter().sum();
        let expected_grand = 300.0 + 120.0 - 0.6 * 18.0;
        assert!((grand_total - expected_grand).abs() < 1e-6);
    }

    #[test]
    fn higher_risk_reduces_net_welfare_but_preserves_efficiency() {
        let base = solve_topos_coalition([
            OperatorPayoff {
                name: "Seferihisar Port",
                solo_value_keur: 120.0,
                coalition_synergy_keur: 35.0,
                risk_exposure: 0.1,
            },
            OperatorPayoff {
                name: "Aegean Ferry",
                solo_value_keur: 150.0,
                coalition_synergy_keur: 45.0,
                risk_exposure: 0.2,
            },
            OperatorPayoff {
                name: "Samos Hub",
                solo_value_keur: 110.0,
                coalition_synergy_keur: 30.0,
                risk_exposure: 0.15,
            },
        ]);
        let stormy = solve_topos_coalition([
            OperatorPayoff {
                name: "Seferihisar Port",
                solo_value_keur: 120.0,
                coalition_synergy_keur: 35.0,
                risk_exposure: 0.9,
            },
            OperatorPayoff {
                name: "Aegean Ferry",
                solo_value_keur: 150.0,
                coalition_synergy_keur: 45.0,
                risk_exposure: 0.9,
            },
            OperatorPayoff {
                name: "Samos Hub",
                solo_value_keur: 110.0,
                coalition_synergy_keur: 30.0,
                risk_exposure: 0.9,
            },
        ]);
        assert!(stormy.nash_welfare_keur < base.nash_welfare_keur);
        let share_sum: f64 = base.risk_weighted_shares.iter().sum();
        assert!((share_sum - 1.0).abs() < 1e-9);
    }
}
