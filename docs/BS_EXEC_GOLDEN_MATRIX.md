# BS-EXEC Golden Test Süiti ve Doğrulama Matrisi

Bu belge, CAELUS OS REPL CLI üzerinden BS-01, BS-02 ve BS-03 Black Swan senaryolarını deterministik olarak doğrulayan golden test setini tanımlar.

## Kapsam

- REPL komutları: `status`, `list levers`, `lever <id>`, `tick <n>`, `snapshot`, `quit`.
- Senaryolar:
  - `scenarios/BS-01_SAHTE_UFUK.json`
  - `scenarios/BS-02_GOLGE_ARSIV.json`
  - `scenarios/BS-03_KUM_SAATI.json`
- Determinizm: `--det-mode`, sabit seed `0xCAE105DEADBEEF00`.
- Geliştirme imzası: mevcut paketler `SELF_SIGNED_DEV` olduğu için runner `CAELUS_ALLOW_DEV_SCENARIOS=1` ayarlar.

Golden dosyalar:

| Senaryo | Komut dosyası | Beklenen snapshot |
| --- | --- | --- |
| BS-01 | `tests/golden/bs01_repl.commands` | `tests/golden/bs01_expected.json` |
| BS-02 | `tests/golden/bs02_repl.commands` | `tests/golden/bs02_expected.json` |
| BS-03 | `tests/golden/bs03_repl.commands` | `tests/golden/bs03_expected.json` |

## Çalıştırma

Önce binary üret:

```bat
build.bat
```

Golden süiti çalıştır:

```bat
tests\run_bs_exec_golden.bat
```

Runner üç senaryoyu şu biçimde çalıştırır:

```bat
dist\caelus_os.exe --scenario BS-01_SAHTE_UFUK --repl --det-mode < tests\golden\bs01_repl.commands
```

Çıktılar `tests/golden/out/*.out` altında saklanır. Binary yoksa runner `SKIP` ile çıkar ve önce build yapılmasını ister.

## REPL Başlangıç Modeli

`core_engine.cpp` REPL başlamadan önce senaryoyu yükler, bir baseline tick çalıştırır ve iki post-intel tick daha koşturur. Bu nedenle golden komut dosyaları REPL'i `current_tick=3`, `last_snapshot_tick=2` durumundan başlatır.

Her `lever <id>` komutu:

1. `CausalEngine::apply_lever()` çağırır.
2. Deterministik roll değerini `seed + current_tick` ile üretir.
3. Sonucu uygular.
4. Hemen 1 tick yayılım çalıştırır.

Bu yüzden eşiklere giden `tick <n>` değerleri, önceki lever komutlarının tükettiği tick'ler düşülerek hesaplandı.

## Lever Determinizm Matrisi

| Senaryo | Lever | Tick | Roll FP | Başarı eşiği FP | Beklenen |
| --- | --- | ---: | ---: | ---: | --- |
| BS-01 | `L-01_ZAFER_ANLATI` | 3 | 650030 | 750000 | `BASARILI` |
| BS-01 | `L-02_TANIIMA` | 4 | 511421 | 800000 | `BASARILI` |
| BS-01 | `L-03_FOMO` | 5 | 153915 | 650000 | `BASARILI` |
| BS-01 | `L-04_ZIMRH` | 6 | 22320 | 700000 | `BASARILI` |
| BS-02 | `L-01_CERCEVE` | 3 | 650030 | 700000 | `BASARILI` |
| BS-02 | `L-02_MIRAS` | 4 | 511421 | 750000 | `BASARILI` |
| BS-02 | `L-03_REGULATOR` | 5 | 153915 | 650000 | `BASARILI` |
| BS-02 | `L-04_SIGORTA` | 6 | 22320 | 800000 | `BASARILI` |
| BS-02 | `L-05_BUMERANG` | 7 | 918411 | 500000 | `BASARISIZ` |
| BS-03 | `L-01_ZIMRH` | 3 | 650030 | 700000 | `BASARILI` |
| BS-03 | `L-02_TEKNIK_EK` | 4 | 511421 | 650000 | `BASARILI` |
| BS-03 | `L-03_ILKACIN` | 5 | 153915 | 600000 | `BASARILI` |
| BS-03 | `L-04_ZAFER` | 6 | 22320 | 800000 | `BASARILI` |

## Deadline ve Histerezis Matrisi

