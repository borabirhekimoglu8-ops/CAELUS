// CAELUS OS — Bi-Temporal Sidecar Airlock Slice Evaluator (caelus_core::airlock)
//
// Pure `no_std + alloc` deterministic kernel module:
//   • ZERO network, ZERO filesystem, ZERO IEEE-754 floating-point math.
//   • Consumes pre-verified fixed-point (`FP_SCALE = 1_000_000`) airlock events.
//   • Enforces Z3 safe domain (`|fp_val| <= 2^62`, `REJECT_AT_AIRLOCK`).
//   • Enforces strict bi-temporal slice isolation (`learned_at_ms <= cutoff_learned_at_ms`)
//     with zero look-ahead leakage: post-cutoff records have zero effect on slice state,
//     duplicates, conflicts, or state digest.
//   • Enforces deterministic total ordering:
//     `(observed_at_ms ASC, learned_at_ms ASC, source_id ASC [UTF-8 bytes], seq_no ASC, event_id ASC)`.
//   • Preserves conflicting assertions side-by-side without overwriting and enforces
//     epistemic discipline (`OBSERVATION`, `CLAIM`, `HYPOTHESIS`).

use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::engine::{CausalEngine, Node, NodeKind};
use crate::fp::{fp_add_saturating, fp_clamp, fp_div, FP_ONE, FP_SCALE};

/// Fixed-point scale mandated by CAELUS Axiom A-1 (`1e6`).
pub const AIRLOCK_FP_SCALE: i64 = FP_SCALE;

/// Z3 `fp_add_no_overflow` safe input magnitude bound (`2^62 = 4_611_686_018_427_387_904`).
/// Values outside `[-AIRLOCK_FP_SAFE_MAX_ABS, +AIRLOCK_FP_SAFE_MAX_ABS]` are rejected
/// fail-closed (`ERR_SCHEMA_OR_RANGE`) rather than silently saturated at the boundary.
pub const AIRLOCK_FP_SAFE_MAX_ABS: i64 = 1i64 << 62;

/// Canonical schema version for PR-1 `CAELUS_INTEL_V2` airlock records.
pub const AIRLOCK_SCHEMA_V2: &str = "2.0";

/// Legacy unscoped v1 marker when routed through the v1/v2 adapter.
pub const AIRLOCK_SCHEMA_V1_LEGACY: &str = "1.0";

/// Epistemic classification of an ingested airlock record (§3.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EpistemicStatus {
    /// Direct calibrated field instrument or verified physical berth/time observation.
    Observation,
    /// Human operator report or uncorroborated operational statement.
    Claim,
    /// Model, statistical, or LLM/agent inference (never self-confirming).
    Hypothesis,
}

impl EpistemicStatus {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "OBSERVATION" => Some(Self::Observation),
            "CLAIM" => Some(Self::Claim),
            "HYPOTHESIS" => Some(Self::Hypothesis),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Observation => "OBSERVATION",
            Self::Claim => "CLAIM",
            Self::Hypothesis => "HYPOTHESIS",
        }
    }
}

/// Sidecar fixed-point rounding contract (§3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoundingMode {
    HalfEven,
}

impl RoundingMode {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "HALF_EVEN" => Some(Self::HalfEven),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::HalfEven => "HALF_EVEN",
        }
    }
}

/// Sidecar fixed-point overflow contract (§3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverflowPolicy {
    RejectAtAirlock,
}

impl OverflowPolicy {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "REJECT_AT_AIRLOCK" => Some(Self::RejectAtAirlock),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RejectAtAirlock => "REJECT_AT_AIRLOCK",
        }
    }
}

/// Fail-closed airlock & slice rejection codes (§3.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AirlockErrorCode {
    ErrSignatureMismatch,
    ErrUntrustedSource,
    ErrUnauthorizedKind,
    ErrSchemaOrRange,
    ErrSourceEquivocation,
}

impl AirlockErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ErrSignatureMismatch => "ERR_SIGNATURE_MISMATCH",
            Self::ErrUntrustedSource => "ERR_UNTRUSTED_SOURCE",
            Self::ErrUnauthorizedKind => "ERR_UNAUTHORIZED_KIND",
            Self::ErrSchemaOrRange => "ERR_SCHEMA_OR_RANGE",
            Self::ErrSourceEquivocation => "ERR_SOURCE_EQUIVOCATION",
        }
    }

    pub const fn audit_record_type(self) -> &'static str {
        match self {
            Self::ErrSourceEquivocation => "SECURITY_ALERT_EQUIVOCATION",
            _ => "INGEST_REJECTED",
        }
    }
}

/// Slice-level error returned without mutating any engine state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirlockSliceError {
    pub code: AirlockErrorCode,
    pub source_id: String,
    pub event_id: String,
    pub seq_no: u64,
    pub detail: String,
}

/// Human-approved read-only slice evaluation verdict (§4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SliceVerdict {
    /// Under `(input_batch_blake3, cutoff_ts, scenario_id, policy_id)`, corroborated
    /// evidence satisfies policy bounds with no unresolved conflict.
    Gecti,
    /// Corroborated evidence breaches the policy threshold (`fp_val > max_allowed_fp`).
    KuralIhlali,
    /// Evidence is absent, uncorroborated (`CLAIM`/`HYPOTHESIS` alone), or conflicted.
    KanitYetersiz,
}

impl SliceVerdict {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Gecti => "GEÇTİ",
            Self::KuralIhlali => "KURAL_İHLALİ",
            Self::KanitYetersiz => "KANIT_YETERSİZ",
        }
    }
}

