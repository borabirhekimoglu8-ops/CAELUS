import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const lwm = require('../ui/living_world_model.js');
const compiler = require('../ui/scenario_compiler.js');

test('Senaryo 1 & 2: Aynı olay için iki farklı bilgi kesiminde (T1 vs T2) farklı dünya durumları oluşturulur ve gelecekte öğrenilen veri geçmiş analize giremez', () => {
  const result = lwm.runTwoDateHistoricalRealityTest({
    dateT1Iso: '2021-02-17T18:00:00.000Z',
    dateT2Iso: '2021-03-18T18:00:00.000Z'
  });

  const dualT1 = lwm.answerLivingWorldDualQuestionsAtDate(result.memoryStore, '2021-02-17T18:00:00.000Z');
  const dualT2 = lwm.answerLivingWorldDualQuestionsAtDate(result.memoryStore, '2021-03-18T18:00:00.000Z');

  assert.equal(dualT1.valid, true);
  assert.equal(dualT2.valid, true);
  assert.NotEqual?.(dualT1.snapshotHashSha256, dualT2.snapshotHashSha256);
  assert.notEqual(dualT1.snapshotHashSha256, dualT2.snapshotHashSha256);

  // T1 (17 Şubat 2021) tarihinde erişilebilir kayıt sayısı bağımsız beklenen değer: 8 (3 varlık + 5 T1 kaydı)
  assert.equal(dualT1.question2_WhatInformationDidCaelusHaveAccessToAtDate.accessibleRecordCount, 8);
  // T2 (18 Mart 2021) tarihinde erişilebilir kayıt sayısı: 8 + 1 geri çekme + 1 düzeltme + 2 yeni gözlem = 12
  assert.equal(dualT2.question2_WhatInformationDidCaelusHaveAccessToAtDate.accessibleRecordCount, 12);

  // Gelecekte (17 Mart 2021 ve 16 Kasım 2021) öğrenilen kayıtlar T1 analizinde kesinlikle engellenmiş olmalı
  const t1AccessibleIds = dualT1.question2_WhatInformationDidCaelusHaveAccessToAtDate.accessibleRecords.map(r => r.recordId);
  assert.equal(t1AccessibleIds.includes('OBS-NXP-100M-REVENUE-IMPACT-20210317'), false);
  assert.equal(t1AccessibleIds.includes('OBS-AUTO-OEM-CURTAILMENTS-20210316'), false);
  assert.equal(t1AccessibleIds.includes('OBS-FERC-NERC-FINAL-REPORT-20211116'), false);

  // Kasım 2021 FERC/NERC raporu (olay zamanı 15 Şubat 2021 olmasına rağmen yayın zamanı 16 Kasım 2021) T2 (18 Mart 2021) kesiminde de engellenmeli
  const t2AccessibleIds = dualT2.question2_WhatInformationDidCaelusHaveAccessToAtDate.accessibleRecords.map(r => r.recordId);
  assert.equal(t2AccessibleIds.includes('OBS-FERC-NERC-FINAL-REPORT-20211116'), false);

  // Geçersiz takvim tarihi (2026-02-30) reddedilmeli
  const invalidDateQuery = lwm.answerLivingWorldDualQuestionsAtDate(result.memoryStore, '2026-02-30T10:00:00.000Z');
  assert.equal(invalidDateQuery.valid, false);
  assert.match(invalidDateQuery.reason, /CALENDAR_ROLLOVER_INVALID_DATE/);
});

