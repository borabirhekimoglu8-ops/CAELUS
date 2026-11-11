// CAELUS OS — Tarayıcı-içi nedensel motor (WebAssembly, C-ABI)
//
// caelus_core (no_std, C++ ile bit-bit eşdeğer nedensel çekirdek) tarayıcının
// içinde koşar. Böylece War Room UI'ı BİLGİSAYARDAN BAĞIMSIZ çalışır: motor
// telefonun tarayıcısında, sunucu/ağ olmadan gerçek simülasyonu yürütür.
//
// JS köprüsü (wasm-bindgen'siz, sade C-ABI + paylaşımlı bellek):
//   ptr = cae_buf(); cap = cae_buf_cap();
//   // senaryo JSON'unu BUF'a yaz → cae_load(len)
//   cae_tick(n); cae_lever(len); n = cae_snapshot(); m = cae_levers();
//   // sonuç JSON'u BUF[0..n] içinde
//
// Snapshot/levers JSON biçimi core_engine.cpp'nin WS olaylarıyla BİREBİRDİR;
// UI aynı applySnapshotEvent / 'levers' yolundan tüketir (kod tekrarı yok).

use caelus_core::{
    fp_to_d, CausalEngine, Edge, FeedbackLoop, Hysteresis, IntelBinding, IntelBindingMode, Lever,
    LeverOutcome, Node, NodeKind, FP_ONE,
};
use core::cell::UnsafeCell;

// wasm32 tek iş parçacıklıdır. UnsafeCell, global runtime durumunun interior
// mutability sözleşmesini açık kılar ve `static mut` referanslarının doğuracağı
// örtük aliasing/UB riskini önler. Export edilen çağrılar senkrondur ve hiçbir
// host callback'i çağırmadığından yeniden giriş mümkün değildir.
struct WasmGlobal<T>(UnsafeCell<T>);
unsafe impl<T> Sync for WasmGlobal<T> {}
impl<T> WasmGlobal<T> {
    const fn new(value: T) -> Self {
        Self(UnsafeCell::new(value))
    }
    fn get(&self) -> *mut T {
        self.0.get()
    }
}

static ENGINE: WasmGlobal<Option<CausalEngine>> = WasmGlobal::new(None);
static SCENARIO_ID: WasmGlobal<String> = WasmGlobal::new(String::new());
static LEVERS: WasmGlobal<Vec<PackLever>> = WasmGlobal::new(Vec::new());
static REPLAY: WasmGlobal<ReplaySchedule> = WasmGlobal::new(ReplaySchedule::empty());

const BUF_CAP: usize = 512 * 1024;
static BUF: WasmGlobal<[u8; BUF_CAP]> = WasmGlobal::new([0u8; BUF_CAP]);

const ARENA_CAP: usize = 1024 * 1024;
static ARENA_BUF: WasmGlobal<[u8; ARENA_CAP]> = WasmGlobal::new([0u8; ARENA_CAP]);
static ARENA_OFFSET: WasmGlobal<usize> = WasmGlobal::new(0);
static RESULT_BUF: WasmGlobal<Vec<u8>> = WasmGlobal::new(Vec::new());

#[no_mangle]
pub extern "C" fn cae_buf() -> *mut u8 {
    unsafe { (*BUF.get()).as_mut_ptr() }
}
#[no_mangle]
pub extern "C" fn cae_buf_cap() -> usize {
    BUF_CAP
}

#[no_mangle]
pub extern "C" fn wasm_reset_heap() {
    unsafe {
        *ARENA_OFFSET.get() = 0;
        (*RESULT_BUF.get()).clear();
    }
}

#[no_mangle]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return unsafe { (*ARENA_BUF.get()).as_mut_ptr() };
    }
    let aligned_len = (len + 7) & !7;
    unsafe {
        let cur = *ARENA_OFFSET.get();
        let next = match cur.checked_add(aligned_len) {
            Some(v) if v <= ARENA_CAP => v,
            _ => return core::ptr::null_mut(),
        };
        let ptr = (*ARENA_BUF.get()).as_mut_ptr().add(cur);
        *ARENA_OFFSET.get() = next;
        ptr
    }
}

#[no_mangle]
pub extern "C" fn wasm_result_ptr() -> *const u8 {
    unsafe { (*RESULT_BUF.get()).as_ptr() }
}

#[no_mangle]
pub extern "C" fn wasm_result_len() -> usize {
    unsafe { (*RESULT_BUF.get()).len() }
}

