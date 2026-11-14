//! Discrete-state Active Inference engine using Bayesian state estimation
//! and Expected Free Energy (EFE = Risk + Ambiguity) minimization.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeaState {
    Calm = 0,
    ModerateSwell = 1,
    Stormy = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaritimeAction {
    ProceedDirect,
    DivertToShelterPort,
    HoldAndVerifySensors,
}

#[derive(Debug, Clone)]
pub struct PolicyEvaluation {
    pub action: MaritimeAction,
    pub expected_free_energy: f64,
    pub risk: f64,
    pub ambiguity: f64,
}

#[derive(Debug, Clone)]
pub struct ActiveInferenceAgent {
    /// Posterior belief over [Calm, ModerateSwell, Stormy]
    pub belief: [f64; 3],
    /// Preferred prior probabilities over outcomes [LowRisk, MedRisk, HighRisk]
    pub preferred_outcomes: [f64; 3],
}

impl ActiveInferenceAgent {
    /// Creates an Active Inference agent with nominal maritime priors.
    pub fn new() -> Self {
        Self {
            belief: [0.6, 0.3, 0.1],
            preferred_outcomes: [0.85, 0.12, 0.03],
        }
    }

    /// Bayesian belief update given observation likelihoods for [Calm, ModerateSwell, Stormy].
    pub fn infer_state(&mut self, obs_likelihood: [f64; 3]) -> [f64; 3] {
        let mut unnorm = [0.0; 3];
        let mut sum = 0.0;
        for ((slot, &prior), &like) in unnorm.iter_mut().zip(&self.belief).zip(&obs_likelihood) {
            let val = (prior * like.max(1e-6)).max(1e-9);
            *slot = val;
            sum += val;
        }
        for (slot, &u) in self.belief.iter_mut().zip(&unnorm) {
            *slot = u / sum;
        }
        self.belief
    }

    /// Predicts outcome distribution [LowRisk, MedRisk, HighRisk] under each action.
    fn transition_outcome(&self, action: MaritimeAction) -> ([f64; 3], f64) {
        let [p_calm, p_mod, p_storm] = self.belief;
        match action {
            MaritimeAction::ProceedDirect => {
                let q = [
                    0.90 * p_calm + 0.25 * p_mod + 0.05 * p_storm,
                    0.08 * p_calm + 0.55 * p_mod + 0.20 * p_storm,
                    0.02 * p_calm + 0.20 * p_mod + 0.75 * p_storm,
                ];
                let ambiguity = 0.22 * p_mod + 0.48 * p_storm;
                (q, ambiguity)
            }
            MaritimeAction::DivertToShelterPort => {
                let q = [
                    0.75 * p_calm + 0.70 * p_mod + 0.65 * p_storm,
                    0.20 * p_calm + 0.25 * p_mod + 0.25 * p_storm,
                    0.05 * p_calm + 0.05 * p_mod + 0.10 * p_storm,
                ];
                let ambiguity = 0.10;
                (q, ambiguity)
            }
            MaritimeAction::HoldAndVerifySensors => {
                let q = [
                    0.65 * p_calm + 0.55 * p_mod + 0.45 * p_storm,
                    0.30 * p_calm + 0.35 * p_mod + 0.35 * p_storm,
                    0.05 * p_calm + 0.10 * p_mod + 0.20 * p_storm,
                ];
                let ambiguity = 0.06;
                (q, ambiguity)
            }
        }
    }

    /// Evaluates Risk (KL divergence) and Ambiguity for a candidate action.
    pub fn evaluate_action(&self, action: MaritimeAction) -> PolicyEvaluation {
        let (q, ambiguity) = self.transition_outcome(action);
        let mut risk = 0.0;
        for (&q_val, &c_val) in q.iter().zip(&self.preferred_outcomes) {
            let qi = q_val.max(1e-9);
            let ci = c_val.max(1e-9);
            risk += qi * (qi / ci).ln();
        }
        PolicyEvaluation {
            action,
            expected_free_energy: risk + ambiguity,
            risk,
            ambiguity,
        }
    }

    /// Selects the action minimizing Expected Free Energy and returns sorted evaluations.
    pub fn select_action(&self) -> (MaritimeAction, Vec<PolicyEvaluation>) {
        let candidates = [
            MaritimeAction::ProceedDirect,
            MaritimeAction::DivertToShelterPort,
            MaritimeAction::HoldAndVerifySensors,
        ];
        let mut evals: Vec<PolicyEvaluation> = candidates
            .iter()
            .map(|&a| self.evaluate_action(a))
            .collect();
        evals.sort_by(|a, b| a.expected_free_energy.total_cmp(&b.expected_free_energy));
        (evals[0].action, evals)
    }
}

impl Default for ActiveInferenceAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bayesian_posterior_sums_to_one() {
        let mut agent = ActiveInferenceAgent::new();
        let post = agent.infer_state([0.1, 0.3, 0.9]);
        let sum: f64 = post.iter().sum();
        assert!((sum - 1.0).abs() < 1e-9);
        assert!(post[2] > post[0]);
    }

    #[test]
    fn calm_selects_proceed_and_storm_avoids_proceed() {
        let mut calm_agent = ActiveInferenceAgent::new();
        calm_agent.infer_state([0.98, 0.05, 0.01]);
        let (calm_action, calm_evals) = calm_agent.select_action();
        assert_eq!(calm_action, MaritimeAction::ProceedDirect);
        assert!(calm_evals
            .iter()
            .all(|e| e.risk >= -1e-9 && e.ambiguity >= 0.0));

        let mut storm_agent = ActiveInferenceAgent::new();
        for _ in 0..3 {
            storm_agent.infer_state([0.02, 0.15, 0.95]);
        }
        let (storm_action, storm_evals) = storm_agent.select_action();
        assert_eq!(storm_action, MaritimeAction::DivertToShelterPort);
        assert!(storm_evals[0].expected_free_energy <= storm_evals[1].expected_free_energy);
    }
}
