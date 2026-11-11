// CAELUS OS — External Sidecar Airlock CLI (`caelus_sidecar_airlock`)
//
// Implements the External Sidecar Profile (PR-1 §1, §2, §3.2–§3.4):
//   • `pubkey`         — derive 64-hex Ed25519 verifying key from 32-byte seed
//   • `normalize`      — read CSV/JSON/NDJSON raw records, convert units to fixed-point
//                        (`FP_SCALE = 1_000_000`, `HALF_EVEN`, `REJECT_AT_AIRLOCK`),
//                        enforce epistemic ceilings (`MODEL_OR_AGENT -> HYPOTHESIS`,
//                        `HUMAN_OPERATOR <= CLAIM`), and sign `CAELUS_INTEL_V2` batch
//   • `validate`       — verify candidate `.airlock.ndjson` / wire batch against
//                        `source_manifest.json` without mutating engine state
//   • `evaluate-slice` — run bi-temporal `cutoff_learned_at_ms` slice replay (`caelus_core`)
//                        and optionally seal `INGEST_REJECTED` / `SLICE_EVALUATION` to audit log
//   • `explain`        — trace verdict back to `event_id`, `source_id`, `applied_rule_id`,
//                        assumption ranges, missing/conflicting evidence, and `audit_log` hashes

use std::collections::BTreeMap;
use std::env;
use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::Path;
use std::process::ExitCode;

use caelus_core::airlock::{
    format_i64_decimal_ascii, format_u64_decimal_ascii, parse_i64_decimal_ascii,
    parse_u64_decimal_ascii, EpistemicStatus, SlicePolicy,
};
use caelus_network::airlock_adapters::{AirlockSourceAdapter, UnsignedAirlockEvent};
use caelus_network::airlock_host::{
    decode_hex_exact, encode_hex_lower, evaluate_airlock_batch_slice,
    evaluate_counterfactual_branch, format_counterfactual_outcome_json, format_slice_outcome_json,
    format_validation_summary_json, normalize_and_sign_v2_multimetric_record,
    normalize_and_sign_v2_record, parse_strict_json, seal_operator_action_card_to_audit,
    validate_airlock_batch, verify_audit_chain_file, AirlockJsonVal, AirlockSourceManifest,
    CounterfactualIntervention, MultiMetricSidecarInput, RawSidecarInput, SignedAirlockPacket,
    SourceOriginClass,
};
use caelus_network::audit_log::escape_audit_json_str;
use ed25519_dalek::SigningKey;

fn load_seed_arg(spec: &str) -> Result<[u8; 32], String> {
    let trimmed = spec.trim();
    if let Some(file_path) = trimmed.strip_prefix('@') {
        let raw = fs::read_to_string(file_path.trim())
            .map_err(|e| format!("failed to read seed file {:?}: {}", file_path, e))?;
        let clean = raw
            .lines()
            .map(|l| l.split('#').next().unwrap_or("").trim())
            .find(|l| !l.is_empty())
            .ok_or_else(|| format!("seed file {:?} is empty", file_path))?;
        return decode_hex_exact::<32>(clean)
            .ok_or_else(|| format!("seed file {:?} does not contain 64 hex chars", file_path));
    }
    if trimmed.len() == 64 {
        if let Some(seed) = decode_hex_exact::<32>(trimmed) {
            return Ok(seed);
        }
    }
    if Path::new(trimmed).is_file() {
        let bytes =
            fs::read(trimmed).map_err(|e| format!("failed to read seed file: {}", e))?;
        if bytes.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            return Ok(arr);
        }
        let text = String::from_utf8_lossy(&bytes);
        let clean = text.trim();
        if let Some(seed) = decode_hex_exact::<32>(clean) {
            return Ok(seed);
        }
    }
    Err("seed must be 64 hex chars, @<hex_seed_file>, or a 32-byte key file".to_owned())
}

fn parse_u64_hex_or_dec(s: &str) -> Option<u64> {
    let t = s.trim();
    if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        u64::from_str_radix(hex, 16).ok()
    } else {
        parse_u64_decimal_ascii(t)
    }
}

fn json_val_to_decimal_str(v: &AirlockJsonVal) -> Option<String> {
    match v {
        AirlockJsonVal::Str(s) => Some(s.clone()),
        AirlockJsonVal::Int(i) => Some(i.to_string()),
        AirlockJsonVal::Float(f) => Some(f.clone()),
        _ => None,
    }
}

fn json_val_to_i64_strict(v: &AirlockJsonVal) -> Option<i64> {
    match v {
        AirlockJsonVal::Str(s) => parse_i64_decimal_ascii(s),
        AirlockJsonVal::Int(i) => i64::try_from(*i).ok(),
        _ => None,
    }
}

fn json_val_to_u64_strict(v: &AirlockJsonVal) -> Option<u64> {
    match v {
        AirlockJsonVal::Str(s) => parse_u64_decimal_ascii(s),
        AirlockJsonVal::Int(i) => u64::try_from(*i).ok(),
        _ => None,
    }
}

fn parse_raw_json_item(
    obj: &std::collections::BTreeMap<String, AirlockJsonVal>,
    default_source_id: &str,
    default_key_id: &str,
    default_origin: SourceOriginClass,
    default_rule_id: &str,
) -> Result<RawSidecarInput, String> {
    let source_id = obj
        .get("source_id")
        .and_then(|v| v.as_str())
        .unwrap_or(default_source_id)
        .to_owned();
    let key_id = obj
        .get("key_id")
        .and_then(|v| v.as_str())
        .unwrap_or(default_key_id)
        .to_owned();
    let event_kind = obj
        .get("event_kind")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing event_kind".to_owned())?
        .to_owned();
    let event_id = obj
        .get("event_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing event_id".to_owned())?
        .to_owned();
    let seq_no = obj
        .get("seq_no")
        .and_then(json_val_to_u64_strict)
        .ok_or_else(|| "missing or invalid seq_no".to_owned())?;
    let observed_at_ms = obj
        .get("observed_at_ms")
        .and_then(json_val_to_i64_strict)
        .ok_or_else(|| "missing or invalid observed_at_ms".to_owned())?;
    let learned_at_ms = obj
        .get("learned_at_ms")
        .and_then(json_val_to_i64_strict)
        .ok_or_else(|| "missing or invalid learned_at_ms".to_owned())?;

    let origin_class = match obj.get("origin_class").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => {
            SourceOriginClass::parse(s).ok_or_else(|| format!("unknown origin_class {:?}", s))?
        }
        _ => default_origin,
    };

    let explicit_epistemic_status = match obj.get("epistemic_status") {
        None | Some(AirlockJsonVal::Null) => None,
        Some(AirlockJsonVal::Str(s)) if s.is_empty() => None,
        Some(AirlockJsonVal::Str(s)) => Some(
            EpistemicStatus::parse(s)
                .ok_or_else(|| format!("unknown epistemic_status {:?}", s))?,
        ),
        _ => return Err("epistemic_status must be string".to_owned()),
    };

    let subject_id = obj
        .get("subject_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing subject_id".to_owned())?
        .to_owned();
    let metric_key = obj
        .get("metric_key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing metric_key".to_owned())?
        .to_owned();
    let raw_decimal_value = obj
        .get("value")
        .or_else(|| obj.get("raw_value"))
        .and_then(json_val_to_decimal_str)
        .ok_or_else(|| "missing value".to_owned())?;
    let unit = obj
        .get("unit")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing unit".to_owned())?
        .to_owned();
    let conversion_rule_id = obj
        .get("rule_id")
        .and_then(|v| v.as_str())
        .unwrap_or(default_rule_id)
        .to_owned();
    let supersedes_event_id = match obj.get("supersedes_event_id") {
        None | Some(AirlockJsonVal::Null) => None,
        Some(AirlockJsonVal::Str(s)) if s.is_empty() => None,
        Some(AirlockJsonVal::Str(s)) => Some(s.clone()),
        _ => return Err("supersedes_event_id must be string or null".to_owned()),
    };
    let note = obj
        .get("note")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned();

    Ok(RawSidecarInput {
        source_id,
        key_id,
        event_kind,
        event_id,
        seq_no,
        observed_at_ms,
        learned_at_ms,
        origin_class,
        explicit_epistemic_status,
        subject_id,
        metric_key,
        raw_decimal_value,
        unit,
        conversion_rule_id,
        supersedes_event_id,
        note,
    })
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    let _ = chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == ',' {
            fields.push(cur.trim().to_owned());
            cur.clear();
        } else {
            cur.push(c);
        }
    }
    fields.push(cur.trim().to_owned());
    fields
}