fn load_scenario_from_str(src: &str) -> i32 {
    let root = match Parser::new(src).parse() {
        Ok(j) => j,
        Err(_) => return -1,
    };
    let mut eng = CausalEngine::new();
    let levers = apply_pack(&root, &mut eng);
    let replay = ReplaySchedule::from_root(&root);
    let sid = {
        let top = root.get("id").as_s();
        if !top.is_empty() {
            top.to_string()
        } else {
            root.get("meta").get("id").as_s().to_string()
        }
    };
    unsafe {
        *SCENARIO_ID.get() = sid;
        *LEVERS.get() = levers;
        *REPLAY.get() = replay;
        *ENGINE.get() = Some(eng);
    }
    0
}

#[no_mangle]
pub extern "C" fn wasm_load_scenario_json(ptr: *const u8, len: usize) -> i32 {
    if ptr.is_null() || len == 0 || len > ARENA_CAP {
        return -1;
    }
    let bytes = unsafe { core::slice::from_raw_parts(ptr, len) };
    let src = match core::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return -2,
    };
    let rc = load_scenario_from_str(src);
    if rc == 0 {
        // core_engine.cpp REPL load_json (tick 0 -> 1 başlangıç adımı) ile birebir hizalama
        unsafe {
            if let Some(eng) = (&mut *ENGINE.get()).as_mut() {
                let now_tick = eng.current_tick();
                (&*REPLAY.get()).dispatch_exact(eng, now_tick);
                eng.tick();
            }
        }
    }
    rc
}

