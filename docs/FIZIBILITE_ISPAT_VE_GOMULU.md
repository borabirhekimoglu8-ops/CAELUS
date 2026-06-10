# CAELUS OS — Fizibilite Raporu: Formal İspat (Verus) + `caelus_core` no_std Ayrıştırması

**Tarih:** 2026-06-10
**Rapor türü:** Fizibilite + tasarım + fazlı yol haritası (uygulama değil — bu raporda üretim kodu yazılmamıştır)
**Kapsam:** İki paralel hat: **(A)** nedensel çekirdeğin matematiksel ispatı (Verus/Z3, destek olarak Kani ve Dafny), **(B)** çekirdeğin `#![no_std]` Rust crate'i olarak ayrıştırılıp mikrodenetleyiciye (Cortex-M) gömülmesi (probe-rs ile flash).
**Dayanak:** `include/causal_engine.h` (sabit nokta yardımcıları :55-167, durum makinesi :820-892, lever :505-547), `include/det_rng.h`, `src/audit_log.rs`, `src/network/mesh_auth.rs`, `Cargo.toml`, `scenarios/BS-0{1,2,3}.json`, `docs/CAELUS_PROJE_RAPORU.md`
**Karar arka planı:** Önerilen "Dafny → LLVM IR → AI-assembly → bare-metal" hattının revizyonudur. LLVM IR + elle/AI assembly adımı **bilinçli olarak çıkarılmıştır** (ispat zincirini kırar, teknik köprüsü yoktur, performans kazancı da yoktur — rustc'nin kendi LLVM arka ucu ispatı bozmadan aynı işi yapar).

---

## 1. Yönetici Özeti

**Hüküm: İki hat da fizibildir ve birbirini besler; toplam riski düşük tutan şey, projenin zaten sahip olduğu iki özelliktir: float'sız sabit-nokta aritmetik ve bit-bit determinizm.**

- **İspat hattı (A):** Motorun en kritik 8 invariantı (taşma güvenliği, latch durum makinesi, histerezis geri-döndürülemezliği, aralık korunumu) Z3-tabanlı araçlarla makine-denetimli ispata uygundur. En zor parça doğrusal-olmayan aritmetik (`fp_mul_div_u64_sat`) ispatıdır; bunun için strateji bölüm 4.3'te verilmiştir. Tahmini toplam efor: **6–10 kişi-hafta** (öğrenme eğrisi dahil).
- **Gömülü hat (B):** Çekirdek (motor + sabit nokta + DetRng + audit zincirleme mantığı + kripto) `no_std`'ye taşınabilir; kripto bağımlılıklarının tamamı (`ed25519-dalek`, `blake3`, `subtle`, `zeroize`) `no_std` destekler. MCU'ya **taşınamayan** katman (UI, WS, plugin loader, MQTT/Zapier, DPAPI, UDP keşif) zaten mimari olarak ayrıdır. Hedef donanım: radyosuz Cortex-M7 (STM32H7 sınıfı). Tahmini efor: **8–12 kişi-hafta**.
- **Killer demo (iki hattın kesişimi):** Aynı imzalı senaryo + aynı seed ile x86 masaüstü ve ARM Cortex-M7 üzerinde koşan motorların **aynı snapshot SHA-256'sını üretmesi**. Bu, "platformdan bağımsız tam determinizm" iddiasının fiziksel kanıtıdır ve mevcut golden test altyapısı bunu ölçmeye hazırdır.

**En kritik mimari karar (Bölüm 5.2):** Motor şu an C++'ta yaşıyor. Gömülü hat motoru Rust'a taşımayı gerektirir; bu noktada iki seçenek var — (a) çift motor (C++ masaüstü + Rust MCU) ve aralarında diferansiyel test, (b) tek Rust çekirdeğe geçiş ve C++'ın yalnız orkestrasyon kabuğu olarak kalması. Rapor (b)'yi **nihai hedef**, (a)'yı **geçiş aşaması** olarak önerir.

---

## 2. Neden Bu Proje Formal İspata Uygun? (Kanıt-Temelli)

Formal doğrulama projelerinin çoğu şu üç engelde ölür: float belirsizliği, sınırsız heap/pointer karmaşası, dış dünya (I/O) bağımlılığı. CAELUS çekirdeğinde üçü de yok:

| Engel | CAELUS'taki durum | Kanıt |
|---|---|---|
| Float / IEEE 754 | Yok — tüm motor `int64_t × 1e6` sabit nokta | `causal_engine.h:52` (`FP_SCALE`), başlık yorumu :21-25 |
| Kontrolsüz bellek | Motor durumu sınırlı vektörler + POD struct'lar; özyineleme yok | `Node/Edge/FeedbackLoop` tanımları :196-255 |
| I/O bağımlılığı | `tick()` saf durum dönüşümü; log makroları derleme-kapalı | `tick()` :480-487, `caelus_logger.h` (varsayılan kapalı) |
| Nondeterminizm | Tek RNG kaynağı `DetRng` (saf fonksiyon, tohumlu) | `det_rng.h`, `apply_lever` :512-515 |

Ayrıca projenin **T-20 vakası**, ispatın getirisini somutlaştıran yaşanmış bir örnektir: "outage yalnız latch edilir, yan etkiyle silinemez" invariantı bir sürüm boyunca ihlal edildi (atama outage'ı sıfırlıyordu), v5 dalgasında elle bulunup düzeltildi. Bu invariant makine-denetimli olsaydı ihlal **derleme anında** kırmızı yanardı. İspat hattının değer önerisi tam olarak budur.

---

## 3. Araç Seçimi — Gerçeklik Kontrolü

| Araç | Rol | Neden / Sınırlar |
|---|---|---|
| **Verus** (Z3 üstü, Rust sözdizimi) | **Ana üretim ispat aracı** | İspat doğrudan Rust kaynağının üzerine yazılır; ispat kodu derlemede silinir (sıfır çalışma maliyeti); `no_std` sistem koduna uygundur (doğrulanmış OS bileşenlerinde kullanılıyor). Sınır: Rust'ın alt kümesi (trait/closure desteği kısmi), öğrenme eğrisi var. |
| **Kani** (AWS, CBMC model checker) | **Hızlı kazanım aracı** | Mevcut Rust koduna `#[kani::proof]` harness'ı eklemek yeterli — şartname dili öğrenmeden bit-kesin kontrol. Sınır: 64×64 bit çarpma bit-blasting'i yavaş olabilir; sınırlı (bounded) doğrulamadır, evrensel kanıt değildir. Strateji: P-1/P-4..P-8 için ilk savunma hattı, P-2 için yalnız duman testi. |
| **Dafny + Z3** | **Şartname/keşif kum havuzu (opsiyonel)** | Durum makinesi şartnamesini hızlı prototiplemek için iyi; VS Code/Cursor eklentisi mevcut. Sınır: LLVM IR **üretmez**; backend'leri C#/Go/Py/Java/JS (+deneysel Rust). Üretim koduna köprüsü zayıf — bu yüzden yalnız tasarım aşaması aracı. |
| **Z3** | Her üçünün arka planındaki SMT çözücü | Ayrıca kurulum gerekmez; Verus/Dafny paketiyle gelir. |
| ~~LLVM IR + AI assembly~~ | **ÇIKARILDI** | İspat zincirini kırar; doğrulanamaz çıktı üretir; rustc zaten LLVM ile derler. |

**Cursor/VS Code entegrasyonu:** Verus için `verus-analyzer`, Dafny için resmî eklenti mevcut; her ikisi de "satırı anında kırmızıya boyama" deneyimini verir. Kani `cargo kani` ile CI'a girer.

---

## 4. Hat A — İspat Hedefleri Kataloğu

Aşağıdaki hedefler mevcut C++ kaynağından satır referanslı çıkarılmıştır; ispatlar, Bölüm 5'teki Rust portu üzerinde yazılacaktır (C++ tarafında eşdeğerlik diferansiyel testle korunur).

### 4.1 Sabit Nokta Aritmetiği (saflık: yüksek, değer: kritik)

| # | İspat hedefi | Kaynak | Şartname (gayriresmî) | Araç | Efor |
|---|---|---|---|---|---|
| **P-1** | `fp_add_saturating` doğruluğu | `causal_engine.h:121-125` | `sonuç = clamp(a+b, I64_MIN, I64_MAX)`; asla UB/taşma yok | Kani → Verus | S |
| **P-2** | `fp_mul_div_u64_sat` doğruluğu | `:76-107` | `sonuç = min(cap, ⌊a·b/divisor⌋)`; ara değer `a·b` **hiç oluşturulmadan**; döngü invariantı: `result_q·divisor + result_r + (kalan b)·(add_q·divisor + add_r) = işlenen kısım` | **Verus** (nonlinear) | **L** |
| **P-3** | `fp_mul`/`fp_div` işaret-büyüklük kompozisyonu; `fp_div(x,0)=0` totalliği | `:127-151` | İşaret kuralı + büyüklük P-2'ye indirgenir; negatif tavan `I64_MIN_MAG` doğru | Verus | M |
| **P-4** | `fp_clamp` ve aralık lemmaları | `:152-154` | `lo ≤ sonuç ≤ hi` (lo≤hi ön koşuluyla) | Kani | S |

**P-2 stratejisi (raporun en zor ispatı):** Bu fonksiyon shift-add uzun çarpma + kalan takibi yapar — SMT çözücülerin zayıf olduğu doğrusal-olmayan tamsayı aritmetiği alanı. Önerilen yol: (1) döngü invariantını yukarıdaki cebirsel eşitlik olarak yaz, (2) doğrusal-olmayan adımları Verus'un `nonlinear_arith` modunda **küçük yardımcı lemmalara** izole et (`vstd`'nin `mul` lemmaları), (3) Kani ile 16-bit daraltılmış modelde duman testi yap (tam u64 yerine u16 üzerinde bounded eşdeğerlik — mantık hatasını ucuz yakalar). Bu üçlü yaklaşım, "Z3 timeout cehennemi" riskini yönetilebilir kılar.

### 4.2 Motor Durum Makinesi (değer: en yüksek — T-20'nin kalıcı mezarı)

| # | İspat hedefi | Kaynak | Şartname (gayriresmî) | Efor |
|---|---|---|---|---|
| **P-5** | **Outage latch teoremi** | `:882-892`, `:846`, `:875`, `:528-530` | Sistem invariantı: `outage_` alanına `false` yazan **tek** program noktası `clear_outage_recovery()`'dir; o da yalnız `apply_lever` içinde `success ∧ outcome.clear_irrecoverable` dalından erişilebilir. `check_hysteresis`/`check_deadlines`/`tick` hiçbir yürütmede outage'ı temizleyemez. | M |
| **P-6** | **Histerezis tek-atımlılığı** | `:839-858` | `h.flipped` true olduktan sonra sonsuza dek true kalır (reset hariç); `reversible:false` flip'i ⇒ aynı tick'te `outage_=true` ∧ `permanent_friction` artmış (doygun toplamayla). | S–M |
| **P-7** | **Aralık korunumu** | `:520-524`, `:556-564` | Her tick ve her lever sonrası: `0 ≤ state_fp ≤ capacity_fp`, `0 ≤ trust_fp ≤ FP_ONE`, `clamped_friction ∈ [1.0, 3.0]` (fp). | M |
| **P-8** | **Regime monotonluğu** | `:820-830` | `regime_exceeded_` true olduktan sonra yalnız `reset()` ile temizlenir. | S |
| **P-9** | **DetRng determinizmi** | `det_rng.h` | Aynı seed ⇒ aynı dizi (saf fonksiyon — Verus'ta `fn` saflığıyla bedavaya yakın); `fill(out,n)` tam n bayt yazar. | S |

**Dürüst nüans (P-6 üzerine):** `permanent_friction_fp_` **monoton artan değildir** — `apply_lever` `outcome.friction_delta_fp < 0` ile onu düşürebilir (`:531-535`, alt sınır `-FP_ONE`). Doğru invariant "monotonluk" değil, şudur: *permanent friction yalnız iki program noktasında değişir (non-reversible flip: artı yönlü doygun ekleme; lever outcome: `[-1.0, 3.0]` kelepçeli delta)*. Şartname bu gerçeğe göre yazılmalı; aksi hâlde ispat denemesi sahte bir "bug" raporlar.

### 4.3 Uzatma Hedefleri (ikinci dalga)

| # | Hedef | Not |
|---|---|---|
| P-10 | Audit zincirleme mantığı: `seq` kesin artan, her satır `prev = önceki.hash`, SEAL'den sonra append yok | Blake3'ün kendisi ispatlanmaz (güvenilen taban); **zincirleme protokolü** ispatlanır. `src/audit_log.rs` zaten Rust — port gerekmez. |
| P-11 | El sıkışma durum makinesi: faz sırası, nonce tazeliği, "slot claim doğrulanamazsa oturum anahtarı türetilmez" | `mesh_auth.rs` üzerinde; kripto ilkel güvenilen taban, protokol akışı ispat hedefi. |
| P-12 | Gömülü senaryo formatı ayrıştırıcısı: panik-özgürlük + sınır güvenliği | JSON yerine MCU'daki ikili format (Bölüm 5.4) üzerinde — çok daha küçük ispat yüzeyi. |

### 4.4 Hat A Kabul Kriterleri

1. `cargo verus verify` (P-1…P-9) CI'da yeşil; ispat kodu üretim binary'sine **sıfır bayt** ekliyor (erasure doğrulanır).
2. `cargo kani` harness'ları ci.bat'a 7. adım olarak eklenmiş.
3. Bilinçli mutasyon testi: `latch_outage` çağrısı kasıtlı silindiğinde **ispat kırılıyor** (T-20 regresyonunun makine-denetimli olduğunun kanıtı).

---

## 5. Hat B — `caelus_core` no_std Ayrıştırması

### 5.1 Hedef mimari

```
┌────────────────────────────── caelus_core (no_std + alloc) ─────────────────────────────┐
│  fp aritmetiği (P-1..P-4 ispatlı) · CausalEngine (P-5..P-8 ispatlı) · DetRng            │
│  senaryo veri modeli (Node/Edge/Loop/Lever/Hysteresis) · audit zincirleme (P-10)        │
│  imza doğrulama çekirdeği (ed25519 verify + pinli çapa sabiti)                          │
└──────────────┬───────────────────────────────────────────────┬──────────────────────────┘
               │                                               │
   ┌───────────▼─────────────┐                     ┌───────────▼──────────────┐
   │  MASAÜSTÜ (std)         │                     │  MCU FIRMWARE (no_std)   │
   │  mevcut caelus_network  │                     │  caelus_edge             │
   │  + C++ kabuk: UI, WS,   │                     │  UART konsol/REPL        │
   │  plugin SDK, MQTT,      │                     │  ikili imzalı senaryo    │
   │  DPAPI, UDP keşif       │                     │  TRNG + secure element   │
   │  (değişmeden kalır)     │                     │  audit → harici flash    │
   └─────────────────────────┘                     └──────────────────────────┘
```

### 5.2 Kritik mimari karar: motor kimde yaşayacak?

Motor bugün C++ başlığında (`causal_engine.h`, 820 satır). MCU hattı Rust portunu zorunlu kılar. İki seçenek:

| | (a) Çift motor (geçiş) | (b) Tek Rust çekirdek (nihai) |
|---|---|---|
| Yapı | C++ motor masaüstünde kalır; Rust portu yalnız MCU'da | C++ motor emekli edilir; masaüstü binary de FFI ile `caelus_core`'u çağırır |
| Artı | Masaüstü hattı hiç risk almaz; hemen başlanır | Tek gerçeklik kaynağı; ispat **her iki platformu** kapsar; T-20 benzeri sapma sınıfı kökten ölür |
| Eksi | İki motorun bit-bit eş tutulması sürekli iş | Geçiş eforunda tepe; C++ kabuk-FFI yüzeyi genişler |
| Sapma koruması | **Diferansiyel golden:** aynı senaryo+seed → iki motorun snapshot SHA-256'sı eşit olmak zorunda (mevcut `run_bs_exec_golden.py` altyapısı genişletilir) | Gerekmez |

**Öneri:** F1–F3 fazları (a) ile yürür (diferansiyel golden zorunlu CI adımı olarak), F5'te (b)'ye geçilir. Determinizm sayesinde diferansiyel test **ucuz ve kesindir** — bu, çoğu projede lüks olan bir geçiş güvencesidir.

### 5.3 Bağımlılık denetimi (no_std uygunluğu)

| Bağımlılık | no_std? | Not |
|---|---|---|
| `ed25519-dalek` | ✅ (`default-features=false`) | İmza doğrulama M7'de ~ms mertebesi — senaryo yüklemede bir kez, sorun değil |
| `x25519-dalek` | ✅ | Mesh MCU'da ilk fazda kapsam dışı; crate yine de uyumlu |
| `blake3` | ✅ (`default-features=false`) | SIMD kapalı, saf Rust yolu; audit zinciri için yeterli hız |
| `subtle`, `zeroize` | ✅ | — |
| `rand` / `getrandom` | ⚠ | Bare-metal'de OS entropisi yok → MCU TRNG çevre birimi `rand_core` backend'i olarak kaydedilir; **DetRng zaten OS'siz** |
| `std::{fs,net,thread,Mutex}` | ❌ | Zaten çekirdek dışı: dosya I/O (audit yazıcı), UDP (discovery), thread (beacon döngüsü) masaüstü katmanında kalır; çekirdek `LogSink`/`Clock` trait'leriyle soyutlanır |

Çekirdek `alloc` kullanır (Vec/String karşılıkları); MCU'da sabit-kapasiteli havuz allocator'ı veya `heapless` ile sınırlandırılır. Düğüm kimlikleri için `String` yerine sınırlı `[u8; N]`/intern edilmiş indeks önerilir (mevcut senaryolarda ≤ 16 düğüm, id'ler ≤ 24 bayt — `scenarios/*.json` ölçümü).

### 5.4 Senaryo formatı: MCU'da JSON yok

Masaüstündeki 965 satırlık JSON ayrıştırıcısını MCU'ya taşımak hem bellek hem ispat yüzeyi israfıdır. Öneri:

- Masaüstü araç zinciri (mevcut signer CLI genişletilerek) JSON paketi **kanonik ikili forma** (postcard/CBOR benzeri, sabit şema) derler ve **ikili formun üzerine** ed25519 imzar.
- MCU yalnız ikili formu ayrıştırır (P-12 ispat hedefi: panik-özgür, sınır-güvenli, ~150 satır).
- Pinli güven çapası (`CAELUS_TRUSTED_PUBKEY`) firmware'e sabit gömülür — mevcut anahtar töreni prosedürü (`scenario_pack.h:728-746`) aynen geçerlidir.

### 5.5 Donanım seçimi

| Aday | RAM/Flash | Artı | Eksi |
|---|---|---|---|
| **STM32H743 (Nucleo-H743ZI)** — **önerilen** | 1 MB / 2 MB, 480 MHz M7 | Radyo yok (air-gap doğal), bol RAM, dahili ST-Link → probe-rs doğrudan; FPU'ya ihtiyaç yok (motor tamsayı) | TrustZone yok → anahtar için harici secure element |
| STM32U585 | 786 KB / 2 MB, M33+TrustZone | Anahtar saklama on-chip (TZ + HUK) | Daha az RAM; TZ yapılandırma eforu |
| RP2350 | 520 KB, dual M33 | Ucuz, probe-rs birinci sınıf | Kimlik/koruma altyapısı zayıf |
| ~~ESP32 ailesi~~ | — | — | **Elenmiştir:** entegre radyo air-gap felsefesiyle çelişir |

Kimlik tohumu için: ATECC608B secure element (I²C) **veya** STM32 RDP Level 2 + flash'ta şifreli blob. Üretim cihazında debug portu kalıcı kapatılır (RDP2 — **geri dönüşsüz**, yalnız üretim hattında uygulanır).

### 5.6 MCU bellek bütçesi (kaba hesap)

| Kalem | Tahmin |
|---|---|
| Motor durumu (16 düğüm, kenarlar, histerezis, lever) | < 8 KB RAM |
| İkili senaryo paketi (BS-01 JSON 9 KB → ikili ~4-6 KB) | < 8 KB flash/RAM |
| ed25519-dalek + blake3 kod | ~120–200 KB flash |
| Audit tamponu (harici flash'a taşmadan önce) | 16–64 KB RAM halkası |
| **Toplam** | M7'nin 1 MB RAM / 2 MB flash bütçesinde rahat; M4 sınıfı bile mümkün |

---

## 6. Fazlı Yol Haritası

| Faz | İçerik | Kabul kriteri | Efor |
|---|---|---|---|
| **F0 — Diferansiyel temel** ✅ **TAMAMLANDI (2026-06-10)** | Golden refresh (T-25) + golden runner'ın "iki motor karşılaştırma" moduna genişletilmesi. *Gerçekleşen:* binary yeniden derlendi (~2,6 MB), `run_bs_exec_golden.py`'ye `--refresh` modu eklendi, latched beklentiler + yeni hash'ler işlendi, SIGNED-CI'a geçildi (dev bypass kaldırıldı; SIG-CI bozuk-imza fixture'ı `tests/make_negative_scenario.py`), ci.bat 6/6 yeşil. `--binary` parametresi diferansiyel karşılaştırmanın giriş noktası. | Güncel binary ile 3 senaryo golden yeşil ✅; harness çift-motor karşılaştırmaya hazır ✅ | 1 hafta |
| **F1 — `caelus_core` çıkarımı** ✅ **TAMAMLANDI (2026-06-10)** | Motorun Rust'a portu (`no_std + alloc`), fp yardımcıları, DetRng, veri modeli; host'ta `cargo test`. *Gerçekleşen:* bağımsız `caelus_core/` crate'i (mevcut build'e dokunmadan): `fp.rs` (i128-referanslı testlerle), `det_rng.rs` (golden `det_roll_fp` değerleri çapraz-implementasyon vektörü olarak), `engine.rs` (latched outage + tüm sadakat notları), `caelus_core_repl` diferansiyel harness (aynı CLI + aynı `[REPL_JSON]` formatı), 12 birim test. ci.bat Adım 7/7 olarak kalıcı diferansiyel golden eklendi. | Rust motor, 3 BS senaryosunda C++ motorla **aynı snapshot hash'lerini** üretiyor ✅ (İLK koşumda hash-eşit; lever/DetRng yolu dahil REPL_JSON satırları bit-bit aynı) | 3–4 hafta |
| **F2 — İspat dalgası 1** ✅ **TAMAMLANDI (2026-06-10, revize kapsamla)** | Kani harness'ları (P-1, P-4, P-7, P-8) + Verus kurulumu + P-5/P-6 latch/histerezis ispatları. *Gerçekleşen:* **(a)** Verus 0.2026.06.07 + Rust 1.95.0 `tools/verus/` altına kuruldu; `caelus_core/verify/fp_proofs.rs` ile ilk **4 makine-denetimli Z3 ispatı** (P-1 tam sözleşme, P-4 tam sözleşme + idempotans, aralık-korunum çekirdek adımı) — ci.bat Adım 7'ye bağlı (araç yoksa atlar), prover sahte `ensures false` ile negatif-test edildi. **(b)** Kani Windows'ta desteklenmediğinden (WSL yok) rolünü `tests/narrowed_model.rs` daraltılmış-alan TÜKETİCİ taramaları üstlendi (B=6 varsayılan, B=8 release ~150M vaka) ve **iki kesin ön koşul KEŞFETTİ**: `divisor ≤ 2^(W-1) ∧ a/divisor ≤ cap ⇒ kesinlik` (her durumda `sonuç ≤ cap` güvenliği); köşeler testle kilitlendi, sözleşme `fp.rs`'e işlendi. **(c)** P-5..P-8 için `tests/invariant_sweep.rs`: 24 rastgele graf × 300 komut, 7 invariant her adımda; hedefli "latch lever'sız temizlenemez" süpürmesi. | `verus verify` CI'da ✅; P-2'nin döngü invariantı + ön koşulları artık kesin biçimde belgeli (ispat dalgası 2'ye hazır zemin) | 2–3 hafta |
| **F3 — MCU bring-up** | Nucleo-H743 + probe-rs; UART REPL (`tick/snapshot/lever`); ikili senaryo formatı + imza doğrulama | **Çapraz mimari determinizm demosu:** BS-01, seed sabit → ARM ve x86 snapshot SHA-256 **eşit** | 2–3 hafta |
| **F4 — İspat dalgası 2** ◑ **KISMEN TAMAMLANDI (2026-06-10 gece)** | P-2/P-3 (nonlinear aritmetik), P-10 (audit zinciri), P-12 (ikili parser). *Gerçekleşen:* **P-2a evrensel güvenlik** (`verify/mul_div_safety.rs`): `fp_mul_div_u64_sat ≤ cap` TAM u64 genişliğinde, ön koşulsuz, makine-denetimli (`result_q < cap` döngü invariantı + bit-vector decreases lemması — 5 verified). **P-5a/P-5b latch iz teoremleri** (`verify/latch_machine.rs`): "outage'ın temizlenmesi ⟺ LeverSuccessClear olayı" her uzunlukta olay dizisi için indüktif Seq ispatı (5 verified); motor bağlaması invariant_sweep I-2 + tek `clear_outage_recovery` çağrı yeri. *Kalan:* P-2b tam-u64 kesinliği (nonlinear, ön koşullar artık kesin), P-3, P-10, P-12. | ◑ 14 verified, 0 errors (3 dosya); kalan katalog işaretli | 3–4 hafta |
| **F5 — Konsolidasyon** | Masaüstünün `caelus_core`'a geçişi (karar 5.2-b), C++ motorun emekliliği; MCU'da secure element + RDP prosedürü | Tek motor; tam CI (8 adım); üretim flash prosedürü belgeli | 3–4 hafta |

Fazlar F2∥F3 paralel yürüyebilir (farklı uzmanlık). Kritik yol: F0 → F1 → F3.

---

## 7. Risk Kaydı

| # | Risk | Olasılık | Etki | Azaltma |
|---|---|---|---|---|
| R-1 | P-2 nonlinear ispatı Z3'te timeout cehennemine girer | ~~Orta-Yüksek~~ **Düşürüldü (F2)** | İspat takvimi | Daraltılmış-model taraması teoremin KESİN biçimini buldu (iki ön koşul + güvenlik/kesinlik ayrımı) ve B=8'e kadar tüketici doğruladı; Verus dalga-2 artık bilinen invariantla başlayacak. Kalıntı: tam u64 evrenselliği hâlâ nonlinear lemma ister |
| R-2 | Çift motor sapması (F1–F4 arası) | Orta | Determinizm iddiası | Diferansiyel golden CI'da zorunlu; sapma = kırmızı |
| R-3 | Rust portunda semantik kayma (C++ UB köşeleri, işaret dönüşümleri) | Orta | Sessiz davranış farkı | Port sırasında P-7 aralık invariantları önce yazılır; fark diferansiyelde yakalanır |
| R-4 | `String`/heap kullanımının MCU'da fragmentasyonu | Düşük | Kararlılık | Sabit havuz allocator + `heapless`; düğüm id'leri indeksleme |
| R-5 | Verus öğrenme eğrisi ekibi yavaşlatır | Orta | Takvim | Kani-önce stratejisi erken değer üretir; Verus yalnız çekirdek invariantlara |
| R-6 | RDP Level 2 yanlış cihazda uygulanır (geri dönüşsüz) | Düşük | Donanım kaybı | Yalnız üretim prosedüründe, iki-kişi onayı ile |
| R-7 | Kapsam sürünmesi: "MCU'ya UI da taşıyalım" | Orta | Odak | Kapsam sözleşmesi: MCU = çekirdek + UART konsol; War Room masaüstünde kalır |

---

## 8. Mevcut Açık İşlerle İlişki

Bu plan, `docs/CAELUS_PROJE_RAPORU.md` §10'daki açık borçların üzerine biner ve bazılarını doğal olarak kapatır:

- **GOLDEN-REFRESH (T-25)** → F0'ın ta kendisi (önkoşul oldu).
- **Bayat dist binary** → F0'da yeniden derleme zaten zorunlu.
- **Audit mühür çapası** → P-10 şartnamesi yazılırken doğrulayıcıya beklenen-imzacı pini eklemek doğal adım.
- **İmza anahtarı hijyeni** (`tools/caelus_signing.key` depoda düz) → F3'te firmware pini gömülmeden **önce** anahtar töreni yapılmalı; aksi hâlde sızmış olabilecek anahtar silikona gömülür. **Bu, F3'ün sert ön şartıdır.**
- **Intel veri düzlemi kimliği** → kapsam dışı kalır (masaüstü hattının işi), ama `caelus_core`'daki imza çekirdeği ileride payload imzasına da hizmet eder.

---

## 9. Sonuç

Önerilen vizyonun çekirdeği — *"önce matematiksel kesinlikle kanıtla, sonra işletim sistemsiz çıplak silikona göm"* — bu kod tabanının tasarım eksenine (determinizm, fail-closed, sıfır bağımlılık) birebir oturuyor ve **iddialı ama gerçekçidir**. Tek yapısal düzeltme, ispatı üretim kodundan koparan ara katmanların (transpilasyon, IR manipülasyonu, doğrulanamaz assembly) atılması ve ispatın **doğrudan Rust kaynağında** (Verus/Kani) yaşatılmasıdır. Bu hâliyle plan; T-20 sınıfı hataları kalıcı imkânsız kılan makine-denetimli bir çekirdek, o çekirdeği x86 ve ARM'da bit-bit aynı koşturan bir determinizm kanıtı ve saldırı yüzeyi fiziksel olarak küçültülmüş bir edge cihazı üretir. Önerilen ilk somut adım **F0**'dır: golden refresh + diferansiyel harness — düşük efor, anında değer, iki hattın da ön koşulu.

---

*Bu rapor `include/causal_engine.h` (sabit nokta yardımcıları, lever, histerezis/deadline/latch yolları satır referanslarıyla), `det_rng.h`, `Cargo.toml` bağımlılık seti ve senaryo paketleri okunarak; Verus/Kani/Dafny yetenek sınırları ve no_std crate uyumlulukları bilinen sürüm davranışlarına göre değerlendirilerek hazırlanmıştır. Efor tahminleri tek deneyimli sistem mühendisi varsayımıyla verilmiştir; ±%50 belirsizlik payı uygulanmalıdır.*