fn parse_raw_inputs(
    content: &str,
    default_source_id: &str,
    default_key_id: &str,
    default_origin: SourceOriginClass,
    default_rule_id: &str,
) -> Result<Vec<RawSidecarInput>, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if trimmed.starts_with('[') {
        let root = parse_strict_json(trimmed)?;
        let arr = root
            .as_arr()
            .ok_or_else(|| "expected JSON array".to_owned())?;
        let mut out = Vec::with_capacity(arr.len());
        for (i, v) in arr.iter().enumerate() {
            let obj = v
                .as_obj()
                .ok_or_else(|| format!("array item {} must be JSON object", i))?;
            out.push(parse_raw_json_item(
                obj,
                default_source_id,
                default_key_id,
                default_origin,
                default_rule_id,
            )?);
        }
        return Ok(out);
    }
    if trimmed.starts_with('{') {
        let mut out = Vec::new();
        for (idx, line) in trimmed.lines().enumerate() {
            let l = line.trim();
            if l.is_empty() {
                continue;
            }
            let val =
                parse_strict_json(l).map_err(|e| format!("NDJSON line {}: {}", idx + 1, e))?;
            let obj = val
                .as_obj()
                .ok_or_else(|| format!("NDJSON line {} must be object", idx + 1))?;
            out.push(parse_raw_json_item(
                obj,
                default_source_id,
                default_key_id,
                default_origin,
                default_rule_id,
            )?);
        }
        return Ok(out);
    }

    // CSV format:
    // event_kind,event_id,seq_no,observed_at_ms,learned_at_ms,subject_id,metric_key,value,unit[,epistemic_status[,supersedes_event_id[,note]]]
    let mut out = Vec::new();
    for (idx, line) in content.lines().enumerate() {
        let l = line.trim();
        if l.is_empty() || l.starts_with('#') {
            continue;
        }
        if idx == 0 && l.starts_with("event_kind,") {
            continue;
        }
        let cols = split_csv_line(l);
        if cols.len() < 9 {
            return Err(format!(
                "CSV line {} expected at least 9 columns, got {}",
                idx + 1,
                cols.len()
            ));
        }
        let seq_no = parse_u64_decimal_ascii(&cols[2])
            .ok_or_else(|| format!("CSV line {} invalid seq_no", idx + 1))?;
        let observed_at_ms = parse_i64_decimal_ascii(&cols[3])
            .ok_or_else(|| format!("CSV line {} invalid observed_at_ms", idx + 1))?;
        let learned_at_ms = parse_i64_decimal_ascii(&cols[4])
            .ok_or_else(|| format!("CSV line {} invalid learned_at_ms", idx + 1))?;
        let explicit_epistemic_status = match cols.get(9).map(|s| s.as_str()) {
            None | Some("") => None,
            Some(s) => Some(
                EpistemicStatus::parse(s)
                    .ok_or_else(|| format!("CSV line {} invalid epistemic_status", idx + 1))?,
            ),
        };
        let supersedes_event_id = match cols.get(10).map(|s| s.as_str()) {
            None | Some("") => None,
            Some(s) => Some(s.to_owned()),
        };
        let note = cols.get(11).cloned().unwrap_or_default();

        out.push(RawSidecarInput {
            source_id: default_source_id.to_owned(),
            key_id: default_key_id.to_owned(),
            event_kind: cols[0].clone(),
            event_id: cols[1].clone(),
            seq_no,
            observed_at_ms,
            learned_at_ms,
            origin_class: default_origin,
            explicit_epistemic_status,
            subject_id: cols[5].clone(),
            metric_key: cols[6].clone(),
            raw_decimal_value: cols[7].clone(),
            unit: cols[8].clone(),
            conversion_rule_id: default_rule_id.to_owned(),
            supersedes_event_id,
            note,
        });
    }
    Ok(out)
}

fn cmd_pubkey(args: &[String]) -> Result<(), String> {
    let mut seed_spec: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--seed" => {
                i += 1;
                seed_spec = args.get(i).cloned();
            }
            other => return Err(format!("unknown option for pubkey: {}", other)),
        }
        i += 1;
    }
    let spec = seed_spec.ok_or_else(|| "pubkey requires --seed <64hex|@file>".to_owned())?;
    let seed = load_seed_arg(&spec)?;
    let vk = SigningKey::from_bytes(&seed).verifying_key();
    println!("{}", encode_hex_lower(vk.as_bytes()));
    Ok(())
}

fn cmd_normalize(args: &[String]) -> Result<(), String> {
    let mut input_path: Option<String> = None;
    let mut output_path: Option<String> = None;
    let mut source_id = String::new();
    let mut key_id = String::new();
    let mut seed_spec: Option<String> = None;
    let mut origin = SourceOriginClass::HumanOperator;
    let mut rule_id = "NORM_DECIMAL_FP1E6_HALF_EVEN_V1".to_owned();
    let mut wire_format = false;
    let mut preserve_order = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--input" => {
                i += 1;
                input_path = args.get(i).cloned();
            }
            "--output" => {
                i += 1;
                output_path = args.get(i).cloned();
            }
            "--source-id" => {
                i += 1;
                source_id = args.get(i).cloned().unwrap_or_default();
            }
            "--key-id" => {
                i += 1;
                key_id = args.get(i).cloned().unwrap_or_default();
            }
            "--seed" => {
                i += 1;
                seed_spec = args.get(i).cloned();
            }
            "--origin" => {
                i += 1;
                let s = args.get(i).map(|v| v.as_str()).unwrap_or("");
                origin = SourceOriginClass::parse(s)
                    .ok_or_else(|| format!("unknown --origin {:?}", s))?;
            }
            "--rule-id" => {
                i += 1;
                rule_id = args.get(i).cloned().unwrap_or_default();
            }
            "--wire" => wire_format = true,
            "--preserve-order" => preserve_order = true,
            other => return Err(format!("unknown option for normalize: {}", other)),
        }
        i += 1;
    }

    let in_file = input_path.ok_or_else(|| "normalize requires --input <file>".to_owned())?;
    let out_file = output_path.ok_or_else(|| "normalize requires --output <file>".to_owned())?;
    let seed = load_seed_arg(
        &seed_spec.ok_or_else(|| "normalize requires --seed <64hex|@file>".to_owned())?,
    )?;
    let content = fs::read_to_string(&in_file)
        .map_err(|e| format!("failed to read {:?}: {}", in_file, e))?;

    let raw_items = parse_raw_inputs(&content, &source_id, &key_id, origin, &rule_id)?;
    let mut signed_packets: Vec<SignedAirlockPacket> = Vec::with_capacity(raw_items.len());
    for (idx, item) in raw_items.iter().enumerate() {
        let pkt = normalize_and_sign_v2_record(item, &seed).map_err(|(code, msg)| {
            format!("record {} rejected ({}): {}", idx, code.as_str(), msg)
        })?;
        signed_packets.push(pkt);
    }

    if !preserve_order {
        signed_packets.sort_by_key(|p| p.learned_at_ms);
    }

    let mut out_buf = String::new();
    for pkt in &signed_packets {
        if wire_format {
            out_buf.push_str(&pkt.to_wire_envelope());
        } else {
            out_buf.push_str(&pkt.to_ndjson_line());
            out_buf.push('\n');
        }
    }
    fs::write(&out_file, out_buf.as_bytes())
        .map_err(|e| format!("failed to write {:?}: {}", out_file, e))?;
    println!(
        "{{\"ok\":true,\"normalized_count\":{},\"output\":\"{}\"}}",
        signed_packets.len(),
        escape_audit_json_str(&out_file)
    );
    Ok(())
}

fn cmd_validate(args: &[String]) -> Result<ExitCode, String> {
    let mut batch_path: Option<String> = None;
    let mut manifest_path: Option<String> = None;
    let mut strict = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--batch" => {
                i += 1;
                batch_path = args.get(i).cloned();
            }
            "--manifest" => {
                i += 1;
                manifest_path = args.get(i).cloned();
            }
            "--strict" => strict = true,
            other => return Err(format!("unknown option for validate: {}", other)),
        }
        i += 1;
    }

    let b_path = batch_path.ok_or_else(|| "validate requires --batch <file>".to_owned())?;
    let m_path = manifest_path.ok_or_else(|| "validate requires --manifest <file>".to_owned())?;

    let batch_raw =
        fs::read_to_string(&b_path).map_err(|e| format!("failed to read batch: {}", e))?;
    let manifest_raw =
        fs::read_to_string(&m_path).map_err(|e| format!("failed to read manifest: {}", e))?;
    let manifest = AirlockSourceManifest::parse_json(&manifest_raw)?;

    let summary = validate_airlock_batch(&batch_raw, &manifest)?;
    println!("{}", format_validation_summary_json(&summary));
    if strict && summary.rejected_count > 0 {
        Ok(ExitCode::from(1))
    } else {
        Ok(ExitCode::SUCCESS)
    }
}

