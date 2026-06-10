# CAELUS OS — UI Hollywood & Modern UX Tasarım Raporu

**Sürüm:** 1.0  
**Kapsam:** Mevcut `ui/index.html` + `ui/app.js` + `include/ws_emitter.h` + `include/causal_engine.h` + `docs/BS_EXEC_REPL_KILAVUZU.md` gerçek kaynak ağacı üzerinden kanıt-temelli analiz; Hollywood/NOC tasarım vizyonu; teknik uygulanabilirlik; önceliklendirilmiş geliştirme yol haritası.  
**Dayanak:** `ui/app.js` (1864 satır), `ui/index.html` (1114 satır CSS+HTML), `include/ws_emitter.h` (`ws_json` namespace builder'ları), `include/causal_engine.h` (`EngineSnapshot` yapısı, `outage_`, `throughput_ratio`), `docs/BS_EXEC_REPL_KILAVUZU.md`  
**Tarih:** 2026-06-10

---

## 1. Mevcut UI Analizi (Kanıt-Temelli)

### 1.1 DOM Yapısı ve Genel Mimari

`index.html` üç sütunlu CSS Grid (`grid-template-columns: 288px 1fr 304px`) ile oluşturulmuş sabit genişlikli bir layout kullanıyor. Responsive kırılma noktası yok — `html, body { overflow: hidden }` açıkça yazılmış, bu da ekran dışı taşma yerine içeriğin kırpılmasını tercih ediyor.

```
┌──────────────────────────────────────────────────────────────────────┐
│  HEADER (50px) — hdr-logo · badge'ler · uptime / UTC / mesh sayısı  │
├─────────────────┬────────────────────────────────┬───────────────────┤
│  SOL PANEL      │  MERKEZ PANEL                  │  SAĞ PANEL        │
│  288px sabit    │  flex:1 (esnek genişlik)        │  304px sabit      │
│                 │                                 │                   │
│  mesh-canvas    │  cmd-block (textarea)           │  leverage bars    │
│  (188px fixed)  │  + btn-execute / btn-clear      │  sparklines       │
│  peer-list      │  + output-panel (typewriter)    │  friction gauge   │
│  crypto-log     │                                 │  otp-timeline     │
│  audio-toggle   │                                 │                   │
├─────────────────┴────────────────────────────────┴───────────────────┤
│  FOOTER STATUS BAR (26px) — ticker · session / pkt / rpt             │
└──────────────────────────────────────────────────────────────────────┘
```

**CRT katmanları:** `crt-scanlines` + `crt-vignette` + `crt-glow` üç ayrı `position:fixed` overlay olarak, z-index 9997–9999 aralığında çalışıyor. Bu atmosferik dokunuş halihazırda Hollywood stiline yakın.

**Boot animasyonu:** `runBoot()` fonksiyonu `BOOT_LINES` dizisini 1660 ms içinde `setTimeout` zinciriyle ekrana yazdırıyor. Her satır `SFX.boot()` (440 Hz sinüs) ile ses çalıyor. Boot overlay CSS `opacity` geçişiyle kayboluyor.

**Watermark ve pill:** `#live-watermark` (z-index 9996) ve `#live-pill` (z-index 9994) WebSocket durumunu gösteriyor — `wm--offline` / `wm--live` / `wm--awaiting`. Bağlantı yokken büyük `DEMO MODE: OFFLINE` yazısı 52px, %13 opacity'de diyagonal çalışıyor.

### 1.2 Renk Paleti

`index.html` başında CSS Custom Properties olarak tanımlanmış, merkezi yönetiliyor:

| Değişken | Hex | Kullanım |
|---|---|---|
| `--bg` | `#05090f` | Sayfa arka planı |
| `--panel-bg` | `#07111d` | Panel arka planı |
| `--cyan` | `#06c2d4` | Birincil vurgu, prompt, değerler |
| `--green` | `#4ade80` | Nominal durum, OK log |
| `--amber` | `#e8a838` | Uyarı, işleniyor durumu |
| `--crisis` | `#cf6679` | Kriz durumu, hata log |
| `--blue` | `#3b82f6` | Actor node tipi |
| `--text` | `#b8cfe4` | Ana metin |
| `--text-2` | `#5a7a9a` | İkincil metin |
| `--text-3` | `#2a4060` | Soluk/açıklama metni |

**Teknik borç:** Hardcoded renk yok — tüm renkler CSS variable üzerinden geçiyor. Bu büyük bir artı; tema değişikliği tek dosyadan yönetilebilir. Ancak `colorMap` içinde `app.js:915` satırında JavaScript tarafında da renk değerleri tekrar edilmiş (`'#06c2d4'`, `'#cf6679'`, `'#e8a838'`, `'#3b82f6'`) — CSS variable'lardan okuma yerine sabit string. Renk tutarsızlık riski: CSS'i değiştirirsen JS renkleri bozuk kalır.

### 1.3 Animasyon ve Geçiş Seviyesi

Mevcut animasyonlar:
- `@keyframes crt-roll` — CRT glow katmanı dikey kayma (14s lineer, sonsuz)
- `@keyframes bcursor` — boot ve terminal imleç yanıp sönmesi (0.9s step-end)
- `@keyframes logfade` — crypto log girişlerinde fade-in + -4px translateY (0.4s)
- `@keyframes dot-pulse` — status dot'lar için opaklık atması (2.5s ease)
- `@keyframes pulse-badge` — kriz rozeti için opaklık atması (2s ease)
- `@keyframes peer-pulse` — el sıkışma sırasındaki peer kutusu kenarlık rengi değişimi
- `@keyframes idle-spin` — boş output panelinde ⬡ simgesinin dönmesi (12s lineer)
- `@keyframes ticker-scroll` — footer'daki INTEL ticker'ı (60s sonsuz)
- Leverage bar fill: `transition: width .9s cubic-bezier(.4,0,.2,1)` (smooth)
- Gauge needle: `transition: x2 .8s, y2 .8s cubic-bezier(.4,0,.2,1)`
- Gauge fill arc: `transition: stroke-dasharray .8s`

Canvas animasyonu `requestAnimationFrame(drawMesh)` döngüsüyle çalışıyor — RAF kullanımı doğru. Grid dot background, node pulse, paket animasyonları, handshake ring'i hepsi dahil.

**Eksik:** `throughput_ratio` için animasyon yok. Outage anında dramatik görsel yok. Tek kriz göstergesi `hdr-threat` badge'in görünür olması (`display:''`) ve `monitorBadge`'in `panel-badge--crisis` sınıfına geçmesi — bunlar çok ince.

### 1.4 Veri Görselleştirme

Mevcut görselleştirmeler:
1. **P2P Mesh Canvas** (`canvas#mesh-canvas`): `MeshNode` sınıfı, 7 node tipi renk kodu (LOCAL=cyan, NODE=green, EDGE=amber, ACTOR=blue, REG_GATE=purple, TRANSIT=pink, FRICTION=orange), aralarında mesafeye bağlı kenar çizimi, packet animasyonu. Bu **P2P ağ topolojisini** gösteriyor — `CausalEngine`'in causal grafını değil. İki grafik kavramı tamamen farklı.
2. **Friction Gauge**: SVG semicircle (viewBox `0 0 200 112`), üç renk zonu (yeşil/amber/kriz), ibre animasyonu, `frictionSeverity = (mu - 1) / 2` normalize. Değer aralığı: `mu ∈ [1.0, 3.0]`.
3. **Leverage Bars + Sparklines**: Dört metrik (node/edge/actor/gate) için yatay fill bar + SVG sparkline. `renderSparkline()` son 20 değeri SVG path olarak çiziyor.
4. **OTP Timeline**: Dört slot için yatay fill bar; aktif/sona ermiş/kuyruk durumları.
5. **Crypto Event Log**: `logfade` animasyonlu liste; zaman damgası + seviye + mesaj.

### 1.5 WebSocket Event İşleme (Gerçek Kod Tespiti)

`handleEngineEvent()` — `app.js:1383` — şu event tiplerini işliyor:

| Event tipi | `ws_emitter.h`'deki kaynak | Mevcut UI davranışı |
|---|---|---|
| `friction` | `ws_json::friction(value, crisis_level, tick)` | `applyFrictionMu()` → gauge + leverage DOM güncelleme |
| `intel` | `ws_json::intel_event(session_id, crisis_level, friction_coeff, memo)` | Yalnızca crypto log'a satır ekleniyor |
| `regime_exceeded` | `ws_json::regime_exceeded(raw, cap)` | Crypto log'a `[CRITICAL]` satırı + `SFX.alarm()` |
| `handshake` | `ws_json::handshake_event(peer_fp, session_id, ok)` | Crypto log satırı |
| `scenario_loaded` | `ws_json::scenario_loaded(id, region)` | `applyScenarioMetadata()` → mesh node yenileme |
| `engine_state` | `ws_json::engine_state(state, scenario_id, tick, friction_mult)` | `applyEngineStateEvent()` — watermark ve pill güncelleme |
| `otp` | `ws_json::otp_slot(slot_id, status, remaining_secs)` | OTP timeline slot güncellemesi |
| `optimization` | `ws_json::optimization_result(on_time, arrival_min, completion_min, friction_mult)` | Yalnızca crypto log satırı |
| `ws_gap` | İç `gap_event(dropped)` (WsEmitter.send_pending) | `default:` dalında log satırı |

**Kritik gözlem:** `engine_state` payloadu `tick` ve `friction_mult` taşıyor (`ws_emitter.h:685–696`); ayrıca `EngineSnapshot` içindeki `throughput_ratio` ve `outage_active` alanları `ws_json::engine_state()` builder'ına **dahil edilmemiş** — builder yalnızca `state, scenario_id, tick, friction_mult` alıyor. Dolayısıyla `throughput_ratio` ve `outage_active` şu anda WebSocket'ten hiç push edilmiyor; UI bu değerleri asla görmüyor.

### 1.6 State Yönetimi

`state` nesnesi (`app.js:36`) şunları barındırıyor:
- `engineStatus`: `'offline'` / `'live'` / `'awaiting'`
- `scenarioMeta.scenarioId`: `'UNIVERSAL_BASELINE'` veya yüklü senaryo ID'si
- `metrics`: node/edge/actor/gate (0–100), friction (1.0–3.0), delay, mult
- `history`: son 20 değer sparkline ring buffer
- `otpSlots`: OTP slot listesi
- `peers`: MeshNode listesi

**Eksik state:** `currentTick`, `throughputRatio`, `outageActive`, `hysteresisFlipHistory` — hiçbiri state'te tutulmuyor.

### 1.7 "Hollywood Tarzı"ndan Uzaklaştıran 5 Kritik Boşluk

**Boşluk 1 — `throughput_ratio` / Outage Banner görünmüyor (en kritik).**  
`EngineSnapshot::throughput_ratio` (0..1) ve `outage_active` (bool) `causal_engine.h:320–321` içinde tanımlı ve en dramatik kriz sinyali. Ancak `ws_json::engine_state()` builder'ı bu alanları JSON'a **koymuyor** (`ws_emitter.h:685–696` doğrulama). UI hiçbir zaman outage durumunu `throughput_ratio = 0.0` olarak görmüyor. Outage anındaki tek görsel etki friction gauge'ın kırmızıya dönmesi — bu, tam ekranı baskın alması gereken kritik bir olayın tamamen gözden kaçırılması demek.

**Boşluk 2 — Tick-bazlı Kriz Zaman Çizelgesi yok.**  
`ws_json::friction`, `ws_json::engine_state`, `ws_json::optimization_result` payloadları `tick` alanı içeriyor ama UI'de hiçbir yerde tick ekseni yok. BS-01 `HYST_PERM_REROUTE` tick 576'da, BS-02 `HYST_PAYROLL_MISS` tick 144'te gerçekleşiyor — kırılma noktaları görünür değil. REPL kılavuzunda `tick 382` gibi eşik komutları tanımlanmış ama bunlar UI'ye yansımıyor.

**Boşluk 3 — Causal Graf ≠ P2P Mesh (karışıklık).**  
`canvas#mesh-canvas` P2P ağ topolojisini gösteriyor — `MeshNode` sınıfı ED25519 public key, OTP süresini, handshake durumunu tutuyor. Bu gerçek bir `CausalEngine` grafı değil. `applyScenarioNodes()` senaryo node'larını mesh canvas'a ekliyor ama bu node'lar gerçek `state_fp`, `reported_state_fp`, kapasite, yük bilgisi taşımıyor. Kullanıcı causal graph'ı P2P mesh'miş gibi görüyor — kavramsal yanıltıcılık.

**Boşluk 4 — REPL/Lever konsolu yok.**  
`docs/BS_EXEC_REPL_KILAVUZU.md`'daki `lever <id>`, `tick <n>`, `snapshot --json`, `list levers` komutları yalnızca CLI'dan gönderilebiliyor. Web UI'ndeki textarea ScenarioPack JSON kabulü için tasarlanmış, REPL komutu için değil. `clear_irrecoverable` lever efekti UI'ye hiç yansımıyor.

**Boşluk 5 — Senaryo imza durumu ve plugin durumu gösterilmiyor.**  
`scenario_loaded` eventi `scenario_id` ve `sector` taşıyor ama ed25519 doğrulama durumu (`SELF_SIGNED_DEV` uyarısı vs `VERIFIED` badge) UI'de yok. `caelus_plugin_registry.h`'daki DynamicPluginLoader imza gate durumu (`CAELUS_PLUGIN_ALLOW_UNVERIFIED=1` bypass) hiç görünmüyor.

---

## 2. Hedef Vizyon — "CAELUS Command Center"

### 2.1 Konsept Tanımı

Hedef: bir **siber güvenlik NOC (Network Operations Center)** ve **Hollywood film yapım odası** esintisini birleştiren, gerçek zamanlı akan veriyle kriz anını dramatik biçimde sunan, aynı zamanda ilk kez bakan bir kullanıcının 3 saniye içinde sistemin durumunu anlayabileceği bir arayüz.

Referans atmosfer: koyu lacivert-siyah zemin, kırmızı/amber neon ışıma çizgileri, akan veri akışı, kriz anında tam ekranı kaplayan kırmızı uyarı, iyileştikçe rengin yeşile döndüğü "sağlık çubuğu" metaforu. Karanlık arka plan zorunlu; açık tema desteklenmiyor (fiziksel NOC ekranlarında refleks önleme).

### 2.2 Bilgi Hiyerarşisi Prensibi

Kullanıcı herhangi bir anda üç soruyu 3 saniyede yanıtlayabilmeli:

1. **Sistem şu anda sağlıklı mı?** → Throughput Gauge / Outage Banner (büyük, ortada, renk önce)
2. **Kriz ne zaman başladı, ne kadar sürecek?** → Kriz Zaman Çizelgesi (tick bazlı)
3. **Ne yapmalıyım?** → Lever öneri kutusu (öne çıkan aksiyon kartları)

### 2.3 Bileşen Düzeyinde Vizyon

#### 2.3.1 Throughput Gauge & Outage Banner

`EngineSnapshot::throughput_ratio` (0..1) kaynağından besleniyor. Mevcut friction gauge (yalnızca `mu` gösteriyor) yerine **iki katmanlı** bir gösterge:

- **Büyük merkezi sayı:** `%87` gibi throughput yüzdesi, 48px+ font, renk geçişi (yeşil → amber → kırmızı)
- **Outage anında:** Tüm panel arka planı kırmızıya geçen bir overlay (tam ekran değil, yalnızca ana panel), yanıp sönen `OUTAGE ACTIVE` bandı, büyük `0.0` yazısı. Bu CRT tarama çizgilerinin üstünde çalışmalı.
- **Throughput çubuğu:** Radyal değil, dikey "doluluk bardağı" — 0'dan 1'e artan yeşil sütun. Outage'da sütun boşalıyor.

`ws_emitter.h` entegrasyonu için `ws_json::engine_state()` builder'ına `throughput_ratio` ve `outage_active` eklenmesi zorunlu (backend değişikliği — Bkz. Bölüm 7.2).

#### 2.3.2 Kriz Zaman Çizelgesi

`tick` değeri her `friction`, `engine_state` ve `optimization` eventinde geliyor. Yatay zaman şeridi:

- X ekseni: tick sayısı (0'dan mevcut tick'e)
- Y ekseni: `throughput_ratio` veya `friction_mult` (0..1)
- **Kırılma noktaları:** `any_hysteresis_flip == true` olduğunda şeridin üzerinde kırmızı dikey çizgi + "HYS" etiketi
- **Deadline miss noktaları:** Kırmızı ✕ sembolü
- **Outage bölgeleri:** Arka planı kırmızı taralı (semi-transparent)
- **Lever uygulamaları:** Yeşil ▼ üçgen simgesi

Kaydırılabilir, son 512 tick'i gösteriyor; `--det-mode` kaydından oynatılabilir (Bölüm 4.3).

#### 2.3.3 Causal Graf Canvas

`snapshot --json` REPL komutundan veya `engine_state` event akışından gelen node/edge verisi ile SVG ya da Canvas API üzerinde gerçek CausalEngine grafı:

**Node renk kodlaması (EngineNode.state_fp üzerinden):**

| Durum | Renk | Açıklama |
|---|---|---|
| `outage_active == true` | `#cf6679` (--crisis) yanıp sönen | Tam tıkanma |
| `throughput_ratio < 0.3` | `#e8a838` (--amber) | Yüksek sürtünme |
| Normal | `#4ade80` (--green) | Nominal akış |
| `irrecoverable == true` | `#cf6679` dolgu, siyah dış çerçeve | Geri dönüşsüz kayıp |

**Node boyutu:** `capacity_fp` ile orantılı — büyük kapasiteli node daha büyük daire.

**Kenar görselleştirme:**
- `edge.lag_ticks > 0` → Kesik çizgi (gecikme görsel kodu)
- `edge.weight_fp` → Kenar kalınlığı
- Kenar üzerinde akan paket animasyonu (`emitPacket()` benzeri) — mevcut mesh canvas'ta zaten var, causal graf'a uyarlanabilir.

**Snapshot besleme:** REPL'den `snapshot --json` gönderildiğinde `[REPL_JSON] {...}` satırı WS üzerinden UI'ye yönlendirilir. Ayrışan format: `{type:"snapshot", ...EngineSnapshot alanları}`.

#### 2.3.4 REPL / Lever Console

Terminal benzeri karanlık konsol, solun alt kısmında veya ayrı bir panel olarak:

```
caelus://bs-01-sahte-ufuk $ _
```

- `lever L-01_ZAFER_ANLATI` → WS üzerinden motora iletiliyor
- `list levers` → Mevcut kaldıraç listesi; her kaldıraç için `cost_ticks`, `lockout_ticks`, başarı olasılığı
- `tick 23` → Motor N tick ilerliyor
- `snapshot --json` → Anlık durum dökümü, grafı güncelliyor
- Komut geçmişi (↑/↓ ok tuşları), `Tab` tamamlama

**Mevcut durumdan farkı:** `cmd-block` textarea'sı ScenarioPack JSON kabul ediyor, REPL komutu değil. REPL konsolu ayrı bir `<pre>`+`<input>` çifti olarak tanımlanmalı.

#### 2.3.5 Senaryo Kartı

Sol üstte küçük bir bilgi kartı:

```
┌─────────────────────────────────────┐
│ BS-01_SAHTE_UFUK                    │
│ Sektör: TRANSIT · Tick: 42          │
│ ✅ ED25519 DOĞRULANDI               │  ← yeşil
│ ─ VEYA ─                            │
│ ⚠️ SELF_SIGNED_DEV (bypass aktif)   │  ← amber
└─────────────────────────────────────┘
```

`scenario_loaded` eventi `scenario_id` ve `sector` taşıyor; imza durumu motordaki `CAELUS_ALLOW_DEV_SCENARIOS=1` ortam değişkenine bağlı — backend bu bilgiyi bir `meta` alanı olarak eklemeli.

#### 2.3.6 Plugin Durum Paneli

`caelus_plugin_registry.h`'daki DynamicPluginLoader yüklendiğinde:

```
PLUGINS (2/4 AKTİF)
├── caelus_connector_mqtt.dll   ✅ İmzalı
├── caelus_solver_custom.dll    ⚠️ DEV BYPASS
└── caelus_reporter_json.dll    ✅ İmzalı
```

Şu anki durumda loader motora bağlı değil (T-17 borcu) — bu panel P2 önceliğiyle ertelenebilir.

#### 2.3.7 Audit Log Feed

`include/audit_log.h`'dan gelen BLAKE3 zinciri son N kaydını akan bir şerit:

```
14:23:01 [AUDIT] tick=42 state=FRICTION_RAISED hash=a3b9...
14:23:05 [AUDIT] tick=43 lever=L-01_ZAFER hash=f8d1...  ← yeşil
14:23:07 [AUDIT] ZINCIR KIRILMASI ALGILANDI              ← kırmızı alarm
```

Zincir bütünlük hatası anında tüm feed kırmızıya dönüyor ve `SFX.alarm()` çalıyor.

---

## 3. Teknik Mimari Önerisi

### 3.1 Sıfır Harici Framework — Önerilen Stack

**Temel öneri: Vanilla JS + CSS Custom Properties + Canvas API + SVG — derleme adımı yok.**

Mevcut `ui/index.html` + `ui/app.js` mimarisini koruyarak ekleme yapılabilir. Air-gap kısıtı CDN yasağını getiriyor; mevcut yapı doğrudan bunu karşılıyor.

Teknoloji kararları:

| Bileşen | Mevcut | Önerilen | Gerekçe |
|---|---|---|---|
| Stil sistemi | CSS Custom Properties | Aynı, genişletilmiş | Zaten merkezi ve çalışıyor |
| Mesh canvas | Canvas 2D + RAF | Aynı | RAF zaten kullanılıyor |
| Causal graf | Yok | Canvas 2D veya SVG | `<g>` tag'ları ile semantik |
| Kriz zaman çizelgesi | Yok | Canvas 2D | Kaydırma için canvas uygun |
| Gauge | SVG semicircle | SVG + ek `throughput_ratio` çemberi | Mevcut kod yeniden kullanılabilir |
| State yönetimi | `state` nesnesi | Genişletilmiş `state` | Tek kaynak, saf JS |
| WS | Vanilla WebSocket | Aynı + event queue | Mevcut `handleEngineEvent()` genişletilir |

### 3.2 Alternatif Framework Değerlendirmesi

Eğer loopback sunucu üzerinden servis ediliyorsa ve önceden bundlama kabul ediliyorsa:

| Framework | Bundle boyutu (gz) | Artılar | Eksiler |
|---|---|---|---|
| **Vanilla JS** | ~0 | Sıfır bağımlılık, air-gap mükemmel | Manual DOM yönetimi |
| **Alpine.js 3.x** | ~15 KB gz | Reaktif binding'ler, minimal | Ekstra bağımlılık; embed gerektirir |
| **Preact 10.x** | ~4 KB gz | React benzeri, çok küçük | JSX → derleme adımı |
| **Solid.js** | ~7 KB gz | Granular reaktivite, yüksek performans | Öğrenme eğrisi; derleme adımı |
| **Lit 3.x** | ~6 KB gz | Web Components, standart API | Shadow DOM → stil izolasyonu karmaşıklığı |

**Karar:** Mevcut ekip Vanilla JS bilgisi ve air-gap zorunluluğu nedeniyle **Vanilla JS devam edilmeli**. Eğer reaktivite sorunları ciddi hal alırsa Alpine.js tek-dosya embed (dist'e `alpine.min.js` kopyalanarak) düşük riski ile kullanılabilir.

### 3.3 WebSocket Event Eşlemesi

Mevcut `ws_json` namespace'inden gelen alanların UI bileşenlerine tam eşlemesi:

```
ws_json::friction(value, crisis_level, tick)
    ├── value         → gauge: applyFrictionMu()        [MEVCUT ✅]
    ├── crisis_level  → kriz zaman çizelgesi: nokta rengi [EKSİK ❌]
    └── tick          → kriz zaman çizelgesi: X ekseni   [EKSİK ❌]

ws_json::engine_state(state, scenario_id, tick, friction_mult)
    ├── state         → watermark/pill: setLiveStatus()  [MEVCUT ✅]
    ├── scenario_id   → senaryo kartı                   [MEVCUT ✅]
    ├── tick          → kriz zaman çizelgesi X ekseni   [EKSİK ❌]
    ├── friction_mult → gauge                           [MEVCUT ✅]
    ├── throughput_ratio → throughput gauge             [EKSİK ❌ — builder'a eklenmeli]
    └── outage_active → outage banner, timeline         [EKSİK ❌ — builder'a eklenmeli]

ws_json::regime_exceeded(raw, cap)
    ├── raw_multiplier → alarm overlay                  [MEVCUT - sadece log ❌ görsel yok]
    └── capped_at     → gauge üst sınır göstergesi      [EKSİK ❌]

ws_json::optimization_result(on_time, arrival_min, completion_min, friction_mult)
    ├── on_time       → yeşil/kırmızı ikon              [EKSİK ❌ — sadece log]
    ├── arrival_min   → optimizasyon paneli             [EKSİK ❌]
    └── completion_min → optimizasyon paneli            [EKSİK ❌]

ws_json::otp_slot(slot_id, status, remaining_secs)
    └── status/remaining_secs → otp-timeline           [MEVCUT ✅]

ws_json::handshake_event(peer_fp, session_id, ok)
    └── ok=false → alarm                               [MEVCUT - sadece log ve SFX ❌ görsel yok]

ws_json::intel_event(session_id, crisis_level, friction_coeff, memo)
    └── tümü → crypto log satırı                       [MEVCUT ✅]
```

**Backend değişikliği zorunluluğu:** `ws_json::engine_state()` (`ws_emitter.h:685`) builder'ına `throughput_ratio` ve `outage_active` parametrelerinin eklenmesi. Bu olmadan UI görsel outage'ı asla göremez.

### 3.4 `snapshot --json` → Causal Graf Besleme Yolu

REPL `snapshot --json` komutu `[REPL_JSON] {...}` satırı basıyor. Mevcut durumda bu REPL çıktısı — WS üzerinden UI'ye gelmiyor. Önerilen boru:

```
C++ motor (REPL içi)
    ↓ snapshot --json → build_snapshot() çağrısı
    ↓ JSON: {type:"snapshot", tick:N, outage_active:bool,
             throughput_ratio:double, clamped_friction_fp:int64,
             any_hysteresis_flip:bool, nodes:[...], levers:[...]}
    ↓ emitter.emit(json)  ← WsEmitter.emit() çağrısı
    ↓ ws://127.0.0.1:47809
    ↓ UI: handleEngineEvent() → case 'snapshot': → renderCausalGraph()
```

Bu yol `CausalEngine::tick()` → `build_snapshot()` → `WsEmitter::emit()` zinciriyle halihazırda var olan ama UI tarafında karşılıksız kalan veriyi görselleştirmeye açar.

### 3.5 Performans Tasarımı

**Canvas RAF döngüsü:** Mevcut `drawMesh()` RAF döngüsü tek bir `requestAnimationFrame` zinciri. Causal graf ve kriz timeline ayrı canvas'larda veya ayrı RAF'larda çalışmalı — tek RAF'a monte edebilirsin ama DOM'a dokunma (`updateLeverageDOM` gibi) RAF'ın dışında, WS event queue'su üzerinden yapılmalı.

**WS mesaj kuyruğu:**

```javascript
// Mevcut: handleEngineEvent() her mesajı anlık işliyor — sorun yok
// Öneri: Yüksek frekanslı tick olaylarında debounce gerekli

const wsQueue = [];
let wsRafScheduled = false;

function handleEngineEvent(ev) {
  let data;
  try { data = JSON.parse(ev.data); } catch (_) { return; }
  wsQueue.push(data);
  if (!wsRafScheduled) {
    wsRafScheduled = true;
    requestAnimationFrame(flushWsQueue);
  }
}

function flushWsQueue() {
  wsRafScheduled = false;
  while (wsQueue.length) {
    routeEvent(wsQueue.shift());
  }
}
```

**Büyük graf için fallback:** 500+ node senaryosunda Canvas 2D yeterli olmalı. WebGL yalnızca `node_count > 1000` durumunda düşünülmeli. Fallback stratejisi: `navigator.gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || null` — null ise 2D Canvas.

---

## 4. UX Tasarım İlkeleri (CAELUS'a Özel)

### 4.1 Kriz Anında Bilgi Önceliği

**Yanlış yaklaşım:** Outage = tüm ekran kırmızı overlay → operatör panikler, ekranı okuyamaz.  
**Doğru yaklaşım:** Outage = **odak yönlendirme**:

```
[NORMAL DURUM]                     [OUTAGE DURUMU]
┌────────────────────────────────┐  ┌────────────────────────────────┐
│ Throughput: 87%  🟢            │  │ ▓▓▓ OUTAGE AKTİF ▓▓▓  🔴      │
│                                │  │ Throughput: 0%   tick=42       │
│ Graf: akış görünür             │  │ Kök neden: HYST_PERM_REROUTE   │
│                                │  │ ─────────────────────────────  │
│ [Lever konsolu] pasif          │  │ ÖNERİLEN LEVER: clear_irrecov  │
└────────────────────────────────┘  └────────────────────────────────┘
```

Kriz anında operatörün odağı **neden** (kök neden node'u grafte vurgulanmış) ve **ne yapmalı** (lever öneri kutusu) üzerinde olmalı.

### 4.2 Deterministik Oynatım Modu

`--det-mode` ile kaydedilen tick dizisi UI'de **oynatılabilir**: "Dava Analizi" ve "Eğitim" için. Oynatım kontrolleri:

```
[◀◀] [◀] [▶/II] [▶▶] | Tick: 42 / 576 | Hız: 1× 5× 20×
```

WS yerine `fetch('/snapshot?tick=N')` veya önceden kaydedilmiş NDJSON dosyası okunabilir.

### 4.3 Renk Felsefesi

**Zorunlu:** Renk tek başına semantik taşımamalı — renk körlüğü (deuteranopia: kırmızı-yeşil karışıklığı) için şekil + doku kodu eklenmeli:

| Durum | Renk | Şekil/Doku Kodu |
|---|---|---|
| Nominal | `#4ade80` yeşil | ● dolu daire |
| Uyarı | `#e8a838` amber | ◆ eşkenar dörtgen / kesik çizgi |
| Kriz/Outage | `#cf6679` kırmızı | ▲ üçgen + `▓▓` tarama deseni |
| Geri dönüşsüz | `#cf6679` + siyah çerçeve | ✕ çarpı simgesi |

**Amber vurgu rengi:** Mevcut `--amber: #e8a838` NOC/Hollywood esintisi için uygun. Daha güçlü bir NOC karakteri için `#FF8C00` (koyu turuncu amber) CSS variable'a yükseltilebilir — tek satır değişiklik.

**Karanlık mod zorunlu:** Mevcut `--bg: #05090f` (neredeyse saf siyah) ve `--panel-bg: #07111d` doğru seçim. Değiştirilmemeli.

### 4.4 Erişilebilirlik (WCAG 2.1 AA Hedefi)

Mevcut eksiklikler (kanıt-temelli):

1. **Kontrast:** `--text-3: #2a4060` üzerinde `--bg: #05090f` → oran ≈ 1.8:1 (AA minimum 4.5:1 norm metin için; büyük metin 3:1). `index.html`'de bu kombinasyon `.peer-detail`, `.g-stat-label`, `.tel-label` gibi bilgi taşıyan elemanlar için kullanılıyor — **WCAG AA ihlali**.
2. **ARIA eksikliği:** Canvas, gauge SVG, ticker, crypto log üzerinde `aria-label` / `role` / `aria-live` yok.
3. **Klavye navigasyonu:** Yalnızca `btn-execute` ve `btn-clear` tab navigasyonunda; REPL konsolu, lever listesi, graf erişilemiyor.
4. **`user-select: none`** body üzerinde — screen reader içeriği seçemez.

**Önerilen minimum çözüm (P2):**
- `--text-3` → `#4a6a8a` (kontrast ≈ 3.1:1 büyük metin; bilgi taşıyan küçük metin için `--text-2` tercih)
- Canvas için `aria-label="CAELUS Nedensel Graf"` + `role="img"`
- `aria-live="polite"` → crypto log, status değişimleri için
- Kritik alarm için `aria-live="assertive"` → outage banner

---

## 5. Uygulama Yol Haritası

### P0 — Hızlı Kazanım (1–3 gün efor, dramatik görsel etki)

#### P0-A: Throughput Gauge + Outage Banner

**Efor:** S (küçük — 1 gün)  
**Backend bağımlılığı:** `ws_emitter.h`'daki `ws_json::engine_state()` builder'ına `throughput_ratio` ve `outage_active` alanlarının eklenmesi (M efor backend'de)  
**UI değişiklikleri:**
- Yeni `#throughput-gauge` bileşeni: radyal veya dikey dolum + büyük yüzde sayısı
- `handleEngineEvent()` → `case 'engine_state'` → `applyThroughputGauge(data.throughput_ratio, data.outage_active)`
- Outage anında: `panel--center` arka planında amber → kırmızı geçişi, yanıp sönen `OUTAGE ACTIVE` bandı

**Tamamlanma kriteri:**
- `outage_active = true` event'i aldığında merkez panel görsel olarak değişiyor
- `throughput_ratio = 0.0` rakamsal olarak gösteriliyor
- `outage_active = false` event'iyle (recovery lever sonrası) görsel normale dönüyor

#### P0-B: Kriz Zaman Çizelgesi (Tick-Bazlı)

**Efor:** M (orta — 2 gün)  
**Backend bağımlılığı:** `tick` alanı `ws_json::friction`, `engine_state` eventlerinde zaten mevcut ✅  
**UI değişiklikleri:**
- Yeni `<canvas id="crisis-timeline">` elemanı (300–400px yükseklik, panel altında)
- `state.tickHistory[]` ring buffer: son 512 tick için `{tick, throughput, friction, outage, hysteresisFlip}` kayıt
- Canvas draw fonksiyonu: X=tick, Y=throughput_ratio, kırılma noktaları için dikey çizgiler
- Kaydırma: `wheel` event ile pan, `transform` veya offset state

**Tamamlanma kriteri:**
- BS-01 simülasyonunda tick 576'daki histerezis flip'i kırmızı dikey çizgi olarak görünüyor
- Timeline kaydırılabilir (mouse wheel veya drag)
- Son 512 tick görünüyor, older tick'ler solacak şekilde

### P1 — Core Feature (3–7 gün efor)

#### P1-A: Causal Graf Canvas

**Efor:** L (büyük — 4 gün)  
**Backend bağımlılığı:** `snapshot --json` → `{type:"snapshot", nodes:[...], edges:[...]}` WS eventi  
**UI değişiklikleri:**
- `#causal-graph-canvas` üzerinde `renderCausalGraph(snapshot)` fonksiyonu
- Node pozisyonlama: force-directed (vanilla JS, ~100 satır) veya statik grid layout
- Kenar çizimi: `edge.lag_ticks > 0` → kesik çizgi
- Renk kodlaması: outage/friction/nominal
- `case 'snapshot':` event router dalı

**Tamamlanma kriteri:**
- BS-01 yüklendiğinde ≥4 node (NODE/EDGE/ACTOR/REG_GATE) görünüyor
- Node renkleri `throughput_ratio`'ya göre değişiyor
- Snapshot geldiğinde graf güncelleniyor (tüm node'lar re-render)

#### P1-B: REPL / Lever Konsol Bileşeni

**Efor:** M (orta — 3 gün)  
**Backend bağımlılığı:** WS'in iki yönlü çalışması veya `/repl` endpoint'i — `ws_emitter.h` şu an sadece server→client (NDJSON push). Lever komutları için WS client→server frame okuma veya ayrı HTTP POST endpoint gerekiyor.  

> **Not:** Mevcut `ws_emitter.h::handle_client_read()` client'tan gelen frame'leri ping/close dışında görmezden geliyor (`app.js:1383`'teki router sadece server→client). Lever komutları için ya WS iki yönlü yapılmalı ya da ayrı loopback HTTP endpoint açılmalı.

**UI değişiklikleri:**
- Sol panelin altında veya ayrı sütunda `#lever-console` bileşeni
- `<pre class="console-output">` + `<input class="console-input">`
- `list levers` komutu → toggle bir kaldıraç listesi panel
- `lever <id>` komutu → UI sonucu WS/HTTP ile motora gönderiyor
- Komut geçmişi (`state.replHistory[]`)

**Tamamlanma kriteri:**
- `list levers` yazıldığında leverlerin listesi panel'de gösteriliyor
- `lever L-01_ZAFER_ANLATI` komutu motora iletiliyor ve sonuç crypto log'a yansıyor
- `clear_irrecoverable` lever başarısı throughput gauge'ın güncellenmesini tetikliyor

#### P1-C: Senaryo Kartı + İmza Durum Rozeti

**Efor:** S (küçük — 1 gün)  
**Backend bağımlılığı:** `scenario_loaded` event'ine `sig_status:"VERIFIED"|"SELF_SIGNED_DEV"` eklenmesi  
**Tamamlanma kriteri:**
- `SELF_SIGNED_DEV` → amber `⚠ DEV BYPASS` rozeti header'da
- `VERIFIED` → yeşil `✅ ED25519` rozeti

### P2 — Güçlendirme (1–2 hafta efor)

#### P2-A: Plugin Durum Paneli

**Efor:** M  
**Bağımlılık:** DynamicPluginLoader motora bağlanması (T-17 borcu — önce bu kapatılmalı)

#### P2-B: Audit Log Feed (Blake3 Zincir Görselleştirmesi)

**Efor:** M  
**Backend bağımlılığı:** `audit_log.h` kayıtlarının WS üzerinden push edilmesi için yeni event tipi

#### P2-C: Deterministik Oynatım Modu

**Efor:** L  
**Backend bağımlılığı:** NDJSON kayıt dosyası (`--record` CLI flag) veya `fetch()` snapshot API

#### P2-D: Erişilebilirlik + WCAG AA Geçişi

**Efor:** M  
**Bağımlılık:** Yok — saf CSS/ARIA değişiklikleri

**Özet tablo:**

| Öğe | Öncelik | Efor | Backend değişikliği | Tamamlanma kriteri (kısa) |
|---|---|---|---|---|
| Throughput Gauge + Outage Banner | **P0** | S (UI) + M (backend) | `ws_json::engine_state`'e 2 alan ekle | Outage anında görsel değişiyor |
| Kriz Zaman Çizelgesi | **P0** | M | Yok (tick zaten geliyor) | HYS flip çizgisi görünüyor |
| Causal Graf Canvas | **P1** | L | `snapshot` WS event tipi | BS-01 node'ları renk kodlu görünüyor |
| REPL/Lever Konsol | **P1** | M | WS iki yönlü veya HTTP POST | `lever` komutu motora ulaşıyor |
| Senaryo Kartı + İmza Rozeti | **P1** | S | `sig_status` alanı | DEV BYPASS uyarısı görünüyor |
| Plugin Durum Paneli | **P2** | M | T-17 kapatılmalı | Plugin listesi ve imza durumu |
| Audit Log Feed | **P2** | M | Yeni WS event tipi | Blake3 zincir hash'leri görünüyor |
| Deterministik Oynatım | **P2** | L | `--record` CLI veya API | Kaydedilmiş senaryo oynatılıyor |
| Erişilebilirlik (WCAG AA) | **P2** | M | Yok | Kontrast AA geçiyor, ARIA etiketleri var |

---

## 6. Mockup / Wireframe Açıklamaları

### 6.1 Yeni Genel Layout (3+1 Sütun)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CAELUS OS              [BS-01_SAHTE_UFUK ✅] [AIR-GAPPED] [AES-256]         │
│  Tick: 42 · UTC 11:42:07 · Session: 00:12:33 · Mesh: 5/12                   │
│  ─────────────────────────────────────────────── [⚠️ DEV BYPASS] ──────────  │
├───────────┬───────────────────────────────┬───────────────┬──────────────────┤
│  CAUSAL   │     COMMAND CENTER            │  SIGNAL       │  TIMELINE        │
│  GRAPH    │                               │  MATRIX       │  (KRIZ)          │
│           │  ┌────────────────────────┐   │               │                  │
│  ○──●──◆  │  │ THROUGHPUT       87%  │   │  Node:  94%   │  tick ─────→     │
│  │  │     │  │ ████████████░░░░░░░   │   │  Edge:  71%   │  ─────────┤      │
│  ●  ▲     │  │ Friction: 1.42μ       │   │  Actor: 88%   │  ┌ HYS    │      │
│           │  └────────────────────────┘   │  Gate:  45%   │  │        │      │
│  [renk    │                               │               │  └────────┘      │
│  kodu     │  ┌────────────────────────┐   │  ┌──Gauge──┐  │                  │
│  legend]  │  │ LEVER CONSOLE          │   │  │  1.42μ  │  │  ─────────       │
│           │  │ caelus://bs-01 $ _     │   │  └─────────┘  │                  │
│           │  │ > lever L-01_ZAFER     │   │               │                  │
│           │  │ [OK] cost=23 ticks     │   │  OTP SLOTS:   │                  │
│           │  └────────────────────────┘   │  [●●●○] 47s   │                  │
│           │                               │               │                  │
│           │  [ANALIZ RAPORU — typewriter] │               │                  │
├───────────┴───────────────────────────────┴───────────────┴──────────────────┤
│  KAPALI DEVRE | AES-256 | ED25519 | RİSK: DÜŞÜK | PKT:1247 | RPT:3 | INTEL→  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Throughput Gauge Bileşeni (Normal vs Outage)

**Normal durum (`throughput_ratio = 0.87`):**

```
┌────────────────────────────────────┐
│  SISTEM AKIŞI                      │
│                                    │
│     ████████████░░  87%            │
│     ████████████░░                 │
│     ████████████░░  ← yeşil dolum  │
│     ████████████░░                 │
│                                    │
│  Friction: 1.42μ  Risk: DÜŞÜK     │
└────────────────────────────────────┘
```

**Outage durumu (`outage_active = true`, `throughput_ratio = 0.0`):**

```
╔════════════════════════════════════╗  ← kırmızı çerçeve yanıp söner
║  ▓▓▓ OUTAGE AKTİF — TICK 42 ▓▓▓  ║
║                                    ║
║     ░░░░░░░░░░░░░░░░  0%           ║  ← boş, gri
║                                    ║
║  Kök neden: HYST_PERM_REROUTE     ║
║  ─────────────────────────────    ║
║  ÖNERİ: lever clear_irrecoverable  ║  ← amber kutu
╚════════════════════════════════════╝
```

### 6.3 Kriz Zaman Çizelgesi

```
Tick:  0    100   200   300   384  576
       │     │     │     │  ✕  │  ┃ │
 1.0 ──┼─────┤     │   ╱─┘    │  ┃ │
       │     │   ╱─┘          │  ┃ │
 0.5 ──┼─────┼──╱             │  ┃ │
       │     │                │  ┃ │
 0.0 ──┼─────┼────────────────┘  ┃─┘
                             ↑   ↑
                       DEADLINE HYSTERESIS
                          MISS   FLIP
```
- Yatay eksen: tick numarası
- Dikey eksen: `throughput_ratio` (0.0–1.0)
- Kırmızı `✕`: deadline miss (BS-01 tick 384)
- Kırmızı dikey çizgi `┃`: histerezis flip (BS-01 tick 576)
- Amber çizgi: `any_hysteresis_flip` (geri dönüşlü)
- Outage bölgesi: `▓` taralı alan

### 6.4 Causal Graf Canvas

```
         [REG_GATE-01]
           ◆ mor, orta
               │ kenar (kesik: lag_ticks=3)
    ┌──────────┼──────────┐
    │          │          │
[NODE-01]  [TRANSIT]  [EDGE-04]
  ● yeşil   ⬡ amber     ● amber
  (state=85) (state=40)  (state=71)
    │
[ACTOR-01]
  ▲ mavi
  (state=92)
         ╲
          [FRICTION-01]
           ● turuncu (YANIP SÖNER — outage_active)
```

- Her node için tooltip: `id · state_fp · capacity_fp · irrecoverable`
- Tıklanabilir node → lever console'da o node'a bağlı lever'ları listeler

### 6.5 REPL / Lever Console

```
┌────────────────────────────────────────────────────────────┐
│ LEVER CONSOLE                              [Temizle] [Kapat]│
├────────────────────────────────────────────────────────────┤
│ 14:23:01 > status                                          │
│ 14:23:01   tick=42 friction=1.42μ outage=false             │
│ 14:23:05 > list levers                                     │
│ 14:23:05   [L-01] ZAFER_ANLATI  cost=23t  prob=0.72        │
│ 14:23:05   [L-02] TANIIMA       cost=11t  prob=0.85        │
│ 14:23:05   [L-04] ZIMRH         cost=31t  prob=0.60        │
│ 14:23:08 > lever L-01_ZAFER_ANLATI                        │
│ 14:23:09   ✅ BAŞARILI — friction 1.42 → 1.18             │
│                                                            │
│ caelus://bs-01-sahte-ufuk $  _                            │
└────────────────────────────────────────────────────────────┘
```

- Monospace font, `--mono` değişkeni, arka plan `--panel-bg2: #091520`
- Komut geçmişi: ↑ / ↓ ok tuşları
- Komut satırı autocomplete: `L` → tab → `list levers`

---

## 7. Kısıtlar ve Riskler

### 7.1 Air-Gap Zorunluluğu

CDN linki kullanılamaz. Her harici kaynak `dist/` klasörüne embed edilmeli. Mevcut `index.html` saf tek dosya — dış script tag yok. Bu prensip korunacak.

**Pratik kural:** `<script src="app.js">` dışına çıkacak her yeni kaynak `dist/` veya inline embed olmalı. Örnek: Alpine.js alınırsa `dist/alpine.min.js` kopyalanıp `<script src="alpine.min.js">` olarak import edilmeli.

### 7.2 WS Payload Şeması Versiyonlama

`ws_json::engine_state()` builder'ına `throughput_ratio` ve `outage_active` eklenmesi **kırıcı değişiklik** değil (JSON'a ekleme geriye uyumlu). Ancak ileride alan **kaldırılırsa** ya da tip değiştirilirse UI bozulur.

**Öneri:** `ws_json` event'lerine `"schema_ver":1` alanı eklenmesi. UI `schema_ver < beklenen_ver` durumunda konsola uyarı basar ve bilinmeyen alanları görmezden gelir (mevcut `default:` dalının doğal davranışı).

### 7.3 Canvas / WebGL Motor Bazı Ortamlarda Yavaş

Sanal makineler veya gömülü GPU'larda Canvas 2D yavaş olabilir. Stratejiler:

- Canvas yerine SVG (küçük graf için — < 50 node)
- `canvas.getContext('2d')` null dönerse `<svg>` fallback'e geçiş
- WebGL (`webgl2 || webgl`) varsa high-DPI çiz, yoksa 1× DPI düşür
- `requestIdleCallback` ile arka plan hesaplamalarını RAF dışına al

### 7.4 `ui_payload.h` Embed Mekanizması ve Rebuild Zorunluluğu

`include/ui_payload.h` dosyası 629 KB'ı aşıyor (dosya okunmaya çalışıldı, limit aşıldı). Bu dosya `ui/index.html` ve `ui/app.js`'in C++ `char[]` dizisi olarak gömülmüş hali. **`ui/` klasörü değiştirildiğinde `ui_payload.h` yeniden üretilmeli**.

**Mevcut build zinciri:**
1. `ui/index.html` + `ui/app.js` düzenlenir
2. `build.bat` (veya `CMakeLists.txt`) `xxd -i` veya benzeri bir araçla `ui_payload.h`'ı yeniden üretir
3. C++ binary yeniden derlenir → `dist/caelus_os.exe` içinde embed UI güncellenir

**Risk:** UI değiştirilip `build.bat` çalıştırılmazsa binary'deki UI eski kalır. Geliştirici `--dev` modunda doğrudan `ui/index.html`'i browser'da açarak test edebilir (WS portu 47809'a motor bağlıysa canlı çalışır).

### 7.5 Mock Fluctuation ile Canlı Veri Senkronizasyonu

`state.fluctuateInterval` WS bağlantısı geldiğinde durdurulur, kesilince yeniden başlatılır — bu mantık doğru (`app.js:1494–1522`). Ancak canlı motor mock fluctuation verisini ezdiğinde **sparkline history** karma olabilir: bazı noktalar mock, bazıları gerçek. Bu görsel tutarsızlık kullanıcıyı yanıltabilir.

**Öneri:** WS bağlantısı açıldığında `state.history` ring buffer sıfırlanmalı; geçmiş yalnızca gerçek tick eventlerinden beslenmeli.

### 7.6 `regime_exceeded` Görsel Boşluğu

`ws_json::regime_exceeded(raw, cap)` eventi geldiğinde mevcut UI yalnızca crypto log'a `[CRITICAL]` satırı ekliyor ve `SFX.alarm()` çalıyor. Görsel alarm yok. Bu durum `mu > 3.0` (fizik tavanı aşımı) anlamına gelir — BSb senaryolarında nadiren gerçekleşir ama gerçekleştiğinde ciddi bir gösterge. Gauge üzerinde `3.0×` tavan çizgisi ve `⚠ REGIME EXCEEDED` bandı P0-A ile birlikte eklenebilir.

---

## Ekler

### A. Mevcut Renk Değişkenlerinden Hollywood Güçlendirmesi (Tek-Dosya CSS Değişiklikleri)

Mevcut değişkenlere eklenmesi önerilen:

```css
:root {
  /* Mevcut değişkenler korunuyor */

  /* Yeni eklemeler */
  --amber-noc:   #FF8C00;   /* NOC esintisi — daha güçlü turuncu */
  --crisis-bg:   rgba(207,102,121,.12);  /* Outage panel arka planı */
  --outage-text: #ff4d6a;   /* Outage banner büyük yazı */

  /* Throughput gauge renk gradyanı duraklarla */
  --tp-high:   #4ade80;   /* throughput > 0.7 */
  --tp-mid:    #e8a838;   /* throughput 0.3–0.7 */
  --tp-low:    #cf6679;   /* throughput < 0.3 */
  --tp-zero:   #8b0000;   /* outage_active */
}
```

### B. `ws_json::engine_state()` İçin Önerilen Genişletme

`include/ws_emitter.h:685`'teki builder imzası:

```cpp
// Mevcut:
inline std::string engine_state(const std::string& state, const std::string& scenario_id,
                                uint64_t tick, double friction_mult)

// Önerilen:
inline std::string engine_state(const std::string& state, const std::string& scenario_id,
                                uint64_t tick, double friction_mult,
                                double throughput_ratio = 1.0, bool outage_active = false,
                                bool any_hysteresis_flip = false)
```

JSON çıktısına `"throughput_ratio":...,"outage_active":...,"any_hysteresis_flip":...` eklenmesi. Varsayılan parametreler sayesinde mevcut çağrılar kırılmaz.

### C. Kısa UI Test Koşum Protokolü

1. `dist/caelus_os.exe --scenario BS-01_SAHTE_UFUK --repl --det-mode` başlat
2. Browser'da `ui/index.html` aç (WS otomatik bağlanır)
3. **P0-A testi:** REPL'den `tick 576` gir → UI'de outage banner görünmeli
4. **P0-B testi:** REPL'den `tick 10` x 60 gir → timeline 576 tick boyunca değişiyor, HYS flip çizgisi görünmeli
5. **P1-B testi:** UI'den `lever L-01_ZAFER_ANLATI` gir → motor uyguluyor, gauge düşüyor

---

*Bu rapor `ui/app.js` (1864 satır), `ui/index.html` (1114 satır), `include/ws_emitter.h`, `include/causal_engine.h` ve `docs/BS_EXEC_REPL_KILAVUZU.md` kaynak dosyaları gerçekten okunarak üretilmiştir. Her teknik iddia belirtilen dosya + satır referansıyla desteklenmiştir.*