/// Pre-verified event entering `caelus_core` across the sidecar airlock boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedAirlockEvent {
    pub schema_version: String,
    pub source_id: String,
    pub key_id: String,
    pub independence_group: String,
    pub event_kind: String,
    pub event_id: String,
    pub seq_no: u64,
    pub observed_at_ms: i64,
    pub learned_at_ms: i64,
    pub epistemic_status: EpistemicStatus,
    pub subject_id: String,
    pub metric_key: String,
    pub fp_val: i64,
    pub fp_scale: i64,
    pub unit: String,
    pub rounding: RoundingMode,
    pub overflow_policy: OverflowPolicy,
    pub supersedes_event_id: Option<String>,
    pub payload_blake3_hex: String,
    pub legacy_unscoped: bool,
    pub note: String,
}

impl VerifiedAirlockEvent {
    /// Validate fixed-point range, scale, schema, and identifier invariants.
    pub fn validate_invariants(&self, require_v2_airlock: bool) -> Result<(), AirlockSliceError> {
        if self.legacy_unscoped || self.schema_version == AIRLOCK_SCHEMA_V1_LEGACY {
            if require_v2_airlock {
                return Err(AirlockSliceError {
                    code: AirlockErrorCode::ErrSchemaOrRange,
                    source_id: self.source_id.clone(),
                    event_id: self.event_id.clone(),
                    seq_no: self.seq_no,
                    detail: String::from("LEGACY_UNSCOPED v1 packet rejected under require_v2_airlock policy"),
                });
            }
        } else if self.schema_version != AIRLOCK_SCHEMA_V2 {
            return Err(AirlockSliceError {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: self.source_id.clone(),
                event_id: self.event_id.clone(),
                seq_no: self.seq_no,
                detail: String::from("unsupported schema_version (expected 2.0)"),
            });
        }

        if self.source_id.is_empty()
            || self.event_id.is_empty()
            || self.event_kind.is_empty()
            || self.unit.is_empty()
            || self.subject_id.is_empty()
            || self.metric_key.is_empty()
        {
            return Err(AirlockSliceError {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: self.source_id.clone(),
                event_id: self.event_id.clone(),
                seq_no: self.seq_no,
                detail: String::from("mandatory string identifier field is empty"),
            });
        }

        if self.fp_scale != AIRLOCK_FP_SCALE {
            return Err(AirlockSliceError {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: self.source_id.clone(),
                event_id: self.event_id.clone(),
                seq_no: self.seq_no,
                detail: String::from("fp_scale must equal 1_000_000"),
            });
        }

        if !is_within_airlock_safe_fp_range(self.fp_val) {
            return Err(AirlockSliceError {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: self.source_id.clone(),
                event_id: self.event_id.clone(),
                seq_no: self.seq_no,
                detail: String::from("INVALID_RANGE: |fp_val| exceeds Z3 safe bound 2^62"),
            });
        }

        if self.observed_at_ms < 0 || self.learned_at_ms < 0 {
            return Err(AirlockSliceError {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: self.source_id.clone(),
                event_id: self.event_id.clone(),
                seq_no: self.seq_no,
                detail: String::from("timestamps must be non-negative epoch milliseconds"),
            });
        }

        if self.payload_blake3_hex.len() != 64
            || !self
                .payload_blake3_hex
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err(AirlockSliceError {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: self.source_id.clone(),
                event_id: self.event_id.clone(),
                seq_no: self.seq_no,
                detail: String::from("payload_blake3_hex must be 64 hex characters"),
            });
        }

        Ok(())
    }
}

/// Policy parameters governing deterministic slice evaluation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlicePolicy {
    pub policy_id: String,
    pub scenario_id: String,
    pub max_allowed_fp: i64,
    pub conflict_divergence_threshold_fp: i64,
    pub require_independent_corroboration_for_claims: bool,
    pub min_independent_groups_for_pass: usize,
    pub require_v2_airlock: bool,
}

impl Default for SlicePolicy {
    fn default() -> Self {
        Self {
            policy_id: String::from("POLICY_FERRY_BERTH_SLA_V1"),
            scenario_id: String::from("PILOT_AEGEAN_FERRY_DELAY_V1"),
            max_allowed_fp: 20 * AIRLOCK_FP_SCALE, // 20.0 minutes SLA threshold
            conflict_divergence_threshold_fp: 15 * AIRLOCK_FP_SCALE, // 15.0 minutes divergence alert
            require_independent_corroboration_for_claims: true,
            min_independent_groups_for_pass: 1,
            require_v2_airlock: true,
        }
    }
}

/// Preserved historical or active record within a slice (never overwritten on conflict).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreservedSliceAssertion {
    pub event_id: String,
    pub source_id: String,
    pub key_id: String,
    pub independence_group: String,
    pub event_kind: String,
    pub seq_no: u64,
    pub observed_at_ms: i64,
    pub learned_at_ms: i64,
    pub epistemic_status: EpistemicStatus,
    pub subject_id: String,
    pub metric_key: String,
    pub fp_val: i64,
    pub unit: String,
    pub supersedes_event_id: Option<String>,
    pub superseded_by_event_id: Option<String>,
    pub legacy_unscoped: bool,
    pub note: String,
}

/// Explicit side-by-side record when two sources diverge or straddle the policy threshold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceConflictRecord {
    pub subject_id: String,
    pub metric_key: String,
    pub unit: String,
    pub min_fp_val: i64,
    pub max_fp_val: i64,
    pub source_ids: Vec<String>,
    pub event_ids: Vec<String>,
    pub resolved_by_calibrated_observation_breach: bool,
}

/// Logged idempotent duplicate (`(source_id, seq_no)` + identical `payload_blake3_hex`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotentDuplicateRecord {
    pub source_id: String,
    pub seq_no: u64,
    pub event_id: String,
    pub payload_blake3_hex: String,
}