#[no_mangle]
pub extern "C" fn wasm_compare_lever(
    lever_ptr: *const u8,
    lever_len: usize,
    horizon_ticks: u32,
    custom_seed: u64,
) -> i32 {
    if lever_ptr.is_null() || lever_len == 0 || lever_len > 4096 {
        return -1;
    }
    let lever_bytes = unsafe { core::slice::from_raw_parts(lever_ptr, lever_len) };
    let lever_id = match core::str::from_utf8(lever_bytes) {
        Ok(s) => s.trim(),
        Err(_) => return -2,
    };
    if lever_id.is_empty() {
        return -1;
    }

    let (mut branch_a, mut branch_b, scenario_id, replay_events) = unsafe {
        let eng = match (&*ENGINE.get()).as_ref() {
            Some(e) => e,
            None => return -3,
        };
        if !(&*LEVERS.get()).iter().any(|l| l.id == lever_id) {
            return -4;
        }
        (
            eng.clone(),
            eng.clone(),
            (*SCENARIO_ID.get()).clone(),
            (&*REPLAY.get()).clone(),
        )
    };

    let ticks = horizon_ticks.clamp(1, 2000);
    let tick_start = branch_a.current_tick();
    let effective_seed = if custom_seed != 0 {
        custom_seed
    } else if branch_a.prng_seed() != 0 {
        branch_a.prng_seed().wrapping_add(tick_start)
    } else if tick_start != 0 {
        tick_start
    } else {
        1
    };

    let lever_applied_ok = branch_b.apply_lever(lever_id, effective_seed);
    let mut snap_a = branch_a.build_snapshot();
    let mut snap_b = branch_b.build_snapshot();
    let mut sum_tp_a_fp: i128 = 0;
    let mut sum_tp_b_fp: i128 = 0;
    let mut outage_ticks_a: u32 = 0;
    let mut outage_ticks_b: u32 = 0;

    for _ in 0..ticks {
        let ta = branch_a.current_tick();
        let tb = branch_b.current_tick();
        replay_events.dispatch_exact(&mut branch_a, ta);
        replay_events.dispatch_exact(&mut branch_b, tb);
        snap_a = branch_a.tick();
        snap_b = branch_b.tick();
        sum_tp_a_fp += snap_a.throughput_ratio_fp as i128;
        sum_tp_b_fp += snap_b.throughput_ratio_fp as i128;
        if snap_a.outage_active {
            outage_ticks_a += 1;
        }
        if snap_b.outage_active {
            outage_ticks_b += 1;
        }
    }

    let avg_tp_a_fp = (sum_tp_a_fp / (ticks as i128)) as i64;
    let avg_tp_b_fp = (sum_tp_b_fp / (ticks as i128)) as i64;
    let delta_tp_fp = avg_tp_b_fp.saturating_sub(avg_tp_a_fp);

    let mut o = String::with_capacity(1024);
    o.push_str("{\"type\":\"counterfactual_result\",\"scenario_id\":\"");
    o.push_str(&json_escape(&scenario_id));
    o.push_str("\",\"lever_id\":\"");
    o.push_str(&json_escape(lever_id));
    o.push_str("\",\"lever_success\":");
    o.push_str(if lever_applied_ok { "true" } else { "false" });
    o.push_str(",\"seed\":");
    push_u64(&mut o, effective_seed);
    o.push_str(",\"tick_start\":");
    push_u64(&mut o, tick_start);
    o.push_str(",\"horizon_ticks\":");
    push_u64(&mut o, ticks as u64);
    o.push_str(",\"baseline_end_friction\":");
    push_fp6(&mut o, snap_a.clamped_friction_fp);
    o.push_str(",\"intervention_end_friction\":");
    push_fp6(&mut o, snap_b.clamped_friction_fp);
    o.push_str(",\"baseline_end_throughput\":");
    push_fp6(&mut o, snap_a.throughput_ratio_fp);
    o.push_str(",\"intervention_end_throughput\":");
    push_fp6(&mut o, snap_b.throughput_ratio_fp);
    o.push_str(",\"baseline_avg_throughput\":");
    push_fp6(&mut o, avg_tp_a_fp);
    o.push_str(",\"intervention_avg_throughput\":");
    push_fp6(&mut o, avg_tp_b_fp);
    o.push_str(",\"delta_avg_throughput\":");
    push_fp6(&mut o, delta_tp_fp);
    o.push_str(",\"baseline_outage_ticks\":");
    push_u64(&mut o, outage_ticks_a as u64);
    o.push_str(",\"intervention_outage_ticks\":");
    push_u64(&mut o, outage_ticks_b as u64);
    o.push_str(",\"baseline_end_outage\":");
    o.push_str(if snap_a.outage_active { "true" } else { "false" });
    o.push_str(",\"intervention_end_outage\":");
    o.push_str(if snap_b.outage_active { "true" } else { "false" });
    o.push_str(",\"branch_a\":{\"tick\":");
    push_u64(&mut o, branch_a.current_tick());
    o.push_str(",\"throughput_ratio\":");
    push_fp6(&mut o, snap_a.throughput_ratio_fp);
    o.push_str(",\"clamped_friction\":");
    push_fp6(&mut o, snap_a.clamped_friction_fp);
    o.push_str(",\"outage_active\":");
    o.push_str(if snap_a.outage_active { "true" } else { "false" });
    o.push_str(",\"deadline_missed\":");
    o.push_str(if snap_a.any_deadline_missed { "true" } else { "false" });
    o.push_str(",\"any_hysteresis_flip\":");
    o.push_str(if snap_a.any_hysteresis_flip { "true" } else { "false" });
    o.push_str("},\"branch_b\":{\"tick\":");
    push_u64(&mut o, branch_b.current_tick());
    o.push_str(",\"throughput_ratio\":");
    push_fp6(&mut o, snap_b.throughput_ratio_fp);
    o.push_str(",\"clamped_friction\":");
    push_fp6(&mut o, snap_b.clamped_friction_fp);
    o.push_str(",\"outage_active\":");
    o.push_str(if snap_b.outage_active { "true" } else { "false" });
    o.push_str(",\"deadline_missed\":");
    o.push_str(if snap_b.any_deadline_missed { "true" } else { "false" });
    o.push_str(",\"any_hysteresis_flip\":");
    o.push_str(if snap_b.any_hysteresis_flip { "true" } else { "false" });
    o.push_str("}}");

    unsafe {
        let rb = &mut *RESULT_BUF.get();
        rb.clear();
        rb.extend_from_slice(o.as_bytes());
    }
    0
}

fn buf_str(len: usize) -> String {
    let n = len.min(BUF_CAP);
    // SAFETY: JS yalnız geçerli UTF-8 (JSON/id) yazar; hatalıysa kayıpsız kurtar.
    let buffer: &[u8; BUF_CAP] = unsafe { &*BUF.get() };
    let bytes = &buffer[..n];
    String::from_utf8_lossy(bytes).into_owned()
}

fn write_buf(s: &str) -> usize {
    let b = s.as_bytes();
    let n = b.len().min(BUF_CAP);
    let buffer: &mut [u8; BUF_CAP] = unsafe { &mut *BUF.get() };
    buffer[..n].copy_from_slice(&b[..n]);
    n
}

/// Senaryo paketi JSON'unu BUF[0..len]'den yükle. 0=ok, <0=hata.
#[no_mangle]
pub extern "C" fn cae_load(len: usize) -> i32 {
    let src = buf_str(len);
    load_scenario_from_str(&src)
}

