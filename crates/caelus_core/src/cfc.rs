//! Closed-form Continuous-depth (CfC) / Liquid Neural Network cell in Pure Rust.
//! Implements Hasani et al. closed-form solution:
//! x(t) = (x_0 - f(x_0, I)) * exp(-(w_tau + g(x_0, I)) * dt) + f(x_0, I)

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TelemetrySample {
    pub dt_seconds: f64,
    /// Normalized [0, 1] features: [speed_kn, wave_m, wind_kn, ais_gap_s]
    pub features: [f64; 4],
}

#[derive(Debug, Clone)]
pub struct CfcCell {
    pub hidden_dim: usize,
    pub input_dim: usize,
    pub tau_base: Vec<f64>,
    pub w_f: Vec<Vec<f64>>,
    pub b_f: Vec<f64>,
    pub w_g: Vec<Vec<f64>>,
    pub b_g: Vec<f64>,
    pub state: Vec<f64>,
}

#[inline]
fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x.clamp(-30.0, 30.0)).exp())
}

impl CfcCell {
    /// Creates a deterministic CfC cell with fixed phase-derived weights.
    pub fn deterministic(hidden_dim: usize, input_dim: usize) -> Self {
        let mut w_f = vec![vec![0.0; hidden_dim + input_dim]; hidden_dim];
        let mut w_g = vec![vec![0.0; hidden_dim + input_dim]; hidden_dim];
        let mut tau_base = vec![1.0; hidden_dim];
        let mut b_f = vec![0.0; hidden_dim];
        let mut b_g = vec![0.0; hidden_dim];

        for i in 0..hidden_dim {
            tau_base[i] = 0.6 + 0.15 * ((i % 4) as f64);
            b_f[i] = 0.05 * ((i as f64) - (hidden_dim as f64) / 2.0) / (hidden_dim.max(1) as f64);
            b_g[i] = 0.25;
            for j in 0..(hidden_dim + input_dim) {
                let phase = ((i * 7 + j * 13) % 19) as f64 / 19.0 - 0.5;
                w_f[i][j] = phase * 0.65;
                w_g[i][j] = phase.abs() * 0.45;
            }
        }

        Self {
            hidden_dim,
            input_dim,
            tau_base,
            w_f,
            b_f,
            w_g,
            b_g,
            state: vec![0.0; hidden_dim],
        }
    }

    /// Zeroes latent state in place without allocating memory.
    pub fn reset(&mut self) {
        self.state.fill(0.0);
    }

    /// Advances the continuous-depth hidden state by `dt_seconds`.
    pub fn step(&mut self, input: &[f64], dt_seconds: f64) -> &[f64] {
        assert_eq!(input.len(), self.input_dim);
        let dt = dt_seconds.max(1e-4);
        let mut concat = Vec::with_capacity(self.hidden_dim + self.input_dim);
        concat.extend_from_slice(&self.state);
        concat.extend_from_slice(input);

        let mut next_state = vec![0.0; self.hidden_dim];
        for (i, next_slot) in next_state.iter_mut().enumerate() {
            let mut sum_f = self.b_f[i];
            let mut sum_g = self.b_g[i];
            for (j, &val) in concat.iter().enumerate() {
                sum_f += self.w_f[i][j] * val;
                sum_g += self.w_g[i][j] * val;
            }
            let f_val = sum_f.tanh();
            let g_val = sigmoid(sum_g);
            let decay = (-(self.tau_base[i] + g_val) * dt).exp();
            *next_slot = (self.state[i] - f_val) * decay + f_val;
        }
        self.state = next_state;
        &self.state
    }

    /// Computes a bounded [0.0, 1.0] anomaly score for a telemetry sample.
    pub fn anomaly_score(&mut self, sample: &TelemetrySample) -> f64 {
        let prev = self.state.clone();
        let next = self.step(&sample.features, sample.dt_seconds);
        let l2: f64 = prev
            .iter()
            .zip(next.iter())
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>()
            .sqrt();
        let input_energy: f64 = sample.features.iter().map(|x| x * x).sum::<f64>().sqrt();
        (0.6 * l2 + 0.4 * (input_energy / 2.0)).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_initialization_is_identical() {
        let mut a = CfcCell::deterministic(8, 4);
        let mut b = CfcCell::deterministic(8, 4);
        let sample = TelemetrySample {
            dt_seconds: 1.5,
            features: [0.4, 0.3, 0.2, 0.1],
        };
        let sa = a.anomaly_score(&sample);
        let sb = b.anomaly_score(&sample);
        assert!((sa - sb).abs() < 1e-12);
        assert_eq!(a.state, b.state);
    }

    #[test]
    fn anomaly_score_stays_bounded_and_responds_to_storm() {
        let mut calm_cell = CfcCell::deterministic(8, 4);
        let calm = TelemetrySample {
            dt_seconds: 1.0,
            features: [0.2, 0.1, 0.1, 0.0],
        };
        let calm_score = calm_cell.anomaly_score(&calm);

        let mut storm_cell = CfcCell::deterministic(8, 4);
        let storm = TelemetrySample {
            dt_seconds: 3.0,
            features: [0.95, 0.95, 0.90, 0.85],
        };
        let storm_score = storm_cell.anomaly_score(&storm);

        assert!((0.0..=1.0).contains(&calm_score));
        assert!((0.0..=1.0).contains(&storm_score));
        assert!(storm_score > calm_score);
    }

    #[test]
    fn step_handles_tiny_and_large_dt_without_nan() {
        let mut cell = CfcCell::deterministic(6, 4);
        let zero_dt = cell.step(&[0.5, 0.5, 0.5, 0.5], 0.0).to_vec();
        assert!(zero_dt.iter().all(|v| v.is_finite() && v.abs() <= 1.0));

        let large_dt = cell.step(&[1.0, 0.8, 0.6, 0.4], 120.0).to_vec();
        assert!(large_dt.iter().all(|v| v.is_finite() && v.abs() <= 1.0));
    }
}
