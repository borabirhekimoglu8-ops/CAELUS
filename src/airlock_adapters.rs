// CAELUS OS — Layer 1 Real-World Source Adapters (`AirlockSourceAdapter` — §2.3)
//
// Architectural boundary:
//   • Lives strictly in the outer host/sidecar crate (`caelus_network`), NEVER in `caelus_core`.
//   • Converts untrusted external telemetry (AISStream / ITU-R M.1371 `!AIVDM` + GNSS, NMEA 2000
//     canboat/SignalK PGNs, Open-Meteo Marine & 12-member Ensemble JSON, OpenSky `/api/states/all`,
//     Industrial Edge Zenoh/MQTT/Modbus PLC frames, and offline `.airlock.ndjson` archives) into
//     fixed-point (`FP_SCALE = 1_000_000`, `HALF_EVEN`, `|val| <= 2^62`) `UnsignedAirlockEvent`s
//     ready for `Ed25519` `CAELUS_INTEL_V2` sealing.

use std::collections::{BTreeMap, VecDeque};
use std::io::BufRead;

use caelus_core::airlock::{
    format_i64_decimal_ascii, is_within_airlock_safe_fp_range, parse_decimal_to_fp_half_even,
    parse_i64_decimal_ascii, AirlockErrorCode, EpistemicStatus, AIRLOCK_SCHEMA_V2,
};
use ed25519_dalek::{Signer, SigningKey};

use crate::airlock_host::{
    blake3_hex, build_canonical_multimetric_v2_payload_json, build_v2_header_line,
    build_v2_signed_message, encode_hex_lower, extract_v2_payload_metrics, parse_strict_json,
    peek_ndjson_learned_at_ms, split_airlock_batch_records, verify_airlock_packet_str,
    AirlockJsonVal, AirlockSourceManifest, SignedAirlockPacket, SourceOriginClass,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirlockError {
    pub code: AirlockErrorCode,
    pub source_id: String,
    pub detail: String,
}

impl AirlockError {
    pub fn new(code: AirlockErrorCode, source_id: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code,
            source_id: source_id.into(),
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for AirlockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} [{}]: {}", self.code.as_str(), self.source_id, self.detail)
    }
}

impl std::error::Error for AirlockError {}

#[derive(Debug, Clone)]
pub struct UnsignedAirlockEvent {
    pub source_id: String,
    pub key_id: String,
    pub event_kind: String,
    pub event_id: String,
    pub seq_no: u64,
    pub observed_at_ms: i64,
    pub learned_at_ms: i64,
    pub origin_class: SourceOriginClass,
    pub epistemic_status: EpistemicStatus,
    pub entity_id: String,
    pub fp_metrics: BTreeMap<String, i64>,
    pub supersedes_event_id: Option<String>,
    pub unit_schema: String,
}

impl UnsignedAirlockEvent {
    /// Seal this normalized fixed-point event into a `CAELUS_INTEL_V2` packet (`Ed25519`).
    pub fn sign_v2(&self, seed32: &[u8; 32]) -> Result<SignedAirlockPacket, AirlockError> {
        if self.source_id.is_empty()
            || self.key_id.is_empty()
            || self.event_kind.is_empty()
            || self.event_id.is_empty()
            || self.entity_id.is_empty()
            || self.fp_metrics.is_empty()
            || self.observed_at_ms < 0
            || self.learned_at_ms < 0
        {
            return Err(AirlockError::new(
                AirlockErrorCode::ErrSchemaOrRange,
                &self.source_id,
                "empty required field or negative timestamp in UnsignedAirlockEvent",
            ));
        }
        if !self.origin_class.allows_epistemic_status(self.epistemic_status) {
            return Err(AirlockError::new(
                AirlockErrorCode::ErrUnauthorizedKind,
                &self.source_id,
                format!(
                    "origin_class {} forbids epistemic_status {}",
                    self.origin_class.as_str(),
                    self.epistemic_status.as_str()
                ),
            ));
        }
        for (k, &v) in &self.fp_metrics {
            if k.is_empty() || !is_within_airlock_safe_fp_range(v) {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    format!("metric {:?} outside Z3 safe domain |val| <= 2^62", k),
                ));
            }
        }

        let canonical_payload_json = build_canonical_multimetric_v2_payload_json(
            &self.entity_id,
            &self.fp_metrics,
            self.supersedes_event_id.as_deref(),
            &self.unit_schema,
        );
        let payload_blake3_hex = blake3_hex(canonical_payload_json.as_bytes());
        let header_line = build_v2_header_line(
            &self.source_id,
            &self.key_id,
            &self.event_kind,
            &self.event_id,
            self.seq_no,
            self.observed_at_ms,
            self.learned_at_ms,
            self.epistemic_status,
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
            learned_at_ms: self.learned_at_ms,
        })
    }
}

