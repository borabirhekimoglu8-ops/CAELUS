// CAELUS OS — Standalone Forensic Audit Chain & Ed25519 Seal Verifier
// Binary: caelus_verify_audit (OB-1 / OB-5)
//
// Zero Python / external runtime dependency. Verifies:
//   1. Pure LF (\n) NDJSON framing and strict RFC 8259 JSON structure
//   2. Segment continuity (<logfile>, <logfile>.1, <logfile>.2, ...)
//   3. Multi-session append chains (GENESIS -> SESSION_START -> ... -> SESSION_END -> SEAL)
//   4. Domain-separated Blake3 hash chain (CAELUS_AUDIT_GENESIS_V1 + raw event bytes)
//   5. Domain-separated Ed25519 SEAL signatures (CAELUS_AUDIT_SEAL_V1)
//   6. Device fingerprint binding (SESSION_START.fingerprint == Blake3(SEAL.pubkey))
//   7. Mandatory signer pinning (--expect-signer <64hex|path>) with constant-time check
//      emitting UNTRUSTED_SEAL_SIGNER on mismatch.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use subtle::ConstantTimeEq;

const AUDIT_GENESIS_CTX: &[u8] = b"CAELUS_AUDIT_GENESIS_V1";
const AUDIT_SEAL_CTX: &[u8] = b"CAELUS_AUDIT_SEAL_V1";
const MAX_JSON_DEPTH: usize = 64;

#[derive(Debug, Clone)]
enum JsonVal {
    Null,
    Bool,
    Int(u64),
    NegInt,
    Number,
    Str(String),
    Arr,
    Obj(BTreeMap<String, JsonVal>),
}

impl JsonVal {
    fn as_obj(&self) -> Option<&BTreeMap<String, JsonVal>> {
        match self {
            JsonVal::Obj(m) => Some(m),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            JsonVal::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    fn as_u64(&self) -> Option<u64> {
        match self {
            JsonVal::Int(v) => Some(*v),
            _ => None,
        }
    }
}

struct ParsedLine {
    obj: BTreeMap<String, JsonVal>,
    event_raw_span: Option<(usize, usize)>,
}

struct JsonParser<'a> {
    src: &'a [u8],
    pos: usize,
}

impl<'a> JsonParser<'a> {
    fn new(src: &'a [u8]) -> Self {
        Self { src, pos: 0 }
    }

    fn skip_ws(&mut self) {
        while self.pos < self.src.len() {
            match self.src[self.pos] {
                b' ' | b'\t' | b'\r' | b'\n' => self.pos += 1,
                _ => break,
            }
        }
    }

    fn parse_top_level_line(&mut self, where_ctx: &str) -> Result<ParsedLine, String> {
        self.skip_ws();
        if self.pos >= self.src.len() || self.src[self.pos] != b'{' {
            return Err(format!("{}: line must be a JSON object", where_ctx));
        }
        self.pos += 1;

        let mut map = BTreeMap::new();
        let mut event_raw_span: Option<(usize, usize)> = None;

        self.skip_ws();
        if self.pos < self.src.len() && self.src[self.pos] == b'}' {
            self.pos += 1;
            self.skip_ws();
            if self.pos != self.src.len() {
                return Err(format!("{}: trailing bytes after JSON object", where_ctx));
            }
            return Ok(ParsedLine {
                obj: map,
                event_raw_span,
            });
        }

        loop {
            self.skip_ws();
            let key = self.parse_string(where_ctx)?;
            self.skip_ws();
            if self.pos >= self.src.len() || self.src[self.pos] != b':' {
                return Err(format!("{}: expected ':' after key {:?}", where_ctx, key));
            }
            self.pos += 1;
            let raw_after_colon = self.pos;
            self.skip_ws();
            let val = self.parse_value(1, where_ctx)?;

            if key == "event" {
                self.skip_ws();
                if self.pos >= self.src.len() || self.src[self.pos] != b'}' {
                    return Err(format!(
                        "{}: top-level 'event' field must be last in EVENT object",
                        where_ctx
                    ));
                }
                let close_brace_pos = self.pos;
                event_raw_span = Some((raw_after_colon, close_brace_pos));
                map.insert(key, val);
                self.pos += 1;
                break;
            }

            map.insert(key, val);
            self.skip_ws();
            if self.pos >= self.src.len() {
                return Err(format!("{}: unterminated JSON object", where_ctx));
            }
            match self.src[self.pos] {
                b',' => {
                    self.pos += 1;
                }
                b'}' => {
                    self.pos += 1;
                    break;
                }
                _ => {
                    return Err(format!("{}: expected ',' or '}}'", where_ctx));
                }
            }
        }

        self.skip_ws();
        if self.pos != self.src.len() {
            return Err(format!("{}: trailing data after JSON object", where_ctx));
        }

        Ok(ParsedLine {
            obj: map,
            event_raw_span,
        })
    }

