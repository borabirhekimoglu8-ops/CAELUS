// CAELUS OS — Hash-Chained Audit Log  (src/audit_log.rs)
//
// ═══════════════════════════════════════════════════════════════════════════
// R6 — GELISTIRME_RAPORU.md: Hash-Zincirli Denetim Günlüğü
// ═══════════════════════════════════════════════════════════════════════════
//
// Her satır önceki satırın Blake3 özetine zincirlenir:
//   h_n = Blake3(h_{n-1} || event_json_bytes)
//
// Zincir şeması:
//   GENESIS  →  EVENT₁  →  EVENT₂  →  …  →  EVENTₙ  →  SEAL
//   h₀           h₁           h₂               hₙ       ed25519(hₙ)
//
// Dosya formatı: NDJSON (her satır bağımsız bir JSON nesnesidir).
//
// Adli kanıt özellikleri:
//   • Append-only açılış (O_APPEND) — mevcut içerik değiştirilemez.
//   • Her satır prev + hash içerir — tek bit değişimi zinciri kırar.
//   • Oturum mührü: ed25519(SEAL_CTX || session_id || seq || chain_head)
//     ile imzalanır; imza sahibi cihaz parmak izi + genel anahtar içerir.
//   • Sanal saat desteği: --det-mode'da ts=0 → deterministik hash.
//
// Zincir doğrulama (harici araç):
//   1. Her satırı oku; prev ve hash alanlarını ayıkla.
//   2. h_n' = Blake3(h_{prev} || event_json_field_bytes)
//   3. h_n' == hash → zincir sağlam.
//   4. Son satır SEAL: ed25519_verify(pubkey, msg, sig) doğrula.
// ═══════════════════════════════════════════════════════════════════════════

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::sync::Arc;

use crate::network::discovery::current_secs;
use crate::network::mesh_auth::{CaelusIdentityHandle, DeviceIdentity};

// ── Bağlam ayırıcıları (cross-protocol signature reuse önlemek için) ─────────
const AUDIT_GENESIS_CTX: &[u8] = b"CAELUS_AUDIT_GENESIS_V1";
const AUDIT_SEAL_CTX: &[u8] = b"CAELUS_AUDIT_SEAL_V1";

const DEFAULT_AUDIT_MAX_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_AUDIT_FLUSH_EVERY: u64 = 1;
const ENV_AUDIT_MAX_BYTES: &str = "CAELUS_AUDIT_MAX_BYTES";
const ENV_AUDIT_FLUSH_EVERY: &str = "CAELUS_AUDIT_FLUSH_EVERY";

// ── Hex kodlama yardımcıları ──────────────────────────────────────────────────