/// Common sidecar source adapter interface (§2.3).
pub trait AirlockSourceAdapter {
    fn source_id(&self) -> &str;
    fn poll_normalized_batch(
        &mut self,
        max_items: usize,
    ) -> Result<Vec<UnsignedAirlockEvent>, AirlockError>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Fixed-Point Helpers (`HALF_EVEN`, zero floats!)
// ─────────────────────────────────────────────────────────────────────────────

fn json_num_or_str_to_fp(
    val: &AirlockJsonVal,
    source_id: &str,
    field: &str,
) -> Result<i64, AirlockError> {
    let raw_str = match val {
        AirlockJsonVal::Str(s) => s.clone(),
        AirlockJsonVal::Int(i) => i.to_string(),
        AirlockJsonVal::Float(s) => s.clone(),
        _ => {
            return Err(AirlockError::new(
                AirlockErrorCode::ErrSchemaOrRange,
                source_id,
                format!("field {:?} must be decimal string or numeric token", field),
            ))
        }
    };
    parse_decimal_to_fp_half_even(&raw_str).map_err(|code| {
        AirlockError::new(
            code,
            source_id,
            format!("field {:?} value {:?} failed HALF_EVEN conversion", field, raw_str),
        )
    })
}

fn json_ts_ms(val: Option<&AirlockJsonVal>, fallback_ms: i64) -> i64 {
    match val {
        Some(AirlockJsonVal::Str(s)) => parse_i64_decimal_ascii(s).unwrap_or(fallback_ms),
        Some(AirlockJsonVal::Int(v)) => i64::try_from(*v).unwrap_or(fallback_ms),
        _ => fallback_ms,
    }
}

fn verify_nmea_xor_checksum(sentence: &str) -> bool {
    let trimmed = sentence.trim();
    let body = if let Some(s) = trimmed.strip_prefix('!').or_else(|| trimmed.strip_prefix('$')) {
        s
    } else {
        return false;
    };
    let Some(star_pos) = body.rfind('*') else {
        return false;
    };
    if star_pos + 3 != body.len() {
        return false;
    }
    let data = &body.as_bytes()[..star_pos];
    let hex_part = &body[star_pos + 1..];
    let Ok(expected) = u8::from_str_radix(hex_part, 16) else {
        return false;
    };
    let mut acc = 0u8;
    for &b in data {
        acc ^= b;
    }
    acc == expected
}

/// Convert NMEA `DDMM.MMMM` / `DDDMM.MMMM` coordinate string + hemisphere (`N`/`S`/`E`/`W`)
/// into `i64 * 1_000_000` (`HALF_EVEN`) using pure integer arithmetic.
fn parse_nmea_dm_to_deg_fp(
    dm_raw: &str,
    hemi: &str,
    deg_digits: usize,
    source_id: &str,
) -> Result<i64, AirlockError> {
    if dm_raw.len() < deg_digits + 2 {
        return Err(AirlockError::new(
            AirlockErrorCode::ErrSchemaOrRange,
            source_id,
            "malformed NMEA coordinate",
        ));
    }
    let deg_str = &dm_raw[..deg_digits];
    let min_str = &dm_raw[deg_digits..];
    let deg: i64 = deg_str.parse::<i64>().map_err(|_| {
        AirlockError::new(
            AirlockErrorCode::ErrSchemaOrRange,
            source_id,
            "invalid NMEA degree digits",
        )
    })?;
    let min_fp = parse_decimal_to_fp_half_even(min_str).map_err(|c| {
        AirlockError::new(c, source_id, "invalid NMEA minutes decimal")
    })?;
    //HALF_EVEN division of min_fp by 60:
    let quot = min_fp / 60;
    let rem = min_fp % 60;
    let frac_deg_fp = if rem * 2 > 60 || (rem * 2 == 60 && (quot & 1) == 1) {
        quot + 1
    } else {
        quot
    };
    let mut total_fp = deg
        .checked_mul(1_000_000)
        .and_then(|d| d.checked_add(frac_deg_fp))
        .ok_or_else(|| {
            AirlockError::new(
                AirlockErrorCode::ErrSchemaOrRange,
                source_id,
                "NMEA coordinate overflow",
            )
        })?;
    if hemi == "S" || hemi == "W" {
        total_fp = -total_fp;
    }
    Ok(total_fp)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. `adapter_ais_stream` — AISStream.io JSON + ITU-R M.1371 `!AIVDM`/`!AIVDO` + GNSS
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(feature = "adapter_ais_stream")]
pub struct AisStreamAdapter {
    source_id: String,
    key_id: String,
    next_seq: u64,
    default_learned_at_ms: i64,
    inbox: VecDeque<String>,
    /// Multi-part ITU-R M.1371 fragment reassembly buffer keyed by `(seq_id, channel, total_frags)`.
    /// Half-assembled multi-part sentences NEVER escape into `poll_normalized_batch` (§2.3)!
    multipart_buf: BTreeMap<(String, String, usize), BTreeMap<usize, String>>,
}

#[cfg(feature = "adapter_ais_stream")]
impl AisStreamAdapter {
    pub fn new(source_id: impl Into<String>, key_id: impl Into<String>, start_seq: u64, default_learned_at_ms: i64) -> Self {
        Self {
            source_id: source_id.into(),
            key_id: key_id.into(),
            next_seq: start_seq.max(1),
            default_learned_at_ms,
            inbox: VecDeque::new(),
            multipart_buf: BTreeMap::new(),
        }
    }

    pub fn push_raw_frame(&mut self, frame: impl Into<String>) {
        self.inbox.push_back(frame.into());
    }

    pub fn pending_fragment_groups(&self) -> usize {
        self.multipart_buf.len()
    }

    fn decode_ais_6bit_payload(armored: &str) -> Option<Vec<u8>> {
        let mut bits = Vec::with_capacity(armored.len() * 6);
        for &b in armored.as_bytes() {
            if !(48..=119).contains(&b) || (88..=95).contains(&b) {
                return None;
            }
            let mut val = b - 48;
            if val > 40 {
                val -= 8;
            }
            for shift in (0..6).rev() {
                bits.push((val >> shift) & 1);
            }
        }
        Some(bits)
    }

    fn read_bits_u32(bits: &[u8], start: usize, len: usize) -> Option<u32> {
        if start + len > bits.len() || len > 32 {
            return None;
        }
        let mut v = 0u32;
        for &b in &bits[start..start + len] {
            v = (v << 1) | (b as u32);
        }
        Some(v)
    }

    fn read_bits_i32(bits: &[u8], start: usize, len: usize) -> Option<i32> {
        let raw = Self::read_bits_u32(bits, start, len)?;
        if len == 0 {
            return Some(0);
        }
        let sign_bit = 1u32 << (len - 1);
        if (raw & sign_bit) != 0 {
            let mask = if len == 32 { !0u32 } else { (1u32 << len) - 1 };
            let mag = ((!raw) & mask).wrapping_add(1);
            Some(-(mag as i32))
        } else {
            Some(raw as i32)
        }
    }

    /// Round `num * 1_000_000 / den` using IEEE 754 `HALF_EVEN` integer arithmetic.
    fn ratio_to_fp_half_even(num: i64, den: i64) -> i64 {
        let scaled = (num as i128) * 1_000_000i128;
        let d = den as i128;
        let quot = scaled / d;
        let rem = (scaled % d).abs();
        let twice_rem = rem * 2;
        let adj = if twice_rem > d || (twice_rem == d && (quot.abs() & 1) == 1) {
            if scaled >= 0 { 1 } else { -1 }
        } else {
            0
        };
        (quot + adj) as i64
    }

