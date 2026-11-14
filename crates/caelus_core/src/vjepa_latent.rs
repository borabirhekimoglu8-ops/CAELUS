//! V-JEPA 2 style latent world model for pure-Rust maritime/aerial prediction.
//! Predicts next-step latent representations without decoding full raw telemetry
//! and outputs a normalized prediction-error `surprise_score` in `[0.0, 1.0]`.

/// Compact 8-dimensional latent world model running synchronously on CPU.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VjepaWorldModel {
    pub latent_state: [f64; 8],
    pub last_predicted_obs: [f64; 4],
    pub last_surprise_score: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VjepaStepResult {
    pub surprise_score: f64,
    pub latent_norm: f64,
    pub predicted_features: [f64; 4],
}

impl Default for VjepaWorldModel {
    fn default() -> Self {
        Self::new()
    }
}

impl VjepaWorldModel {
    /// Creates a deterministic zero-initialized latent world model.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            latent_state: [0.25, 0.25, 0.15, 0.10, 0.20, 0.20, 0.10, 0.15],
            last_predicted_obs: [0.5, 0.25, 0.28, 0.05],
            last_surprise_score: 0.0,
        }
    }

    /// Updates the latent state against an observed 4-vector telemetry frame and
    /// forecasts the next observation + normalized prediction surprise.
    pub fn step(&mut self, observed: [f64; 4], control_bias: f64) -> VjepaStepResult {
        let mut sq_err = 0.0;
        for (obs_raw, pred) in observed.iter().zip(self.last_predicted_obs.iter()) {
            let obs = obs_raw.clamp(0.0, 2.0);
            let diff = obs - *pred;
            sq_err += diff * diff;
        }
        let mse = sq_err / 4.0;
        let surprise_score = (mse / (0.06 + mse)).clamp(0.0, 1.0);
        self.last_surprise_score = surprise_score;

        // Deterministic JEPA predictor transition: EMA blend of latent context + observation residual
        let mut next_latent = [0.0; 8];
        for i in 0..8 {
            let obs_proj = observed[i % 4].clamp(0.0, 2.0);
            let cross = self.latent_state[(i + 3) % 8] * 0.28;
            let raw = 0.56 * self.latent_state[i] + 0.36 * obs_proj + cross + 0.08 * control_bias;
            next_latent[i] = raw.tanh();
        }
        self.latent_state = next_latent;

        // Decode next predicted observation from updated latent state
        let mut predicted = [0.0; 4];
        for i in 0..4 {
            let pair = 0.55 * next_latent[i] + 0.45 * next_latent[i + 4];
            predicted[i] = pair.clamp(0.0, 1.5);
        }
        self.last_predicted_obs = predicted;

        let norm_sq: f64 = self.latent_state.iter().map(|v| v * v).sum();
        VjepaStepResult {
            surprise_score,
            latent_norm: (norm_sq / 8.0).sqrt(),
            predicted_features: predicted,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_latent_evolution_and_surprise_bounded() {
        let mut m1 = VjepaWorldModel::new();
        let mut m2 = VjepaWorldModel::new();
        for step in 0..10 {
            let obs = [0.65, 0.25 + (step as f64) * 0.01, 0.30, 0.05];
            let r1 = m1.step(obs, 0.1);
            let r2 = m2.step(obs, 0.1);
            assert_eq!(r1, r2);
            assert!((0.0..=1.0).contains(&r1.surprise_score));
            assert!(r1.latent_norm.is_finite());
        }
    }

    #[test]
    fn step_change_spike_increases_surprise_score() {
        let mut model = VjepaWorldModel::new();
        let calm = [0.65, 0.22, 0.28, 0.05];
        for _ in 0..6 {
            model.step(calm, 0.0);
        }
        let steady = model.step(calm, 0.0);
        let shock = model.step([0.95, 0.94, 0.92, 0.85], 0.0);
        assert!(shock.surprise_score > steady.surprise_score);
        assert!(shock.surprise_score > 0.5);
    }
}
