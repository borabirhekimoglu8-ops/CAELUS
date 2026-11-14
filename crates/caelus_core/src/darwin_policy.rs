//! Constrained Darwin-Goedel Policy Evolver.
//! Evolves operational decision parameters against deterministic safety invariants;
//! mutations that violate safety bounds or fail to improve fitness are rejected.

use crate::pbit_ising::XorShift64;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PolicyGenome {
    pub shelter_threshold: f64,
    pub ais_gap_weight: f64,
    pub fuel_penalty_weight: f64,
}

#[derive(Debug, Clone)]
pub struct EvalReport {
    pub generation: usize,
    pub fitness: f64,
    pub safety_passed: bool,
}

pub struct DarwinEvolver {
    pub best: PolicyGenome,
    pub best_fitness: f64,
    rng: XorShift64,
}

impl DarwinEvolver {
    /// Initializes the evolver with a starting genome and deterministic PRNG seed.
    pub fn new(initial: PolicyGenome, seed: u64) -> Self {
        let best_fitness = Self::evaluate(&initial).0;
        Self {
            best: initial,
            best_fitness,
            rng: XorShift64::new(seed),
        }
    }

    /// Evaluates deterministic safety invariants and balanced operational fitness.
    pub fn evaluate(g: &PolicyGenome) -> (f64, bool) {
        // Hard safety invariants
        if !(0.20..=0.80).contains(&g.shelter_threshold) {
            return (-1e6, false);
        }
        if !(0.10..=2.00).contains(&g.ais_gap_weight) {
            return (-1e6, false);
        }
        if !(0.05..=1.00).contains(&g.fuel_penalty_weight) {
            return (-1e6, false);
        }

        // Target optimal balance: catch storms early without excessive false-alarm diverts
        let storm_recall = 1.0 - (g.shelter_threshold - 0.42).abs();
        let spoof_sensitivity = 1.0 - (g.ais_gap_weight - 1.15).abs() * 0.5;
        let fuel_efficiency = 1.0 - (g.fuel_penalty_weight - 0.35).abs();
        let fitness = 0.45 * storm_recall + 0.35 * spoof_sensitivity + 0.20 * fuel_efficiency;
        (fitness, true)
    }

    /// Runs `generations` constrained mutations, keeping only safe improvements.
    pub fn evolve(&mut self, generations: usize) -> Vec<EvalReport> {
        let mut history = Vec::with_capacity(generations);
        for gen in 0..generations {
            let candidate = PolicyGenome {
                shelter_threshold: self.best.shelter_threshold + (self.rng.next_f64() - 0.5) * 0.12,
                ais_gap_weight: self.best.ais_gap_weight + (self.rng.next_f64() - 0.5) * 0.25,
                fuel_penalty_weight: self.best.fuel_penalty_weight
                    + (self.rng.next_f64() - 0.5) * 0.12,
            };
            let (fitness, safety_passed) = Self::evaluate(&candidate);
            if safety_passed && fitness > self.best_fitness {
                self.best = candidate;
                self.best_fitness = fitness;
            }
            history.push(EvalReport {
                generation: gen + 1,
                fitness: self.best_fitness,
                safety_passed,
            });
        }
        history
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsafe_genomes_are_rejected() {
        let bad_shelter = PolicyGenome {
            shelter_threshold: 0.95,
            ais_gap_weight: 1.0,
            fuel_penalty_weight: 0.35,
        };
        assert_eq!(DarwinEvolver::evaluate(&bad_shelter), (-1e6, false));

        let bad_ais = PolicyGenome {
            shelter_threshold: 0.42,
            ais_gap_weight: 0.02,
            fuel_penalty_weight: 0.35,
        };
        assert_eq!(DarwinEvolver::evaluate(&bad_ais), (-1e6, false));

        let bad_fuel = PolicyGenome {
            shelter_threshold: 0.42,
            ais_gap_weight: 1.0,
            fuel_penalty_weight: 1.5,
        };
        assert_eq!(DarwinEvolver::evaluate(&bad_fuel), (-1e6, false));
    }

    #[test]
    fn evolution_monotonically_improves_within_safety_bounds() {
        let initial = PolicyGenome {
            shelter_threshold: 0.65,
            ais_gap_weight: 0.55,
            fuel_penalty_weight: 0.70,
        };
        let initial_fitness = DarwinEvolver::evaluate(&initial).0;
        let mut evolver = DarwinEvolver::new(initial, 1337);
        let history = evolver.evolve(60);

        assert_eq!(history.len(), 60);
        for win in history.windows(2) {
            assert!(win[1].fitness >= win[0].fitness);
        }
        assert!(evolver.best_fitness > initial_fitness);
        assert!(DarwinEvolver::evaluate(&evolver.best).1);
    }
}