test('Senaryo 3 & 4: Düzeltilmiş/geri çekilmiş bilginin eski sürümü korunur ve çelişen iki kaynak birlikte kaydedilir', () => {
  const result = lwm.runTwoDateHistoricalRealityTest();
  const store = result.memoryStore;

  // CLM-ENG-CLEANROOM-28D-REQUALIFICATION kaydı 17 Mart 2021'de 30 günden 29 güne düzeltildi (v2)
  const correctedRec = store.recordsById.get('CLM-ENG-CLEANROOM-28D-REQUALIFICATION');
  assert.equal(correctedRec.versionNumber, 2);
  assert.equal(correctedRec.value, 29);
  assert.equal(correctedRec.revisionHistory.length, 1);
  assert.equal(correctedRec.revisionHistory[0].recordSnapshot.versionNumber, 1);
  assert.equal(correctedRec.revisionHistory[0].recordSnapshot.value, 30);

  // T1 (17 Şubat) sorgusunda düzeltme öncesi eski sürüm (v1, value=30) görünmeli!
  const dualT1 = lwm.answerLivingWorldDualQuestionsAtDate(store, '2021-02-17T18:00:00.000Z');
  const engAtT1 = dualT1.question1_WhatWasBelievedAboutWorldAtDate.activeBeliefs.find(
    r => r.recordId === 'CLM-ENG-CLEANROOM-28D-REQUALIFICATION'
  );
  assert.ok(engAtT1);
  assert.equal(engAtT1.versionNumber, 1);
  assert.equal(engAtT1.value, 30);

  // CLM-EARLY-MEDIA-48H-RESTART kaydı 5 Mart 2021'de geri çekildi, ancak T1'de hâlâ aktif ve çelişki kümesinde yer almalı
  const conflictsAtT1 = dualT1.question1_WhatWasBelievedAboutWorldAtDate.activeConflictsPreserved;
  assert.equal(conflictsAtT1.length, 1);
  assert.equal(conflictsAtT1[0].subjectKey, 'austin_fab_restart_days');
  assert.deepEqual(conflictsAtT1[0].competingValues, [2, 30]);
  assert.equal(conflictsAtT1[0].preservedSideBySide, true);
});

test('Senaryo 5 & 6: Çok adımlı uzak bağlantı yolu açıklanabilir biçimde gösterilir ve aday ilişki doğrulanmış nedensellik olarak sunulmaz', () => {
  const result = lwm.runTwoDateHistoricalRealityTest();
  const dist = result.distantConnections;

  assert.equal(dist.status, 'CANDIDATE_PATHS_FOUND');
  assert.ok(dist.candidatePaths.length >= 2);

  const primaryPath = dist.candidatePaths.find(
    p => p.sourceNodeId === 'NODE_ERCOT_GRID' && p.targetNodeId === 'NODE_GLOBAL_AUTO_OEM_FINANCE'
  );
  assert.ok(primaryPath);
  assert.ok(primaryPath.hopCount >= 3);
  assert.ok(primaryPath.distinctDomainCount >= 3);
  assert.equal(primaryPath.isProvenCausality, false);
  assert.match(primaryPath.pathEpistemicStatus, /CANDIDATE_HYPOTHESIS_PATH_NOT_PROVEN_CAUSALITY/);
  assert.ok(primaryPath.whyProposedTr.length > 15);
  assert.ok(primaryPath.alternativeExplanationsTr.length >= 1);
  assert.ok(primaryPath.whatDataWouldWeakenItTr.length >= 1);

  // Döngü içeren bir grafikte döngülerin engellendiğini ve bütçe sınırının çalıştığını doğrula
  const cyclicGraph = {
    nodes: [
      { nodeId: 'N1', domain: 'D1' },
      { nodeId: 'N2', domain: 'D2' },
      { nodeId: 'N3', domain: 'D3' }
    ],
    edges: [
      { sourceNodeId: 'N1', targetNodeId: 'N2', lagHours: 5 },
      { sourceNodeId: 'N2', targetNodeId: 'N1', lagHours: 5 }, // Döngü!
      { sourceNodeId: 'N2', targetNodeId: 'N3', lagHours: 10 }
    ]
  };
  const cyclicRes = lwm.discoverDistantCrossDomainConnections(cyclicGraph, { sourceNodeId: 'N1', maxHops: 4 });
  assert.ok(cyclicRes.cyclesAvoidedCount >= 1);
});