fn parse_policy_and_eval_args(
    args: &[String],
) -> Result<
    (
        String,
        String,
        i64,
        SlicePolicy,
        Option<String>,
        Option<[u8; 32]>,
        u64,
        bool,
    ),
    String,
> {
    let mut batch_path: Option<String> = None;
    let mut manifest_path: Option<String> = None;
    let mut cutoff_str: Option<String> = None;
    let mut policy = SlicePolicy::default();
    let mut audit_log_path: Option<String> = None;
    let mut audit_seed: Option<[u8; 32]> = None;
    let mut audit_session_id: u64 = 0xCAE1_A121_0001u64;
    let mut det_clock = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--batch" => {
                i += 1;
                batch_path = args.get(i).cloned();
            }
            "--manifest" => {
                i += 1;
                manifest_path = args.get(i).cloned();
            }
            "--cutoff-ms" => {
                i += 1;
                cutoff_str = args.get(i).cloned();
            }
            "--scenario-id" => {
                i += 1;
                policy.scenario_id = args
                    .get(i)
                    .cloned()
                    .ok_or_else(|| "missing --scenario-id value".to_owned())?;
            }
            "--policy-id" => {
                i += 1;
                policy.policy_id = args
                    .get(i)
                    .cloned()
                    .ok_or_else(|| "missing --policy-id value".to_owned())?;
            }
            "--max-allowed-fp" => {
                i += 1;
                let s = args
                    .get(i)
                    .ok_or_else(|| "missing --max-allowed-fp value".to_owned())?;
                policy.max_allowed_fp = parse_i64_decimal_ascii(s)
                    .ok_or_else(|| "--max-allowed-fp must be decimal i64".to_owned())?;
            }
            "--conflict-threshold-fp" => {
                i += 1;
                let s = args
                    .get(i)
                    .ok_or_else(|| "missing --conflict-threshold-fp value".to_owned())?;
                policy.conflict_divergence_threshold_fp = parse_i64_decimal_ascii(s)
                    .ok_or_else(|| "--conflict-threshold-fp must be decimal i64".to_owned())?;
            }
            "--min-groups" => {
                i += 1;
                let s = args
                    .get(i)
                    .ok_or_else(|| "missing --min-groups value".to_owned())?;
                policy.min_independent_groups_for_pass = s
                    .parse::<usize>()
                    .map_err(|_| "--min-groups must be usize".to_owned())?;
            }
            "--audit-log" => {
                i += 1;
                audit_log_path = args.get(i).cloned();
            }
            "--audit-seed" => {
                i += 1;
                let s = args
                    .get(i)
                    .ok_or_else(|| "missing --audit-seed value".to_owned())?;
                audit_seed = Some(load_seed_arg(s)?);
            }
            "--audit-session-id" => {
                i += 1;
                let s = args
                    .get(i)
                    .ok_or_else(|| "missing --audit-session-id value".to_owned())?;
                audit_session_id = parse_u64_hex_or_dec(s)
                    .ok_or_else(|| "--audit-session-id must be u64 decimal or 0x hex".to_owned())?;
            }
            "--det-clock" => det_clock = true,
            other => return Err(format!("unknown option: {}", other)),
        }
        i += 1;
    }

    let b_path = batch_path.ok_or_else(|| "requires --batch <file>".to_owned())?;
    let m_path = manifest_path.ok_or_else(|| "requires --manifest <file>".to_owned())?;
    let c_raw = cutoff_str.ok_or_else(|| "requires --cutoff-ms <decimal_i64>".to_owned())?;
    let cutoff_ms = parse_i64_decimal_ascii(&c_raw)
        .ok_or_else(|| "--cutoff-ms must be a valid signed 64-bit decimal string".to_owned())?;

    Ok((
        b_path,
        m_path,
        cutoff_ms,
        policy,
        audit_log_path,
        audit_seed,
        audit_session_id,
        det_clock,
    ))
}

fn cmd_evaluate_slice(args: &[String]) -> Result<(), String> {
    let (
        b_path,
        m_path,
        cutoff_ms,
        policy,
        audit_log_path,
        audit_seed,
        audit_session_id,
        det_clock,
    ) = parse_policy_and_eval_args(args)?;

    let batch_raw =
        fs::read_to_string(&b_path).map_err(|e| format!("failed to read batch: {}", e))?;
    let manifest_raw =
        fs::read_to_string(&m_path).map_err(|e| format!("failed to read manifest: {}", e))?;
    let manifest = AirlockSourceManifest::parse_json(&manifest_raw)?;

    let outcome = evaluate_airlock_batch_slice(
        &batch_raw,
        &manifest,
        policy,
        cutoff_ms,
        audit_log_path.as_deref(),
        audit_seed,
        audit_session_id,
        det_clock,
    )?;
    println!("{}", format_slice_outcome_json(&outcome));
    Ok(())
}