/// Pure fixed-point snapshot of the causal projection for a slice (`Eq`, zero float).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CausalSliceSnapshotFp {
    pub tick: u64,
    pub raw_friction_fp: i64,
    pub clamped_friction_fp: i64,
    pub throughput_ratio_fp: i64,
    pub regime_exceeded: bool,
    pub any_hysteresis_flip: bool,
    pub any_deadline_missed: bool,
    pub outage_active: bool,
}

/// Deterministic output of `ingest_verified_slice`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SliceEvaluationReport {
    pub scenario_id: String,
    pub policy_id: String,
    pub cutoff_learned_at_ms: i64,
    pub verdict: SliceVerdict,
    pub conflict_detected: bool,
    pub legacy_unscoped_present: bool,
    pub min_assumption_fp: Option<i64>,
    pub max_assumption_fp: Option<i64>,
    pub preserved_records: Vec<PreservedSliceAssertion>,
    pub active_assertions: Vec<PreservedSliceAssertion>,
    pub conflicts: Vec<SourceConflictRecord>,
    pub idempotent_duplicates: Vec<IdempotentDuplicateRecord>,
    pub corroborated_groups: Vec<String>,
    pub missing_evidence: Vec<String>,
    pub applied_rule_id: String,
    pub causal_snapshot: CausalSliceSnapshotFp,
    pub deterministic_state_fnv64: u64,
}

/// Returns `true` iff `fp_val` lies within `[-2^62, +2^62]`.
#[inline]
pub const fn is_within_airlock_safe_fp_range(fp_val: i64) -> bool {
    if fp_val == i64::MIN {
        return false;
    }
    let abs = if fp_val < 0 { -fp_val } else { fp_val };
    abs <= AIRLOCK_FP_SAFE_MAX_ABS
}

/// Parse a strict decimal ASCII `i64` string (no whitespace/float/hex; rejects overflow).
pub fn parse_i64_decimal_ascii(s: &str) -> Option<i64> {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let (neg, digits) = if bytes[0] == b'-' {
        (true, &bytes[1..])
    } else if bytes[0] == b'+' {
        return None;
    } else {
        (false, bytes)
    };
    if digits.is_empty() || digits.len() > 19 {
        return None;
    }
    if digits.len() > 1 && digits[0] == b'0' {
        return None;
    }
    let mut acc: i128 = 0;
    for &b in digits {
        if !b.is_ascii_digit() {
            return None;
        }
        acc = acc * 10 + ((b - b'0') as i128);
    }
    let signed = if neg { -acc } else { acc };
    if signed < (i64::MIN as i128) || signed > (i64::MAX as i128) {
        return None;
    }
    Some(signed as i64)
}

/// Parse a strict decimal ASCII `u64` string.
pub fn parse_u64_decimal_ascii(s: &str) -> Option<u64> {
    let bytes = s.as_bytes();
    if bytes.is_empty() || bytes.len() > 20 {
        return None;
    }
    if bytes.len() > 1 && bytes[0] == b'0' {
        return None;
    }
    let mut acc: u128 = 0;
    for &b in bytes {
        if !b.is_ascii_digit() {
            return None;
        }
        acc = acc * 10 + ((b - b'0') as u128);
    }
    if acc > (u64::MAX as u128) {
        return None;
    }
    Some(acc as u64)
}

/// Format an `i64` as a canonical decimal ASCII string (safe across 64-bit JSON/MCP boundaries).
pub fn format_i64_decimal_ascii(v: i64) -> String {
    v.to_string()
}

/// Format a `u64` as a canonical decimal ASCII string.
pub fn format_u64_decimal_ascii(v: u64) -> String {
    v.to_string()
}

/// Parse a human decimal string (e.g. `"15"`, `"15.25"`, `"-0.1250005"`) into
/// fixed-point `i64` (`FP_SCALE = 1_000_000`) using exact integer `HALF_EVEN`
/// (banker's) rounding and `REJECT_AT_AIRLOCK` safe-range checking (`|fp| <= 2^62`).
/// Zero IEEE-754 float operations are used.
pub fn parse_decimal_to_fp_half_even(raw: &str) -> Result<i64, AirlockErrorCode> {
    let trimmed = raw.trim();
    let bytes = trimmed.as_bytes();
    if bytes.is_empty() {
        return Err(AirlockErrorCode::ErrSchemaOrRange);
    }
    let (neg, rest) = if bytes[0] == b'-' {
        (true, &bytes[1..])
    } else if bytes[0] == b'+' {
        (false, &bytes[1..])
    } else {
        (false, bytes)
    };
    if rest.is_empty() {
        return Err(AirlockErrorCode::ErrSchemaOrRange);
    }

    let mut dot_pos: Option<usize> = None;
    for (idx, &b) in rest.iter().enumerate() {
        if b == b'.' {
            if dot_pos.is_some() {
                return Err(AirlockErrorCode::ErrSchemaOrRange);
            }
            dot_pos = Some(idx);
        } else if !b.is_ascii_digit() {
            return Err(AirlockErrorCode::ErrSchemaOrRange);
        }
    }

    let (int_part, frac_part) = match dot_pos {
        Some(pos) => (&rest[..pos], &rest[pos + 1..]),
        None => (rest, &[][..]),
    };
    if int_part.is_empty() && frac_part.is_empty() {
        return Err(AirlockErrorCode::ErrSchemaOrRange);
    }

    let mut int_val: i128 = 0;
    let max_abs = AIRLOCK_FP_SAFE_MAX_ABS as i128;
    for &b in int_part {
        int_val = int_val
            .checked_mul(10)
            .and_then(|v| v.checked_add((b - b'0') as i128))
            .ok_or(AirlockErrorCode::ErrSchemaOrRange)?;
        if int_val * (AIRLOCK_FP_SCALE as i128) > max_abs {
            return Err(AirlockErrorCode::ErrSchemaOrRange);
        }
    }

    // First 6 fractional digits scale to 10^5 .. 10^0; 7th+ digits govern HALF_EVEN rounding.
    let mut frac_scaled: i128 = 0;
    let weights: [i128; 6] = [100_000, 10_000, 1_000, 100, 10, 1];
    for i in 0..6 {
        let digit = if i < frac_part.len() {
            (frac_part[i] - b'0') as i128
        } else {
            0
        };
        frac_scaled += digit * weights[i];
    }

    let mut base_mag = int_val
        .checked_mul(AIRLOCK_FP_SCALE as i128)
        .and_then(|v| v.checked_add(frac_scaled))
        .ok_or(AirlockErrorCode::ErrSchemaOrRange)?;

    if frac_part.len() > 6 {
        let seventh = frac_part[6] - b'0';
        let has_nonzero_tail = frac_part[7..].iter().any(|&b| b != b'0');
        let round_up = if seventh > 5 {
            true
        } else if seventh < 5 {
            false
        } else if has_nonzero_tail {
            true
        } else {
            // Exact half (.xxxxxx5000...): round to even last unit
            (base_mag & 1) == 1
        };
        if round_up {
            base_mag = base_mag
                .checked_add(1)
                .ok_or(AirlockErrorCode::ErrSchemaOrRange)?;
        }
    }

    if base_mag > max_abs {
        return Err(AirlockErrorCode::ErrSchemaOrRange);
    }

    let signed = if neg && base_mag != 0 {
        -(base_mag as i64)
    } else {
        base_mag as i64
    };
    Ok(signed)
}