test('Senaryo 7 & 8: Hipoteze karşı kanıt eklenir, hipotez durumu güncellenir ve doğrulama kapısından geçmeyen hipotez gözlem yapılamaz', () => {
  const ledger = lwm.createHypothesisLedger();
  lwm.registerLivingHypothesis(ledger, {
    hypothesisId: 'H-TEST-01',
    titleTr: 'Test Hipotezi',
    createdAtIso: '2021-02-17T10:00:00.000Z',
    expectedObservationsIfTrue: ['Gözlem A'],
    weakeningObservations: ['Ters Gözlem B'],
    alternativeExplanations: ['Alternatif Mekanizma C'],
    missingInformation: ['Eksik Veri D']
  });

  // Destekleyici kanıt ekle -> DESTEKLEYEN KANIT VAR
  const supRes = lwm.submitHypothesisEvidence(ledger, 'H-TEST-01', {
    evidenceId: 'EV-SUP-1',
    polarity: 'SUPPORTING_EVIDENCE',
    learnedAtTimeIso: '2021-02-18T10:00:00.000Z',
    weight: 1.0,
    summaryTr: 'İlk destekleyici bulgu'
  });
  assert.equal(supRes.newStatus, 'DESTEKLEYEN KANIT VAR');

  // Karşı kanıt ekle -> KARŞIT KANIT VAR
  const cntRes = lwm.submitHypothesisEvidence(ledger, 'H-TEST-01', {
    evidenceId: 'EV-CNT-1',
    polarity: 'COUNTER_EVIDENCE',
    learnedAtTimeIso: '2021-02-20T10:00:00.000Z',
    weight: 1.0,
    summaryTr: 'İlk karşıt bulgu'
  });
  assert.equal(cntRes.newStatus, 'KARŞIT KANIT VAR');

  // Doğrulama kapısından geçmeden hipotezi doğrulanmış gözlem (BILINEN) olarak sunma girişimi engellenmeli!
  const blockedPromo = lwm.attemptHypothesisPromotionToObservation(ledger, 'H-TEST-01', {
    independentPrimarySourceIds: ['SRC-1'],
    passedSymbolicConstraintGate: false
  });
  assert.equal(blockedPromo.promoted, false);
  assert.equal(blockedPromo.reason, 'HYPOTHESIS_CANNOT_BE_PRESENTED_AS_VERIFIED_OBSERVATION_WITHOUT_GATE');

  // Kesin çürütücü karşı kanıt ekle -> GERİ ÇEKİLDİ
  const falsifyRes = lwm.submitHypothesisEvidence(ledger, 'H-TEST-01', {
    evidenceId: 'EV-CNT-DECISIVE',
    polarity: 'COUNTER_EVIDENCE',
    learnedAtTimeIso: '2021-03-01T10:00:00.000Z',
    weight: 3.0,
    isDecisiveFalsifier: true,
    summaryTr: 'Resmi ölçüm hipotezi çürüttü'
  });
  assert.equal(falsifyRes.newStatus, 'GERİ ÇEKİLDİ');
  assert.equal(ledger.hypothesesById.get('H-TEST-01').evaluationHistory.length, 4);
});

test('Senaryo 9: Önceki değerlendirme (T1) ile güncel değerlendirme (T2) karşılaştırılır ve önceki değerlendirme değiştirilmeden korunur', () => {
  const result = lwm.runTwoDateHistoricalRealityTest({
    dateT1Iso: '2021-02-17T18:00:00.000Z',
    dateT2Iso: '2021-03-18T18:00:00.000Z'
  });
  const diff = result.beliefRevisionComparison;

  assert.equal(diff.valid, true);
  assert.equal(diff.previousAssessmentPreservedUnchanged, true);
  assert.equal(diff.previousAssessment.versionNumber, 1);
  assert.equal(diff.currentAssessment.versionNumber, 2);
  assert.equal(diff.currentAssessment.previousAssessmentId, diff.previousAssessment.assessmentId);

  // HYP-1 T1'de DESTEKLEYEN KANIT VAR iken T2'de GERİ ÇEKİLDİ olmalı
  assert.equal(diff.retractedHypotheses.length, 1);
  assert.equal(diff.retractedHypotheses[0].hypothesisId, 'HYP-1-FAST-48H-RECOVERY');
  assert.equal(diff.retractedHypotheses[0].statusAtT1, 'DESTEKLEYEN KANIT VAR');
  assert.equal(diff.retractedHypotheses[0].statusAtT2, 'GERİ ÇEKİLDİ');

  // HYP-2 T2'de güçlenmiş olmalı
  assert.equal(diff.strengthenedHypotheses.length, 1);
  assert.equal(diff.strengthenedHypotheses[0].hypothesisId, 'HYP-2-MULTI-WEEK-CLEANROOM-AND-OEM-CASCADE');

  // Düzeltilen ve geri çekilen kayıtlar eski sürümleriyle raporlanmalı
  assert.equal(diff.subsequentlyCorrectedRecords.length, 1);
  assert.equal(diff.subsequentlyRetractedRecords.length, 1);
  assert.ok(diff.unchangedAssumptions.length >= 1);
  assert.ok(diff.stillUnknownInformation.length >= 1);
});

