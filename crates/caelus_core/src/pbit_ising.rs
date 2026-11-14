//! Software P-bit / Thermodynamic Ising Sampler (Extropic-style architecture on CPU).
//! Solves combinatorial optimization (e.g., port berth & vessel routing assignment)
//! via Glauber / Gibbs sampling with simulated annealing.

#[derive(Debug, Clone)]
pub struct XorShift64 {
    state: u64,
}

impl XorShift64 {
    /// Initializes deterministic XorShift64 PRNG; zero seed falls back to golden ratio constant.
    pub fn new(seed: u64) -> Self {
        Self {
            state: if seed == 0 {
                0x9E37_79B9_7F4A_7C15
            } else {
                seed
            },
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        x
    }

    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / ((1u64 << 53) as f64)
    }
}

#[derive(Debug, Clone)]
pub struct IsingSolution {
    pub spins: Vec<i8>,
    pub energy: f64,
    pub sweeps: usize,
}

#[derive(Debug, Clone)]
pub struct PbitNetwork {
    pub n: usize,
    /// Symmetric coupling matrix J_ij
    pub j_matrix: Vec<Vec<f64>>,
    /// Local bias vector h_i
    pub h_bias: Vec<f64>,
    pub spins: Vec<i8>,
    rng: XorShift64,
}

impl PbitNetwork {
    /// Creates an Ising P-bit network from coupling matrix `j_matrix`, biases `h_bias`, and seed.
    pub fn new(j_matrix: Vec<Vec<f64>>, h_bias: Vec<f64>, seed: u64) -> Self {
        let n = h_bias.len();
        assert_eq!(j_matrix.len(), n);
        let mut rng = XorShift64::new(seed);
        let spins = (0..n)
            .map(|_| if rng.next_f64() > 0.5 { 1 } else { -1 })
            .collect();
        Self {
            n,
            j_matrix,
            h_bias,
            spins,
            rng,
        }
    }

    /// Evaluates the Ising Hamiltonian energy E = -sum_i h_i s_i - sum_{i<j} J_ij s_i s_j.
    pub fn energy(&self) -> f64 {
        let mut e = 0.0;
        for i in 0..self.n {
            e -= self.h_bias[i] * (self.spins[i] as f64);
            for j in (i + 1)..self.n {
                e -= self.j_matrix[i][j] * (self.spins[i] as f64) * (self.spins[j] as f64);
            }
        }
        e
    }

    /// Single Gibbs/Glauber p-bit sweep at inverse temperature beta.
    pub fn sweep(&mut self, beta: f64) {
        for i in 0..self.n {
            let mut local_field = self.h_bias[i];
            for j in 0..self.n {
                if i != j {
                    local_field += self.j_matrix[i][j] * (self.spins[j] as f64);
                }
            }
            // P(s_i = +1) = sigmoid(2 * beta * I_i)
            let p_plus = 1.0 / (1.0 + (-2.0 * beta * local_field).clamp(-30.0, 30.0).exp());
            self.spins[i] = if self.rng.next_f64() < p_plus { 1 } else { -1 };
        }
    }

    /// Runs simulated annealing from `beta_start` to `beta_end` and retains lowest-energy spins.
    pub fn solve_annealed(
        &mut self,
        sweeps: usize,
        beta_start: f64,
        beta_end: f64,
    ) -> IsingSolution {
        let mut best_spins = self.spins.clone();
        let mut best_energy = self.energy();

        for step in 0..sweeps {
            let frac = step as f64 / sweeps.max(1) as f64;
            let beta = beta_start + frac * (beta_end - beta_start);
            self.sweep(beta);
            let e = self.energy();
            if e < best_energy {
                best_energy = e;
                best_spins = self.spins.clone();
            }
        }
        self.spins = best_spins.clone();
        IsingSolution {
            spins: best_spins,
            energy: best_energy,
            sweeps,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xorshift64_is_deterministic_even_for_zero_seed() {
        let mut a = XorShift64::new(0);
        let mut b = XorShift64::new(0);
        for _ in 0..16 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn annealing_finds_ferromagnetic_ground_state() {
        let j = vec![
            vec![0.0, 2.0, 2.0, 2.0],
            vec![2.0, 0.0, 2.0, 2.0],
            vec![2.0, 2.0, 0.0, 2.0],
            vec![2.0, 2.0, 2.0, 0.0],
        ];
        let h = vec![0.8, 0.8, 0.8, 0.8];
        let mut net = PbitNetwork::new(j.clone(), h.clone(), 42);
        let initial_energy = net.energy();
        let sol = net.solve_annealed(120, 0.2, 4.0);
        assert!(sol.energy <= initial_energy);
        assert_eq!(sol.spins, vec![1, 1, 1, 1]);

        // Reproducibility check with identical seed
        let mut net2 = PbitNetwork::new(j, h, 42);
        let sol2 = net2.solve_annealed(120, 0.2, 4.0);
        assert_eq!(sol.spins, sol2.spins);
        assert!((sol.energy - sol2.energy).abs() < 1e-12);
    }
}
