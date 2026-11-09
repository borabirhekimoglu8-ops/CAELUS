// caelus_core_repl — Diferansiyel golden harness (host, std).
//
// C++ dist/caelus_os.exe REPL'inin DETERMİNİSTİK çekirdek-yüzeyini birebir
// taklit eder; tests/run_bs_exec_golden.py --binary ile sürülür:
//
//   caelus_core_repl --scenario BS-01_SAHTE_UFUK --repl --det-mode
//
// Akış C++ main'ini aynalar (core_engine.cpp):
//   1. seed = 0xCAE105DEADBEEF00 (--det-mode)
//   2. scenarios/<id>.json'dan extended_causal_model'i motora uygula
//   3. 1 baseline tick  →  sentetik intel (0.82, level 2; paket graflarında
//      no-op — paketler evrensel düğüm adı içermez)  →  2 tick  → t=3
//   4. stdin REPL: snapshot --json / tick N / lever <id> / quit
//
// NOT: Bu harness İMZA DOĞRULAMAZ — amaç motor matematiğinin diferansiyel
// karşılaştırmasıdır; imza kapısı C++ motoru + Rust scenario_verify'da yaşar.
// [REPL_JSON] satır formatı print_repl_snapshot_json (core_engine.cpp:462-481)
// ile alan-alan aynıdır; float'lar {:.6} (= std::fixed setprecision(6)).

use std::io::{self, BufRead, Write};

use caelus_core::{
    CausalEngine, Edge, EngineSnapshot, FeedbackLoop, Hysteresis, IntelBinding, IntelBindingMode,
    Lever, LeverOutcome, Node, NodeKind, FP_ONE,
};