Outage artık **latching** (kilitlenen / geri alınamaz) bir state machine'dir: bir kez `true` olduğunda sonraki tick'lerde KORUNUR ve hiçbir tick içi kod yolu onu `false`'a çekmez (`outage_ = outage_ || koşul` eşdeğeri). Latch tetikleyicileri:

- **Perishable/kritik düğüm deadline kaçışı** — `check_deadlines()` → `latch_outage()` ve düğüm `irrecoverable=true`.
- **Non-reversible histerezis eşiği** — `check_hysteresis()` → `latch_outage()`.

Outage yalnız başarılı (`success && clear_irrecoverable`) lever sonucunda `clear_outage_recovery()` ile temizlenir; başarısız lever temizlemez.

Aşağıdaki "Beklenen durum" sütunu T-20 latched semantiğe göredir. (Tick zamanlaması `run_bs_exec_golden.py --dry-run` ile makineyle doğrulandı; `outage_active`/`throughput` değerleri deterministik mantıkla türetildi. Mevcut `dist/caelus_os.exe` T-19 latch düzeltmesinden ÖNCEKİ bir ara derlemedir ve latched değerler için YETKİLİ DEĞİLDİR — bkz. "Golden Yeniden Üretim Borcu".)

| Senaryo | Olay | Komut fazı | Beklenen snapshot tick | Beklenen durum (latched semantik) |
| --- | --- | --- | ---: | --- |
| BS-01 | `REEFER_PHARMA_EXPIRY_96H` deadline (Perishable) | `tick 378` | 384 | `deadline_missed=EVET`, `outage_active=EVET` (perishable latch) |
| BS-01 | `HYST_PERM_REROUTE` (non-reversible) | `tick 192` | 576 | `hysteresis_flip=EVET`, `outage_active=EVET` (tick 384 perishable latch + non-reversible flip; artık reset YOK) |
| BS-02 | `PAYROLL_RUN_72H` deadline (Service) | `tick 137` | 144 | `deadline_missed=EVET`; Service düğümü deadline'ı TEK BAŞINA latch etmez, fakat aynı tick'teki non-reversible `HYST_PAYROLL_MISS` latch eder → snapshot `outage_active=EVET` |
| BS-02 | `HYST_PAYROLL_MISS` (non-reversible) | `tick 137` | 144 | `hysteresis_flip=EVET`, `outage_active=EVET` (non-reversible latch) |
| BS-02 | `HYST_SUPPLIER_FLIGHT` (non-reversible) | `tick 96` | 240 | `hysteresis_flip=EVET`, `outage_active=EVET` (latch korunur) |
| BS-03 | `HYST_BLOKAJ` (reversible) | `tick 18` | 24 | `hysteresis_flip=EVET`, `outage_active=HAYIR` (reversible latch etmez; perishable deadline tick 120 henüz gelmedi) |
| BS-03 | `REEFER_MED_EXPIRY_120H` deadline (Perishable) | `tick 96` | 120 | `deadline_missed=EVET`, `outage_active=EVET` (perishable latch) |
| BS-03 | `HYST_TRAFIK_KAYBI` (non-reversible) | `tick 96` | 216 | `hysteresis_flip=EVET`, `outage_active=EVET` (tick 120 perishable latch + non-reversible flip; artık reset YOK) |

Not (latch öncesi → sonrası): Eski `check_hysteresis()` non-reversible flip'te `outage_ = (permanent_friction_fp_ >= FRICTION_MAX_FP)` ataması yapıyordu. Bu senaryolardaki `permanent_loss_fp` değerleri 3.0x sentinel'in altında kaldığı için flip, outage'ı yanlışlıkla `false`'a çekiyordu — BS-01 (tick 576) ve BS-03 (tick 216) için daha önce perishable deadline ile açılmış outage'ı SİLMEK dahil. Yeni latched semantikte non-reversible flip ve perishable deadline `latch_outage()` çağırır; outage yalnız başarılı recovery lever ile temizlenir. Bu yüzden eski golden dosyaları (`tests/golden/*`, `run_bs_exec_golden.py`) latch-öncesi davranışı kodlar ve ayrı bir görevde yeniden üretilmelidir (aşağıya bkz.).

## Çok-Ufuklu Doğrulama Matrisi

