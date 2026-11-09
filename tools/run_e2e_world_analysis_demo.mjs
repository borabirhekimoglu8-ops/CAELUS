#!/usr/bin/env node
// ============================================================================
// CAELUS — AŞAMA 5: Uçtan Uca Çok Alanlı Dünya Analizi Gösterimi (CLI Runner)
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

// Opsiyonel: Platform ikilisi (dist/caelus_os[.exe]) mevcutsa derlenen ScenarioPack'i yerel C++17 motorunda da doğrula
const distDir = path.resolve(process.cwd(), 'dist');
const binName = process.platform === 'win32' ? 'caelus_os.exe' : 'caelus_os';
const exePath = path.join(distDir, binName);
let nativeEngineVerification = { executed: false, status: 'BINARY_NOT_FOUND' };

if (fs.existsSync(exePath)) {
  const pack = demoResult.scenarioCooperative.compiledScenarioPack;
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
      binaryPath: exePath,
      exitCode: proc.status,
      branchAThroughputRatio: parsedCf.branch_a.throughput_ratio,
      branchBThroughputRatio: parsedCf.branch_b.throughput_ratio
    };
  }
}

const p = demoResult.progressiveDisclosurePresentation;
console.log('======================================================================');
console.log('CAELUS — AŞAMA 5: UÇTAN UCA ÇOK ALANLI DÜNYA ANALİZİ GÖSTERİMİ');
console.log('======================================================================');
console.log(`\n[${p.step1_QuestionAndEvent.titleTr}]`);
console.log(`  Soru          : ${p.step1_QuestionAndEvent.questionTr}`);
console.log(`  Karar Kesimi  : ${p.step1_QuestionAndEvent.decisionCutoffTimeIso}`);

console.log(`\n[${p.step2_SourcesAndTemporalGate.titleTr}]`);
console.log(`  Kabul Edilen Kayıtlar          : ${p.step2_SourcesAndTemporalGate.acceptedRecordsCount}`);
console.log(`  Engellenen Gelecek Sızıntısı   : ${p.step2_SourcesAndTemporalGate.blockedLookAheadCount} (Anti-Look-Ahead)`);
console.log(`  Bilinmeyen / Eksik Veri Alanı  : ${p.step2_SourcesAndTemporalGate.missingDataGapsCount}`);
console.log(`  Korunan Çelişkili İddia Sayısı : ${p.step2_SourcesAndTemporalGate.preservedConflictingClaimsCount}`);

console.log(`\n[${p.step3_RelationsAndHypotheses.titleTr}]`);
console.log(`  Dolaylı Etki Yolu   : ${p.step3_RelationsAndHypotheses.indirectPathSummary}`);
console.log(`  Geçilen Alanlar     : ${p.step3_RelationsAndHypotheses.domainsTraversed.join(' -> ')}`);
console.log(`  Bilgi Durumu        : ${p.step3_RelationsAndHypotheses.epistemicLabelTr}`);
console.log(`  Sembolik Kapı Özeti : Doğrulanan Gözlem=${p.step3_RelationsAndHypotheses.symbolicVerificationSummary.verifiedFactPromotions}, Karantina Hipotez=${p.step3_RelationsAndHypotheses.symbolicVerificationSummary.quarantinedHypotheses}`);
for (const alt of p.step3_RelationsAndHypotheses.alternativeExplanations) {
  console.log(`  Alternatif Açıklama : [${alt.type}] ${alt.explanationTr}`);
}

console.log(`\n[${p.step4_Scenarios.titleTr}]`);
console.log(`  1) ${p.step4_Scenarios.scenario1_HoardingNoCoord.title}:`);
console.log(`     Akış Oranı=%${p.step4_Scenarios.scenario1_HoardingNoCoord.throughputPct}, Tepe Stres=%${p.step4_Scenarios.scenario1_HoardingNoCoord.peakStressPct}, Kesinti=${p.step4_Scenarios.scenario1_HoardingNoCoord.outageActive}`);
console.log(`  2) ${p.step4_Scenarios.scenario2_CooperativeWithCoord.title}:`);
console.log(`     Akış Oranı=%${p.step4_Scenarios.scenario2_CooperativeWithCoord.throughputPct}, Tepe Stres=%${p.step4_Scenarios.scenario2_CooperativeWithCoord.peakStressPct}, Kesinti=${p.step4_Scenarios.scenario2_CooperativeWithCoord.outageActive}`);

console.log(`\n[${p.step5_ConclusionGroundsAndUncertainty.titleTr}]`);
console.log(`  Koordinasyon Katkısı (ΔAkış) : +%${p.step5_ConclusionGroundsAndUncertainty.throughputDifferencePct}`);
console.log(`  Topluluk Beklenen Akış       : %${p.step5_ConclusionGroundsAndUncertainty.bayesianEnsembleSummary.ensembleMean} (90% GA: [${p.step5_ConclusionGroundsAndUncertainty.bayesianEnsembleSummary.credibleInterval90.low}, ${p.step5_ConclusionGroundsAndUncertainty.bayesianEnsembleSummary.credibleInterval90.high}])`);
console.log(`  Model Uyuşmazlığı (Std)      : ${p.step5_ConclusionGroundsAndUncertainty.bayesianEnsembleSummary.epistemicBetweenModelDisagreementStd}`);
console.log(`  Kalibrasyon Durumu           : ${p.step5_ConclusionGroundsAndUncertainty.calibrationStatus}`);
console.log(`  Denetim Zincir Başı (Audit)  : ${p.step5_ConclusionGroundsAndUncertainty.auditChainHeadHash}`);
console.log(`  Veri Sürüm Özeti (Commit)    : ${p.step5_ConclusionGroundsAndUncertainty.dataVersionCommitHash}`);
console.log(`  Deterministik Tekrar Kanıtı  : ${demoResult.deterministicReplayVerified} (SHA-256=${demoResult.run1Sha256.slice(0, 16)}...)`);
if (nativeEngineVerification.executed) {
  console.log(`  C++17 Yerel Motor Doğrulaması: Dal A=${nativeEngineVerification.branchAThroughputRatio}, Dal B=${nativeEngineVerification.branchBThroughputRatio}`);
}
console.log('======================================================================');