    fn parse_aivdm_reassembled(&mut self, armored: &str) -> Result<UnsignedAirlockEvent, AirlockError> {
        let bits = Self::decode_ais_6bit_payload(armored).ok_or_else(|| {
            AirlockError::new(
                AirlockErrorCode::ErrSchemaOrRange,
                &self.source_id,
                "invalid ITU-R M.1371 6-bit AIS armor",
            )
        })?;
        let msg_type = Self::read_bits_u32(&bits, 0, 6).ok_or_else(|| {
            AirlockError::new(
                AirlockErrorCode::ErrSchemaOrRange,
                &self.source_id,
                "AIS payload too short for message type",
            )
        })?;
        let mmsi = Self::read_bits_u32(&bits, 8, 30).ok_or_else(|| {
            AirlockError::new(
                AirlockErrorCode::ErrSchemaOrRange,
                &self.source_id,
                "AIS payload too short for MMSI",
            )
        })?;

        let mut metrics = BTreeMap::new();
        metrics.insert("mmsi_fp".to_owned(), (mmsi as i64) * 1_000_000);

        let event_kind = if (1..=3).contains(&msg_type) && bits.len() >= 149 {
            // Class A Position Report (ITU-R M.1371 Msg 1/2/3):
            // SOG (50..60, 1/10 kn), Lon (61..89, 1/600000 deg), Lat (89..116, 1/600000 deg),
            // COG (116..128, 1/10 deg), True Heading (128..137, deg)
            let sog_tenths = Self::read_bits_u32(&bits, 50, 10).unwrap_or(0) as i64;
            let lon_raw = Self::read_bits_i32(&bits, 61, 28).unwrap_or(0) as i64;
            let lat_raw = Self::read_bits_i32(&bits, 89, 27).unwrap_or(0) as i64;
            let cog_tenths = Self::read_bits_u32(&bits, 116, 12).unwrap_or(0) as i64;
            let hdg_deg = Self::read_bits_u32(&bits, 128, 9).unwrap_or(511) as i64;

            metrics.insert("sog_kn_fp".to_owned(), Self::ratio_to_fp_half_even(sog_tenths, 10));
            metrics.insert("lon_deg_fp".to_owned(), Self::ratio_to_fp_half_even(lon_raw, 600_000));
            metrics.insert("lat_deg_fp".to_owned(), Self::ratio_to_fp_half_even(lat_raw, 600_000));
            metrics.insert("cog_deg_fp".to_owned(), Self::ratio_to_fp_half_even(cog_tenths, 10));
            if hdg_deg < 360 {
                metrics.insert("heading_deg_fp".to_owned(), hdg_deg * 1_000_000);
            }
            "VESSEL_POSITION"
        } else {
            // Multi-part Msg 5 Static & Voyage Related Data (ETA / draught)
            let draught_tenths = if bits.len() >= 302 {
                Self::read_bits_u32(&bits, 294, 8).unwrap_or(0) as i64
            } else {
                0
            };
            metrics.insert(
                "draught_m_fp".to_owned(),
                Self::ratio_to_fp_half_even(draught_tenths, 10),
            );
            "BERTH_PROXIMITY"
        };

        let seq = self.next_seq;
        self.next_seq += 1;
        Ok(UnsignedAirlockEvent {
            source_id: self.source_id.clone(),
            key_id: self.key_id.clone(),
            event_kind: event_kind.to_owned(),
            event_id: format!("ais_nmea_{}", seq),
            seq_no: seq,
            observed_at_ms: self.default_learned_at_ms,
            learned_at_ms: self.default_learned_at_ms,
            origin_class: SourceOriginClass::CalibratedSensor,
            epistemic_status: EpistemicStatus::Observation,
            entity_id: format!("MMSI_{}", mmsi),
            fp_metrics: metrics,
            supersedes_event_id: None,
            unit_schema: "SI_MARINE_V1".to_owned(),
        })
    }

    fn process_single_frame(&mut self, frame: &str) -> Result<Option<UnsignedAirlockEvent>, AirlockError> {
        let trimmed = frame.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        // Case A: AISStream.io JSON message
        if trimmed.starts_with('{') {
            let root = parse_strict_json(trimmed).map_err(|e| {
                AirlockError::new(AirlockErrorCode::ErrSchemaOrRange, &self.source_id, e)
            })?;
            let obj = root.as_obj().ok_or_else(|| {
                AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "AISStream JSON root must be object",
                )
            })?;
            let meta = obj.get("MetaData").and_then(|v| v.as_obj());
            let pos = obj
                .get("Message")
                .and_then(|v| v.as_obj())
                .and_then(|m| {
                    m.get("PositionReport")
                        .or_else(|| m.get("StandardClassBPositionReport"))
                })
                .and_then(|v| v.as_obj());

            let entity_id = meta
                .and_then(|m| m.get("ShipName").and_then(|v| v.as_str()))
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().replace(' ', "_"))
                .or_else(|| {
                    obj.get("entity_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_owned())
                })
                .unwrap_or_else(|| "VESSEL_AEGEAN_01".to_owned());

            let mut metrics = BTreeMap::new();
            if let Some(p) = pos {
                if let Some(v) = p.get("Latitude") {
                    metrics.insert(
                        "lat_deg_fp".to_owned(),
                        json_num_or_str_to_fp(v, &self.source_id, "Latitude")?,
                    );
                }
                if let Some(v) = p.get("Longitude") {
                    metrics.insert(
                        "lon_deg_fp".to_owned(),
                        json_num_or_str_to_fp(v, &self.source_id, "Longitude")?,
                    );
                }
                if let Some(v) = p.get("Sog") {
                    metrics.insert(
                        "sog_kn_fp".to_owned(),
                        json_num_or_str_to_fp(v, &self.source_id, "Sog")?,
                    );
                }
                if let Some(v) = p.get("Cog") {
                    metrics.insert(
                        "cog_deg_fp".to_owned(),
                        json_num_or_str_to_fp(v, &self.source_id, "Cog")?,
                    );
                }
                if let Some(v) = p.get("TrueHeading") {
                    metrics.insert(
                        "heading_deg_fp".to_owned(),
                        json_num_or_str_to_fp(v, &self.source_id, "TrueHeading")?,
                    );
                }
                if let Some(v) = p.get("DelayMinutes") {
                    metrics.insert(
                        "delay_min_fp".to_owned(),
                        json_num_or_str_to_fp(v, &self.source_id, "DelayMinutes")?,
                    );
                }
            }
            if metrics.is_empty() {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "AISStream JSON contained no telemetry fields",
                ));
            }
            let obs_ms = json_ts_ms(obj.get("observed_at_ms"), self.default_learned_at_ms);
            let lrn_ms = json_ts_ms(obj.get("learned_at_ms"), self.default_learned_at_ms);
            let seq = self.next_seq;
            self.next_seq += 1;
            return Ok(Some(UnsignedAirlockEvent {
                source_id: self.source_id.clone(),
                key_id: self.key_id.clone(),
                event_kind: "VESSEL_POSITION".to_owned(),
                event_id: format!("ais_ws_{}", seq),
                seq_no: seq,
                observed_at_ms: obs_ms,
                learned_at_ms: lrn_ms,
                origin_class: SourceOriginClass::CalibratedSensor,
                epistemic_status: EpistemicStatus::Observation,
                entity_id,
                fp_metrics: metrics,
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            }));
        }

        // Case B: ITU-R M.1371 `!AIVDM` / `!AIVDO` with XOR checksum & multi-part reassembly
        if trimmed.starts_with("!AIVDM,") || trimmed.starts_with("!AIVDO,") {
            if !verify_nmea_xor_checksum(trimmed) {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSignatureMismatch,
                    &self.source_id,
                    "NMEA !AIVDM/!AIVDO XOR checksum mismatch",
                ));
            }
            let star = trimmed.rfind('*').unwrap_or(trimmed.len());
            let fields: Vec<&str> = trimmed[..star].split(',').collect();
            if fields.len() < 7 {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "truncated !AIVDM sentence",
                ));
            }
            let total: usize = fields[1].parse().unwrap_or(0);
            let num: usize = fields[2].parse().unwrap_or(0);
            let seq_id = fields[3].to_owned();
            let channel = fields[4].to_owned();
            let payload = fields[5].to_owned();

            if total == 0 || num == 0 || num > total {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "invalid !AIVDM fragment numbering",
                ));
            }
            if total == 1 {
                return self.parse_aivdm_reassembled(&payload).map(Some);
            }

            // Multi-part message: buffer until ALL `1..=total` fragments arrive!
            let key = (seq_id, channel, total);
            let entry = self.multipart_buf.entry(key.clone()).or_default();
            entry.insert(num, payload);
            if entry.len() < total {
                // Half-assembled multi-part AIS message MUST NOT pass through!
                return Ok(None);
            }
            let completed = self.multipart_buf.remove(&key).unwrap_or_default();
            let mut combined = String::new();
            for idx in 1..=total {
                if let Some(part) = completed.get(&idx) {
                    combined.push_str(part);
                } else {
                    return Ok(None);
                }
            }
            return self.parse_aivdm_reassembled(&combined).map(Some);
        }

        // Case C: NMEA 0183 GNSS `$GPRMC` / `$GNRMC`
        if trimmed.starts_with("$GPRMC,") || trimmed.starts_with("$GNRMC,") {
            if !verify_nmea_xor_checksum(trimmed) {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSignatureMismatch,
                    &self.source_id,
                    "GNSS RMC XOR checksum mismatch",
                ));
            }
            let star = trimmed.rfind('*').unwrap_or(trimmed.len());
            let fields: Vec<&str> = trimmed[..star].split(',').collect();
            if fields.len() < 9 || fields[2] != "A" {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "GNSS RMC status void or truncated",
                ));
            }
            let lat_fp = parse_nmea_dm_to_deg_fp(fields[3], fields[4], 2, &self.source_id)?;
            let lon_fp = parse_nmea_dm_to_deg_fp(fields[5], fields[6], 3, &self.source_id)?;
            let sog_fp = parse_decimal_to_fp_half_even(fields[7]).map_err(|c| {
                AirlockError::new(c, &self.source_id, "invalid GNSS SOG")
            })?;
            let cog_fp = parse_decimal_to_fp_half_even(fields[8]).map_err(|c| {
                AirlockError::new(c, &self.source_id, "invalid GNSS COG")
            })?;
            let mut metrics = BTreeMap::new();
            metrics.insert("lat_deg_fp".to_owned(), lat_fp);
            metrics.insert("lon_deg_fp".to_owned(), lon_fp);
            metrics.insert("sog_kn_fp".to_owned(), sog_fp);
            metrics.insert("cog_deg_fp".to_owned(), cog_fp);
            let seq = self.next_seq;
            self.next_seq += 1;
            return Ok(Some(UnsignedAirlockEvent {
                source_id: self.source_id.clone(),
                key_id: self.key_id.clone(),
                event_kind: "VESSEL_POSITION".to_owned(),
                event_id: format!("gnss_rmc_{}", seq),
                seq_no: seq,
                observed_at_ms: self.default_learned_at_ms,
                learned_at_ms: self.default_learned_at_ms,
                origin_class: SourceOriginClass::CalibratedSensor,
                epistemic_status: EpistemicStatus::Observation,
                entity_id: "VESSEL_AEGEAN_01".to_owned(),
                fp_metrics: metrics,
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            }));
        }

        Err(AirlockError::new(
            AirlockErrorCode::ErrSchemaOrRange,
            &self.source_id,
            "unrecognized AIS/GNSS sentence format",
        ))
    }
}

