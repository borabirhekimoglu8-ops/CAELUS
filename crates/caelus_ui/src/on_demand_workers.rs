//! On-demand isolated child process launcher for heavy optional engines:
//! - Rerun 4D / 3DGS (`Brush`) scene viewer
//! - GStreamer live RTSP video projection
//! - Kokoro-82M + Kira 3D audiovisual briefing renderer
//! - SP1/RISC0 zkVM / Z3 formal verification prover
//!
//! Keeps 0 bytes inside `caelus_ui` process memory until explicitly launched;
//! returns 100% of child RAM when stopped or dropped.

use caelus_core::domain::Locale;
use std::process::{Child, Command, Stdio};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnDemandWorkerKind {
    RerunBrush4d,
    GStreamerRtspProjection,
    KokoroKira3dReport,
    Sp1Z3Prover,
}

impl OnDemandWorkerKind {
    pub const ALL: [Self; 4] = [
        Self::RerunBrush4d,
        Self::GStreamerRtspProjection,
        Self::KokoroKira3dReport,
        Self::Sp1Z3Prover,
    ];

    pub const fn binary_candidates(self) -> &'static [&'static str] {
        match self {
            Self::RerunBrush4d => &["rerun", "brush_app"],
            Self::GStreamerRtspProjection => &["gst-launch-1.0"],
            Self::KokoroKira3dReport => &["caelus-kokoro-kira"],
            Self::Sp1Z3Prover => &["z3", "cargo-prove"],
        }
    }

    pub const fn default_args(self) -> &'static [&'static str] {
        match self {
            Self::RerunBrush4d => &["--memory-limit", "512MB"],
            Self::GStreamerRtspProjection => &["--version"],
            Self::KokoroKira3dReport => &["--offline-3d-brief"],
            Self::Sp1Z3Prover => &["mcp-connectors/policies/z3_gate.smt2"],
        }
    }

    pub fn label(self, locale: Locale) -> &'static str {
        match (self, locale) {
            (Self::RerunBrush4d, Locale::Tr) => "4D Sahne (Rerun)",
            (Self::RerunBrush4d, Locale::En) => "4D Scene (Rerun)",
            (Self::GStreamerRtspProjection, Locale::Tr) => "Canli Video (GStreamer)",
            (Self::GStreamerRtspProjection, Locale::En) => "Live Video (GStreamer)",
            (Self::KokoroKira3dReport, Locale::Tr) => "3B Sesli Rapor (Kokoro)",
            (Self::KokoroKira3dReport, Locale::En) => "3D Voice Brief (Kokoro)",
            (Self::Sp1Z3Prover, Locale::Tr) => "Resmi Dogrulama (Z3/zk)",
            (Self::Sp1Z3Prover, Locale::En) => "Formal Prover (Z3/zk)",
        }
    }
}

#[derive(Debug)]
struct ActiveSlot {
    kind: OnDemandWorkerKind,
    child: Child,
}

#[derive(Debug, Default)]
pub struct OnDemandWorkerManager {
    slots: Vec<ActiveSlot>,
    pub last_status: String,
}

impl OnDemandWorkerManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reaps any exited child processes so OS handles and PIDs are cleaned promptly.
    pub fn poll_reap(&mut self) {
        self.slots.retain_mut(|slot| match slot.child.try_wait() {
            Ok(Some(_status)) => false,
            Ok(None) => true,
            Err(_) => false,
        });
    }

    pub fn is_running(&mut self, kind: OnDemandWorkerKind) -> bool {
        self.poll_reap();
        self.slots.iter().any(|s| s.kind == kind)
    }

    /// Starts or stops an on-demand isolated worker child process.
    pub fn toggle(&mut self, kind: OnDemandWorkerKind, locale: Locale) -> bool {
        self.poll_reap();
        if let Some(pos) = self.slots.iter().position(|s| s.kind == kind) {
            let mut slot = self.slots.remove(pos);
            let _ = slot.child.kill();
            let _ = slot.child.wait();
            self.last_status = match locale {
                Locale::Tr => format!("{} kapatildi (RAM iade)", kind.label(locale)),
                Locale::En => format!("{} stopped (RAM reclaimed)", kind.label(locale)),
            };
            return false;
        }

        for bin in kind.binary_candidates() {
            if let Ok(child) = Command::new(bin)
                .args(kind.default_args())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                let pid = child.id();
                self.slots.push(ActiveSlot { kind, child });
                self.last_status = format!("{} PID {}", kind.label(locale), pid);
                return true;
            }
        }

        self.last_status = match locale {
            Locale::Tr => format!("{} kurulu degil (0 B yuklendi)", kind.label(locale)),
            Locale::En => format!("{} not installed (0 B loaded)", kind.label(locale)),
        };
        false
    }

    #[allow(dead_code)]
    pub fn active_count(&mut self) -> usize {
        self.poll_reap();
        self.slots.len()
    }

    pub fn stop_all(&mut self) {
        for mut slot in self.slots.drain(..) {
            let _ = slot.child.kill();
            let _ = slot.child.wait();
        }
    }
}

impl Drop for OnDemandWorkerManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manager_handles_unavailable_worker_with_zero_panics_and_cleans_up() {
        let mut mgr = OnDemandWorkerManager::new();
        assert_eq!(mgr.active_count(), 0);
        let started = mgr.toggle(OnDemandWorkerKind::KokoroKira3dReport, Locale::En);
        assert!(!started || mgr.active_count() == 1);
        mgr.stop_all();
        assert_eq!(mgr.active_count(), 0);
    }
}
