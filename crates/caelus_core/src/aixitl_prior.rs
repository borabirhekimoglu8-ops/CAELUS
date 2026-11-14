//! Wave 9.1 AIXItl Minimum Description Length (MDL) + reward hypothesis prior
//! paired with CAELUS Axiom A-3 fail-closed Epistemic Tagging.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpistemicTag {
    Observation,
    Claim,
    Hypothesis,
}

impl EpistemicTag {
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Observation => "OBSERVATION",
            Self::Claim => "CLAIM",
            Self::Hypothesis => "HYPOTHESIS",
        }
    }

    #[must_use]
    pub const fn label_tr(self) -> &'static str {
        match self {
            Self::Observation => "Gozlem (Dogrudan)",
            Self::Claim => "Beyan (Imzali)",
            Self::Hypothesis => "Hipotez (Inceleme)",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HypothesisCandidate {
    pub id: u32,
    pub description_bits: u32,
    pub log_likelihood: f64,
    pub expected_utility: f64,
    pub corroborated_by_sensor: bool,
    pub human_approved: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AixitlSelection {
    pub id: u32,
    pub mdl_score: f64,
    pub tag: EpistemicTag,
}

/// Selects the competing hypothesis minimizing Solomonoff/MDL complexity while maximizing
/// reward + likelihood (`score = utility + log_likelihood - weight * bits`).
#[must_use]
pub fn select_mdl_hypothesis(
    candidates: &[HypothesisCandidate],
    complexity_weight: f64,
) -> Option<AixitlSelection> {
    let w = complexity_weight.max(0.0);
    candidates
        .iter()
        .map(|c| {
            let mdl_score = c.expected_utility + c.log_likelihood - w * (c.description_bits as f64);
            let tag = if c.corroborated_by_sensor {
                EpistemicTag::Observation
            } else if c.human_approved {
                EpistemicTag::Claim
            } else {
                EpistemicTag::Hypothesis
            };
            AixitlSelection {
                id: c.id,
                mdl_score,
                tag,
            }
        })
        .max_by(|a, b| {
            a.mdl_score
                .total_cmp(&b.mdl_score)
                .then_with(|| b.id.cmp(&a.id))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_simpler_hypothesis_on_equal_reward() -> Result<(), &'static str> {
        let cands = [
            HypothesisCandidate {
                id: 1,
                description_bits: 120,
                log_likelihood: -1.2,
                expected_utility: 5.0,
                corroborated_by_sensor: true,
                human_approved: false,
            },
            HypothesisCandidate {
                id: 2,
                description_bits: 18,
                log_likelihood: -1.2,
                expected_utility: 5.0,
                corroborated_by_sensor: true,
                human_approved: false,
            },
        ];
        let best = select_mdl_hypothesis(&cands, 0.05).ok_or("missing selection")?;
        assert_eq!(best.id, 2);
        assert_eq!(best.tag, EpistemicTag::Observation);
        Ok(())
    }

    #[test]
    fn assigns_fail_closed_epistemic_tags() -> Result<(), &'static str> {
        let cands = [
            HypothesisCandidate {
                id: 10,
                description_bits: 24,
                log_likelihood: -0.5,
                expected_utility: 8.0,
                corroborated_by_sensor: false,
                human_approved: false,
            },
            HypothesisCandidate {
                id: 11,
                description_bits: 24,
                log_likelihood: -0.5,
                expected_utility: 4.0,
                corroborated_by_sensor: false,
                human_approved: true,
            },
        ];
        let best = select_mdl_hypothesis(&cands, 0.02).ok_or("missing selection")?;
        assert_eq!(best.id, 10);
        assert_eq!(best.tag, EpistemicTag::Hypothesis);
        assert_eq!(best.tag.code(), "HYPOTHESIS");
        Ok(())
    }
}