    fn parse_value(&mut self, depth: usize, where_ctx: &str) -> Result<JsonVal, String> {
        if depth > MAX_JSON_DEPTH {
            return Err(format!("{}: JSON nesting exceeds max depth", where_ctx));
        }
        self.skip_ws();
        if self.pos >= self.src.len() {
            return Err(format!("{}: unexpected end of JSON input", where_ctx));
        }
        match self.src[self.pos] {
            b'"' => Ok(JsonVal::Str(self.parse_string(where_ctx)?)),
            b'{' => self.parse_object(depth + 1, where_ctx),
            b'[' => self.parse_array(depth + 1, where_ctx),
            b't' => {
                if self.src[self.pos..].starts_with(b"true") {
                    self.pos += 4;
                    Ok(JsonVal::Bool)
                } else {
                    Err(format!("{}: invalid literal", where_ctx))
                }
            }
            b'f' => {
                if self.src[self.pos..].starts_with(b"false") {
                    self.pos += 5;
                    Ok(JsonVal::Bool)
                } else {
                    Err(format!("{}: invalid literal", where_ctx))
                }
            }
            b'n' => {
                if self.src[self.pos..].starts_with(b"null") {
                    self.pos += 4;
                    Ok(JsonVal::Null)
                } else {
                    Err(format!("{}: invalid literal", where_ctx))
                }
            }
            b'-' | b'0'..=b'9' => self.parse_number(where_ctx),
            _ => Err(format!("{}: unexpected byte in JSON value", where_ctx)),
        }
    }

    fn parse_object(&mut self, depth: usize, where_ctx: &str) -> Result<JsonVal, String> {
        self.pos += 1; // '{'
        let mut map = BTreeMap::new();
        self.skip_ws();
        if self.pos < self.src.len() && self.src[self.pos] == b'}' {
            self.pos += 1;
            return Ok(JsonVal::Obj(map));
        }
        loop {
            self.skip_ws();
            let k = self.parse_string(where_ctx)?;
            self.skip_ws();
            if self.pos >= self.src.len() || self.src[self.pos] != b':' {
                return Err(format!("{}: expected ':' in nested object", where_ctx));
            }
            self.pos += 1;
            let v = self.parse_value(depth, where_ctx)?;
            map.insert(k, v);
            self.skip_ws();
            if self.pos >= self.src.len() {
                return Err(format!("{}: unterminated nested object", where_ctx));
            }
            match self.src[self.pos] {
                b',' => self.pos += 1,
                b'}' => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(format!("{}: expected ',' or '}}' in object", where_ctx)),
            }
        }
        Ok(JsonVal::Obj(map))
    }

    fn parse_array(&mut self, depth: usize, where_ctx: &str) -> Result<JsonVal, String> {
        self.pos += 1; // '['
        self.skip_ws();
        if self.pos < self.src.len() && self.src[self.pos] == b']' {
            self.pos += 1;
            return Ok(JsonVal::Arr);
        }
        loop {
            let _ = self.parse_value(depth, where_ctx)?;
            self.skip_ws();
            if self.pos >= self.src.len() {
                return Err(format!("{}: unterminated JSON array", where_ctx));
            }
            match self.src[self.pos] {
                b',' => self.pos += 1,
                b']' => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(format!("{}: expected ',' or ']' in array", where_ctx)),
            }
        }
        Ok(JsonVal::Arr)
    }

