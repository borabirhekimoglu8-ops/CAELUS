"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomNav, type MobileTab } from "./components/BottomNav";
import { AssumptionDisclosure } from "./components/AssumptionDisclosure";
import { CausalGraph } from "./components/CausalGraph";
import { CounterfactualPanel } from "./components/CounterfactualPanel";
import { EvidenceLedger } from "./components/EvidenceLedger";
import { HorizonPanel } from "./components/HorizonPanel";
import { MetricRing } from "./components/MetricRing";
import { NeuralGateCard } from "./components/NeuralGateCard";
import { SourceVault, type SourceVaultImportResult } from "./components/SourceVault";
import { CaelusWasmEngine, type EngineLever, type EngineSnapshot } from "../lib/caelus-wasm";
import {
  mergeEvidenceRecords,
  parseEvidenceFileText,
  type EvidenceRecord,
} from "../lib/evidence-vault.mjs";
import {
  importOpenUrl,
  searchOpenSources,
  type OpenSourceHit,
} from "../lib/open-source-connectors.mjs";
import {
  compileNeuralScenario,
  NEURO_MODEL_INFO,
  observeTemporalSnapshot,
  type NeuralAnalysis,
  type NeuralScenario,
} from "../lib/neurocausal.mjs";

type AuditEntry = {
  id: number;
  time: string;
  tone: "ok" | "info" | "warn";
  message: string;
};

const EXAMPLES = [
  "Saat 08.00'de başlayan fırtına nedeniyle Kuşadası–Samos feribot seferleri 48 saat durduruldu. Yolcu sayısı ve alternatif sefer bilgisi verilmedi. Etki nedir?",
  "Şebeke 90 dakika kesilecek. Jeneratör sürekli 80 kW sağlayabiliyor; sabit yük 100 kW. Batarya ve başka kaynak yok.",
  "08.00'de kuyruk sıfır. Geliş 30 araç/dk, işlem 24 araç/dk. Oranlar sabit. 08.30'da işlem kapasitesi 36 araç/dk oluyor. Kuyruk ne zaman temizlenir?",
];
const SOURCE_SYNC_STORAGE_KEY = "caelus:source-sync-consent:v1";
const LOCALE_STORAGE_KEY = "caelus_quiet_locale_v2";

type TargetLocale =
  | "tr-TR"
  | "en-US"
  | "el-GR"
  | "de-DE"
  | "fr-FR"
  | "es-ES"
  | "it-IT"
  | "pt-BR"
  | "ar-SA"
  | "he-IL"
  | "ru-RU"
  | "zh-Hans";

const MOBILE_I18N_PACKS: Record<
  TargetLocale,
  {
    name: string;
    dir: "ltr" | "rtl";
    readyCore: string;
    loadingCore: string;
    errorCore: string;
    trustLocal: string;
    trustNoLlm: string;
    trustOpenSource: string;
    composerKicker: string;
    composerTitle: string;
    executeTitle: string;
    executeSub: string;
  }
