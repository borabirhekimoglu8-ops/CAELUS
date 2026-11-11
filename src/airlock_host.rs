// CAELUS OS — Sidecar Airlock Host Gate, Manifest Verifier, Normalizer & Audit Bridge
//
// Architectural boundary (PR-1 §1–§3):
//   • External Sidecar Profile (`src/bin/caelus_sidecar_airlock.rs` & host adapters):
//     Reads CSV/JSON/NDJSON files, converts human decimal values to fixed-point
//     (`FP_SCALE = 1_000_000`, `HALF_EVEN`, `REJECT_AT_AIRLOCK`), assigns epistemic
//     labels (`OBSERVATION`, `CLAIM`, `HYPOTHESIS`), signs/verifies `CAELUS_INTEL_V2`
//     envelopes against `source_manifest.json`, performs `O(log N)` binary search on
//     sorted `.airlock.ndjson` streams, and seals outcomes/rejections in `CaelusAuditLog`.
//   • Isolated Core Profile (`caelus_core::airlock`):
//     Pure `no_std + alloc`, zero network/filesystem/float, consumes `&[VerifiedAirlockEvent]`.

use std::collections::BTreeMap;
use std::fmt::Write as FmtWrite;
use std::sync::Arc;

use caelus_core::airlock::{
    format_i64_decimal_ascii, format_u64_decimal_ascii, ingest_verified_slice,
    is_within_airlock_safe_fp_range, parse_decimal_to_fp_half_even, parse_i64_decimal_ascii,
    parse_u64_decimal_ascii, AirlockErrorCode, EpistemicStatus, OverflowPolicy, RoundingMode,
    SliceEvaluationReport, SlicePolicy, SliceVerdict, VerifiedAirlockEvent, AIRLOCK_FP_SCALE,
    AIRLOCK_SCHEMA_V1_LEGACY, AIRLOCK_SCHEMA_V2,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use subtle::ConstantTimeEq;

use crate::audit_log::{escape_audit_json_str, CaelusAuditLog};
use crate::network::mesh_auth::DeviceIdentity;

pub const CAELUS_AIRLOCK_ENGINE_VERSION: &str = "caelus-airlock-v2.0.0";
pub const CAELUS_INTEL_V1_CONTRACT: &str = "CAELUS_INTEL_V1";
pub const CAELUS_INTEL_V2_CONTRACT: &str = "CAELUS_INTEL_V2";
const MANIFEST_SIG_CTX: &str = "CAELUS_AIRLOCK_MANIFEST_V2\n";
const MAX_JSON_DEPTH: usize = 32;

// ─────────────────────────────────────────────────────────────────────────────
// Hex helpers
// ─────────────────────────────────────────────────────────────────────────────

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

pub fn decode_hex_exact<const N: usize>(s: &str) -> Option<[u8; N]> {
    if s.len() != N * 2 {
        return None;
    }
    let mut out = [0u8; N];
    for (i, chunk) in s.as_bytes().chunks_exact(2).enumerate() {
        let hi = hex_nibble(chunk[0])?;
        let lo = hex_nibble(chunk[1])?;
        out[i] = (hi << 4) | lo;
    }
    Some(out)
}

pub fn encode_hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        let _ = write!(&mut out, "{:02x}", b);
    }
    out
}

pub fn blake3_hex(bytes: &[u8]) -> String {
    encode_hex_lower(blake3::hash(bytes).as_bytes())
}

// ─────────────────────────────────────────────────────────────────────────────
// Strict Minimal RFC 8259 JSON Parser (distinguishes Strings vs Numbers!)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum AirlockJsonVal {
    Null,
    Bool(bool),
    Int(i128),
    Float(String),
    Str(String),
    Arr(Vec<AirlockJsonVal>),
    Obj(BTreeMap<String, AirlockJsonVal>),
}

impl AirlockJsonVal {
    pub fn as_obj(&self) -> Option<&BTreeMap<String, AirlockJsonVal>> {
        match self {
            Self::Obj(m) => Some(m),
            _ => None,
        }
    }

    pub fn as_arr(&self) -> Option<&[AirlockJsonVal]> {
        match self {
            Self::Arr(v) => Some(v.as_slice()),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_i128(&self) -> Option<i128> {
        match self {
            Self::Int(v) => Some(*v),
            _ => None,
        }
    }
}

struct MiniJsonParser<'a> {
    src: &'a [u8],
    pos: usize,
}

pub fn parse_strict_json(raw: &str) -> Result<AirlockJsonVal, String> {
    let mut parser = MiniJsonParser {
        src: raw.as_bytes(),
        pos: 0,
    };
    let val = parser.parse_value(0)?;
    parser.skip_ws();
    if parser.pos != parser.src.len() {
        return Err("trailing characters after JSON value".to_owned());
    }
    Ok(val)
}

impl<'a> MiniJsonParser<'a> {
    fn skip_ws(&mut self) {
        while self.pos < self.src.len() {
            match self.src[self.pos] {
                b' ' | b'\t' | b'\r' | b'\n' => self.pos += 1,
                _ => break,
            }
        }
    }

    fn parse_value(&mut self, depth: usize) -> Result<AirlockJsonVal, String> {
        if depth > MAX_JSON_DEPTH {
            return Err("JSON max depth exceeded".to_owned());
        }
        self.skip_ws();
        if self.pos >= self.src.len() {
            return Err("unexpected end of JSON".to_owned());
        }
        match self.src[self.pos] {
            b'"' => Ok(AirlockJsonVal::Str(self.parse_string()?)),
            b'{' => self.parse_object(depth + 1),
            b'[' => self.parse_array(depth + 1),
            b't' => {
                if self.src[self.pos..].starts_with(b"true") {
                    self.pos += 4;
                    Ok(AirlockJsonVal::Bool(true))
                } else {
                    Err("invalid JSON literal".to_owned())
                }
            }
            b'f' => {
                if self.src[self.pos..].starts_with(b"false") {
                    self.pos += 5;
                    Ok(AirlockJsonVal::Bool(false))
                } else {
                    Err("invalid JSON literal".to_owned())
                }
            }
            b'n' => {
                if self.src[self.pos..].starts_with(b"null") {
                    self.pos += 4;
                    Ok(AirlockJsonVal::Null)
                } else {
                    Err("invalid JSON literal".to_owned())
                }
            }
            b'-' | b'0'..=b'9' => self.parse_number(),
            _ => Err("unexpected token in JSON".to_owned()),
        }
    }

    fn parse_object(&mut self, depth: usize) -> Result<AirlockJsonVal, String> {
        self.pos += 1;
        let mut map = BTreeMap::new();
        self.skip_ws();
        if self.pos < self.src.len() && self.src[self.pos] == b'}' {
            self.pos += 1;
            return Ok(AirlockJsonVal::Obj(map));
        }
        loop {
            self.skip_ws();
            let key = self.parse_string()?;
            self.skip_ws();
            if self.pos >= self.src.len() || self.src[self.pos] != b':' {
                return Err("expected ':' in JSON object".to_owned());
            }
            self.pos += 1;
            let val = self.parse_value(depth)?;
            if map.insert(key, val).is_some() {
                return Err("duplicate key in JSON object".to_owned());
            }
            self.skip_ws();
            if self.pos >= self.src.len() {
                return Err("unterminated JSON object".to_owned());
            }
            match self.src[self.pos] {
                b',' => self.pos += 1,
                b'}' => {
                    self.pos += 1;
                    break;
                }
                _ => return Err("expected ',' or '}' in JSON object".to_owned()),
            }
        }
        Ok(AirlockJsonVal::Obj(map))
    }

    fn parse_array(&mut self, depth: usize) -> Result<AirlockJsonVal, String> {
        self.pos += 1;
        let mut arr = Vec::new();
        self.skip_ws();
        if self.pos < self.src.len() && self.src[self.pos] == b']' {
            self.pos += 1;
            return Ok(AirlockJsonVal::Arr(arr));
        }
        loop {
            arr.push(self.parse_value(depth)?);
            self.skip_ws();
            if self.pos >= self.src.len() {
                return Err("unterminated JSON array".to_owned());
            }
            match self.src[self.pos] {
                b',' => self.pos += 1,
                b']' => {
                    self.pos += 1;
                    break;
                }
                _ => return Err("expected ',' or ']' in JSON array".to_owned()),
            }
        }
        Ok(AirlockJsonVal::Arr(arr))
    }

