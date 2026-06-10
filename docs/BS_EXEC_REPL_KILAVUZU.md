# CAELUS OS BS-EXEC REPL Komut Kilavuzu

Bu kilavuz R9 Senaryo REPL ile BS-01, BS-02 ve BS-03 paketlerini uctan uca test etmek icindir. Ornekler Windows calisma dizini `c:\Users\Lenovo\Desktop\CAELUS` icin yazilmistir.

## Baslatma

Once binary'yi olustur:

```bat
build.bat
```

BS paketleri `SELF_SIGNED_DEV` imzali gelistirme senaryolaridir. Bu paketleri yuklemek icin once dev senaryo kapisini ac:

```powershell
$env:CAELUS_ALLOW_DEV_SCENARIOS = "1"
```

CMD kullaniyorsan:

```bat
set "CAELUS_ALLOW_DEV_SCENARIOS=1"
```

REPL'i deterministik calistirmak icin `--det-mode` onerilir. Bu mod lever olasiliklarini tekrar edilebilir yapar ve ag/WS gurultusunu azaltir.

```powershell
.\dist\caelus_os.exe --scenario BS-01_SAHTE_UFUK --repl --det-mode
```

`--interactive` bayragi da geriye uyumlu olarak ayni REPL'i baslatir:

```powershell
.\dist\caelus_os.exe --scenario BS-01_SAHTE_UFUK --interactive --det-mode
```

REPL acildiginda motor ilk bootstrap dongusunu tamamlamis olur. Temiz bir oturumda `current_tick` genelde `3` olarak gorunur. Emin olmak icin her senaryoda once:

```text
status
list levers
```

Makine-okunur deterministik testler icin `status --json` veya `snapshot --json` kullan:

```text
snapshot --json
```

Bu komut tek satirlik `[REPL_JSON] {...}` snapshot basar. Python golden runner bu satirlari parse eder, normalize eder ve SHA-256 snapshot hash'i uretir.

Eşik test formulu:

```text
tick <threshold_tick - current_tick + 1>
```

Ornek: `current_tick=3` ve deadline `384` ise `tick 382` eşiği gecirir ve `DEADLINE MISSED` uyarısını gorursun.

## REPL Komutlari

```text
help
status
status --json
snapshot
snapshot --json
list levers
tick <sayi>
lever <id>
quit
```

`tick <sayi>` motoru adim adim ilerletir. Her adimda senaryo paketindeki `intel_feed_sequence` zamanlari kontrol edilir ve uygun intel olayi otomatik enjekte edilir.

`lever <id>` ilgili senaryo kaldiracini `CausalEngine::apply_lever` ile uygular, sonucu yaymak icin 1 tick calistirir ve yeni snapshot basar. Paketlerdeki `cost_ticks` operasyonel zaman maliyetidir; REPL ciktisindaki `ek tick` degeriyle maliyeti tamamlayabilirsin.

## Otomatik Golden Runner

Deterministik Python runner:

```bat
python tests\run_bs_exec_golden.py --dry-run
python tests\run_bs_exec_golden.py
```

Tek senaryo kosmak icin:

```bat
python tests\run_bs_exec_golden.py --scenario BS-03_KUM_SAATI
```

Runner ozellikleri:

- `dist\caelus_os.exe` yoksa anlasilir hata verir; farkli binary icin `--binary <path>` kullan.
- `CAELUS_ALLOW_DEV_SCENARIOS=1` ortam degiskenini kendisi ayarlar; mevcut BS paketleri `SELF_SIGNED_DEV` oldugu icin bu gereklidir.
- Her senaryoda `snapshot --json`, `tick <n>`, `snapshot --json`, `quit` girdilerini stdin pipe ile yollar.
- Histerezis esiklerini senaryo JSON'undan okur ve `last_snapshot_tick == threshold_tick` kosulunu milimetrik dogrular.
- Esik olay izini, `hysteresis_flip`, `outage_active` ve normalize snapshot SHA-256 hash'ini kontrol eder.