// ─────────────────────────────────────────────────────────────────────────────
// Minimal JSON değer tipi — scenario_pack.h JsonVal koersiyonlarını aynalar
// ─────────────────────────────────────────────────────────────────────────────

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
    /// C++ as_i: Int→i, Float→(int64)f (sıfıra kırp), Bool→0/1, diğer→def.
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
    /// C++ as_b: Bool→b, Int→i!=0, diğer→def.
    fn as_b(&self, def: bool) -> bool {
        match self {
            Json::Bool(b) => *b,
            Json::Int(i) => *i != 0,
            _ => def,
        }
    }
    /// C++ as_s: Str→s, diğer→"".
    fn as_s(&self) -> &str {
        match self {
            Json::Str(s) => s,
            _ => "",
        }
    }
    fn as_f(&self, def: f64) -> f64 {
        match self {
            Json::Float(f) => *f,
            Json::Int(i) => *i as f64,
            _ => def,
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
        Parser {
            b: s.as_bytes(),
            i: 0,
        }
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
            Err(format!("literal bekleniyordu: {s}"))
        }
    }

    fn object(&mut self, depth: u32) -> Result<Json, String> {
        self.i += 1; // {
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
                return Err("':' bekleniyordu".into());
            }
            self.i += 1;
            let v = self.value(depth + 1)?;
            o.push((k, v));
            self.ws();
            match self.b.get(self.i) {
                Some(b',') => {
                    self.i += 1;
                }
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Json::Obj(o));
                }
                _ => return Err("',' veya '}' bekleniyordu".into()),
            }
        }
    }

    fn array(&mut self, depth: u32) -> Result<Json, String> {
        self.i += 1; // [
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
                Some(b',') => {
                    self.i += 1;
                }
                Some(b']') => {
                    self.i += 1;
                    return Ok(Json::Arr(a));
                }
                _ => return Err("',' veya ']' bekleniyordu".into()),
            }
        }
    }

    fn string(&mut self) -> Result<String, String> {
        if self.b.get(self.i) != Some(&b'"') {
            return Err("'\"' bekleniyordu".into());
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
                            let hex = self.b.get(self.i + 1..self.i + 5).ok_or("\\u kesik")?;
                            let cp = u32::from_str_radix(
                                std::str::from_utf8(hex).map_err(|_| "\\u utf8")?,
                                16,
                            )
                            .map_err(|_| "\\u hex")?;
                            out.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                            self.i += 4;
                        }
                        _ => return Err("geçersiz escape".into()),
                    }
                    self.i += 1;
                }
                _ => {
                    // UTF-8 baytlarını olduğu gibi geçir
                    let start = self.i;
                    let len = utf8_len(c);
                    let chunk = self.b.get(start..start + len).ok_or("utf8 kesik")?;
                    out.push_str(std::str::from_utf8(chunk).map_err(|_| "utf8")?);
                    self.i += len;
                }
            }
        }
        Err("kapanmamış string".into())
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
        let s = std::str::from_utf8(&self.b[start..self.i]).map_err(|_| "sayı utf8")?;
        if s.is_empty() || s == "-" {
            return Err("geçersiz sayı".into());
        }
        if is_float {
            s.parse::<f64>()
                .map(Json::Float)
                .map_err(|_| format!("float ayrıştırılamadı: {s}"))
        } else {
            match s.parse::<i64>() {
                Ok(i) => Ok(Json::Int(i)),
                Err(_) => s
                    .parse::<f64>()
                    .map(Json::Float)
                    .map_err(|_| format!("sayı ayrıştırılamadı: {s}")),
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

// ─────────────────────────────────────────────────────────────────────────────
// Senaryo paketi → motor (scenario_pack.h parse_* fonksiyonlarını aynalar)
// ─────────────────────────────────────────────────────────────────────────────

struct PackLever {
    id: String,
    target: String,
    success_p_fp: i64,
    cost_ticks: i32,
    lockout_ticks: i32,
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

#[derive(Clone)]
struct ReplayIntelEvent {
    tick: u64,
    friction_coeff: f64,
    crisis_level: i32,
    memo: String,
}

struct ReplaySchedule {
    events: Vec<ReplayIntelEvent>,
    cursor: usize,
}

impl ReplaySchedule {
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
            events.push(ReplayIntelEvent {
                tick: t_hour.saturating_mul(tph),
                friction_coeff: ev.get("friction_coefficient").as_f(0.0),
                crisis_level: ev.get("crisis_level").as_i(0) as i32,
                memo: ev.get("memo").as_s().to_string(),
            });
        }
        events.sort_by_key(|e| e.tick);
        ReplaySchedule { events, cursor: 0 }
    }

    fn dispatch_up_to(&mut self, eng: &mut CausalEngine, now_tick: u64) {
        while self.cursor < self.events.len() && self.events[self.cursor].tick <= now_tick {
            let ev = &self.events[self.cursor];
            eng.inject_intel(ev.friction_coeff, ev.crisis_level, &ev.memo);
            self.cursor += 1;
        }
    }

    fn dispatch_exact(&self, eng: &mut CausalEngine, now_tick: u64) {
        for ev in &self.events {
            if ev.tick == now_tick {
                eng.inject_intel(ev.friction_coeff, ev.crisis_level, &ev.memo);
            }
        }
    }
}

fn apply_pack(root: &Json, eng: &mut CausalEngine) -> Vec<PackLever> {
    let cm = root.get("extended_causal_model");
    let mut pack_levers = Vec::new();

    eng.reset();

    let mut parsed_nodes: Vec<Node> = Vec::new();
    for nv in cm.get("nodes").arr() {
        let state_fp = nv.get("state_fp").as_i(0);
        let n = Node {
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
        };
        parsed_nodes.push(n);
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
            path: lv
                .get("path")
                .arr()
                .iter()
                .map(|p| p.as_s().to_string())
                .collect(),
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

    // C++ apply_to_engine: uzatılmış model boşsa evrensel boş şablona dön.
    if cm.get("nodes").arr().is_empty() {
        eng.load_universal_blank_slate();
    }

    pack_levers
}

// ─────────────────────────────────────────────────────────────────────────────
// REPL çıktıları — print_repl_snapshot_json (core_engine.cpp) birebir
// ─────────────────────────────────────────────────────────────────────────────

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

fn emit_snapshot_json(
    out: &mut impl Write,
    scenario_id: &str,
    eng: &CausalEngine,
    snap: &EngineSnapshot,
    json_stdout: bool,
) {
    let prefix = if json_stdout { "" } else { "[REPL_JSON] " };
    let _ = writeln!(
        out,
        "{}{{\"type\":\"snapshot\",\"scenario_id\":\"{}\",\"current_tick\":{},\"last_snapshot_tick\":{},\"raw_friction\":{:.6},\"clamped_friction\":{:.6},\"live_multiplier\":{:.6},\"regime_exceeded\":{},\"outage_active\":{},\"deadline_missed\":{},\"hysteresis_flip\":{},\"throughput_ratio_fp\":{},\"throughput_ratio\":{:.6},\"intel_events_total\":{},\"intel_events_unbound\":{},\"summary\":\"{}\"}}",
        prefix,
        json_escape(scenario_id),
        eng.current_tick(),
        snap.tick,
        snap.raw_friction_d(),
        snap.clamped_friction_d(),
        eng.friction_multiplier(),
        snap.regime_exceeded,
        snap.outage_active,
        snap.any_deadline_missed,
        snap.any_hysteresis_flip,
        snap.throughput_ratio_fp,
        snap.throughput_ratio,
        eng.intel_events_total(),
        eng.intel_events_unbound(),
        json_escape(&snap.summary),
    );
}

fn emit_snapshot_text(out: &mut impl Write, eng: &CausalEngine, snap: &EngineSnapshot) {
    let _ = writeln!(out, "[REPL] Snapshot:");
    let _ = writeln!(out, "       current_tick      : {}", eng.current_tick());
    let _ = writeln!(out, "       last_snapshot_tick: {}", snap.tick);
    let _ = writeln!(
        out,
        "       raw_friction     : {:.6}x",
        snap.raw_friction_d()
    );
    let _ = writeln!(
        out,
        "       clamped_friction : {:.6}x",
        snap.clamped_friction_d()
    );
    let _ = writeln!(
        out,
        "       live_multiplier  : {:.6}x",
        eng.friction_multiplier()
    );
    let _ = writeln!(
        out,
        "       regime_exceeded  : {}",
        if snap.regime_exceeded {
            "EVET"
        } else {
            "HAYIR"
        }
    );
    let _ = writeln!(
        out,
        "       outage_active    : {}",
        if snap.outage_active { "EVET" } else { "HAYIR" }
    );
    let _ = writeln!(
        out,
        "       deadline_missed  : {}",
        if snap.any_deadline_missed {
            "EVET"
        } else {
            "HAYIR"
        }
    );
    let _ = writeln!(
        out,
        "       hysteresis_flip  : {}",
        if snap.any_hysteresis_flip {
            "EVET"
        } else {
            "HAYIR"
        }
    );
    let _ = writeln!(
        out,
        "       throughput_ratio : {:.6}",
        snap.throughput_ratio
    );
    let _ = writeln!(out, "       summary          : {}", snap.summary);
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    let mut scenario_id = String::from("UNIVERSAL_BASELINE");
    let mut det_mode = false;
    let mut repl = false;
    let mut json_stdout = false;

    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--scenario" if i + 1 < args.len() => {
                scenario_id = args[i + 1].clone();
                i += 1;
            }
            "--det-mode" => det_mode = true,
            "--repl" | "--interactive" => repl = true,
            "--json-stdout" => json_stdout = true,
            _ => {}
        }
        i += 1;
    }

    let pack_path = if scenario_id.ends_with(".json") {
        scenario_id.clone()
    } else {
        format!("scenarios/{scenario_id}.json")
    };
    let content = match std::fs::read_to_string(&pack_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[HARNESS] Senaryo dosyası okunamadı: {pack_path}: {e}");
            std::process::exit(2);
        }
    };
    let root = match Parser::new(&content).parse() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[HARNESS] JSON ayrıştırma hatası: {e}");
            std::process::exit(2);
        }
    };

    let mut eng = CausalEngine::new();
    if det_mode {
        eng.set_prng_seed(0xCAE1_05DE_ADBE_EF00);
    }
    let pack_levers = apply_pack(&root, &mut eng);
    let mut replay = ReplaySchedule::from_root(&root);

    let stdout = io::stdout();
    let mut out = stdout.lock();

    // C++ main akışı: 1 baseline tick → sentetik intel → 2 tick → t=3
    let tick0 = eng.current_tick();
    replay.dispatch_up_to(&mut eng, tick0);
    let mut last_snap = eng.tick();
    eng.inject_intel(
        0.82,
        2,
        "GENERIC_FIELD_SIGNAL: Actor_Alpha elevated friction",
    );
    for _ in 0..2 {
        let now = eng.current_tick();
        replay.dispatch_up_to(&mut eng, now);
        last_snap = eng.tick();
    }

    if !repl {
        emit_snapshot_json(&mut out, &scenario_id, &eng, &last_snap, json_stdout);
        return;
    }

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let cmd = parts.next().unwrap_or("").to_lowercase();

        match cmd.as_str() {
            "quit" | "exit" => {
                let _ = writeln!(out, "[REPL] Cikis.");
                break;
            }
            "status" | "snapshot" => {
                let format_arg = parts.next().unwrap_or("").to_lowercase();
                if format_arg == "--json" || format_arg == "json" {
                    emit_snapshot_json(&mut out, &scenario_id, &eng, &last_snap, json_stdout);
                } else {
                    emit_snapshot_text(&mut out, &eng, &last_snap);
                }
            }
            "tick" => {
                // C++ semantiği: `uint64_t n=1; if (iss>>n) {validate}` — C++11'de
                // başarısız extraction n'i 0 yapar; argümansız `tick` 0 tick koşar.
                let n: u64 = match parts.next() {
                    Some(tok) => match tok.parse::<u64>() {
                        Ok(v) => {
                            if v == 0 || v > 100_000 {
                                let _ = writeln!(
                                    out,
                                    "[REPL] tick sayisi 1..100000 araliginda olmali."
                                );
                                continue;
                            }
                            v
                        }
                        Err(_) => 0,
                    },
                    None => 0,
                };
                for _ in 0..n {
                    let now = eng.current_tick();
                    replay.dispatch_up_to(&mut eng, now);
                    last_snap = eng.tick();
                }
                let _ = writeln!(out, "[REPL] {n} tick tamamlandi.");
                emit_snapshot_text(&mut out, &eng, &last_snap);
            }
            "lever" => {
                let lever_id = parts.next().unwrap_or("");
                if lever_id.is_empty() {
                    let _ = writeln!(out, "[REPL] Kullanim: lever <id>");
                    continue;
                }
                let meta = pack_levers.iter().find(|l| l.id == lever_id);
                let meta = match meta {
                    Some(m) => m,
                    None => {
                        let _ = writeln!(
                            out,
                            "[REPL] Kaldirac bulunamadi: {lever_id} (liste icin: list levers)"
                        );
                        continue;
                    }
                };
                let success = eng.apply_lever(lever_id, 0);
                let remaining_cost = if meta.cost_ticks > 1 {
                    meta.cost_ticks - 1
                } else {
                    0
                };
                let _ = writeln!(
                    out,
                    "[REPL] Lever sonucu: {} | cost_ticks={} (tam maliyet icin ek tick: {})",
                    if success {
                        "BASARILI"
                    } else {
                        "BASARISIZ/KILITLI"
                    },
                    meta.cost_ticks,
                    remaining_cost
                );
                let now = eng.current_tick();
                replay.dispatch_up_to(&mut eng, now);
                last_snap = eng.tick();
                emit_snapshot_text(&mut out, &eng, &last_snap);
            }
            "compare_lever" | "counterfactual" => {
                let lever_id = parts.next().unwrap_or("");
                if lever_id.is_empty() {
                    let _ = writeln!(out, "[REPL] Kullanim: compare_lever <id> [horizon_ticks] [seed]");
                    continue;
                }
                let meta = match pack_levers.iter().find(|l| l.id == lever_id) {
                    Some(m) => m,
                    None => {
                        let _ = writeln!(
                            out,
                            "[REPL] Kaldirac bulunamadi: {lever_id} (liste icin: list levers)"
                        );
                        continue;
                    }
                };
                let mut horizon_ticks: u32 = parts
                    .next()
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(24);
                if horizon_ticks == 0 {
                    horizon_ticks = 1;
                }
                if horizon_ticks > 2000 {
                    horizon_ticks = 2000;
                }
                let custom_seed: u64 = parts
                    .next()
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(0);

                let mut branch_a = eng.clone();
                let mut branch_b = eng.clone();
                let tick_start = eng.current_tick();
                let effective_seed = if custom_seed != 0 {
                    custom_seed
                } else if eng.prng_seed() != 0 {
                    eng.prng_seed().wrapping_add(tick_start)
                } else if tick_start != 0 {
                    tick_start
                } else {
                    1
                };

                let lever_applied_ok = branch_b.apply_lever(lever_id, effective_seed);
                let mut snap_a = last_snap.clone();
                let mut snap_b = last_snap.clone();
                let mut sum_tp_a = 0.0f64;
                let mut sum_tp_b = 0.0f64;
                let mut outage_ticks_a = 0u32;
                let mut outage_ticks_b = 0u32;

                for _ in 0..horizon_ticks {
                    let ta = branch_a.current_tick();
                    let tb = branch_b.current_tick();
                    replay.dispatch_exact(&mut branch_a, ta);
                    replay.dispatch_exact(&mut branch_b, tb);
                    snap_a = branch_a.tick();
                    snap_b = branch_b.tick();
                    sum_tp_a += snap_a.throughput_ratio;
                    sum_tp_b += snap_b.throughput_ratio;
                    if snap_a.outage_active {
                        outage_ticks_a += 1;
                    }
                    if snap_b.outage_active {
                        outage_ticks_b += 1;
                    }
                }

                let avg_tp_a = sum_tp_a / (horizon_ticks as f64);
                let avg_tp_b = sum_tp_b / (horizon_ticks as f64);
                let delta_tp = avg_tp_b - avg_tp_a;
                let _ = meta;

                let _ = writeln!(
                    out,
                    "[REPL_COUNTERFACTUAL] {{\"type\":\"counterfactual_result\",\"scenario_id\":\"{}\",\"lever_id\":\"{}\",\"lever_success\":{},\"seed\":{},\"tick_start\":{},\"horizon_ticks\":{},\"baseline_end_friction\":{:.6},\"intervention_end_friction\":{:.6},\"baseline_end_throughput\":{:.6},\"intervention_end_throughput\":{:.6},\"baseline_avg_throughput\":{:.6},\"intervention_avg_throughput\":{:.6},\"delta_avg_throughput\":{:.6},\"baseline_outage_ticks\":{},\"intervention_outage_ticks\":{},\"baseline_end_outage\":{},\"intervention_end_outage\":{},\"branch_a\":{{\"tick\":{},\"throughput_ratio\":{:.6},\"clamped_friction\":{:.6},\"outage_active\":{},\"deadline_missed\":{},\"any_hysteresis_flip\":{}}},\"branch_b\":{{\"tick\":{},\"throughput_ratio\":{:.6},\"clamped_friction\":{:.6},\"outage_active\":{},\"deadline_missed\":{},\"any_hysteresis_flip\":{}}}}}",
                    json_escape(&scenario_id),
                    json_escape(lever_id),
                    lever_applied_ok,
                    effective_seed,
                    tick_start,
                    horizon_ticks,
                    snap_a.clamped_friction_d(),
                    snap_b.clamped_friction_d(),
                    snap_a.throughput_ratio,
                    snap_b.throughput_ratio,
                    avg_tp_a,
                    avg_tp_b,
                    delta_tp,
                    outage_ticks_a,
                    outage_ticks_b,
                    snap_a.outage_active,
                    snap_b.outage_active,
                    branch_a.current_tick(),
                    snap_a.throughput_ratio,
                    snap_a.clamped_friction_d(),
                    snap_a.outage_active,
                    snap_a.any_deadline_missed,
                    snap_a.any_hysteresis_flip,
                    branch_b.current_tick(),
                    snap_b.throughput_ratio,
                    snap_b.clamped_friction_d(),
                    snap_b.outage_active,
                    snap_b.any_deadline_missed,
                    snap_b.any_hysteresis_flip
                );
            }
            "list" => {
                let what = parts.next().unwrap_or("").to_lowercase();
                if what == "levers" {
                    if pack_levers.is_empty() {
                        let _ = writeln!(out, "[REPL] Yuklu senaryo kaldiraci yok.");
                    } else {
                        let _ = writeln!(out, "[REPL] Kaldiraclar:");
                        for l in &pack_levers {
                            let _ = writeln!(
                                out,
                                "  {}  target={}  p={:.2}  cost_ticks={}  lockout_ticks={}",
                                l.id,
                                l.target,
                                l.success_p_fp as f64 / 1_000_000.0,
                                l.cost_ticks,
                                l.lockout_ticks
                            );
                        }
                    }
                } else {
                    let _ = writeln!(out, "[REPL] Bilinmeyen liste. Ornek: list levers");
                }
            }
            "help" | "?" => {
                let _ = writeln!(out, "[REPL] Komutlar: status|snapshot [--json], tick <n>, lever <id>, list levers, quit");
            }
            _ => {
                let _ = writeln!(out, "[REPL] Bilinmeyen komut: {cmd} (yardim: help)");
            }
        }
    }
}