/// n tick ilerlet.
#[no_mangle]
pub extern "C" fn cae_tick(n: u32) {
    unsafe {
        if let Some(e) = (&mut *ENGINE.get()).as_mut() {
            for _ in 0..n {
                e.tick();
            }
        }
    }
}

/// BUF[0..len] = lever id; uygula. 1=başarılı, 0=başarısız/kilitli/yok.
#[no_mangle]
pub extern "C" fn cae_lever(len: usize) -> i32 {
    let id = buf_str(len);
    unsafe {
        if let Some(e) = (&mut *ENGINE.get()).as_mut() {
            let seed = e.current_tick().wrapping_mul(0x9E3779B97F4A7C15);
            return if e.apply_lever(&id, seed) { 1 } else { 0 };
        }
    }
    0
}

/// Gerçek graf snapshot'ı (nodes/edges) → BUF; uzunluk döner.
/// Biçim core_engine.cpp emit_ws_snapshot ile birebir.
#[no_mangle]
pub extern "C" fn cae_snapshot() -> usize {
    let s = unsafe {
        match (&*ENGINE.get()).as_ref() {
            Some(e) => build_snapshot_json(e, &*SCENARIO_ID.get()),
            None => String::from("{\"type\":\"snapshot\",\"nodes\":[],\"edges\":[]}"),
        }
    };
    write_buf(&s)
}

/// Gerçek kaldıraç listesi → BUF; uzunluk döner. Biçim 'levers' WS olayıyla aynı.
#[no_mangle]
pub extern "C" fn cae_levers() -> usize {
    let s = unsafe { build_levers_json(&*SCENARIO_ID.get(), &*LEVERS.get()) };
    write_buf(&s)
}

fn node_kind_label(k: NodeKind) -> &'static str {
    match k {
        NodeKind::Service => "Service",
        NodeKind::Buffer => "Buffer",
        NodeKind::Queue => "Queue",
        NodeKind::Perishable => "Perishable",
        NodeKind::Gate => "Gate",
        NodeKind::Adversary => "Adversary",
    }
}

fn build_snapshot_json(e: &CausalEngine, scenario_id: &str) -> String {
    let mut o = String::with_capacity(2048);
    o.push_str("{\"type\":\"snapshot\",\"scenario_id\":\"");
    o.push_str(&json_escape(scenario_id));
    o.push_str("\",\"tick\":");
    push_u64(&mut o, e.current_tick());
    o.push_str(",\"clamped_friction\":");
    push_f6(&mut o, e.friction_multiplier());
    o.push_str(",\"regime_exceeded\":");
    o.push_str(if e.is_regime_exceeded() { "true" } else { "false" });
    o.push_str(",\"outage_active\":");
    o.push_str(if e.is_outage_active() { "true" } else { "false" });
    // Gösterge/sinyaller için ek alanlar (UI engine_state'i bundan türetir).
    let snap = e.build_snapshot();
    o.push_str(",\"throughput_ratio\":");
    push_f6(&mut o, snap.throughput_ratio);
    o.push_str(",\"intel_events_total\":");
    push_u64(&mut o, e.intel_events_total());
    o.push_str(",\"intel_events_unbound\":");
    push_u64(&mut o, e.intel_events_unbound());
    o.push_str(",\"any_hysteresis_flip\":");
    o.push_str(if snap.any_hysteresis_flip { "true" } else { "false" });
    o.push_str(",\"any_deadline_missed\":");
    o.push_str(if snap.any_deadline_missed { "true" } else { "false" });
    o.push_str(",\"nodes\":[");
    let mut first = true;
    for n in e.nodes() {
        if !first {
            o.push(',');
        }
        first = false;
        o.push_str("{\"id\":\"");
        o.push_str(&json_escape(&n.id));
        o.push_str("\",\"type\":\"");
        o.push_str(node_kind_label(n.kind));
        o.push_str("\",\"state\":");
        push_f6(&mut o, fp_to_d(n.state_fp));
        o.push_str(",\"reported\":");
        push_f6(&mut o, fp_to_d(n.reported_state_fp));
        o.push_str(",\"trust\":");
        push_f6(&mut o, fp_to_d(n.trust_fp));
        o.push_str(",\"friction\":");
        push_f6(&mut o, fp_to_d(n.weight_fp));
        o.push_str(",\"capacity\":");
        push_f6(&mut o, fp_to_d(n.capacity_fp));
        o.push_str(",\"irrecoverable\":");
        o.push_str(if n.irrecoverable { "true}" } else { "false}" });
    }
    o.push_str("],\"edges\":[");
    first = true;
    for ed in e.edges() {
        if ed.to.is_empty() {
            continue;
        }
        if !first {
            o.push(',');
        }
        first = false;
        o.push_str("{\"from\":\"");
        o.push_str(&json_escape(&ed.from));
        o.push_str("\",\"to\":\"");
        o.push_str(&json_escape(&ed.to));
        o.push_str("\",\"weight\":");
        push_f6(&mut o, fp_to_d(ed.multiplier_fp));
        o.push_str(",\"lag_ticks\":");
        push_i64(&mut o, ed.lag_ticks as i64);
        o.push('}');
    }
    o.push_str("]}");
    o
}