> = {
  "tr-TR": {
    name: "Türkçe",
    dir: "ltr",
    readyCore: "YEREL ÇEKİRDEK",
    loadingCore: "YÜKLENİYOR",
    errorCore: "HATA",
    trustLocal: "KANIT MOTORU YEREL",
    trustNoLlm: "LLM / BULUT ÇIKARIM YOK",
    trustOpenSource: "AÇIK KAYNAK → YEREL KASA",
    composerKicker: "SERBEST DURUM GİRİŞİ",
    composerTitle: "Ne olursa ne olur?",
    executeTitle: "Kanıta bağlı analiz yap",
    executeSub: "Olgu → hesap/kural → Truth Gate → WASM paket kontrolü",
  },
  "en-US": {
    name: "English",
    dir: "ltr",
    readyCore: "LOCAL CORE",
    loadingCore: "LOADING",
    errorCore: "ERROR",
    trustLocal: "LOCAL EVIDENCE ENGINE",
    trustNoLlm: "NO LLM / CLOUD INFERENCE",
    trustOpenSource: "OPEN SOURCE → LOCAL VAULT",
    composerKicker: "FREE-FORM SITUATION INPUT",
    composerTitle: "What happens if...?",
    executeTitle: "Run evidence-grounded analysis",
    executeSub: "Fact → calculation/rule → Truth Gate → WASM pack check",
  },
  "el-GR": {
    name: "Ελληνικά",
    dir: "ltr",
    readyCore: "ΤΟΠΙΚΟΣ ΠΥΡΗΝΑΣ",
    loadingCore: "ΦΟΡΤΩΣΗ",
    errorCore: "ΣΦΑΛΜΑ",
    trustLocal: "ΤΟΠΙΚΗ ΜΗΧΑΝΗ ΤΕΚΜΗΡΙΩΝ",
    trustNoLlm: "ΧΩΡΙΣ LLM / CLOUD",
    trustOpenSource: "ΑΝΟΙΧΤΕΣ ΠΗΓΕΣ → ΤΟΠΙΚΟ ΘΗΣΑΥΡΟΦΥΛΑΚΙΟ",
    composerKicker: "ΕΛΕΥΘΕΡΗ ΕΙΣΑΓΩΓΗ ΚΑΤΑΣΤΑΣΗΣ",
    composerTitle: "Τι θα συμβεί αν...;",
    executeTitle: "Ανάλυση βάσει τεκμηρίων",
    executeSub: "Γεγονός → κανόνας → Truth Gate → έλεγχος WASM",
  },
  "de-DE": {
    name: "Deutsch",
    dir: "ltr",
    readyCore: "LOKALER KERN",
    loadingCore: "LÄDT",
    errorCore: "FEHLER",
    trustLocal: "LOKALE EVIDENZ-ENGINE",
    trustNoLlm: "KEIN LLM / CLOUD-INFERENZ",
    trustOpenSource: "OFFENE QUELLEN → LOKALER TRESOR",
    composerKicker: "FREIE SITUATIONSEINGABE",
    composerTitle: "Was passiert, wenn...?",
    executeTitle: "Evidenzbasierte Analyse starten",
    executeSub: "Fakt → Berechnung/Regel → Truth Gate → WASM-Prüfung",
  },
  "fr-FR": {
    name: "Français",
    dir: "ltr",
    readyCore: "NOYAU LOCAL",
    loadingCore: "CHARGEMENT",
    errorCore: "ERREUR",
    trustLocal: "MOTEUR DE PREUVES LOCAL",
    trustNoLlm: "SANS LLM / CLOUD",
    trustOpenSource: "SOURCES OUVERTES → COFFRE LOCAL",
    composerKicker: "SAISIE LIBRE DE SITUATION",
    composerTitle: "Que se passe-t-il si... ?",
    executeTitle: "Lancer l'analyse fondée sur les preuves",
    executeSub: "Fait → calcul/règle → Truth Gate → vérification WASM",
  },
  "es-ES": {
    name: "Español",
    dir: "ltr",
    readyCore: "NÚCLEO LOCAL",
    loadingCore: "CARGANDO",
    errorCore: "ERROR",
    trustLocal: "MOTOR DE EVIDENCIA LOCAL",
    trustNoLlm: "SIN LLM / NUBE",
    trustOpenSource: "FUENTES ABIERTAS → BÓVEDA LOCAL",
    composerKicker: "ENTRADA LIBRE DE SITUACIÓN",
    composerTitle: "¿Qué pasa si...?",
    executeTitle: "Ejecutar análisis basado en evidencia",
    executeSub: "Hecho → cálculo/regla → Truth Gate → control WASM",
  },
  "it-IT": {
    name: "Italiano",
    dir: "ltr",
    readyCore: "NUCLEO LOCALE",
    loadingCore: "CARICAMENTO",
    errorCore: "ERRORE",
    trustLocal: "MOTORE DI PROVE LOCALE",
    trustNoLlm: "NESSUN LLM / CLOUD",
    trustOpenSource: "FONTI APERTE → ARCHIVIO LOCALE",
    composerKicker: "INSERIMENTO LIBERO SITUAZIONE",
    composerTitle: "Cosa succede se...?",
    executeTitle: "Esegui analisi basata su prove",
    executeSub: "Fatto → calcolo/regola → Truth Gate → controllo WASM",
  },
  "pt-BR": {
    name: "Português (BR)",
    dir: "ltr",
    readyCore: "NÚCLEO LOCAL",
    loadingCore: "CARREGANDO",
    errorCore: "ERRO",
    trustLocal: "MOTOR DE EVIDÊNCIAS LOCAL",
    trustNoLlm: "SEM LLM / NUVEM",
    trustOpenSource: "FONTES ABERTAS → COFRE LOCAL",
    composerKicker: "ENTRADA LIVRE DE SITUAÇÃO",
    composerTitle: "O que acontece se...?",
    executeTitle: "Executar análise baseada em evidências",
    executeSub: "Fato → cálculo/regra → Truth Gate → verificação WASM",
  },
  "ar-SA": {
    name: "العربية",
    dir: "rtl",
    readyCore: "نواة محلية",
    loadingCore: "جارٍ التحميل",
    errorCore: "خطأ",
    trustLocal: "محرك أدلة محلي",
    trustNoLlm: "بدون نموذج لغوي أو سحابة",
    trustOpenSource: "مصادر مفتوحة ← خزنة محلية",
    composerKicker: "إدخال حر للحالة",
    composerTitle: "ماذا يحدث إذا...؟",
    executeTitle: "تشغيل التحليل المستند إلى الأدلة",
    executeSub: "حقيقة ← حساب/قاعدة ← بوابة الحقيقة ← فحص WASM",
  },
  "he-IL": {
    name: "עברית",
    dir: "rtl",
    readyCore: "ליבה מקומית",
    loadingCore: "טוען",
    errorCore: "שגיאה",
    trustLocal: "מנוע ראיות מקומי",
    trustNoLlm: "ללא LLM / ענן",
    trustOpenSource: "מקורות פתוחים ← כספת מקומית",
    composerKicker: "קלט מצב חופשי",
    composerTitle: "מה יקרה אם...?",
    executeTitle: "הפעל ניתוח מבוסס ראיות",
    executeSub: "עובדה ← חישוב/כלל ← שער אמת ← בדיקת WASM",
  },
  "ru-RU": {
    name: "Русский",
    dir: "ltr",
    readyCore: "ЛОКАЛЬНОЕ ЯДРО",
    loadingCore: "ЗАГРУЗКА",
    errorCore: "ОШИБКА",
    trustLocal: "ЛОКАЛЬНЫЙ ДВИЖОК ДОКАЗАТЕЛЬСТВ",
    trustNoLlm: "БЕЗ LLM / ОБЛАКА",
    trustOpenSource: "ОТКРЫТЫЕ ИСТОЧНИКИ → ЛОКАЛЬНОЕ ХРАНИЛИЩЕ",
    composerKicker: "СВОБОДНЫЙ ВВОД СИТУАЦИИ",
    composerTitle: "Что произойдет, если...?",
    executeTitle: "Запустить доказательный анализ",
    executeSub: "Факт → расчет/правило → Truth Gate → проверка WASM",
  },
  "zh-Hans": {
    name: "简体中文",
    dir: "ltr",
    readyCore: "本地核心",
    loadingCore: "加载中",
    errorCore: "错误",
    trustLocal: "本地证据引擎",
    trustNoLlm: "无 LLM / 云端推理",
    trustOpenSource: "开源数据 → 本地保险库",
    composerKicker: "自由情境输入",
    composerTitle: "如果……会怎样？",
    executeTitle: "运行基于证据的分析",
    executeSub: "事实 → 计算/规则 → Truth Gate → WASM 校验",
  },
};

