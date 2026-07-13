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
import { CaelusWasmEngine, type EngineLever, type EngineSnapshot } from "../lib/caelus-wasm";
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

export default function Home() {
  const engineRef = useRef<CaelusWasmEngine | null>(null);
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
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", refreshOnWorkerUpdate);
      }
    };
  }, [addLog]);

  const execute = useCallback(() => {
    const text = input.trim();
    if (!text) {
      setMessage("Önce analiz edilecek durumu yazın.");
      return;
    }
    if (!engineRef.current?.ready) {
      setMessage("Yerel çekirdek henüz hazır değil.");
      return;
    }

    try {
      setEngineStatus("running");
      setMessage("Yerel kanıt motoru olguları ve birimleri doğruluyor…");
      const compiled = compileNeuralScenario(text);
      const next = engineRef.current.load(compiled.pack);
      const engineLevers = engineRef.current.levers();
      const observed = observeTemporalSnapshot(compiled, next);
      setScenario(observed);
      setSnapshot(next);
      setLevers(engineLevers);
      setLeverCooldowns({});
      setActiveTab("scenario");
      setEngineStatus("ready");
      setMessage(`${compiled.analysis.grounding.mode === "grounded" ? "Kanıtlı hesap" : compiled.analysis.grounding.mode === "conditional" ? "Koşullu çıkarım" : "Veri yetersiz"} · ${compiled.analysis.sectorLabel}`);
      addLog(`Kanıt motoru: ${compiled.analysis.scenarioId}`, "ok");
      addLog(`Truth Gate: ${compiled.analysis.gateAudit.mode} · kapsam ${percent(compiled.analysis.grounding.coverage.score)}`, compiled.analysis.gateAudit.accepted ? "ok" : "warn");
      addLog("ScenarioPack Rust/WASM şema ve durum kontrolünden geçti", "ok");
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Senaryo oluşturulamadı.";
      setEngineStatus("error");
      setMessage(detail);
      addLog(detail, "warn");
    }
  }, [addLog, input]);

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
    <main className="mobile-app">
      <header className="app-header">
        <div>
          <p className="eyebrow">GROUNDED CAUSAL ENGINE</p>
          <h1>CAELUS <span>NCM</span></h1>
        </div>
        <div className={`status-orb status-orb--${engineStatus}`} aria-label={`Motor durumu: ${engineStatus}`}>
          <i />
          <span>{engineStatus === "loading" ? "YÜKLENİYOR" : engineStatus === "error" ? "HATA" : "YEREL"}</span>
        </div>
      </header>

      <section className="trust-strip" aria-label="Çalışma sınırları">
        <span><i className="trust-dot" /> KANIT MOTORU YEREL</span>
        <span>BULUT KAPALI</span>
        <span>TRUTH GATE + WASM KONTROLÜ</span>
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
            disabled={engineStatus === "loading" || engineStatus === "running"}
            scenario={scenario?.analysis ?? null}
            snapshot={snapshot}
            onExample={setInput}
          />
        ) : null}

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

      <BottomNav active={activeTab} onChange={setActiveTab} leverCount={resolvedLevers.length} />
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
};

function ScenarioView({ input, onInput, onExecute, disabled, scenario, snapshot, onExample }: ScenarioViewProps) {
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