fn hex32(b: &[u8; 32]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn hex_n(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// CaelusAuditLog — ana yapı
// ─────────────────────────────────────────────────────────────────────────────

/// Append-only, Blake3-zincirli, ed25519-mühürlü denetim günlüğü.
///
/// NOT: Bu struct, FFI snırı boyunca `Box<CaelusAuditLog>` olarak taşınır.
/// Çok iş parçacıklı erişim HEDEFLENMİYOR; motor tek iş parçacıklıdır.
pub struct CaelusAuditLog {
    writer: BufWriter<File>,
    chain_head: [u8; 32],
    seq: u64,
    total_events: u64,
    session_id: u64,
    identity: Arc<DeviceIdentity>,
    base_path: String,
    path: String,
    segment_index: u64,
    current_bytes: u64,
    max_bytes: u64,
    flush_every: u64,
    writes_since_flush: u64,
    sealed: bool,
}

#[derive(Clone, Copy)]
struct AuditLogConfig {
    max_bytes: u64,
    flush_every: u64,
}

impl AuditLogConfig {
    fn from_env() -> Self {
        Self {
            max_bytes: read_positive_env_u64(ENV_AUDIT_MAX_BYTES, DEFAULT_AUDIT_MAX_BYTES),
            flush_every: read_positive_env_u64(ENV_AUDIT_FLUSH_EVERY, DEFAULT_AUDIT_FLUSH_EVERY),
        }
    }
}

fn read_positive_env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn audit_segment_path(base_path: &str, segment_index: u64) -> String {
    if segment_index == 0 {
        base_path.to_owned()
    } else {
        format!("{}.{}", base_path, segment_index)
    }
}

impl CaelusAuditLog {
    /// Yeni denetim günlüğü aç (veya var olan dosyaya ekle).
    ///
    /// Genesis kaydı hemen yazılır:
    ///   h₀ = Blake3(AUDIT_GENESIS_CTX || session_id_le_bytes)
    pub fn open(
        path: &str,
        identity: Arc<DeviceIdentity>,
        session_id: u64,
    ) -> std::io::Result<Self> {
        Self::open_with_config(path, identity, session_id, AuditLogConfig::from_env())
    }

    fn open_with_config(
        path: &str,
        identity: Arc<DeviceIdentity>,
        session_id: u64,
        config: AuditLogConfig,
    ) -> std::io::Result<Self> {
        let segment_index = 0;
        let segment_path = audit_segment_path(path, segment_index);
        let (writer, current_bytes) = Self::open_segment_writer(&segment_path)?;

        let mut log = Self {
            writer,
            chain_head: [0u8; 32],
            seq: 0,
            total_events: 0,
            session_id,
            identity,
            base_path: path.to_owned(),
            path: segment_path,
            segment_index,
            current_bytes,
            max_bytes: config.max_bytes,
            flush_every: config.flush_every,
            writes_since_flush: 0,
            sealed: false,
        };

        log.write_genesis(None)?;

        eprintln!(
            "[AUDIT] Günlük açıldı: {}  genesis={}  max_bytes={}  flush_every={}",
            log.path,
            &hex32(&log.chain_head)[..16],
            log.max_bytes,
            log.flush_every
        );

        Ok(log)
    }

    fn open_segment_writer(path: &str) -> std::io::Result<(BufWriter<File>, u64)> {
        let file = OpenOptions::new()
            .create(true)
            .append(true) // Append-only: var olan içerik güvende
            .open(path)?;
        let current_bytes = file.metadata()?.len();
        Ok((BufWriter::new(file), current_bytes))
    }

    fn write_genesis(&mut self, prev_segment_chain_head: Option<[u8; 32]>) -> std::io::Result<()> {
        // Genesis hash'i hesapla
        let mut hasher = blake3::Hasher::new();
        hasher.update(AUDIT_GENESIS_CTX);
        hasher.update(&self.session_id.to_le_bytes());
        if let Some(prev_head) = prev_segment_chain_head {
            hasher.update(&self.segment_index.to_le_bytes());
            hasher.update(&prev_head);
        }
        let chain_head = *hasher.finalize().as_bytes();
        self.chain_head = chain_head;
        self.seq = 0;
        self.writes_since_flush = 0;

        // Genesis kaydını yaz
        let genesis = if let Some(prev_head) = prev_segment_chain_head {
            format!(
                "{{\"seq\":0,\"ts\":{},\"type\":\"GENESIS\",\
                 \"session_id\":\"{:016x}\",\
                 \"segment\":{},\
                 \"prev_segment_chain_head\":\"{}\",\
                 \"prev\":\"{}\",\
                 \"hash\":\"{}\"}}\n",
                current_secs(),
                self.session_id,
                self.segment_index,
                hex32(&prev_head),
                "0".repeat(64),
                hex32(&chain_head)
            )
        } else {
            format!(
                "{{\"seq\":0,\"ts\":{},\"type\":\"GENESIS\",\
                 \"session_id\":\"{:016x}\",\
                 \"prev\":\"{}\",\
                 \"hash\":\"{}\"}}\n",
                current_secs(),
                self.session_id,
                "0".repeat(64),
                hex32(&chain_head)
            )
        };
        self.writer.write_all(genesis.as_bytes())?;
        self.current_bytes = self.current_bytes.saturating_add(genesis.len() as u64);
        self.writer.flush()?;
        Ok(())
    }

    // ── Zincir ekleme ─────────────────────────────────────────────────────────

    /// Bir olay JSON'ını zincire ekle ve diske yaz.
    ///
    /// Zincir kuralı:
    ///   h_n = Blake3(h_{n-1} || event_json_bytes)
    ///
    /// Dosyaya yazılan satır:
    ///   {"seq":N,"ts":T,"type":"EVENT","prev":"<hex>","hash":"<hex>","event":<json>}
    ///
    /// event_json, geçerli bir JSON değeri (nesne veya string) olmalıdır.
    /// İçeriği, hash hesabında AYNEN kullanılır — boşluk farkı zinciri kırar.
    pub fn append(&mut self, event_json: &str) -> bool {
        if self.sealed {
            return false;
        }
        if let Err(e) = self.rotate_if_needed(event_json) {
            eprintln!("[AUDIT] Rotasyon hatası: {}", e);
            return false;
        }

        match self.write_event(event_json) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("[AUDIT] Yazma hatası: {}", e);
                false
            }
        }
    }

    fn write_event(&mut self, event_json: &str) -> std::io::Result<()> {
        let (line, new_hash) = self.build_event_line(event_json);
        self.writer.write_all(line.as_bytes())?;
        self.current_bytes = self.current_bytes.saturating_add(line.len() as u64);
        self.seq += 1;
        self.total_events += 1;
        self.chain_head = new_hash;
        self.flush_after_event()?;
        Ok(())
    }

    fn build_event_line(&self, event_json: &str) -> (String, [u8; 32]) {
        // h_n = Blake3(h_{n-1} || event_json_bytes)
        let mut hasher = blake3::Hasher::new();
        hasher.update(&self.chain_head);
        hasher.update(event_json.as_bytes());
        let new_hash = *hasher.finalize().as_bytes();

        let next_seq = self.seq + 1;
        let line = if self.segment_index == 0 {
            format!(
                "{{\"seq\":{},\"ts\":{},\"type\":\"EVENT\",\
                 \"prev\":\"{}\",\
                 \"hash\":\"{}\",\
                 \"event\":{}}}\n",
                next_seq,
                current_secs(),
                hex32(&self.chain_head),
                hex32(&new_hash),
                event_json
            )
        } else {
            format!(
                "{{\"seq\":{},\"ts\":{},\"type\":\"EVENT\",\
                 \"segment\":{},\
                 \"prev\":\"{}\",\
                 \"hash\":\"{}\",\
                 \"event\":{}}}\n",
                next_seq,
                current_secs(),
                self.segment_index,
                hex32(&self.chain_head),
                hex32(&new_hash),
                event_json
            )
        };

        (line, new_hash)
    }

    fn rotate_if_needed(&mut self, event_json: &str) -> std::io::Result<()> {
        let (line, _) = self.build_event_line(event_json);
        if self.seq > 0 && self.current_bytes.saturating_add(line.len() as u64) > self.max_bytes {
            self.rotate_segment()?;
        }
        Ok(())
    }

    fn rotate_segment(&mut self) -> std::io::Result<()> {
        let prev_segment_chain_head = self.chain_head;
        self.seal_segment()?;

        self.segment_index += 1;
        self.path = audit_segment_path(&self.base_path, self.segment_index);
        let (writer, current_bytes) = Self::open_segment_writer(&self.path)?;
        self.writer = writer;
        self.current_bytes = current_bytes;
        self.write_genesis(Some(prev_segment_chain_head))?;

        eprintln!(
            "[AUDIT] Yeni segment: {}  prev_head={}  genesis={}",
            self.path,
            &hex32(&prev_segment_chain_head)[..16],
            &hex32(&self.chain_head)[..16]
        );
        Ok(())
    }

    fn flush_after_event(&mut self) -> std::io::Result<()> {
        self.writes_since_flush = self.writes_since_flush.saturating_add(1);
        if self.writes_since_flush >= self.flush_every {
            // Varsayılan flush_every=1 adli dayanıklılığı korur. Daha büyük değerler
            // I/O maliyetini azaltır fakat güç kesintisinde son N event kaybolabilir.
            self.writer.flush()?;
            self.writes_since_flush = 0;
        }
        Ok(())
    }

    // ── Mühürleme (ed25519 oturum imzası) ────────────────────────────────────

    /// Zinciri mühürle ve oturum imzasını yaz.
    ///
    /// İmzalanan mesaj (cross-protocol güvenliği için domain ayrılmış):
    ///   AUDIT_SEAL_CTX || session_id_le8 || seq_le8 || chain_head_32
    ///
    /// Son satır:
    ///   {"seq":N+1,"ts":T,"type":"SEAL",
    ///    "chain_head":"<hex64>","entries":N,
    ///    "pubkey":"<hex64>","fingerprint":"<hex64>","sig":"<hex128>"}
    ///
    /// İdempotent: çift seal çağrısı güvenli (ikinci çağrı false döner).
    pub fn seal(&mut self) -> bool {
        if self.sealed {
            return false;
        }
        match self.seal_segment() {
            Ok(()) => {
                self.sealed = true;
                true
            }
            Err(e) => {
                eprintln!("[AUDIT] Mühür yazma hatası: {} ({})", self.path, e);
                false
            }
        }
    }

    fn seal_segment(&mut self) -> std::io::Result<()> {
        self.seq += 1;

        // İmzalanacak mesajı oluştur
        let mut msg: Vec<u8> = Vec::with_capacity(AUDIT_SEAL_CTX.len() + 48);
        msg.extend_from_slice(AUDIT_SEAL_CTX);
        msg.extend_from_slice(&self.session_id.to_le_bytes()); // 8 bayt
        msg.extend_from_slice(&self.seq.to_le_bytes()); // 8 bayt (seal seq dahil)
        msg.extend_from_slice(&self.chain_head); // 32 bayt

        // ed25519 deterministik imza (RFC 8032 §5.1 — rastgele nonce YOK)
        let signature = self.identity.sign(&msg);
        let sig_bytes = signature.to_bytes();
        let pubkey_bytes = *self.identity.verifying_key.as_bytes();
        let fp_bytes = self.identity.fingerprint;

        let entries = self.seq - 1; // genesis + event kayıt sayısı (seal hariç)

        let seal_line = if self.segment_index == 0 {
            format!(
                "{{\"seq\":{},\"ts\":{},\"type\":\"SEAL\",\
                 \"chain_head\":\"{}\",\
                 \"entries\":{},\
                 \"pubkey\":\"{}\",\
                 \"fingerprint\":\"{}\",\
                 \"sig\":\"{}\"}}\n",
                self.seq,
                current_secs(),
                hex32(&self.chain_head),
                entries,
                hex_n(&pubkey_bytes),
                hex32(&fp_bytes),
                hex_n(&sig_bytes)
            )
        } else {
            format!(
                "{{\"seq\":{},\"ts\":{},\"type\":\"SEAL\",\
                 \"segment\":{},\
                 \"chain_head\":\"{}\",\
                 \"entries\":{},\
                 \"pubkey\":\"{}\",\
                 \"fingerprint\":\"{}\",\
                 \"sig\":\"{}\"}}\n",
                self.seq,
                current_secs(),
                self.segment_index,
                hex32(&self.chain_head),
                entries,
                hex_n(&pubkey_bytes),
                hex32(&fp_bytes),
                hex_n(&sig_bytes)
            )
        };

        self.writer.write_all(seal_line.as_bytes())?;
        self.current_bytes = self.current_bytes.saturating_add(seal_line.len() as u64);
        self.writer.flush()?;

        eprintln!(
            "[AUDIT] Mühürlendi: {}  zincir_başı={}  giriş={}",
            self.path,
            &hex32(&self.chain_head)[..16],
            entries
        );
        Ok(())
    }

    // ── Sorgulama ─────────────────────────────────────────────────────────────

    pub fn chain_head(&self) -> &[u8; 32] {
        &self.chain_head
    }
    pub fn entry_count(&self) -> u64 {
        self.total_events
    }
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn is_sealed(&self) -> bool {
        self.sealed
    }
}

