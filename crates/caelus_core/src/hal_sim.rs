//! Hardware Abstraction Layer (HAL) Simulator for emerging/pre-commercial hardware:
//! - Vaire Computing Adiabatic Charge Recovery
//! - Extropic Z1 Thermodynamic P-bit Array
//! - TEG / ORC Waste-Heat Recovery
//! - UPMEM PIM / CXL / Photonic DONN (Wave 7-9.1)
//! - Q-INS/MagNav, Rydberg RF, JANUS Acoustic, FSO Laser, TPM 2.0/zkVM/FHE
//!
//! Note: Software simulation budgets until commercial silicon is available.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HardwareProfile {
    StandardCpuEdge,
    VaireAdiabaticSim,
    ExtropicZ1Sim,
    TegOrcWasteHeatSim,
    UpmemCxlDonnSim,
    QinsMagNavSim,
    RydbergRfSim,
    JanusAcousticSim,
    FsoLaserLinkSim,
    TpmZkVmFheAttestSim,
}

impl HardwareProfile {
    pub const ALL: [HardwareProfile; 10] = [
        HardwareProfile::StandardCpuEdge,
        HardwareProfile::VaireAdiabaticSim,
        HardwareProfile::ExtropicZ1Sim,
        HardwareProfile::TegOrcWasteHeatSim,
        HardwareProfile::UpmemCxlDonnSim,
        HardwareProfile::QinsMagNavSim,
        HardwareProfile::RydbergRfSim,
        HardwareProfile::JanusAcousticSim,
        HardwareProfile::FsoLaserLinkSim,
        HardwareProfile::TpmZkVmFheAttestSim,
    ];

    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::StandardCpuEdge => "CPU-EDGE",
            Self::VaireAdiabaticSim => "VAIRE-ADIABATIC",
            Self::ExtropicZ1Sim => "EXTROPIC-Z1",
            Self::TegOrcWasteHeatSim => "TEG-ORC-HEAT",
            Self::UpmemCxlDonnSim => "UPMEM-CXL-DONN",
            Self::QinsMagNavSim => "Q-INS-MAGNAV",
            Self::RydbergRfSim => "RYDBERG-RF",
            Self::JanusAcousticSim => "JANUS-ACOUSTIC",
            Self::FsoLaserLinkSim => "FSO-LASER",
            Self::TpmZkVmFheAttestSim => "TPM-ZKVM-FHE",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HalBudget {
    pub profile: HardwareProfile,
    pub compute_ops: u64,
    pub estimated_energy_mj: f64,
    pub recovered_heat_mj: f64,
    pub net_energy_mj: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HalSensorSecurityBudget {
    pub profile: HardwareProfile,
    pub latency_ms: f64,
    pub net_energy_mj: f64,
    pub integrity_confidence: f64,
    pub silicon_ready: bool,
}

/// Estimates compute energy budget and optional TEG/ORC waste-heat recovery in millijoules.
#[must_use]
pub fn estimate_hal_budget(
    profile: HardwareProfile,
    compute_ops: u64,
    enable_teg_orc: bool,
) -> HalBudget {
    let pj_per_op = match profile {
        HardwareProfile::StandardCpuEdge => 12.0,
        HardwareProfile::VaireAdiabaticSim => 1.8, // Simulated adiabatic charge recovery
        HardwareProfile::ExtropicZ1Sim => 0.45,    // Simulated thermodynamic sampling
        HardwareProfile::TegOrcWasteHeatSim => 9.5,
        HardwareProfile::UpmemCxlDonnSim => 1.15,
        HardwareProfile::QinsMagNavSim => 3.4,
        HardwareProfile::RydbergRfSim => 2.8,
        HardwareProfile::JanusAcousticSim => 4.2,
        HardwareProfile::FsoLaserLinkSim => 1.6,
        HardwareProfile::TpmZkVmFheAttestSim => 6.4,
    };
    let estimated_energy_mj = (compute_ops as f64) * pj_per_op * 1e-9;
    let recovered_heat_mj = if enable_teg_orc {
        match profile {
            HardwareProfile::TegOrcWasteHeatSim => estimated_energy_mj * 0.24,
            HardwareProfile::VaireAdiabaticSim => estimated_energy_mj * 0.085,
            _ => estimated_energy_mj * 0.075,
        }
    } else {
        0.0
    };
    HalBudget {
        profile,
        compute_ops,
        estimated_energy_mj,
        recovered_heat_mj,
        net_energy_mj: (estimated_energy_mj - recovered_heat_mj).max(0.0),
    }
}

/// Estimates realistic energy, latency, and confidence budgets for Wave 7-9.1 hardware profiles.
#[must_use]
pub fn estimate_extended_hal(
    profile: HardwareProfile,
    compute_ops: u64,
    enable_teg_orc: bool,
) -> HalSensorSecurityBudget {
    let base = estimate_hal_budget(profile, compute_ops, enable_teg_orc);
    let (latency_ms, integrity_confidence, silicon_ready) = match profile {
        HardwareProfile::StandardCpuEdge => (0.9, 0.96, true),
        HardwareProfile::VaireAdiabaticSim => (2.1, 0.94, false),
        HardwareProfile::ExtropicZ1Sim => (1.4, 0.92, false),
        HardwareProfile::TegOrcWasteHeatSim => (4.0, 0.95, true),
        HardwareProfile::UpmemCxlDonnSim => (1.8, 0.93, false),
        HardwareProfile::QinsMagNavSim => (8.5, 0.985, false),
        HardwareProfile::RydbergRfSim => (3.2, 0.94, false),
        HardwareProfile::JanusAcousticSim => (42.0, 0.89, true),
        HardwareProfile::FsoLaserLinkSim => (0.6, 0.97, true),
        HardwareProfile::TpmZkVmFheAttestSim => (14.5, 0.999, true),
    };
    HalSensorSecurityBudget {
        profile,
        latency_ms,
        net_energy_mj: base.net_energy_mj,
        integrity_confidence,
        silicon_ready,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn energy_ordering_and_thermodynamic_recovery_hold() {
        let ops = 50_000_000;
        let cpu = estimate_hal_budget(HardwareProfile::StandardCpuEdge, ops, false);
        let vaire = estimate_hal_budget(HardwareProfile::VaireAdiabaticSim, ops, false);
        let extropic = estimate_hal_budget(HardwareProfile::ExtropicZ1Sim, ops, false);

        assert!(extropic.estimated_energy_mj < vaire.estimated_energy_mj);
        assert!(vaire.estimated_energy_mj < cpu.estimated_energy_mj);
        assert_eq!(vaire.recovered_heat_mj, 0.0);

        let vaire_rec = estimate_hal_budget(HardwareProfile::VaireAdiabaticSim, ops, true);
        assert!(vaire_rec.recovered_heat_mj > 0.0);
        assert!(vaire_rec.net_energy_mj > 0.0);
        assert!(vaire_rec.net_energy_mj < vaire_rec.estimated_energy_mj);
    }

    #[test]
    fn wave7_hal_profiles_report_valid_energy_and_confidence() {
        for profile in HardwareProfile::ALL {
            let ext = estimate_extended_hal(profile, 20_000_000, true);
            assert!(ext.net_energy_mj > 0.0);
            assert!(ext.latency_ms > 0.0);
            assert!((0.5..=1.0).contains(&ext.integrity_confidence));
            assert!(!profile.code().is_empty());
        }
        let attest = estimate_extended_hal(HardwareProfile::TpmZkVmFheAttestSim, 10_000_000, true);
        assert!(attest.integrity_confidence > 0.99);
    }
}