fn extract_audit_trace_json(audit_path: &str) -> Result<String, String> {
    let content = fs::read_to_string(audit_path)
        .map_err(|e| format!("failed to read audit log {:?}: {}", audit_path, e))?;
    let mut entries_json = String::new();
    let mut seal_head = String::new();
    let mut seal_pubkey = String::new();
    let mut count = 0usize;

    for line in content.lines() {
        let l = line.trim();
        if l.is_empty() {
            continue;
        }
        let val = parse_strict_json(l)?;
        let Some(obj) = val.as_obj() else { continue };
        let rec_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if rec_type == "SEAL" {
            seal_head = obj
                .get("chain_head")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            seal_pubkey = obj
                .get("pubkey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
        } else if rec_type == "EVENT" {
            let seq = obj
                .get("seq")
                .and_then(|v| v.as_i128())
                .unwrap_or(0)
                .to_string();
            let hash = obj.get("hash").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(ev_obj) = obj.get("event").and_then(|v| v.as_obj()) {
                let ev_type = ev_obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if matches!(
                    ev_type,
                    "SLICE_EVALUATION"
                        | "INGEST_REJECTED"
                        | "SECURITY_ALERT_EQUIVOCATION"
                        | "OPERATOR_ACTION_CARD_APPROVED"
                ) {
                    if count > 0 {
                        entries_json.push(',');
                    }
                    count += 1;
                    let ev_id = ev_obj
                        .get("event_id")
                        .or_else(|| ev_obj.get("card_id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let err_code = ev_obj
                        .get("error_code")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let state_b3 = ev_obj
                        .get("state_blake3")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let _ = write!(
                        entries_json,
                        "{{\"audit_seq\":\"{}\",\"audit_hash\":\"{}\",\"event_type\":\"{}\",\"event_id\":\"{}\",\"error_code\":\"{}\",\"state_blake3\":\"{}\"}}",
                        escape_audit_json_str(&seq),
                        escape_audit_json_str(hash),
                        escape_audit_json_str(ev_type),
                        escape_audit_json_str(ev_id),
                        escape_audit_json_str(err_code),
                        escape_audit_json_str(state_b3)
                    );
                }
            }
        }
    }

    let chain_ok = verify_audit_chain_file(audit_path).unwrap_or(false);
    Ok(format!(
        "{{\"seal_chain_head\":\"{}\",\"seal_pubkey\":\"{}\",\"audit_chain_verified\":{},\"matched_audit_events\":[{}]}}",
        escape_audit_json_str(&seal_head),
        escape_audit_json_str(&seal_pubkey),
        if chain_ok { "true" } else { "false" },
        entries_json
    ))
}

fn cmd_explain(args: &[String]) -> Result<(), String> {
    // Support both full slice explain (`--batch ... --manifest ... --cutoff-ms ...`)
    // AND audit-bound lookup (`--state-blake3 <64hex> --audit-log <path>` — §3.1 item 4).
    let mut state_blake3_filter: Option<String> = None;
    let mut filtered_args: Vec<String> = Vec::new();
    let mut idx = 0;
    while idx < args.len() {
        if args[idx] == "--state-blake3" {
            idx += 1;
            state_blake3_filter = args.get(idx).cloned();
        } else {
            filtered_args.push(args[idx].clone());
        }
        idx += 1;
    }

    let has_batch = filtered_args.iter().any(|a| a == "--batch");
    if !has_batch {
        let mut audit_log_path: Option<String> = None;
        let mut j = 0;
        while j < filtered_args.len() {
            if filtered_args[j] == "--audit-log" {
                j += 1;
                audit_log_path = filtered_args.get(j).cloned();
            }
            j += 1;
        }
        let target_b3 = state_blake3_filter
            .ok_or_else(|| "explain without --batch requires --state-blake3 <64hex>".to_owned())?;
        let audit_path = audit_log_path
            .ok_or_else(|| "explain without --batch requires --audit-log <file>".to_owned())?;
        let trace_raw = extract_audit_trace_json(&audit_path)?;
        let trace_val = parse_strict_json(&trace_raw)?;
        let trace_obj = trace_val.as_obj().ok_or("invalid trace obj")?;
        let seal_pubkey = trace_obj
            .get("seal_pubkey")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let chain_verified = trace_obj
            .get("audit_chain_verified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let mut triggered_rules: Vec<String> = Vec::new();
        if Path::new(&audit_path).is_file() {
            let content = fs::read_to_string(&audit_path).unwrap_or_default();
            for ln in content.lines() {
                if let Ok(v) = parse_strict_json(ln.trim()) {
                    if let Some(ev_obj) = v
                        .as_obj()
                        .and_then(|o| o.get("event"))
                        .and_then(|e| e.as_obj())
                    {
                        if ev_obj.get("state_blake3").and_then(|x| x.as_str()) == Some(target_b3.as_str()) {
                            if let Some(rule) = ev_obj.get("applied_rule_id").and_then(|x| x.as_str()) {
                                if !rule.is_empty() {
                                    triggered_rules.push(format!("\"{}\"", escape_audit_json_str(rule)));
                                }
                            }
                        }
                    }
                }
            }
        }
        println!(
            "{{\"ok\":true,\"state_blake3\":\"{}\",\"triggered_rules\":[{}],\"supporting_events\":[],\"audit_chain_verified\":{},\"seal_signer_pubkey\":\"{}\",\"audit_log_trace\":{},\"human_approval_required\":true,\"write_authority\":\"NONE\"}}",
            escape_audit_json_str(&target_b3),
            triggered_rules.join(","),
            if chain_verified { "true" } else { "false" },
            escape_audit_json_str(seal_pubkey),
            trace_raw
        );
        return Ok(());
    }

    let (b_path, m_path, cutoff_ms, policy, existing_audit_log, _, _, _) =
        parse_policy_and_eval_args(&filtered_args)?;

    let batch_raw =
        fs::read_to_string(&b_path).map_err(|e| format!("failed to read batch: {}", e))?;
    let manifest_raw =
        fs::read_to_string(&m_path).map_err(|e| format!("failed to read manifest: {}", e))?;
    let manifest = AirlockSourceManifest::parse_json(&manifest_raw)?;

    // Read-only evaluation (does NOT write to existing_audit_log; inspects it if present!)
    let outcome =
        evaluate_airlock_batch_slice(&batch_raw, &manifest, policy, cutoff_ms, None, None, 0, false)?;
    let rep = &outcome.report;

    if let Some(ref expected_b3) = state_blake3_filter {
        if !expected_b3.is_empty() && !expected_b3.eq_ignore_ascii_case(&outcome.state_blake3) {
            return Err(format!(
                "state_blake3 mismatch: expected {}, evaluated {}",
                expected_b3, outcome.state_blake3
            ));
        }
    }

    let event_ids: Vec<String> = rep
        .active_assertions
        .iter()
        .map(|a| format!("\"{}\"", escape_audit_json_str(&a.event_id)))
        .collect();

    let mut assumptions_json = String::new();
    let mut supporting_events_json = String::new();
    for (i, a) in rep.active_assertions.iter().enumerate() {
        if i > 0 {
            assumptions_json.push(',');
            supporting_events_json.push(',');
        }
        let _ = write!(
            assumptions_json,
            "{{\"event_id\":\"{}\",\"source_id\":\"{}\",\"independence_group\":\"{}\",\"epistemic_status\":\"{}\",\"seq_no\":\"{}\",\"observed_at_ms\":\"{}\",\"learned_at_ms\":\"{}\",\"fp_val\":\"{}\",\"unit\":\"{}\",\"note\":\"{}\"}}",
            escape_audit_json_str(&a.event_id),
            escape_audit_json_str(&a.source_id),
            escape_audit_json_str(&a.independence_group),
            a.epistemic_status.as_str(),
            format_u64_decimal_ascii(a.seq_no),
            format_i64_decimal_ascii(a.observed_at_ms),
            format_i64_decimal_ascii(a.learned_at_ms),
            format_i64_decimal_ascii(a.fp_val),
            escape_audit_json_str(&a.unit),
            escape_audit_json_str(&a.note)
        );
        let _ = write!(
            supporting_events_json,
            "{{\"event_id\":\"{}\",\"source_id\":\"{}\",\"epistemic_status\":\"{}\",\"fp_val\":\"{}\"}}",
            escape_audit_json_str(&a.event_id),
            escape_audit_json_str(&a.source_id),
            a.epistemic_status.as_str(),
            format_i64_decimal_ascii(a.fp_val)
        );
    }

    let missing_json: Vec<String> = rep
        .missing_evidence
        .iter()
        .map(|m| format!("\"{}\"", escape_audit_json_str(m)))
        .collect();

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
            "{{\"subject_id\":\"{}\",\"metric_key\":\"{}\",\"min_fp_val\":\"{}\",\"max_fp_val\":\"{}\",\"source_ids\":[{}],\"event_ids\":[{}]}}",
            escape_audit_json_str(&c.subject_id),
            escape_audit_json_str(&c.metric_key),
            format_i64_decimal_ascii(c.min_fp_val),
            format_i64_decimal_ascii(c.max_fp_val),
            srcs.join(","),
            evs.join(",")
        );
    }

    let (audit_trace, audit_chain_verified, seal_signer_pubkey) = match existing_audit_log {
        Some(p) if Path::new(&p).is_file() => {
            let tr = extract_audit_trace_json(&p)?;
            let tv = parse_strict_json(&tr)?;
            let tobj = tv.as_obj();
            let ok = tobj
                .and_then(|o| o.get("audit_chain_verified"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let pk = tobj
                .and_then(|o| o.get("seal_pubkey"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            (tr, ok, pk)
        }
        _ => ("null".to_owned(), false, String::new()),
    };

    let min_fp_s = rep
        .min_assumption_fp
        .map(|v| format!("\"{}\"", format_i64_decimal_ascii(v)))
        .unwrap_or_else(|| "null".to_owned());
    let max_fp_s = rep
        .max_assumption_fp
        .map(|v| format!("\"{}\"", format_i64_decimal_ascii(v)))
        .unwrap_or_else(|| "null".to_owned());

    println!(
        "{{\"ok\":true,\"verdict\":\"{}\",\"applied_rule_id\":\"{}\",\"triggered_rules\":[\"{}\"],\"scenario_id\":\"{}\",\"policy_id\":\"{}\",\"cutoff_learned_at_ms\":\"{}\",\"input_batch_blake3\":\"{}\",\"state_blake3\":\"{}\",\"referenced_event_ids\":[{}],\"assumption_range_fp\":[{},{}],\"source_assumptions\":[{}],\"supporting_events\":[{}],\"missing_evidence\":[{}],\"conflicting_evidence\":[{}],\"audit_chain_verified\":{},\"seal_signer_pubkey\":\"{}\",\"audit_log_trace\":{},\"human_approval_required\":true,\"write_authority\":\"NONE\"}}",
        rep.verdict.as_str(),
        escape_audit_json_str(&rep.applied_rule_id),
        escape_audit_json_str(&rep.applied_rule_id),
        escape_audit_json_str(&rep.scenario_id),
        escape_audit_json_str(&rep.policy_id),
        format_i64_decimal_ascii(rep.cutoff_learned_at_ms),
        escape_audit_json_str(&outcome.input_batch_blake3),
        escape_audit_json_str(&outcome.state_blake3),
        event_ids.join(","),
        min_fp_s,
        max_fp_s,
        assumptions_json,
        supporting_events_json,
        missing_json.join(","),
        conflicts_json,
        if audit_chain_verified { "true" } else { "false" },
        escape_audit_json_str(&seal_signer_pubkey),
        audit_trace
    );
    Ok(())
}

fn cmd_counterfactual(args: &[String]) -> Result<(), String> {
    let mut branch_id = "cf_01".to_owned();
    let mut interventions_json: Option<String> = None;
    let mut shorthand_interventions: Vec<CounterfactualIntervention> = Vec::new();
    let mut eval_args: Vec<String> = Vec::new();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--branch-id" => {
                i += 1;
                branch_id = args
                    .get(i)
                    .cloned()
                    .ok_or_else(|| "missing --branch-id value".to_owned())?;
            }
            "--base-cutoff-ms" => {
                i += 1;
                let v = args
                    .get(i)
                    .cloned()
                    .ok_or_else(|| "missing --base-cutoff-ms value".to_owned())?;
                eval_args.push("--cutoff-ms".to_owned());
                eval_args.push(v);
            }
            "--interventions-json" => {
                i += 1;
                interventions_json = args.get(i).cloned();
            }
            "--intervention" => {
                i += 1;
                let spec = args
                    .get(i)
                    .ok_or_else(|| "missing --intervention target:field:fp_val".to_owned())?;
                let parts: Vec<&str> = spec.splitn(3, ':').collect();
                if parts.len() != 3 {
                    return Err("--intervention must be target_id:override_field:fp_val".to_owned());
                }
                let fp_val = parse_i64_decimal_ascii(parts[2])
                    .ok_or_else(|| "invalid decimal i64 fp_val in --intervention".to_owned())?;
                shorthand_interventions.push(CounterfactualIntervention {
                    target_id: parts[0].to_owned(),
                    override_field: parts[1].to_owned(),
                    fp_val,
                });
            }
            other => eval_args.push(other.to_owned()),
        }
        i += 1;
    }

    let (b_path, m_path, cutoff_ms, policy, _, _, _, _) = parse_policy_and_eval_args(&eval_args)?;
    let mut interventions = shorthand_interventions;
    if let Some(iv_raw) = interventions_json {
        let iv_val = parse_strict_json(&iv_raw)?;
        let iv_arr = iv_val
            .as_arr()
            .ok_or_else(|| "--interventions-json must be a JSON array".to_owned())?;
        for (idx, item) in iv_arr.iter().enumerate() {
            let obj = item
                .as_obj()
                .ok_or_else(|| format!("interventions[{}] must be an object", idx))?;
            let target_id = obj
                .get("target_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("interventions[{}] missing string target_id", idx))?
                .to_owned();
            let override_field = obj
                .get("override_field")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("interventions[{}] missing string override_field", idx))?
                .to_owned();
            let fp_str = obj
                .get("fp_val")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    format!(
                        "interventions[{}] fp_val must be a decimal ASCII string (64-bit JSON rule)",
                        idx
                    )
                })?;
            let fp_val = parse_i64_decimal_ascii(fp_str)
                .ok_or_else(|| format!("interventions[{}] invalid decimal i64 fp_val", idx))?;
            interventions.push(CounterfactualIntervention {
                target_id,
                override_field,
                fp_val,
            });
        }
    }
    if interventions.is_empty() {
        return Err(
            "counterfactual requires --interventions-json '<json_array>' or --intervention target:field:fp_val"
                .to_owned(),
        );
    }

    let batch_raw =
        fs::read_to_string(&b_path).map_err(|e| format!("failed to read batch: {}", e))?;
    let manifest_raw =
        fs::read_to_string(&m_path).map_err(|e| format!("failed to read manifest: {}", e))?;
    let manifest = AirlockSourceManifest::parse_json(&manifest_raw)?;

    let cf = evaluate_counterfactual_branch(
        &batch_raw,
        &manifest,
        policy,
        cutoff_ms,
        &branch_id,
        &interventions,
    )?;
    println!("{}", format_counterfactual_outcome_json(&cf));
    Ok(())
}

fn cmd_seal_action_card(args: &[String]) -> Result<(), String> {
    let mut audit_log = String::new();
    let mut card_id = String::new();
    let mut scenario_id = "AEGEAN_FERRY_01".to_owned();
    let mut verdict_context = "KURAL_İHLALİ".to_owned();
    let mut state_blake3 = String::new();
    let mut branch_state_blake3 = String::new();
    let mut approved_at_ms: i64 = 1_762_849_560_000;
    let mut operator_pubkey: Option<String> = None;
    let mut operator_sig: Option<String> = None;
    let mut operator_seed: Option<[u8; 32]> = None;
    let mut audit_seed: Option<[u8; 32]> = None;
    let mut session_id: u64 = 0xCAE1_C200_0001u64;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--audit-log" => {
                i += 1;
                audit_log = args.get(i).cloned().unwrap_or_default();
            }
            "--card-id" => {
                i += 1;
                card_id = args.get(i).cloned().unwrap_or_default();
            }
            "--scenario-id" => {
                i += 1;
                scenario_id = args.get(i).cloned().unwrap_or_default();
            }
            "--verdict-context" => {
                i += 1;
                verdict_context = args.get(i).cloned().unwrap_or_default();
            }
            "--state-blake3" => {
                i += 1;
                state_blake3 = args.get(i).cloned().unwrap_or_default();
            }
            "--branch-state-blake3" => {
                i += 1;
                branch_state_blake3 = args.get(i).cloned().unwrap_or_default();
            }
            "--approved-at-ms" => {
                i += 1;
                let s = args.get(i).map(|v| v.as_str()).unwrap_or("");
                approved_at_ms = parse_i64_decimal_ascii(s)
                    .ok_or_else(|| "--approved-at-ms must be decimal i64".to_owned())?;
            }
            "--operator-pubkey" => {
                i += 1;
                operator_pubkey = args.get(i).cloned();
            }
            "--operator-sig" => {
                i += 1;
                operator_sig = args.get(i).cloned();
            }
            "--operator-seed" => {
                i += 1;
                let s = args.get(i).map(|v| v.as_str()).unwrap_or("");
                operator_seed = Some(load_seed_arg(s)?);
            }
            "--audit-seed" => {
                i += 1;
                let s = args.get(i).map(|v| v.as_str()).unwrap_or("");
                audit_seed = Some(load_seed_arg(s)?);
            }
            "--audit-session-id" => {
                i += 1;
                let s = args.get(i).map(|v| v.as_str()).unwrap_or("");
                session_id = parse_u64_hex_or_dec(s)
                    .ok_or_else(|| "invalid --audit-session-id".to_owned())?;
            }
            other => return Err(format!("unknown option for seal-action-card: {}", other)),
        }
        i += 1;
    }

    let json = seal_operator_action_card_to_audit(
        &audit_log,
        &card_id,
        &scenario_id,
        &verdict_context,
        &state_blake3,
        &branch_state_blake3,
        approved_at_ms,
        operator_pubkey.as_deref(),
        operator_sig.as_deref(),
        operator_seed,
        audit_seed,
        session_id,
    )?;
    println!("{}", json);
    Ok(())
}