fn build_levers_json(scenario_id: &str, levers: &[PackLever]) -> String {
    let mut o = String::with_capacity(512);
    o.push_str("{\"type\":\"levers\",\"scenario_id\":\"");
    o.push_str(&json_escape(scenario_id));
    o.push_str("\",\"levers\":[");
    let mut first = true;
    for l in levers {
        if !first {
            o.push(',');
        }
        first = false;
        o.push_str("{\"id\":\"");
        o.push_str(&json_escape(&l.id));
        o.push_str("\",\"target\":\"");
        o.push_str(&json_escape(&l.target));
        o.push_str("\",\"success_p\":");
        push_f6(&mut o, fp_to_d(l.success_p_fp));
        o.push_str(",\"cost_ticks\":");
        push_i64(&mut o, l.cost_ticks as i64);
        o.push_str(",\"lockout_ticks\":");
        push_i64(&mut o, l.lockout_ticks as i64);
        o.push('}');
    }
    o.push_str("]}");
    o
}

// ── küçük sayı → string yardımcıları (format! bağımlılığını azaltır) ──────────
fn push_u64(o: &mut String, mut v: u64) {
    if v == 0 {
        o.push('0');
        return;
    }
    let mut tmp = [0u8; 20];
    let mut i = tmp.len();
    while v > 0 {
        i -= 1;
        tmp[i] = b'0' + (v % 10) as u8;
        v /= 10;
    }
    o.push_str(core::str::from_utf8(&tmp[i..]).unwrap());
}
fn push_i64(o: &mut String, v: i64) {
    if v < 0 {
        o.push('-');
        push_u64(o, (v as i128).unsigned_abs() as u64);
    } else {
        push_u64(o, v as u64);
    }
}
fn push_fp6(o: &mut String, fp: i64) {
    let abs = (fp as i128).unsigned_abs() as u64;
    if fp < 0 && abs != 0 {
        o.push('-');
    }
    let ip = abs / 1_000_000;
    let mut frac = abs % 1_000_000;
    push_u64(o, ip);
    o.push('.');
    let mut d = [0u8; 6];
    for k in (0..6).rev() {
        d[k] = b'0' + (frac % 10) as u8;
        frac /= 10;
    }
    o.push_str(core::str::from_utf8(&d).unwrap());
}
fn push_f6(o: &mut String, v: f64) {
    // 6 ondalık, C++ std::fixed<<setprecision(6) ile aynı gösterim.
    let neg = v < 0.0;
    let mut x = if neg { -v } else { v };
    // yuvarlama
    x += 0.0000005;
    let ip = x as u64;
    let frac = ((x - ip as f64) * 1_000_000.0) as u64;
    if neg && (ip != 0 || frac != 0) {
        o.push('-');
    }
    push_u64(o, ip);
    o.push('.');
    // 6 haneli sıfır dolgulu kesir
    let mut d = [0u8; 6];
    let mut f = frac;
    for k in (0..6).rev() {
        d[k] = b'0' + (f % 10) as u8;
        f /= 10;
    }
    o.push_str(core::str::from_utf8(&d).unwrap());
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out
}

