#!/usr/bin/env node
// ============================================================================
// CAELUS — AŞAMA 5 & AŞAMA 7: Uçtan Uca Çok Alanlı Dünya Etki Motoru Gösterimi
// Çalıştırma:
//   node tools/run_e2e_world_analysis_demo.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import '../ui/scenario_compiler.js';

const compiler = globalThis.CaelusScenarioCompiler;
const suite = compiler.CaelusTwelveCapabilitiesSuite;

const demoResult = suite.runEndToEndWorldAnalysisDemo({
  seed: 20260410,
  decisionCutoffTimeIso: '2026-10-15T12:00:00.000Z'
});

const wieResult = suite.runWorldImpactEngineWorkflow({
  problemId: 'PROB_ENERGY_TECH_FIN_TRADE',
  decisionCutoffTimeIso: '2026-10-15T12:00:00.000Z',
  eventDurationHours: 48,
  capacityOrResourceAmountPct: 68,
  actorBehaviorPolicy: 'COOPERATIVE_SHARING',
  alternativeSupplyBufferPct: 35,
  relationLagTicks: 2,
  interventionChoice: 'L-MAS-COORD-01',
  seed: 20260410,
  executionEngineMode: 'JS_FIXED_POINT_1E6_MIRROR'
});

const wieInsufficientResult = suite.runWorldImpactEngineWorkflow({
  problemId: 'PROB_INSUFFICIENT_DATA_HONEST_STOP',
  decisionCutoffTimeIso: '2026-10-15T12:00:00.000Z',
  seed: 20260410
});

// Opsiyonel: Platform ikilisi (dist/caelus_os[.exe]) mevcutsa derlenen ScenarioPack'i yerel C++17 motorunda da doğrula
const distDir = path.resolve(process.cwd(), 'dist');
const binName = process.platform === 'win32' ? 'caelus_os.exe' : 'caelus_os';
const exePath = path.join(distDir, binName);
let nativeEngineVerification = { executed: false, status: 'BINARY_NOT_FOUND', binaryPath: exePath };

if (fs.existsSync(exePath)) {
  const pack = wieResult.stage7_EngineExecution.compiledPrimaryScenarioPack;
  const replInput = `load_json ${JSON.stringify(pack)}\ncompare_lever L-MAS-COORD-01 16 20260410\nquit\n`;
  const proc = spawnSync(exePath, ['--det-mode', '--repl'], {
    input: replInput,
    encoding: 'utf8',
    timeout: 15000
  });
  const cfMatch = (proc.stdout || '').match(/\[REPL_COUNTERFACTUAL\]\s*(\{.*\})/);
  if (proc.status === 0 && cfMatch) {
    const parsedCf = JSON.parse(cfMatch[1]);
    nativeEngineVerification = {
      executed: true,
      status: 'NATIVE_CPP17_REPL_VERIFIED',
      binaryPath: exePath,
      exitCode: proc.status,
      branchAThroughputRatio: parsedCf.branch_a.throughput_ratio,
      branchBThroughputRatio: parsedCf.branch_b.throughput_ratio
    };
  }
}

const p = demoResult.progressiveDisclosurePresentation;
console.log('======================================================================');
console.log('CAELUS — UÇTAN UCA ÇOK ALANLI DÜNYA ETKİ MOTORU GÖSTERİMİ');
console.log('======================================================================');
console.log(`\n[${p.step1_QuestionAndEvent.titleTr}]`);
console.log(`  Soru          : ${wieResult.questionTr}`);
console.log(`  Karar Kesimi  : ${wieResult.decisionCutoffTimeIso}`);
console.log(`  Veri Kökeni   : ${wieResult.dataProvenanceLabelTr}`);

const st1 = wieResult.stage1_DataAndSources;
console.log(`\n[1. VERİ KAYNAKLARI, ÇİFT ZAMANLI HAFIZA VE DOĞRULAMA KAPILARI]`);
console.log(`  Kabul Edilen Kayıtlar          : ${st1.acceptedCount} (Doğrudan Gözlem=${st1.verifiedFactCount})`);
console.log(`  Engellenen Gelecek/Geçersiz    : ${st1.blockedLookAheadOrInvalidDateCount} (Anti-Look-Ahead)`);
console.log(`  Eksik Veri Boşlukları          : ${st1.missingDataGapCount}`);
console.log(`  Korunan Çelişkili İddia Sayısı : ${st1.preservedConflictCount}`);
console.log(`  Bağımsız Kaynak Tekilleştirme  : Ham=${st1.sourceDeduplicationReport.totalReportsCount} -> Bağımsız=${st1.sourceDeduplicationReport.independentPrimaryEvidenceCount}`);