fn cmd_ingest_adapter(args: &[String]) -> Result<(), String> {
    let mut adapter_kind = String::new();
    let mut input_path = String::new();
    let mut output_path = String::new();
    let mut source_id = String::new();
    let mut key_id = String::new();
    let mut seed_spec: Option<String> = None;
    let mut learned_at_ms: i64 = 1_762_849_500_000;
    let mut start_seq: u64 = 1;
    let mut wire = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--adapter" => {
                i += 1;
                adapter_kind = args.get(i).cloned().unwrap_or_default();
            }
            "--input" => {
                i += 1;
                input_path = args.get(i).cloned().unwrap_or_default();
            }
            "--output" => {
                i += 1;
                output_path = args.get(i).cloned().unwrap_or_default();
            }
            "--source-id" => {
                i += 1;
                source_id = args.get(i).cloned().unwrap_or_default();
            }
            "--key-id" => {
                i += 1;
                key_id = args.get(i).cloned().unwrap_or_default();
            }
            "--seed" => {
                i += 1;
                seed_spec = args.get(i).cloned();
            }
            "--learned-at-ms" => {
                i += 1;
                let s = args.get(i).map(|v| v.as_str()).unwrap_or("");
                learned_at_ms = parse_i64_decimal_ascii(s)
                    .ok_or_else(|| "--learned-at-ms must be decimal i64".to_owned())?;
            }
            "--start-seq" => {
                i += 1;
                let s = args.get(i).map(|v| v.as_str()).unwrap_or("");
                start_seq = parse_u64_decimal_ascii(s)
                    .ok_or_else(|| "--start-seq must be decimal u64".to_owned())?;
            }
            "--wire" => wire = true,
            other => return Err(format!("unknown option for ingest-adapter: {}", other)),
        }
        i += 1;
    }

    let seed = load_seed_arg(
        &seed_spec.ok_or_else(|| "ingest-adapter requires --seed <64hex|@file>".to_owned())?,
    )?;
    let raw = fs::read_to_string(&input_path)
        .map_err(|e| format!("failed to read {:?}: {}", input_path, e))?;

    let unsigned: Vec<UnsignedAirlockEvent> = match adapter_kind.as_str() {
        #[cfg(feature = "adapter_ais_stream")]
        "ais_stream" => {
            let mut ad = caelus_network::airlock_adapters::AisStreamAdapter::new(
                &source_id,
                &key_id,
                start_seq,
                learned_at_ms,
            );
            for ln in raw.lines().filter(|l| !l.trim().is_empty()) {
                ad.push_raw_frame(ln);
            }
            ad.poll_normalized_batch(10_000).map_err(|e| e.to_string())?
        }
        #[cfg(feature = "adapter_open_meteo")]
        "open_meteo" => {
            let mut ad = caelus_network::airlock_adapters::OpenMeteoMarineAdapter::new(
                &source_id,
                &key_id,
                start_seq,
                learned_at_ms,
            );
            ad.push_forecast_json(raw);
            ad.poll_normalized_batch(10_000).map_err(|e| e.to_string())?
        }
        #[cfg(feature = "adapter_opensky")]
        "opensky" => {
            let mut ad = caelus_network::airlock_adapters::OpenSkyAdapter::new(
                &source_id,
                &key_id,
                start_seq,
                learned_at_ms,
            );
            ad.push_states_json(raw);
            ad.poll_normalized_batch(10_000).map_err(|e| e.to_string())?
        }
        #[cfg(feature = "adapter_nmea2000")]
        "nmea2000" => {
            let mut ad = caelus_network::airlock_adapters::Nmea2000Adapter::new(
                &source_id,
                &key_id,
                start_seq,
                learned_at_ms,
            );
            for ln in raw.lines().filter(|l| !l.trim().is_empty()) {
                ad.push_pgn_json(ln);
            }
            ad.poll_normalized_batch(10_000).map_err(|e| e.to_string())?
        }
        #[cfg(feature = "adapter_industrial_edge")]
        "industrial_edge" => {
            let mut ad = caelus_network::airlock_adapters::IndustrialEdgeAdapter::new(
                &source_id,
                &key_id,
                start_seq,
                learned_at_ms,
            );
            for ln in raw.lines().filter(|l| !l.trim().is_empty()) {
                ad.push_edge_telemetry_json(ln);
            }
            ad.poll_normalized_batch(10_000).map_err(|e| e.to_string())?
        }
        other => return Err(format!("unsupported or disabled adapter {:?}", other)),
    };

    let mut out_buf = String::new();
    for ev in &unsigned {
        let pkt = ev.sign_v2(&seed).map_err(|e| e.to_string())?;
        if wire {
            out_buf.push_str(&pkt.to_wire_envelope());
        } else {
            out_buf.push_str(&pkt.to_ndjson_line());
            out_buf.push('\n');
        }
    }
    fs::write(&output_path, out_buf.as_bytes())
        .map_err(|e| format!("failed to write {:?}: {}", output_path, e))?;
    println!(
        "{{\"ok\":true,\"adapter\":\"{}\",\"ingested_count\":{},\"output\":\"{}\"}}",
        escape_audit_json_str(&adapter_kind),
        unsigned.len(),
        escape_audit_json_str(&output_path)
    );
    Ok(())
}