#[cfg(feature = "adapter_ais_stream")]
impl AirlockSourceAdapter for AisStreamAdapter {
    fn source_id(&self) -> &str {
        &self.source_id
    }

    fn poll_normalized_batch(
        &mut self,
        max_items: usize,
    ) -> Result<Vec<UnsignedAirlockEvent>, AirlockError> {
        let mut out = Vec::new();
        while out.len() < max_items {
            let Some(frame) = self.inbox.pop_front() else {
                break;
            };
            if let Some(ev) = self.process_single_frame(&frame)? {
                out.push(ev);
            }
        }
        Ok(out)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. `adapter_nmea2000` — Canboat PGNs (130306, 128267, 127245, 127488) & SignalK
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(feature = "adapter_nmea2000")]
pub struct Nmea2000Adapter {
    source_id: String,
    key_id: String,
    next_seq: u64,
    default_learned_at_ms: i64,
    inbox: VecDeque<String>,
}

#[cfg(feature = "adapter_nmea2000")]
impl Nmea2000Adapter {
    pub fn new(source_id: impl Into<String>, key_id: impl Into<String>, start_seq: u64, default_learned_at_ms: i64) -> Self {
        Self {
            source_id: source_id.into(),
            key_id: key_id.into(),
            next_seq: start_seq.max(1),
            default_learned_at_ms,
            inbox: VecDeque::new(),
        }
    }

    pub fn push_pgn_json(&mut self, raw_json: impl Into<String>) {
        self.inbox.push_back(raw_json.into());
    }
}

#[cfg(feature = "adapter_nmea2000")]
impl AirlockSourceAdapter for Nmea2000Adapter {
    fn source_id(&self) -> &str {
        &self.source_id
    }