impl Drop for CaelusAuditLog {
    /// Henüz mühürlenmemişse, drop sırasında otomatik mühürle.
    fn drop(&mut self) {
        if !self.sealed {
            self.seal();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FFI guard yardımcıları (mesh_auth.rs ve discovery.rs ile aynı desen)
// ─────────────────────────────────────────────────────────────────────────────

fn ffi_guard_u8<F: FnOnce() -> u8>(f: F) -> u8 {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(0)
}

fn ffi_guard_ptr<T, F: FnOnce() -> *mut T>(f: F) -> *mut T {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(std::ptr::null_mut())
}

// ─────────────────────────────────────────────────────────────────────────────
// C FFI yüzeyi
// ─────────────────────────────────────────────────────────────────────────────

/// Yeni bir denetim günlüğü tahsis et.
///
/// log_path: UTF-8, (ptr, len) çifti — NUL sonlandırmalı değil.
/// Dönüş: NULL = hata (dosya açılamadı, identity null).
/// caelus_audit_free() ile serbest bırakılmalıdır.
#[no_mangle]
pub extern "C" fn caelus_audit_new(
    identity: *const CaelusIdentityHandle,
    session_id: u64,
    log_path: *const u8,
    log_path_len: usize,
) -> *mut CaelusAuditLog {
    ffi_guard_ptr(|| {
        if identity.is_null() || log_path.is_null() || log_path_len == 0 {
            return std::ptr::null_mut();
        }
        // SAFETY: identity, caelus_identity_new()'den geliyor; log_path geçerli.
        let id_ref = unsafe { (*identity).identity() };
        let id_arc = Arc::new(id_ref.clone());
        let bytes = unsafe { std::slice::from_raw_parts(log_path, log_path_len) };
        let path = match std::str::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        };
        match CaelusAuditLog::open(path, id_arc, session_id) {
            Ok(log) => Box::into_raw(Box::new(log)),
            Err(e) => {
                eprintln!("[AUDIT] Günlük açılamadı '{}': {}", path, e);
                std::ptr::null_mut()
            }
        }
    })
}

/// Bir JSON olayını zincire ekle.
///
/// event_json: UTF-8 JSON değeri (ptr, len) — NUL sonlandırmalı değil.
/// Dönüş: 1 = başarı, 0 = hata.
#[no_mangle]
pub extern "C" fn caelus_audit_append(
    ctx: *mut CaelusAuditLog,
    event_json: *const u8,
    event_len: usize,
) -> u8 {
    ffi_guard_u8(|| {
        if ctx.is_null() || event_json.is_null() || event_len == 0 {
            return 0;
        }
        // SAFETY: pointers validated; ctx produced by caelus_audit_new.
        let ctx_ref = unsafe { &mut *ctx };
        let bytes = unsafe { std::slice::from_raw_parts(event_json, event_len) };
        let json = match std::str::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return 0,
        };
        ctx_ref.append(json) as u8
    })
}

/// Mühür kaydını yaz ve dosyayı kapat (idempotent).
/// Dönüş: 1 = başarı.
#[no_mangle]
pub extern "C" fn caelus_audit_seal(ctx: *mut CaelusAuditLog) -> u8 {
    ffi_guard_u8(|| {
        if ctx.is_null() {
            return 0;
        }
        let ctx_ref = unsafe { &mut *ctx };
        ctx_ref.seal() as u8
    })
}

/// Mevcut zincir başını out_hash'e kopyala (≥32 bayt).
/// Dönüş: 1 = başarı.
#[no_mangle]
pub extern "C" fn caelus_audit_chain_head(ctx: *const CaelusAuditLog, out_hash: *mut u8) -> u8 {
    ffi_guard_u8(|| {
        if ctx.is_null() || out_hash.is_null() {
            return 0;
        }
        let ctx_ref = unsafe { &*ctx };
        // SAFETY: out_hash, ≥32 bayt (çağıran sözleşmesi).
        unsafe {
            std::ptr::copy_nonoverlapping(ctx_ref.chain_head().as_ptr(), out_hash, 32);
        }
        1
    })
}

/// Kayıt sayısını döndür (event'lar; seal dahil değil).
#[no_mangle]
pub extern "C" fn caelus_audit_entry_count(ctx: *const CaelusAuditLog) -> u64 {
    if ctx.is_null() {
        return 0;
    }
    let ctx_ref = unsafe { &*ctx };
    ctx_ref.entry_count()
}

/// Denetim günlüğünü serbest bırak (mühürlenmemişse önce mühürler).
/// NULL = güvenli no-op.
#[no_mangle]
pub extern "C" fn caelus_audit_free(ctx: *mut CaelusAuditLog) {
    if ctx.is_null() {
        return;
    }
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // SAFETY: ctx produced by caelus_audit_new, freed exactly once.
        // Drop impl calls seal() automatically.
        unsafe {
            drop(Box::from_raw(ctx));
        }
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Birim testleri
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::mesh_auth::DeviceIdentity;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_log(suffix: &str) -> CaelusAuditLog {
        let id = DeviceIdentity::generate();
        let path = std::env::temp_dir().join(format!("caelus_audit_test_{}.log", suffix));
        let log = CaelusAuditLog::open(path.to_str().unwrap(), Arc::new(id), 0xCAE1_0001u64)
            .expect("log open");
        log
    }

    fn unique_audit_path(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("{}_{}_{}.log", prefix, std::process::id(), nanos))
            .to_str()
            .unwrap()
            .to_owned()
    }