function now(): string {
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}

function percent(value: number): string {
  return `%${Math.round(Math.max(0, Math.min(1, value)) * 100)}`;
}

function fixedProbability(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value) > 1 ? Number(value) / 1_000_000 : Number(value);
}

function sourceTier(trustTier: string): "institutional" | "reputable" | "community" | "unknown" {
  if (trustTier === "knowledge_graph") return "institutional";
  if (trustTier === "scholarly_metadata") return "reputable";
  if (trustTier === "secondary" || trustTier === "discovery_index") return "community";
  return "unknown";
}

function hitAsDocument(hit: OpenSourceHit) {
  return {
    title: hit.title,
    url: hit.uri,
    text: hit.content,
    format: "txt" as const,
    publisher: hit.publisher,
    tier: sourceTier(hit.trustTier),
    publishedAt: hit.publishedAt ?? undefined,
    license: hit.license,
    promotionEligible: hit.promotionEligible,
  };
}

function recordsFromHits(hits: OpenSourceHit[]): EvidenceRecord[] {
  const groups = hits.map((hit) => parseEvidenceFileText(hit.content, {
    format: "txt",
    fileName: hit.title || `${hit.sourceId}.txt`,
    source: {
      name: hit.title || hit.sourceName,
      kind: "public_source",
      uri: hit.uri,
      publisher: hit.publisher,
      tier: sourceTier(hit.trustTier),
      publishedAt: hit.publishedAt ?? undefined,
      retrievedAt: hit.retrievedAt,
      license: hit.license,
      promotionEligible: hit.promotionEligible,
    },
    referenceDate: hit.retrievedAt,
  }).records);
  return mergeEvidenceRecords(...groups).records;
}

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<EvidenceRecord>;
  return typeof record.id === "string" && typeof record.fingerprint === "string" && typeof record.text === "string";
}