    fn poll_normalized_batch(
        &mut self,
        max_items: usize,
    ) -> Result<Vec<UnsignedAirlockEvent>, AirlockError> {
        let mut out = Vec::new();
        while out.len() < max_items {
            let Some(raw) = self.inbox.pop_front() else {
                break;
            };
            let root = parse_strict_json(&raw).map_err(|e| {
                AirlockError::new(AirlockErrorCode::ErrSchemaOrRange, &self.source_id, e)
            })?;
            let obj = root.as_obj().ok_or_else(|| {
                AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "canboat/SignalK frame must be JSON object",
                )
            })?;
            let pgn = obj.get("pgn").and_then(|v| v.as_i128()).unwrap_or(0);
            let fields = obj
                .get("fields")
                .and_then(|v| v.as_obj())
                .unwrap_or(obj);

            let mut metrics = BTreeMap::new();
            let event_kind = match pgn {
                130306 => {
                    if let Some(ws) = fields.get("Wind Speed") {
                        metrics.insert(
                            "wind_speed_mps_fp".to_owned(),
                            json_num_or_str_to_fp(ws, &self.source_id, "Wind Speed")?,
                        );
                    }
                    if let Some(wa) = fields.get("Wind Angle") {
                        metrics.insert(
                            "wind_angle_deg_fp".to_owned(),
                            json_num_or_str_to_fp(wa, &self.source_id, "Wind Angle")?,
                        );
                    }
                    "N2K_WIND_DATA"
                }
                128267 => {
                    if let Some(d) = fields.get("Depth") {
                        metrics.insert(
                            "depth_m_fp".to_owned(),
                            json_num_or_str_to_fp(d, &self.source_id, "Depth")?,
                        );
                    }
                    "N2K_WATER_DEPTH"
                }
                127245 => {
                    if let Some(r) = fields.get("Position") {
                        metrics.insert(
                            "rudder_angle_deg_fp".to_owned(),
                            json_num_or_str_to_fp(r, &self.source_id, "Position")?,
                        );
                    }
                    "N2K_RUDDER_ANGLE"
                }
                127488 => {
                    if let Some(rpm) = fields.get("Speed") {
                        metrics.insert(
                            "engine_rpm_fp".to_owned(),
                            json_num_or_str_to_fp(rpm, &self.source_id, "Speed")?,
                        );
                    }
                    "N2K_ENGINE_RAPID"
                }
                _ => {
                    return Err(AirlockError::new(
                        AirlockErrorCode::ErrSchemaOrRange,
                        &self.source_id,
                        format!("unsupported NMEA 2000 PGN {}", pgn),
                    ))
                }
            };
            if metrics.is_empty() {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "NMEA 2000 PGN frame missing telemetry fields",
                ));
            }
            let obs_ms = json_ts_ms(obj.get("observed_at_ms"), self.default_learned_at_ms);
            let lrn_ms = json_ts_ms(obj.get("learned_at_ms"), self.default_learned_at_ms);
            let entity = obj
                .get("entity_id")
                .and_then(|v| v.as_str())
                .unwrap_or("VESSEL_AEGEAN_01")
                .to_owned();
            let seq = self.next_seq;
            self.next_seq += 1;
            out.push(UnsignedAirlockEvent {
                source_id: self.source_id.clone(),
                key_id: self.key_id.clone(),
                event_kind: event_kind.to_owned(),
                event_id: format!("n2k_{}_{}", pgn, seq),
                seq_no: seq,
                observed_at_ms: obs_ms,
                learned_at_ms: lrn_ms,
                origin_class: SourceOriginClass::CalibratedSensor,
                epistemic_status: EpistemicStatus::Observation,
                entity_id: entity,
                fp_metrics: metrics,
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            });
        }
        Ok(out)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. `adapter_open_meteo` — Open-Meteo Marine & 12-World Ensemble (`HYPOTHESIS` ONLY!)
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(feature = "adapter_open_meteo")]
pub struct OpenMeteoMarineAdapter {
    source_id: String,
    key_id: String,
    next_seq: u64,
    default_learned_at_ms: i64,
    inbox: VecDeque<String>,
}

#[cfg(feature = "adapter_open_meteo")]
impl OpenMeteoMarineAdapter {
    pub fn new(source_id: impl Into<String>, key_id: impl Into<String>, start_seq: u64, default_learned_at_ms: i64) -> Self {
        Self {
            source_id: source_id.into(),
            key_id: key_id.into(),
            next_seq: start_seq.max(1),
            default_learned_at_ms,
            inbox: VecDeque::new(),
        }
    }

    pub fn push_forecast_json(&mut self, raw_json: impl Into<String>) {
        self.inbox.push_back(raw_json.into());
    }
}

#[cfg(feature = "adapter_open_meteo")]
impl AirlockSourceAdapter for OpenMeteoMarineAdapter {
    fn source_id(&self) -> &str {
        &self.source_id
    }

    fn poll_normalized_batch(
        &mut self,
        max_items: usize,
    ) -> Result<Vec<UnsignedAirlockEvent>, AirlockError> {
        let mut out = Vec::new();
        while out.len() < max_items {
            let Some(raw) = self.inbox.pop_front() else {
                break;
            };
            let root = parse_strict_json(&raw).map_err(|e| {
                AirlockError::new(AirlockErrorCode::ErrSchemaOrRange, &self.source_id, e)
            })?;
            let obj = root.as_obj().ok_or_else(|| {
                AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "Open-Meteo Marine payload must be JSON object",
                )
            })?;

            // Support both Open-Meteo `current` and `hourly` (+ 12-member ensemble arrays)
            let hourly = obj.get("hourly").and_then(|v| v.as_obj());
            let current = obj.get("current").and_then(|v| v.as_obj());

            let mut metrics = BTreeMap::new();
            let mut ensemble_members_fp: Vec<i64> = Vec::new();

            if let Some(c) = current {
                if let Some(wh) = c.get("wave_height") {
                    let v = json_num_or_str_to_fp(wh, &self.source_id, "wave_height")?;
                    metrics.insert("wave_m_fp".to_owned(), v);
                }
                if let Some(wp) = c.get("wave_period") {
                    metrics.insert(
                        "wave_period_s_fp".to_owned(),
                        json_num_or_str_to_fp(wp, &self.source_id, "wave_period")?,
                    );
                }
                if let Some(oc) = c.get("ocean_current_velocity") {
                    metrics.insert(
                        "ocean_current_kn_fp".to_owned(),
                        json_num_or_str_to_fp(oc, &self.source_id, "ocean_current_velocity")?,
                    );
                }
            }

            if let Some(h) = hourly {
                if let Some(arr) = h.get("wave_height").and_then(|v| v.as_arr()) {
                    if let Some(first) = arr.first() {
                        let v = json_num_or_str_to_fp(first, &self.source_id, "hourly.wave_height[0]")?;
                        metrics.entry("wave_m_fp".to_owned()).or_insert(v);
                    }
                }
                if let Some(arr) = h.get("wave_period").and_then(|v| v.as_arr()) {
                    if let Some(first) = arr.first() {
                        let v = json_num_or_str_to_fp(first, &self.source_id, "hourly.wave_period[0]")?;
                        metrics.entry("wave_period_s_fp".to_owned()).or_insert(v);
                    }
                }
                if let Some(arr) = h.get("ocean_current_velocity").and_then(|v| v.as_arr()) {
                    if let Some(first) = arr.first() {
                        let v = json_num_or_str_to_fp(
                            first,
                            &self.source_id,
                            "hourly.ocean_current_velocity[0]",
                        )?;
                        metrics.entry("ocean_current_kn_fp".to_owned()).or_insert(v);
                    }
                }
                // Map ensemble members (`wave_height_member01`..`wave_height_member12`) to 12-world envelope
                for (k, v) in h {
                    if k.starts_with("wave_height_member") {
                        if let Some(arr) = v.as_arr() {
                            if let Some(first) = arr.first() {
                                ensemble_members_fp.push(json_num_or_str_to_fp(
                                    first,
                                    &self.source_id,
                                    k,
                                )?);
                            }
                        }
                    }
                }
            }

            if !ensemble_members_fp.is_empty() {
                ensemble_members_fp.sort_unstable();
                let mid = ensemble_members_fp.len() / 2;
                let p50 = ensemble_members_fp[mid];
                let p95 = *ensemble_members_fp.last().unwrap_or(&p50);
                metrics.insert("wave_p50_m_fp".to_owned(), p50);
                metrics.insert("wave_p95_m_fp".to_owned(), p95);
                metrics.entry("wave_m_fp".to_owned()).or_insert(p95);
            }

            if metrics.is_empty() {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "Open-Meteo JSON missing wave_height/wave_period/ensemble fields",
                ));
            }

            let obs_ms = json_ts_ms(obj.get("observed_at_ms"), self.default_learned_at_ms);
            let lrn_ms = json_ts_ms(obj.get("learned_at_ms"), self.default_learned_at_ms);
            let entity = obj
                .get("entity_id")
                .and_then(|v| v.as_str())
                .unwrap_or("CORRIDOR_SIGACIK_VATHI")
                .to_owned();
            let seq = self.next_seq;
            self.next_seq += 1;

            // §2.3 INVARIANT: Numerical weather forecasts are ALWAYS stamped `HYPOTHESIS`!
            out.push(UnsignedAirlockEvent {
                source_id: self.source_id.clone(),
                key_id: self.key_id.clone(),
                event_kind: "WAVE_FORECAST".to_owned(),
                event_id: format!("wx_ens_{}", seq),
                seq_no: seq,
                observed_at_ms: obs_ms,
                learned_at_ms: lrn_ms,
                origin_class: SourceOriginClass::ModelOrAgent,
                epistemic_status: EpistemicStatus::Hypothesis,
                entity_id: entity,
                fp_metrics: metrics,
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            });
        }
        Ok(out)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. `adapter_opensky` — OpenSky Network `/api/states/all` State Vectors
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(feature = "adapter_opensky")]
pub struct OpenSkyAdapter {
    source_id: String,
    key_id: String,
    next_seq: u64,
    default_learned_at_ms: i64,
    inbox: VecDeque<String>,
}

