use std::env;
use std::fs;
use std::path::Path;

use rand::rngs::OsRng;
use rand::RngCore;

use caelus_network::caelus_sign_scenario_payload;

/// Domain ayrımı prefix'i: plugin imzaları, senaryo canonical payload
/// imzalarıyla ("CAELUS_SCENARIO_PACK_V1\n...") asla karışamaz. Motor tarafı
/// (include/plugin/caelus_plugin_registry.h, verify_plugin_sidecar_ed25519)
/// doğrularken aynı prefix'i yeniden kurar.
const PLUGIN_SIGN_DOMAIN: &[u8] = b"CAELUS_PLUGIN_V1\n";

/// Rust FFI imza/doğrulama yüzeyinin payload üst sınırı (16 MiB) —
/// src/lib.rs::caelus_sign_scenario_payload ve scenario_verify.rs ile aynı.
const FFI_MAX_PAYLOAD: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone)]
enum JsonVal {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Arr(Vec<JsonVal>),
    Obj(Vec<(String, JsonVal)>),
}

struct JsonParser<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> JsonParser<'a> {
    fn new(data: &'a str) -> Self {
        Self {
            data: data.as_bytes(),
            pos: 0,
        }
    }

    fn parse(mut self) -> Result<JsonVal, String> {
        let value = self.parse_value(0)?;
        self.skip_ws();
        if self.pos != self.data.len() {
            return Err("JSON sonunda beklenmeyen veri var".to_string());
        }
        Ok(value)
    }

    fn skip_ws(&mut self) {
        while let Some(b' ' | b'\n' | b'\r' | b'\t') = self.peek() {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.data.get(self.pos).copied()
    }

    fn next(&mut self) -> Option<u8> {
        let b = self.peek()?;
        self.pos += 1;
        Some(b)
    }

    fn parse_value(&mut self, depth: usize) -> Result<JsonVal, String> {
        if depth > 64 {
            return Err("JSON recursion limiti aşıldı".to_string());
        }
        self.skip_ws();
        match self.peek() {
            Some(b'"') => self.parse_string().map(JsonVal::Str),
            Some(b'{') => self.parse_object(depth),
            Some(b'[') => self.parse_array(depth),
            Some(b't') => self.literal(b"true", JsonVal::Bool(true)),
            Some(b'f') => self.literal(b"false", JsonVal::Bool(false)),
            Some(b'n') => self.literal(b"null", JsonVal::Null),
            Some(b'-' | b'0'..=b'9') => self.parse_number(),
            _ => Err("beklenmeyen JSON değeri".to_string()),
        }
    }

    fn literal(&mut self, expected: &[u8], value: JsonVal) -> Result<JsonVal, String> {
        if self.data.get(self.pos..self.pos + expected.len()) == Some(expected) {
            self.pos += expected.len();
            Ok(value)
        } else {
            Err("geçersiz JSON literal".to_string())
        }
    }

    fn parse_object(&mut self, depth: usize) -> Result<JsonVal, String> {
        self.expect(b'{')?;
        let mut members = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(JsonVal::Obj(members));
        }

        loop {
            self.skip_ws();
            let key = self.parse_string()?;
            if members.iter().any(|(existing, _)| existing == &key) {
                return Err(format!("tekrar eden JSON anahtarı: {key}"));
            }
            self.skip_ws();
            self.expect(b':')?;
            let value = self.parse_value(depth + 1)?;
            members.push((key, value));
            self.skip_ws();
            match self.next() {
                Some(b'}') => return Ok(JsonVal::Obj(members)),
                Some(b',') => {
                    self.skip_ws();
                    if self.peek() == Some(b'}') {
                        return Err("nesnede sonda virgül var".to_string());
                    }
                }
                _ => return Err("nesnede ',' veya '}' bekleniyordu".to_string()),
            }
        }
    }

    fn parse_array(&mut self, depth: usize) -> Result<JsonVal, String> {
        self.expect(b'[')?;
        let mut values = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(JsonVal::Arr(values));
        }

        loop {
            values.push(self.parse_value(depth + 1)?);
            self.skip_ws();
            match self.next() {
                Some(b']') => return Ok(JsonVal::Arr(values)),
                Some(b',') => {
                    self.skip_ws();
                    if self.peek() == Some(b']') {
                        return Err("dizide sonda virgül var".to_string());
                    }
                }
                _ => return Err("dizide ',' veya ']' bekleniyordu".to_string()),
            }
        }
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = Vec::new();
        loop {
            let ch = self
                .next()
                .ok_or_else(|| "kapanmayan JSON string".to_string())?;
            match ch {
                b'"' => {
                    return String::from_utf8(out).map_err(|_| "geçersiz UTF-8 string".to_string())
                }
                b'\\' => {
                    let esc = self.next().ok_or_else(|| "eksik JSON escape".to_string())?;
                    match esc {
                        b'"' => out.push(b'"'),
                        b'\\' => out.push(b'\\'),
                        b'/' => out.push(b'/'),
                        b'b' => out.push(0x08),
                        b'f' => out.push(0x0c),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'u' => {
                            let cp = self.read_unicode_escape()?;
                            let c = char::from_u32(cp)
                                .ok_or_else(|| "geçersiz unicode codepoint".to_string())?;
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                        }
                        _ => return Err("geçersiz JSON escape".to_string()),
                    }
                }
                0x00..=0x1f => return Err("JSON string içinde kontrol karakteri".to_string()),
                _ => out.push(ch),
            }
        }
    }

    fn read_unicode_escape(&mut self) -> Result<u32, String> {
        let first = self.read_hex4()?;
        if (0xD800..=0xDBFF).contains(&first) {
            if self.next() != Some(b'\\') || self.next() != Some(b'u') {
                return Err("eksik unicode surrogate çifti".to_string());
            }
            let second = self.read_hex4()?;
            if !(0xDC00..=0xDFFF).contains(&second) {
                return Err("geçersiz unicode surrogate çifti".to_string());
            }
            return Ok(0x10000 + (((first - 0xD800) << 10) | (second - 0xDC00)));
        }
        if (0xDC00..=0xDFFF).contains(&first) {
            return Err("tekil low surrogate".to_string());
        }
        Ok(first)
    }

    fn read_hex4(&mut self) -> Result<u32, String> {
        let mut value = 0u32;
        for _ in 0..4 {
            let b = self.next().ok_or_else(|| "eksik unicode hex".to_string())?;
            let nibble = hex_nibble(b).ok_or_else(|| "geçersiz unicode hex".to_string())?;
            value = (value << 4) | u32::from(nibble);
        }
        Ok(value)
    }

    fn parse_number(&mut self) -> Result<JsonVal, String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => {
                self.pos += 1;
                if matches!(self.peek(), Some(b'0'..=b'9')) {
                    return Err("sayıda leading zero".to_string());
                }
            }
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.pos += 1;
                }
            }
            _ => return Err("geçersiz sayı".to_string()),
        }

        let mut is_float = false;
        if self.peek() == Some(b'.') {
            is_float = true;
            self.pos += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err("geçersiz ondalık sayı".to_string());
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }

        if matches!(self.peek(), Some(b'e' | b'E')) {
            is_float = true;
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err("geçersiz exponent".to_string());
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }

        let raw = std::str::from_utf8(&self.data[start..self.pos])
            .map_err(|_| "sayı UTF-8 değil".to_string())?;
        if is_float {
            let v = raw
                .parse::<f64>()
                .map_err(|_| "float parse hatası".to_string())?;
            if !v.is_finite() {
                return Err("sonlu olmayan float".to_string());
            }
            Ok(JsonVal::Float(v))
        } else {
            raw.parse::<i64>()
                .map(JsonVal::Int)
                .map_err(|_| "integer parse hatası".to_string())
        }
    }

    fn expect(&mut self, expected: u8) -> Result<(), String> {
        match self.next() {
            Some(actual) if actual == expected => Ok(()),
            _ => Err(format!("'{}' bekleniyordu", expected as char)),
        }
    }
}