    fn parse_string(&mut self) -> Result<String, String> {
        if self.pos >= self.src.len() || self.src[self.pos] != b'"' {
            return Err("expected JSON string".to_owned());
        }
        self.pos += 1;
        let mut out = String::new();
        while self.pos < self.src.len() {
            let b = self.src[self.pos];
            if b == b'"' {
                self.pos += 1;
                return Ok(out);
            }
            if b < 0x20 {
                return Err("unescaped control character in JSON string".to_owned());
            }
            if b == b'\\' {
                self.pos += 1;
                if self.pos >= self.src.len() {
                    return Err("unterminated JSON escape".to_owned());
                }
                let esc = self.src[self.pos];
                self.pos += 1;
                match esc {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'b' => out.push('\u{0008}'),
                    b'f' => out.push('\u{000c}'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'u' => {
                        let cp = self.parse_hex4()?;
                        if (0xD800..=0xDBFF).contains(&cp) {
                            if self.pos + 2 > self.src.len()
                                || self.src[self.pos] != b'\\'
                                || self.src[self.pos + 1] != b'u'
                            {
                                return Err("unpaired UTF-16 high surrogate".to_owned());
                            }
                            self.pos += 2;
                            let low = self.parse_hex4()?;
                            if !(0xDC00..=0xDFFF).contains(&low) {
                                return Err("invalid UTF-16 low surrogate".to_owned());
                            }
                            let combined =
                                0x10000 + (((cp as u32 - 0xD800) << 10) | (low as u32 - 0xDC00));
                            let ch = char::from_u32(combined)
                                .ok_or_else(|| "invalid unicode scalar".to_owned())?;
                            out.push(ch);
                        } else if (0xDC00..=0xDFFF).contains(&cp) {
                            return Err("unpaired UTF-16 low surrogate".to_owned());
                        } else {
                            let ch = char::from_u32(cp as u32)
                                .ok_or_else(|| "invalid unicode scalar".to_owned())?;
                            out.push(ch);
                        }
                    }
                    _ => return Err("invalid JSON escape character".to_owned()),
                }
            } else {
                let rest = &self.src[self.pos..];
                let s = std::str::from_utf8(rest).map_err(|_| "invalid UTF-8".to_owned())?;
                let ch = s
                    .chars()
                    .next()
                    .ok_or_else(|| "unexpected EOF in UTF-8".to_owned())?;
                out.push(ch);
                self.pos += ch.len_utf8();
            }
        }
        Err("unterminated JSON string".to_owned())
    }

    fn parse_hex4(&mut self) -> Result<u16, String> {
        if self.pos + 4 > self.src.len() {
            return Err("truncated \\uXXXX escape".to_owned());
        }
        let mut val = 0u16;
        for _ in 0..4 {
            let nib = hex_nibble(self.src[self.pos])
                .ok_or_else(|| "invalid hex in \\uXXXX".to_owned())?;
            self.pos += 1;
            val = (val << 4) | (nib as u16);
        }
        Ok(val)
    }

    fn parse_number(&mut self) -> Result<AirlockJsonVal, String> {
        let start = self.pos;
        if self.src[self.pos] == b'-' {
            self.pos += 1;
        }
        if self.pos >= self.src.len() || !self.src[self.pos].is_ascii_digit() {
            return Err("invalid JSON number".to_owned());
        }
        if self.src[self.pos] == b'0' {
            self.pos += 1;
            if self.pos < self.src.len() && self.src[self.pos].is_ascii_digit() {
                return Err("leading zero in JSON number".to_owned());
            }
        } else {
            while self.pos < self.src.len() && self.src[self.pos].is_ascii_digit() {
                self.pos += 1;
            }
        }
        let mut is_float = false;
        if self.pos < self.src.len() && self.src[self.pos] == b'.' {
            is_float = true;
            self.pos += 1;
            if self.pos >= self.src.len() || !self.src[self.pos].is_ascii_digit() {
                return Err("invalid fraction in JSON number".to_owned());
            }
            while self.pos < self.src.len() && self.src[self.pos].is_ascii_digit() {
                self.pos += 1;
            }
        }
        if self.pos < self.src.len() && (self.src[self.pos] == b'e' || self.src[self.pos] == b'E')
        {
            is_float = true;
            self.pos += 1;
            if self.pos < self.src.len()
                && (self.src[self.pos] == b'+' || self.src[self.pos] == b'-')
            {
                self.pos += 1;
            }
            if self.pos >= self.src.len() || !self.src[self.pos].is_ascii_digit() {
                return Err("invalid exponent in JSON number".to_owned());
            }
            while self.pos < self.src.len() && self.src[self.pos].is_ascii_digit() {
                self.pos += 1;
            }
        }
        let token =
            std::str::from_utf8(&self.src[start..self.pos]).map_err(|_| "bad UTF-8".to_owned())?;
        if is_float {
            Ok(AirlockJsonVal::Float(token.to_owned()))
        } else {
            let v = token
                .parse::<i128>()
                .map_err(|_| "JSON integer overflow".to_owned())?;
            Ok(AirlockJsonVal::Int(v))
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source Manifest (`source_manifest.json` — §3.4)
// ─────────────────────────────────────────────────────────────────────────────

/// Source epistemic capability ceiling (§3.4):
///   • `CalibratedSensor` → may emit `OBSERVATION`, `CLAIM`, or `HYPOTHESIS`.
///   • `HumanOperator`    → may emit `CLAIM` or `HYPOTHESIS` (never `OBSERVATION`).
///   • `ModelOrAgent`     → may ONLY emit `HYPOTHESIS`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceOriginClass {
    CalibratedSensor,
    HumanOperator,
    ModelOrAgent,
}

impl SourceOriginClass {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "CALIBRATED_SENSOR" | "SENSOR" | "FIELD_OBSERVATION" => Some(Self::CalibratedSensor),
            "HUMAN_OPERATOR" | "OPERATOR" => Some(Self::HumanOperator),
            "MODEL_OR_AGENT" | "MODEL" | "AGENT" | "LLM" => Some(Self::ModelOrAgent),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CalibratedSensor => "CALIBRATED_SENSOR",
            Self::HumanOperator => "HUMAN_OPERATOR",
            Self::ModelOrAgent => "MODEL_OR_AGENT",
        }
    }

    pub const fn default_epistemic_status(self) -> EpistemicStatus {
        match self {
            Self::CalibratedSensor => EpistemicStatus::Observation,
            Self::HumanOperator => EpistemicStatus::Claim,
            Self::ModelOrAgent => EpistemicStatus::Hypothesis,
        }
    }

    pub const fn allows_epistemic_status(self, st: EpistemicStatus) -> bool {
        match self {
            Self::CalibratedSensor => true,
            Self::HumanOperator => !matches!(st, EpistemicStatus::Observation),
            Self::ModelOrAgent => matches!(st, EpistemicStatus::Hypothesis),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AirlockSourceEntry {
    pub source_id: String,
    pub key_id: String,
    pub pubkey: [u8; 32],
    pub allowed_event_kinds: Vec<String>,
    pub independence_group: String,
    pub origin_class: SourceOriginClass,
    pub default_epistemic_status: EpistemicStatus,
    pub expires_at_ms: Option<i64>,
    pub max_staleness_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct AirlockSourceManifest {
    pub manifest_version: String,
    pub require_v2_airlock: bool,
    pub legacy_v1_pubkey: Option<[u8; 32]>,
    pub sources: Vec<AirlockSourceEntry>,
}

impl AirlockSourceManifest {
    pub fn parse_json(raw: &str) -> Result<Self, String> {
        let root = parse_strict_json(raw)?;
        let obj = root
            .as_obj()
            .ok_or_else(|| "source_manifest.json root must be a JSON object".to_owned())?;

        let manifest_version = obj
            .get("manifest_version")
            .and_then(|v| v.as_str())
            .unwrap_or("2.0")
            .to_owned();
        if manifest_version != "2.0" {
            return Err(format!(
                "unsupported manifest_version {:?} (expected \"2.0\")",
                manifest_version
            ));
        }

        let require_v2_airlock = obj
            .get("require_v2_airlock")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let legacy_v1_pubkey = match obj.get("legacy_v1_pubkey") {
            None | Some(AirlockJsonVal::Null) => None,
            Some(AirlockJsonVal::Str(hex)) if hex.is_empty() => None,
            Some(AirlockJsonVal::Str(hex)) => Some(
                decode_hex_exact::<32>(hex)
                    .ok_or_else(|| "legacy_v1_pubkey must be 64 hex chars".to_owned())?,
            ),
            _ => return Err("legacy_v1_pubkey must be a string or null".to_owned()),
        };

        let arr = obj
            .get("sources")
            .and_then(|v| v.as_arr())
            .ok_or_else(|| "source_manifest.json missing 'sources' array".to_owned())?;
        if arr.is_empty() {
            return Err("source_manifest.json 'sources' array must not be empty".to_owned());
        }

        let mut sources = Vec::with_capacity(arr.len());
        for (idx, item) in arr.iter().enumerate() {
            let s_obj = item
                .as_obj()
                .ok_or_else(|| format!("sources[{}] must be an object", idx))?;
            let source_id = s_obj
                .get("source_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("sources[{}] missing string source_id", idx))?
                .to_owned();
            let key_id = s_obj
                .get("key_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("sources[{}] missing string key_id", idx))?
                .to_owned();
            let pubkey_hex = match (
                s_obj.get("pubkey").and_then(|v| v.as_str()),
                s_obj.get("pubkey_ed25519").and_then(|v| v.as_str()),
            ) {
                (Some(a), Some(b)) => {
                    if !a.eq_ignore_ascii_case(b) {
                        return Err(format!(
                            "sources[{}] conflicting pubkey vs pubkey_ed25519",
                            idx
                        ));
                    }
                    a
                }
                (Some(a), None) => a,
                (None, Some(b)) => b,
                (None, None) => {
                    return Err(format!(
                        "sources[{}] missing 64-hex pubkey / pubkey_ed25519",
                        idx
                    ))
                }
            };
            let pubkey = decode_hex_exact::<32>(pubkey_hex)
                .ok_or_else(|| format!("sources[{}] pubkey must be 64 hex chars", idx))?;
            let independence_group = s_obj
                .get("independence_group")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("sources[{}] missing string independence_group", idx))?
                .to_owned();

            if source_id.is_empty()
                || key_id.is_empty()
                || independence_group.is_empty()
                || source_id.contains('|')
                || key_id.contains('|')
            {
                return Err(format!("sources[{}] contains empty or pipe-containing ID", idx));
            }

            let kinds_val = s_obj
                .get("allowed_event_kinds")
                .and_then(|v| v.as_arr())
                .ok_or_else(|| format!("sources[{}] missing allowed_event_kinds array", idx))?;
            if kinds_val.is_empty() {
                return Err(format!(
                    "sources[{}] allowed_event_kinds must not be empty",
                    idx
                ));
            }
            let mut allowed_event_kinds = Vec::with_capacity(kinds_val.len());
            for kv in kinds_val {
                let ks = kv
                    .as_str()
                    .ok_or_else(|| format!("sources[{}] event_kind must be string", idx))?;
                if ks.is_empty() || ks.contains('|') {
                    return Err(format!("sources[{}] invalid event_kind", idx));
                }
                allowed_event_kinds.push(ks.to_owned());
            }

            let explicit_default_epistemic = match s_obj.get("default_epistemic_status") {
                None | Some(AirlockJsonVal::Null) => None,
                Some(AirlockJsonVal::Str(s)) => Some(EpistemicStatus::parse(s).ok_or_else(|| {
                    format!(
                        "sources[{}] unknown default_epistemic_status {:?}",
                        idx, s
                    )
                })?),
                _ => {
                    return Err(format!(
                        "sources[{}] default_epistemic_status must be string",
                        idx
                    ))
                }
            };

            let origin_class = match s_obj.get("origin_class") {
                None | Some(AirlockJsonVal::Null) => match explicit_default_epistemic {
                    Some(EpistemicStatus::Observation) | None => {
                        SourceOriginClass::CalibratedSensor
                    }
                    Some(EpistemicStatus::Claim) => SourceOriginClass::HumanOperator,
                    Some(EpistemicStatus::Hypothesis) => SourceOriginClass::ModelOrAgent,
                },
                Some(AirlockJsonVal::Str(s)) => SourceOriginClass::parse(s)
                    .ok_or_else(|| format!("sources[{}] unknown origin_class {:?}", idx, s))?,
                _ => return Err(format!("sources[{}] origin_class must be string", idx)),
            };

            let default_epistemic_status =
                explicit_default_epistemic.unwrap_or_else(|| origin_class.default_epistemic_status());
            if !origin_class.allows_epistemic_status(default_epistemic_status) {
                return Err(format!(
                    "sources[{}] origin_class {} forbids default_epistemic_status {}",
                    idx,
                    origin_class.as_str(),
                    default_epistemic_status.as_str()
                ));
            }

            let expires_at_ms = match s_obj.get("expires_at_ms") {
                None | Some(AirlockJsonVal::Null) => None,
                Some(AirlockJsonVal::Str(s)) => Some(parse_i64_decimal_ascii(s).ok_or_else(|| {
                    format!(
                        "sources[{}] expires_at_ms must be decimal ASCII i64 string",
                        idx
                    )
                })?),
                _ => {
                    return Err(format!(
                        "sources[{}] expires_at_ms must be a decimal string (64-bit JSON rule)",
                        idx
                    ))
                }
            };

            let max_staleness_ms = match s_obj.get("max_staleness_ms") {
                None | Some(AirlockJsonVal::Null) => None,
                Some(AirlockJsonVal::Str(s)) => {
                    let v = parse_i64_decimal_ascii(s).ok_or_else(|| {
                        format!(
                            "sources[{}] max_staleness_ms must be decimal ASCII i64 string",
                            idx
                        )
                    })?;
                    if v < 0 {
                        return Err(format!(
                            "sources[{}] max_staleness_ms must be non-negative",
                            idx
                        ));
                    }
                    Some(v)
                }
                _ => {
                    return Err(format!(
                        "sources[{}] max_staleness_ms must be a decimal string (64-bit JSON rule)",
                        idx
                    ))
                }
            };

            // Reject duplicate (source_id, key_id) with conflicting keys
            if sources
                .iter()
                .any(|existing: &AirlockSourceEntry| existing.source_id == source_id && existing.key_id == key_id)
            {
                return Err(format!(
                    "duplicate (source_id, key_id)=({:?}, {:?}) in manifest",
                    source_id, key_id
                ));
            }

            sources.push(AirlockSourceEntry {
                source_id,
                key_id,
                pubkey,
                allowed_event_kinds,
                independence_group,
                origin_class,
                default_epistemic_status,
                expires_at_ms,
                max_staleness_ms,
            });
        }

        let manifest = Self {
            manifest_version,
            require_v2_airlock,
            legacy_v1_pubkey,
            sources,
        };

        // Optional trust-anchor signature check over canonical manifest body
        if let Some(anchor_hex) = obj.get("trust_anchor_pubkey").and_then(|v| v.as_str()) {
            let sig_hex = obj
                .get("manifest_sig")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    "manifest carries trust_anchor_pubkey but no manifest_sig".to_owned()
                })?;
            let anchor_pk = decode_hex_exact::<32>(anchor_hex)
                .ok_or_else(|| "trust_anchor_pubkey must be 64 hex chars".to_owned())?;
            let sig_bytes = decode_hex_exact::<64>(sig_hex)
                .ok_or_else(|| "manifest_sig must be 128 hex chars".to_owned())?;
            let vk = VerifyingKey::from_bytes(&anchor_pk)
                .map_err(|_| "invalid trust_anchor_pubkey Ed25519 point".to_owned())?;
            let sig = Signature::from_bytes(&sig_bytes);
            let msg = format!("{}{}", MANIFEST_SIG_CTX, manifest.canonical_signing_body());
            vk.verify(msg.as_bytes(), &sig)
                .map_err(|_| "source_manifest.json trust_anchor Ed25519 signature mismatch".to_owned())?;
        }

        Ok(manifest)
    }

    pub fn canonical_signing_body(&self) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "manifest_version={}", self.manifest_version);
        let _ = writeln!(
            out,
            "require_v2_airlock={}",
            if self.require_v2_airlock { 1 } else { 0 }
        );
        let legacy_str = self
            .legacy_v1_pubkey
            .map(|pk| encode_hex_lower(&pk))
            .unwrap_or_default();
        let _ = writeln!(out, "legacy_v1_pubkey={}", legacy_str);
        for s in &self.sources {
            let exp_str = s
                .expires_at_ms
                .map(format_i64_decimal_ascii)
                .unwrap_or_default();
            let kinds = s.allowed_event_kinds.join(",");
            if let Some(stale_ms) = s.max_staleness_ms {
                let _ = writeln!(
                    out,
                    "source={}|{}|{}|{}|{}|{}|{}|staleness={}",
                    s.source_id,
                    s.key_id,
                    encode_hex_lower(&s.pubkey),
                    s.independence_group,
                    s.origin_class.as_str(),
                    exp_str,
                    kinds,
                    format_i64_decimal_ascii(stale_ms)
                );
            } else {
                let _ = writeln!(
                    out,
                    "source={}|{}|{}|{}|{}|{}|{}",
                    s.source_id,
                    s.key_id,
                    encode_hex_lower(&s.pubkey),
                    s.independence_group,
                    s.origin_class.as_str(),
                    exp_str,
                    kinds
                );
            }
        }
        out
    }

    pub fn sign_manifest_trust_anchor(&self, anchor_seed32: &[u8; 32]) -> (String, String) {
        let sk = SigningKey::from_bytes(anchor_seed32);
        let vk = sk.verifying_key();
        let msg = format!("{}{}", MANIFEST_SIG_CTX, self.canonical_signing_body());
        let sig = sk.sign(msg.as_bytes());
        (
            encode_hex_lower(vk.as_bytes()),
            encode_hex_lower(&sig.to_bytes()),
        )
    }

    /// Constant-time lookup verifying `(source_id, key_id, pubkey)` against pinned manifest.
    pub fn find_verified_source<'a>(
        &'a self,
        source_id: &str,
        key_id: &str,
        presented_pubkey: &[u8; 32],
    ) -> Option<&'a AirlockSourceEntry> {
        let mut matched: Option<&'a AirlockSourceEntry> = None;
        for entry in &self.sources {
            let id_match = entry.source_id == source_id && entry.key_id == key_id;
            let pk_eq: bool = entry.pubkey.ct_eq(presented_pubkey).into();
            if id_match && pk_eq {
                matched = Some(entry);
            }
        }
        matched
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar Raw Input Normalization & `CAELUS_INTEL_V2` Signing (§2 & §3.2)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct RawSidecarInput {
    pub source_id: String,
    pub key_id: String,
    pub event_kind: String,
    pub event_id: String,
    pub seq_no: u64,
    pub observed_at_ms: i64,
    pub learned_at_ms: i64,
    pub origin_class: SourceOriginClass,
    pub explicit_epistemic_status: Option<EpistemicStatus>,
    pub subject_id: String,
    pub metric_key: String,
    pub raw_decimal_value: String,
    pub unit: String,
    pub conversion_rule_id: String,
    pub supersedes_event_id: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone)]
pub struct SignedAirlockPacket {
    pub sig_line: String,
    pub pubkey_hex: String,
    pub sig_hex: String,
    pub schema_version: String,
    pub header_line: String,
    pub canonical_payload_json: String,
    pub payload_blake3_hex: String,
    pub learned_at_ms: i64,
}

impl SignedAirlockPacket {
    /// Exact 5-line `CAELUS_INTEL_V2` wire envelope (§3.2, pure LF).
    pub fn to_wire_envelope(&self) -> String {
        format!(
            "{}\n{}\n{}\n{}\n{}\n",
            self.sig_line,
            CAELUS_INTEL_V2_CONTRACT,
            self.schema_version,
            self.header_line,
            self.canonical_payload_json
        )
    }

    /// Canonical single-line `.airlock.ndjson` record (preserves exact signed components + string 64-bit `learned_at_ms`).
    pub fn to_ndjson_line(&self) -> String {
        format!(
            "{{\"contract\":\"{}\",\"sig\":\"{}\",\"schema_version\":\"{}\",\"header\":\"{}\",\"learned_at_ms\":\"{}\",\"payload_raw\":\"{}\"}}",
            CAELUS_INTEL_V2_CONTRACT,
            escape_audit_json_str(&self.sig_line),
            escape_audit_json_str(&self.schema_version),
            escape_audit_json_str(&self.header_line),
            format_i64_decimal_ascii(self.learned_at_ms),
            escape_audit_json_str(&self.canonical_payload_json)
        )
    }
}

pub fn build_canonical_payload_json(
    subject_id: &str,
    metric_key: &str,
    fp_val: i64,
    unit: &str,
    rule_id: &str,
    supersedes_event_id: Option<&str>,
    note: &str,
) -> String {
    let sup_json = match supersedes_event_id {
        Some(s) if !s.is_empty() => format!("\"{}\"", escape_audit_json_str(s)),
        _ => "null".to_owned(),
    };
    format!(
        "{{\"subject_id\":\"{}\",\"metric_key\":\"{}\",\"fp_val\":\"{}\",\"fp_scale\":{},\"unit\":\"{}\",\"rounding\":\"{}\",\"overflow_policy\":\"{}\",\"rule_id\":\"{}\",\"supersedes_event_id\":{},\"note\":\"{}\"}}",
        escape_audit_json_str(subject_id),
        escape_audit_json_str(metric_key),
        format_i64_decimal_ascii(fp_val),
        AIRLOCK_FP_SCALE,
        escape_audit_json_str(unit),
        RoundingMode::HalfEven.as_str(),
        OverflowPolicy::RejectAtAirlock.as_str(),
        escape_audit_json_str(rule_id),
        sup_json,
        escape_audit_json_str(note)
    )
}

pub fn build_v2_header_line(
    source_id: &str,
    key_id: &str,
    event_kind: &str,
    event_id: &str,
    seq_no: u64,
    observed_at_ms: i64,
    learned_at_ms: i64,
    epistemic_status: EpistemicStatus,
    payload_blake3_hex: &str,
) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}",
        source_id,
        key_id,
        event_kind,
        event_id,
        format_u64_decimal_ascii(seq_no),
        format_i64_decimal_ascii(observed_at_ms),
        format_i64_decimal_ascii(learned_at_ms),
        epistemic_status.as_str(),
        payload_blake3_hex
    )
}

pub fn build_v2_signed_message(
    schema_version: &str,
    header_line: &str,
    canonical_payload_json: &str,
) -> String {
    format!(
        "{}\n{}\n{}\n{}",
        CAELUS_INTEL_V2_CONTRACT, schema_version, header_line, canonical_payload_json
    )
}

fn contains_forbidden_header_delim(s: &str) -> bool {
    s.is_empty() || s.contains('|') || s.contains('\n') || s.contains('\r')
}

/// Normalize a raw external record into fixed-point (`FP_SCALE = 1_000_000`, `HALF_EVEN`,
/// `REJECT_AT_AIRLOCK`), enforce epistemic ceiling (`MODEL_OR_AGENT -> HYPOTHESIS`,
/// `HUMAN_OPERATOR <= CLAIM`), and sign with `CAELUS_INTEL_V2`.
pub fn normalize_and_sign_v2_record(
    raw: &RawSidecarInput,
    seed32: &[u8; 32],
) -> Result<SignedAirlockPacket, (AirlockErrorCode, String)> {
    if contains_forbidden_header_delim(&raw.source_id)
        || contains_forbidden_header_delim(&raw.key_id)
        || contains_forbidden_header_delim(&raw.event_kind)
        || contains_forbidden_header_delim(&raw.event_id)
        || raw.subject_id.is_empty()
        || raw.metric_key.is_empty()
        || raw.unit.is_empty()
        || raw.conversion_rule_id.is_empty()
        || raw.observed_at_ms < 0
        || raw.learned_at_ms < 0
    {
        return Err((
            AirlockErrorCode::ErrSchemaOrRange,
            "invalid empty/delimiter field or negative timestamp in raw sidecar input".to_owned(),
        ));
    }

    let epistemic_status = match raw.explicit_epistemic_status {
        Some(st) => {
            if !raw.origin_class.allows_epistemic_status(st) {
                return Err((
                    AirlockErrorCode::ErrUnauthorizedKind,
                    format!(
                        "origin_class {} is forbidden from claiming epistemic_status {}",
                        raw.origin_class.as_str(),
                        st.as_str()
                    ),
                ));
            }
            st
        }
        None => raw.origin_class.default_epistemic_status(),
    };

    let fp_val = parse_decimal_to_fp_half_even(&raw.raw_decimal_value).map_err(|code| {
        (
            code,
            format!(
                "REJECT_AT_AIRLOCK: raw value {:?} failed HALF_EVEN conversion or exceeded 2^62 bound",
                raw.raw_decimal_value
            ),
        )
    })?;

    let canonical_payload_json = build_canonical_payload_json(
        &raw.subject_id,
        &raw.metric_key,
        fp_val,
        &raw.unit,
        &raw.conversion_rule_id,
        raw.supersedes_event_id.as_deref(),
        &raw.note,
    );
    let payload_blake3_hex = blake3_hex(canonical_payload_json.as_bytes());
    let header_line = build_v2_header_line(
        &raw.source_id,
        &raw.key_id,
        &raw.event_kind,
        &raw.event_id,
        raw.seq_no,
        raw.observed_at_ms,
        raw.learned_at_ms,
        epistemic_status,
        &payload_blake3_hex,
    );

    let signed_msg =
        build_v2_signed_message(AIRLOCK_SCHEMA_V2, &header_line, &canonical_payload_json);
    let signing_key = SigningKey::from_bytes(seed32);
    let verifying_key = signing_key.verifying_key();
    let signature = signing_key.sign(signed_msg.as_bytes());

    let pubkey_hex = encode_hex_lower(verifying_key.as_bytes());
    let sig_hex = encode_hex_lower(&signature.to_bytes());
    let sig_line = format!("#sig=ed25519:{}:{}", pubkey_hex, sig_hex);

    Ok(SignedAirlockPacket {
        sig_line,
        pubkey_hex,
        sig_hex,
        schema_version: AIRLOCK_SCHEMA_V2.to_owned(),
        header_line,
        canonical_payload_json,
        payload_blake3_hex,
        learned_at_ms: raw.learned_at_ms,
    })
}

/// Multi-metric `CAELUS_INTEL_V2` sidecar input (§2.2):
/// `{"entity_id":"VESSEL_AEGEAN_01","fp_scale":1000000,"metrics":{...},"rounding":"HALF_EVEN","supersedes_event_id":null,"unit_schema":"SI_MARINE_V1"}`
#[derive(Debug, Clone)]
pub struct MultiMetricSidecarInput {
    pub source_id: String,
    pub key_id: String,
    pub event_kind: String,
    pub event_id: String,
    pub seq_no: u64,
    pub observed_at_ms: i64,
    pub learned_at_ms: i64,
    pub origin_class: SourceOriginClass,
    pub explicit_epistemic_status: Option<EpistemicStatus>,
    pub entity_id: String,
    pub raw_decimal_metrics: BTreeMap<String, String>,
    pub supersedes_event_id: Option<String>,
    pub unit_schema: String,
}