test('Senaryo 10, 11 & 12: En az 3 senaryo aynı başlangıç durumuyla çalışır, yetersiz veride sahte sonuç üretilmez ve tekrar çalıştırma bit-özdeştir', () => {
  const run1 = lwm.runTwoDateHistoricalRealityTest({
    dateT1Iso: '2021-02-17T18:00:00.000Z',
    dateT2Iso: '2021-03-18T18:00:00.000Z',
    eventDurationHours: 48,
    backupCapacityPct: 68
  });
  const run2 = lwm.runTwoDateHistoricalRealityTest({
    dateT1Iso: '2021-02-17T18:00:00.000Z',
    dateT2Iso: '2021-03-18T18:00:00.000Z',
    eventDurationHours: 48,
    backupCapacityPct: 68
  });

  // Senaryo 12: Bit-özdeş deterministik tekrar oynatım
  assert.equal(run1.deterministicReplaySha256, run2.deterministicReplaySha256);
  assert.equal(
    run1.beliefRevisionComparison.replayIntegritySha256,
    run2.beliefRevisionComparison.replayIntegritySha256
  );

  // Senaryo 10: 3 senaryo ve 5 ölçek
  assert.equal(run1.multiScaleFutures.scenarios.length, 3);
  assert.equal(run1.multiScaleFutures.scalesRepresented.length, 5);
  assert.equal(run1.multiScaleFutures.counterfactualComparison.sameInitialConditionsVerified, true);
  assert.ok(run1.multiScaleFutures.counterfactualComparison.throughputDeltaPctPoints > 0);

  // Senaryo 11: Yetersiz veri durumunda sahte sonuç üretilmemesi
  const insufficientFutures = lwm.runMultiScaleMultiActorFutures({ insufficientData: true });
  assert.equal(insufficientFutures.status, 'INSUFFICIENT_DATA_STOP');
  assert.equal(insufficientFutures.scenarios.length, 0);

  // Kullanıcı dünyasında eksik veri gerektiren soru (UQ-2) için dürüst "BU SORU MEVCUT VERİYLE YANITLANAMIYOR" yanıtı
  const uq2 = run1.userWorldImpact.questionAnswers.find(q => q.questionId === 'UQ-2');
  assert.ok(uq2);
  assert.equal(uq2.answerStatus, 'BU SORU MEVCUT VERİYLE YANITLANAMIYOR');
});