fn canonical_signed_payload_from_json(content: &str) -> Result<String, String> {
    let root = JsonParser::new(content).parse()?;
    let JsonVal::Obj(members) = root else {
        return Err("JSON kökü nesne değil".to_string());
    };

    let cm = find_member(&members, "extended_causal_model")
        .ok_or_else(|| "extended_causal_model eksik".to_string())?;
    let bridge = find_member(&members, "v1_engine_bridge")
        .ok_or_else(|| "v1_engine_bridge eksik".to_string())?;

    let mut payload = String::new();
    payload.push_str("CAELUS_SCENARIO_PACK_V1\n");
    payload.push_str("extended_causal_model=");
    payload.push_str(&canonical_json(cm));
    payload.push('\n');
    payload.push_str("v1_engine_bridge=");
    payload.push_str(&canonical_json(bridge));
    payload.push('\n');
    Ok(payload)
}

fn find_member<'a>(members: &'a [(String, JsonVal)], key: &str) -> Option<&'a JsonVal> {
    members
        .iter()
        .find_map(|(candidate, value)| (candidate == key).then_some(value))
}

fn canonical_json(value: &JsonVal) -> String {
    match value {
        JsonVal::Null => "null".to_string(),
        JsonVal::Bool(v) => {
            if *v {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        JsonVal::Int(v) => v.to_string(),
        JsonVal::Float(v) => canonical_float(*v),
        JsonVal::Str(v) => canonical_string(v),
        JsonVal::Arr(values) => {
            let mut out = String::from("[");
            for (idx, item) in values.iter().enumerate() {
                if idx > 0 {
                    out.push(',');
                }
                out.push_str(&canonical_json(item));
            }
            out.push(']');
            out
        }
        JsonVal::Obj(members) => {
            let mut sorted: Vec<_> = members.iter().collect();
            sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
            let mut out = String::from("{");
            for (idx, (key, value)) in sorted.iter().enumerate() {
                if idx > 0 {
                    out.push(',');
                }
                out.push_str(&canonical_string(key));
                out.push(':');
                out.push_str(&canonical_json(value));
            }
            out.push('}');
            out
        }
    }
}

fn canonical_string(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{00}'..='\u{1f}' => out.push_str(&format!("\\u00{:02x}", ch as u32)),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

fn canonical_float(value: f64) -> String {
    if value == 0.0 {
        return if value.is_sign_negative() {
            "-0".to_string()
        } else {
            "0".to_string()
        };
    }

    let sign = if value.is_sign_negative() { "-" } else { "" };
    let abs = value.abs();
    let exponent = abs.log10().floor() as i32;
    if !(-4..17).contains(&exponent) {
        let raw = format!("{abs:.16e}");
        return format!("{sign}{}", normalize_scientific(&raw));
    }

    let digits_before_decimal = exponent + 1;
    let frac_digits = (17 - digits_before_decimal).max(0) as usize;
    let mut out = format!("{sign}{abs:.frac_digits$}");
    trim_fraction_zeros(&mut out);
    out
}

fn normalize_scientific(raw: &str) -> String {
    let Some((mantissa, exponent)) = raw.split_once('e') else {
        return raw.to_string();
    };
    let mut mantissa = mantissa.to_string();
    trim_fraction_zeros(&mut mantissa);
    let exp_value = exponent.parse::<i32>().unwrap_or(0);
    let exp_sign = if exp_value < 0 { '-' } else { '+' };
    let exp_abs = exp_value.abs();
    if exp_abs < 10 {
        format!("{mantissa}e{exp_sign}0{exp_abs}")
    } else {
        format!("{mantissa}e{exp_sign}{exp_abs}")
    }
}

fn trim_fraction_zeros(value: &mut String) {
    if value.contains('.') {
        while value.ends_with('0') {
            value.pop();
        }
        if value.ends_with('.') {
            value.pop();
        }
    }
}

fn load_or_generate_seed(key: &str, generate_key: bool) -> Result<[u8; 32], String> {
    if is_hex_string(key, 64) {
        if generate_key {
            return Err(
                "--generate-key hex literal ile değil, dosya yolu ile kullanılır".to_string(),
            );
        }
        return hex_to_32(key);
    }

    let path = Path::new(key);
    if path.exists() {
        return read_seed_file(path);
    }
    if !generate_key {
        return Err(format!("key dosyası bulunamadı: {key}"));
    }

    let mut seed = [0u8; 32];
    OsRng.fill_bytes(&mut seed);
    fs::write(path, seed).map_err(|e| format!("key yazılamadı: {e}"))?;
    Ok(seed)
}

fn read_seed_file(path: &Path) -> Result<[u8; 32], String> {
    let bytes = fs::read(path).map_err(|e| format!("key okunamadı: {e}"))?;
    if bytes.len() == 32 {
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&bytes);
        return Ok(seed);
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| "key dosyası 32 raw byte veya 64 hex karakter olmalı".to_string())?
        .trim();
    hex_to_32(text)
}

fn sign_payload(payload: &[u8], seed: &[u8; 32]) -> Result<([u8; 32], [u8; 64]), String> {
    let mut signature = [0u8; 64];
    let mut pubkey = [0u8; 32];
    let ok = caelus_sign_scenario_payload(
        payload.as_ptr(),
        payload.len(),
        seed.as_ptr(),
        seed.len(),
        signature.as_mut_ptr(),
        pubkey.as_mut_ptr(),
    );
    if ok != 1 {
        return Err("caelus_sign_scenario_payload başarısız".to_string());
    }
    Ok((pubkey, signature))
}

fn replace_top_level_signature(content: &str, signature: &str) -> Result<String, String> {
    let bytes = content.as_bytes();
    let mut pos = 0usize;
    let mut depth = 0usize;
    while pos < bytes.len() {
        match bytes[pos] {
            b'"' => {
                let key_start = pos;
                let key_end = skip_json_string(bytes, pos)?;
                if depth == 1 && &content[key_start + 1..key_end - 1] == "signature" {
                    let mut cursor = key_end;
                    skip_ws_bytes(bytes, &mut cursor);
                    if bytes.get(cursor) != Some(&b':') {
                        return Err("signature alanında ':' bulunamadı".to_string());
                    }
                    cursor += 1;
                    skip_ws_bytes(bytes, &mut cursor);
                    if bytes.get(cursor) != Some(&b'"') {
                        return Err("signature değeri string değil".to_string());
                    }
                    let value_start = cursor;
                    let value_end = skip_json_string(bytes, cursor)?;
                    let mut out = String::new();
                    out.push_str(&content[..value_start]);
                    out.push_str(&canonical_string(signature));
                    out.push_str(&content[value_end..]);
                    return Ok(out);
                }
                pos = key_end;
            }
            b'{' | b'[' => {
                depth += 1;
                pos += 1;
            }
            b'}' | b']' => {
                depth = depth.saturating_sub(1);
                pos += 1;
            }
            _ => pos += 1,
        }
    }
    Err("top-level signature alanı bulunamadı".to_string())
}

fn skip_json_string(bytes: &[u8], start: usize) -> Result<usize, String> {
    if bytes.get(start) != Some(&b'"') {
        return Err("string başlangıcı bekleniyordu".to_string());
    }
    let mut pos = start + 1;
    while pos < bytes.len() {
        match bytes[pos] {
            b'"' => return Ok(pos + 1),
            b'\\' => pos += 2,
            _ => pos += 1,
        }
    }
    Err("kapanmayan string".to_string())
}

fn skip_ws_bytes(bytes: &[u8], pos: &mut usize) {
    while matches!(bytes.get(*pos), Some(b' ' | b'\n' | b'\r' | b'\t')) {
        *pos += 1;
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn hex_to_32(value: &str) -> Result<[u8; 32], String> {
    if !is_hex_string(value, 64) {
        return Err("seed 64 hex karakter veya 32 raw byte dosya olmalı".to_string());
    }
    let mut out = [0u8; 32];
    for (idx, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        let hi = hex_nibble(chunk[0]).ok_or_else(|| "geçersiz hex".to_string())?;
        let lo = hex_nibble(chunk[1]).ok_or_else(|| "geçersiz hex".to_string())?;
        out[idx] = (hi << 4) | lo;
    }
    Ok(out)
}

fn is_hex_string(value: &str, len: usize) -> bool {
    value.len() == len && value.as_bytes().iter().all(|b| hex_nibble(*b).is_some())
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(10 + b - b'a'),
        b'A'..=b'F' => Some(10 + b - b'A'),
        _ => None,
    }
}

/// Plugin imza mesajını kur: "CAELUS_PLUGIN_V1\n" || ham dosya byte'ları.
fn plugin_signing_message(raw: &[u8]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(PLUGIN_SIGN_DOMAIN.len() + raw.len());
    msg.extend_from_slice(PLUGIN_SIGN_DOMAIN);
    msg.extend_from_slice(raw);
    msg
}

/// `--sign-plugin` modu: dll/so dosyasının ham byte'larını domain prefix'iyle
/// imzalar ve sidecar'a (`<plugin_path>.sig`) tek satır olarak yazar:
/// `ed25519:<64hex-pubkey>:<128hex-sig>` (senaryo imza formatıyla aynı).
fn sign_plugin_file(plugin_path: &str, seed: &[u8; 32]) -> Result<String, String> {
    let raw = fs::read(plugin_path).map_err(|e| format!("plugin okunamadı: {e}"))?;
    let msg = plugin_signing_message(&raw);
    if msg.len() > FFI_MAX_PAYLOAD {
        return Err(format!(
            "plugin {} bayt; FFI imza sınırı {} baytı aşıyor",
            raw.len(),
            FFI_MAX_PAYLOAD
        ));
    }
    let (pubkey, signature) = sign_payload(&msg, seed)?;
    let signature_text = format!("ed25519:{}:{}", hex_encode(&pubkey), hex_encode(&signature));

    let sidecar_path = format!("{plugin_path}.sig");
    fs::write(&sidecar_path, format!("{signature_text}\n"))
        .map_err(|e| format!("sidecar yazılamadı ({sidecar_path}): {e}"))?;
    eprintln!("[SIGNER] sidecar yazıldı: {sidecar_path}");
    Ok(signature_text)
}

fn usage() -> &'static str {
    "Kullanim: caelus_sign_scenario --json <path> --key <hex-seed|dosya> [--generate-key] [--write]\n\
     veya   : caelus_sign_scenario --sign-plugin <dll/so path> --key <hex-seed|dosya> [--generate-key]\n\
     Modlar:\n\
       --json <path>         Senaryo paketini imzalar (canonical payload); --write ile\n\
                             imzayi JSON'daki top-level \"signature\" alanina geri yazar.\n\
       --sign-plugin <path>  Dinamik eklentinin (dll/so) HAM byte'larini\n\
                             \"CAELUS_PLUGIN_V1\\n\" domain prefix'iyle imzalar ve\n\
                             <path>.sig sidecar dosyasina tek satir yazar:\n\
                             ed25519:<64hex-pubkey>:<128hex-sig>\n\
     Ornekler:\n\
       cargo run --bin caelus_sign_scenario -- --json scenarios/BS-01_SAHTE_UFUK.json --key tools/caelus_signing.key --write\n\
       cargo run --bin caelus_sign_scenario -- --sign-plugin plugins/solver.dll --key tools/caelus_signing.key"
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{}", usage());
        return Ok(());
    }

    let mut json_path: Option<String> = None;
    let mut plugin_path: Option<String> = None;
    let mut key: Option<String> = None;
    let mut generate_key = false;
    let mut write = false;
    let mut idx = 0usize;
    while idx < args.len() {
        match args[idx].as_str() {
            "--json" => {
                idx += 1;
                json_path = args.get(idx).cloned();
            }
            "--sign-plugin" => {
                idx += 1;
                plugin_path = args.get(idx).cloned();
            }
            "--key" => {
                idx += 1;
                key = args.get(idx).cloned();
            }
            "--generate-key" => generate_key = true,
            "--write" => write = true,
            other => return Err(format!("bilinmeyen argüman: {other}\n{}", usage())),
        }
        idx += 1;
    }

    let key = key.ok_or_else(|| format!("--key zorunlu\n{}", usage()))?;

    // ── Plugin imzalama modu ──────────────────────────────────────────────────
    if let Some(plugin_path) = plugin_path {
        if json_path.is_some() {
            return Err(format!(
                "--sign-plugin ile --json aynı anda kullanılamaz\n{}",
                usage()
            ));
        }
        let seed = load_or_generate_seed(&key, generate_key)?;
        let signature_text = sign_plugin_file(&plugin_path, &seed)?;
        println!("{signature_text}");
        return Ok(());
    }

    // ── Senaryo imzalama modu (mevcut davranış) ───────────────────────────────
    let json_path = json_path.ok_or_else(|| format!("--json zorunlu\n{}", usage()))?;
    let content = fs::read_to_string(&json_path).map_err(|e| format!("JSON okunamadı: {e}"))?;
    let payload = canonical_signed_payload_from_json(&content)?;
    let seed = load_or_generate_seed(&key, generate_key)?;
    let (pubkey, signature) = sign_payload(payload.as_bytes(), &seed)?;
    let signature_text = format!("ed25519:{}:{}", hex_encode(&pubkey), hex_encode(&signature));

    if write {
        let updated = replace_top_level_signature(&content, &signature_text)?;
        fs::write(&json_path, updated).map_err(|e| format!("JSON yazılamadı: {e}"))?;
    }

    println!("{signature_text}");
    Ok(())
}

fn main() {
    if let Err(err) = run() {
        eprintln!("[SIGNER] {err}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_payload_matches_cpp_shape() {
        let json = r#"{
          "signature": "SELF_SIGNED_DEV",
          "v1_engine_bridge": {"z": true, "a": 0.35},
          "extended_causal_model": {"b": [2, 1], "a": "ç"}
        }"#;
        let payload = canonical_signed_payload_from_json(json).unwrap();
        assert_eq!(
            payload,
            "CAELUS_SCENARIO_PACK_V1\n\
extended_causal_model={\"a\":\"ç\",\"b\":[2,1]}\n\
v1_engine_bridge={\"a\":0.34999999999999998,\"z\":true}\n"
        );
    }

    #[test]
    fn fixed_seed_signature_is_deterministic_and_verifier_shaped() {
        let seed = [7u8; 32];
        let payload = b"CAELUS_SCENARIO_PACK_V1\nextended_causal_model={}\nv1_engine_bridge={}\n";
        let (pubkey_a, sig_a) = sign_payload(payload, &seed).unwrap();
        let (pubkey_b, sig_b) = sign_payload(payload, &seed).unwrap();
        assert_eq!(pubkey_a, pubkey_b);
        assert_eq!(sig_a, sig_b);

        let signature_text = format!("ed25519:{}:{}", hex_encode(&pubkey_a), hex_encode(&sig_a));
        let parts: Vec<_> = signature_text.split(':').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "ed25519");
        assert_eq!(parts[1].len(), 64);
        assert_eq!(parts[2].len(), 128);
    }

    #[test]
    fn plugin_signature_is_domain_separated_and_verifier_compatible() {
        let seed = [9u8; 32];
        let raw: &[u8] = b"MZ\x90\x00fake-dll-bytes\x00\x01\x02";

        let msg = plugin_signing_message(raw);
        assert!(msg.starts_with(b"CAELUS_PLUGIN_V1\n"));
        assert_eq!(&msg[PLUGIN_SIGN_DOMAIN.len()..], raw);

        // Domain ayrımı: prefix'siz ham byte imzası farklı olmalı.
        let (pubkey, sig) = sign_payload(&msg, &seed).unwrap();
        let (_, sig_without_domain) = sign_payload(raw, &seed).unwrap();
        assert_ne!(sig.to_vec(), sig_without_domain.to_vec());

        // Motorun çağıracağı doğrulama yolu (aynı FFI) ile birebir uyum.
        let ok = caelus_network::caelus_verify_scenario_signature(
            msg.as_ptr(),
            msg.len(),
            pubkey.as_ptr(),
            sig.as_ptr(),
        );
        assert_eq!(ok, 1);

        // Prefix bozulursa imza geçmemeli.
        let mut tampered = msg.clone();
        tampered[0] ^= 0xFF;
        let bad = caelus_network::caelus_verify_scenario_signature(
            tampered.as_ptr(),
            tampered.len(),
            pubkey.as_ptr(),
            sig.as_ptr(),
        );
        assert_eq!(bad, 0);
    }
}
