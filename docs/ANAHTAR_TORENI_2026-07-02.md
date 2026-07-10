# Anahtar Töreni Kaydı — 2026-07-02

**Tür:** Senaryo + eklenti güven çapası rotasyonu (ilk fiili tören)
**Gerekçe:** Önceki tohum (`9bb1dbd0…a04fa802` pubkey'inin private karşılığı) bir
dönem depoda düz metin olarak bulunmuştu (`tools/caelus_signing.key`, sonradan
izlemeden çıkarıldı). Git geçmişinden geri kazanılabilir olduğu için **ele
geçmiş varsayıldı** ve döndürüldü.

## Sonuç

| Alan | Eski | Yeni |
|---|---|---|
| Güven çapası (pubkey) | `9bb1dbd039043670…a04fa802` | `a11b528e5344d9aa7147473bf16ce9e9c977f89608958b586359414cc7e97e7f` |
| Kapsam | Senaryo pini + eklenti pini (aynı anahtar) | Senaryo pini + eklenti pini (aynı anahtar; ayrıştırma → gelecek tören) |
| Private tohum | Depoda düz metin (geçmişte) | **Depo dışı**; sahibine offline teslim edildi |

## İşletilen prosedür (scenario_pack.h başlığındaki tören adımları)

1. **Tohum üretimi (depo dışı):**
   `cargo run --release --bin caelus_sign_scenario -- --json scenarios/BS-01_SAHTE_UFUK.json --key <REPO-DIŞI-YOL>/caelus_signing_2026-07-02.key --generate-key --write`
2. **Kalan senaryoların yeniden imzalanması:** aynı komut `--generate-key`'siz,
   `BS-02_GOLGE_ARSIV` ve `BS-03_KUM_SAATI` için (`--write`).
3. **Pin güncellemeleri (3 konum):**
   - `include/scenario_pack.h` → `CAELUS_TRUSTED_PUBKEY[32]`
   - `core_engine.cpp` → `CAELUS_TRUSTED_PLUGIN_PUBKEY[32]`
   - `tools/caelus_trusted_pubkey.txt`
4. **Yeniden derleme + tam CI:** `ci.sh` uçtan uca yeşil (imza kapısı SIG-CI
   dahil). Golden snapshot hash'leri imza malzemesi içermediğinden rotasyon
   sonrası **değişmedi**; `--refresh` gerekmedi.
5. **Bu kaydın commit'lenmesi.** Private tohum commit **edilmedi**.

## Doğrulama

- Eski anahtarla imzalı senaryo artık `SIGNATURE_MISMATCH`/pin reddi alır
  (fail-closed); üç paket de yeni imzalarla yükleniyor.
- Kod ve test ağacında eski pubkey'e referans kalmadı (yalnız tarihsel
  raporlarda, kayıt amaçlı duruyor).

## Bilinen etkiler / takip

- ~~`dist/caelus_os.exe` (Windows) rotasyon öncesi derlemeydi~~ → **Çözüldü:**
  bayat binary depodan çıkarıldı; `dist/` artık tümüyle gitignore'da. Her iki
  platformun binary'si CI'da her koşuda taze üretilip artifact olarak
  yayımlanıyor; yerelde `build.bat` / `CAELUS_CALISTIR.bat` üretir.
- Intel veri düzlemi anahtarı bu çapadan **ayrıdır** ve zaten depo dışıdır
  (görev ayrılığı — bkz. `docs/INTEL_IMZA_SOZLESMESI.md`).
- Sonraki tören önerisi: senaryo ve eklenti pinlerinin ayrı anahtarlara
  ayrıştırılması + `include/trust_anchor.h` altında tekleştirme (core_engine'de
  işaretli teknik borç).

## Tohum saklama talimatı (sahibine)

Yeni tohum dosyası (`caelus_signing_2026-07-02.key`, 32 bayt) yalnızca size
teslim edilmiştir. Offline bir ortamda (şifreli USB / parola kasası) saklayın;
hiçbir git deposuna, buluta veya paylaşılan diske koymayın. Kaybı, tüm
senaryoların yeniden imzalanmasını gerektiren yeni bir tören demektir.