#[cfg(feature = "adapter_opensky")]
impl OpenSkyAdapter {
    pub fn new(source_id: impl Into<String>, key_id: impl Into<String>, start_seq: u64, default_learned_at_ms: i64) -> Self {
        Self {
            source_id: source_id.into(),
            key_id: key_id.into(),
            next_seq: start_seq.max(1),
            default_learned_at_ms,
            inbox: VecDeque::new(),
        }
    }

    pub fn push_states_json(&mut self, raw_json: impl Into<String>) {
        self.inbox.push_back(raw_json.into());
    }
}

#[cfg(feature = "adapter_opensky")]
impl AirlockSourceAdapter for OpenSkyAdapter {
    fn source_id(&self) -> &str {
        &self.source_id
    }

    fn poll_normalized_batch(
        &mut self,
        max_items: usize,
    ) -> Result<Vec<UnsignedAirlockEvent>, AirlockError> {
        let mut out = Vec::new();
        while out.len() < max_items {
            let Some(raw) = self.inbox.pop_front() else {
                break;
            };
            let root = parse_strict_json(&raw).map_err(|e| {
                AirlockError::new(AirlockErrorCode::ErrSchemaOrRange, &self.source_id, e)
            })?;
            let obj = root.as_obj().ok_or_else(|| {
                AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "OpenSky response must be JSON object",
                )
            })?;
            let states = obj
                .get("states")
                .and_then(|v| v.as_arr())
                .ok_or_else(|| {
                    AirlockError::new(
                        AirlockErrorCode::ErrSchemaOrRange,
                        &self.source_id,
                        "OpenSky JSON missing states array",
                    )
                })?;

            for sv_val in states {
                if out.len() >= max_items {
                    break;
                }
                let sv = sv_val.as_arr().ok_or_else(|| {
                    AirlockError::new(
                        AirlockErrorCode::ErrSchemaOrRange,
                        &self.source_id,
                        "OpenSky state vector must be array",
                    )
                })?;
                if sv.len() < 15 {
                    continue;
                }
                let icao24 = sv[0].as_str().unwrap_or("unknown");
                let mut metrics = BTreeMap::new();
                if !matches!(sv[5], AirlockJsonVal::Null) {
                    metrics.insert(
                        "lon_deg_fp".to_owned(),
                        json_num_or_str_to_fp(&sv[5], &self.source_id, "longitude")?,
                    );
                }
                if !matches!(sv[6], AirlockJsonVal::Null) {
                    metrics.insert(
                        "lat_deg_fp".to_owned(),
                        json_num_or_str_to_fp(&sv[6], &self.source_id, "latitude")?,
                    );
                }
                if !matches!(sv[7], AirlockJsonVal::Null) {
                    metrics.insert(
                        "baro_alt_m_fp".to_owned(),
                        json_num_or_str_to_fp(&sv[7], &self.source_id, "baro_altitude")?,
                    );
                }
                if !matches!(sv[9], AirlockJsonVal::Null) {
                    metrics.insert(
                        "velocity_mps_fp".to_owned(),
                        json_num_or_str_to_fp(&sv[9], &self.source_id, "velocity")?,
                    );
                }
                let mut emergency = false;
                if let Some(sq) = sv[14].as_str() {
                    if let Ok(sq_num) = sq.parse::<i64>() {
                        metrics.insert("squawk_code_fp".to_owned(), sq_num * 1_000_000);
                        if sq == "7500" || sq == "7600" || sq == "7700" {
                            emergency = true;
                        }
                    }
                }
                if metrics.is_empty() {
                    continue;
                }
                let seq = self.next_seq;
                self.next_seq += 1;
                out.push(UnsignedAirlockEvent {
                    source_id: self.source_id.clone(),
                    key_id: self.key_id.clone(),
                    event_kind: if emergency {
                        "AIRSPACE_EMERGENCY_SQUAWK".to_owned()
                    } else {
                        "AIRCRAFT_STATE_VECTOR".to_owned()
                    },
                    event_id: format!("osky_{}_{}", icao24, seq),
                    seq_no: seq,
                    observed_at_ms: self.default_learned_at_ms,
                    learned_at_ms: self.default_learned_at_ms,
                    origin_class: SourceOriginClass::CalibratedSensor,
                    epistemic_status: EpistemicStatus::Observation,
                    entity_id: format!("ICAO_{}", icao24.to_ascii_uppercase()),
                    fp_metrics: metrics,
                    supersedes_event_id: None,
                    unit_schema: "SI_AVIATION_V1".to_owned(),
                });
            }
        }
        Ok(out)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. `adapter_industrial_edge` — Zenoh / MQTT / Modbus PLC Berth & Power Telemetry
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(feature = "adapter_industrial_edge")]
pub struct IndustrialEdgeAdapter {
    source_id: String,
    key_id: String,
    next_seq: u64,
    default_learned_at_ms: i64,
    inbox: VecDeque<String>,
}

#[cfg(feature = "adapter_industrial_edge")]
impl IndustrialEdgeAdapter {
    pub fn new(source_id: impl Into<String>, key_id: impl Into<String>, start_seq: u64, default_learned_at_ms: i64) -> Self {
        Self {
            source_id: source_id.into(),
            key_id: key_id.into(),
            next_seq: start_seq.max(1),
            default_learned_at_ms,
            inbox: VecDeque::new(),
        }
    }

    pub fn push_edge_telemetry_json(&mut self, raw_json: impl Into<String>) {
        self.inbox.push_back(raw_json.into());
    }
}

#[cfg(feature = "adapter_industrial_edge")]
impl AirlockSourceAdapter for IndustrialEdgeAdapter {
    fn source_id(&self) -> &str {
        &self.source_id
    }