const st4 = wieResult.stage4_IndirectImpactPaths;
console.log(`\n[2. ÇOK KATMANLI İLİŞKİ AĞI VE DOLAYLI ETKİ YOLLARI]`);
console.log(`  Birincil Etki Yolu  : ${st4.primaryIndirectPath ? st4.primaryIndirectPath.nodeLabels.join(' -> ') : 'Yok'}`);
console.log(`  Geçilen Alanlar     : ${st4.primaryIndirectPath ? st4.primaryIndirectPath.domainsTraversed.join(' -> ') : 'Yok'}`);
console.log(`  Bütçe Durumu        : Adım=${st4.budgetReport.expansionStepsExecuted}, Döngü Önleme=${st4.budgetReport.detectedCyclesSkipped}`);

const st5 = wieResult.stage5_CounterEvidenceAndAlternatives;
console.log(`\n[3. KARŞIT KANIT, ÇELİŞKİLER VE ALTERNATİF AÇIKLAMALAR]`);
console.log(`  Korunan Çelişkili İddia Sayısı : ${st5.conflicts.length}`);
if (st5.primaryCritique) {
  for (const alt of st5.primaryCritique.alternativeExplanations) {
    console.log(`  Alternatif Açıklama : [${alt.plainBadgeTr}] (${alt.type}) ${alt.explanationTr}`);
  }
}

const st6 = wieResult.stage6_MultiScenarioComparison;
console.log(`\n[4. 3 SENARYOLU KARŞILAŞTIRMALI SİMÜLASYON (int64 x 1e6)]`);
for (const sc of st6.scenarios) {
  console.log(`  - ${sc.titleTr}: Akış=%${sc.throughputPct}, Tepe Stres=%${sc.peakStressPct}, Kesinti=${sc.outageActive}`);
}

const st8 = wieResult.stage8_ConclusionUncertaintyAndAudit;
console.log(`\n[5. SONUÇ, BELİRSİZLİK, BASELINE KARŞILAŞTIRMASI VE DENETİM İZİ]`);
console.log(`  Karar Durumu                 : ${wieResult.status}`);
console.log(`  Koordinasyon Katkısı (S2-S1) : +%${st6.netCooperativeGainPct}`);
console.log(`  Özel Senaryo Farkı (S3-S1)   : +%${st6.netCustomGainVsUnmitigatedPct}`);
console.log(`  Topluluk Beklenen Akış       : %${st8.ensembleSummary.ensembleMean} (90% GA: [${st8.ensembleSummary.credibleInterval90.low}, ${st8.ensembleSummary.credibleInterval90.high}])`);
console.log(`  Baseline MAE Karşılaştırması : ${st8.baselineEvaluation.methods.map(m => `${m.methodId}=${m.mae}`).join(', ')}`);
console.log(`  Ajan Kapısı Denetimi         : YetkisizYazmaİzni=${st8.securityGateChecks.attemptedUnauthorizedWriteResult?.allowed}, YetkisizAğİzni=${st8.securityGateChecks.attemptedUnauthorizedNetworkResult?.allowed}`);
console.log(`  Hafif İz Özeti (FNV-1a 32b)  : ${st8.auditTrail.finalChainHeadHash} (${st8.auditTrail.hashAlgorithm})`);
console.log(`  İçerik Zincir Başı (SHA-256) : ${st8.auditTrail.finalSha256ChainHead}`);
console.log(`  Deterministik Tekrar Kanıtı  : ${wieResult.deterministicReplayVerified} (SHA-256=${wieResult.run1Sha256.slice(0, 16)}...)`);
console.log(`  Yetersiz Veri Dürüst Durdurma: ${wieInsufficientResult.status} (honestStopTriggered=${wieInsufficientResult.honestStopTriggered}, Rozet=${wieInsufficientResult.plainBadgeTr})`);
if (nativeEngineVerification.executed) {
  console.log(`  C++17 Yerel Motor Doğrulaması: [${nativeEngineVerification.status}] (${nativeEngineVerification.binaryPath}) Dal A=${nativeEngineVerification.branchAThroughputRatio}, Dal B=${nativeEngineVerification.branchBThroughputRatio}`);
} else {
  console.log(`  C++17 Yerel Motor Doğrulaması: [${nativeEngineVerification.status}] (${nativeEngineVerification.binaryPath})`);
}
console.log('======================================================================');