/// Deterministic total tie-breaking comparator (§3.3.3):
/// `(observed_at_ms ASC, learned_at_ms ASC, source_id ASC [UTF-8 bytes], seq_no ASC, event_id ASC)`
fn compare_airlock_events(a: &VerifiedAirlockEvent, b: &VerifiedAirlockEvent) -> core::cmp::Ordering {
    a.observed_at_ms
        .cmp(&b.observed_at_ms)
        .then_with(|| a.learned_at_ms.cmp(&b.learned_at_ms))
        .then_with(|| a.source_id.as_bytes().cmp(b.source_id.as_bytes()))
        .then_with(|| a.seq_no.cmp(&b.seq_no))
        .then_with(|| a.event_id.as_bytes().cmp(b.event_id.as_bytes()))
}

/// Project slice assertions onto a deterministic `CausalEngine` graph (`no_std`, fixed-point).
pub fn apply_slice_to_causal_engine(
    active_assertions: &[PreservedSliceAssertion],
    policy: &SlicePolicy,
) -> CausalSliceSnapshotFp {
    let mut eng = CausalEngine::new();
    let cap_fp = if policy.max_allowed_fp > 0 {
        policy.max_allowed_fp.saturating_mul(3).max(FP_ONE)
    } else {
        FP_ONE
    };

    let worst_fp = active_assertions
        .iter()
        .map(|a| a.fp_val.max(0))
        .max()
        .unwrap_or(0);
    let clamped_state = fp_clamp(worst_fp, 0, cap_fp);

    // If conflicting or only uncorroborated claims exist, trust is lowered deterministically.
    let has_observation = active_assertions
        .iter()
        .any(|a| a.epistemic_status == EpistemicStatus::Observation);
    let trust_fp = if active_assertions.is_empty() {
        FP_ONE
    } else if has_observation {
        FP_ONE
    } else {
        750_000 // 0.750000 fixed-point epistemic discount for uncorroborated claims/hypotheses
    };

    let ratio_to_sla_fp = if policy.max_allowed_fp > 0 {
        fp_clamp(fp_div(worst_fp, policy.max_allowed_fp), 0, 2 * FP_ONE)
    } else {
        0
    };

    eng.add_node(Node {
        id: String::from("Airlock_Subject_Delay"),
        kind: NodeKind::Queue,
        capacity_fp: cap_fp,
        state_fp: clamped_state,
        reported_state_fp: clamped_state,
        trust_fp,
        weight_fp: ratio_to_sla_fp,
        deadline_tick: if policy.max_allowed_fp > 0 && worst_fp > policy.max_allowed_fp && has_observation {
            0
        } else {
            -1
        },
        deadline_min_state_fp: policy.max_allowed_fp.max(0),
        deadline_missed: false,
        irrecoverable: false,
    });

    let snap = eng.tick();
    CausalSliceSnapshotFp {
        tick: snap.tick,
        raw_friction_fp: snap.raw_friction_fp,
        clamped_friction_fp: snap.clamped_friction_fp,
        throughput_ratio_fp: snap.throughput_ratio_fp,
        regime_exceeded: snap.regime_exceeded,
        any_hysteresis_flip: snap.any_hysteresis_flip,
        any_deadline_missed: snap.any_deadline_missed,
        outage_active: snap.outage_active,
    }
}

