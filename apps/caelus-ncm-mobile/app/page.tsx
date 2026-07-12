"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomNav, type MobileTab } from "./components/BottomNav";
import { CausalGraph } from "./components/CausalGraph";
import { MetricRing } from "./components/MetricRing";
import { CaelusWasmEngine, type EngineLever, type EngineSnapshot } from "../lib/caelus-wasm";
import { compileNeuralScenario, NEURO_MODEL_INFO, type NeuralAnalysis, type NeuralScenario } from "../lib/neurocausal.mjs";

type AuditEntry = {
  id: number;
  time: string;
  tone: "ok" | "info" | "warn";
  message: string;
};

const EXAMPLES = [
  "Samos feribot seferleri fırtına nedeniyle 48 saat durursa yolcu ve liman operasyonu nasıl etkilenir?",
  "Şirket sunucusuna saldırı olur ve müşteri verileri sızarsa servis zinciri nasıl çöker?",
  "Bir uydu görevinde enerji kapasitesi azalırken kritik iletişim penceresi kapanırsa ne olur?",
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logIdRef = useRef(1);
  const [engineStatus, setEngineStatus] = useState<"loading" | "ready" | "running" | "error">("loading");
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState<MobileTab>("scenario");
  const [scenario, setScenario] = useState<NeuralScenario | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [levers, setLevers] = useState<EngineLever[]>([]);
  const [leverCooldowns, setLeverCooldowns] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("Yerel sinir ağı ve Rust çekirdeği hazırlanıyor…");
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

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [addLog]);

  const startRealtime = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (document.hidden || !engineRef.current?.ready) return;
      try {
        const next = engineRef.current.tick(1);
        setSnapshot(next);
        if (next.tick % 8 === 0) addLog(`Canlı durum güncellendi · tick ${next.tick}`, "info");
      } catch {
        setEngineStatus("error");
        setMessage("Canlı yerel akış durdu.");
      }
    }, 2200);
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
      setMessage("Yerel sinir ağı ilişkileri çıkarıyor…");
      const compiled = compileNeuralScenario(text);
      let next = engineRef.current.load(compiled.pack);
      next = engineRef.current.tick(4);
      const engineLevers = engineRef.current.levers();
      setScenario(compiled);
      setSnapshot(next);
      setLevers(engineLevers);
      setLeverCooldowns({});
      setActiveTab("scenario");
      setEngineStatus("ready");
      setMessage(`Canlı model çalışıyor · ${compiled.analysis.sectorLabel}`);
      addLog(`Nöral model: ${compiled.analysis.scenarioId}`, "ok");
      addLog(`ScenarioPack WASM çekirdeğinde kabul edildi · güven ${percent(compiled.analysis.confidence)}`, "ok");
      startRealtime();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Senaryo oluşturulamadı.";
      setEngineStatus("error");
      setMessage(detail);
      addLog(detail, "warn");
    }
  }, [addLog, input, startRealtime]);

  const applyLever = useCallback((lever: EngineLever) => {
    if (!engineRef.current?.ready) return;
    try {
      const result = engineRef.current.applyLever(lever.id);
      const lockedUntil = result.snapshot.tick + Math.max(1, lever.lockout_ticks ?? 1);
      setSnapshot(result.snapshot);
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

  const risk = snapshot ? Math.max(0, Math.min(1, (snapshot.clamped_friction - 1) / 2)) : 0;
  const throughput = snapshot?.throughput_ratio ?? 0;
  const confidence = scenario?.analysis.confidence ?? 0;

  return (
    <main className="mobile-app">
      <header className="app-header">
        <div>
          <p className="eyebrow">NEUROCAUSAL OPERATING SYSTEM</p>
          <h1>CAELUS <span>NCM</span></h1>
        </div>
        <div className={`status-orb status-orb--${engineStatus}`} aria-label={`Motor durumu: ${engineStatus}`}>
          <i />
          <span>{engineStatus === "loading" ? "YÜKLENİYOR" : engineStatus === "error" ? "HATA" : "YEREL"}</span>
        </div>
      </header>

      <section className="trust-strip" aria-label="Çalışma sınırları">
        <span><i className="trust-dot" /> SİNİR AĞI CİHAZDA</span>
        <span>BULUT KAPALI</span>
        <span>WASM DOĞRULAMA</span>
      </section>

      {snapshot && scenario ? (
        <section className="metric-row" aria-label="Canlı motor metrikleri">
          <MetricRing label="Risk" value={risk} display={percent(risk)} tone={risk > 0.7 ? "red" : "amber"} />
          <MetricRing label="Akış" value={throughput} display={percent(throughput)} tone="green" />
          <MetricRing label="Nöral güven" value={confidence} display={percent(confidence)} tone="cyan" />
        </section>
      ) : null}

      <div className="status-message" role="status">
        <span className={engineStatus === "running" ? "pulse" : ""} />
        {message}
      </div>

      <section className="content-deck">
        {activeTab === "scenario" ? (
          <ScenarioView
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
          snapshot && scenario ? (
            <section className="panel graph-panel">
              <div className="panel-heading">
                <div><span>CANLI TOPOLOJİ</span><h2>Nedensel grafik</h2></div>
                <em>TICK {snapshot.tick}</em>
              </div>
              <CausalGraph snapshot={snapshot} nodes={scenario.pack.extended_causal_model.nodes} />
              <div className="relation-list">
                {scenario.analysis.strongestRelations.map((relation) => (
                  <div key={`${relation.from}-${relation.to}`}>
                    <span>{relation.from}</span><b>→</b><span>{relation.to}</span><em>{percent(relation.confidence)}</em>
                  </div>
                ))}
              </div>
            </section>
          ) : <EmptyState title="Henüz grafik yok" text="Senaryo sekmesinden bir durum yazıp yerel modeli çalıştırın." />
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
          ) : <EmptyState title="Hamle üretilmedi" text="Önce yerel nöro-nedensel modeli bir durum üzerinde çalıştırın." />
        ) : null}

        {activeTab === "audit" ? (
          <section className="panel">
            <div className="panel-heading"><div><span>YEREL DENETİM</span><h2>Çalışma kaydı</h2></div><em>{logs.length} OLAY</em></div>
            <div className="model-card">
              <span>MODEL</span><strong>{NEURO_MODEL_INFO.version}</strong>
              <small>{NEURO_MODEL_INFO.inputDimensions} giriş · {NEURO_MODEL_INFO.hiddenUnits} gizli nöron · çok görevli grafik başlığı</small>
            </div>
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
  return (
    <>
      <section className="composer panel">
        <div className="panel-heading">
          <div><span>SERBEST DURUM GİRİŞİ</span><h2>Ne olursa ne olur?</h2></div>
          <em>{input.length}/600</em>
        </div>
        <textarea
          value={input}
          onChange={(event) => onInput(event.target.value.slice(0, 600))}
          placeholder="Herhangi bir gerçek durumu yazın…"
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
          <span><b>Yerel modeli çalıştır</b><small>Sinir ağı → ScenarioPack → Rust/WASM</small></span>
          <i>→</i>
        </button>
      </section>

      {scenario && snapshot ? (
        <section className="panel result-panel">
          <div className="result-kicker"><span>{scenario.sectorLabel}</span><em>{scenario.model}</em></div>
          <h2>{scenario.concepts[0]} merkezli canlı senaryo</h2>
          <blockquote>“{scenario.sourceText}”</blockquote>
          <p>{scenario.synopsis}</p>
          <div className="impact-banner">
            <div><span>Sürtünme</span><strong>{snapshot.clamped_friction.toFixed(2)}×</strong></div>
            <div><span>Throughput</span><strong>{percent(snapshot.throughput_ratio)}</strong></div>
            <div><span>Tick</span><strong>{snapshot.tick}</strong></div>
          </div>
          <h3>Öğrenilmiş olay zinciri</h3>
          <ol className="event-chain">
            {scenario.strongestRelations.map((relation, index) => (
              <li key={`${relation.from}-${relation.to}`}><i>{index + 1}</i><p><b>{relation.from}</b> üzerindeki baskı <b>{relation.to}</b> bileşenine aktarılıyor.</p><em>{percent(relation.confidence)}</em></li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <section className="panel empty-state"><div>⌬</div><h2>{title}</h2><p>{text}</p></section>;
}