fn deterministic_seed32(domain_label: &str) -> [u8; 32] {
    *blake3::hash(domain_label.as_bytes()).as_bytes()
}

fn cmd_build_aegean_pilot(args: &[String]) -> Result<(), String> {
    let mut manifest_out = "configs/source_manifest.json".to_owned();
    let mut scenario_dir = "scenarios/pilot_aegean_ferry_airlock".to_owned();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--manifest-out" => {
                i += 1;
                manifest_out = args.get(i).cloned().unwrap_or(manifest_out);
            }
            "--scenario-dir" => {
                i += 1;
                scenario_dir = args.get(i).cloned().unwrap_or(scenario_dir);
            }
            other => return Err(format!("unknown option for build-aegean-pilot: {}", other)),
        }
        i += 1;
    }

    let seed_anchor = deterministic_seed32("CAELUS_AEGEAN_TRUST_ANCHOR_2026_Q4");
    let seed_ais = deterministic_seed32("CAELUS_SOURCE_AIS_TERRESTRIAL_AEGEAN_2026_Q4");
    let seed_ops = deterministic_seed32("CAELUS_SOURCE_FERRY_OPERATOR_DISPATCH_2026_Q4");
    let seed_wx = deterministic_seed32("CAELUS_SOURCE_OPEN_METEO_MARINE_ENSEMBLE_2026_Q4");
    let seed_port = deterministic_seed32("CAELUS_SOURCE_PORT_BERTH_SENSOR_SIGACIK_2026_Q4");
    let seed_osky = deterministic_seed32("CAELUS_SOURCE_OPENSKY_AEGEAN_ADSB_2026_Q4");
    let seed_n2k = deterministic_seed32("CAELUS_SOURCE_NMEA2000_BRIDGE_BUS_2026_Q4");

    let pk_ais = encode_hex_lower(SigningKey::from_bytes(&seed_ais).verifying_key().as_bytes());
    let pk_ops = encode_hex_lower(SigningKey::from_bytes(&seed_ops).verifying_key().as_bytes());
    let pk_wx = encode_hex_lower(SigningKey::from_bytes(&seed_wx).verifying_key().as_bytes());
    let pk_port = encode_hex_lower(SigningKey::from_bytes(&seed_port).verifying_key().as_bytes());
    let pk_osky = encode_hex_lower(SigningKey::from_bytes(&seed_osky).verifying_key().as_bytes());
    let pk_n2k = encode_hex_lower(SigningKey::from_bytes(&seed_n2k).verifying_key().as_bytes());

    let unsigned_manifest_json = format!(
        "{{\n  \"manifest_version\": \"2.0\",\n  \"require_v2_airlock\": true,\n  \"sources\": [\n    {{\n      \"source_id\": \"ais_terrestrial_aegean\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"ais-key-2026-q4\",\n      \"independence_group\": \"rf_ais_receiver\",\n      \"default_epistemic_status\": \"OBSERVATION\",\n      \"allowed_event_kinds\": [\"VESSEL_POSITION\", \"BERTH_PROXIMITY\", \"AIS_SIGNAL_LOST\"],\n      \"max_staleness_ms\": \"120000\"\n    }},\n    {{\n      \"source_id\": \"ferry_operator_dispatch\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"ops-key-2026-q4\",\n      \"independence_group\": \"carrier_human_ops\",\n      \"default_epistemic_status\": \"CLAIM\",\n      \"allowed_event_kinds\": [\"SCHEDULE_REPORT\", \"DELAY_NOTICE\"],\n      \"max_staleness_ms\": \"900000\"\n    }},\n    {{\n      \"source_id\": \"open_meteo_marine_ensemble\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"wx-key-2026-q4\",\n      \"independence_group\": \"numerical_weather_model\",\n      \"default_epistemic_status\": \"HYPOTHESIS\",\n      \"allowed_event_kinds\": [\"WAVE_FORECAST\", \"WIND_GUST_ENVELOPE\"],\n      \"max_staleness_ms\": \"3600000\"\n    }},\n    {{\n      \"source_id\": \"port_berth_sensor_sigacik\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"port-key-2026-q4\",\n      \"independence_group\": \"port_plc_telemetry\",\n      \"default_epistemic_status\": \"OBSERVATION\",\n      \"allowed_event_kinds\": [\"BERTH_PROXIMITY\", \"RAMP_OBSERVATION\", \"SHORE_POWER_STATE\"],\n      \"max_staleness_ms\": \"180000\"\n    }},\n    {{\n      \"source_id\": \"opensky_aegean_adsb\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"osky-key-2026-q4\",\n      \"independence_group\": \"airspace_adsb_receiver\",\n      \"default_epistemic_status\": \"OBSERVATION\",\n      \"allowed_event_kinds\": [\"AIRCRAFT_STATE_VECTOR\", \"AIRSPACE_EMERGENCY_SQUAWK\"],\n      \"max_staleness_ms\": \"120000\"\n    }},\n    {{\n      \"source_id\": \"nmea2000_bridge_bus\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"n2k-key-2026-q4\",\n      \"independence_group\": \"vessel_canbus_sensors\",\n      \"default_epistemic_status\": \"OBSERVATION\",\n      \"allowed_event_kinds\": [\"N2K_WIND_DATA\", \"N2K_WATER_DEPTH\", \"N2K_RUDDER_ANGLE\", \"N2K_ENGINE_RAPID\"],\n      \"max_staleness_ms\": \"60000\"\n    }}\n  ]\n}}\n",
        pk_ais, pk_ops, pk_wx, pk_port, pk_osky, pk_n2k
    );
    let parsed_manifest = AirlockSourceManifest::parse_json(&unsigned_manifest_json)?;
    let (anchor_pk_hex, manifest_sig_hex) = parsed_manifest.sign_manifest_trust_anchor(&seed_anchor);

    let signed_manifest_json = format!(
        "{{\n  \"manifest_version\": \"2.0\",\n  \"require_v2_airlock\": true,\n  \"trust_anchor_pubkey\": \"{}\",\n  \"manifest_sig\": \"{}\",\n  \"sources\": [\n    {{\n      \"source_id\": \"ais_terrestrial_aegean\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"ais-key-2026-q4\",\n      \"independence_group\": \"rf_ais_receiver\",\n      \"default_epistemic_status\": \"OBSERVATION\",\n      \"allowed_event_kinds\": [\"VESSEL_POSITION\", \"BERTH_PROXIMITY\", \"AIS_SIGNAL_LOST\"],\n      \"max_staleness_ms\": \"120000\"\n    }},\n    {{\n      \"source_id\": \"ferry_operator_dispatch\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"ops-key-2026-q4\",\n      \"independence_group\": \"carrier_human_ops\",\n      \"default_epistemic_status\": \"CLAIM\",\n      \"allowed_event_kinds\": [\"SCHEDULE_REPORT\", \"DELAY_NOTICE\"],\n      \"max_staleness_ms\": \"900000\"\n    }},\n    {{\n      \"source_id\": \"open_meteo_marine_ensemble\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"wx-key-2026-q4\",\n      \"independence_group\": \"numerical_weather_model\",\n      \"default_epistemic_status\": \"HYPOTHESIS\",\n      \"allowed_event_kinds\": [\"WAVE_FORECAST\", \"WIND_GUST_ENVELOPE\"],\n      \"max_staleness_ms\": \"3600000\"\n    }},\n    {{\n      \"source_id\": \"port_berth_sensor_sigacik\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"port-key-2026-q4\",\n      \"independence_group\": \"port_plc_telemetry\",\n      \"default_epistemic_status\": \"OBSERVATION\",\n      \"allowed_event_kinds\": [\"BERTH_PROXIMITY\", \"RAMP_OBSERVATION\", \"SHORE_POWER_STATE\"],\n      \"max_staleness_ms\": \"180000\"\n    }},\n    {{\n      \"source_id\": \"opensky_aegean_adsb\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"osky-key-2026-q4\",\n      \"independence_group\": \"airspace_adsb_receiver\",\n      \"default_epistemic_status\": \"OBSERVATION\",\n      \"allowed_event_kinds\": [\"AIRCRAFT_STATE_VECTOR\", \"AIRSPACE_EMERGENCY_SQUAWK\"],\n      \"max_staleness_ms\": \"120000\"\n    }},\n    {{\n      \"source_id\": \"nmea2000_bridge_bus\",\n      \"pubkey_ed25519\": \"{}\",\n      \"key_id\": \"n2k-key-2026-q4\",\n      \"independence_group\": \"vessel_canbus_sensors\",\n      \"default_epistemic_status\": \"OBSERVATION\",\n      \"allowed_event_kinds\": [\"N2K_WIND_DATA\", \"N2K_WATER_DEPTH\", \"N2K_RUDDER_ANGLE\", \"N2K_ENGINE_RAPID\"],\n      \"max_staleness_ms\": \"60000\"\n    }}\n  ]\n}}\n",
        anchor_pk_hex, manifest_sig_hex, pk_ais, pk_ops, pk_wx, pk_port, pk_osky, pk_n2k
    );
    // Verify round-trip trust-anchor signature immediately:
    let verified_manifest = AirlockSourceManifest::parse_json(&signed_manifest_json)?;

    if let Some(parent) = Path::new(&manifest_out).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&manifest_out, signed_manifest_json.as_bytes()).map_err(|e| e.to_string())?;

    let mk_map = |pairs: &[(&str, &str)]| -> BTreeMap<String, String> {
        let mut m = BTreeMap::new();
        for &(k, v) in pairs {
            m.insert(k.to_owned(), v.to_owned());
        }
        m
    };

    // Build the 8-record Sığacık–Vathi / Aegean corridor multi-source timeline (sorted by `learned_at_ms`):
    // T1 = 1762848600000 (08:10 UTC) -> KANIT_YETERSİZ
    // 08:15 UTC -> intentional SOURCE_EQUIVOCATION negative record (0-bit state impact!)
    // T2 = 1762849500000 (08:25 UTC) -> KURAL_İHLALİ + CONFLICT_DETECTED (+15 dk CLAIM vs +35 dk OBSERVATION)
    let specs: Vec<(MultiMetricSidecarInput, [u8; 32])> = vec![
        (
            MultiMetricSidecarInput {
                source_id: "open_meteo_marine_ensemble".to_owned(),
                key_id: "wx-key-2026-q4".to_owned(),
                event_kind: "WAVE_FORECAST".to_owned(),
                event_id: "ev_101".to_owned(),
                seq_no: 1,
                observed_at_ms: 1_762_848_240_000,
                learned_at_ms: 1_762_848_300_000,
                origin_class: SourceOriginClass::ModelOrAgent,
                explicit_epistemic_status: Some(EpistemicStatus::Hypothesis),
                entity_id: "CORRIDOR_SIGACIK_VATHI".to_owned(),
                raw_decimal_metrics: mk_map(&[
                    ("ocean_current_kn_fp", "1.15"),
                    ("wave_m_fp", "1.85"),
                    ("wave_p50_m_fp", "1.75"),
                    ("wave_p95_m_fp", "2.45"),
                    ("wave_period_s_fp", "6.80"),
                ]),
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            },
            seed_wx,
        ),
        (
            MultiMetricSidecarInput {
                source_id: "ferry_operator_dispatch".to_owned(),
                key_id: "ops-key-2026-q4".to_owned(),
                event_kind: "DELAY_NOTICE".to_owned(),
                event_id: "ev_103".to_owned(),
                seq_no: 1,
                observed_at_ms: 1_762_848_570_000,
                learned_at_ms: 1_762_848_600_000, // T1 = 08:10 UTC
                origin_class: SourceOriginClass::HumanOperator,
                explicit_epistemic_status: Some(EpistemicStatus::Claim),
                entity_id: "VESSEL_AEGEAN_01".to_owned(),
                raw_decimal_metrics: mk_map(&[
                    ("delay_min_fp", "15.0"),
                    ("lat_deg_fp", "38.198100"),
                    ("lon_deg_fp", "26.839200"),
                ]),
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            },
            seed_ops,
        ),
        (
            MultiMetricSidecarInput {
                source_id: "open_meteo_marine_ensemble".to_owned(),
                key_id: "wx-key-2026-q4".to_owned(),
                event_kind: "WAVE_FORECAST".to_owned(),
                event_id: "ev_109".to_owned(),
                seq_no: 2,
                observed_at_ms: 1_762_848_580_000,
                learned_at_ms: 1_762_848_600_000, // T1 = 08:10 UTC
                origin_class: SourceOriginClass::ModelOrAgent,
                explicit_epistemic_status: Some(EpistemicStatus::Hypothesis),
                entity_id: "VESSEL_AEGEAN_01".to_owned(),
                raw_decimal_metrics: mk_map(&[
                    ("delay_min_fp", "18.0"),
                    ("wave_m_fp", "2.45"),
                    ("wave_p50_m_fp", "2.10"),
                    ("wave_p95_m_fp", "3.15"),
                    ("wind_gust_kn_fp", "31.0"),
                ]),
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            },
            seed_wx,
        ),
        // Intentional SOURCE_EQUIVOCATION tamper record at 08:15 UTC:
        // Reuses `(ferry_operator_dispatch, seq_no=1)` with conflicting payload (`+5 dk` instead of `+15 dk`)!
        (
            MultiMetricSidecarInput {
                source_id: "ferry_operator_dispatch".to_owned(),
                key_id: "ops-key-2026-q4".to_owned(),
                event_kind: "DELAY_NOTICE".to_owned(),
                event_id: "ev_103_equivocation".to_owned(),
                seq_no: 1,
                observed_at_ms: 1_762_848_890_000,
                learned_at_ms: 1_762_848_900_000,
                origin_class: SourceOriginClass::HumanOperator,
                explicit_epistemic_status: Some(EpistemicStatus::Claim),
                entity_id: "VESSEL_AEGEAN_01".to_owned(),
                raw_decimal_metrics: mk_map(&[("delay_min_fp", "5.0")]),
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            },
            seed_ops,
        ),
        // Airspace SAR patrol vector arriving at 08:21 UTC (observed 08:18:35 -> stale > 120s at T2 = 08:25!):
        (
            MultiMetricSidecarInput {
                source_id: "opensky_aegean_adsb".to_owned(),
                key_id: "osky-key-2026-q4".to_owned(),
                event_kind: "AIRCRAFT_STATE_VECTOR".to_owned(),
                event_id: "ev_102".to_owned(),
                seq_no: 1,
                observed_at_ms: 1_762_849_115_000,
                learned_at_ms: 1_762_849_260_000,
                origin_class: SourceOriginClass::CalibratedSensor,
                explicit_epistemic_status: Some(EpistemicStatus::Observation),
                entity_id: "SAR_HELI_AEGEAN_04".to_owned(),
                raw_decimal_metrics: mk_map(&[
                    ("baro_alt_m_fp", "450.0"),
                    ("delay_min_fp", "0.0"),
                    ("lat_deg_fp", "38.142000"),
                    ("lon_deg_fp", "26.811000"),
                    ("squawk_code_fp", "1200"),
                    ("velocity_mps_fp", "62.5"),
                ]),
                supersedes_event_id: None,
                unit_schema: "SI_AVIATION_V1".to_owned(),
            },
            seed_osky,
        ),
        // Exact §2.2 multi-metric AIS observation arriving at 08:23 UTC (+35 dk delay):
        (
            MultiMetricSidecarInput {
                source_id: "ais_terrestrial_aegean".to_owned(),
                key_id: "ais-key-2026-q4".to_owned(),
                event_kind: "VESSEL_POSITION".to_owned(),
                event_id: "ev_104".to_owned(),
                seq_no: 1,
                observed_at_ms: 1_762_849_360_000,
                learned_at_ms: 1_762_849_380_000,
                origin_class: SourceOriginClass::CalibratedSensor,
                explicit_epistemic_status: Some(EpistemicStatus::Observation),
                entity_id: "VESSEL_AEGEAN_01".to_owned(),
                raw_decimal_metrics: mk_map(&[
                    ("delay_min_fp", "35"),
                    ("lat_deg_fp", "38.195420"),
                    ("lon_deg_fp", "26.837110"),
                    ("sog_kn_fp", "14.2"),
                    ("wave_m_fp", "2.45"),
                ]),
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            },
            seed_ais,
        ),
        (
            MultiMetricSidecarInput {
                source_id: "nmea2000_bridge_bus".to_owned(),
                key_id: "n2k-key-2026-q4".to_owned(),
                event_kind: "N2K_WIND_DATA".to_owned(),
                event_id: "ev_105".to_owned(),
                seq_no: 1,
                observed_at_ms: 1_762_849_435_000,
                learned_at_ms: 1_762_849_440_000,
                origin_class: SourceOriginClass::CalibratedSensor,
                explicit_epistemic_status: Some(EpistemicStatus::Observation),
                entity_id: "BRIDGE_N2K_AEGEAN_01".to_owned(),
                raw_decimal_metrics: mk_map(&[
                    ("depth_m_fp", "42.8"),
                    ("rudder_angle_deg_fp", "-2.5"),
                    ("wind_angle_deg_fp", "42.5"),
                    ("wind_speed_mps_fp", "13.8"),
                ]),
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            },
            seed_n2k,
        ),
        // T2 = 1762849500000 (08:25 UTC): Independent berth PLC sensor corroboration (+35 dk)
        // with > 2^53 - 1 seq_no (`9007199254740993`) proving 64-bit string precision!
        (
            MultiMetricSidecarInput {
                source_id: "port_berth_sensor_sigacik".to_owned(),
                key_id: "port-key-2026-q4".to_owned(),
                event_kind: "BERTH_PROXIMITY".to_owned(),
                event_id: "ev_106".to_owned(),
                seq_no: 9_007_199_254_740_993u64,
                observed_at_ms: 1_762_849_490_000,
                learned_at_ms: 1_762_849_500_000,
                origin_class: SourceOriginClass::CalibratedSensor,
                explicit_epistemic_status: Some(EpistemicStatus::Observation),
                entity_id: "VESSEL_AEGEAN_01".to_owned(),
                raw_decimal_metrics: mk_map(&[
                    ("delay_min_fp", "35.0"),
                    ("gate_locked_fp", "1.0"),
                    ("lat_deg_fp", "38.199850"),
                    ("lon_deg_fp", "26.840410"),
                    ("ramp_angle_deg_fp", "4.25"),
                    ("shore_bus_v_fp", "400.5"),
                ]),
                supersedes_event_id: None,
                unit_schema: "SI_MARINE_V1".to_owned(),
            },
            seed_port,
        ),
    ];

    fs::create_dir_all(&scenario_dir).map_err(|e| e.to_string())?;
    let mut ndjson_buf = String::new();
    let mut wire_buf = String::new();
    for (inp, seed) in &specs {
        let pkt = normalize_and_sign_v2_multimetric_record(inp, seed)
            .map_err(|(c, m)| format!("{}: {}", c.as_str(), m))?;
        ndjson_buf.push_str(&pkt.to_ndjson_line());
        ndjson_buf.push('\n');
        wire_buf.push_str(&pkt.to_wire_envelope());
    }

    let ndjson_path = format!("{}/events.airlock.ndjson", scenario_dir);
    let wire_path = format!("{}/events.wire.v2", scenario_dir);
    let meta_path = format!("{}/pilot_scenario_meta.json", scenario_dir);
    fs::write(&ndjson_path, ndjson_buf.as_bytes()).map_err(|e| e.to_string())?;
    fs::write(&wire_path, wire_buf.as_bytes()).map_err(|e| e.to_string())?;

    // Verify both T1 and T2 slices right now as a self-test!
    let mut pilot_policy = SlicePolicy::default();
    pilot_policy.scenario_id = "AEGEAN_FERRY_01".to_owned();
    pilot_policy.policy_id = "MARITIME_SAFETY_V2".to_owned();
    let out_t1 = evaluate_airlock_batch_slice(
        &ndjson_buf,
        &verified_manifest,
        pilot_policy.clone(),
        1_762_848_600_000,
        None,
        None,
        0,
        true,
    )?;
    let out_t2 = evaluate_airlock_batch_slice(
        &ndjson_buf,
        &verified_manifest,
        pilot_policy,
        1_762_849_500_000,
        None,
        None,
        0,
        true,
    )?;

    let meta_json = format!(
        "{{\n  \"scenario_id\": \"AEGEAN_FERRY_01\",\n  \"policy_id\": \"MARITIME_SAFETY_V2\",\n  \"corridor\": \"Sigacik (TR) <-> Vathi, Samos (GR)\",\n  \"t1_cutoff_learned_at_ms\": \"1762848600000\",\n  \"t1_expected_verdict\": \"{}\",\n  \"t1_state_blake3\": \"{}\",\n  \"t2_cutoff_learned_at_ms\": \"1762849500000\",\n  \"t2_expected_verdict\": \"{}\",\n  \"t2_state_blake3\": \"{}\",\n  \"max_allowed_delay_fp\": \"20000000\",\n  \"precision_test_seq_no\": \"9007199254740993\"\n}}\n",
        out_t1.report.verdict.as_str(),
        out_t1.state_blake3,
        out_t2.report.verdict.as_str(),
        out_t2.state_blake3
    );
    fs::write(&meta_path, meta_json.as_bytes()).map_err(|e| e.to_string())?;

    println!(
        "{{\"ok\":true,\"manifest\":\"{}\",\"ndjson\":\"{}\",\"t1_verdict\":\"{}\",\"t1_state_blake3\":\"{}\",\"t2_verdict\":\"{}\",\"t2_state_blake3\":\"{}\"}}",
        escape_audit_json_str(&manifest_out),
        escape_audit_json_str(&ndjson_path),
        out_t1.report.verdict.as_str(),
        out_t1.state_blake3,
        out_t2.report.verdict.as_str(),
        out_t2.state_blake3
    );
    Ok(())
}