    fn parse_string(&mut self, where_ctx: &str) -> Result<String, String> {
        if self.pos >= self.src.len() || self.src[self.pos] != b'"' {
            return Err(format!("{}: expected JSON string", where_ctx));
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
                return Err(format!("{}: unescaped control char in JSON string", where_ctx));
            }
            if b == b'\\' {
                self.pos += 1;
                if self.pos >= self.src.len() {
                    return Err(format!("{}: unterminated escape in JSON string", where_ctx));
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
                        let cp = self.parse_hex4(where_ctx)?;
                        if (0xD800..=0xDBFF).contains(&cp) {
                            if self.pos + 2 > self.src.len()
                                || self.src[self.pos] != b'\\'
                                || self.src[self.pos + 1] != b'u'
                            {
                                return Err(format!(
                                    "{}: unpaired UTF-16 high surrogate",
                                    where_ctx
                                ));
                            }
                            self.pos += 2;
                            let low = self.parse_hex4(where_ctx)?;
                            if !(0xDC00..=0xDFFF).contains(&low) {
                                return Err(format!(
                                    "{}: invalid UTF-16 low surrogate",
                                    where_ctx
                                ));
                            }
                            let combined = 0x10000
                                + (((cp as u32 - 0xD800) << 10) | (low as u32 - 0xDC00));
                            let ch = char::from_u32(combined)
                                .ok_or_else(|| format!("{}: invalid unicode scalar", where_ctx))?;
                            out.push(ch);
                        } else if (0xDC00..=0xDFFF).contains(&cp) {
                            return Err(format!(
                                "{}: unpaired UTF-16 low surrogate",
                                where_ctx
                            ));
                        } else {
                            let ch = char::from_u32(cp as u32)
                                .ok_or_else(|| format!("{}: invalid unicode scalar", where_ctx))?;
                            out.push(ch);
                        }
                    }
                    _ => return Err(format!("{}: invalid escape sequence", where_ctx)),
                }
            } else {
                let rest = &self.src[self.pos..];
                let s = std::str::from_utf8(rest)
                    .map_err(|_| format!("{}: invalid UTF-8 in JSON string", where_ctx))?;
                let ch = s
                    .chars()
                    .next()
                    .ok_or_else(|| format!("{}: unexpected EOF in UTF-8 string", where_ctx))?;
                out.push(ch);
                self.pos += ch.len_utf8();
            }
        }
        Err(format!("{}: unterminated JSON string", where_ctx))
    }

    fn parse_hex4(&mut self, where_ctx: &str) -> Result<u16, String> {
        if self.pos + 4 > self.src.len() {
            return Err(format!("{}: truncated \\uXXXX escape", where_ctx));
        }
        let mut val: u16 = 0;
        for _ in 0..4 {
            let d = hex_nibble(self.src[self.pos])
                .ok_or_else(|| format!("{}: invalid hex in \\uXXXX escape", where_ctx))?;
            self.pos += 1;
            val = (val << 4) | (d as u16);
        }
        Ok(val)
    }

    fn parse_number(&mut self, where_ctx: &str) -> Result<JsonVal, String> {
        let start = self.pos;
        let neg = if self.src[self.pos] == b'-' {
            self.pos += 1;
            true
        } else {
            false
        };
        if self.pos >= self.src.len() || !self.src[self.pos].is_ascii_digit() {
            return Err(format!("{}: invalid JSON number", where_ctx));
        }
        if self.src[self.pos] == b'0' {
            self.pos += 1;
            if self.pos < self.src.len() && self.src[self.pos].is_ascii_digit() {
                return Err(format!("{}: leading zero in JSON number", where_ctx));
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
                return Err(format!("{}: invalid fraction in JSON number", where_ctx));
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
                return Err(format!("{}: invalid exponent in JSON number", where_ctx));
            }
            while self.pos < self.src.len() && self.src[self.pos].is_ascii_digit() {
                self.pos += 1;
            }
        }
        let num_str = std::str::from_utf8(&self.src[start..self.pos])
            .map_err(|_| format!("{}: invalid number encoding", where_ctx))?;
        if is_float {
            Ok(JsonVal::Number)
        } else if neg {
            let _ = num_str
                .parse::<i64>()
                .map_err(|_| format!("{}: signed integer overflow", where_ctx))?;
            Ok(JsonVal::NegInt)
        } else {
            let v = num_str
                .parse::<u64>()
                .map_err(|_| format!("{}: u64 integer overflow", where_ctx))?;
            Ok(JsonVal::Int(v))
        }
    }
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn decode_exact_hex<const N: usize>(hex: &str, where_ctx: &str) -> Result<[u8; N], String> {
    if hex.len() != N * 2 {
        return Err(format!(
            "{}: expected {} hex chars, got {}",
            where_ctx,
            N * 2,
            hex.len()
        ));
    }
    let mut out = [0u8; N];
    for (idx, pair) in hex.as_bytes().chunks_exact(2).enumerate() {
        let hi = hex_nibble(pair[0]).ok_or_else(|| format!("{}: invalid hex", where_ctx))?;
        let lo = hex_nibble(pair[1]).ok_or_else(|| format!("{}: invalid hex", where_ctx))?;
        out[idx] = (hi << 4) | lo;
    }
    Ok(out)
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(&mut out, "{:02x}", b);
    }
    out
}

fn env_flag_enabled(name: &str) -> bool {
    match env::var(name) {
        Ok(v) => {
            let s = v.trim();
            s.eq_ignore_ascii_case("1")
                || s.eq_ignore_ascii_case("true")
                || s.eq_ignore_ascii_case("yes")
                || s.eq_ignore_ascii_case("on")
        }
        Err(_) => false,
    }
}

fn parse_signer_spec(spec: &str) -> Result<[u8; 32], String> {
    let trimmed = spec.trim();
    if trimmed.len() == 64 && trimmed.bytes().all(|b| hex_nibble(b).is_some()) {
        return decode_exact_hex::<32>(trimmed, "--expect-signer");
    }
    let path = Path::new(trimmed);
    let content = fs::read_to_string(path).map_err(|e| {
        format!(
            "--expect-signer: neither 64-hex pubkey nor readable pubkey file {:?} ({})",
            path, e
        )
    })?;
    for line in content.lines() {
        let clean = line.split('#').next().unwrap_or("").trim();
        if clean.is_empty() {
            continue;
        }
        return decode_exact_hex::<32>(clean, &format!("pubkey file {}", path.display()));
    }
    Err(format!(
        "--expect-signer: pubkey file {} contains no 64-hex key",
        path.display()
    ))
}

fn discover_segments(base: &Path) -> Result<Vec<PathBuf>, String> {
    if !base.is_file() {
        return Err(format!("{}: file does not exist", base.display()));
    }
    let mut paths = vec![base.to_path_buf()];
    let mut idx: u64 = 1;
    loop {
        let candidate = PathBuf::from(format!("{}.{}", base.display(), idx));
        if !candidate.is_file() {
            break;
        }
        paths.push(candidate);
        idx += 1;
    }
    Ok(paths)
}

