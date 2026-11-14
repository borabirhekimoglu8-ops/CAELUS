//! Wave 9.1 CALYX associative event-relation trace memory with temporal decay.
//! Zero heap allocation fixed-slot memory preserving the strongest active causal links.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CalyxEdge {
    pub active: bool,
    pub cause_id: u32,
    pub effect_id: u32,
    pub base_strength: f64,
    pub recorded_hour: f64,
}

impl Default for CalyxEdge {
    fn default() -> Self {
        Self {
            active: false,
            cause_id: 0,
            effect_id: 0,
            base_strength: 0.0,
            recorded_hour: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CalyxMemory {
    edges: [CalyxEdge; 16],
    half_life_hours: f64,
}

impl Default for CalyxMemory {
    fn default() -> Self {
        Self::new(6.0)
    }
}

impl CalyxMemory {
    /// Creates an associative trace memory with the requested temporal half-life in hours.
    #[must_use]
    pub const fn new(half_life_hours: f64) -> Self {
        Self {
            edges: [CalyxEdge {
                active: false,
                cause_id: 0,
                effect_id: 0,
                base_strength: 0.0,
                recorded_hour: 0.0,
            }; 16],
            half_life_hours: if half_life_hours > 0.01 {
                half_life_hours
            } else {
                1.0
            },
        }
    }

    /// Inserts or refreshes a `(cause_id -> effect_id)` trace at `current_hour`.
    pub fn record(&mut self, cause_id: u32, effect_id: u32, strength: f64, current_hour: f64) {
        let clamped_strength = strength.clamp(0.0, 1.0);
        if let Some(existing) = self
            .edges
            .iter_mut()
            .find(|e| e.active && e.cause_id == cause_id && e.effect_id == effect_id)
        {
            existing.base_strength = existing.base_strength.max(clamped_strength).clamp(0.0, 1.0);
            existing.recorded_hour = current_hour;
            return;
        }

        if let Some(free) = self.edges.iter_mut().find(|e| !e.active) {
            *free = CalyxEdge {
                active: true,
                cause_id,
                effect_id,
                base_strength: clamped_strength,
                recorded_hour: current_hour,
            };
            return;
        }

        // Replace weakest decayed edge
        let lambda = std::f64::consts::LN_2 / self.half_life_hours;
        let mut weakest_idx = 0usize;
        let mut weakest_val = f64::INFINITY;
        for (idx, edge) in self.edges.iter().enumerate() {
            let dt = (current_hour - edge.recorded_hour).abs();
            let decayed = edge.base_strength * (-lambda * dt).exp();
            if decayed < weakest_val {
                weakest_val = decayed;
                weakest_idx = idx;
            }
        }
        self.edges[weakest_idx] = CalyxEdge {
            active: true,
            cause_id,
            effect_id,
            base_strength: clamped_strength,
            recorded_hour: current_hour,
        };
    }

    /// Computes exponentially decayed link strength at `current_hour`.
    #[must_use]
    pub fn decayed_strength(&self, cause_id: u32, effect_id: u32, current_hour: f64) -> f64 {
        let lambda = std::f64::consts::LN_2 / self.half_life_hours;
        self.edges
            .iter()
            .find(|e| e.active && e.cause_id == cause_id && e.effect_id == effect_id)
            .map_or(0.0, |edge| {
                let dt = (current_hour - edge.recorded_hour).abs();
                (edge.base_strength * (-lambda * dt).exp()).clamp(0.0, 1.0)
            })
    }

    /// Returns `(cause_id, effect_id, strength)` of the dominant active link.
    #[must_use]
    pub fn strongest_association(&self, current_hour: f64) -> Option<(u32, u32, f64)> {
        let lambda = std::f64::consts::LN_2 / self.half_life_hours;
        self.edges
            .iter()
            .filter(|e| e.active)
            .map(|edge| {
                let dt = (current_hour - edge.recorded_hour).abs();
                let s = (edge.base_strength * (-lambda * dt).exp()).clamp(0.0, 1.0);
                (edge.cause_id, edge.effect_id, s)
            })
            .max_by(|a, b| a.2.total_cmp(&b.2))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exponential_decay_reduces_older_traces() {
        let mut mem = CalyxMemory::new(4.0);
        mem.record(10, 20, 0.80, 0.0);
        let at_zero = mem.decayed_strength(10, 20, 0.0);
        let at_half_life = mem.decayed_strength(10, 20, 4.0);
        assert!((at_zero - 0.80).abs() < 1e-9);
        assert!((at_half_life - 0.40).abs() < 1e-6);
    }

    #[test]
    fn strongest_association_tracks_dominant_event() -> Result<(), &'static str> {
        let mut mem = CalyxMemory::new(6.0);
        mem.record(1, 100, 0.45, 0.0);
        mem.record(2, 200, 0.92, 1.0);
        let top = mem
            .strongest_association(1.0)
            .ok_or("missing association")?;
        assert_eq!(top.0, 2);
        assert_eq!(top.1, 200);
        assert!(top.2 > 0.90);
        Ok(())
    }
}