Mevcut motor semantiginde BS-01, BS-02 ve BS-03 histerezisleri tek basina outage sentinel degerine ulasmaz. Bu nedenle runner histerezis tick'indeki `outage_active` degerini mevcut kod davranisina gore `false` bekler. Perishable deadline kaynakli outage'lar ayri olaydir.

## BS-01 Sahte Ufuk

Baslat:

```bat
set "CAELUS_ALLOW_DEV_SCENARIOS=1"
dist\caelus_os.exe --scenario BS-01_SAHTE_UFUK --repl --det-mode
```

Ilk inceleme:

```text
status
list levers
```

Kritik kaldiraclari dene:

```text
lever L-01_ZAFER_ANLATI
tick 23
lever L-02_TANIIMA
tick 11
lever L-04_ZIMRH
tick 31
status
```

Temiz oturumda deadline ve histerezis testleri:

```text
tick 382
status
tick 192
status
quit
```

Beklenen gozlemler:

- `REEFER_PHARMA` deadline'i `384` tick'te kacirilir; konsolda `DEADLINE MISSED` gorunmelidir.
- `HYST_PERM_REROUTE` `576` tick'te kalici rota kaybi ekler; `hysteresis_flip` `EVET` olur.
- Surtunme tavani asilirse `REGIME_EXCEEDED` bayragi ve 3.0x kenetlenmis friction gorunur.

## BS-02 Golge Arsiv

Baslat:

```bat
set "CAELUS_ALLOW_DEV_SCENARIOS=1"
dist\caelus_os.exe --scenario BS-02_GOLGE_ARSIV --repl --det-mode
```

Ilk inceleme ve onleyici kaldiraclar:

```text
status
list levers
lever L-02_MIRAS
tick 15
lever L-04_SIGORTA
tick 11
lever L-01_CERCEVE
tick 7
status
```

Temiz oturumda deadline ve histerezis testleri:

```text
tick 142
status
tick 96
status
quit
```

Beklenen gozlemler:

- `PAYROLL_FAILURE` deadline'i ve `HYST_PAYROLL_MISS` histerezisi `144` tick civarinda tetiklenir.
- `HYST_SUPPLIER_FLIGHT` `240` tick'te kalici tedarikci kaybini ekler.
- `FL_PAYROLL_LEAK` geri besleme dongusu surtunmeyi kademeli artirir; lever basarilari bu artisi dusurmelidir.

## BS-03 Kum Saati

Baslat:

```bat
set "CAELUS_ALLOW_DEV_SCENARIOS=1"
dist\caelus_os.exe --scenario BS-03_KUM_SAATI --repl --det-mode
```

Ilk inceleme ve mudahale denemesi:

```text
status
list levers
lever L-01_ZIMRH
tick 9
lever L-04_ZAFER
tick 3
lever L-03_ILKACIN
tick 5
status
```

Temiz oturumda blokaj, deadline ve kalici histerezis testleri:

```text
tick 22
status
tick 96
status
tick 96
status
quit
```

Beklenen gozlemler:

- `HYST_BLOKAJ` `24` tick'te geri alinabilir blokaj esigini isaretler.
- `REEFER_CONVOY` deadline'i `120` tick'te kacirilir ve perishable kaynak nedeniyle `outage_active` `EVET` olabilir.
- `HYST_TRAFIK_KAYBI` `216` tick'te kalici %35 trafik kaybini ekler.
- Uc pekistiren dongu (`FL-1`, `FL-2`, `FL-3`) uzun kosuda `REGIME_EXCEEDED` riskini hizlandirir.

## Pratik Test Notlari

- Eşik komutlarini lever denemelerinden sonra calistiriyorsan once `status` ile `current_tick` degerini al, sonra formulu uygula.
- `snapshot` ve `status` ayni ozet ciktisini verir; audit log'a `REPL_COMMAND` ve her tick icin `REPL_TICK` kaydi eklenir.
- `lever` komutu basarisiz donerse bu olasiliksal basarisizlik ya da lockout anlamina gelebilir; ayni kosullari tekrar uretmek icin `--det-mode` kullan.