    fn poll_normalized_batch(
        &mut self,
        max_items: usize,
    ) -> Result<Vec<UnsignedAirlockEvent>, AirlockError> {
        let mut out = Vec::new();
        while out.len() < max_items {
            let Some(raw) = self.inbox.pop_front() else {
                break;
            };
            let root = parse_strict_json(&raw).map_err(|e| {
                AirlockError::new(AirlockErrorCode::ErrSchemaOrRange, &self.source_id, e)
            })?;
            let obj = root.as_obj().ok_or_else(|| {
                AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "industrial edge PLC frame must be JSON object",
                )
            })?;
            let mut metrics = BTreeMap::new();
            for (src_field, dst_metric) in [
                ("ramp_angle_deg", "ramp_angle_deg_fp"),
                ("gate_interlock_closed", "gate_locked_fp"),
                ("shore_power_v", "shore_bus_v_fp"),
                ("delay_minutes", "delay_min_fp"),
            ] {
                if let Some(v) = obj.get(src_field) {
                    metrics.insert(
                        dst_metric.to_owned(),
                        json_num_or_str_to_fp(v, &self.source_id, src_field)?,
                    );
                }
            }
            if metrics.is_empty() {
                return Err(AirlockError::new(
                    AirlockErrorCode::ErrSchemaOrRange,
                    &self.source_id,
                    "PLC frame missing ramp/gate/shore_power/delay_minutes telemetry",
                ));
            }
            let obs_ms = json_ts_ms(obj.get("observed_at_ms"), self.default_learned_at_ms);
            let lrn_ms = json_ts_ms(obj.get("learned_at_ms"), self.default_learned_at_ms);
            let entity = obj
                .get("entity_id")
                .and_then(|v| v.as_str())
                .unwrap_or("VESSEL_AEGEAN_01")
                .to_owned();
            let event_kind = obj
                .get("event_kind")
                .and_then(|v| v.as_str())
                .unwrap_or("BERTH_PROXIMITY")
                .to_owned();
            let seq = self.next_seq;
            self.next_seq += 1;
            out.push(UnsignedAirlockEvent {
                source_id: self.source_id.clone(),
                key_id: self.key_id.clone(),
                event_kind,
                event_id: format!("plc_edge_{}", seq),
                seq_no: seq,
                observed_at_ms: obs_ms,
                learned_at_ms: lrn_ms,
                origin_class: SourceOriginClass::CalibratedSensor,
                epistemic_status: EpistemicStatus::Observation,
                entity_id: entity,
                fp_metrics: metrics,
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            });
        }
        Ok(out)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. `adapter_ndjson_replay` — Air-Gapped `.airlock.ndjson` Archive (`1x`, `10x`, `cutoff_ts`)
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(feature = "adapter_ndjson_replay")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplaySpeed {
    RealTime1x,
    Accelerated10x,
    InstantCutoffJump,
}

#[cfg(feature = "adapter_ndjson_replay")]
pub struct NdjsonReplayAdapter {
    source_id: String,
    manifest: AirlockSourceManifest,
    records: Vec<String>,
    learned_index_ms: Vec<i64>,
    is_sorted: bool,
    cursor: usize,
    upper_bound: usize,
    speed: ReplaySpeed,
}

#[cfg(feature = "adapter_ndjson_replay")]
impl NdjsonReplayAdapter {
    pub fn from_reader<R: BufRead>(
        source_id: impl Into<String>,
        manifest: AirlockSourceManifest,
        mut reader: R,
        speed: ReplaySpeed,
    ) -> Result<Self, AirlockError> {
        let sid = source_id.into();
        let mut content = String::new();
        reader.read_to_string(&mut content).map_err(|e| {
            AirlockError::new(
                AirlockErrorCode::ErrSchemaOrRange,
                &sid,
                format!("failed to read replay archive: {}", e),
            )
        })?;
        let records = split_airlock_batch_records(&content).map_err(|e| {
            AirlockError::new(AirlockErrorCode::ErrSchemaOrRange, &sid, e)
        })?;
        let mut learned_index_ms = Vec::with_capacity(records.len());
        let mut is_sorted = !records.is_empty();
        for rec in &records {
            match peek_ndjson_learned_at_ms(rec) {
                Some(ts) => {
                    if let Some(&prev) = learned_index_ms.last() {
                        if ts < prev {
                            is_sorted = false;
                        }
                    }
                    learned_index_ms.push(ts);
                }
                None => {
                    is_sorted = false;
                    learned_index_ms.push(i64::MAX);
                }
            }
        }
        let upper_bound = records.len();
        Ok(Self {
            source_id: sid,
            manifest,
            records,
            learned_index_ms,
            is_sorted,
            cursor: 0,
            upper_bound,
            speed,
        })
    }

    pub fn speed(&self) -> ReplaySpeed {
        self.speed
    }

    pub fn set_speed(&mut self, speed: ReplaySpeed) {
        self.speed = speed;
    }

    /// `O(log N)` binary search jump to `cutoff_learned_at_ms` (§2.3 & §5).
    pub fn jump_to_cutoff_ts(&mut self, cutoff_learned_at_ms: i64) -> usize {
        self.cursor = 0;
        if self.is_sorted {
            self.upper_bound = self
                .learned_index_ms
                .partition_point(|&ts| ts <= cutoff_learned_at_ms);
        } else {
            self.upper_bound = self.records.len();
        }
        self.upper_bound
    }

    pub fn raw_slice_records(&self) -> &[String] {
        &self.records[..self.upper_bound]
    }
}

#[cfg(feature = "adapter_ndjson_replay")]
impl AirlockSourceAdapter for NdjsonReplayAdapter {
    fn source_id(&self) -> &str {
        &self.source_id
    }