fn print_usage() {
    println!(
        "Usage: caelus_sidecar_airlock <pubkey|normalize|validate|evaluate-slice|explain|counterfactual|seal-action-card|ingest-adapter|build-aegean-pilot> [options]"
    );
}

fn main() -> ExitCode {
    let argv: Vec<String> = env::args().skip(1).collect();
    if argv.is_empty() || argv[0] == "--help" || argv[0] == "-h" {
        print_usage();
        return ExitCode::SUCCESS;
    }

    let sub = argv[0].as_str();
    let rest = &argv[1..];
    let res: Result<ExitCode, String> = match sub {
        "pubkey" => cmd_pubkey(rest).map(|()| ExitCode::SUCCESS),
        "normalize" => cmd_normalize(rest).map(|()| ExitCode::SUCCESS),
        "validate" => cmd_validate(rest),
        "evaluate-slice" => cmd_evaluate_slice(rest).map(|()| ExitCode::SUCCESS),
        "explain" => cmd_explain(rest).map(|()| ExitCode::SUCCESS),
        "counterfactual" => cmd_counterfactual(rest).map(|()| ExitCode::SUCCESS),
        "seal-action-card" => cmd_seal_action_card(rest).map(|()| ExitCode::SUCCESS),
        "ingest-adapter" => cmd_ingest_adapter(rest).map(|()| ExitCode::SUCCESS),
        "build-aegean-pilot" => cmd_build_aegean_pilot(rest).map(|()| ExitCode::SUCCESS),
        other => Err(format!("unknown subcommand {:?} (use --help)", other)),
    };

    match res {
        Ok(code) => code,
        Err(msg) => {
            eprintln!("ERROR: {}", msg);
            ExitCode::from(2)
        }
    }
}

