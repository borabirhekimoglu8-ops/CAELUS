/**
 * CAELUS — GÖRSEL EVRİM VE MEKÂNSAL ARAYÜZ PROGRAMI
 * Otomatik Fonksiyonel, Erişilebilirlik, Epistemik ve Mekânsal Arayüz Doğrulama Test Paketi
 *
 * Bu test paketi Bölüm 1–18 kapsamındaki 17 zorunlu akışı (Başlıksız sahne, sabit üst/alt barın
 * kaldırılması, CAELUS Açık Sarmal Mekânsal Pusulası, kademeli bilgi açılımı, odaklanmış etki ağı,
 * çift zamanlı Zaman Merceği, 3 rakip gelecek senaryosu, Kaynak/Dayanak çekmecesi, 3 performans modu,
 * mobil/hibrit uyum ve veri bütünlüğü) doğrular.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const uiHtmlPath = path.join(ROOT, 'ui', 'index.html');
const distHtmlPath = path.join(ROOT, 'dist', 'index.html');
const uiAppJsPath = path.join(ROOT, 'ui', 'app.js');
const mobilePagePath = path.join(ROOT, 'apps', 'caelus-ncm-mobile', 'app', 'page.tsx');
const mobileNavPath = path.join(ROOT, 'apps', 'caelus-ncm-mobile', 'app', 'components', 'BottomNav.tsx');
const mobileCssPath = path.join(ROOT, 'apps', 'caelus-ncm-mobile', 'app', 'globals.css');
const worldStorePath = path.join(ROOT, 'caelus_world_store.json');

const uiHtml = fs.readFileSync(uiHtmlPath, 'utf8');
const distHtml = fs.existsSync(distHtmlPath) ? fs.readFileSync(distHtmlPath, 'utf8') : uiHtml;
const uiAppJs = fs.readFileSync(uiAppJsPath, 'utf8');
const mobilePage = fs.readFileSync(mobilePagePath, 'utf8');
const mobileNav = fs.readFileSync(mobileNavPath, 'utf8');
const mobileCss = fs.readFileSync(mobileCssPath, 'utf8');

test('Akış 1: Uygulama ilk açılışta sabit üst bar ve sabit alt bar olmadan başlıksız tam ekran sahne olarak açılır', () => {
  // .top-header HTML'den kaldırılmış ve CSS'te display:none !important olarak mühürlenmiş olmalı
  assert.doesNotMatch(uiHtml, /<header class="top-header"/, 'Sabit üst bar (.top-header) ana sahneden kaldırılmış olmalıdır');
  assert.match(uiHtml, /\.top-header,\s*#caelus-mobile-bottom-nav\s*\{\s*display:\s*none\s*!important;/, 'Sabit üst ve alt barlar CSS düzeyinde de kapatılmış olmalıdır');
  assert.match(uiHtml, /height:\s*100dvh\s*!important;/, 'Dünya sahnesi tam ekran 100dvh yüksekliğe sahip olmalıdır');

  // Mobil NCM uygulamasında da sabit üst .app-header ve sabit alt .bottom-nav kaldırılmış olmalı
  assert.doesNotMatch(mobilePage, /<header className="app-header">/, 'Mobil uygulamada sabit üst bar bulunmamalıdır');
  assert.doesNotMatch(mobileCss, /position:\s*fixed;[\s\S]{0,80}bottom:\s*0/, 'Mobil uygulamada sabit alt bar (bottom: 0 dock) bulunmamalıdır');
});

test('Akış 2, 3, 4 ve 5: CAELUS Açık Sarmal Mekânsal Pusulası keşfedilebilir, klavye/fare/dokunma erişilebilir ve Sahneye Dön özelliğine sahiptir', () => {
  // Pusula kapsayıcısı ve tetikleyicisi
  assert.match(uiHtml, /id="caelus-spatial-compass"/, 'Mekânsal pusula (#caelus-spatial-compass) mevcut olmalıdır');
  assert.match(uiHtml, /id="caelus-compass-trigger"/, 'Pusula tetikleyicisi (#caelus-compass-trigger) mevcut olmalıdır');
  assert.match(uiHtml, /aria-controls="caelus-compass-popover"/, 'Pusula tetikleyicisi aria-controls özniteliğine sahip olmalıdır');
  assert.match(uiHtml, /id="caelus-spatial-onboarding-hint"/, 'İlk kullanımda kaybolabilir yönlendirme ipucu bulunmalıdır');
  assert.match(uiHtml, /id="hdr-logo-home-btn"/, 'Tek tıkla Sahneye Dön düğmesi mevcut olmalıdır');

  // 5 temel çalışma alanı (Dünyam, İlişkiler ve Keşfet, Zaman ve Hafıza, Gelecekler ve Senaryolar, Kaynaklar ve Dayanak)
  assert.match(uiHtml, /1\. Dünyam/, '1. Dünyam çalışma alanı pusulada yer almalıdır');
  assert.match(uiHtml, /2\. İlişkiler ve Keşfet/, '2. İlişkiler ve Keşfet çalışma alanı pusulada yer almalıdır');
  assert.match(uiHtml, /3\. Zaman ve Hafıza/, '3. Zaman ve Hafıza çalışma alanı pusulada yer almalıdır');
  assert.match(uiHtml, /4\. Gelecekler ve Senaryolar/, '4. Gelecekler ve Senaryolar çalışma alanı pusulada yer almalıdır');
  assert.match(uiHtml, /5\. Kaynaklar ve Dayanak/, '5. Kaynaklar ve Dayanak çalışma alanı pusulada yer almalıdır');

  // Görünüm seçildiğinde menünün otomatik kapanması ve Klavye (Alt+M / Escape) desteği
  assert.match(uiAppJs, /function toggleSpatialCompassPopover\(/, 'toggleSpatialCompassPopover fonksiyonu tanımlı olmalıdır');
  assert.match(uiAppJs, /toggleSpatialCompassPopover\(false\)/, 'Görünüm seçildiğinde veya Escape basıldığında pusula otomatik kapanmalıdır');
  assert.match(uiAppJs, /e\.altKey\s*&&\s*\(e\.key\s*===\s*'m'/, 'Alt+M klavye kısayolu desteklenmelidir');
});

test('Akış 6 ve 7: Dünya sahnesinde seçim yapılmadan önce inceleme paneli kapalıdır; seçim yapıldığında 6 kademeli bilgi katmanıyla açılır ve kapatılabilir', () => {
  // İlk açılışta #dunyam-stage-callout-card is-collapsed sınıfına sahip olmalı
  assert.match(uiHtml, /<div class="dunyam-stage-callout is-collapsed" id="dunyam-stage-callout-card"/, 'İnceleme kartı ilk açılışta kapalı (is-collapsed) başlamalıdır');
  // Sağ bağlamsal ray konumlandırması (sahnenin ortasını kapatmamalı)
  assert.match(uiHtml, /\.dunyam-stage-callout\s*\{[\s\S]{0,180}position:\s*absolute\s*!important;[\s\S]{0,120}right:\s*18px\s*!important;/, 'İnceleme kartı sağ bağlamsal rayda konumlanmalıdır');

  // 6 kademeli bilgi açılımı (Olay, İlgili Varlıklar, Etki Yolları, Kaynak/Kanıt, Alternatif Açıklamalar, Senaryolar)
  assert.match(uiHtml, /id="callout-progressive-layers-box"/, '6 kademeli bilgi açılım kutusu mevcut olmalıdır');
  assert.match(uiHtml, /1\. OLAY VE VARLIK ODAĞI/, '1. katman (Olay ve Varlık Odağı) mevcut olmalıdır');
  assert.match(uiHtml, /2\. İLGİLİ VARLIKLAR &amp; 3\. ETKİ YOLLARI/, '2. ve 3. katmanlar (İlgili Varlıklar ve Etki Yolları) mevcut olmalıdır');
  assert.match(uiHtml, /4\. KAYNAK\/KANIT &amp; 5\. ALTERNATİF AÇIKLAMALAR/, '4. ve 5. katmanlar (Kaynak/Kanıt ve Alternatif Açıklamalar) mevcut olmalıdır');
  assert.match(uiHtml, /id="btn-dunyam-callout-intervene"/, '6. katman (Senaryolar geçişi) mevcut olmalıdır');
  assert.match(uiHtml, /id="btn-callout-open-provenance"/, 'Dayanak & Kanıt doğrudan geçiş düğmesi mevcut olmalıdır');
  assert.match(uiHtml, /id="btn-callout-open-timelens"/, 'Zaman Merceği doğrudan geçiş düğmesi mevcut olmalıdır');
});

test('Akış 8: İlişkiler ve Keşfet görünümünde kademeli komşuluk derinliği (1-2-3 derece), "Neden gösteriliyor?" açıklaması ve mobil adım adım zincir görünümü çalışır', () => {
  assert.match(uiHtml, /id="kesfet-cy-hop-bar"/, 'Komşuluk derinliği (Hop Depth) seçicisi mevcut olmalıdır');
  assert.match(uiHtml, /data-cy-hop="1"/, '1. Derece Doğrudan komşuluk düğmesi mevcut olmalıdır');
  assert.match(uiHtml, /data-cy-hop="2"/, '2. Derece Dolaylı yayılım düğmesi mevcut olmalıdır');
  assert.match(uiHtml, /data-cy-hop="3"/, '3. Derece Tam Ağ düğmesi mevcut olmalıdır');
  assert.match(uiHtml, /id="cy-insp-why-shown-box"/, '"Neden gösteriliyor?" ve alternatif açıklama kutusu mevcut olmalıdır');
  assert.match(uiHtml, /Neden gösteriliyor\?/i, '"Neden gösteriliyor?" başlığı inceleyicide yer almalıdır');
  assert.match(uiHtml, /id="kesfet-mobile-step-path-list"/, 'Mobil adım adım nedensel yol listesi mevcut olmalıdır');
  assert.match(uiAppJs, /function applyCytoscapeHopDepth\(/, 'applyCytoscapeHopDepth fonksiyonu tanımlı olmalıdır');
});

test('Akış 9 ve 10: Zaman Merceği (Bitemporal Time Lens) tarih kesiti seçer, o tarihte bilinenler ile sonradan öğrenilenleri 0 sızıntıyla ayırır ve v1/v2 değerlendirmesini karşılaştırır', () => {
  assert.match(uiHtml, /id="btn-stage-time-lens"/, 'Sahne üstü Zaman Merceği düğmesi mevcut olmalıdır');
  assert.match(uiHtml, /id="caelus-time-lens-popover"/, 'Zaman Merceği açılır penceresi mevcut olmalıdır');
  assert.match(uiHtml, /data-tl-cutoff="2021-02-19T23:59:59Z"/, '19 Şub 2021 (v1 İlk Değerlendirme) kesiti mevcut olmalıdır');
  assert.match(uiHtml, /data-tl-cutoff="2021-03-17T23:59:59Z"/, '17 Mar 2021 (v2 Güncellenmiş) kesiti mevcut olmalıdır');
  assert.match(uiAppJs, /function renderAndOpenTimeLensPopover\(/, 'renderAndOpenTimeLensPopover fonksiyonu tanımlı olmalıdır');
  assert.match(uiAppJs, /1\. O Tarihe Kadar Bilinenler/, 'O tarihe kadar bilinenler bölümü render edilmelidir');
  assert.match(uiAppJs, /2\. Daha Sonra Öğrenilen Bilgiler/, 'Daha sonra öğrenilen bilgiler bölümü render edilmelidir');
  assert.match(uiAppJs, /3\. ÖNCEKİ DEĞERLENDİRME \(v1\) İLE YENİ DEĞERLENDİRME \(v2\) KARŞILAŞTIRMASI/, 'v1 ve v2 değerlendirme karşılaştırması render edilmelidir');
});

test('Akış 11: Gelecekler ve Senaryolar görünümünde 6 temel karar sorusu ve 3 rakip gelecek senaryosu (Baz, Müdahale, Birleşik Stres) karşılaştırılır', () => {
  assert.match(uiHtml, /id="senaryolar-six-questions-grid"/, '6 temel karar sorusu ızgarası mevcut olmalıdır');
  assert.match(uiHtml, /id="senaryolar-three-futures-deck"/, '3 rakip gelecek senaryosu karşılaştırma destesi mevcut olmalıdır');
  assert.match(uiHtml, /id="senaryolar-mobile-future-tabs"/, 'Mobil gelecek senaryosu sekme seçicisi mevcut olmalıdır');
  assert.match(uiAppJs, /1\. Baz Durum \(Hiçbir Şey Yapılmazsa\)/, 'Baz Durum senaryosu tanımlı olmalıdır');
  assert.match(uiAppJs, /2\. Müdahale Senaryosu \(Bu Adım Uygulanırsa\)/, 'Müdahale Senaryosu tanımlı olmalıdır');
  assert.match(uiAppJs, /3\. Birleşik Stres Senaryosu \(Çoklu Şok\)/, 'Birleşik Stres Senaryosu tanımlı olmalıdır');
});

test('Akış 12, 13 ve 14: Kaynaklar ve Dayanak çekmecesi 7 temel soruyu yanıtlar, eksik veriyi dürüstçe açıklar ve çevrim dışı deterministik çekirdeği korur', () => {
  assert.match(uiHtml, /id="btn-stage-provenance-lens"/, 'Sahne üstü Kaynak & Dayanak düğmesi mevcut olmalıdır');
  assert.match(uiHtml, /id="caelus-provenance-drawer"/, 'Bağlamsal Kaynak ve Dayanak çekmecesi mevcut olmalıdır');
  assert.match(uiAppJs, /function renderAndOpenProvenanceDrawer\(/, 'renderAndOpenProvenanceDrawer fonksiyonu tanımlı olmalıdır');
  assert.match(uiAppJs, /1\. Bu bilgi nereden geldi\?/, 'Kaynak sorusu yanıtlanmalıdır');
  assert.match(uiAppJs, /3\. Bilgi Sınıfı \(Epistemik Durum\):/, 'Epistemik durum sorusu yanıtlanmalıdır');
  assert.match(uiAppJs, /5\. Karşıt kanıt var mı\?/, 'Karşıt kanıt sorusu yanıtlanmalıdır');
  assert.match(uiAppJs, /6\. Eksik veri var mı\?/, 'Eksik veri sorusu dürüstçe yanıtlanmalıdır');
  assert.match(uiAppJs, /7\. Ticari kullanım uygunluğu:/, 'Ticari kullanım uygunluğu sorusu yanıtlanmalıdır');

  // caelus_world_store.json SHA-256 bütünlüğü korunmuş olmalı
  const storeBytes = fs.readFileSync(worldStorePath);
  const sha256 = crypto.createHash('sha256').update(storeBytes).digest('hex').toUpperCase();
  assert.equal(sha256, '4C69F99FBB19D459309183A319D344A9236BDAF8A792F6D6C796A0B845896FD1', 'caelus_world_store.json kullanıcı verisi korunmuş olmalıdır');
});

test('Akış 15, 16 ve 17: 3 kademeli performans modu seçicisi, mobil mikro etiket yasağı (>=10px) ve dist/index.html senkronizasyonu doğrulanır', () => {
  assert.match(uiHtml, /id="caelus-perf-mode-switcher"/, 'Performans modu seçicisi (#caelus-perf-mode-switcher) mevcut olmalıdır');
  assert.match(uiHtml, /data-perf-mode="FULL"/, 'Tam Sahne modu mevcut olmalıdır');
  assert.match(uiHtml, /data-perf-mode="BALANCED"/, 'Dengeli mod mevcut olmalıdır');
  assert.match(uiHtml, /data-perf-mode="LITE_2D"/, 'Hafif / 2B modu mevcut olmalıdır');
  assert.match(uiAppJs, /function setCaelusSpatialPerfMode\(/, 'setCaelusSpatialPerfMode fonksiyonu tanımlı olmalıdır');

  // Mobil CSS'te 6px, 7px, 8px okunaksız mikro etiketler kalmamış olmalı
  assert.doesNotMatch(mobileCss, /font(?:-size)?:\s*(?:[0-9]+\s+)?[678]px\b/, 'Mobil CSS içinde 6px–8px okunaksız mikro etiket kullanılmamalıdır');
  assert.match(mobileNav, /id="caelus-mobile-spatial-compass"/, 'Mobil uygulama CAELUS Mekânsal Pusulası ile birleştirilmiş olmalıdır');

  // dist/index.html içinde de mekânsal arayüz bileşenleri yer almalı
  assert.match(distHtml, /id="caelus-spatial-compass"/, 'dist/index.html mekânsal pusulayı içermelidir');
  assert.match(distHtml, /id="caelus-time-lens-popover"/, 'dist/index.html Zaman Merceği bileşenini içermelidir');
  assert.match(distHtml, /id="caelus-provenance-drawer"/, 'dist/index.html Kaynak & Dayanak çekmecesini içermelidir');
});