| Senaryo | Ufuk | Snapshot tick | Raw friction | Clamped friction | Throughput | Rejim |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| BS-01 | REPL başlangıcı | 2 | 3.131532 | 3.000000 | 0.333333 | `REGIME_EXCEEDED` |
| BS-01 | Lever sonrası | 6 | 2.413470 | 2.413470 | 0.414341 | `REGIME_EXCEEDED` kalıcı bayrak |
| BS-01 | Deadline | 384 | 2.524600 | 2.524600 | 0.000000 | outage latched (perishable) |
| BS-01 | Histerezis | 576 | 2.524600 | 2.524600 | 0.000000 | outage latched (tick 384 perishable + non-reversible flip) |
| BS-02 | REPL başlangıcı | 2 | 4.266920 | 3.000000 | 0.333333 | `REGIME_EXCEEDED` |
| BS-02 | Lever sonrası | 7 | 1.683700 | 1.683700 | 0.593930 | `REGIME_EXCEEDED` kalıcı bayrak |
| BS-02 | Payroll eşiği | 144 | 1.683700 | 1.683700 | 0.000000 | outage latched (non-reversible flip) |
| BS-02 | Supplier eşiği | 240 | 2.033700 | 2.033700 | 0.000000 | outage latched (kalır) |
| BS-03 | REPL başlangıcı | 2 | 3.352000 | 3.000000 | 0.333333 | `REGIME_EXCEEDED` |
| BS-03 | Lever sonrası | 6 | 1.298757 | 1.298757 | 0.769967 | bounded |
| BS-03 | Blokaj eşiği | 24 | 1.800951 | 1.800951 | 0.555262 | reversible hysteresis (latch yok) |
| BS-03 | Reefer deadline | 120 | 2.053000 | 2.053000 | 0.000000 | outage latched (perishable) |
| BS-03 | Trafik kaybı | 216 | 2.053000 | 2.053000 | 0.000000 | outage latched (tick 120 perishable + non-reversible flip) |

T-20 notu: `raw_friction`/`clamped_friction` sütunları latch değişikliğinden ETKİLENMEZ (sürtünme matematiği `aggregate_friction` aynı kaldı) ve T-16 binary'sinden devralınan makine-üretilmiş değerlerdir. Yalnız `throughput_ratio` ve outage durumu latched semantiğe göre güncellendi: outage latch edildiğinde `build_snapshot()` koşulsuz `throughput_ratio=0.0` yazar.

Bu matris aşağıdaki rasyonel sınırları kanıtlar:

- `current_tick` monoton artar; snapshot çıktısında `last_snapshot_tick = current_tick - 1` invariant'ı korunur.
- `clamped_friction` her ufukta `[1.000000, 3.000000]` aralığındadır.
- `raw_friction` golden patikalarında negatif veya taşmış değer üretmez; gözlenen aralık `[1.298757, 4.266920]` olur.
- `throughput_ratio`, outage YOKKEN `1 / clamped_friction` ile tutarlıdır ve `[0.333333, 0.769967]` aralığında kalır.
- Outage VARKEN `throughput_ratio=0.000000` olur. Latched semantikte bu; BS-01 (tick 384, 576), BS-02 (tick 144, 240) ve BS-03 (tick 120, 216) ufuklarını kapsar.
- Outage **latching**'tir: bir kez `outage_active=true` olduğunda sonraki tick'lerde `true` ve `throughput_ratio=0.000000` KALIR; yalnız başarılı `clear_irrecoverable` lever (`clear_outage_recovery`) temizler. BS-02'nin tek `clear_irrecoverable=true` lever'ı `L-05_BUMERANG`'tır ve golden dizide deterministik olarak BAŞARISIZ (roll 918411 ≥ 500000) olduğundan outage latched kalır.
- Lever başarıları yalnız `success_p_fp` ve `DetRng(seed + tick)` roll değerine bağlıdır; aynı komut sırası aynı sonucu verir.

## Latching Outage Migrasyonu — Golden Yeniden Üretim Borcu (T-20)

T-19/T-20 ile `include/causal_engine.h` outage'ı latching state machine'e taşındı (kod tarafı tamamdır; bu görevde header değişiklik GEREKTİRMEDİ — denetim sonucu zaten latched). Aşağıdaki dosyalar **bu sniper kapsamı dışındadır** (yalnız `include/causal_engine.h` + bu doküman verildi), latch-ÖNCESİ davranışı kodlar ve **ayrı bir takip görevinde** motor binary'si yeniden üretilip yeniden hesaplanmalıdır. Bunlara DOKUNULMADI.

