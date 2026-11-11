---
name: caelus-axioms
description: CAELUS OS deterministik çekirdek, fail-closed güvenlik, çift-zamanlı olay kesiti ve hava boşluklu C2 arayüz kuralları.
---
# CAELUS OS Değişmez Mühendislik Yasaları
1. A-1 Determinizm: `caelus_core` içinde `f32`/`f64`, sistem saati, rastgelelik veya heap tahsisli sıcak döngü yasaktır. Sabit nokta ölçeği `FP_SCALE = 1_000_000` (`int64_t`), güvenli aralık `|val| <= (1i64 << 62)` ve deterministik tohum `0xCAE105DEADBEEF00` sabittir.
2. 64-Bit JSON/MCP Koruması: JavaScript `Number` (`2^53 - 1`) kaybını önlemek için JSON, WebSocket ve MCP sınırındaki tüm `i64`/`u64` değerler ondalık ASCII `string` olarak serileştirilir.
3. A-2 Fail-Closed & Epistemik Statü: `CAELUS_PRODUCTION` derlemesinde bypass bayrağı açılamaz. Bozuk imza veya şema hatası simülasyon durumunu `0` bit değiştirir ve `audit_log.rs` içine `INGEST_REJECTED` yazar. Her dış veri `OBSERVATION`, `CLAIM` veya `HYPOTHESIS` statüsü taşır; bağımsız teyitsiz tekil `CLAIM`/`HYPOTHESIS` kesin durum geçişi üretemez (`KANIT_YETERSİZ`).
4. A-3 Hava Boşluklu Çalışma: `caelus_core` ağ/dosya kütüphanesi içeremez. War Room UI hiçbir harici CDN, Google Fonts veya çevrimiçi harita sunucusuna bağlanmadan %100 yerel paketle çalışır.