fn fnv1a64_update(mut hash: u64, bytes: &[u8]) -> u64 {
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[allow(clippy::too_many_arguments)]
fn compute_deterministic_slice_fnv64(
    scenario_id: &str,
    policy_id: &str,
    cutoff_learned_at_ms: i64,
    verdict: SliceVerdict,
    conflict_detected: bool,
    preserved: &[PreservedSliceAssertion],
    active: &[PreservedSliceAssertion],
    missing: &[String],
    snap: &CausalSliceSnapshotFp,
) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    h = fnv1a64_update(h, b"CAELUS_SLICE_STATE_V2\n");
    h = fnv1a64_update(h, scenario_id.as_bytes());
    h = fnv1a64_update(h, b"|");
    h = fnv1a64_update(h, policy_id.as_bytes());
    h = fnv1a64_update(h, b"|");
    h = fnv1a64_update(h, &cutoff_learned_at_ms.to_le_bytes());
    h = fnv1a64_update(h, b"|");
    h = fnv1a64_update(h, verdict.as_str().as_bytes());
    h = fnv1a64_update(h, &[u8::from(conflict_detected)]);
    h = fnv1a64_update(h, &(preserved.len() as u64).to_le_bytes());
    for rec in preserved {
        h = fnv1a64_update(h, rec.event_id.as_bytes());
        h = fnv1a64_update(h, b"|");
        h = fnv1a64_update(h, rec.source_id.as_bytes());
        h = fnv1a64_update(h, &rec.seq_no.to_le_bytes());
        h = fnv1a64_update(h, &rec.observed_at_ms.to_le_bytes());
        h = fnv1a64_update(h, &rec.learned_at_ms.to_le_bytes());
        h = fnv1a64_update(h, rec.epistemic_status.as_str().as_bytes());
        h = fnv1a64_update(h, &rec.fp_val.to_le_bytes());
        if let Some(sup_by) = &rec.superseded_by_event_id {
            h = fnv1a64_update(h, b"->");
            h = fnv1a64_update(h, sup_by.as_bytes());
        }
    }
    h = fnv1a64_update(h, &(active.len() as u64).to_le_bytes());
    for m in missing {
        h = fnv1a64_update(h, m.as_bytes());
        h = fnv1a64_update(h, b";");
    }
    h = fnv1a64_update(h, &snap.clamped_friction_fp.to_le_bytes());
    h = fnv1a64_update(h, &snap.throughput_ratio_fp.to_le_bytes());
    h
}