// ══════════════════════════════════════════════════════════════════════════════
//  JSON parser + apply_pack — caelus_core_repl.rs'ten SADIK kopya (doğrulanmış
//  yükleme yolunu riske atmadan; std::io yerine String biçimlendirme kullanır).
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
enum Json {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}
static JSON_NULL: Json = Json::Null;
impl Json {
    fn find(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(o) => o.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    fn get(&self, key: &str) -> &Json {
        self.find(key).unwrap_or(&JSON_NULL)
    }
    fn has(&self, key: &str) -> bool {
        self.find(key).is_some()
    }
    fn as_i(&self, def: i64) -> i64 {
        match self {
            Json::Int(i) => *i,
            Json::Float(f) => *f as i64,
            Json::Bool(b) => {
                if *b {
                    1
                } else {
                    0
                }
            }
            _ => def,
        }
    }
    fn as_b(&self, def: bool) -> bool {
        match self {
            Json::Bool(b) => *b,
            Json::Int(i) => *i != 0,
            _ => def,
        }
    }
    fn as_s(&self) -> &str {
        match self {
            Json::Str(s) => s,
            _ => "",
        }
    }
    fn arr(&self) -> &[Json] {
        match self {
            Json::Arr(a) => a,
            _ => &[],
        }
    }
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
}
impl<'a> Parser<'a> {
    fn new(s: &'a str) -> Self {
        Parser { b: s.as_bytes(), i: 0 }
    }
    fn parse(&mut self) -> Result<Json, String> {
        let v = self.value(0)?;
        self.ws();
        Ok(v)
    }
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\t' | b'\r' | b'\n') {
            self.i += 1;
        }
    }
    fn value(&mut self, depth: u32) -> Result<Json, String> {
        if depth > 64 {
            return Err("derinlik limiti".into());
        }
        self.ws();
        match self.b.get(self.i) {
            Some(b'{') => self.object(depth),
            Some(b'[') => self.array(depth),
            Some(b'"') => Ok(Json::Str(self.string()?)),
            Some(b't') => self.lit("true", Json::Bool(true)),
            Some(b'f') => self.lit("false", Json::Bool(false)),
            Some(b'n') => self.lit("null", Json::Null),
            Some(_) => self.number(),
            None => Err("beklenmedik son".into()),
        }
    }
    fn lit(&mut self, s: &str, v: Json) -> Result<Json, String> {
        if self.b[self.i..].starts_with(s.as_bytes()) {
            self.i += s.len();
            Ok(v)
        } else {
            Err("literal".into())
        }
    }
    fn object(&mut self, depth: u32) -> Result<Json, String> {
        self.i += 1;
        let mut o = Vec::new();
        self.ws();
        if self.b.get(self.i) == Some(&b'}') {
            self.i += 1;
            return Ok(Json::Obj(o));
        }
        loop {
            self.ws();
            let k = self.string()?;
            self.ws();
            if self.b.get(self.i) != Some(&b':') {
                return Err("':'".into());
            }
            self.i += 1;
            let v = self.value(depth + 1)?;
            o.push((k, v));
            self.ws();
            match self.b.get(self.i) {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Json::Obj(o));
                }
                _ => return Err("',' | '}'".into()),
            }
        }
    }
    fn array(&mut self, depth: u32) -> Result<Json, String> {
        self.i += 1;
        let mut a = Vec::new();
        self.ws();
        if self.b.get(self.i) == Some(&b']') {
            self.i += 1;
            return Ok(Json::Arr(a));
        }
        loop {
            let v = self.value(depth + 1)?;
            a.push(v);
            self.ws();
            match self.b.get(self.i) {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    return Ok(Json::Arr(a));
                }
                _ => return Err("',' | ']'".into()),
            }
        }
    }
    fn string(&mut self) -> Result<String, String> {
        if self.b.get(self.i) != Some(&b'"') {
            return Err("'\"'".into());
        }
        self.i += 1;
        let mut out = String::new();
        while let Some(&c) = self.b.get(self.i) {
            match c {
                b'"' => {
                    self.i += 1;
                    return Ok(out);
                }
                b'\\' => {
                    self.i += 1;
                    match self.b.get(self.i) {
                        Some(b'"') => out.push('"'),
                        Some(b'\\') => out.push('\\'),
                        Some(b'/') => out.push('/'),
                        Some(b'b') => out.push('\u{8}'),
                        Some(b'f') => out.push('\u{c}'),
                        Some(b'n') => out.push('\n'),
                        Some(b'r') => out.push('\r'),
                        Some(b't') => out.push('\t'),
                        Some(b'u') => {
                            let hex = self.b.get(self.i + 1..self.i + 5).ok_or("\\u")?;
                            let cp = u32::from_str_radix(
                                core::str::from_utf8(hex).map_err(|_| "\\u utf8")?,
                                16,
                            )
                            .map_err(|_| "\\u hex")?;
                            out.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                            self.i += 4;
                        }
                        _ => return Err("escape".into()),
                    }
                    self.i += 1;
                }
                _ => {
                    let start = self.i;
                    let len = utf8_len(c);
                    let chunk = self.b.get(start..start + len).ok_or("utf8")?;
                    out.push_str(core::str::from_utf8(chunk).map_err(|_| "utf8")?);
                    self.i += len;
                }
            }
        }
        Err("kapanmamış".into())
    }
    fn number(&mut self) -> Result<Json, String> {
        let start = self.i;
        if self.b.get(self.i) == Some(&b'-') {
            self.i += 1;
        }
        let mut is_float = false;
        while let Some(&c) = self.b.get(self.i) {
            match c {
                b'0'..=b'9' => self.i += 1,
                b'.' | b'e' | b'E' | b'+' | b'-' => {
                    if matches!(c, b'.' | b'e' | b'E') {
                        is_float = true;
                    }
                    self.i += 1;
                }
                _ => break,
            }
        }
        let s = core::str::from_utf8(&self.b[start..self.i]).map_err(|_| "sayı")?;
        if s.is_empty() || s == "-" {
            return Err("sayı".into());
        }
        if is_float {
            s.parse::<f64>().map(Json::Float).map_err(|_| "float".into())
        } else {
            match s.parse::<i64>() {
                Ok(i) => Ok(Json::Int(i)),
                Err(_) => s.parse::<f64>().map(Json::Float).map_err(|_| "num".into()),
            }
        }
    }
}
fn utf8_len(first: u8) -> usize {
    match first {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        _ => 4,
    }
}