export default function Home() {
  const engineRef = useRef<CaelusWasmEngine | null>(null);
  const sourceAbortRef = useRef<AbortController | null>(null);
  const executeRunRef = useRef(0);
  const logIdRef = useRef(1);
  const [engineStatus, setEngineStatus] = useState<"loading" | "ready" | "running" | "error">("loading");
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState<MobileTab>("scenario");
  const [scenario, setScenario] = useState<NeuralScenario | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [levers, setLevers] = useState<EngineLever[]>([]);
  const [leverCooldowns, setLeverCooldowns] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("Yerel kanıt motoru ve Rust çekirdeği hazırlanıyor…");
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [vaultRecords, setVaultRecords] = useState<EvidenceRecord[]>([]);
  const [vaultBusy, setVaultBusy] = useState(0);
  const [automaticRecords, setAutomaticRecords] = useState<EvidenceRecord[]>([]);
  const [sourceSyncEnabled, setSourceSyncEnabled] = useState(false);
  const [sourceConsentHydrated, setSourceConsentHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [locale, setLocale] = useState<TargetLocale>("tr-TR");
  const localePack = MOBILE_I18N_PACKS[locale] ?? MOBILE_I18N_PACKS["tr-TR"];

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY) as TargetLocale | null;
      if (saved && saved in MOBILE_I18N_PACKS) {
        setLocale(saved);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  const handleLocaleChange = useCallback((nextLocale: TargetLocale) => {
    setLocale(nextLocale);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
      document.documentElement.lang = nextLocale;
      document.documentElement.dir = MOBILE_I18N_PACKS[nextLocale]?.dir ?? "ltr";
    } catch {
      // Ignore storage errors
    }
  }, []);

  const addLog = useCallback((messageText: string, tone: AuditEntry["tone"] = "info") => {
    setLogs((current) => [{ id: logIdRef.current++, time: now(), tone, message: messageText }, ...current].slice(0, 60));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const engine = new CaelusWasmEngine();
    engineRef.current = engine;

    engine.init().then(() => {
      if (cancelled) return;
      setEngineStatus("ready");
      setMessage("Hazır · bütün hesaplama bu cihazda");
      addLog(`Rust/WASM çekirdeği doğrulandı · ${NEURO_MODEL_INFO.version}`, "ok");
    }).catch((error: unknown) => {
      if (cancelled) return;
      setEngineStatus("error");
      setMessage(error instanceof Error ? error.message : "Yerel motor başlatılamadı.");
      addLog("Yerel çekirdek başlatma hatası", "warn");
    });

    let reloadingForUpdate = false;
    const hadServiceWorkerController = "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller);
    const refreshOnWorkerUpdate = () => {
      if (!hadServiceWorkerController || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", refreshOnWorkerUpdate);
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      executeRunRef.current += 1;
      sourceAbortRef.current?.abort();
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", refreshOnWorkerUpdate);
      }
    };
  }, [addLog]);

  useEffect(() => {
    const updateConnectivity = () => setOnline(navigator.onLine);
    updateConnectivity();
    window.addEventListener("online", updateConnectivity);
    window.addEventListener("offline", updateConnectivity);
    return () => {
      window.removeEventListener("online", updateConnectivity);
      window.removeEventListener("offline", updateConnectivity);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        setSourceSyncEnabled(window.localStorage.getItem(SOURCE_SYNC_STORAGE_KEY) === "granted");
      } catch {
        setSourceSyncEnabled(false);
      } finally {
        setSourceConsentHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sourceConsentHydrated) return;
    try {
      window.localStorage.setItem(SOURCE_SYNC_STORAGE_KEY, sourceSyncEnabled ? "granted" : "denied");
    } catch {
      // Consent remains valid for this mounted session when storage is unavailable.
    }
  }, [sourceConsentHydrated, sourceSyncEnabled]);

  const searchSourceDocuments = useCallback(async (query: string): Promise<SourceVaultImportResult> => {
    const result = await searchOpenSources(query, { limit: 3, timeoutMs: 12_000 });
    addLog(`Açık kaynak taraması: ${result.successfulSources}/${result.attemptedSources} bağlayıcı · ${result.hits.length} kayıt`, result.failedSources ? "info" : "ok");
    return {
      label: `Açık Kaynak Ağı · ${result.successfulSources}/${result.attemptedSources}`,
      documents: result.hits.map(hitAsDocument),
    };
  }, [addLog]);

  const importSourceUrl = useCallback(async (url: string): Promise<SourceVaultImportResult> => {
    const hit = await importOpenUrl(url);
    addLog(`URL kanıtı cihazda ayrıştırıldı: ${hit.publisher}`, "ok");
    return hitAsDocument(hit);
  }, [addLog]);

  const handleEvidenceChange = useCallback((payload: { records: unknown[]; busyCount: number }) => {
    setVaultRecords(payload.records.filter(isEvidenceRecord));
    setVaultBusy(payload.busyCount);
  }, []);

  const handleSourceSyncChange = useCallback((enabled: boolean) => {
    setSourceSyncEnabled(enabled);
    if (!enabled) setAutomaticRecords([]);
    if (!enabled && sourceAbortRef.current) {
      executeRunRef.current += 1;
      sourceAbortRef.current.abort();
      sourceAbortRef.current = null;
      setEngineStatus(engineRef.current?.ready ? "ready" : "loading");
      setMessage("Açık kaynak taraması iptal edildi; yalnız cihazdaki kanıt kasası kullanılacak.");
      addLog("Otomatik açık kaynak taraması kullanıcı tarafından durduruldu.", "info");
    }
  }, [addLog]);

  const execute = useCallback(async () => {
    const text = input.trim();
    if (!text) {
      setMessage("Önce analiz edilecek durumu yazın.");
      return;
    }
    if (!engineRef.current?.ready) {
      setMessage("Yerel çekirdek henüz hazır değil.");
      return;
    }
    if (vaultBusy > 0) {
      setMessage("Kaynak kasası işleniyor; analiz için aktarımın tamamlanmasını bekleyin.");
      return;
    }

    const runId = executeRunRef.current + 1;
    executeRunRef.current = runId;
    sourceAbortRef.current?.abort();
    sourceAbortRef.current = null;
    try {
      setEngineStatus("running");
      let automaticEvidence: EvidenceRecord[] = [];
      setAutomaticRecords([]);
      if (sourceSyncEnabled && navigator.onLine) {
        const controller = new AbortController();
        sourceAbortRef.current = controller;
        setMessage("Erişilebilir açık kaynaklar taranıyor; sonuçlar cihazda süzülüyor…");
        try {
          const sourceResult = await searchOpenSources(text, {
            limit: 2,
            timeoutMs: 9_000,
            signal: controller.signal,
          });
          if (controller.signal.aborted || executeRunRef.current !== runId) return;
          automaticEvidence = recordsFromHits(sourceResult.hits);
          setAutomaticRecords(automaticEvidence);
          addLog(`Otomatik kaynak ağı: ${sourceResult.successfulSources}/${sourceResult.attemptedSources} bağlayıcı · ${automaticEvidence.length} yerel kayıt`, sourceResult.failedSources ? "info" : "ok");
        } catch (error: unknown) {
          if (controller.signal.aborted || executeRunRef.current !== runId) return;
          addLog(error instanceof Error ? error.message : "Açık kaynak taraması tamamlanamadı; yerel kasa kullanıldı.", "warn");
        } finally {
          if (sourceAbortRef.current === controller) sourceAbortRef.current = null;
        }
      }

      if (executeRunRef.current !== runId) return;
      setMessage("Yerel Truth Gate kaynakları, çelişkileri, olguları ve birimleri doğruluyor…");
      const availableEvidence = mergeEvidenceRecords(vaultRecords, automaticEvidence).records;
      const compiled = compileNeuralScenario(text, { evidenceRecords: availableEvidence });
      const next = engineRef.current.load(compiled.pack);
      const engineLevers = engineRef.current.levers();
      const observed = observeTemporalSnapshot(compiled, next);
      if (executeRunRef.current !== runId) return;
      setScenario(observed);
      setSnapshot(next);
      setLevers(engineLevers);
      setLeverCooldowns({});
      setActiveTab("scenario");
      setEngineStatus("ready");
      setMessage(`${compiled.analysis.grounding.mode === "grounded" ? "Kanıtlı cevap" : compiled.analysis.grounding.mode === "conditional" ? "Koşullu çıkarım" : "Kanıt bulunamadı/çelişkili"} · ${compiled.analysis.sectorLabel} · ${availableEvidence.length} kaynak kaydı`);
      addLog(`Kanıt motoru: ${compiled.analysis.scenarioId}`, "ok");
      addLog(`Truth Gate: ${compiled.analysis.gateAudit.mode} · kapsam ${percent(compiled.analysis.grounding.coverage.score)}`, compiled.analysis.gateAudit.accepted ? "ok" : "warn");
      addLog("ScenarioPack Rust/WASM şema ve durum kontrolünden geçti", "ok");
    } catch (error: unknown) {
      if (executeRunRef.current !== runId) return;
      const detail = error instanceof Error ? error.message : "Senaryo oluşturulamadı.";
      setEngineStatus("error");
      setMessage(detail);
      addLog(detail, "warn");
    }
  }, [addLog, input, sourceSyncEnabled, vaultBusy, vaultRecords]);

  const applyLever = useCallback((lever: EngineLever) => {
    if (!engineRef.current?.ready) return;
    try {
      const result = engineRef.current.applyLever(lever.id);
      const lockedUntil = result.snapshot.tick + Math.max(1, lever.lockout_ticks ?? 1);
      setSnapshot(result.snapshot);
      setScenario((current) => current ? observeTemporalSnapshot(current, result.snapshot) : current);
      setLevers(engineRef.current.levers());
      setLeverCooldowns((current) => ({ ...current, [lever.id]: lockedUntil }));
      setMessage(result.accepted ? "Müdahale çekirdek tarafından uygulandı." : "Müdahale kilitli veya başarısız.");
      addLog(`${lever.label || lever.id} · ${result.accepted ? "uygulandı" : "reddedildi"}`, result.accepted ? "ok" : "warn");
    } catch (error: unknown) {
      addLog(error instanceof Error ? error.message : "Müdahale uygulanamadı.", "warn");
    }
  }, [addLog]);

  const resolvedLevers = useMemo(() => {
    const packLevers = scenario?.pack.extended_causal_model.levers ?? [];
    return levers.map((lever) => {
      const source = packLevers.find((candidate) => candidate.id === lever.id);
      return { ...source, ...lever, label: lever.label || source?.label, target: lever.target || source?.target, success_p_fp: lever.success_p_fp ?? source?.success_p_fp };
    });
  }, [levers, scenario]);

  const evidenceCoverage = scenario?.analysis.grounding.coverage.score ?? 0;
  const calculationCount = scenario?.analysis.grounding.calculations.length ?? 0;
  const unknownCount = scenario?.analysis.grounding.unknowns.length ?? 0;
  const claimCount = scenario?.analysis.grounding.claims.length ?? 0;

  return (
    <main className="mobile-app" dir={localePack.dir} lang={locale}>
      <div className="spatial-top-cluster">
        <BottomNav active={activeTab} onChange={setActiveTab} leverCount={resolvedLevers.length} sourceCount={vaultRecords.length + automaticRecords.length} />
        <select
          aria-label="Uygulama dili"
          value={locale}
          onChange={(e) => handleLocaleChange(e.target.value as TargetLocale)}
          style={{
            background: "rgba(9, 18, 32, 0.9)",
            color: "#e6f2ff",
            border: "1px solid rgba(56, 189, 248, 0.35)",
            borderRadius: "999px",
            padding: "4px 10px",
            fontSize: "11px",
          }}
        >
          {(Object.keys(MOBILE_I18N_PACKS) as TargetLocale[]).map((code) => (
            <option key={code} value={code}>
              {MOBILE_I18N_PACKS[code].name} ({code})
            </option>
          ))}
        </select>
        <div className={`status-orb status-orb--${engineStatus}`} aria-label={`Motor durumu: ${engineStatus}`}>
          <i />
          <span>{engineStatus === "loading" ? localePack.loadingCore : engineStatus === "error" ? localePack.errorCore : localePack.readyCore}</span>
        </div>
      </div>

      <section className="trust-strip" aria-label="Çalışma sınırları">
        <span><i className="trust-dot" /> {localePack.trustLocal}</span>
        <span>{localePack.trustNoLlm}</span>
        <span>{localePack.trustOpenSource}</span>
      </section>

      {snapshot && scenario ? (
        <section className="metric-row" aria-label="Kanıt defteri özeti">
          <MetricRing label="Kanıt kapsamı" value={evidenceCoverage} display={percent(evidenceCoverage)} tone="cyan" />
          <MetricRing label="Doğrulanmış hesap" value={claimCount ? calculationCount / claimCount : 0} display={String(calculationCount)} tone="green" />
          <MetricRing label="Bilinmeyen" value={claimCount ? unknownCount / claimCount : 0} display={String(unknownCount)} tone={unknownCount ? "amber" : "green"} />
        </section>
      ) : null}

      <div className="status-message" role="status">
        <span className={engineStatus === "running" ? "pulse" : ""} />
        {message}
      </div>

      <section className="content-deck">
        {activeTab === "scenario" ? (
          <ScenarioView
            key={scenario?.analysis.scenarioId ?? "empty"}
            input={input}
            onInput={setInput}
            onExecute={execute}
            disabled={engineStatus === "loading" || engineStatus === "running" || vaultBusy > 0}
            scenario={scenario?.analysis ?? null}
            snapshot={snapshot}
            onExample={setInput}
            sourceSyncEnabled={sourceSyncEnabled}
            onSourceSyncChange={handleSourceSyncChange}
            online={online}
          />
        ) : null}

        <div className="source-tab" hidden={activeTab !== "sources"}>
            <section className="source-sync-control" aria-label="Açık kaynak senkronizasyonu">
              <div>
                <span className={online ? "source-sync-control__dot" : "source-sync-control__dot source-sync-control__dot--offline"} />
                <p><strong>{online ? "Açık kaynak erişimi hazır" : "Çevrimdışı kasa modu"}</strong><small>{online ? "Sorgu, erişilebilir bağlayıcılara doğrudan bu cihazdan gider; çıkarım yerelde kalır." : "Daha önce kaydedilen kaynaklar ve yüklenen dosyalar kullanılacak."}</small></p>
              </div>
              <label><input type="checkbox" checked={sourceSyncEnabled} onChange={(event) => handleSourceSyncChange(event.target.checked)} /><span>Senaryoda otomatik tara</span></label>
              {automaticRecords.length ? <em>Son otomatik tarama: {automaticRecords.length} kayıt</em> : null}
            </section>
            <SourceVault
              onEvidenceChange={handleEvidenceChange}
              onSearchOpenSources={searchSourceDocuments}
              onImportUrl={importSourceUrl}
            />
        </div>

        {activeTab === "graph" ? (
          snapshot && scenario && scenario.analysis.strongestRelations.length ? (
            <section className="panel graph-panel">
              <div className="panel-heading">
                <div><span>KANIT TOPOLOJİSİ</span><h2>Kaynaklı ilişki grafiği</h2></div>
                <em>{scenario.analysis.strongestRelations.length} İLİŞKİ</em>
              </div>
              <CausalGraph snapshot={snapshot} nodes={scenario.pack.extended_causal_model.nodes} />
              <div className="relation-list">
                {scenario.analysis.strongestRelations.map((relation) => (
                  <div key={`${relation.from}-${relation.to}`}>
                    <span>{relation.from}</span><b>→</b><span>{relation.to}</span><em>{relation.evidence[0]?.source === "input" ? "GİRDİ" : "KURAL"}</em>
                  </div>
                ))}
              </div>
            </section>
          ) : <EmptyState title="Kanıtlı grafik yok" text="Bu girdi için desteklenen bir ilişki bulunmadı; CAELUS kanıtsız zincir üretmedi." />
        ) : null}

        {activeTab === "levers" ? (
          resolvedLevers.length ? (
            <section className="panel">
              <div className="panel-heading"><div><span>OTORİTELİ EYLEM</span><h2>Müdahale hamleleri</h2></div></div>
              <div className="lever-list">
                {resolvedLevers.map((lever, index) => (
                  <article className="lever-card" key={lever.id}>
                    <div className="lever-card__index">0{index + 1}</div>
                    <div className="lever-card__body">
                      <h3>{lever.label || lever.id}</h3>
                      <p>{lever.target || "Nedensel hedef"}</p>
                      <div><span>Başarı {percent(fixedProbability(lever.success_p ?? lever.success_p_fp))}</span><span>Maliyet {lever.cost_ticks ?? "—"} tick</span></div>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyLever(lever)}
                      disabled={lever.locked || (leverCooldowns[lever.id] ?? 0) > (snapshot?.tick ?? 0)}
                    >
                      {(leverCooldowns[lever.id] ?? 0) > (snapshot?.tick ?? 0)
                        ? `Bekle ${(leverCooldowns[lever.id] ?? 0) - (snapshot?.tick ?? 0)}`
                        : "Uygula"}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : <EmptyState title="Hamle üretilmedi" text="Bu yerel bilgi paketi doğrulanmış bir müdahale kuralı sağlamıyor." />
        ) : null}

        {activeTab === "audit" ? (
          <section className="panel">
            <div className="panel-heading"><div><span>YEREL DENETİM</span><h2>Çalışma kaydı</h2></div><em>{logs.length} OLAY</em></div>
            <div className="model-card">
              <span>MODEL</span><strong>{NEURO_MODEL_INFO.version}</strong>
              <small>Kanıt defteri · deterministik birim/zaman çözücü · yerel semantik yönlendirici · Rust/WASM paket kontrolü</small>
            </div>
            {scenario ? <NeuralGateCard audit={scenario.analysis.gateAudit} observerTick={scenario.analysis.observerTick} /> : null}
            <div className="audit-list">
              {logs.map((entry) => (
                <div className={`audit-entry audit-entry--${entry.tone}`} key={entry.id}>
                  <time>{entry.time}</time><i /><p>{entry.message}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

type ScenarioViewProps = {
  input: string;
  onInput(value: string): void;
  onExecute(): void;
  disabled: boolean;
  scenario: NeuralAnalysis | null;
  snapshot: EngineSnapshot | null;
  onExample(value: string): void;
  sourceSyncEnabled: boolean;
  onSourceSyncChange(value: boolean): void;
  online: boolean;
};

function ScenarioView({ input, onInput, onExecute, disabled, scenario, snapshot, onExample, sourceSyncEnabled, onSourceSyncChange, online }: ScenarioViewProps) {
  const [selectedHorizon, setSelectedHorizon] = useState("immediate");
  const [selectedBranch, setSelectedBranch] = useState("baseline");

  return (
    <>
      <section className="composer panel">
        <div className="panel-heading">
          <div><span>SERBEST DURUM GİRİŞİ</span><h2>Ne olursa ne olur?</h2></div>
          <em>{input.length}/1200</em>
        </div>
        <textarea
          value={input}
          onChange={(event) => onInput(event.target.value.slice(0, 1200))}
          placeholder="Olayı, süreyi, miktarı, kapasiteyi ve bilinen kısıtları yazın…"
          rows={5}
          aria-label="Analiz edilecek durum"
        />
        {!input ? (
          <div className="example-chips">
            {EXAMPLES.map((example, index) => <button type="button" key={example} onClick={() => onExample(example)}>Örnek {index + 1}</button>)}
          </div>
        ) : null}
        <label className="source-consent">
          <input type="checkbox" checked={sourceSyncEnabled} onChange={(event) => onSourceSyncChange(event.target.checked)} />
          <span>
            <strong>Açık kaynaklarda otomatik ara</strong>
            <small>{online ? "Sorgu terimleri Wikipedia, Wikidata, Crossref, Europe PMC ve GDELT’e doğrudan gönderilir." : "Çevrimdışı: onay saklanır, yalnız yerel kasa kullanılır."}</small>
          </span>
        </label>
        <button className="execute-button" type="button" onClick={onExecute} disabled={disabled || input.trim().length < 8}>
          <span className="execute-button__mark">⌁</span>
          <span><b>Kanıta bağlı analiz yap</b><small>Olgu → hesap/kural → Truth Gate → WASM paket kontrolü</small></span>
          <i>→</i>
        </button>
      </section>

      {scenario && snapshot ? (
        <section className="panel result-panel">
          <div className="result-kicker"><span>{scenario.sectorLabel}</span><em>{scenario.model}</em></div>
          <h2>{scenario.grounding.title}</h2>
          <blockquote>“{scenario.sourceText}”</blockquote>
          <EvidenceLedger reasoning={scenario.grounding} />
          <div className="fact-strip" aria-label="Girdiden çıkarılan kavramlar">
            {scenario.concepts.slice(0, 6).map((concept) => <span key={concept}>{concept}</span>)}
          </div>
          <div className="impact-banner">
            <div><span>Desteklenen iddia</span><strong>{scenario.grounding.coverage.supportedClaimCount}</strong></div>
            <div><span>Doğrulanmış hesap</span><strong>{scenario.grounding.calculations.length}</strong></div>
            <div><span>Bilinmeyen</span><strong>{scenario.grounding.coverage.unknownClaimCount}</strong></div>
          </div>
          {scenario.horizons.length ? <HorizonPanel horizons={scenario.horizons} selected={selectedHorizon} onSelect={setSelectedHorizon} /> : null}
          {scenario.counterfactuals.length ? <CounterfactualPanel branches={scenario.counterfactuals} selected={selectedBranch} onSelect={setSelectedBranch} /> : null}
          <AssumptionDisclosure assumptions={scenario.assumptions} unknowns={scenario.unknowns} />
          {scenario.strongestRelations.length ? (
            <>
              <h3>Kanıtlı nedensel ilişkiler</h3>
              <ol className="event-chain">
                {scenario.strongestRelations.map((relation, index) => (
                  <li key={`${relation.from}-${relation.to}`}><i>{index + 1}</i><p><b>{relation.from}</b> → <b>{relation.to}</b><small>{relation.mechanism}</small></p><em>{relation.evidence[0]?.source === "input" ? "GİRDİ" : "KURAL"}</em></li>
                ))}
              </ol>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <section className="panel empty-state"><div>⌬</div><h2>{title}</h2><p>{text}</p></section>;
}