fn parse_session_id(obj: &BTreeMap<String, JsonVal>, where_ctx: &str) -> Result<u64, String> {
    match obj.get("session_id") {
        Some(JsonVal::Str(s)) => u64::from_str_radix(s, 16)
            .map_err(|_| format!("{}: invalid hex session_id", where_ctx)),
        Some(JsonVal::Int(v)) => Ok(*v),
        _ => Err(format!("{}: missing or invalid session_id", where_ctx)),
    }
}

struct CliArgs {
    logfile: PathBuf,
    chain_only: bool,
    verbose: bool,
    print_signer: bool,
    allow_crlf: bool,
    expect_signer: Option<[u8; 32]>,
}

fn parse_cli(argv: &[String]) -> Result<CliArgs, String> {
    let mut logfile: Option<PathBuf> = None;
    let mut chain_only = false;
    let mut verbose = false;
    let mut print_signer = false;
    let mut allow_crlf = false;
    let mut expect_signer_raw: Option<String> = None;

    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--chain-only" => chain_only = true,
            "--verbose" | "-v" => verbose = true,
            "--print-signer" => print_signer = true,
            "--allow-crlf" => allow_crlf = true,
            "--expect-signer" | "--trusted-pubkey-hex" => {
                i += 1;
                if i >= argv.len() {
                    return Err(format!("{} requires a <64-hex-or-file> argument", argv[i - 1]));
                }
                expect_signer_raw = Some(argv[i].clone());
            }
            arg if arg.starts_with("--expect-signer=") => {
                expect_signer_raw = Some(arg["--expect-signer=".len()..].to_owned());
            }
            arg if arg.starts_with("--trusted-pubkey-hex=") => {
                expect_signer_raw = Some(arg["--trusted-pubkey-hex=".len()..].to_owned());
            }
            "--help" | "-h" => {
                println!(
                    "Usage: caelus_verify_audit <logfile> [--expect-signer <64hex|file>] [--print-signer] [--chain-only] [--verbose]"
                );
                std::process::exit(0);
            }
            arg if arg.starts_with('-') => {
                return Err(format!("unknown option: {}", arg));
            }
            arg => {
                if logfile.is_some() {
                    return Err(format!("unexpected positional argument: {}", arg));
                }
                logfile = Some(PathBuf::from(arg));
            }
        }
        i += 1;
    }

    let logfile = logfile.ok_or_else(|| {
        "missing <logfile> argument (usage: caelus_verify_audit <logfile> [--expect-signer <64hex|file>])"
            .to_owned()
    })?;

    if expect_signer_raw.is_none() {
        if let Ok(env_pin) = env::var("CAELUS_AUDIT_EXPECT_SIGNER") {
            if !env_pin.trim().is_empty() {
                expect_signer_raw = Some(env_pin);
            }
        }
    }

    let prod_mode = env_flag_enabled("CAELUS_PRODUCTION");
    if prod_mode && chain_only {
        return Err(
            "UNTRUSTED_SEAL_SIGNER: --chain-only is forbidden when CAELUS_PRODUCTION=1".to_owned(),
        );
    }
    if prod_mode && !print_signer && expect_signer_raw.is_none() {
        return Err(
            "UNTRUSTED_SEAL_SIGNER: --expect-signer pin is mandatory when CAELUS_PRODUCTION=1 (embedded SEAL pubkey is not a trust anchor)"
                .to_owned(),
        );
    }
    if print_signer && chain_only {
        return Err("--print-signer cannot be combined with --chain-only".to_owned());
    }

    let expect_signer = match expect_signer_raw {
        Some(spec) => Some(parse_signer_spec(&spec)?),
        None => None,
    };

    Ok(CliArgs {
        logfile,
        chain_only,
        verbose,
        print_signer,
        allow_crlf,
        expect_signer,
    })
}

struct VerificationSummary {
    segments_verified: usize,
    sessions_verified: usize,
    engine_sessions_closed: usize,
    final_chain_head: [u8; 32],
    verified_signer: Option<[u8; 32]>,
}