    fn poll_normalized_batch(
        &mut self,
        max_items: usize,
    ) -> Result<Vec<UnsignedAirlockEvent>, AirlockError> {
        let mut out = Vec::new();
        while self.cursor < self.upper_bound && out.len() < max_items {
            let rec = &self.records[self.cursor];
            self.cursor += 1;
            let ev = verify_airlock_packet_str(rec, &self.manifest).map_err(|rej| {
                AirlockError::new(rej.code, rej.source_id, rej.detail)
            })?;
            let mut fp_metrics = BTreeMap::new();
            if let Some((_, mmap)) = extract_v2_payload_metrics(rec) {
                for (mk, mv) in mmap {
                    if let Some(v) = parse_i64_decimal_ascii(&mv) {
                        fp_metrics.insert(mk, v);
                    }
                }
            }
            if fp_metrics.is_empty() {
                fp_metrics.insert(ev.metric_key.clone(), ev.fp_val);
            }
            let origin_class = match ev.epistemic_status {
                EpistemicStatus::Observation => SourceOriginClass::CalibratedSensor,
                EpistemicStatus::Claim => SourceOriginClass::HumanOperator,
                EpistemicStatus::Hypothesis => SourceOriginClass::ModelOrAgent,
            };
            let _ = format_i64_decimal_ascii(ev.fp_val);
            out.push(UnsignedAirlockEvent {
                source_id: ev.source_id,
                key_id: ev.key_id,
                event_kind: ev.event_kind,
                event_id: ev.event_id,
                seq_no: ev.seq_no,
                observed_at_ms: ev.observed_at_ms,
                learned_at_ms: ev.learned_at_ms,
                origin_class,
                epistemic_status: ev.epistemic_status,
                entity_id: ev.subject_id,
                fp_metrics,
                supersedes_event_id: ev.supersedes_event_id,
                unit_schema: ev.unit,
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nmea_with_cs(body_no_bang_or_star: &str, prefix: char) -> String {
        let mut cs = 0u8;
        for &b in body_no_bang_or_star.as_bytes() {
            cs ^= b;
        }
        format!("{}{}*{:02X}", prefix, body_no_bang_or_star, cs)
    }

    #[test]
    #[cfg(feature = "adapter_ais_stream")]
    fn ais_multipart_blocks_half_packet_and_parses_single_part_and_gnss() {
        let mut adapter = AisStreamAdapter::new(
            "ais_terrestrial_aegean",
            "ais-key-2026-q4",
            1,
            1_762_849_500_000,
        );

        // Push ONLY fragment 1 of 2 of an ITU-R M.1371 Type 5 multi-part message:
        let frag1 = nmea_with_cs(
            "AIVDM,2,1,3,B,55?MbV02>H97ac<H4eEK6W@T4@Dn222222222216,0",
            '!',
        );
        adapter.push_raw_frame(frag1);
        let batch_half = adapter.poll_normalized_batch(10).expect("poll half");
        assert!(
            batch_half.is_empty(),
            "Half-assembled multi-part AIS packet MUST NOT pass through AirlockSourceAdapter!"
        );
        assert_eq!(adapter.pending_fragment_groups(), 1);

        // Push fragment 2 of 2 -> now reassembled & emitted as OBSERVATION!
        let frag2 = nmea_with_cs("AIVDM,2,2,3,B,88888888880,2", '!');
        adapter.push_raw_frame(frag2);
        let batch_full = adapter.poll_normalized_batch(10).expect("poll full");
        assert_eq!(batch_full.len(), 1);
        assert_eq!(batch_full[0].epistemic_status, EpistemicStatus::Observation);
        assert_eq!(adapter.pending_fragment_groups(), 0);

        // GNSS RMC sentence -> HALF_EVEN fixed-point conversion
        let rmc = nmea_with_cs(
            "GPRMC,082500.00,A,3811.7252,N,02650.2266,E,14.20,215.50,111126,,,A",
            '$',
        );
        adapter.push_raw_frame(rmc);
        let gnss_batch = adapter.poll_normalized_batch(10).expect("poll gnss");
        assert_eq!(gnss_batch.len(), 1);
        assert_eq!(gnss_batch[0].fp_metrics["lat_deg_fp"], 38_195_420);
        assert_eq!(gnss_batch[0].fp_metrics["lon_deg_fp"], 26_837_110);
        assert_eq!(gnss_batch[0].fp_metrics["sog_kn_fp"], 14_200_000);
    }

    #[test]
    #[cfg(feature = "adapter_open_meteo")]
    fn open_meteo_enforces_hypothesis_and_12_world_ensemble() {
        let mut wx = OpenMeteoMarineAdapter::new(
            "open_meteo_marine_ensemble",
            "wx-key-2026-q4",
            1,
            1_762_848_600_000,
        );
        wx.push_forecast_json(
            r#"{
                "entity_id": "VESSEL_AEGEAN_01",
                "observed_at_ms": "1762848540000",
                "learned_at_ms": "1762848600000",
                "hourly": {
                    "wave_height": [2.45],
                    "wave_period": [6.8],
                    "ocean_current_velocity": [1.15],
                    "wave_height_member01": [1.90],
                    "wave_height_member02": [2.10],
                    "wave_height_member03": [2.35],
                    "wave_height_member04": [2.95]
                }
            }"#,
        );
        let evs = wx.poll_normalized_batch(4).expect("wx poll");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].epistemic_status, EpistemicStatus::Hypothesis);
        assert_eq!(evs[0].fp_metrics["wave_m_fp"], 2_450_000);
        assert_eq!(evs[0].fp_metrics["wave_p95_m_fp"], 2_950_000);

        // Attempting to forge OBSERVATION on a ModelOrAgent event must fail closed!
        let mut forged = evs[0].clone();
        forged.epistemic_status = EpistemicStatus::Observation;
        assert!(forged.sign_v2(&[0x33u8; 32]).is_err());
    }

    #[test]
    #[cfg(all(
        feature = "adapter_nmea2000",
        feature = "adapter_opensky",
        feature = "adapter_industrial_edge"
    ))]
    fn nmea2000_opensky_and_industrial_edge_seal_observations() {
        let mut n2k = Nmea2000Adapter::new("nmea2000_bridge_bus", "n2k-key-2026-q4", 1, 1_762_849_500_000);
        n2k.push_pgn_json(r#"{"pgn":130306,"fields":{"Wind Speed":"12.4","Wind Angle":"42.5"}}"#);
        let n2k_evs = n2k.poll_normalized_batch(4).expect("n2k");
        assert_eq!(n2k_evs[0].fp_metrics["wind_speed_mps_fp"], 12_400_000);

        let mut osky = OpenSkyAdapter::new("opensky_aegean_adsb", "osky-key-2026-q4", 1, 1_762_849_500_000);
        osky.push_states_json(
            r#"{"states":[["4baa12","THY412","Turkey",1762849490,1762849495,26.83711,38.19542,3450.5,false,182.25,195.0,0.0,null,3510.0,"7700",false,0]]}"#,
        );
        let osky_evs = osky.poll_normalized_batch(4).expect("osky");
        assert_eq!(osky_evs[0].event_kind, "AIRSPACE_EMERGENCY_SQUAWK");
        assert_eq!(osky_evs[0].fp_metrics["baro_alt_m_fp"], 3_450_500_000);

        let mut plc = IndustrialEdgeAdapter::new(
            "port_berth_sensor_sigacik",
            "port-key-2026-q4",
            1,
            1_762_849_500_000,
        );
        plc.push_edge_telemetry_json(
            r#"{"entity_id":"VESSEL_AEGEAN_01","ramp_angle_deg":"4.25","gate_interlock_closed":"1","shore_power_v":"400.5","delay_minutes":"35"}"#,
        );
        let plc_evs = plc.poll_normalized_batch(4).expect("plc");
        assert_eq!(plc_evs[0].fp_metrics["delay_min_fp"], 35_000_000);
        let signed = plc_evs[0].sign_v2(&[0x44u8; 32]).expect("sign v2");
        assert!(signed.canonical_payload_json.contains("\"delay_min_fp\":\"35000000\""));
    }
}