    fn remove_segments(base_path: &str, max_segments: u64) {
        for segment in 0..=max_segments {
            let _ = fs::remove_file(audit_segment_path(base_path, segment));
        }
    }

    fn extract_hex_field(line: &str, field: &str) -> Option<String> {
        let needle = format!("\"{}\":\"", field);
        let start = line.find(&needle)? + needle.len();
        let rest = &line[start..];
        let end = rest.find('"')?;
        Some(rest[..end].to_owned())
    }

    #[test]
    fn chain_is_deterministic_for_same_events() {
        // Aynı event dizisi → aynı chain_head
        let mut a = make_log("det_a");
        let mut b = make_log("det_b");
        // Override session_id için genesis'ten sonra aynı hash olmasını test etmek güç;
        // bunun yerine append sonrası hash'lerin tutarlı olduğunu doğrula.
        a.append(r#"{"type":"test","v":1}"#);
        b.append(r#"{"type":"test","v":1}"#);
        // genesis hash farklı (farklı session_id mock'u) ama append sonrası delta aynı
        let ha = *a.chain_head();
        let hb = *b.chain_head();
        // session_id farklı olduğunda genesis hash farklı → chain_head farklı, bu beklenen.
        // Aynı session_id ile test:
        let id = DeviceIdentity::generate();
        let p1 = std::env::temp_dir().join("caelus_audit_same1.log");
        let p2 = std::env::temp_dir().join("caelus_audit_same2.log");
        let mut c = CaelusAuditLog::open(p1.to_str().unwrap(), Arc::new(id.clone()), 42).unwrap();
        let mut d = CaelusAuditLog::open(p2.to_str().unwrap(), Arc::new(id.clone()), 42).unwrap();
        c.append(r#"{"x":1}"#);
        d.append(r#"{"x":1}"#);
        assert_eq!(
            c.chain_head(),
            d.chain_head(),
            "aynı event = aynı chain_head"
        );
        let _ = (ha, hb); // suppress warnings
    }

    #[test]
    fn different_events_give_different_hashes() {
        let id = DeviceIdentity::generate();
        let p1 = std::env::temp_dir().join("caelus_audit_diff1.log");
        let p2 = std::env::temp_dir().join("caelus_audit_diff2.log");
        let mut a = CaelusAuditLog::open(p1.to_str().unwrap(), Arc::new(id.clone()), 42).unwrap();
        let mut b = CaelusAuditLog::open(p2.to_str().unwrap(), Arc::new(id.clone()), 42).unwrap();
        a.append(r#"{"x":1}"#);
        b.append(r#"{"x":2}"#);
        assert_ne!(a.chain_head(), b.chain_head(), "farklı event = farklı hash");
    }

    #[test]
    fn seal_writes_and_marks_sealed() {
        let mut log = make_log("seal");
        log.append(r#"{"type":"test"}"#);
        assert!(!log.is_sealed());
        assert!(log.seal(), "seal başarılı olmalı");
        assert!(log.is_sealed());
        assert!(!log.seal(), "çift seal false dönmeli");
    }

    #[test]
    fn append_after_seal_is_rejected() {
        let mut log = make_log("after_seal");
        log.seal();
        assert!(
            !log.append(r#"{"x":1}"#),
            "seal sonrası append reddedilmeli"
        );
    }

    #[test]
    fn rotation_seals_segment_and_links_next_genesis() {
        let id = DeviceIdentity::generate();
        let base_path = unique_audit_path("caelus_audit_rotate");
        remove_segments(&base_path, 4);

        let config = AuditLogConfig {
            max_bytes: 700,
            flush_every: 1,
        };
        let mut log =
            CaelusAuditLog::open_with_config(&base_path, Arc::new(id), 0xCAE1_700Au64, config)
                .expect("log open");

        for i in 0..8 {
            let event = format!(
                r#"{{"type":"rotate","idx":{},"payload":"{}"}}"#,
                i,
                "x".repeat(80)
            );
            assert!(log.append(&event), "append {} başarılı olmalı", i);
        }

        assert!(log.segment_index > 0, "küçük limit rotasyon üretmeli");
        let first_segment = fs::read_to_string(&base_path).expect("first segment");
        let first_seal = first_segment
            .lines()
            .find(|line| line.contains(r#""type":"SEAL""#))
            .expect("first segment sealed");
        let first_chain_head =
            extract_hex_field(first_seal, "chain_head").expect("seal chain_head");

        let second_path = audit_segment_path(&base_path, 1);
        let second_segment = fs::read_to_string(&second_path).expect("second segment");
        let second_genesis = second_segment
            .lines()
            .find(|line| line.contains(r#""type":"GENESIS""#))
            .expect("second segment genesis");

        assert!(
            second_genesis.contains(&format!(
                r#""prev_segment_chain_head":"{}""#,
                first_chain_head
            )),
            "yeni segment genesis'i önceki segment chain_head değerini taşımalı"
        );

        let _ = log.seal();
        remove_segments(&base_path, 4);
    }

    #[test]
    fn ffi_roundtrip() {
        let id_h = crate::network::mesh_auth::caelus_identity_new();
        assert!(!id_h.is_null());
        let path = std::env::temp_dir().join("caelus_ffi_audit.log");
        let path_s = path.to_str().unwrap();
        let ctx = caelus_audit_new(id_h, 0xCAE1_FF1u64, path_s.as_ptr(), path_s.len());
        assert!(!ctx.is_null());
        let ev = r#"{"type":"ffi_test"}"#;
        assert_eq!(caelus_audit_append(ctx, ev.as_ptr(), ev.len()), 1);
        let mut head = [0u8; 32];
        assert_eq!(caelus_audit_chain_head(ctx, head.as_mut_ptr()), 1);
        assert_ne!(head, [0u8; 32]);
        assert_eq!(caelus_audit_seal(ctx), 1);
        caelus_audit_free(ctx);
        crate::network::mesh_auth::caelus_identity_free(id_h);
    }
}