fn verify_audit_chain(args: &CliArgs) -> Result<VerificationSummary, String> {
    let segments = discover_segments(&args.logfile)?;
    let mut prev_segment_head: Option<[u8; 32]> = None;
    let mut sessions_verified: usize = 0;
    let mut engine_sessions_closed: usize = 0;
    let mut open_engine_session_fp: Option<Option<[u8; 32]>> = None;
    let mut consistent_signer: Option<[u8; 32]> = None;

    for (seg_idx, seg_path) in segments.iter().enumerate() {
        let raw_bytes = fs::read(seg_path)
            .map_err(|e| format!("{}: failed to read ({})", seg_path.display(), e))?;
        if raw_bytes.is_empty() {
            return Err(format!("{}: empty audit segment", seg_path.display()));
        }
        if !args.allow_crlf && raw_bytes.contains(&b'\r') {
            return Err(format!(
                "{}: CRLF_DETECTED — audit logs must use binary LF ('\\n') line endings only",
                seg_path.display()
            ));
        }

        let mut chain_head: Option<[u8; 32]> = None;
        let mut session_id: Option<u64> = None;
        let mut expected_seq: u64 = 0;
        let mut event_count: u64 = 0;
        let mut saw_seal = false;

        for (idx, mut raw_line) in raw_bytes.split(|&b| b == b'\n').enumerate() {
            if idx + 1 == raw_bytes.iter().filter(|&&b| b == b'\n').count() + 1
                && raw_line.is_empty()
            {
                break;
            }
            if args.allow_crlf && raw_line.ends_with(b"\r") {
                raw_line = &raw_line[..raw_line.len() - 1];
            }
            if raw_line.is_empty() {
                continue;
            }

            let line_no = idx + 1;
            let where_ctx = format!("{}:{}", seg_path.display(), line_no);
            let parsed = JsonParser::new(raw_line).parse_top_level_line(&where_ctx)?;
            let record_type = parsed
                .obj
                .get("type")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("{}: missing string 'type'", where_ctx))?;

            match record_type {
                "GENESIS" => {
                    let seq = parsed
                        .obj
                        .get("seq")
                        .and_then(|v| v.as_u64())
                        .ok_or_else(|| format!("{}: GENESIS missing u64 seq", where_ctx))?;
                    if seq != 0 {
                        return Err(format!("{}: GENESIS seq must be 0, got {}", where_ctx, seq));
                    }

                    let is_appended_new_session = if saw_seal {
                        if open_engine_session_fp.is_some() {
                            return Err(format!(
                                "{}: new session GENESIS found while previous SESSION_START had no matching SESSION_END",
                                where_ctx
                            ));
                        }
                        true
                    } else if chain_head.is_some() {
                        return Err(format!("{}: duplicate GENESIS without SEAL", where_ctx));
                    } else {
                        false
                    };

                    let sid = parse_session_id(&parsed.obj, &where_ctx)?;
                    let prev_str = parsed
                        .obj
                        .get("prev")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| format!("{}: GENESIS missing prev", where_ctx))?;
                    let prev_bytes = decode_exact_hex::<32>(prev_str, &format!("{}: prev", where_ctx))?;
                    if prev_bytes != [0u8; 32] {
                        return Err(format!("{}: GENESIS prev must be all zeros", where_ctx));
                    }

                    let mut hasher = blake3::Hasher::new();
                    hasher.update(AUDIT_GENESIS_CTX);
                    hasher.update(&sid.to_le_bytes());

                    if let Some(prev_seg_val) = parsed.obj.get("prev_segment_chain_head") {
                        if is_appended_new_session {
                            return Err(format!(
                                "{}: appended intra-file GENESIS must not carry prev_segment_chain_head",
                                where_ctx
                            ));
                        }
                        let seg_num = parsed
                            .obj
                            .get("segment")
                            .and_then(|v| v.as_u64())
                            .ok_or_else(|| {
                                format!("{}: rotated GENESIS missing u64 segment", where_ctx)
                            })?;
                        if seg_num != seg_idx as u64 {
                            return Err(format!(
                                "{}: rotated GENESIS segment={} does not match file index {}",
                                where_ctx, seg_num, seg_idx
                            ));
                        }
                        let prev_seg_str = prev_seg_val.as_str().ok_or_else(|| {
                            format!("{}: prev_segment_chain_head must be string", where_ctx)
                        })?;
                        let prev_seg_bytes = decode_exact_hex::<32>(
                            prev_seg_str,
                            &format!("{}: prev_segment_chain_head", where_ctx),
                        )?;
                        match prev_segment_head {
                            Some(expected_prev) => {
                                if bool::from(!prev_seg_bytes.ct_eq(&expected_prev)) {
                                    return Err(format!(
                                        "{}: prev_segment_chain_head does not match previous segment SEAL",
                                        where_ctx
                                    ));
                                }
                            }
                            None => {
                                return Err(format!(
                                    "{}: segment 0 GENESIS unexpectedly carries prev_segment_chain_head",
                                    where_ctx
                                ));
                            }
                        }
                        hasher.update(&seg_num.to_le_bytes());
                        hasher.update(&prev_seg_bytes);
                    } else if seg_idx > 0 && !is_appended_new_session {
                        return Err(format!(
                            "{}: rotated segment {} missing prev_segment_chain_head",
                            where_ctx, seg_idx
                        ));
                    }

                    let expected_hash = *hasher.finalize().as_bytes();
                    let actual_hash_str = parsed
                        .obj
                        .get("hash")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| format!("{}: GENESIS missing hash", where_ctx))?;
                    let actual_hash =
                        decode_exact_hex::<32>(actual_hash_str, &format!("{}: hash", where_ctx))?;
                    if bool::from(!actual_hash.ct_eq(&expected_hash)) {
                        return Err(format!("{}: GENESIS hash mismatch", where_ctx));
                    }

                    session_id = Some(sid);
                    chain_head = Some(expected_hash);
                    expected_seq = 1;
                    event_count = 0;
                    saw_seal = false;
                }
                "EVENT" => {
                    let cur_head = chain_head.ok_or_else(|| {
                        format!("{}: first record must be GENESIS", where_ctx)
                    })?;
                    if saw_seal {
                        return Err(format!(
                            "{}: EVENT record found after SEAL before next GENESIS",
                            where_ctx
                        ));
                    }
                    let seq = parsed
                        .obj
                        .get("seq")
                        .and_then(|v| v.as_u64())
                        .ok_or_else(|| format!("{}: EVENT missing u64 seq", where_ctx))?;
                    if seq != expected_seq {
                        return Err(format!(
                            "{}: EVENT seq mismatch (expected {}, got {})",
                            where_ctx, expected_seq, seq
                        ));
                    }
                    let prev_str = parsed
                        .obj
                        .get("prev")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| format!("{}: EVENT missing prev", where_ctx))?;
                    let prev_bytes =
                        decode_exact_hex::<32>(prev_str, &format!("{}: prev", where_ctx))?;
                    if bool::from(!prev_bytes.ct_eq(&cur_head)) {
                        return Err(format!(
                            "{}: EVENT prev does not match chain head",
                            where_ctx
                        ));
                    }

                    let (ev_start, ev_end) = parsed
                        .event_raw_span
                        .ok_or_else(|| format!("{}: EVENT missing top-level 'event'", where_ctx))?;
                    let event_raw = &raw_line[ev_start..ev_end];

                    let mut hasher = blake3::Hasher::new();
                    hasher.update(&cur_head);
                    hasher.update(event_raw);
                    let expected_hash = *hasher.finalize().as_bytes();

                    let actual_hash_str = parsed
                        .obj
                        .get("hash")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| format!("{}: EVENT missing hash", where_ctx))?;
                    let actual_hash =
                        decode_exact_hex::<32>(actual_hash_str, &format!("{}: hash", where_ctx))?;
                    if bool::from(!actual_hash.ct_eq(&expected_hash)) {
                        return Err(format!("{}: EVENT hash mismatch", where_ctx));
                    }

                    // Track SESSION_START -> SESSION_END lifecycle inside event objects
                    if let Some(ev_obj) = parsed.obj.get("event").and_then(|v| v.as_obj()) {
                        if let Some(ev_type) = ev_obj.get("type").and_then(|v| v.as_str()) {
                            match ev_type {
                                "SESSION_START" => {
                                    if open_engine_session_fp.is_some() {
                                        return Err(format!(
                                            "{}: nested SESSION_START before SESSION_END",
                                            where_ctx
                                        ));
                                    }
                                    let fp_opt = match ev_obj.get("fingerprint").and_then(|v| v.as_str()) {
                                        Some(fp_hex) => Some(decode_exact_hex::<32>(
                                            fp_hex,
                                            &format!("{}: SESSION_START.fingerprint", where_ctx),
                                        )?),
                                        None => None,
                                    };
                                    open_engine_session_fp = Some(fp_opt);
                                }
                                "SESSION_END" => {
                                    if open_engine_session_fp.is_none() {
                                        return Err(format!(
                                            "{}: SESSION_END without preceding SESSION_START",
                                            where_ctx
                                        ));
                                    }
                                    open_engine_session_fp = None;
                                    engine_sessions_closed += 1;
                                }
                                _ => {}
                            }
                        }
                    }

                    chain_head = Some(expected_hash);
                    expected_seq += 1;
                    event_count += 1;
                }
                "SEAL" => {
                    let cur_head = chain_head.ok_or_else(|| {
                        format!("{}: SEAL without preceding GENESIS", where_ctx)
                    })?;
                    let sid = session_id.ok_or_else(|| {
                        format!("{}: SEAL missing active session_id", where_ctx)
                    })?;
                    if saw_seal {
                        return Err(format!("{}: duplicate SEAL record", where_ctx));
                    }
                    let seq = parsed
                        .obj
                        .get("seq")
                        .and_then(|v| v.as_u64())
                        .ok_or_else(|| format!("{}: SEAL missing u64 seq", where_ctx))?;
                    if seq != expected_seq {
                        return Err(format!(
                            "{}: SEAL seq mismatch (expected {}, got {})",
                            where_ctx, expected_seq, seq
                        ));
                    }
                    let seal_head_str = parsed
                        .obj
                        .get("chain_head")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| format!("{}: SEAL missing chain_head", where_ctx))?;
                    let seal_head = decode_exact_hex::<32>(
                        seal_head_str,
                        &format!("{}: chain_head", where_ctx),
                    )?;
                    if bool::from(!seal_head.ct_eq(&cur_head)) {
                        return Err(format!("{}: SEAL chain_head mismatch", where_ctx));
                    }
                    let entries = parsed
                        .obj
                        .get("entries")
                        .and_then(|v| v.as_u64())
                        .ok_or_else(|| format!("{}: SEAL missing u64 entries", where_ctx))?;
                    if entries != event_count {
                        return Err(format!(
                            "{}: SEAL entries={} does not match event count {}",
                            where_ctx, entries, event_count
                        ));
                    }

                    if !args.chain_only {
                        let pubkey_str = parsed
                            .obj
                            .get("pubkey")
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| format!("{}: SEAL missing pubkey", where_ctx))?;
                        let pubkey_bytes = decode_exact_hex::<32>(
                            pubkey_str,
                            &format!("{}: pubkey", where_ctx),
                        )?;

                        let fp_str = parsed
                            .obj
                            .get("fingerprint")
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| format!("{}: SEAL missing fingerprint", where_ctx))?;
                        let fp_bytes = decode_exact_hex::<32>(
                            fp_str,
                            &format!("{}: fingerprint", where_ctx),
                        )?;
                        let expected_fp = *blake3::hash(&pubkey_bytes).as_bytes();
                        if bool::from(!fp_bytes.ct_eq(&expected_fp)) {
                            return Err(format!(
                                "{}: SEAL fingerprint does not match Blake3(pubkey)",
                                where_ctx
                            ));
                        }

                        // If mid-session rotation occurs while SESSION_START is open, verify same device fp
                        if let Some(Some(start_fp)) = open_engine_session_fp {
                            if bool::from(!start_fp.ct_eq(&expected_fp)) {
                                return Err(format!(
                                    "{}: UNTRUSTED_SEAL_SIGNER: SEAL fingerprint does not match SESSION_START fingerprint",
                                    where_ctx
                                ));
                            }
                        }

                        if let Some(pinned) = args.expect_signer {
                            if bool::from(!pubkey_bytes.ct_eq(&pinned)) {
                                return Err(format!(
                                    "{}: UNTRUSTED_SEAL_SIGNER: expected {}, got {}",
                                    where_ctx,
                                    hex_encode(&pinned),
                                    hex_encode(&pubkey_bytes)
                                ));
                            }
                        }

                        let sig_str = parsed
                            .obj
                            .get("sig")
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| format!("{}: SEAL missing sig", where_ctx))?;
                        let sig_bytes =
                            decode_exact_hex::<64>(sig_str, &format!("{}: sig", where_ctx))?;

                        let vk = VerifyingKey::from_bytes(&pubkey_bytes).map_err(|_| {
                            format!("{}: invalid Ed25519 public key bytes", where_ctx)
                        })?;
                        let sig = Signature::from_bytes(&sig_bytes);

                        let mut msg = Vec::with_capacity(AUDIT_SEAL_CTX.len() + 48);
                        msg.extend_from_slice(AUDIT_SEAL_CTX);
                        msg.extend_from_slice(&sid.to_le_bytes());
                        msg.extend_from_slice(&seq.to_le_bytes());
                        msg.extend_from_slice(&cur_head);

                        vk.verify(&msg, &sig).map_err(|_| {
                            format!("{}: SEAL Ed25519 signature is invalid", where_ctx)
                        })?;

                        match consistent_signer {
                            None => consistent_signer = Some(pubkey_bytes),
                            Some(prev_pk) => {
                                if bool::from(!prev_pk.ct_eq(&pubkey_bytes)) {
                                    return Err(format!(
                                        "{}: UNTRUSTED_SEAL_SIGNER: inconsistent signer across SEAL records ({} vs {})",
                                        where_ctx,
                                        hex_encode(&prev_pk),
                                        hex_encode(&pubkey_bytes)
                                    ));
                                }
                            }
                        }
                    }

                    saw_seal = true;
                    sessions_verified += 1;
                }
                other => {
                    return Err(format!("{}: unsupported record type {:?}", where_ctx, other));
                }
            }
        }

        let final_seg_head = chain_head
            .ok_or_else(|| format!("{}: audit segment contains no records", seg_path.display()))?;
        if !saw_seal {
            return Err(format!("{}: missing SEAL record", seg_path.display()));
        }

        if args.verbose {
            eprintln!(
                "ok: {} events={} chain_head={}",
                seg_path.display(),
                event_count,
                hex_encode(&final_seg_head)
            );
        }
        prev_segment_head = Some(final_seg_head);
    }

    if open_engine_session_fp.is_some() {
        return Err(format!(
            "{}: unclosed SESSION_START (missing SESSION_END before final SEAL)",
            args.logfile.display()
        ));
    }

    let final_chain_head = prev_segment_head
        .ok_or_else(|| format!("{}: no segments verified", args.logfile.display()))?;

    Ok(VerificationSummary {
        segments_verified: segments.len(),
        sessions_verified,
        engine_sessions_closed,
        final_chain_head,
        verified_signer: consistent_signer,
    })
}

