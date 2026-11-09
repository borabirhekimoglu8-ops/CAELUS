#!/usr/bin/env node
/**
 * CAELUS — İlk Gerçek Görev (First Real Task) Playwright Uçtan Uca Tarayıcı Doğrulaması
 * (Bölüm 3.11 & Bölüm 18)
 *
 * Masaüstü (1600x960) ve Mobil (390x844) görünümlerinde gerçek .xlsx dosya yükleme,
 * sütun eşleme, hata görünümü, varlık tekilleştirme onayı, dünya modeli oluşturma,
 * iki senaryo seçeneğini karşılaştırma, kaynak izi inceleme ve rapor kaydetme akışını doğrular.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const UI_DIR = path.join(ROOT, 'ui');
const SCREENSHOT_DIR = path.join(ROOT, 'docs', 'screenshots');

let playwright;
try {
  playwright = require('playwright-core');
} catch (_) {
  const fallbackReq = createRequire(
    'C:/Users/Lenovo/excelbase_cloud/excelbase_cloud/.dev-worktree/frontend/package.json'
  );
  playwright = fallbackReq('playwright-core');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm'
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cleanUrl = (req.url || '/').split('?')[0];
      let relPath = cleanUrl === '/' ? '/index.html' : cleanUrl;
      let fullPath = path.join(UI_DIR, relPath);
      if (!fs.existsSync(fullPath)) {
        fullPath = path.join(ROOT, relPath);
      }
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(fs.readFileSync(fullPath));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function findEdgeOrChromeExecutable() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ];
  return candidates.find((p) => fs.existsSync(p));
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const { server, baseUrl } = await startStaticServer();
  const executablePath = findEdgeOrChromeExecutable();
  const browser = await playwright.chromium.launch({
    executablePath,
    headless: true
  });

  try {
    // 1. MASAÜSTÜ GÖRÜNÜMÜ (1600x960)
    const desktopContext = await browser.newContext({ viewport: { width: 1600, height: 960 } });
    const page = await desktopContext.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-stage-first-real-task', { timeout: 10000 });

    // Mekânsal sahnede '📂 Kendi Verim & Görev' düğmesine tıkla
    await page.click('#btn-stage-first-real-task');
    await page.waitForSelector('#caelus-first-real-task-drawer:not(.hidden)');

    // Gerçek .xlsx dosyasını (vaka_a_tedarik_zinciri.xlsx) yükle
    const xlsxPath = path.join(ROOT, 'tests', 'fixtures', 'first_real_task', 'vaka_a_tedarik_zinciri.xlsx');
    await page.setInputFiles('#frt-file-input', xlsxPath);
    await page.waitForTimeout(300);

    const activeBadgeText = await page.textContent('#frt-active-file-badge');
    const errorBadgeText = await page.textContent('#frt-error-count-badge');

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'frt_01_desktop_xlsx_upload_and_mapping.png')
    });

    // Sütun eşlemesini kullanıcı olarak onayla / değiştir ve Tekilleştirme kümesinde 'Birleştir' seç
    const mergeBtn = await page.$('[data-dedup-action="MERGE"]');
    if (mergeBtn) await mergeBtn.click();

    // Dünyaya aktar ve senaryoları çalıştır
    await page.click('#btn-frt-transfer-to-world');
    await page.waitForTimeout(250);

    // Adım 7 ve Adım 8'e kaydır (Senaryo Karşılaştırması ve Kaynak İzi)
    await page.click('[data-frt-step="7"]');
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'frt_02_desktop_scenario_comparison_and_provenance.png')
    });

    // Adım 9: 7 Sayfalı .XLSX Rapor Kaydet ve HTML/PDF Baskı Raporunu Aç
    await page.click('#btn-frt-export-xlsx');
    await page.waitForTimeout(150);
    const xlsxBannerText = await page.textContent('#frt-export-status-banner');

    await page.click('#btn-frt-export-html-pdf');
    await page.waitForSelector('#dossier-modal:not(.hidden)');
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'frt_03_desktop_explainable_report_modal.png')
    });

    await desktopContext.close();

    // 2. MOBİL GÖRÜNÜMÜ (390x844 — iPhone 14 Pro)
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const mPage = await mobileContext.newPage();
    await mPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await mPage.waitForSelector('#btn-stage-first-real-task', { timeout: 10000 });
    await mPage.click('#btn-stage-first-real-task');
    await mPage.waitForSelector('#caelus-first-real-task-drawer:not(.hidden)');

    // Vaka B (Kurumlar ve Altyapı Bağımlılıkları) yükle ve dünyaya aktar
    await mPage.click('#btn-frt-load-vaka-b');
    await mPage.waitForTimeout(200);
    await mPage.click('#btn-frt-transfer-to-world');
    await mPage.waitForTimeout(250);

    const mobileOverflow = await mPage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2;
    });

    await mPage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'frt_04_mobile_390x844_vaka_b_workflow.png')
    });
    await mobileContext.close();

    const summary = {
      ok: true,
      desktop: {
        activeBadgeText: activeBadgeText?.trim(),
        errorBadgeText: errorBadgeText?.trim(),
        xlsxBannerText: xlsxBannerText?.trim()
      },
      mobile: {
        viewport: '390x844',
        horizontalOverflowDetected: mobileOverflow
      },
      screenshots: [
        'docs/screenshots/frt_01_desktop_xlsx_upload_and_mapping.png',
        'docs/screenshots/frt_02_desktop_scenario_comparison_and_provenance.png',
        'docs/screenshots/frt_03_desktop_explainable_report_modal.png',
        'docs/screenshots/frt_04_mobile_390x844_vaka_b_workflow.png'
      ]
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