test('Senaryo 13: Ticari envanterde belirsiz (İNCELEMEDE), dışlanan veya kırmızı çizgiyi ihlal eden bileşen otomatik onaylanmaz', () => {
  const audit = lwm.auditCommercialComponentInventory();
  assert.equal(audit.allUncertainOrExcludedBlockedFromBundle, true);
  assert.equal(audit.legalCertitudeClaimed, false);
  assert.ok(audit.approvedCount >= 6);
  assert.ok(audit.underReviewCount >= 2);
  assert.ok(audit.excludedCount >= 4);

  // Kırmızı çizgi testi: commercialUseAllowed=false olan bir bileşen yanlışlıkla ONAYLI ADAY olarak işaretlenirse otomatik reddedilmeli!
  const badInventory = [
    {
      componentId: 'FAKE-RESEARCH-ONLY-WEIGHTS',
      name: 'Research Only Model Weights',
      sourceAndVersion: 'v1.0',
      licenseOrTerms: 'CC-BY-NC-4.0 (Non-Commercial)',
      commercialUseAllowed: false,
      closedSourceCompatible: false,
      targetDeploymentCompatible: false,
      customerOnPremRedistributionAllowed: false,
      copyleftOrDisclosureObligation: 'Non-commercial restriction',
      attributionOrNoticeRequired: true,
      modelWeightsSeparateTerms: 'Research only',
      dataRightsSummary: 'No commercial rights',
      offlineCapable: true,
      feeQuotaOrVendorLockIn: 'None',
      directReferenceUrl: 'https://example.org/license',
      commercialStatus: 'ONAYLI ADAY'
    }
  ];
  const badAudit = lwm.auditCommercialComponentInventory(badInventory);
  assert.equal(badAudit.approvedCount, 0);
  assert.equal(badAudit.redLineViolationCount, 1);
  assert.equal(badAudit.excludedComponents[0].autoApproved, false);

  // Çok modlu gözlem sözleşmesi: ağırlık lisansı doğrulanmamış görsel model çıktısı ticari veri paketine alınmaz ve doğrudan gözlem sayılmaz
  const modalCheck = lwm.registerMultimodalObservationWithContract({
    recordId: 'VID-INF-01',
    modality: 'VIDEO',
    sourceId: 'SATELLITE-VIDEO-FEED',
    isModelDerivedInference: true,
    modelName: 'V-JEPA-2.1-PROTOTYPE',
    modelVersion: '2.1.0',
    weightsLicenseVerified: false,
    commercialRightsStatus: 'TİCARİ PAKETİN DIŞINDA'
  });
  assert.equal(modalCheck.epistemicClassification, 'MODEL_INFERENCE_NOT_RAW_OBSERVATION');
  assert.equal(modalCheck.admittedToCommercialDatasetPack, false);
});

test('Senaryo 14 & 15: Ağsız (Air-Gapped) çekirdek doğrulaması, Grafik Öğrenme Deneyi dürüstlüğü ve 9 adımlı kullanıcı arayüzü bağlaması', () => {
  // Senaryo 14: Ağ çağrıları tamamen engelliyken Yaşayan Dünya Modeli çekirdeğinin çalışması
  const origFetch = globalThis.fetch;
  let networkCalled = false;
  globalThis.fetch = () => {
    networkCalled = true;
    throw new Error('AIR_GAPPED_CORE_NETWORK_FORBIDDEN');
  };
  try {
    const res = lwm.runTwoDateHistoricalRealityTest();
    assert.equal(networkCalled, false);
    assert.ok(res.deterministicReplaySha256.length === 64);

    // Grafik öğrenme deneyinde hem gelişmiş modelin kazandığı rejimin hem de basit referansın kazandığı rejimin dürüstçe raporlanması
    const gexp = res.graphExperiment;
    assert.equal(gexp.regime1_MultiHopDelayedCascade.winnerModel, 'EXPERIMENTAL_2HOP_MESSAGE_PASSING_GWM');
    assert.equal(gexp.regime2_ShortStationaryRegimeWhereBaselineWins.winnerModel, 'BASELINE_PERSISTENCE');
    assert.equal(gexp.regime2_ShortStationaryRegimeWhereBaselineWins.advancedModelBeatBaseline, false);
  } finally {
    globalThis.fetch = origFetch;
  }

  // Senaryo 15: ui/index.html ve ui/app.js içinde 9 adımlı Yaşayan Dünya Modeli bileşenlerinin doğrulanması
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'app.js'), 'utf8');

  assert.ok(indexHtml.includes('id="caelus-living-world-model-workspace"'));
  assert.ok(indexHtml.includes('id="lwm-card-belief-revision"'));
  assert.ok(indexHtml.includes('id="lwm-card-distant-paths"'));
  assert.ok(indexHtml.includes('id="lwm-card-hypothesis-ledger"'));
  assert.ok(indexHtml.includes('id="lwm-card-competing-models"'));
  assert.ok(indexHtml.includes('id="lwm-card-multiscale-futures"'));
  assert.ok(indexHtml.includes('id="lwm-card-user-world"'));
  assert.ok(indexHtml.includes('<script src="living_world_model.js"></script>'));
  assert.ok(appJs.includes('initCaelusLivingWorldModelUI'));
  assert.ok(appJs.includes('runAndRenderLivingWorldModel'));
});