/// Core bi-temporal slice evaluator (`no_std + alloc`, zero I/O, zero float).
///
/// 1. Filters `learned_at_ms <= cutoff_learned_at_ms` (zero look-ahead leakage).
/// 2. Validates fixed-point bounds & schema invariants (`Err` leaves caller state untouched).
/// 3. Deduplicates idempotent `(source_id, seq_no, payload_blake3)` and rejects equivocation
///    (`ERR_SOURCE_EQUIVOCATION`).
/// 4. Applies deterministic tie-breaking order.
/// 5. Applies same-source `supersedes_event_id` without deleting historical records.
/// 6. Preserves cross-source conflicts side-by-side and evaluates epistemic corroboration.
pub fn ingest_verified_slice(
    events: &[VerifiedAirlockEvent],
    cutoff_learned_at_ms: i64,
    policy: &SlicePolicy,
) -> Result<SliceEvaluationReport, AirlockSliceError> {
    if cutoff_learned_at_ms < 0 || !is_within_airlock_safe_fp_range(policy.max_allowed_fp) {
        return Err(AirlockSliceError {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: String::new(),
            event_id: String::new(),
            seq_no: 0,
            detail: String::from("invalid cutoff_learned_at_ms or policy.max_allowed_fp"),
        });
    }

    // Step 1: Strict bi-temporal cutoff filter (`learned_at_ms <= cutoff_learned_at_ms`).
    // Records learned after `cutoff_learned_at_ms` are completely excluded BEFORE any
    // state/dedup/conflict step so future records have 0-bit influence on past slices.
    let mut visible: Vec<&VerifiedAirlockEvent> = Vec::new();
    for ev in events {
        if ev.learned_at_ms <= cutoff_learned_at_ms {
            ev.validate_invariants(policy.require_v2_airlock)?;
            visible.push(ev);
        }
    }

    // Step 2: Deterministic total tie-breaking sort (§3.3.3).
    visible.sort_by(|a, b| compare_airlock_events(a, b));

    // Step 3: Idempotent duplicate vs `(source_id, seq_no)` equivocation detection (§3.3.4).
    let mut seen_seq: Vec<(&str, u64, &str)> = Vec::new();
    let mut unique_events: Vec<&VerifiedAirlockEvent> = Vec::new();
    let mut idempotent_duplicates: Vec<IdempotentDuplicateRecord> = Vec::new();

    for ev in visible {
        if let Some(&(_, _, prev_hash)) = seen_seq
            .iter()
            .find(|&&(src, seq, _)| src == ev.source_id.as_str() && seq == ev.seq_no)
        {
            if prev_hash.eq_ignore_ascii_case(&ev.payload_blake3_hex) {
                idempotent_duplicates.push(IdempotentDuplicateRecord {
                    source_id: ev.source_id.clone(),
                    seq_no: ev.seq_no,
                    event_id: ev.event_id.clone(),
                    payload_blake3_hex: ev.payload_blake3_hex.clone(),
                });
                continue;
            }
            return Err(AirlockSliceError {
                code: AirlockErrorCode::ErrSourceEquivocation,
                source_id: ev.source_id.clone(),
                event_id: ev.event_id.clone(),
                seq_no: ev.seq_no,
                detail: String::from(
                    "SOURCE_EQUIVOCATION: duplicate (source_id, seq_no) with conflicting payload_blake3",
                ),
            });
        }
        seen_seq.push((
            ev.source_id.as_str(),
            ev.seq_no,
            ev.payload_blake3_hex.as_str(),
        ));
        unique_events.push(ev);
    }

    // Step 4: Build preserved assertion list and apply same-source `supersedes_event_id`
    // without deleting the superseded record.
    let mut preserved_records: Vec<PreservedSliceAssertion> =
        Vec::with_capacity(unique_events.len());
    let mut legacy_unscoped_present = false;

    for ev in &unique_events {
        if ev.legacy_unscoped || ev.schema_version == AIRLOCK_SCHEMA_V1_LEGACY {
            legacy_unscoped_present = true;
        }
        if let Some(old_id) = &ev.supersedes_event_id {
            for prev in &mut preserved_records {
                if prev.source_id == ev.source_id
                    && prev.event_id == *old_id
                    && prev.seq_no < ev.seq_no
                    && prev.superseded_by_event_id.is_none()
                {
                    prev.superseded_by_event_id = Some(ev.event_id.clone());
                }
            }
        }
        preserved_records.push(PreservedSliceAssertion {
            event_id: ev.event_id.clone(),
            source_id: ev.source_id.clone(),
            key_id: ev.key_id.clone(),
            independence_group: ev.independence_group.clone(),
            event_kind: ev.event_kind.clone(),
            seq_no: ev.seq_no,
            observed_at_ms: ev.observed_at_ms,
            learned_at_ms: ev.learned_at_ms,
            epistemic_status: ev.epistemic_status,
            subject_id: ev.subject_id.clone(),
            metric_key: ev.metric_key.clone(),
            fp_val: ev.fp_val,
            unit: ev.unit.clone(),
            supersedes_event_id: ev.supersedes_event_id.clone(),
            superseded_by_event_id: None,
            legacy_unscoped: ev.legacy_unscoped || ev.schema_version == AIRLOCK_SCHEMA_V1_LEGACY,
            note: ev.note.clone(),
        });
    }

    // Active assertions = non-superseded records across ALL sources (never overwritten across sources!).
    let active_assertions: Vec<PreservedSliceAssertion> = preserved_records
        .iter()
        .filter(|r| r.superseded_by_event_id.is_none())
        .cloned()
        .collect();

    // Step 5: Compute assumption bounds, independent groups, and cross-source conflicts.
    let min_assumption_fp = active_assertions.iter().map(|a| a.fp_val).min();
    let max_assumption_fp = active_assertions.iter().map(|a| a.fp_val).max();

    let mut corroborated_groups: Vec<String> = Vec::new();
    for a in &active_assertions {
        if !a.independence_group.is_empty()
            && !corroborated_groups
                .iter()
                .any(|g| g == &a.independence_group)
        {
            corroborated_groups.push(a.independence_group.clone());
        }
    }
    corroborated_groups.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

    // Detect conflicts per `(subject_id, metric_key)` across distinct sources.
    let mut keys: Vec<(String, String, String)> = Vec::new();
    for a in &active_assertions {
        if !keys
            .iter()
            .any(|(s, m, _)| s == &a.subject_id && m == &a.metric_key)
        {
            keys.push((a.subject_id.clone(), a.metric_key.clone(), a.unit.clone()));
        }
    }

    let mut conflicts: Vec<SourceConflictRecord> = Vec::new();
    let mut has_unresolved_peer_conflict = false;
    let mut has_calibrated_observation_breach = false;
    let mut has_contradicting_compliant_observation = false;

    for (subj, metric, unit) in keys {
        let group_items: Vec<&PreservedSliceAssertion> = active_assertions
            .iter()
            .filter(|a| a.subject_id == subj && a.metric_key == metric)
            .collect();

        let mut distinct_sources: Vec<String> = Vec::new();
        for item in &group_items {
            if !distinct_sources.iter().any(|s| s == &item.source_id) {
                distinct_sources.push(item.source_id.clone());
            }
        }

        for item in &group_items {
            if item.epistemic_status == EpistemicStatus::Observation {
                if item.fp_val > policy.max_allowed_fp {
                    has_calibrated_observation_breach = true;
                } else {
                    has_contradicting_compliant_observation = true;
                }
            }
        }

        if distinct_sources.len() >= 2 {
            let g_min = group_items.iter().map(|i| i.fp_val).min().unwrap_or(0);
            let g_max = group_items.iter().map(|i| i.fp_val).max().unwrap_or(0);
            let spread = fp_add_saturating(g_max, -g_min);
            let straddles_policy = g_min <= policy.max_allowed_fp && g_max > policy.max_allowed_fp;
            let exceeds_divergence = spread >= policy.conflict_divergence_threshold_fp;

            if straddles_policy || exceeds_divergence {
                let g_obs_breach = group_items.iter().any(|i| {
                    i.epistemic_status == EpistemicStatus::Observation
                        && i.fp_val > policy.max_allowed_fp
                });
                let g_obs_compliant = group_items.iter().any(|i| {
                    i.epistemic_status == EpistemicStatus::Observation
                        && i.fp_val <= policy.max_allowed_fp
                });
                // Resolved as confirmed breach ONLY if a calibrated OBSERVATION breaches SLA
                // and no calibrated OBSERVATION claims compliance (e.g. T1 operator CLAIM +15m
                // followed by T2 calibrated berth OBSERVATION +35m). Two contradicting
                // OBSERVATIONs (+10m vs +40m) or two contradicting CLAIMs remain unresolved!
                let resolved_by_obs_breach = g_obs_breach && !g_obs_compliant;
                if !resolved_by_obs_breach {
                    has_unresolved_peer_conflict = true;
                }

                let mut event_ids = Vec::with_capacity(group_items.len());
                for item in &group_items {
                    event_ids.push(item.event_id.clone());
                }
                conflicts.push(SourceConflictRecord {
                    subject_id: subj,
                    metric_key: metric,
                    unit,
                    min_fp_val: g_min,
                    max_fp_val: g_max,
                    source_ids: distinct_sources,
                    event_ids,
                    resolved_by_calibrated_observation_breach: resolved_by_obs_breach,
                });
            }
        }
    }

    let conflict_detected = !conflicts.is_empty();
    let mut missing_evidence: Vec<String> = Vec::new();

    if active_assertions.is_empty() {
        missing_evidence.push(String::from("NO_ADMITTED_EVENTS_AT_CUTOFF"));
    }
    if legacy_unscoped_present {
        missing_evidence.push(String::from("LEGACY_UNSCOPED_V1_SOURCE_SCOPE_MISSING"));
    }

    let any_observation = active_assertions
        .iter()
        .any(|a| a.epistemic_status == EpistemicStatus::Observation);
    let only_hypotheses = !active_assertions.is_empty()
        && active_assertions
            .iter()
            .all(|a| a.epistemic_status == EpistemicStatus::Hypothesis);

    let mut non_hypothesis_groups: Vec<&str> = Vec::new();
    for a in &active_assertions {
        if a.epistemic_status != EpistemicStatus::Hypothesis
            && !a.independence_group.is_empty()
            && !non_hypothesis_groups
                .iter()
                .any(|&g| g == a.independence_group.as_str())
        {
            non_hypothesis_groups.push(a.independence_group.as_str());
        }
    }

    if only_hypotheses {
        missing_evidence.push(String::from(
            "HYPOTHESIS_ONLY_CANNOT_TRIGGER_DEFINITIVE_TRANSITION",
        ));
    } else if policy.require_independent_corroboration_for_claims
        && !active_assertions.is_empty()
        && !any_observation
        && non_hypothesis_groups.len() < 2
    {
        missing_evidence.push(String::from(
            "INDEPENDENT_CORROBORATION_REQUIRED_FOR_SINGLE_SOURCE_CLAIM",
        ));
    }

    if !active_assertions.is_empty()
        && corroborated_groups.len() < policy.min_independent_groups_for_pass
    {
        missing_evidence.push(String::from("MIN_INDEPENDENT_SOURCE_GROUPS_NOT_MET"));
    }

    if has_unresolved_peer_conflict {
        missing_evidence.push(String::from("CONFLICTING_INDEPENDENT_SOURCES_UNRESOLVED"));
    }

    let (verdict, applied_rule_id) = if active_assertions.is_empty() {
        (
            SliceVerdict::KanitYetersiz,
            String::from("RULE_EMPTY_SLICE_INSUFFICIENT_EVIDENCE"),
        )
    } else if legacy_unscoped_present {
        (
            SliceVerdict::KanitYetersiz,
            String::from("RULE_LEGACY_UNSCOPED_REQUIRES_V2_SCOPED_EVIDENCE"),
        )
    } else if has_unresolved_peer_conflict {
        (
            SliceVerdict::KanitYetersiz,
            String::from("RULE_CONFLICT_PRESERVED_NO_UNILATERAL_PASS"),
        )
    } else if has_calibrated_observation_breach && !has_contradicting_compliant_observation {
        (
            SliceVerdict::KuralIhlali,
            String::from("RULE_CALIBRATED_OBSERVATION_SLA_BREACH"),
        )
    } else if !missing_evidence.is_empty() {
        (
            SliceVerdict::KanitYetersiz,
            String::from("RULE_UNCORROBORATED_CLAIM_OR_HYPOTHESIS"),
        )
    } else if max_assumption_fp.unwrap_or(0) > policy.max_allowed_fp {
        (
            SliceVerdict::KuralIhlali,
            String::from("RULE_CORROBORATED_THRESHOLD_EXCEEDED"),
        )
    } else {
        (
            SliceVerdict::Gecti,
            String::from("RULE_CORROBORATED_WITHIN_POLICY_THRESHOLD"),
        )
    };

    let causal_snapshot = apply_slice_to_causal_engine(&active_assertions, policy);
    let deterministic_state_fnv64 = compute_deterministic_slice_fnv64(
        &policy.scenario_id,
        &policy.policy_id,
        cutoff_learned_at_ms,
        verdict,
        conflict_detected,
        &preserved_records,
        &active_assertions,
        &missing_evidence,
        &causal_snapshot,
    );

    Ok(SliceEvaluationReport {
        scenario_id: policy.scenario_id.clone(),
        policy_id: policy.policy_id.clone(),
        cutoff_learned_at_ms,
        verdict,
        conflict_detected,
        legacy_unscoped_present,
        min_assumption_fp,
        max_assumption_fp,
        preserved_records,
        active_assertions,
        conflicts,
        idempotent_duplicates,
        corroborated_groups,
        missing_evidence,
        applied_rule_id,
        causal_snapshot,
        deterministic_state_fnv64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_event(
        source_id: &str,
        group: &str,
        event_id: &str,
        seq_no: u64,
        observed_ms: i64,
        learned_ms: i64,
        status: EpistemicStatus,
        fp_val: i64,
        hash_fill: u8,
    ) -> VerifiedAirlockEvent {
        let hex_char = char::from(b'0' + (hash_fill % 10));
        let mut h = String::with_capacity(64);
        for _ in 0..64 {
            h.push(hex_char);
        }
        VerifiedAirlockEvent {
            schema_version: String::from("2.0"),
            source_id: String::from(source_id),
            key_id: String::from("key_01"),
            independence_group: String::from(group),
            event_kind: String::from("DELAY_NOTICE"),
            event_id: String::from(event_id),
            seq_no,
            observed_at_ms: observed_ms,
            learned_at_ms: learned_ms,
            epistemic_status: status,
            subject_id: String::from("VOYAGE_SIGACIK_VATHI_0800"),
            metric_key: String::from("departure_delay"),
            fp_val,
            fp_scale: AIRLOCK_FP_SCALE,
            unit: String::from("minutes"),
            rounding: RoundingMode::HalfEven,
            overflow_policy: OverflowPolicy::RejectAtAirlock,
            supersedes_event_id: None,
            payload_blake3_hex: h,
            legacy_unscoped: false,
            note: String::from("pilot"),
        }
    }

    #[test]
    fn half_even_fixed_point_conversion_and_range_rejection() {
        assert_eq!(parse_decimal_to_fp_half_even("15").unwrap(), 15_000_000);
        assert_eq!(parse_decimal_to_fp_half_even("15.25").unwrap(), 15_250_000);
        // Banker's rounding (HALF_EVEN) on exact 7th digit '5':
        // 0.0000005 -> base_mag = 0 (even) -> stays 0
        assert_eq!(parse_decimal_to_fp_half_even("0.0000005").unwrap(), 0);
        // 0.0000015 -> base_mag = 1 (odd) -> rounds to 2
        assert_eq!(parse_decimal_to_fp_half_even("0.0000015").unwrap(), 2);
        // 0.0000025 -> base_mag = 2 (even) -> stays 2
        assert_eq!(parse_decimal_to_fp_half_even("0.0000025").unwrap(), 2);
        // 0.00000251 -> > half -> rounds to 3
        assert_eq!(parse_decimal_to_fp_half_even("0.00000251").unwrap(), 3);

        // Overflow beyond Z3 safe bound 2^62 (~4.611e12 whole units) rejected!
        assert_eq!(
            parse_decimal_to_fp_half_even("4611686018428"),
            Err(AirlockErrorCode::ErrSchemaOrRange)
        );
    }

    #[test]
    fn bitemporal_no_lookahead_and_t1_to_t2_transition() {
        let policy = SlicePolicy::default(); // 20 min SLA
        // T1 (08:10 = 600_000 ms): operator CLAIM at 08:05 (300_000 ms) of +15 min
        let e1 = sample_event(
            "ferry_ops",
            "GROUP_OPERATOR",
            "EVT-T1-CLAIM",
            1,
            0,
            300_000,
            EpistemicStatus::Claim,
            15 * AIRLOCK_FP_SCALE,
            1,
        );
        // T2 (08:25 = 1_500_000 ms): independent berth OBSERVATION observed at 08:02 (120_000 ms)
        // but learned at 08:20 (1_200_000 ms) of +35 min
        let e2 = sample_event(
            "port_observer",
            "GROUP_PORT_BERTH",
            "EVT-T2-OBS",
            1,
            120_000,
            1_200_000,
            EpistemicStatus::Observation,
            35 * AIRLOCK_FP_SCALE,
            2,
        );

        let r_t1_alone =
            ingest_verified_slice(core::slice::from_ref(&e1), 600_000, &policy).unwrap();
        assert_eq!(r_t1_alone.verdict, SliceVerdict::KanitYetersiz);

        // With e2 present in the batch, evaluating at cutoff=600_000 MUST be bit-identical!
        let both = [e1.clone(), e2.clone()];
        let r_t1_with_future = ingest_verified_slice(&both, 600_000, &policy).unwrap();
        assert_eq!(r_t1_alone, r_t1_with_future);
        assert_eq!(
            r_t1_alone.deterministic_state_fnv64,
            r_t1_with_future.deterministic_state_fnv64
        );

        // At T2 (cutoff=1_500_000), both records are preserved and SLA breach is confirmed.
        let r_t2 = ingest_verified_slice(&both, 1_500_000, &policy).unwrap();
        assert_eq!(r_t2.verdict, SliceVerdict::KuralIhlali);
        assert_eq!(r_t2.active_assertions.len(), 2);
        assert_eq!(r_t2.min_assumption_fp, Some(15 * AIRLOCK_FP_SCALE));
        assert_eq!(r_t2.max_assumption_fp, Some(35 * AIRLOCK_FP_SCALE));
    }

    #[test]
    fn conflicting_independent_observations_are_preserved_and_block_pass() {
        let policy = SlicePolicy::default();
        let src_a = sample_event(
            "source_a",
            "GROUP_A",
            "EVT-A",
            1,
            1000,
            2000,
            EpistemicStatus::Observation,
            10 * AIRLOCK_FP_SCALE,
            3,
        );
        let src_b = sample_event(
            "source_b",
            "GROUP_B",
            "EVT-B",
            1,
            1000,
            2500,
            EpistemicStatus::Observation,
            40 * AIRLOCK_FP_SCALE,
            4,
        );

        let rep = ingest_verified_slice(&[src_a, src_b], 5000, &policy).unwrap();
        assert_eq!(rep.verdict, SliceVerdict::KanitYetersiz);
        assert!(rep.conflict_detected);
        assert_eq!(rep.active_assertions.len(), 2);
        assert_eq!(rep.min_assumption_fp, Some(10 * AIRLOCK_FP_SCALE));
        assert_eq!(rep.max_assumption_fp, Some(40 * AIRLOCK_FP_SCALE));
        assert_eq!(rep.conflicts.len(), 1);
        assert_eq!(rep.conflicts[0].source_ids, alloc::vec![String::from("source_a"), String::from("source_b")]);
    }

    #[test]
    fn duplicate_is_idempotent_and_equivocation_fails_closed() {
        let policy = SlicePolicy::default();
        let obs1 = sample_event(
            "port_observer",
            "GROUP_PORT",
            "EVT-1",
            7,
            1000,
            2000,
            EpistemicStatus::Observation,
            12 * AIRLOCK_FP_SCALE,
            5,
        );
        let obs_dup = obs1.clone();
        let rep = ingest_verified_slice(&[obs1.clone(), obs_dup], 5000, &policy).unwrap();
        assert_eq!(rep.verdict, SliceVerdict::Gecti);
        assert_eq!(rep.active_assertions.len(), 1);
        assert_eq!(rep.idempotent_duplicates.len(), 1);

        let mut obs_equiv = obs1.clone();
        obs_equiv.fp_val = 18 * AIRLOCK_FP_SCALE;
        obs_equiv.payload_blake3_hex = "f".repeat(64);
        let err = ingest_verified_slice(&[obs1, obs_equiv], 5000, &policy).unwrap_err();
        assert_eq!(err.code, AirlockErrorCode::ErrSourceEquivocation);
    }
}