struct PackLever {
    id: String,
    target: String,
    success_p_fp: i64,
    cost_ticks: i32,
    lockout_ticks: i32,
}

#[derive(Clone)]
struct ReplayIntelEvent {
    tick: u64,
    friction_coeff: f64,
    crisis_level: i32,
    memo: String,
}

#[derive(Clone)]
struct ReplaySchedule {
    events: Vec<ReplayIntelEvent>,
}

impl ReplaySchedule {
    const fn empty() -> Self {
        Self { events: Vec::new() }
    }

    fn from_root(root: &Json) -> Self {
        let tick_minutes = root.get("meta").get("tick_minutes").as_i(15);
        let safe_min = if tick_minutes > 0 { tick_minutes } else { 15 };
        let tph = (60 / safe_min).max(1) as u64;
        let mut events = Vec::new();
        for ev in root
            .get("v1_engine_bridge")
            .get("intel_feed_sequence")
            .arr()
        {
            let t_hour = ev.get("t_hour").as_i(0).max(0) as u64;
            let fc = match ev.find("friction_coefficient") {
                Some(Json::Float(f)) => *f,
                Some(Json::Int(i)) => *i as f64,
                _ => 0.0,
            };
            events.push(ReplayIntelEvent {
                tick: t_hour.saturating_mul(tph),
                friction_coeff: fc,
                crisis_level: ev.get("crisis_level").as_i(0) as i32,
                memo: ev.get("memo").as_s().to_string(),
            });
        }
        events.sort_by_key(|e| e.tick);
        Self { events }
    }

    fn dispatch_exact(&self, eng: &mut CausalEngine, now_tick: u64) {
        for ev in &self.events {
            if ev.tick == now_tick {
                eng.inject_intel(ev.friction_coeff, ev.crisis_level, &ev.memo);
            }
        }
    }
}

fn parse_outcome(v: &Json) -> LeverOutcome {
    LeverOutcome {
        target_node_id: v.get("target_node_id").as_s().to_string(),
        state_delta_fp: v.get("state_delta_fp").as_i(0),
        trust_delta_fp: v.get("trust_delta_fp").as_i(0),
        friction_delta_fp: v.get("friction_delta_fp").as_i(0),
        clear_irrecoverable: v.get("clear_irrecoverable").as_b(false),
    }
}