| Dosya (kapsam dışı) | Bayat alan | Mevcut (latch öncesi) | Olması gereken (latched) |
| --- | --- | --- | --- |
| `tests/golden/bs01_expected.json` | `hysteresis_perm_reroute` → `outage_active` / `throughput_ratio` | `false` / `0.396102` | `true` / `0.0` (+ `current_engine_note` reset açıklaması kaldırılmalı) |
| `tests/golden/bs02_expected.json` | `payroll_deadline_and_hysteresis` → `outage_active` / `throughput_ratio` | `false` / `0.59393` | `true` / `0.0` |
| `tests/golden/bs02_expected.json` | `supplier_hysteresis` → `outage_active` / `throughput_ratio` | `false` / `0.491715` | `true` / `0.0` |
| `tests/golden/bs03_expected.json` | `permanent_traffic_loss_hysteresis` → `outage_active` / `throughput_ratio` | `false` / `0.487092` | `true` / `0.0` (+ `current_engine_note` kaldırılmalı) |
| `tests/run_bs_exec_golden.py` | `EXPECTED_HYSTERESIS_OUTAGE` | tümü `False` | `HYST_PERM_REROUTE→True`, `HYST_PAYROLL_MISS→True`, `HYST_SUPPLIER_FLIGHT→True`, `HYST_TRAFIK_KAYBI→True`; `HYST_BLOKAJ→False` (reversible, tick 24'te perishable deadline 120 henüz gelmedi) |
| `tests/run_bs_exec_golden.py` | `EXPECTED_SNAPSHOT_HASHES` | 3 latch-öncesi SHA-256 | 3 senaryo için yeniden hesaplanmalı (`outage_active` normalize hash'e dahildir) |

Mevcut binary doğrulaması (T-20, salt-çalıştırma — yeniden derleme YAPILMADI):

Çalışma dizinindeki `dist/caelus_os.exe` (T-19 öncesi ara derleme) eşzamanlı T-17 çalışmasına dokunmadan çalıştırıldı. Lever uygulanmayan (`--dry-run` komut dizisi) koşumda latch-öncesi davranış gözlendi: her senaryoda `deadline_missed`/`hysteresis_flip=true` olsa bile `outage_active=false`.

| Senaryo | Snapshot tick | `deadline_missed` | `hysteresis_flip` | `outage_active` (mevcut binary) | Latched olması gereken |
| --- | ---: | --- | --- | --- | --- |
| BS-01 | 576 | true | true | `false` (reset bug) | `true` |
| BS-02 | 144 | true | true | `false` | `true` |
| BS-02 | 240 | true | true | `false` | `true` |
| BS-03 | 216 | true | true | `false` (reset bug) | `true` |

Bu, eski golden'ı üreten motorun latch düzeltmesini henüz İÇERMEDİĞİNİ doğrular; bu binary latched değerler için yetkili değildir. Yetkili latched çıktı, eşzamanlı T-17 `core_engine.cpp` çalışması bittikten sonra TEMİZ bir `build.bat` ile üretilmelidir.

CI etkisi:

- `run_bs_exec_golden.py` latch'li (yeniden derlenmiş) motorla **FAIL** verir (önce `outage_active` assert'i, ardından hash uyuşmazlığı). Bu, latching semantiğinin doğru çalıştığının kanıtıdır; gerçek regresyon değildir.
- `run_bs_exec_golden.bat` yalnız `runner_assertions.must_contain` METİNLERİNİ doğrular (lever sonucu, `DEADLINE MISSED`, histerezis id'leri, `last_snapshot_tick`); `outage_active` alanını kontrol etmediği için latch'ten ETKİLENMEZ ve geçmeye devam eder. Yine de `*_expected.json` içindeki `expected_snapshot` blokları dokümantasyon/ileride alan-bazlı parsing için bayat kalır ve yeniden üretilmelidir.

## Sınırlamalar

- Golden snapshot'lar latch-öncesi `CausalEngine` davranışına göre hazırlanmıştı; T-20 latched semantiği ile yukarıdaki "Golden Yeniden Üretim Borcu" tablosundaki alanlar (kapsam dışı dosyalarda) bilinçli olarak güncellenmelidir.
- Paketler `SELF_SIGNED_DEV` imzalı olduğu sürece runner geliştirme bypass'ı kullanır. Üretim signer tamamlandığında `CAELUS_ALLOW_DEV_SCENARIOS=1` kaldırılmalı ve golden suite gerçek imzalı paketlerle yeniden üretilmelidir.
- Runner stdout izlerini ve milestone metinlerini doğrular. Daha sıkı alan bazlı parsing istenirse `tests/golden/*_expected.json` dosyaları doğrudan REPL snapshot parser'ına bağlanabilir.