pub fn build_canonical_multimetric_v2_payload_json(
    entity_id: &str,
    fp_metrics: &BTreeMap<String, i64>,
    supersedes_event_id: Option<&str>,
    unit_schema: &str,
) -> String {
    let sup_json = match supersedes_event_id {
        Some(s) if !s.is_empty() => format!("\"{}\"", escape_audit_json_str(s)),
        _ => "null".to_owned(),
    };
    let mut metrics_json = String::new();
    for (idx, (k, v)) in fp_metrics.iter().enumerate() {
        if idx > 0 {
            metrics_json.push(',');
        }
        let _ = write!(
            metrics_json,
            "\"{}\":\"{}\"",
            escape_audit_json_str(k),
            format_i64_decimal_ascii(*v)
        );
    }
    format!(
        "{{\"entity_id\":\"{}\",\"fp_scale\":{},\"metrics\":{{{}}},\"rounding\":\"{}\",\"supersedes_event_id\":{},\"unit_schema\":\"{}\"}}",
        escape_audit_json_str(entity_id),
        AIRLOCK_FP_SCALE,
        metrics_json,
        RoundingMode::HalfEven.as_str(),
        sup_json,
        escape_audit_json_str(unit_schema)
    )
}

pub fn normalize_and_sign_v2_multimetric_record(
    raw: &MultiMetricSidecarInput,
    seed32: &[u8; 32],
) -> Result<SignedAirlockPacket, (AirlockErrorCode, String)> {
    if contains_forbidden_header_delim(&raw.source_id)
        || contains_forbidden_header_delim(&raw.key_id)
        || contains_forbidden_header_delim(&raw.event_kind)
        || contains_forbidden_header_delim(&raw.event_id)
        || raw.entity_id.is_empty()
        || raw.unit_schema.is_empty()
        || raw.raw_decimal_metrics.is_empty()
        || raw.observed_at_ms < 0
        || raw.learned_at_ms < 0
    {
        return Err((
            AirlockErrorCode::ErrSchemaOrRange,
            "invalid empty/delimiter field or negative timestamp in multi-metric sidecar input"
                .to_owned(),
        ));
    }

    let epistemic_status = match raw.explicit_epistemic_status {
        Some(st) => {
            if !raw.origin_class.allows_epistemic_status(st) {
                return Err((
                    AirlockErrorCode::ErrUnauthorizedKind,
                    format!(
                        "origin_class {} is forbidden from claiming epistemic_status {}",
                        raw.origin_class.as_str(),
                        st.as_str()
                    ),
                ));
            }
            st
        }
        None => raw.origin_class.default_epistemic_status(),
    };

    let mut fp_metrics = BTreeMap::new();
    for (k, dec_val) in &raw.raw_decimal_metrics {
        if k.is_empty() {
            return Err((
                AirlockErrorCode::ErrSchemaOrRange,
                "metric key must not be empty".to_owned(),
            ));
        }
        let fp = parse_decimal_to_fp_half_even(dec_val).map_err(|code| {
            (
                code,
                format!(
                    "REJECT_AT_AIRLOCK: metric {:?} value {:?} failed HALF_EVEN conversion or exceeded 2^62 bound",
                    k, dec_val
                ),
            )
        })?;
        fp_metrics.insert(k.clone(), fp);
    }

    let canonical_payload_json = build_canonical_multimetric_v2_payload_json(
        &raw.entity_id,
        &fp_metrics,
        raw.supersedes_event_id.as_deref(),
        &raw.unit_schema,
    );
    let payload_blake3_hex = blake3_hex(canonical_payload_json.as_bytes());
    let header_line = build_v2_header_line(
        &raw.source_id,
        &raw.key_id,
        &raw.event_kind,
        &raw.event_id,
        raw.seq_no,
        raw.observed_at_ms,
        raw.learned_at_ms,
        epistemic_status,
        &payload_blake3_hex,
    );
    let signed_msg =
        build_v2_signed_message(AIRLOCK_SCHEMA_V2, &header_line, &canonical_payload_json);
    let signing_key = SigningKey::from_bytes(seed32);
    let verifying_key = signing_key.verifying_key();
    let signature = signing_key.sign(signed_msg.as_bytes());
    let pubkey_hex = encode_hex_lower(verifying_key.as_bytes());
    let sig_hex = encode_hex_lower(&signature.to_bytes());
    let sig_line = format!("#sig=ed25519:{}:{}", pubkey_hex, sig_hex);

    Ok(SignedAirlockPacket {
        sig_line,
        pubkey_hex,
        sig_hex,
        schema_version: AIRLOCK_SCHEMA_V2.to_owned(),
        header_line,
        canonical_payload_json,
        payload_blake3_hex,
        learned_at_ms: raw.learned_at_ms,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Airlock Packet Verification (`v1` Legacy + `v2` Sidecar Envelope — §3.1–§3.4)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AirlockRejectionDetail {
    pub code: AirlockErrorCode,
    pub source_id: String,
    pub key_id: String,
    pub event_id: String,
    pub seq_no: u64,
    pub packet_blake3_hex: String,
    pub detail: String,
}

fn parse_sig_line_ed25519(sig_line: &str) -> Option<([u8; 32], [u8; 64])> {
    const PREFIX: &str = "#sig=ed25519:";
    if !sig_line.starts_with(PREFIX) {
        return None;
    }
    let rest = &sig_line[PREFIX.len()..];
    if rest.len() != 64 + 1 + 128 {
        return None;
    }
    let bytes = rest.as_bytes();
    if bytes[64] != b':' {
        return None;
    }
    let pk = decode_hex_exact::<32>(&rest[..64])?;
    let sig = decode_hex_exact::<64>(&rest[65..])?;
    Some((pk, sig))
}

/// Verify a `CAELUS_INTEL_V2` packet from its 4 structural components against `manifest`.
pub fn verify_v2_components(
    sig_line: &str,
    schema_version: &str,
    header_line: &str,
    payload_raw: &str,
    raw_packet_blake3: &str,
    manifest: &AirlockSourceManifest,
) -> Result<VerifiedAirlockEvent, AirlockRejectionDetail> {
    let (pubkey_bytes, sig_bytes) =
        parse_sig_line_ed25519(sig_line).ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSignatureMismatch,
            source_id: String::new(),
            key_id: String::new(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "malformed #sig=ed25519:<64hex>:<128hex> signature header".to_owned(),
        })?;

    let parts: Vec<&str> = header_line.split('|').collect();
    if parts.len() != 9 {
        return Err(AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: String::new(),
            key_id: String::new(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: format!("CAELUS_INTEL_V2 header expected 9 pipe fields, got {}", parts.len()),
        });
    }

    let source_id = parts[0];
    let key_id = parts[1];
    let event_kind = parts[2];
    let event_id = parts[3];
    let seq_no_raw = parts[4];
    let observed_raw = parts[5];
    let learned_raw = parts[6];
    let epistemic_raw = parts[7];
    let header_payload_blake3 = parts[8];

    let seq_hint = parse_u64_decimal_ascii(seq_no_raw).unwrap_or(0);

    // Step 1: Constant-time manifest source + key_id + pubkey pin lookup (`ERR_UNTRUSTED_SOURCE`).
    let source_entry = manifest
        .find_verified_source(source_id, key_id, &pubkey_bytes)
        .ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrUntrustedSource,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no: seq_hint,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "untrusted source_id, key_id, or Ed25519 pubkey mismatch against manifest"
                .to_owned(),
        })?;

    // Step 2: Ed25519 signature verification over canonical signed bytes + payload Blake3 check.
    let vk = VerifyingKey::from_bytes(&pubkey_bytes).map_err(|_| AirlockRejectionDetail {
        code: AirlockErrorCode::ErrSignatureMismatch,
        source_id: source_id.to_owned(),
        key_id: key_id.to_owned(),
        event_id: event_id.to_owned(),
        seq_no: seq_hint,
        packet_blake3_hex: raw_packet_blake3.to_owned(),
        detail: "invalid Ed25519 public key encoding".to_owned(),
    })?;
    let sig = Signature::from_bytes(&sig_bytes);
    let signed_msg = build_v2_signed_message(schema_version, header_line, payload_raw);
    vk.verify(signed_msg.as_bytes(), &sig)
        .map_err(|_| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSignatureMismatch,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no: seq_hint,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "Ed25519 signature verification failed over CAELUS_INTEL_V2 envelope"
                .to_owned(),
        })?;

    let computed_payload_blake3 = blake3_hex(payload_raw.as_bytes());
    let header_hash_bytes =
        decode_hex_exact::<32>(header_payload_blake3).ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSignatureMismatch,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no: seq_hint,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "header payload_blake3_hex is not 64 hex chars".to_owned(),
        })?;
    let computed_hash_bytes = *blake3::hash(payload_raw.as_bytes()).as_bytes();
    if bool::from(!header_hash_bytes.ct_eq(&computed_hash_bytes)) {
        return Err(AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSignatureMismatch,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no: seq_hint,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "payload_blake3_hex mismatch against canonical JSON payload".to_owned(),
        });
    }

    // Step 3: Parse 64-bit timestamps/seq_no and check key expiry (`ERR_UNTRUSTED_SOURCE`).
    let seq_no = parse_u64_decimal_ascii(seq_no_raw).ok_or_else(|| AirlockRejectionDetail {
        code: AirlockErrorCode::ErrSchemaOrRange,
        source_id: source_id.to_owned(),
        key_id: key_id.to_owned(),
        event_id: event_id.to_owned(),
        seq_no: 0,
        packet_blake3_hex: raw_packet_blake3.to_owned(),
        detail: "seq_no is not a valid u64 decimal ASCII string".to_owned(),
    })?;
    let observed_at_ms =
        parse_i64_decimal_ascii(observed_raw).ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "observed_at_ms is not a valid i64 decimal ASCII string".to_owned(),
        })?;
    let learned_at_ms =
        parse_i64_decimal_ascii(learned_raw).ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "learned_at_ms is not a valid i64 decimal ASCII string".to_owned(),
        })?;

    if let Some(exp_ms) = source_entry.expires_at_ms {
        if learned_at_ms > exp_ms {
            return Err(AirlockRejectionDetail {
                code: AirlockErrorCode::ErrUntrustedSource,
                source_id: source_id.to_owned(),
                key_id: key_id.to_owned(),
                event_id: event_id.to_owned(),
                seq_no,
                packet_blake3_hex: raw_packet_blake3.to_owned(),
                detail: format!(
                    "key_id {} expired at {} ms (learned_at_ms={})",
                    key_id, exp_ms, learned_at_ms
                ),
            });
        }
    }

    // Step 4: Schema version check (`ERR_SCHEMA_OR_RANGE`).
    if schema_version != AIRLOCK_SCHEMA_V2 {
        return Err(AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: format!("unsupported schema_version {:?} (expected \"2.0\")", schema_version),
        });
    }

    // Step 5: Event kind & epistemic authorization (`ERR_UNAUTHORIZED_KIND`).
    if !source_entry
        .allowed_event_kinds
        .iter()
        .any(|k| k == event_kind)
    {
        return Err(AirlockRejectionDetail {
            code: AirlockErrorCode::ErrUnauthorizedKind,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: format!(
                "source_id {:?} is not authorized for event_kind {:?}",
                source_id, event_kind
            ),
        });
    }

    let epistemic_status =
        EpistemicStatus::parse(epistemic_raw).ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: format!("invalid epistemic_status {:?}", epistemic_raw),
        })?;

    if !source_entry
        .origin_class
        .allows_epistemic_status(epistemic_status)
    {
        return Err(AirlockRejectionDetail {
            code: AirlockErrorCode::ErrUnauthorizedKind,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: format!(
                "source_id {:?} (origin_class={}) cannot emit epistemic_status {}",
                source_id,
                source_entry.origin_class.as_str(),
                epistemic_status.as_str()
            ),
        });
    }

    // Step 6: Parse single-line JSON payload & enforce 64-bit string + Z3 range rules (`ERR_SCHEMA_OR_RANGE`).
    if payload_raw.contains('\n') || payload_raw.contains('\r') {
        return Err(AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "canonical_json_payload must be single-line".to_owned(),
        });
    }

    let payload_val = parse_strict_json(payload_raw).map_err(|e| AirlockRejectionDetail {
        code: AirlockErrorCode::ErrSchemaOrRange,
        source_id: source_id.to_owned(),
        key_id: key_id.to_owned(),
        event_id: event_id.to_owned(),
        seq_no,
        packet_blake3_hex: raw_packet_blake3.to_owned(),
        detail: format!("malformed payload JSON: {}", e),
    })?;
    let p_obj = payload_val.as_obj().ok_or_else(|| AirlockRejectionDetail {
        code: AirlockErrorCode::ErrSchemaOrRange,
        source_id: source_id.to_owned(),
        key_id: key_id.to_owned(),
        event_id: event_id.to_owned(),
        seq_no,
        packet_blake3_hex: raw_packet_blake3.to_owned(),
        detail: "payload JSON must be an object".to_owned(),
    })?;

    let fp_scale: i64 = match p_obj.get("fp_scale") {
        Some(AirlockJsonVal::Int(v)) if *v == AIRLOCK_FP_SCALE as i128 => AIRLOCK_FP_SCALE,
        Some(AirlockJsonVal::Str(s)) if s == "1000000" => AIRLOCK_FP_SCALE,
        _ => {
            return Err(AirlockRejectionDetail {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: source_id.to_owned(),
                key_id: key_id.to_owned(),
                event_id: event_id.to_owned(),
                seq_no,
                packet_blake3_hex: raw_packet_blake3.to_owned(),
                detail: "fp_scale must equal 1000000".to_owned(),
            })
        }
    };

    // CRITICAL §2.2 & §3.2 rule: support BOTH single-metric `fp_val` AND multi-metric `metrics`
    // objects; every 64-bit value MUST be a decimal ASCII JSON string within |val| <= 2^62!
    let (subject_id, metric_key, fp_val, unit, overflow_policy, note) =
        if let Some(fp_val_entry) = p_obj.get("fp_val") {
            let fp_val_str = fp_val_entry.as_str().ok_or_else(|| AirlockRejectionDetail {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: source_id.to_owned(),
                key_id: key_id.to_owned(),
                event_id: event_id.to_owned(),
                seq_no,
                packet_blake3_hex: raw_packet_blake3.to_owned(),
                detail: "fp_val must be a decimal ASCII string (64-bit JSON precision contract)"
                    .to_owned(),
            })?;
            let parsed_fp =
                parse_i64_decimal_ascii(fp_val_str).ok_or_else(|| AirlockRejectionDetail {
                    code: AirlockErrorCode::ErrSchemaOrRange,
                    source_id: source_id.to_owned(),
                    key_id: key_id.to_owned(),
                    event_id: event_id.to_owned(),
                    seq_no,
                    packet_blake3_hex: raw_packet_blake3.to_owned(),
                    detail: "fp_val is not a valid signed 64-bit decimal integer string".to_owned(),
                })?;
            if !is_within_airlock_safe_fp_range(parsed_fp) {
                return Err(AirlockRejectionDetail {
                    code: AirlockErrorCode::ErrSchemaOrRange,
                    source_id: source_id.to_owned(),
                    key_id: key_id.to_owned(),
                    event_id: event_id.to_owned(),
                    seq_no,
                    packet_blake3_hex: raw_packet_blake3.to_owned(),
                    detail: "INVALID_RANGE: |fp_val| exceeds Z3 safe domain 2^62".to_owned(),
                });
            }
            let subj = p_obj
                .get("subject_id")
                .or_else(|| p_obj.get("entity_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            let mkey = p_obj
                .get("metric_key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            let u = p_obj
                .get("unit")
                .or_else(|| p_obj.get("unit_schema"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            let ovf = p_obj
                .get("overflow_policy")
                .and_then(|v| v.as_str())
                .and_then(OverflowPolicy::parse)
                .ok_or_else(|| AirlockRejectionDetail {
                    code: AirlockErrorCode::ErrSchemaOrRange,
                    source_id: source_id.to_owned(),
                    key_id: key_id.to_owned(),
                    event_id: event_id.to_owned(),
                    seq_no,
                    packet_blake3_hex: raw_packet_blake3.to_owned(),
                    detail: "overflow_policy must equal REJECT_AT_AIRLOCK".to_owned(),
                })?;
            let n = p_obj
                .get("note")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            (subj, mkey, parsed_fp, u, ovf, n)
        } else if let Some(metrics_val) = p_obj.get("metrics") {
            let m_obj = metrics_val.as_obj().ok_or_else(|| AirlockRejectionDetail {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: source_id.to_owned(),
                key_id: key_id.to_owned(),
                event_id: event_id.to_owned(),
                seq_no,
                packet_blake3_hex: raw_packet_blake3.to_owned(),
                detail: "metrics must be a non-empty JSON object".to_owned(),
            })?;
            if m_obj.is_empty() {
                return Err(AirlockRejectionDetail {
                    code: AirlockErrorCode::ErrSchemaOrRange,
                    source_id: source_id.to_owned(),
                    key_id: key_id.to_owned(),
                    event_id: event_id.to_owned(),
                    seq_no,
                    packet_blake3_hex: raw_packet_blake3.to_owned(),
                    detail: "metrics object must contain at least one metric".to_owned(),
                });
            }
            let mut validated_metrics: BTreeMap<String, i64> = BTreeMap::new();
            for (mk, mv) in m_obj {
                if mk.is_empty() {
                    return Err(AirlockRejectionDetail {
                        code: AirlockErrorCode::ErrSchemaOrRange,
                        source_id: source_id.to_owned(),
                        key_id: key_id.to_owned(),
                        event_id: event_id.to_owned(),
                        seq_no,
                        packet_blake3_hex: raw_packet_blake3.to_owned(),
                        detail: "metrics contains empty key".to_owned(),
                    });
                }
                let mv_str = mv.as_str().ok_or_else(|| AirlockRejectionDetail {
                    code: AirlockErrorCode::ErrSchemaOrRange,
                    source_id: source_id.to_owned(),
                    key_id: key_id.to_owned(),
                    event_id: event_id.to_owned(),
                    seq_no,
                    packet_blake3_hex: raw_packet_blake3.to_owned(),
                    detail: format!(
                        "metrics[{:?}] must be a decimal ASCII string (64-bit JSON precision contract)",
                        mk
                    ),
                })?;
                let parsed_fp = parse_i64_decimal_ascii(mv_str).ok_or_else(|| {
                    AirlockRejectionDetail {
                        code: AirlockErrorCode::ErrSchemaOrRange,
                        source_id: source_id.to_owned(),
                        key_id: key_id.to_owned(),
                        event_id: event_id.to_owned(),
                        seq_no,
                        packet_blake3_hex: raw_packet_blake3.to_owned(),
                        detail: format!(
                            "metrics[{:?}] is not a valid signed 64-bit decimal integer string",
                            mk
                        ),
                    }
                })?;
                if !is_within_airlock_safe_fp_range(parsed_fp) {
                    return Err(AirlockRejectionDetail {
                        code: AirlockErrorCode::ErrSchemaOrRange,
                        source_id: source_id.to_owned(),
                        key_id: key_id.to_owned(),
                        event_id: event_id.to_owned(),
                        seq_no,
                        packet_blake3_hex: raw_packet_blake3.to_owned(),
                        detail: format!(
                            "INVALID_RANGE: |metrics[{:?}]| exceeds Z3 safe domain 2^62",
                            mk
                        ),
                    });
                }
                validated_metrics.insert(mk.clone(), parsed_fp);
            }

            let explicit_primary = p_obj.get("metric_key").and_then(|v| v.as_str());
            let priority_keys = [
                "delay_min_fp",
                "departure_delay_min",
                "berth_delay_min_fp",
                "wave_m_fp",
                "wind_speed_mps_fp",
                "wind_gust_kn_fp",
                "sog_kn_fp",
                "baro_alt_m_fp",
                "depth_m_fp",
            ];
            let chosen_key = if let Some(ek) = explicit_primary {
                if validated_metrics.contains_key(ek) {
                    ek.to_owned()
                } else {
                    return Err(AirlockRejectionDetail {
                        code: AirlockErrorCode::ErrSchemaOrRange,
                        source_id: source_id.to_owned(),
                        key_id: key_id.to_owned(),
                        event_id: event_id.to_owned(),
                        seq_no,
                        packet_blake3_hex: raw_packet_blake3.to_owned(),
                        detail: format!("explicit metric_key {:?} missing from metrics", ek),
                    });
                }
            } else if let Some(pk) = priority_keys
                .iter()
                .find(|&&k| validated_metrics.contains_key(k))
            {
                (*pk).to_owned()
            } else {
                validated_metrics
                    .keys()
                    .next()
                    .cloned()
                    .unwrap_or_default()
            };
            let chosen_fp = *validated_metrics.get(&chosen_key).unwrap_or(&0);
            let subj = p_obj
                .get("entity_id")
                .or_else(|| p_obj.get("subject_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            let u = p_obj
                .get("unit_schema")
                .or_else(|| p_obj.get("unit"))
                .and_then(|v| v.as_str())
                .unwrap_or("SI_MARINE_V1")
                .to_owned();
            let ovf = match p_obj.get("overflow_policy") {
                None | Some(AirlockJsonVal::Null) => OverflowPolicy::RejectAtAirlock,
                Some(AirlockJsonVal::Str(s)) => {
                    OverflowPolicy::parse(s).ok_or_else(|| AirlockRejectionDetail {
                        code: AirlockErrorCode::ErrSchemaOrRange,
                        source_id: source_id.to_owned(),
                        key_id: key_id.to_owned(),
                        event_id: event_id.to_owned(),
                        seq_no,
                        packet_blake3_hex: raw_packet_blake3.to_owned(),
                        detail: "overflow_policy must equal REJECT_AT_AIRLOCK".to_owned(),
                    })?
                }
                _ => {
                    return Err(AirlockRejectionDetail {
                        code: AirlockErrorCode::ErrSchemaOrRange,
                        source_id: source_id.to_owned(),
                        key_id: key_id.to_owned(),
                        event_id: event_id.to_owned(),
                        seq_no,
                        packet_blake3_hex: raw_packet_blake3.to_owned(),
                        detail: "overflow_policy must be string".to_owned(),
                    })
                }
            };
            let n = match p_obj.get("note").and_then(|v| v.as_str()) {
                Some(s) => s.to_owned(),
                None => {
                    let mut summary = String::new();
                    for (idx, (mk, mv)) in validated_metrics.iter().enumerate() {
                        if idx > 0 {
                            summary.push_str(", ");
                        }
                        let _ = write!(summary, "{}={}", mk, format_i64_decimal_ascii(*mv));
                    }
                    summary
                }
            };
            (subj, chosen_key, chosen_fp, u, ovf, n)
        } else {
            return Err(AirlockRejectionDetail {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: source_id.to_owned(),
                key_id: key_id.to_owned(),
                event_id: event_id.to_owned(),
                seq_no,
                packet_blake3_hex: raw_packet_blake3.to_owned(),
                detail: "payload must contain decimal string fp_val or metrics object".to_owned(),
            });
        };

    let rounding = p_obj
        .get("rounding")
        .and_then(|v| v.as_str())
        .and_then(RoundingMode::parse)
        .ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: source_id.to_owned(),
            key_id: key_id.to_owned(),
            event_id: event_id.to_owned(),
            seq_no,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "rounding must equal HALF_EVEN".to_owned(),
        })?;

    let supersedes_event_id = match p_obj.get("supersedes_event_id") {
        None | Some(AirlockJsonVal::Null) => None,
        Some(AirlockJsonVal::Str(s)) if s.is_empty() => None,
        Some(AirlockJsonVal::Str(s)) => Some(s.clone()),
        _ => {
            return Err(AirlockRejectionDetail {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: source_id.to_owned(),
                key_id: key_id.to_owned(),
                event_id: event_id.to_owned(),
                seq_no,
                packet_blake3_hex: raw_packet_blake3.to_owned(),
                detail: "supersedes_event_id must be string or null".to_owned(),
            })
        }
    };

    let ev = VerifiedAirlockEvent {
        schema_version: schema_version.to_owned(),
        source_id: source_id.to_owned(),
        key_id: key_id.to_owned(),
        independence_group: source_entry.independence_group.clone(),
        event_kind: event_kind.to_owned(),
        event_id: event_id.to_owned(),
        seq_no,
        observed_at_ms,
        learned_at_ms,
        epistemic_status,
        subject_id,
        metric_key,
        fp_val,
        fp_scale,
        unit,
        rounding,
        overflow_policy,
        supersedes_event_id,
        payload_blake3_hex: computed_payload_blake3,
        legacy_unscoped: false,
        note,
    };

    ev.validate_invariants(manifest.require_v2_airlock)
        .map_err(|e| AirlockRejectionDetail {
            code: e.code,
            source_id: e.source_id,
            key_id: key_id.to_owned(),
            event_id: e.event_id,
            seq_no: e.seq_no,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: e.detail,
        })?;

    Ok(ev)
}

/// Verify a legacy `CAELUS_INTEL_V1` packet (`#sig=ed25519:<pub>:<sig>\n<body>`),
/// tagging it `LEGACY_UNSCOPED` (§3.1) or rejecting if `manifest.require_v2_airlock` is true.
fn verify_legacy_v1_wire(
    sig_line: &str,
    body: &str,
    raw_packet_blake3: &str,
    manifest: &AirlockSourceManifest,
) -> Result<VerifiedAirlockEvent, AirlockRejectionDetail> {
    let (pubkey_bytes, sig_bytes) =
        parse_sig_line_ed25519(sig_line).ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSignatureMismatch,
            source_id: "LEGACY_V1".to_owned(),
            key_id: "legacy_v1".to_owned(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "malformed v1 #sig=ed25519 header".to_owned(),
        })?;

    let pinned_v1 = manifest
        .legacy_v1_pubkey
        .ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrUntrustedSource,
            source_id: "LEGACY_V1".to_owned(),
            key_id: "legacy_v1".to_owned(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "no legacy_v1_pubkey configured in manifest".to_owned(),
        })?;

    if bool::from(!pinned_v1.ct_eq(&pubkey_bytes)) {
        return Err(AirlockRejectionDetail {
            code: AirlockErrorCode::ErrUntrustedSource,
            source_id: "LEGACY_V1".to_owned(),
            key_id: "legacy_v1".to_owned(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "legacy_v1_pubkey mismatch".to_owned(),
        });
    }

    let vk = VerifyingKey::from_bytes(&pubkey_bytes).map_err(|_| AirlockRejectionDetail {
        code: AirlockErrorCode::ErrSignatureMismatch,
        source_id: "LEGACY_V1".to_owned(),
        key_id: "legacy_v1".to_owned(),
        event_id: String::new(),
        seq_no: 0,
        packet_blake3_hex: raw_packet_blake3.to_owned(),
        detail: "invalid v1 Ed25519 pubkey".to_owned(),
    })?;
    let sig = Signature::from_bytes(&sig_bytes);
    let mut signed = Vec::with_capacity(16 + body.len());
    signed.extend_from_slice(b"CAELUS_INTEL_V1\n");
    signed.extend_from_slice(body.as_bytes());
    vk.verify(&signed, &sig)
        .map_err(|_| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSignatureMismatch,
            source_id: "LEGACY_V1".to_owned(),
            key_id: "legacy_v1".to_owned(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "CAELUS_INTEL_V1 Ed25519 signature mismatch".to_owned(),
        })?;

    if manifest.require_v2_airlock {
        return Err(AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: "LEGACY_V1".to_owned(),
            key_id: "legacy_v1".to_owned(),
            event_id: "LEGACY_UNSCOPED".to_owned(),
            seq_no: 1,
            packet_blake3_hex: raw_packet_blake3.to_owned(),
            detail: "LEGACY_UNSCOPED CAELUS_INTEL_V1 packet rejected under require_v2_airlock=true"
                .to_owned(),
        });
    }

    let body_hash = blake3_hex(body.as_bytes());
    Ok(VerifiedAirlockEvent {
        schema_version: AIRLOCK_SCHEMA_V1_LEGACY.to_owned(),
        source_id: "LEGACY_UNSCOPED".to_owned(),
        key_id: "legacy_v1".to_owned(),
        independence_group: String::new(),
        event_kind: "LEGACY_UNSCOPED".to_owned(),
        event_id: format!("v1-{}", &body_hash[..16]),
        seq_no: 1,
        observed_at_ms: 0,
        learned_at_ms: 0,
        epistemic_status: EpistemicStatus::Claim,
        subject_id: "LEGACY_SUBJECT".to_owned(),
        metric_key: "friction_coeff".to_owned(),
        fp_val: 0,
        fp_scale: AIRLOCK_FP_SCALE,
        unit: "ratio".to_owned(),
        rounding: RoundingMode::HalfEven,
        overflow_policy: OverflowPolicy::RejectAtAirlock,
        supersedes_event_id: None,
        payload_blake3_hex: body_hash,
        legacy_unscoped: true,
        note: "LEGACY_UNSCOPED".to_owned(),
    })
}

/// Parse & verify either a single-line `.airlock.ndjson` JSON record OR a 5-line `CAELUS_INTEL_V2`
/// / 2-line `CAELUS_INTEL_V1` wire block.
pub fn verify_airlock_packet_str(
    raw_record: &str,
    manifest: &AirlockSourceManifest,
) -> Result<VerifiedAirlockEvent, AirlockRejectionDetail> {
    let packet_hash = blake3_hex(raw_record.as_bytes());
    let trimmed = raw_record.trim_end_matches('\n');
    if trimmed.contains('\r') {
        return Err(AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: String::new(),
            key_id: String::new(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: packet_hash,
            detail: "CRLF detected; airlock records must use LF ('\\n') only".to_owned(),
        });
    }

    if trimmed.starts_with('{') {
        let val = parse_strict_json(trimmed).map_err(|e| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: String::new(),
            key_id: String::new(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: packet_hash.clone(),
            detail: format!("invalid NDJSON object: {}", e),
        })?;
        let obj = val.as_obj().ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: String::new(),
            key_id: String::new(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: packet_hash.clone(),
            detail: "NDJSON line must be an object".to_owned(),
        })?;

        let contract = obj
            .get("contract")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let sig_line = obj.get("sig").and_then(|v| v.as_str()).unwrap_or("");

        if contract == CAELUS_INTEL_V1_CONTRACT {
            let body = obj.get("body").and_then(|v| v.as_str()).unwrap_or("");
            return verify_legacy_v1_wire(sig_line, body, &packet_hash, manifest);
        }
        if contract != CAELUS_INTEL_V2_CONTRACT {
            return Err(AirlockRejectionDetail {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: String::new(),
                key_id: String::new(),
                event_id: String::new(),
                seq_no: 0,
                packet_blake3_hex: packet_hash,
                detail: format!("unsupported contract {:?}", contract),
            });
        }

        let schema_version = obj
            .get("schema_version")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let header_line = obj.get("header").and_then(|v| v.as_str()).unwrap_or("");
        let payload_raw = obj
            .get("payload_raw")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AirlockRejectionDetail {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: String::new(),
                key_id: String::new(),
                event_id: String::new(),
                seq_no: 0,
                packet_blake3_hex: packet_hash.clone(),
                detail: "NDJSON v2 record missing string payload_raw".to_owned(),
            })?;

        // If `learned_at_ms` index hint is present on the outer NDJSON object, it MUST be a decimal string
        // matching the signed header's learned_at_ms!
        let ev = verify_v2_components(
            sig_line,
            schema_version,
            header_line,
            payload_raw,
            &packet_hash,
            manifest,
        )?;
        if let Some(outer_learned) = obj.get("learned_at_ms") {
            let outer_str = outer_learned.as_str().ok_or_else(|| AirlockRejectionDetail {
                code: AirlockErrorCode::ErrSchemaOrRange,
                source_id: ev.source_id.clone(),
                key_id: ev.key_id.clone(),
                event_id: ev.event_id.clone(),
                seq_no: ev.seq_no,
                packet_blake3_hex: packet_hash.clone(),
                detail: "outer learned_at_ms must be decimal ASCII string".to_owned(),
            })?;
            let outer_ms =
                parse_i64_decimal_ascii(outer_str).ok_or_else(|| AirlockRejectionDetail {
                    code: AirlockErrorCode::ErrSchemaOrRange,
                    source_id: ev.source_id.clone(),
                    key_id: ev.key_id.clone(),
                    event_id: ev.event_id.clone(),
                    seq_no: ev.seq_no,
                    packet_blake3_hex: packet_hash.clone(),
                    detail: "invalid outer learned_at_ms decimal string".to_owned(),
                })?;
            if outer_ms != ev.learned_at_ms {
                return Err(AirlockRejectionDetail {
                    code: AirlockErrorCode::ErrSignatureMismatch,
                    source_id: ev.source_id.clone(),
                    key_id: ev.key_id.clone(),
                    event_id: ev.event_id.clone(),
                    seq_no: ev.seq_no,
                    packet_blake3_hex: packet_hash,
                    detail: "outer learned_at_ms disagrees with signed header learned_at_ms"
                        .to_owned(),
                });
            }
        }
        return Ok(ev);
    }

    // Wire format starting with `#sig=ed25519:`
    let first_nl = trimmed.find('\n').ok_or_else(|| AirlockRejectionDetail {
        code: AirlockErrorCode::ErrSignatureMismatch,
        source_id: String::new(),
        key_id: String::new(),
        event_id: String::new(),
        seq_no: 0,
        packet_blake3_hex: packet_hash.clone(),
        detail: "wire packet missing newline after #sig header".to_owned(),
    })?;
    let sig_line = &trimmed[..first_nl];
    let after_sig = &trimmed[first_nl + 1..];

    if let Some(after_domain) = after_sig.strip_prefix("CAELUS_INTEL_V2\n") {
        let mut lines = after_domain.splitn(3, '\n');
        let schema_version = lines.next().unwrap_or("");
        let header_line = lines.next().unwrap_or("");
        let payload_raw = lines.next().ok_or_else(|| AirlockRejectionDetail {
            code: AirlockErrorCode::ErrSchemaOrRange,
            source_id: String::new(),
            key_id: String::new(),
            event_id: String::new(),
            seq_no: 0,
            packet_blake3_hex: packet_hash.clone(),
            detail: "CAELUS_INTEL_V2 wire packet requires 5 lines".to_owned(),
        })?;
        verify_v2_components(
            sig_line,
            schema_version,
            header_line,
            payload_raw,
            &packet_hash,
            manifest,
        )
    } else {
        // Route to backward-compatible v1 verifier (§3.1)
        verify_legacy_v1_wire(sig_line, after_sig, &packet_hash, manifest)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical `state_blake3` & Batch Splitting / Binary Search (§5)
// ─────────────────────────────────────────────────────────────────────────────

/// Canonical multi-line state transcript hashed by `blake3` (shared byte-for-byte with JS MCP).
pub fn canonical_slice_state_transcript(report: &SliceEvaluationReport) -> String {
    let mut out = String::with_capacity(512);
    let _ = writeln!(out, "CAELUS_AIRLOCK_SLICE_STATE_BLAKE3_V2");
    let _ = writeln!(out, "scenario_id={}", report.scenario_id);
    let _ = writeln!(out, "policy_id={}", report.policy_id);
    let _ = writeln!(
        out,
        "cutoff_learned_at_ms={}",
        format_i64_decimal_ascii(report.cutoff_learned_at_ms)
    );
    let _ = writeln!(out, "verdict={}", report.verdict.as_str());
    let _ = writeln!(out, "applied_rule_id={}", report.applied_rule_id);
    let _ = writeln!(
        out,
        "conflict_detected={}",
        u8::from(report.conflict_detected)
    );
    let _ = writeln!(
        out,
        "legacy_unscoped_present={}",
        u8::from(report.legacy_unscoped_present)
    );
    let _ = writeln!(
        out,
        "min_assumption_fp={}",
        report
            .min_assumption_fp
            .map(format_i64_decimal_ascii)
            .unwrap_or_else(|| "NONE".to_owned())
    );
    let _ = writeln!(
        out,
        "max_assumption_fp={}",
        report
            .max_assumption_fp
            .map(format_i64_decimal_ascii)
            .unwrap_or_else(|| "NONE".to_owned())
    );
    let cs = &report.causal_snapshot;
    let _ = writeln!(
        out,
        "causal_fp={}|{}|{}|{}|{}|{}|{}|{}",
        format_u64_decimal_ascii(cs.tick),
        format_i64_decimal_ascii(cs.raw_friction_fp),
        format_i64_decimal_ascii(cs.clamped_friction_fp),
        format_i64_decimal_ascii(cs.throughput_ratio_fp),
        u8::from(cs.regime_exceeded),
        u8::from(cs.any_hysteresis_flip),
        u8::from(cs.any_deadline_missed),
        u8::from(cs.outage_active)
    );
    let _ = writeln!(out, "preserved_count={}", report.preserved_records.len());
    for rec in &report.preserved_records {
        let _ = writeln!(
            out,
            "preserved={}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
            rec.event_id,
            rec.source_id,
            rec.key_id,
            rec.independence_group,
            rec.event_kind,
            format_u64_decimal_ascii(rec.seq_no),
            format_i64_decimal_ascii(rec.observed_at_ms),
            format_i64_decimal_ascii(rec.learned_at_ms),
            rec.epistemic_status.as_str(),
            rec.subject_id,
            rec.metric_key,
            format_i64_decimal_ascii(rec.fp_val),
            rec.unit,
            rec.supersedes_event_id.as_deref().unwrap_or(""),
            rec.superseded_by_event_id.as_deref().unwrap_or(""),
            u8::from(rec.legacy_unscoped)
        );
    }
    let _ = writeln!(out, "active_count={}", report.active_assertions.len());
    for act in &report.active_assertions {
        let _ = writeln!(
            out,
            "active={}|{}|{}|{}",
            act.event_id,
            act.source_id,
            format_i64_decimal_ascii(act.fp_val),
            act.epistemic_status.as_str()
        );
    }
    let _ = writeln!(out, "conflicts_count={}", report.conflicts.len());
    for c in &report.conflicts {
        let _ = writeln!(
            out,
            "conflict={}|{}|{}|{}|{}|{}|{}|{}",
            c.subject_id,
            c.metric_key,
            c.unit,
            format_i64_decimal_ascii(c.min_fp_val),
            format_i64_decimal_ascii(c.max_fp_val),
            u8::from(c.resolved_by_calibrated_observation_breach),
            c.source_ids.join(","),
            c.event_ids.join(",")
        );
    }
    let _ = writeln!(out, "groups={}", report.corroborated_groups.join(","));
    let _ = writeln!(out, "missing={}", report.missing_evidence.join(","));
    out
}

pub fn compute_slice_state_blake3(report: &SliceEvaluationReport) -> String {
    let transcript = canonical_slice_state_transcript(report);
    blake3_hex(transcript.as_bytes())
}

/// Split an `.airlock.ndjson` or multi-packet wire stream into raw packet records.
pub fn split_airlock_batch_records(content: &str) -> Result<Vec<String>, String> {
    if content.contains('\r') {
        return Err("CRLF detected in airlock batch; binary LF ('\\n') required".to_owned());
    }
    let lines: Vec<&str> = content.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.trim().is_empty() {
            i += 1;
            continue;
        }
        if line.starts_with('{') {
            out.push(line.to_owned());
            i += 1;
        } else if line.starts_with("#sig=") {
            if i + 1 < lines.len() && lines[i + 1] == CAELUS_INTEL_V2_CONTRACT {
                if i + 4 >= lines.len() {
                    return Err("truncated 5-line CAELUS_INTEL_V2 wire block".to_owned());
                }
                let block = format!(
                    "{}\n{}\n{}\n{}\n{}",
                    lines[i],
                    lines[i + 1],
                    lines[i + 2],
                    lines[i + 3],
                    lines[i + 4]
                );
                out.push(block);
                i += 5;
            } else if i + 1 < lines.len() {
                let block = format!("{}\n{}", lines[i], lines[i + 1]);
                out.push(block);
                i += 2;
            } else {
                out.push(line.to_owned());
                i += 1;
            }
        } else {
            out.push(line.to_owned());
            i += 1;
        }
    }
    Ok(out)
}

/// Quick extractor for `learned_at_ms` when `.airlock.ndjson` or `.wire.v2` is sorted append-only (§5 binary search).
pub fn peek_ndjson_learned_at_ms(raw_record: &str) -> Option<i64> {
    if raw_record.starts_with('{') {
        const NEEDLE: &str = "\"learned_at_ms\":\"";
        let start = raw_record.find(NEEDLE)? + NEEDLE.len();
        let rest = &raw_record[start..];
        let end = rest.find('"')?;
        return parse_i64_decimal_ascii(&rest[..end]);
    }
    if raw_record.starts_with("#sig=ed25519:") {
        let mut lines = raw_record.lines();
        let _sig = lines.next()?;
        let contract = lines.next()?;
        if contract != CAELUS_INTEL_V2_CONTRACT {
            return None;
        }
        let _ver = lines.next()?;
        let header = lines.next()?;
        let mut parts = header.split('|');
        let _ = parts.next()?;
        let _ = parts.next()?;
        let _ = parts.next()?;
        let _ = parts.next()?;
        let _ = parts.next()?;
        let _ = parts.next()?;
        let learned = parts.next()?;
        return parse_i64_decimal_ascii(learned);
    }
    None
}

/// Extract `(event_id, metrics_map)` with lossless decimal ASCII string values from a verified `v2` record.
pub fn extract_v2_payload_metrics(raw_record: &str) -> Option<(String, BTreeMap<String, String>)> {
    let trimmed = raw_record.trim_end_matches('\n');
    let (header_line, payload_raw): (String, String) = if trimmed.starts_with('{') {
        let obj = parse_strict_json(trimmed).ok()?;
        let m = obj.as_obj()?;
        if m.get("contract").and_then(|v| v.as_str())? != CAELUS_INTEL_V2_CONTRACT {
            return None;
        }
        (
            m.get("header")?.as_str()?.to_owned(),
            m.get("payload_raw")?.as_str()?.to_owned(),
        )
    } else if trimmed.starts_with("#sig=ed25519:") {
        let mut lines = trimmed.lines();
        let _ = lines.next()?;
        if lines.next()? != CAELUS_INTEL_V2_CONTRACT {
            return None;
        }
        let _ = lines.next()?;
        let hdr = lines.next()?.to_owned();
        let pld = lines.next()?.to_owned();
        (hdr, pld)
    } else {
        return None;
    };

    let parts: Vec<&str> = header_line.split('|').collect();
    if parts.len() != 9 {
        return None;
    }
    let event_id = parts[3].to_owned();
    let p_val = parse_strict_json(&payload_raw).ok()?;
    let p_obj = p_val.as_obj()?;
    let mut out = BTreeMap::new();
    if let Some(m_obj) = p_obj.get("metrics").and_then(|v| v.as_obj()) {
        for (k, v) in m_obj {
            if let Some(s) = v.as_str() {
                out.insert(k.clone(), s.to_owned());
            }
        }
    } else if let (Some(mk), Some(fv)) = (
        p_obj.get("metric_key").and_then(|v| v.as_str()),
        p_obj.get("fp_val").and_then(|v| v.as_str()),
    ) {
        out.insert(mk.to_owned(), fv.to_owned());
    }
    Some((event_id, out))
}

/// Stateful host airlock gate proving `0`-bit `state_blake3` invariance on every rejected packet (§3.4 & §6.2).
pub struct AirlockHostSession {
    manifest: AirlockSourceManifest,
    policy: SlicePolicy,
    cutoff_learned_at_ms: i64,
    accepted: Vec<VerifiedAirlockEvent>,
    seen_seq: Vec<(String, u64, String)>,
    downgraded_sources: Vec<String>,
    last_report: SliceEvaluationReport,
    last_state_blake3: String,
    audit_log: Option<CaelusAuditLog>,
}

impl AirlockHostSession {
    pub fn new(
        manifest: AirlockSourceManifest,
        mut policy: SlicePolicy,
        cutoff_learned_at_ms: i64,
        audit_log: Option<CaelusAuditLog>,
    ) -> Result<Self, String> {
        policy.require_v2_airlock = manifest.require_v2_airlock;
        let initial_report = ingest_verified_slice(&[], cutoff_learned_at_ms, &policy)
            .map_err(|e| format!("initial slice error: {} ({})", e.code.as_str(), e.detail))?;
        let initial_hash = compute_slice_state_blake3(&initial_report);
        Ok(Self {
            manifest,
            policy,
            cutoff_learned_at_ms,
            accepted: Vec::new(),
            seen_seq: Vec::new(),
            downgraded_sources: Vec::new(),
            last_report: initial_report,
            last_state_blake3: initial_hash,
            audit_log,
        })
    }

    pub fn state_blake3(&self) -> &str {
        &self.last_state_blake3
    }

    pub fn report(&self) -> &SliceEvaluationReport {
        &self.last_report
    }

    pub fn downgraded_sources(&self) -> &[String] {
        &self.downgraded_sources
    }

    /// Attempt to ingest one raw packet. On ANY failure (`ERR_SIGNATURE_MISMATCH`,
    /// `ERR_UNTRUSTED_SOURCE`, `ERR_UNAUTHORIZED_KIND`, `ERR_SCHEMA_OR_RANGE`,
    /// `ERR_SOURCE_EQUIVOCATION`), logs to `audit_log` and leaves `state_blake3()` 0-bit changed!
    pub fn ingest_packet(&mut self, raw_record: &str) -> Result<(), AirlockRejectionDetail> {
        let ev = match verify_airlock_packet_str(raw_record, &self.manifest) {
            Ok(v) => v,
            Err(rej) => {
                if let Some(log) = &mut self.audit_log {
                    let _ = log.append_airlock_rejection(
                        rej.code.audit_record_type(),
                        rej.code.as_str(),
                        &rej.source_id,
                        &rej.key_id,
                        &rej.event_id,
                        rej.seq_no,
                        &rej.packet_blake3_hex,
                        &rej.detail,
                    );
                }
                return Err(rej);
            }
        };

        // Check `(source_id, seq_no)` equivocation BEFORE mutating `self.accepted`
        if let Some((_, _, prev_hash)) = self
            .seen_seq
            .iter()
            .find(|(s, seq, _)| s == &ev.source_id && *seq == ev.seq_no)
        {
            if !prev_hash.eq_ignore_ascii_case(&ev.payload_blake3_hex) {
                if !self.downgraded_sources.iter().any(|s| s == &ev.source_id) {
                    self.downgraded_sources.push(ev.source_id.clone());
                }
                let pkt_hash = blake3_hex(raw_record.as_bytes());
                let rej = AirlockRejectionDetail {
                    code: AirlockErrorCode::ErrSourceEquivocation,
                    source_id: ev.source_id,
                    key_id: ev.key_id,
                    event_id: ev.event_id,
                    seq_no: ev.seq_no,
                    packet_blake3_hex: pkt_hash,
                    detail: "SOURCE_EQUIVOCATION: conflicting payload_blake3 for existing (source_id, seq_no)".to_owned(),
                };
                if let Some(log) = &mut self.audit_log {
                    let _ = log.append_airlock_rejection(
                        rej.code.audit_record_type(),
                        rej.code.as_str(),
                        &rej.source_id,
                        &rej.key_id,
                        &rej.event_id,
                        rej.seq_no,
                        &rej.packet_blake3_hex,
                        &rej.detail,
                    );
                }
                return Err(rej);
            }
        }

        let mut candidate = self.accepted.clone();
        candidate.push(ev.clone());
        match ingest_verified_slice(&candidate, self.cutoff_learned_at_ms, &self.policy) {
            Ok(new_report) => {
                if !self
                    .seen_seq
                    .iter()
                    .any(|(s, seq, _)| s == &ev.source_id && *seq == ev.seq_no)
                {
                    self.seen_seq.push((
                        ev.source_id.clone(),
                        ev.seq_no,
                        ev.payload_blake3_hex.clone(),
                    ));
                }
                self.accepted = candidate;
                self.last_state_blake3 = compute_slice_state_blake3(&new_report);
                self.last_report = new_report;
                Ok(())
            }
            Err(slice_err) => {
                let pkt_hash = blake3_hex(raw_record.as_bytes());
                let rej = AirlockRejectionDetail {
                    code: slice_err.code,
                    source_id: slice_err.source_id,
                    key_id: ev.key_id,
                    event_id: slice_err.event_id,
                    seq_no: slice_err.seq_no,
                    packet_blake3_hex: pkt_hash,
                    detail: slice_err.detail,
                };
                if let Some(log) = &mut self.audit_log {
                    let _ = log.append_airlock_rejection(
                        rej.code.audit_record_type(),
                        rej.code.as_str(),
                        &rej.source_id,
                        &rej.key_id,
                        &rej.event_id,
                        rej.seq_no,
                        &rej.packet_blake3_hex,
                        &rej.detail,
                    );
                }
                Err(rej)
            }
        }
    }

    pub fn into_audit_log(self) -> Option<CaelusAuditLog> {
        self.audit_log
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Validation & Slice Evaluation Outcomes (CLI & MCP JSON Serializer)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct BatchValidationEntry {
    pub index: usize,
    pub accepted: bool,
    pub event_id: String,
    pub source_id: String,
    pub key_id: String,
    pub seq_no: u64,
    pub learned_at_ms: Option<i64>,
    pub epistemic_status: Option<EpistemicStatus>,
    pub error_code: Option<AirlockErrorCode>,
    pub detail: String,
    pub packet_blake3_hex: String,
}

#[derive(Debug, Clone)]
pub struct BatchValidationSummary {
    pub input_batch_blake3: String,
    pub total_records: usize,
    pub accepted_count: usize,
    pub rejected_count: usize,
    pub idempotent_duplicate_count: usize,
    pub entries: Vec<BatchValidationEntry>,
}

pub fn validate_airlock_batch(
    batch_content: &str,
    manifest: &AirlockSourceManifest,
) -> Result<BatchValidationSummary, String> {
    let input_batch_blake3 = blake3_hex(batch_content.as_bytes());
    let raw_records = split_airlock_batch_records(batch_content)?;
    let mut entries = Vec::with_capacity(raw_records.len());
    let mut seen_seq: Vec<(String, u64, String)> = Vec::new();
    let mut accepted_count = 0usize;
    let mut rejected_count = 0usize;
    let mut idempotent_duplicate_count = 0usize;

    for (idx, raw_rec) in raw_records.iter().enumerate() {
        let pkt_hash = blake3_hex(raw_rec.as_bytes());
        match verify_airlock_packet_str(raw_rec, manifest) {
            Ok(ev) => {
                if let Some((_, _, prev_hash)) = seen_seq
                    .iter()
                    .find(|(s, seq, _)| s == &ev.source_id && *seq == ev.seq_no)
                {
                    if prev_hash.eq_ignore_ascii_case(&ev.payload_blake3_hex) {
                        idempotent_duplicate_count += 1;
                        accepted_count += 1;
                        entries.push(BatchValidationEntry {
                            index: idx,
                            accepted: true,
                            event_id: ev.event_id,
                            source_id: ev.source_id,
                            key_id: ev.key_id,
                            seq_no: ev.seq_no,
                            learned_at_ms: Some(ev.learned_at_ms),
                            epistemic_status: Some(ev.epistemic_status),
                            error_code: None,
                            detail: "IDEMPOTENT_DUPLICATE".to_owned(),
                            packet_blake3_hex: pkt_hash,
                        });
                    } else {
                        rejected_count += 1;
                        entries.push(BatchValidationEntry {
                            index: idx,
                            accepted: false,
                            event_id: ev.event_id,
                            source_id: ev.source_id,
                            key_id: ev.key_id,
                            seq_no: ev.seq_no,
                            learned_at_ms: Some(ev.learned_at_ms),
                            epistemic_status: Some(ev.epistemic_status),
                            error_code: Some(AirlockErrorCode::ErrSourceEquivocation),
                            detail: "SOURCE_EQUIVOCATION: duplicate (source_id, seq_no) with conflicting payload_blake3".to_owned(),
                            packet_blake3_hex: pkt_hash,
                        });
                    }
                } else {
                    seen_seq.push((
                        ev.source_id.clone(),
                        ev.seq_no,
                        ev.payload_blake3_hex.clone(),
                    ));
                    accepted_count += 1;
                    entries.push(BatchValidationEntry {
                        index: idx,
                        accepted: true,
                        event_id: ev.event_id,
                        source_id: ev.source_id,
                        key_id: ev.key_id,
                        seq_no: ev.seq_no,
                        learned_at_ms: Some(ev.learned_at_ms),
                        epistemic_status: Some(ev.epistemic_status),
                        error_code: None,
                        detail: "ACCEPTED".to_owned(),
                        packet_blake3_hex: pkt_hash,
                    });
                }
            }
            Err(rej) => {
                rejected_count += 1;
                entries.push(BatchValidationEntry {
                    index: idx,
                    accepted: false,
                    event_id: rej.event_id,
                    source_id: rej.source_id,
                    key_id: rej.key_id,
                    seq_no: rej.seq_no,
                    learned_at_ms: None,
                    epistemic_status: None,
                    error_code: Some(rej.code),
                    detail: rej.detail,
                    packet_blake3_hex: rej.packet_blake3_hex,
                });
            }
        }
    }

    Ok(BatchValidationSummary {
        input_batch_blake3,
        total_records: raw_records.len(),
        accepted_count,
        rejected_count,
        idempotent_duplicate_count,
        entries,
    })
}

#[derive(Debug, Clone)]
pub struct StaleSourceAlert {
    pub source_id: String,
    pub latest_observed_at_ms: i64,
    pub age_ms: i64,
    pub max_staleness_ms: i64,
}

#[derive(Debug, Clone)]
pub struct HostSliceEvaluationOutcome {
    pub input_batch_blake3: String,
    pub state_blake3: String,
    pub engine_version: String,
    pub binary_search_used: bool,
    pub candidate_records_scanned: usize,
    pub rejected_in_slice: Vec<AirlockRejectionDetail>,
    pub downgraded_sources: Vec<String>,
    pub stale_sources: Vec<StaleSourceAlert>,
    pub world_12_risk_band_fp: (i64, i64),
    pub event_metrics: BTreeMap<String, BTreeMap<String, String>>,
    pub report: SliceEvaluationReport,
    pub audit_chain_head_hex: Option<String>,
    pub audit_signer_pubkey_hex: Option<String>,
}

/// Deterministic 12-world fixed-point (`FP_SCALE = 1_000_000`) risk band `(p50, p95)`
/// seeded from `0xCAE105DEADBEEF00` with zero floats (`i128` intermediate math only).
pub fn compute_world_12_risk_band_fp(
    report: &SliceEvaluationReport,
    event_metrics: &BTreeMap<String, BTreeMap<String, String>>,
) -> (i64, i64) {
    const SEED: u64 = 0xCAE1_05DE_ADBE_EF00;
    let base_fp = report.max_assumption_fp.unwrap_or(0).max(0);
    let min_fp = report.min_assumption_fp.unwrap_or(base_fp).max(0);
    let conflict_spread = base_fp.saturating_sub(min_fp);

    let mut max_wave_fp: i64 = 0;
    for act in &report.active_assertions {
        if let Some(mmap) = event_metrics.get(&act.event_id) {
            if let Some(ws) = mmap.get("wave_m_fp").or_else(|| mmap.get("wave_p95_m_fp")) {
                if let Some(wv) = parse_i64_decimal_ascii(ws) {
                    if wv > max_wave_fp {
                        max_wave_fp = wv;
                    }
                }
            }
        } else if act.metric_key == "wave_m_fp" && act.fp_val > max_wave_fp {
            max_wave_fp = act.fp_val;
        }
    }

    let friction_component = report.causal_snapshot.clamped_friction_fp.max(0);
    let mut worlds = [0i64; 12];
    for (w_idx, slot) in worlds.iter_mut().enumerate() {
        let mut x = SEED ^ ((w_idx as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15))
            ^ report.deterministic_state_fnv64;
        x ^= x >> 30;
        x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        x ^= x >> 27;
        x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
        x ^= x >> 31;

        // Deterministic ensemble factor in [900_000 .. 1_340_000] (0.90x .. 1.34x in FP_SCALE)
        let jitter_ppm: i128 = 900_000 + ((w_idx as i128) * 40_000) + ((x % 15_001) as i128);
        let delay_term = ((base_fp as i128) * jitter_ppm) / (AIRLOCK_FP_SCALE as i128);
        let wave_term = ((max_wave_fp as i128) * (3 + (w_idx as i128 / 3))) / 2;
        let conflict_term = ((conflict_spread as i128) * (w_idx as i128 + 1)) / 12;
        let total = delay_term
            .saturating_add(wave_term)
            .saturating_add(conflict_term)
            .saturating_add((friction_component as i128) / 2);
        let clamped = total.clamp(0, (1i128 << 62) - 1) as i64;
        *slot = clamped;
    }
    worlds.sort_unstable();
    // 12 sorted worlds: p50 = midpoint of world[5] & world[6], p95 = world[11]
    let p50 = ((worlds[5] as i128 + worlds[6] as i128) / 2) as i64;
    let p95 = worlds[11];
    (p50, p95)
}

fn compute_stale_sources(
    manifest: &AirlockSourceManifest,
    report: &SliceEvaluationReport,
    cutoff_learned_at_ms: i64,
) -> Vec<StaleSourceAlert> {
    let mut latest_by_source: BTreeMap<String, i64> = BTreeMap::new();
    for rec in &report.preserved_records {
        let entry = latest_by_source
            .entry(rec.source_id.clone())
            .or_insert(rec.observed_at_ms);
        if rec.observed_at_ms > *entry {
            *entry = rec.observed_at_ms;
        }
    }
    let mut alerts = Vec::new();
    for src in &manifest.sources {
        if let Some(max_stale) = src.max_staleness_ms {
            if let Some(&obs_ms) = latest_by_source.get(&src.source_id) {
                let age = cutoff_learned_at_ms.saturating_sub(obs_ms);
                if age > max_stale {
                    alerts.push(StaleSourceAlert {
                        source_id: src.source_id.clone(),
                        latest_observed_at_ms: obs_ms,
                        age_ms: age,
                        max_staleness_ms: max_stale,
                    });
                }
            }
        }
    }
    alerts
}

/// Evaluate a bi-temporal slice (`cutoff_learned_at_ms`) from a batch file content,
/// utilizing `O(log N)` `partition_point` binary search when sorted by `learned_at_ms` (§5),
/// rejecting invalid packets fail-closed (`0`-bit state impact), and optionally sealing an audit log.
pub fn evaluate_airlock_batch_slice(
    batch_content: &str,
    manifest: &AirlockSourceManifest,
    mut policy: SlicePolicy,
    cutoff_learned_at_ms: i64,
    audit_log_path: Option<&str>,
    audit_seed: Option<[u8; 32]>,
    audit_session_id: u64,
    det_virtual_clock: bool,
) -> Result<HostSliceEvaluationOutcome, String> {
    let input_batch_blake3 = blake3_hex(batch_content.as_bytes());
    let raw_records = split_airlock_batch_records(batch_content)?;
    policy.require_v2_airlock = manifest.require_v2_airlock;

    // §5: Check if all records carry monotonically non-decreasing `learned_at_ms` hints.
    // If so, narrow via O(log N) `partition_point` binary search!
    let mut hints: Vec<i64> = Vec::with_capacity(raw_records.len());
    let mut all_hinted_and_sorted = !raw_records.is_empty();
    for rec in &raw_records {
        match peek_ndjson_learned_at_ms(rec) {
            Some(ts) => {
                if let Some(&prev) = hints.last() {
                    if ts < prev {
                        all_hinted_and_sorted = false;
                        break;
                    }
                }
                hints.push(ts);
            }
            None => {
                all_hinted_and_sorted = false;
                break;
            }
        }
    }

    let candidate_slice: &[String] = if all_hinted_and_sorted {
        let upper = hints.partition_point(|&ts| ts <= cutoff_learned_at_ms);
        &raw_records[..upper]
    } else {
        &raw_records[..]
    };

    if det_virtual_clock {
        crate::network::discovery::caelus_clock_set_virtual(0);
    }

    let mut audit_opt = match audit_log_path {
        Some(path) => {
            let identity = match audit_seed {
                Some(seed) => DeviceIdentity::from_seed_bytes(&seed),
                None => DeviceIdentity::generate(),
            };
            let mut log = CaelusAuditLog::open(path, Arc::new(identity), audit_session_id)
                .map_err(|e| format!("failed to open audit log {:?}: {}", path, e))?;
            if !log.append_session_start(&policy.scenario_id, det_virtual_clock) {
                return Err("failed to append SESSION_START to audit log".to_owned());
            }
            Some(log)
        }
        None => None,
    };

    let mut session = AirlockHostSession::new(
        manifest.clone(),
        policy.clone(),
        cutoff_learned_at_ms,
        audit_opt.take(),
    )?;

    let mut rejected_in_slice = Vec::new();
    let mut event_metrics: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    for rec in candidate_slice {
        match session.ingest_packet(rec) {
            Ok(()) => {
                if let Some((ev_id, mmap)) = extract_v2_payload_metrics(rec) {
                    event_metrics.insert(ev_id, mmap);
                }
            }
            Err(rej) => {
                rejected_in_slice.push(rej);
            }
        }
    }

    let report = session.report().clone();
    let state_blake3 = session.state_blake3().to_owned();
    let downgraded_sources = session.downgraded_sources().to_vec();
    let stale_sources = compute_stale_sources(manifest, &report, cutoff_learned_at_ms);
    let world_12_risk_band_fp = compute_world_12_risk_band_fp(&report, &event_metrics);
    let mut audit_back = session.into_audit_log();

    let mut audit_chain_head_hex = None;
    let mut audit_signer_pubkey_hex = None;
    if let Some(mut log) = audit_back.take() {
        let _ = log.append_slice_evaluation(
            &input_batch_blake3,
            cutoff_learned_at_ms,
            &policy.scenario_id,
            &policy.policy_id,
            CAELUS_AIRLOCK_ENGINE_VERSION,
            report.verdict.as_str(),
            &report.applied_rule_id,
            &state_blake3,
            report.conflict_detected,
        );
        let _ = log.append_session_end(&policy.scenario_id);
        let _ = log.seal();
        audit_chain_head_hex = Some(encode_hex_lower(log.chain_head()));
        audit_signer_pubkey_hex = Some(log.signer_pubkey_hex());
    }

    if det_virtual_clock {
        crate::network::discovery::caelus_clock_use_real();
    }

    Ok(HostSliceEvaluationOutcome {
        input_batch_blake3,
        state_blake3,
        engine_version: CAELUS_AIRLOCK_ENGINE_VERSION.to_owned(),
        binary_search_used: all_hinted_and_sorted,
        candidate_records_scanned: candidate_slice.len(),
        rejected_in_slice,
        downgraded_sources,
        stale_sources,
        world_12_risk_band_fp,
        event_metrics,
        report,
        audit_chain_head_hex,
        audit_signer_pubkey_hex,
    })
}

/// Format `BatchValidationSummary` as canonical JSON with all 64-bit integers as decimal ASCII strings.
pub fn format_validation_summary_json(summary: &BatchValidationSummary) -> String {
    let mut items_json = String::new();
    let mut rejected_short_json = String::new();
    let mut rej_idx = 0usize;
    for (idx, e) in summary.entries.iter().enumerate() {
        if idx > 0 {
            items_json.push(',');
        }
        let learned_json = match e.learned_at_ms {
            Some(v) => format!("\"{}\"", format_i64_decimal_ascii(v)),
            None => "null".to_owned(),
        };
        let ep_json = match e.epistemic_status {
            Some(st) => format!("\"{}\"", st.as_str()),
            None => "null".to_owned(),
        };
        let err_json = match e.error_code {
            Some(c) => format!("\"{}\"", c.as_str()),
            None => "null".to_owned(),
        };
        let _ = write!(
            items_json,
            "{{\"index\":{},\"accepted\":{},\"event_id\":\"{}\",\"source_id\":\"{}\",\"key_id\":\"{}\",\"seq_no\":\"{}\",\"learned_at_ms\":{},\"epistemic_status\":{},\"error_code\":{},\"detail\":\"{}\",\"packet_blake3\":\"{}\"}}",
            e.index,
            if e.accepted { "true" } else { "false" },
            escape_audit_json_str(&e.event_id),
            escape_audit_json_str(&e.source_id),
            escape_audit_json_str(&e.key_id),
            format_u64_decimal_ascii(e.seq_no),
            learned_json,
            ep_json,
            err_json,
            escape_audit_json_str(&e.detail),
            escape_audit_json_str(&e.packet_blake3_hex)
        );
        if !e.accepted {
            if rej_idx > 0 {
                rejected_short_json.push(',');
            }
            rej_idx += 1;
            let code_str = e.error_code.map(|c| c.as_str()).unwrap_or("ERR_UNKNOWN");
            let _ = write!(
                rejected_short_json,
                "{{\"line\":{},\"code\":\"{}\",\"source_id\":\"{}\",\"event_id\":\"{}\",\"detail\":\"{}\"}}",
                e.index + 1,
                code_str,
                escape_audit_json_str(&e.source_id),
                escape_audit_json_str(&e.event_id),
                escape_audit_json_str(&e.detail)
            );
        }
    }

    format!(
        "{{\"ok\":true,\"input_batch_blake3\":\"{}\",\"batch_blake3\":\"{}\",\"total_records\":{},\"accepted_count\":{},\"rejected_count\":{},\"idempotent_duplicate_count\":{},\"rejected\":[{}],\"records\":[{}]}}",
        escape_audit_json_str(&summary.input_batch_blake3),
        escape_audit_json_str(&summary.input_batch_blake3),
        summary.total_records,
        summary.accepted_count,
        summary.rejected_count,
        summary.idempotent_duplicate_count,
        rejected_short_json,
        items_json
    )
}

/// Format `HostSliceEvaluationOutcome` as canonical JSON with all 64-bit integers as decimal ASCII strings.
pub fn format_slice_outcome_json(outcome: &HostSliceEvaluationOutcome) -> String {
    let rep = &outcome.report;
    let min_fp_json = match rep.min_assumption_fp {
        Some(v) => format!("\"{}\"", format_i64_decimal_ascii(v)),
        None => "null".to_owned(),
    };
    let max_fp_json = match rep.max_assumption_fp {
        Some(v) => format!("\"{}\"", format_i64_decimal_ascii(v)),
        None => "null".to_owned(),
    };

    let mut active_json = String::new();
    for (i, a) in rep.active_assertions.iter().enumerate() {
        if i > 0 {
            active_json.push(',');
        }
        let sup_json = match &a.supersedes_event_id {
            Some(s) => format!("\"{}\"", escape_audit_json_str(s)),
            None => "null".to_owned(),
        };
        let _ = write!(
            active_json,
            "{{\"event_id\":\"{}\",\"source_id\":\"{}\",\"key_id\":\"{}\",\"independence_group\":\"{}\",\"event_kind\":\"{}\",\"seq_no\":\"{}\",\"observed_at_ms\":\"{}\",\"learned_at_ms\":\"{}\",\"epistemic_status\":\"{}\",\"subject_id\":\"{}\",\"metric_key\":\"{}\",\"fp_val\":\"{}\",\"unit\":\"{}\",\"supersedes_event_id\":{},\"note\":\"{}\"}}",
            escape_audit_json_str(&a.event_id),
            escape_audit_json_str(&a.source_id),
            escape_audit_json_str(&a.key_id),
            escape_audit_json_str(&a.independence_group),
            escape_audit_json_str(&a.event_kind),
            format_u64_decimal_ascii(a.seq_no),
            format_i64_decimal_ascii(a.observed_at_ms),
            format_i64_decimal_ascii(a.learned_at_ms),
            a.epistemic_status.as_str(),
            escape_audit_json_str(&a.subject_id),
            escape_audit_json_str(&a.metric_key),
            format_i64_decimal_ascii(a.fp_val),
            escape_audit_json_str(&a.unit),
            sup_json,
            escape_audit_json_str(&a.note)
        );
    }

    let mut preserved_json = String::new();
    for (i, p) in rep.preserved_records.iter().enumerate() {
        if i > 0 {
            preserved_json.push(',');
        }
        let sup_by_json = match &p.superseded_by_event_id {
            Some(s) => format!("\"{}\"", escape_audit_json_str(s)),
            None => "null".to_owned(),
        };
        let _ = write!(
            preserved_json,
            "{{\"event_id\":\"{}\",\"source_id\":\"{}\",\"seq_no\":\"{}\",\"observed_at_ms\":\"{}\",\"learned_at_ms\":\"{}\",\"epistemic_status\":\"{}\",\"fp_val\":\"{}\",\"superseded_by_event_id\":{}}}",
            escape_audit_json_str(&p.event_id),
            escape_audit_json_str(&p.source_id),
            format_u64_decimal_ascii(p.seq_no),
            format_i64_decimal_ascii(p.observed_at_ms),
            format_i64_decimal_ascii(p.learned_at_ms),
            p.epistemic_status.as_str(),
            format_i64_decimal_ascii(p.fp_val),
            sup_by_json
        );
    }

    let mut conflicts_json = String::new();
    for (i, c) in rep.conflicts.iter().enumerate() {
        if i > 0 {
            conflicts_json.push(',');
        }
        let srcs: Vec<String> = c
            .source_ids
            .iter()
            .map(|s| format!("\"{}\"", escape_audit_json_str(s)))
            .collect();
        let evs: Vec<String> = c
            .event_ids
            .iter()
            .map(|s| format!("\"{}\"", escape_audit_json_str(s)))
            .collect();
        let _ = write!(
            conflicts_json,
            "{{\"subject_id\":\"{}\",\"metric_key\":\"{}\",\"unit\":\"{}\",\"min_fp_val\":\"{}\",\"max_fp_val\":\"{}\",\"source_ids\":[{}],\"event_ids\":[{}],\"resolved_by_calibrated_observation_breach\":{}}}",
            escape_audit_json_str(&c.subject_id),
            escape_audit_json_str(&c.metric_key),
            escape_audit_json_str(&c.unit),
            format_i64_decimal_ascii(c.min_fp_val),
            format_i64_decimal_ascii(c.max_fp_val),
            srcs.join(","),
            evs.join(","),
            if c.resolved_by_calibrated_observation_breach {
                "true"
            } else {
                "false"
            }
        );
    }

    let mut rejected_json = String::new();
    for (i, r) in outcome.rejected_in_slice.iter().enumerate() {
        if i > 0 {
            rejected_json.push(',');
        }
        let _ = write!(
            rejected_json,
            "{{\"error_code\":\"{}\",\"audit_record_type\":\"{}\",\"source_id\":\"{}\",\"key_id\":\"{}\",\"event_id\":\"{}\",\"seq_no\":\"{}\",\"packet_blake3\":\"{}\",\"detail\":\"{}\"}}",
            r.code.as_str(),
            r.code.audit_record_type(),
            escape_audit_json_str(&r.source_id),
            escape_audit_json_str(&r.key_id),
            escape_audit_json_str(&r.event_id),
            format_u64_decimal_ascii(r.seq_no),
            escape_audit_json_str(&r.packet_blake3_hex),
            escape_audit_json_str(&r.detail)
        );
    }

    let mut stale_json = String::new();
    for (i, st) in outcome.stale_sources.iter().enumerate() {
        if i > 0 {
            stale_json.push(',');
        }
        let _ = write!(
            stale_json,
            "{{\"source_id\":\"{}\",\"latest_observed_at_ms\":\"{}\",\"age_ms\":\"{}\",\"max_staleness_ms\":\"{}\"}}",
            escape_audit_json_str(&st.source_id),
            format_i64_decimal_ascii(st.latest_observed_at_ms),
            format_i64_decimal_ascii(st.age_ms),
            format_i64_decimal_ascii(st.max_staleness_ms)
        );
    }

    let mut ev_metrics_json = String::new();
    for (i, (ev_id, mmap)) in outcome.event_metrics.iter().enumerate() {
        if i > 0 {
            ev_metrics_json.push(',');
        }
        let mut inner = String::new();
        for (j, (mk, mv)) in mmap.iter().enumerate() {
            if j > 0 {
                inner.push(',');
            }
            let _ = write!(
                inner,
                "\"{}\":\"{}\"",
                escape_audit_json_str(mk),
                escape_audit_json_str(mv)
            );
        }
        let _ = write!(
            ev_metrics_json,
            "\"{}\":{{{}}}",
            escape_audit_json_str(ev_id),
            inner
        );
    }

    let groups_json: Vec<String> = rep
        .corroborated_groups
        .iter()
        .map(|g| format!("\"{}\"", escape_audit_json_str(g)))
        .collect();
    let missing_json: Vec<String> = rep
        .missing_evidence
        .iter()
        .map(|m| format!("\"{}\"", escape_audit_json_str(m)))
        .collect();
    let downgraded_json: Vec<String> = outcome
        .downgraded_sources
        .iter()
        .map(|s| format!("\"{}\"", escape_audit_json_str(s)))
        .collect();

    let chain_json = match &outcome.audit_chain_head_hex {
        Some(h) => format!("\"{}\"", escape_audit_json_str(h)),
        None => "null".to_owned(),
    };
    let signer_json = match &outcome.audit_signer_pubkey_hex {
        Some(h) => format!("\"{}\"", escape_audit_json_str(h)),
        None => "null".to_owned(),
    };

    let cs = &rep.causal_snapshot;
    let verdict_scope_statement = if rep.verdict == SliceVerdict::Gecti {
        format!(
            "Belirtilen input_batch_blake3={}, cutoff_ts={}, scenario_id={} ve policy_id={} altinda kural ihlali saptanmadi; operasyon sistemlerine yazma yetkisi yoktur, son karar insan onayindadir.",
            outcome.input_batch_blake3,
            format_i64_decimal_ascii(rep.cutoff_learned_at_ms),
            rep.scenario_id,
            rep.policy_id
        )
    } else {
        format!(
            "Salt-okunur pilot degerlendirmesi ({}); son karar insan onayindadir.",
            rep.verdict.as_str()
        )
    };

    let missing_str = missing_json.join(",");
    let (w_p50, w_p95) = outcome.world_12_risk_band_fp;

    format!(
        "{{\"ok\":true,\"verdict\":\"{}\",\"applied_rule_id\":\"{}\",\"scenario_id\":\"{}\",\"policy_id\":\"{}\",\"engine_version\":\"{}\",\"input_batch_blake3\":\"{}\",\"cutoff_learned_at_ms\":\"{}\",\"state_blake3\":\"{}\",\"deterministic_state_fnv64\":\"{}\",\"binary_search_used\":{},\"candidate_records_scanned\":{},\"conflict_detected\":{},\"legacy_unscoped_present\":{},\"assumption_range_fp\":[{},{}],\"world_12_risk_band_fp\":{{\"p50\":\"{}\",\"p95\":\"{}\"}},\"corroborated_groups\":[{}],\"missing_evidence\":[{}],\"missing_corroborations\":[{}],\"downgraded_sources\":[{}],\"stale_sources\":[{}],\"active_assertions\":[{}],\"preserved_records\":[{}],\"conflicts\":[{}],\"active_conflicts\":[{}],\"rejected_in_slice\":[{}],\"event_metrics\":{{{}}},\"causal_snapshot\":{{\"tick\":\"{}\",\"raw_friction_fp\":\"{}\",\"clamped_friction_fp\":\"{}\",\"throughput_ratio_fp\":\"{}\",\"regime_exceeded\":{},\"any_hysteresis_flip\":{},\"any_deadline_missed\":{},\"outage_active\":{}}},\"audit_chain_head\":{},\"audit_signer_pubkey\":{},\"human_approval_required\":true,\"write_authority\":\"NONE\",\"scope_statement\":\"{}\"}}",
        rep.verdict.as_str(),
        escape_audit_json_str(&rep.applied_rule_id),
        escape_audit_json_str(&rep.scenario_id),
        escape_audit_json_str(&rep.policy_id),
        escape_audit_json_str(&outcome.engine_version),
        escape_audit_json_str(&outcome.input_batch_blake3),
        format_i64_decimal_ascii(rep.cutoff_learned_at_ms),
        escape_audit_json_str(&outcome.state_blake3),
        format_u64_decimal_ascii(rep.deterministic_state_fnv64),
        if outcome.binary_search_used { "true" } else { "false" },
        outcome.candidate_records_scanned,
        if rep.conflict_detected { "true" } else { "false" },
        if rep.legacy_unscoped_present { "true" } else { "false" },
        min_fp_json,
        max_fp_json,
        format_i64_decimal_ascii(w_p50),
        format_i64_decimal_ascii(w_p95),
        groups_json.join(","),
        missing_str,
        missing_str,
        downgraded_json.join(","),
        stale_json,
        active_json,
        preserved_json,
        conflicts_json,
        conflicts_json,
        rejected_json,
        ev_metrics_json,
        format_u64_decimal_ascii(cs.tick),
        format_i64_decimal_ascii(cs.raw_friction_fp),
        format_i64_decimal_ascii(cs.clamped_friction_fp),
        format_i64_decimal_ascii(cs.throughput_ratio_fp),
        if cs.regime_exceeded { "true" } else { "false" },
        if cs.any_hysteresis_flip { "true" } else { "false" },
        if cs.any_deadline_missed { "true" } else { "false" },
        if cs.outage_active { "true" } else { "false" },
        chain_json,
        signer_json,
        escape_audit_json_str(&verdict_scope_statement)
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Counterfactual Branching (`caelus_run_counterfactual_branch` — §3.1)
// & Operator Ed25519 Action Card Sealing (`CAELUS_AG_UI_V1` — §3.2)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct CounterfactualIntervention {
    pub target_id: String,
    pub override_field: String,
    pub fp_val: i64,
}

#[derive(Debug, Clone)]
pub struct CounterfactualBranchOutcome {
    pub branch_id: String,
    pub base_cutoff_ms: i64,
    pub base_verdict: SliceVerdict,
    pub branch_verdict: SliceVerdict,
    pub base_state_blake3: String,
    pub branch_state_blake3: String,
    pub delta_delay_min_fp: i64,
    pub delta_risk_fp: i64,
    pub applied_interventions: usize,
    pub branch_report: SliceEvaluationReport,
}

pub fn evaluate_counterfactual_branch(
    batch_content: &str,
    manifest: &AirlockSourceManifest,
    mut policy: SlicePolicy,
    base_cutoff_ms: i64,
    branch_id: &str,
    interventions: &[CounterfactualIntervention],
) -> Result<CounterfactualBranchOutcome, String> {
    if interventions.is_empty() {
        return Err("interventions must contain at least one intervention".to_owned());
    }
    for iv in interventions {
        if iv.target_id.is_empty() || iv.override_field.is_empty() {
            return Err("intervention target_id and override_field must be non-empty".to_owned());
        }
        if !is_within_airlock_safe_fp_range(iv.fp_val) {
            return Err("intervention fp_val exceeds Z3 safe domain 2^62".to_owned());
        }
    }

    policy.require_v2_airlock = manifest.require_v2_airlock;
    let raw_records = split_airlock_batch_records(batch_content)?;
    let mut session = AirlockHostSession::new(manifest.clone(), policy.clone(), base_cutoff_ms, None)?;
    let mut event_metrics: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    for rec in &raw_records {
        if session.ingest_packet(rec).is_ok() {
            if let Some((ev_id, mmap)) = extract_v2_payload_metrics(rec) {
                event_metrics.insert(ev_id, mmap);
            }
        }
    }

    let base_report = session.report().clone();
    let base_state_blake3 = session.state_blake3().to_owned();
    let (_, base_p95) = compute_world_12_risk_band_fp(&base_report, &event_metrics);
    let base_delay_fp = base_report.max_assumption_fp.unwrap_or(0);

    let mut branch_events = session.accepted.clone();
    let mut branch_metrics = event_metrics.clone();
    let mut applied = 0usize;

    for iv in interventions {
        let field_lower = iv.override_field.to_ascii_lowercase();
        let target_upper = iv.target_id.to_ascii_uppercase();

        if field_lower == "disable" || (field_lower == "enabled" && iv.fp_val == 0) {
            let before = branch_events.len();
            branch_events.retain(|ev| {
                ev.event_id != iv.target_id
                    && ev.source_id != iv.target_id
                    && ev.subject_id != iv.target_id
            });
            if branch_events.len() != before {
                applied += 1;
            }
        } else if target_upper.starts_with("BERTH") {
            // Operational berth reallocation (e.g. BERTH_02 / BERTH_B status=0 clear standby berth):
            // deterministically relieves ramp queuing delay above nominal turnaround on corridor sensors.
            let relief_fp: i64 = if iv.fp_val > 0 { iv.fp_val } else { 18_000_000 };
            for ev in &mut branch_events {
                if ev.learned_at_ms <= base_cutoff_ms
                    && (ev.metric_key == "delay_min_fp"
                        || ev.metric_key == "departure_delay_min"
                        || ev.metric_key == "departure_delay")
                    && ev.fp_val > policy.max_allowed_fp
                {
                    let next = if iv.fp_val > 0 && field_lower == "delay_min_fp" {
                        iv.fp_val
                    } else {
                        (ev.fp_val - relief_fp).max(8_000_000)
                    };
                    ev.fp_val = next;
                    if let Some(mmap) = branch_metrics.get_mut(&ev.event_id) {
                        if mmap.contains_key("delay_min_fp") {
                            mmap.insert(
                                "delay_min_fp".to_owned(),
                                format_i64_decimal_ascii(next),
                            );
                        }
                        if let Some(ws) = mmap.get("wave_p95_m_fp").cloned() {
                            if let Some(wv) = parse_i64_decimal_ascii(&ws) {
                                let sheltered = (wv - 450_000).max(500_000);
                                mmap.insert(
                                    "wave_p95_m_fp".to_owned(),
                                    format_i64_decimal_ascii(sheltered),
                                );
                            }
                        }
                    }
                }
            }
            applied += 1;
        } else if target_upper.starts_with("ROUTE") || field_lower == "route_shelter_corridor" {
            // South Samos wave-shelter corridor: reduces wave exposure and excess schedule variance.
            let relief_fp: i64 = if iv.fp_val > 0 { iv.fp_val } else { 16_000_000 };
            for ev in &mut branch_events {
                if ev.learned_at_ms <= base_cutoff_ms {
                    if (ev.metric_key == "delay_min_fp"
                        || ev.metric_key == "departure_delay_min"
                        || ev.metric_key == "departure_delay")
                        && ev.fp_val > policy.max_allowed_fp
                    {
                        ev.fp_val = (ev.fp_val - relief_fp).max(10_000_000);
                    } else if ev.metric_key == "wave_m_fp" {
                        ev.fp_val = (ev.fp_val - 750_000).max(500_000);
                    }
                }
                if let Some(mmap) = branch_metrics.get_mut(&ev.event_id) {
                    if let Some(ws) = mmap.get("wave_m_fp").cloned() {
                        if let Some(wv) = parse_i64_decimal_ascii(&ws) {
                            let lowered = (wv - 750_000).max(500_000);
                            mmap.insert("wave_m_fp".to_owned(), format_i64_decimal_ascii(lowered));
                        }
                    }
                    if let Some(ws95) = mmap.get("wave_p95_m_fp").cloned() {
                        if let Some(wv95) = parse_i64_decimal_ascii(&ws95) {
                            let lowered95 = (wv95 - 850_000).max(500_000);
                            mmap.insert(
                                "wave_p95_m_fp".to_owned(),
                                format_i64_decimal_ascii(lowered95),
                            );
                        }
                    }
                }
            }
            applied += 1;
        } else {
            let mut matched = false;
            for ev in &mut branch_events {
                if ev.event_id == iv.target_id
                    || ev.source_id == iv.target_id
                    || ev.subject_id == iv.target_id
                {
                    if field_lower == "delta_fp" {
                        let candidate = ev.fp_val.saturating_add(iv.fp_val);
                        if is_within_airlock_safe_fp_range(candidate) {
                            ev.fp_val = candidate;
                        }
                    } else {
                        ev.fp_val = iv.fp_val;
                    }
                    matched = true;
                }
            }
            if matched {
                applied += 1;
            }
        }
    }

    let branch_report = ingest_verified_slice(&branch_events, base_cutoff_ms, &policy)
        .map_err(|e| format!("counterfactual slice error: {} ({})", e.code.as_str(), e.detail))?;
    let branch_state_blake3 = compute_slice_state_blake3(&branch_report);
    let (_, branch_p95) = compute_world_12_risk_band_fp(&branch_report, &branch_metrics);
    let branch_delay_fp = branch_report.max_assumption_fp.unwrap_or(0);

    Ok(CounterfactualBranchOutcome {
        branch_id: if branch_id.is_empty() {
            "cf_01".to_owned()
        } else {
            branch_id.to_owned()
        },
        base_cutoff_ms,
        base_verdict: base_report.verdict,
        branch_verdict: branch_report.verdict,
        base_state_blake3,
        branch_state_blake3,
        delta_delay_min_fp: branch_delay_fp.saturating_sub(base_delay_fp),
        delta_risk_fp: branch_p95.saturating_sub(base_p95),
        applied_interventions: applied,
        branch_report,
    })
}

pub fn format_counterfactual_outcome_json(cf: &CounterfactualBranchOutcome) -> String {
    format!(
        "{{\"ok\":true,\"branch_id\":\"{}\",\"base_cutoff_ms\":\"{}\",\"base_verdict\":\"{}\",\"branch_verdict\":\"{}\",\"delta_delay_min_fp\":\"{}\",\"delta_risk_fp\":\"{}\",\"base_state_blake3\":\"{}\",\"branch_state_blake3\":\"{}\",\"applied_interventions\":{},\"branch_applied_rule_id\":\"{}\",\"human_approval_required\":true,\"write_authority\":\"NONE\"}}",
        escape_audit_json_str(&cf.branch_id),
        format_i64_decimal_ascii(cf.base_cutoff_ms),
        cf.base_verdict.as_str(),
        cf.branch_verdict.as_str(),
        format_i64_decimal_ascii(cf.delta_delay_min_fp),
        format_i64_decimal_ascii(cf.delta_risk_fp),
        escape_audit_json_str(&cf.base_state_blake3),
        escape_audit_json_str(&cf.branch_state_blake3),
        cf.applied_interventions,
        escape_audit_json_str(&cf.branch_report.applied_rule_id)
    )
}

pub const ACTION_CARD_APPROVAL_CTX: &str = "CAELUS_ACTION_CARD_APPROVAL_V1\n";

pub fn build_operator_action_card_signing_payload(
    card_id: &str,
    scenario_id: &str,
    verdict_context: &str,
    state_blake3: &str,
    branch_state_blake3: &str,
    approved_at_ms: i64,
) -> String {
    format!(
        "{}{}|{}|{}|{}|{}|{}",
        ACTION_CARD_APPROVAL_CTX,
        card_id,
        scenario_id,
        verdict_context,
        state_blake3,
        branch_state_blake3,
        format_i64_decimal_ascii(approved_at_ms)
    )
}

/// Verify an NDJSON `CaelusAuditLog` file's Blake3 chain and Ed25519 `SEAL` signatures (`CAELUS_AUDIT_SEAL_V1`).
pub fn verify_audit_chain_file(path: &str) -> Result<bool, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut current_session_id: Option<u64> = None;
    let mut current_head: Option<[u8; 32]> = None;
    let mut saw_seal = false;

    for line in raw.lines() {
        let l = line.trim();
        if l.is_empty() {
            continue;
        }
        let val = parse_strict_json(l)?;
        let obj = val.as_obj().ok_or_else(|| "audit line not object".to_owned())?;
        let rtype = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match rtype {
            "GENESIS" => {
                let sid_hex = obj
                    .get("session_id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "GENESIS missing session_id".to_owned())?;
                let sid = u64::from_str_radix(sid_hex, 16)
                    .map_err(|_| "invalid GENESIS session_id hex".to_owned())?;
                let hash_hex = obj
                    .get("hash")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "GENESIS missing hash".to_owned())?;
                let claimed = decode_hex_exact::<32>(hash_hex)
                    .ok_or_else(|| "invalid GENESIS hash".to_owned())?;
                let mut h = blake3::Hasher::new();
                h.update(b"CAELUS_AUDIT_GENESIS_V1");
                h.update(&sid.to_le_bytes());
                if let Some(seg) = obj.get("segment").and_then(|v| v.as_i128()) {
                    if let Some(prev_seg_hex) =
                        obj.get("prev_segment_chain_head").and_then(|v| v.as_str())
                    {
                        let prev_seg = decode_hex_exact::<32>(prev_seg_hex)
                            .ok_or_else(|| "invalid prev_segment_chain_head".to_owned())?;
                        h.update(&(seg as u64).to_le_bytes());
                        h.update(&prev_seg);
                    }
                }
                let expected = *h.finalize().as_bytes();
                if bool::from(!claimed.ct_eq(&expected)) {
                    return Ok(false);
                }
                current_session_id = Some(sid);
                current_head = Some(expected);
                saw_seal = false;
            }
            "EVENT" => {
                let prev_head = current_head.ok_or_else(|| "EVENT before GENESIS".to_owned())?;
                let prev_hex = obj.get("prev").and_then(|v| v.as_str()).unwrap_or("");
                let hash_hex = obj.get("hash").and_then(|v| v.as_str()).unwrap_or("");
                let prev_claimed = decode_hex_exact::<32>(prev_hex)
                    .ok_or_else(|| "invalid EVENT prev".to_owned())?;
                let hash_claimed = decode_hex_exact::<32>(hash_hex)
                    .ok_or_else(|| "invalid EVENT hash".to_owned())?;
                if bool::from(!prev_claimed.ct_eq(&prev_head)) {
                    return Ok(false);
                }
                let marker = "\"event\":";
                let pos = l
                    .find(marker)
                    .ok_or_else(|| "EVENT missing raw event span".to_owned())?;
                let after = &l[pos + marker.len()..];
                let ev_raw = after
                    .strip_suffix('}')
                    .ok_or_else(|| "malformed EVENT tail".to_owned())?;
                let mut h = blake3::Hasher::new();
                h.update(&prev_head);
                h.update(ev_raw.as_bytes());
                let expected = *h.finalize().as_bytes();
                if bool::from(!hash_claimed.ct_eq(&expected)) {
                    return Ok(false);
                }
                current_head = Some(expected);
            }
            "SEAL" => {
                let sid = current_session_id.ok_or_else(|| "SEAL before GENESIS".to_owned())?;
                let head = current_head.ok_or_else(|| "SEAL without head".to_owned())?;
                let seq = obj
                    .get("seq")
                    .and_then(|v| v.as_i128())
                    .ok_or_else(|| "SEAL missing seq".to_owned())? as u64;
                let head_hex = obj.get("chain_head").and_then(|v| v.as_str()).unwrap_or("");
                let pk_hex = obj.get("pubkey").and_then(|v| v.as_str()).unwrap_or("");
                let sig_hex = obj.get("sig").and_then(|v| v.as_str()).unwrap_or("");
                let claimed_head = decode_hex_exact::<32>(head_hex)
                    .ok_or_else(|| "invalid SEAL chain_head".to_owned())?;
                if bool::from(!claimed_head.ct_eq(&head)) {
                    return Ok(false);
                }
                let pk = decode_hex_exact::<32>(pk_hex)
                    .ok_or_else(|| "invalid SEAL pubkey".to_owned())?;
                let sig_b = decode_hex_exact::<64>(sig_hex)
                    .ok_or_else(|| "invalid SEAL sig".to_owned())?;
                let vk = VerifyingKey::from_bytes(&pk).map_err(|_| "bad SEAL vk".to_owned())?;
                let sig = Signature::from_bytes(&sig_b);
                let mut msg = Vec::with_capacity(68);
                msg.extend_from_slice(b"CAELUS_AUDIT_SEAL_V1");
                msg.extend_from_slice(&sid.to_le_bytes());
                msg.extend_from_slice(&seq.to_le_bytes());
                msg.extend_from_slice(&head);
                if vk.verify(&msg, &sig).is_err() {
                    return Ok(false);
                }
                saw_seal = true;
            }
            _ => {}
        }
    }
    Ok(saw_seal)
}

/// Verify an operator's `Ed25519` signature on a Human-in-the-Loop `ACTION_APPROVAL_CARD`
/// (or sign with `operator_seed_opt` if provided) and seal it into `CaelusAuditLog`.
#[allow(clippy::too_many_arguments)]
pub fn seal_operator_action_card_to_audit(
    audit_log_path: &str,
    card_id: &str,
    scenario_id: &str,
    verdict_context: &str,
    state_blake3: &str,
    branch_state_blake3: &str,
    approved_at_ms: i64,
    operator_pubkey_hex_opt: Option<&str>,
    operator_sig_hex_opt: Option<&str>,
    operator_seed_opt: Option<[u8; 32]>,
    audit_seed_opt: Option<[u8; 32]>,
    session_id: u64,
) -> Result<String, String> {
    if card_id.is_empty() || scenario_id.is_empty() || state_blake3.len() != 64 {
        return Err("card_id, scenario_id, and 64-hex state_blake3 are required".to_owned());
    }
    let msg = build_operator_action_card_signing_payload(
        card_id,
        scenario_id,
        verdict_context,
        state_blake3,
        branch_state_blake3,
        approved_at_ms,
    );

    let (op_pk_hex, op_sig_hex) = match (operator_pubkey_hex_opt, operator_sig_hex_opt) {
        (Some(pk_hex), Some(sig_hex)) if !pk_hex.is_empty() && !sig_hex.is_empty() => {
            let pk_bytes = decode_hex_exact::<32>(pk_hex)
                .ok_or_else(|| "operator_pubkey must be 64 hex chars".to_owned())?;
            let sig_bytes = decode_hex_exact::<64>(sig_hex)
                .ok_or_else(|| "operator_sig must be 128 hex chars".to_owned())?;
            let vk = VerifyingKey::from_bytes(&pk_bytes)
                .map_err(|_| "invalid operator Ed25519 pubkey".to_owned())?;
            let sig = Signature::from_bytes(&sig_bytes);
            vk.verify(msg.as_bytes(), &sig)
                .map_err(|_| "operator Ed25519 signature verification failed".to_owned())?;
            (pk_hex.to_ascii_lowercase(), sig_hex.to_ascii_lowercase())
        }
        _ => {
            let seed = operator_seed_opt
                .ok_or_else(|| "either (operator_pubkey, operator_sig) or operator_seed is required".to_owned())?;
            let sk = SigningKey::from_bytes(&seed);
            let vk = sk.verifying_key();
            let sig = sk.sign(msg.as_bytes());
            (
                encode_hex_lower(vk.as_bytes()),
                encode_hex_lower(&sig.to_bytes()),
            )
        }
    };

    let identity = match audit_seed_opt {
        Some(seed) => DeviceIdentity::from_seed_bytes(&seed),
        None => DeviceIdentity::generate(),
    };
    let mut log = CaelusAuditLog::open(audit_log_path, Arc::new(identity), session_id)
        .map_err(|e| format!("failed to open audit log {:?}: {}", audit_log_path, e))?;
    if !log.append_session_start(scenario_id, true) {
        return Err("failed to append SESSION_START".to_owned());
    }
    if !log.append_operator_action_approval(
        card_id,
        scenario_id,
        verdict_context,
        state_blake3,
        branch_state_blake3,
        &op_pk_hex,
        &op_sig_hex,
        approved_at_ms,
    ) {
        return Err("failed to append OPERATOR_ACTION_CARD_APPROVED".to_owned());
    }
    let _ = log.append_session_end(scenario_id);
    let _ = log.seal();
    let chain_head = encode_hex_lower(log.chain_head());
    let seal_signer = log.signer_pubkey_hex();
    let verified = verify_audit_chain_file(audit_log_path).unwrap_or(false);

    Ok(format!(
        "{{\"ok\":true,\"card_id\":\"{}\",\"scenario_id\":\"{}\",\"state_blake3\":\"{}\",\"branch_state_blake3\":\"{}\",\"approved_at_ms\":\"{}\",\"operator_pubkey\":\"{}\",\"operator_sig\":\"{}\",\"audit_log_path\":\"{}\",\"audit_chain_head\":\"{}\",\"seal_signer_pubkey\":\"{}\",\"audit_chain_verified\":{}}}",
        escape_audit_json_str(card_id),
        escape_audit_json_str(scenario_id),
        escape_audit_json_str(state_blake3),
        escape_audit_json_str(branch_state_blake3),
        format_i64_decimal_ascii(approved_at_ms),
        escape_audit_json_str(&op_pk_hex),
        escape_audit_json_str(&op_sig_hex),
        escape_audit_json_str(audit_log_path),
        escape_audit_json_str(&chain_head),
        escape_audit_json_str(&seal_signer),
        if verified { "true" } else { "false" }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_manifest_and_seeds() -> (AirlockSourceManifest, [u8; 32], [u8; 32], [u8; 32]) {
        let seed_ops = [0x11u8; 32];
        let seed_port = [0x22u8; 32];
        let seed_rogue = [0x99u8; 32];
        let pk_ops = encode_hex_lower(SigningKey::from_bytes(&seed_ops).verifying_key().as_bytes());
        let pk_port =
            encode_hex_lower(SigningKey::from_bytes(&seed_port).verifying_key().as_bytes());

        let json = format!(
            r#"{{
              "manifest_version": "2.0",
              "require_v2_airlock": true,
              "sources": [
                {{
                  "source_id": "ferry_ops",
                  "key_id": "ferry_ops_k1",
                  "pubkey": "{}",
                  "allowed_event_kinds": ["SCHEDULE_REPORT", "DELAY_NOTICE"],
                  "independence_group": "IG_FERRY_OPERATOR",
                  "origin_class": "HUMAN_OPERATOR",
                  "expires_at_ms": "1900000000000"
                }},
                {{
                  "source_id": "port_observer",
                  "key_id": "port_observer_k1",
                  "pubkey": "{}",
                  "allowed_event_kinds": ["BERTH_OCCUPANCY", "RAMP_OBSERVATION"],
                  "independence_group": "IG_PORT_INFRA",
                  "origin_class": "CALIBRATED_SENSOR",
                  "expires_at_ms": "1900000000000"
                }}
              ]
            }}"#,
            pk_ops, pk_port
        );
        let manifest = AirlockSourceManifest::parse_json(&json).expect("manifest parse");
        (manifest, seed_ops, seed_port, seed_rogue)
    }

    #[test]
    fn airlock_security_boundaries_preserve_state_blake3_bit_for_bit() {
        let (manifest, seed_ops, seed_port, seed_rogue) = test_manifest_and_seeds();
        let policy = SlicePolicy::default();
        let mut session =
            AirlockHostSession::new(manifest, policy, 1_762_849_500_000, None).unwrap();

        let p_ops = normalize_and_sign_v2_record(
            &RawSidecarInput {
                source_id: "ferry_ops".to_owned(),
                key_id: "ferry_ops_k1".to_owned(),
                event_kind: "DELAY_NOTICE".to_owned(),
                event_id: "EVT-OPS-1".to_owned(),
                seq_no: 1,
                observed_at_ms: 1_762_848_000_000,
                learned_at_ms: 1_762_848_300_000,
                origin_class: SourceOriginClass::HumanOperator,
                explicit_epistemic_status: Some(EpistemicStatus::Claim),
                subject_id: "VOYAGE_SIGACIK_VATHI_0800".to_owned(),
                metric_key: "departure_delay".to_owned(),
                raw_decimal_value: "15".to_owned(),
                unit: "minutes".to_owned(),
                conversion_rule_id: "NORM_MIN_FP1E6_V1".to_owned(),
                supersedes_event_id: None,
                note: "kalkis 15 dk gecikecek".to_owned(),
            },
            &seed_ops,
        )
        .unwrap();

        let p_port = normalize_and_sign_v2_record(
            &RawSidecarInput {
                source_id: "port_observer".to_owned(),
                key_id: "port_observer_k1".to_owned(),
                event_kind: "RAMP_OBSERVATION".to_owned(),
                event_id: "EVT-PORT-1".to_owned(),
                seq_no: 1,
                observed_at_ms: 1_762_848_120_000,
                learned_at_ms: 1_762_849_200_000,
                origin_class: SourceOriginClass::CalibratedSensor,
                explicit_epistemic_status: Some(EpistemicStatus::Observation),
                subject_id: "VOYAGE_SIGACIK_VATHI_0800".to_owned(),
                metric_key: "departure_delay".to_owned(),
                raw_decimal_value: "35".to_owned(),
                unit: "minutes".to_owned(),
                conversion_rule_id: "NORM_MIN_FP1E6_V1".to_owned(),
                supersedes_event_id: None,
                note: "rihtim rampasi arizasi +35 dk".to_owned(),
            },
            &seed_port,
        )
        .unwrap();

        session.ingest_packet(&p_ops.to_ndjson_line()).unwrap();
        session.ingest_packet(&p_port.to_ndjson_line()).unwrap();
        let baseline_state = session.state_blake3().to_owned();
        assert_eq!(session.report().verdict, SliceVerdict::KuralIhlali);

        // 1) 1-bit body tamper -> ERR_SIGNATURE_MISMATCH
        let tampered = p_ops.to_ndjson_line().replace("15000000", "16000000");
        let e1 = session.ingest_packet(&tampered).unwrap_err();
        assert_eq!(e1.code, AirlockErrorCode::ErrSignatureMismatch);
        assert_eq!(session.state_blake3(), baseline_state);

        // 2) Rogue signing key -> ERR_UNTRUSTED_SOURCE
        let rogue_pkt = normalize_and_sign_v2_record(
            &RawSidecarInput {
                source_id: "ferry_ops".to_owned(),
                key_id: "ferry_ops_k1".to_owned(),
                event_kind: "DELAY_NOTICE".to_owned(),
                event_id: "EVT-ROGUE".to_owned(),
                seq_no: 2,
                observed_at_ms: 1_762_848_200_000,
                learned_at_ms: 1_762_848_400_000,
                origin_class: SourceOriginClass::HumanOperator,
                explicit_epistemic_status: Some(EpistemicStatus::Claim),
                subject_id: "VOYAGE_SIGACIK_VATHI_0800".to_owned(),
                metric_key: "departure_delay".to_owned(),
                raw_decimal_value: "5".to_owned(),
                unit: "minutes".to_owned(),
                conversion_rule_id: "NORM_MIN_FP1E6_V1".to_owned(),
                supersedes_event_id: None,
                note: "rogue".to_owned(),
            },
            &seed_rogue,
        )
        .unwrap();
        let e2 = session.ingest_packet(&rogue_pkt.to_ndjson_line()).unwrap_err();
        assert_eq!(e2.code, AirlockErrorCode::ErrUntrustedSource);
        assert_eq!(session.state_blake3(), baseline_state);

        // 3) Unauthorized event_kind (`ferry_ops` sending `BERTH_OCCUPANCY`) -> ERR_UNAUTHORIZED_KIND
        let unauth_pkt = normalize_and_sign_v2_record(
            &RawSidecarInput {
                source_id: "ferry_ops".to_owned(),
                key_id: "ferry_ops_k1".to_owned(),
                event_kind: "BERTH_OCCUPANCY".to_owned(),
                event_id: "EVT-UNAUTH".to_owned(),
                seq_no: 2,
                observed_at_ms: 1_762_848_200_000,
                learned_at_ms: 1_762_848_400_000,
                origin_class: SourceOriginClass::HumanOperator,
                explicit_epistemic_status: Some(EpistemicStatus::Claim),
                subject_id: "VOYAGE_SIGACIK_VATHI_0800".to_owned(),
                metric_key: "departure_delay".to_owned(),
                raw_decimal_value: "5".to_owned(),
                unit: "minutes".to_owned(),
                conversion_rule_id: "NORM_MIN_FP1E6_V1".to_owned(),
                supersedes_event_id: None,
                note: "unauthorized kind".to_owned(),
            },
            &seed_ops,
        )
        .unwrap();
        let e3 = session
            .ingest_packet(&unauth_pkt.to_ndjson_line())
            .unwrap_err();
        assert_eq!(e3.code, AirlockErrorCode::ErrUnauthorizedKind);
        assert_eq!(session.state_blake3(), baseline_state);

        // 4) Signed v99 schema_version -> ERR_SCHEMA_OR_RANGE
        let msg_v99 = build_v2_signed_message(
            "99.0",
            &p_ops.header_line,
            &p_ops.canonical_payload_json,
        );
        let sk_ops = SigningKey::from_bytes(&seed_ops);
        let sig_v99 = encode_hex_lower(&sk_ops.sign(msg_v99.as_bytes()).to_bytes());
        let wire_v99 = format!(
            "#sig=ed25519:{}:{}\nCAELUS_INTEL_V2\n99.0\n{}\n{}",
            p_ops.pubkey_hex, sig_v99, p_ops.header_line, p_ops.canonical_payload_json
        );
        let e4 = session.ingest_packet(&wire_v99).unwrap_err();
        assert_eq!(e4.code, AirlockErrorCode::ErrSchemaOrRange);
        assert_eq!(session.state_blake3(), baseline_state);

        // 5) Signed > 2^62 fp_val -> ERR_SCHEMA_OR_RANGE
        let bad_payload = build_canonical_payload_json(
            "VOYAGE_SIGACIK_VATHI_0800",
            "departure_delay",
            0,
            "minutes",
            "NORM_MIN_FP1E6_V1",
            None,
            "overflow",
        )
        .replace("\"fp_val\":\"0\"", "\"fp_val\":\"4611686018427387905\"");
        let bad_hash = blake3_hex(bad_payload.as_bytes());
        let bad_hdr = build_v2_header_line(
            "ferry_ops",
            "ferry_ops_k1",
            "DELAY_NOTICE",
            "EVT-OVERFLOW",
            9,
            1_762_848_200_000,
            1_762_848_400_000,
            EpistemicStatus::Claim,
            &bad_hash,
        );
        let msg_ovf = build_v2_signed_message("2.0", &bad_hdr, &bad_payload);
        let sig_ovf = encode_hex_lower(&sk_ops.sign(msg_ovf.as_bytes()).to_bytes());
        let wire_ovf = format!(
            "#sig=ed25519:{}:{}\nCAELUS_INTEL_V2\n2.0\n{}\n{}",
            p_ops.pubkey_hex, sig_ovf, bad_hdr, bad_payload
        );
        let e5 = session.ingest_packet(&wire_ovf).unwrap_err();
        assert_eq!(e5.code, AirlockErrorCode::ErrSchemaOrRange);
        assert_eq!(session.state_blake3(), baseline_state);

        // 6) Equivocation on `(ferry_ops, seq_no=1)` -> ERR_SOURCE_EQUIVOCATION
        let equiv_pkt = normalize_and_sign_v2_record(
            &RawSidecarInput {
                source_id: "ferry_ops".to_owned(),
                key_id: "ferry_ops_k1".to_owned(),
                event_kind: "DELAY_NOTICE".to_owned(),
                event_id: "EVT-OPS-EQUIV".to_owned(),
                seq_no: 1,
                observed_at_ms: 1_762_848_000_000,
                learned_at_ms: 1_762_848_300_000,
                origin_class: SourceOriginClass::HumanOperator,
                explicit_epistemic_status: Some(EpistemicStatus::Claim),
                subject_id: "VOYAGE_SIGACIK_VATHI_0800".to_owned(),
                metric_key: "departure_delay".to_owned(),
                raw_decimal_value: "19".to_owned(),
                unit: "minutes".to_owned(),
                conversion_rule_id: "NORM_MIN_FP1E6_V1".to_owned(),
                supersedes_event_id: None,
                note: "equivocated".to_owned(),
            },
            &seed_ops,
        )
        .unwrap();
        let e6 = session
            .ingest_packet(&equiv_pkt.to_ndjson_line())
            .unwrap_err();
        assert_eq!(e6.code, AirlockErrorCode::ErrSourceEquivocation);
        assert_eq!(session.state_blake3(), baseline_state);
        assert_eq!(session.downgraded_sources(), &["ferry_ops".to_owned()]);
    }
}