fn apply_pack(root: &Json, eng: &mut CausalEngine) -> Vec<PackLever> {
    let cm = root.get("extended_causal_model");
    let mut pack_levers = Vec::new();
    eng.reset();

    let mut parsed_nodes: Vec<Node> = Vec::new();
    for nv in cm.get("nodes").arr() {
        let state_fp = nv.get("state_fp").as_i(0);
        parsed_nodes.push(Node {
            id: nv.get("id").as_s().to_string(),
            kind: NodeKind::from_str(nv.get("kind").as_s()),
            capacity_fp: nv.get("capacity_fp").as_i(FP_ONE),
            state_fp,
            weight_fp: nv.get("weight_fp").as_i(0),
            reported_state_fp: if nv.has("reported_state_fp") {
                nv.get("reported_state_fp").as_i(state_fp)
            } else {
                state_fp
            },
            trust_fp: if nv.has("trust_fp") {
                nv.get("trust_fp").as_i(FP_ONE)
            } else {
                FP_ONE
            },
            deadline_tick: nv.get("deadline_tick").as_i(-1) as i32,
            deadline_min_state_fp: nv.get("deadline_min_state_fp").as_i(0),
            deadline_missed: false,
            irrecoverable: nv.get("irrecoverable").as_b(false),
        });
    }
    for dv in cm.get("hard_deadlines").arr() {
        let nid = dv.get("node_id").as_s();
        let at = dv.get("at_tick").as_i(-1) as i32;
        if let Some(node) = parsed_nodes.iter_mut().find(|n| n.id == nid) {
            node.deadline_tick = at;
            if dv.has("min_state_fp") {
                node.deadline_min_state_fp = dv.get("min_state_fp").as_i(node.deadline_min_state_fp);
            }
        }
    }
    let node_ids: Vec<String> = parsed_nodes.iter().map(|n| n.id.clone()).collect();
    for n in parsed_nodes {
        eng.add_node(n);
    }
    for ev in cm.get("edges").arr() {
        eng.add_edge(Edge {
            from: ev.get("from").as_s().to_string(),
            to: ev.get("to").as_s().to_string(),
            multiplier_fp: ev.get("multiplier_fp").as_i(FP_ONE),
            lag_ticks: ev.get("lag_ticks").as_i(0) as i32,
            active: if ev.has("active") {
                ev.get("active").as_b(true)
            } else {
                true
            },
        });
    }
    for lv in cm.get("feedback_loops").arr() {
        eng.add_loop(FeedbackLoop {
            id: lv.get("id").as_s().to_string(),
            path: lv.get("path").arr().iter().map(|p| p.as_s().to_string()).collect(),
            gain_fp: lv.get("gain_fp").as_i(FP_ONE),
        });
    }
    for lv in cm.get("levers").arr() {
        let lever = Lever {
            id: lv.get("id").as_s().to_string(),
            target: lv.get("target").as_s().to_string(),
            success_p_fp: lv.get("success_p_fp").as_i(500_000),
            cost_ticks: lv.get("cost_ticks").as_i(1) as i32,
            lockout_ticks: lv.get("lockout_ticks").as_i(0) as i32,
            on_success: if lv.has("on_success") {
                parse_outcome(lv.get("on_success"))
            } else {
                LeverOutcome::default()
            },
            on_failure: if lv.has("on_failure") {
                parse_outcome(lv.get("on_failure"))
            } else {
                LeverOutcome::default()
            },
            remaining_lockout: 0,
            available: true,
        };
        pack_levers.push(PackLever {
            id: lever.id.clone(),
            target: lever.target.clone(),
            success_p_fp: lever.success_p_fp,
            cost_ticks: lever.cost_ticks,
            lockout_ticks: lever.lockout_ticks,
        });
        eng.add_lever(lever);
    }
    for hv in cm.get("hysteresis").arr() {
        eng.add_hysteresis(Hysteresis {
            id: hv.get("id").as_s().to_string(),
            threshold_tick: hv.get("threshold_tick").as_i(0) as i32,
            reversible: hv.get("reversible").as_b(true),
            permanent_loss_fp: hv.get("permanent_loss_fp").as_i(0),
            min_friction_fp: hv.get("min_friction_fp").as_i(0),
            condition_node_id: hv.get("condition_node_id").as_s().to_string(),
            min_node_state_fp: hv.get("min_node_state_fp").as_i(0),
            flipped: false,
        });
    }
    for bv in cm.get("intel_bindings").arr() {
        let nid = bv.get("node_id").as_s();
        if !node_ids.iter().any(|existing| existing == nid) {
            continue;
        }
        eng.add_intel_binding(IntelBinding {
            node_id: nid.to_string(),
            mode: if bv.get("mode").as_s() == "add" {
                IntelBindingMode::Add
            } else {
                IntelBindingMode::Max
            },
            scale_fp: bv.get("scale_fp").as_i(FP_ONE),
            crisis_step_fp: bv.get("crisis_step_fp").as_i(0),
            min_crisis_level: bv.get("min_crisis_level").as_i(0) as i32,
        });
    }
    if cm.get("nodes").arr().is_empty() {
        eng.load_universal_blank_slate();
    }
    pack_levers
}