fn main() -> ExitCode {
    let raw_args: Vec<String> = env::args().skip(1).collect();
    let cli = match parse_cli(&raw_args) {
        Ok(c) => c,
        Err(msg) => {
            eprintln!("ERROR: {}", msg);
            return ExitCode::from(2);
        }
    };

    match verify_audit_chain(&cli) {
        Ok(summary) => {
            if cli.print_signer {
                match summary.verified_signer {
                    Some(pk) => {
                        println!("{}", hex_encode(&pk));
                        ExitCode::SUCCESS
                    }
                    None => {
                        eprintln!("ERROR: no SEAL signer found");
                        ExitCode::from(1)
                    }
                }
            } else {
                println!(
                    "OK: verified {} segment(s), {} seal(s), {} session(s), final_chain_head={}",
                    summary.segments_verified,
                    summary.sessions_verified,
                    summary.engine_sessions_closed,
                    hex_encode(&summary.final_chain_head)
                );
                ExitCode::SUCCESS
            }
        }
        Err(err) => {
            eprintln!("ERROR: {}", err);
            if err.contains("UNTRUSTED_SEAL_SIGNER") {
                ExitCode::from(3)
            } else {
                ExitCode::from(1)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use caelus_network::audit_log::CaelusAuditLog;
    use caelus_network::network::mesh_auth::DeviceIdentity;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_log_path(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!(
            "caelus_verify_audit_{}_{}_{}.log",
            tag,
            std::process::id(),
            nanos
        ))
    }

    #[test]
    fn verifies_sample_fixture_and_rejects_wrong_signer_pin() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let sample = manifest_dir.join("tests/fixtures/caelus_audit_sample.log");
        let expected_hex = "2dd8b43ecba8eff73b1aa25250de676f4f8a0be072b1f96a7eda7355648ca0d1";
        let expected_pk = decode_exact_hex::<32>(expected_hex, "test").unwrap();

        let ok_args = CliArgs {
            logfile: sample.clone(),
            chain_only: false,
            verbose: false,
            print_signer: false,
            allow_crlf: false,
            expect_signer: Some(expected_pk),
        };
        let res = verify_audit_chain(&ok_args).expect("sample log must verify");
        assert_eq!(res.segments_verified, 1);
        assert_eq!(res.sessions_verified, 1);
        assert_eq!(res.engine_sessions_closed, 1);
        assert_eq!(res.verified_signer, Some(expected_pk));

        let wrong_pin_file = manifest_dir.join("tools/caelus_trusted_pubkey.txt");
        let wrong_pk = parse_signer_spec(wrong_pin_file.to_str().unwrap()).unwrap();
        let bad_args = CliArgs {
            logfile: sample,
            chain_only: false,
            verbose: false,
            print_signer: false,
            allow_crlf: false,
            expect_signer: Some(wrong_pk),
        };
        let err = verify_audit_chain(&bad_args)
            .err()
            .expect("wrong signer must fail");
        assert!(
            err.contains("UNTRUSTED_SEAL_SIGNER"),
            "expected UNTRUSTED_SEAL_SIGNER, got: {}",
            err
        );
    }

    #[test]
    fn verifies_multi_session_append_and_rejects_unclosed_session_start() {
        let path = temp_log_path("multisession");
        let _ = fs::remove_file(&path);
        let id = Arc::new(DeviceIdentity::generate());
        let pk_bytes = *id.verifying_key.as_bytes();
        let fp_hex = hex_encode(&id.fingerprint);

        {
            let mut log1 = CaelusAuditLog::open(path.to_str().unwrap(), id.clone(), 101).unwrap();
            assert!(log1.append(&format!(
                r#"{{"type":"SESSION_START","scenario":"S1","fingerprint":"{}","det_mode":true}}"#,
                fp_hex
            )));
            assert!(log1.append(r#"{"type":"SOLVER_RESULT","on_time":true}"#));
            assert!(log1.append(r#"{"type":"SESSION_END","scenario":"S1"}"#));
            assert!(log1.seal());
        }
        {
            let mut log2 = CaelusAuditLog::open(path.to_str().unwrap(), id.clone(), 102).unwrap();
            assert!(log2.append(&format!(
                r#"{{"type":"SESSION_START","scenario":"S2","fingerprint":"{}","det_mode":true}}"#,
                fp_hex
            )));
            assert!(log2.append(r#"{"type":"SESSION_END","scenario":"S2"}"#));
            assert!(log2.seal());
        }

        let summary = verify_audit_chain(&CliArgs {
            logfile: path.clone(),
            chain_only: false,
            verbose: false,
            print_signer: false,
            allow_crlf: false,
            expect_signer: Some(pk_bytes),
        })
        .expect("two appended sessions must verify");
        assert_eq!(summary.sessions_verified, 2);
        assert_eq!(summary.engine_sessions_closed, 2);

        // Append a 3rd session missing SESSION_END -> must fail
        {
            let mut log3 = CaelusAuditLog::open(path.to_str().unwrap(), id.clone(), 103).unwrap();
            assert!(log3.append(&format!(
                r#"{{"type":"SESSION_START","scenario":"S3","fingerprint":"{}","det_mode":true}}"#,
                fp_hex
            )));
            assert!(log3.seal());
        }

        let err = verify_audit_chain(&CliArgs {
            logfile: path.clone(),
            chain_only: false,
            verbose: false,
            print_signer: false,
            allow_crlf: false,
            expect_signer: Some(pk_bytes),
        })
        .err()
        .expect("unclosed SESSION_START must be rejected");
        assert!(err.contains("unclosed SESSION_START"), "got: {}", err);

        let _ = fs::remove_file(&path);
    }
}
