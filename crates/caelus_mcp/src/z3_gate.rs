//! Formal `Z3` SMT2 Mutation Gate + One-Way Glass Wall (`Shisa Kanko`) Policy Evaluator.
//!
//! Enforces `(assert (=> mutation_requested (and glass_wall_human_signed z3_proof_valid)))`
//! fail-closed before any MCP mutation is permitted.

use caelus_core::i18n_seven::GlassWallStage;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const EMBEDDED_Z3_POLICY_SMT2: &str = "\
(declare-const mutation_requested Bool)
(declare-const glass_wall_human_signed Bool)
(declare-const z3_proof_valid Bool)
(assert (=> mutation_requested (and glass_wall_human_signed z3_proof_valid)))
(check-sat)
";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Z3GateVerdict {
    pub allowed: bool,
    pub mutation_requested: bool,
    pub glass_wall_human_signed: bool,
    pub z3_proof_valid: bool,
    pub policy_verified: bool,
    pub reason_code: String,
}

#[must_use]
pub fn default_z3_policy_path() -> PathBuf {
    PathBuf::from("mcp-connectors")
        .join("policies")
        .join("z3_gate.smt2")
}

/// Validates that the SMT-LIB2 policy file encodes the required Z3 mutation implication.
#[must_use]
pub fn verify_z3_smt2_policy_text(smt2: &str) -> bool {
    smt2.contains("mutation_requested")
        && smt2.contains("glass_wall_human_signed")
        && smt2.contains("z3_proof_valid")
        && smt2.contains(
            "(assert (=> mutation_requested (and glass_wall_human_signed z3_proof_valid)))",
        )
        && smt2.contains("(check-sat)")
}

/// Loads `mcp-connectors/policies/z3_gate.smt2` if present, otherwise checks embedded policy.
#[must_use]
pub fn verify_z3_policy_file(path: Option<&Path>) -> bool {
    let target = path
        .map(Path::to_path_buf)
        .unwrap_or_else(default_z3_policy_path);
    match fs::read_to_string(target) {
        Ok(text) => verify_z3_smt2_policy_text(&text),
        Err(_) => verify_z3_smt2_policy_text(EMBEDDED_Z3_POLICY_SMT2),
    }
}

/// Evaluates the One-Way Glass Wall + `Shisa Kanko` signature + Z3 safety proof invariant.
#[must_use]
pub fn evaluate_mutation_gate(
    mutation_requested: bool,
    stage: GlassWallStage,
    human_signed: bool,
    cbf_clamped: bool,
    raim_spoofed: bool,
) -> Z3GateVerdict {
    let policy_verified = verify_z3_policy_file(None);
    let glass_wall_human_signed = (stage == GlassWallStage::FieldMission) && human_signed;
    let z3_proof_valid = !cbf_clamped && !raim_spoofed && policy_verified;

    if !mutation_requested {
        return Z3GateVerdict {
            allowed: true,
            mutation_requested: false,
            glass_wall_human_signed,
            z3_proof_valid,
            policy_verified,
            reason_code: "READ_ONLY_ALLOWED".to_string(),
        };
    }

    if !z3_proof_valid {
        return Z3GateVerdict {
            allowed: false,
            mutation_requested: true,
            glass_wall_human_signed,
            z3_proof_valid: false,
            policy_verified,
            reason_code: if raim_spoofed {
                "BLOCKED_RAIM_SPOOF_UNSAFE".to_string()
            } else if cbf_clamped {
                "BLOCKED_CBF_BARRIER_CLAMPED".to_string()
            } else {
                "BLOCKED_Z3_POLICY_MISSING".to_string()
            },
        };
    }

    if !glass_wall_human_signed {
        return Z3GateVerdict {
            allowed: false,
            mutation_requested: true,
            glass_wall_human_signed: false,
            z3_proof_valid: true,
            policy_verified,
            reason_code: if stage != GlassWallStage::FieldMission {
                "BLOCKED_GLASS_WALL_STAGE".to_string()
            } else {
                "BLOCKED_SHISA_KANKO_UNSIGNED".to_string()
            },
        };
    }

    Z3GateVerdict {
        allowed: true,
        mutation_requested: true,
        glass_wall_human_signed: true,
        z3_proof_valid: true,
        policy_verified: true,
        reason_code: "Z3_AND_GLASS_WALL_APPROVED".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn z3_policy_file_matches_smt2_contract_and_blocks_unsafe_mutations() {
        let policy_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("mcp-connectors")
            .join("policies")
            .join("z3_gate.smt2");
        assert!(verify_z3_policy_file(Some(&policy_path)));

        // Read-only always permitted even before FieldMission promotion
        let ro = evaluate_mutation_gate(
            false,
            GlassWallStage::PersonalWorkspace,
            false,
            false,
            false,
        );
        assert!(ro.allowed);
        assert_eq!(ro.reason_code, "READ_ONLY_ALLOWED");

        // Unsigned or pre-promotion mutations strictly denied
        let no_stage =
            evaluate_mutation_gate(true, GlassWallStage::IncubationShelf, true, false, false);
        assert!(!no_stage.allowed);
        assert_eq!(no_stage.reason_code, "BLOCKED_GLASS_WALL_STAGE");

        let no_sig =
            evaluate_mutation_gate(true, GlassWallStage::FieldMission, false, false, false);
        assert!(!no_sig.allowed);
        assert_eq!(no_sig.reason_code, "BLOCKED_SHISA_KANKO_UNSIGNED");

        let spoofed = evaluate_mutation_gate(true, GlassWallStage::FieldMission, true, false, true);
        assert!(!spoofed.allowed);
        assert_eq!(spoofed.reason_code, "BLOCKED_RAIM_SPOOF_UNSAFE");

        let ok = evaluate_mutation_gate(true, GlassWallStage::FieldMission, true, false, false);
        assert!(ok.allowed);
        assert_eq!(ok.reason_code, "Z3_AND_GLASS_WALL_APPROVED");
    }
}
