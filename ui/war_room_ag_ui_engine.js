/**
 * CAELUS OS — 4 Specialist Agents & Proactive Command Assistant Engine (`CAELUS_AG_UI_V1`)
 *
 * Katman 2 (Master Spesifikasyon §3.2 & §4.2.4):
 * - Ajanlar serbest metinle karar uydurmaz; yalnızca deterministik Sidecar Airlock / MCP
 *   araçlarını (`caelus_airlock_validate_batch`, `caelus_evaluate_slice`,
 *   `caelus_run_counterfactual_branch`, `caelus_explain_outcome`) çağırır.
 * - Tüm 64-bit tam sayılar (`int64_t` / `u64`, `fp_val`, `seq_no`, zaman damgaları) ondalık
 *   ASCII `string` olarak korunur (`> 2^53 - 1` sıfır bit kaybı).
 * - Hem Node.js (`ws://127.0.0.1:47809` WebSocket sunucusu) hem de %100 çevrimdışı (air-gapped)
 *   tarayıcı / PWA ortamında sıfır harici bağımlılıkla çalışır.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const sidecarAirlock = require("./sidecar_airlock_mcp.js");
    module.exports = factory(sidecarAirlock);
  } else {
    root.CaelusWarRoomAgUiEngine = factory(root.CaelusSidecarAirlockMcp);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (sidecarAirlock) {
  "use strict";

  const AG_UI_PROTOCOL = "CAELUS_AG_UI_V1";
  const SPECIALIST_AGENTS = Object.freeze(["SENTINEL", "RED_TEAM", "STRATEGIST", "AUDITOR"]);

  function formatFpMinutesShort(fpDecStr) {
    if (typeof fpDecStr !== "string" || fpDecStr.length === 0) return "0.0 dk";
    try {
      const v = BigInt(fpDecStr);
      const neg = v < 0n;
      const abs = neg ? -v : v;
      const whole = abs / 1000000n;
      const tenths = (abs % 1000000n) / 100000n;
      const sign = neg ? "-" : "+";
      return `${sign}${whole.toString()}.${tenths.toString()} dk`;
    } catch (_) {
      return `${fpDecStr} fp`;
    }
  }

  function negateDecimalFpString(fpDecStr) {
    if (typeof fpDecStr !== "string" || fpDecStr.length === 0) return "0";
    try {
      const v = BigInt(fpDecStr);
      return (-v).toString();
    } catch (_) {
      return "0";
    }
  }

  function createWarRoomAgUiOrchestrator(options = {}) {
    if (!sidecarAirlock || !sidecarAirlock.createSidecarAirlockMcpController) {
      throw new Error("CaelusSidecarAirlockMcp modülü yüklenemedi.");
    }

    const airlockMcp =
      options.airlockMcp ||
      sidecarAirlock.createSidecarAirlockMcpController({
        repoRootDir: options.repoRootDir,
        sidecarBinaryPath: options.sidecarBinaryPath || null,
        forcePureJsFallback: Boolean(options.forcePureJsFallback),
        defaultBatchNdjson: options.defaultBatchNdjson,
        defaultManifestJson: options.defaultManifestJson,
      });

    function buildBatchInputArgs(params = {}) {
      const out = {};
      if (params.batch_path) out.batch_path = params.batch_path;
      if (params.ndjson_path) out.ndjson_path = params.ndjson_path;
      if (params.batch_ndjson) out.batch_ndjson = params.batch_ndjson;
      if (params.manifest_path) out.manifest_path = params.manifest_path;
      if (params.manifest_json) out.manifest_json = params.manifest_json;
      if (params.scenario_id) out.scenario_id = params.scenario_id;
      if (params.policy_id) out.policy_id = params.policy_id;
      if (params.max_allowed_fp) out.max_allowed_fp = String(params.max_allowed_fp);
      if (params.conflict_threshold_fp) {
        out.conflict_threshold_fp = String(params.conflict_threshold_fp);
      }
      if (params.audit_log_path) out.audit_log_path = params.audit_log_path;
      if (params.audit_seed) out.audit_seed = String(params.audit_seed);
      if (params.audit_session_id) out.audit_session_id = String(params.audit_session_id);
      if (params.det_clock === true) out.det_clock = true;
      return out;
    }

    /**
     * Belirtilen `cutoff_learned_at_ms` kesitinde 4 uzman ajanın tam orkestrasyonunu koşturur
     * ve `CAELUS_AG_UI_V1` zarf dizisini üretir.
     */
    function orchestrateSliceStream(params = {}) {
      const cutoffMs = String(params.cutoff_learned_at_ms || "1762849500000");
      const scenarioId = String(params.scenario_id || "AEGEAN_FERRY_01");
      const policyId = String(params.policy_id || "MARITIME_SAFETY_V2");
      const baseInput = buildBatchInputArgs({
        ...params,
        scenario_id: scenarioId,
        policy_id: policyId,
      });

      // 1) Ajan 1 — SENTINEL: Paket doğrulama + kesit değerlendirme
      const validationRes = airlockMcp.invokeAirlockTool({
        toolName: "caelus_airlock_validate_batch",
        arguments: {
          ...baseInput,
          advisor_template: "WATCHER",
        },
      });
      if (!validationRes.ok) {
        return { ok: false, error: validationRes, envelopes: [] };
      }

      const sliceRes = airlockMcp.invokeAirlockTool({
        toolName: "caelus_evaluate_slice",
        arguments: {
          ...baseInput,
          cutoff_learned_at_ms: cutoffMs,
          advisor_template: "STRESS_TESTER",
        },
      });
      if (!sliceRes.ok) {
        return { ok: false, error: sliceRes, envelopes: [] };
      }

      // 2) Ajan 4 — AUDITOR ön kanıt zinciri denetimi
      const explainArgs = {
        ...baseInput,
        cutoff_learned_at_ms: cutoffMs,
        state_blake3: sliceRes.state_blake3,
        advisor_template: "EXPLAINER",
      };
      const explainRes = airlockMcp.invokeAirlockTool({
        toolName: "caelus_explain_outcome",
        arguments: explainArgs,
      });
      if (!explainRes.ok) {
        return { ok: false, error: explainRes, envelopes: [] };
      }

      const envelopes = [];

      // Zarf 0: Tam kesit durum senkronizasyonu (TopCommandBar, Map, Graph, TimeConductor için)
      envelopes.push({
        protocol: AG_UI_PROTOCOL,
        msg_type: "SLICE_STATE_SYNC",
        cutoff_learned_at_ms: cutoffMs,
        scenario_id: scenarioId,
        policy_id: policyId,
        validation: validationRes,
        slice: sliceRes,
        explanation: explainRes,
      });

      // ── Ajan 1: SENTINEL (`EVENT_ANOMALY_FLAGGED`) ──────────────────────────
      const staleSources = Array.isArray(sliceRes.stale_sources) ? sliceRes.stale_sources : [];
      const rejectedInSlice = Array.isArray(sliceRes.rejected_in_slice)
        ? sliceRes.rejected_in_slice
        : [];
      const activeConflicts = Array.isArray(sliceRes.active_conflicts)
        ? sliceRes.active_conflicts
        : Array.isArray(sliceRes.conflicts)
          ? sliceRes.conflicts
          : [];
      const activeAssertions = Array.isArray(sliceRes.active_assertions)
        ? sliceRes.active_assertions
        : [];

      const anomalies = [];
      for (const rej of rejectedInSlice) {
        anomalies.push({
          anomaly_kind:
            rej.error_code === "ERR_SOURCE_EQUIVOCATION"
              ? "SOURCE_EQUIVOCATION_TAMPER"
              : "AIRLOCK_INGEST_REJECTED",
          severity: rej.error_code === "ERR_SOURCE_EQUIVOCATION" ? "CRITICAL" : "SERIOUS",
          source_id: rej.source_id,
          event_id: rej.event_id,
          seq_no: String(rej.seq_no),
          error_code: rej.error_code,
          detail_tr:
            rej.error_code === "ERR_SOURCE_EQUIVOCATION"
              ? `Kaynak çatallanması (${rej.source_id}, seq_no=${rej.seq_no}) yakalandı; simülasyon durumu 0-bit korundu.`
              : `Paket reddedildi (${rej.error_code}): ${rej.detail}`,
        });
      }
      for (const st of staleSources) {
        anomalies.push({
          anomaly_kind: "SENSOR_STALENESS_EXCEEDED",
          severity: "CAUTION",
          source_id: st.source_id,
          age_ms: String(st.age_ms),
          max_staleness_ms: String(st.max_staleness_ms),
          detail_tr: `${st.source_id} tazelik sınırını aştı (${st.age_ms} ms > ${st.max_staleness_ms} ms).`,
        });
      }
      for (const cf of activeConflicts) {
        const conflictingAssertions = activeAssertions.filter((a) =>
          (cf.event_ids || []).includes(a.event_id)
        );
        anomalies.push({
          anomaly_kind: "EPISTEMIC_SOURCE_CONFLICT",
          severity: "SERIOUS",
          subject_id: cf.subject_id,
          metric_key: cf.metric_key,
          min_fp_val: String(cf.min_fp_val),
          max_fp_val: String(cf.max_fp_val),
          source_ids: cf.source_ids,
          event_ids: cf.event_ids,
          preserved_side_by_side: conflictingAssertions.map((a) => ({
            event_id: a.event_id,
            source_id: a.source_id,
            epistemic_status: a.epistemic_status,
            fp_val: String(a.fp_val),
            human_label: formatFpMinutesShort(String(a.fp_val)),
          })),
          detail_tr: `${cf.subject_id}.${cf.metric_key} için bağımsız kaynaklar çelişiyor (${formatFpMinutesShort(String(cf.min_fp_val))} vs ${formatFpMinutesShort(String(cf.max_fp_val))}); her iki kanıt da silinmeden korundu.`,
        });
      }

      const sentinelSeverity = anomalies.some((a) => a.severity === "CRITICAL")
        ? "CRITICAL"
        : anomalies.some((a) => a.severity === "SERIOUS")
          ? "SERIOUS"
          : anomalies.length > 0
            ? "CAUTION"
            : "NOMINAL";

      envelopes.push({
        protocol: AG_UI_PROTOCOL,
        msg_type: "EVENT_ANOMALY_FLAGGED",
        agent_id: "SENTINEL",
        severity: sentinelSeverity,
        cutoff_learned_at_ms: cutoffMs,
        state_blake3: sliceRes.state_blake3,
        anomaly_count: anomalies.length,
        anomalies,
        stale_sources: staleSources,
        evidence_refs: activeAssertions.map((a) => ({
          event_id: a.event_id,
          source_id: a.source_id,
          epistemic_status: a.epistemic_status,
        })),
        summary_tr:
          anomalies.length === 0
            ? "Tüm imzalar ve kaynak tazelik pencereleri nominal sınırda."
            : `${anomalies.length} anomali saptandı (${rejectedInSlice.length} karantina, ${staleSources.length} bayat sensör, ${activeConflicts.length} kaynak çelişkisi).`,
      });

      // ── Ajan 2: RED_TEAM (`STRESS_THRESHOLD_ALERT`) ─────────────────────────
      const world12 = sliceRes.world_12_risk_band_fp || { p50: "0", p95: "0" };
      const maxAllowedFpStr = String(params.max_allowed_fp || "20000000");
      const maxAllowedBig = BigInt(maxAllowedFpStr);
      const p95Big = BigInt(String(world12.p95 || "0"));
      const eventMetrics = sliceRes.event_metrics || {};

      let maxWaveP95Fp = 0n;
      let maxWindGustFp = 0n;
      for (const m of Object.values(eventMetrics)) {
        const w = BigInt(String(m.wave_p95_m_fp || m.wave_m_fp || "0"));
        const g = BigInt(String(m.wind_gust_kn_fp || "0"));
        if (w > maxWaveP95Fp) maxWaveP95Fp = w;
        if (g > maxWindGustFp) maxWindGustFp = g;
      }

      const projectedBreachRules = [];
      if (p95Big > maxAllowedBig) {
        projectedBreachRules.push("RULE_WORLD12_P95_DELAY_ENVELOPE_EXCEEDED");
      }
      if (maxWaveP95Fp >= 2500000n) {
        projectedBreachRules.push("RULE_MARITIME_WAVE_P95_BERTH_A_LIMIT");
      }
      if (maxWindGustFp >= 30000000n) {
        projectedBreachRules.push("RULE_CROSSWIND_RAMP_MOORING_ENVELOPE");
      }

      const redTeamSeverity =
        sliceRes.verdict === "KURAL_İHLALİ"
          ? "SERIOUS"
          : projectedBreachRules.length > 0
            ? "CAUTION"
            : "NOMINAL";

      envelopes.push({
        protocol: AG_UI_PROTOCOL,
        msg_type: "STRESS_THRESHOLD_ALERT",
        agent_id: "RED_TEAM",
        severity: redTeamSeverity,
        cutoff_learned_at_ms: cutoffMs,
        state_blake3: sliceRes.state_blake3,
        verdict: sliceRes.verdict,
        world_12_risk_band_fp: {
          p50: String(world12.p50),
          p95: String(world12.p95),
        },
        max_allowed_fp: maxAllowedFpStr,
        wave_p95_m_fp: maxWaveP95Fp.toString(),
        wind_gust_kn_fp: maxWindGustFp.toString(),
        projected_breach_rules: projectedBreachRules,
        summary_tr:
          projectedBreachRules.length > 0
            ? `12-Dünya p95 stres zarfında ${projectedBreachRules.length} emniyet sınırı baskı altında (p95=${String(world12.p95)} fp, dalga p95=${maxWaveP95Fp.toString()} fp).`
            : "12-Dünya p50/p95 stres zarfı emniyet eşikleri içinde.",
      });

      // ── Ajan 3 (STRATEGIST) + Ajan 4 (AUDITOR): Karşılaştırmalı `ACTION_APPROVAL_CARD`lar ──
      const supportingEvents = Array.isArray(explainRes.supporting_events)
        ? explainRes.supporting_events
        : activeAssertions.map((a) => ({
            event_id: a.event_id,
            source_id: a.source_id,
            epistemic_status: a.epistemic_status,
            fp_val: a.fp_val,
          }));
      const hasIndependentObservation = supportingEvents.some(
        (ev) => ev.epistemic_status === "OBSERVATION"
      );

      if (sliceRes.verdict === "KURAL_İHLALİ" || sliceRes.verdict === "KANIT_YETERSİZ") {
        const candidatePlans = [
          {
            card_id: "coa-20261111-01",
            branch_id: "cf_01",
            title: "Yedek Rıhtıma (Berth-B) Yönlendirme ve +20 dk Kalkış Güncellemesi",
            rationale_tr:
              "Rüzgar altı Berth-B rampasını devreye alarak Sığacık ana rıhtım kuyruğunu sönümler ve SLA ihlalini emniyet marjına çeker.",
            focus_target: { entity_id: "VESSEL_AEGEAN_01", berth_id: "BERTH_B", graph_node: "ev_104" },
            interventions: [{ target_id: "BERTH_02", override_field: "status", fp_val: "0" }],
          },
          {
            card_id: "coa-20261111-02",
            branch_id: "cf_02",
            title: "Güney Samos Dalga Korunaklı Koridora Geçiş ve İskele Sıra Kilidi",
            rationale_tr:
              "p95 dalga zarfını düşürmek için Güney Samos korunaklı rota koridoruna geçer ve rıhtım kapı kilidini senkronize eder.",
            focus_target: {
              entity_id: "CORRIDOR_SIGACIK_VATHI",
              berth_id: "BERTH_A",
              graph_node: "ev_109",
            },
            interventions: [
              {
                target_id: "ROUTE_SHELTER_01",
                override_field: "route_shelter_corridor",
                fp_val: "16000000",
              },
            ],
          },
        ];

        // Kanıt referanslarını öncelikli olarak OBSERVATION + HYPOTHESIS + CLAIM birleşimiyle kur
        const evidenceRefs = activeAssertions.map((a) => ({
          event_id: a.event_id,
          source_id: a.source_id,
          epistemic_status: a.epistemic_status,
          fp_val: String(a.fp_val),
          seq_no: String(a.seq_no),
        }));

        const conflictComparison =
          activeConflicts.length > 0
            ? activeAssertions
                .filter((a) => (activeConflicts[0].event_ids || []).includes(a.event_id))
                .map((a) => ({
                  event_id: a.event_id,
                  source_id: a.source_id,
                  epistemic_status: a.epistemic_status,
                  fp_val: String(a.fp_val),
                  label: `${a.source_id} (${a.epistemic_status}): ${formatFpMinutesShort(String(a.fp_val))}`,
                }))
            : [];

        for (const plan of candidatePlans) {
          const cfRes = airlockMcp.invokeAirlockTool({
            toolName: "caelus_run_counterfactual_branch",
            arguments: {
              ...baseInput,
              base_cutoff_ms: cutoffMs,
              branch_id: plan.branch_id,
              interventions: plan.interventions,
              advisor_template: "STRATEGIST",
            },
          });
          if (!cfRes.ok) continue;

          const safetyMarginGainFp = negateDecimalFpString(String(cfRes.delta_risk_fp || "0"));
          const cardSeverity =
            sliceRes.verdict === "KURAL_İHLALİ" ? "SERIOUS" : "CAUTION";

          envelopes.push({
            protocol: AG_UI_PROTOCOL,
            msg_type: "ACTION_APPROVAL_CARD",
            card_id: plan.card_id,
            branch_id: plan.branch_id,
            severity: cardSeverity,
            verdict_context: sliceRes.verdict,
            base_verdict: cfRes.base_verdict,
            branch_verdict: cfRes.branch_verdict,
            title: plan.title,
            rationale_tr: plan.rationale_tr,
            agents_involved: [...SPECIALIST_AGENTS],
            evidence_refs: evidenceRefs.map((e) => ({
              event_id: e.event_id,
              source_id: e.source_id,
              epistemic_status: e.epistemic_status,
            })),
            evidence_details: evidenceRefs,
            conflicting_evidence_pair: conflictComparison,
            independence_groups: sliceRes.corroborated_groups || [],
            opencti_confidence: hasIndependentObservation ? 88 : 42,
            counterfactual_delta: {
              delay_change_min_fp: String(cfRes.delta_delay_min_fp),
              safety_margin_gain_fp: safetyMarginGainFp,
              branch_state_blake3: String(cfRes.branch_state_blake3),
            },
            interventions: plan.interventions,
            focus_target: plan.focus_target,
            state_blake3: sliceRes.state_blake3,
            auditor_check: {
              agent_id: "AUDITOR",
              observation_corroborated: hasIndependentObservation,
              auto_execution_locked: true,
              lock_reason_code: hasIndependentObservation
                ? "HUMAN_ED25519_SIGNATURE_REQUIRED"
                : "MISSING_INDEPENDENT_OBSERVATION_EVIDENCE",
              triggered_rules: explainRes.triggered_rules || [sliceRes.applied_rule_id],
              audit_chain_verified: Boolean(explainRes.audit_chain_verified),
              seal_signer_pubkey: String(explainRes.seal_signer_pubkey || ""),
            },
            requires_human_ed25519_signature: true,
          });
        }
      }

      return {
        ok: true,
        cutoff_learned_at_ms: cutoffMs,
        verdict: sliceRes.verdict,
        state_blake3: sliceRes.state_blake3,
        envelopes,
      };
    }

    /**
     * Komuta Asistanı Sorgu Çubuğu (§4.2.4):
     * Doğal dil sorusuna serbest metin uydurmadan, doğrudan MCP araç çıktılarına ve
     * kanıt referanslarına (`event_id`, `source_id`, `state_blake3`) bağlı yanıt üretir.
     */
    function answerEvidenceBoundQuery(params = {}) {
      const queryText = String(params.query || "").trim();
      const cutoffMs = String(params.cutoff_learned_at_ms || "1762849500000");
      const scenarioId = String(params.scenario_id || "AEGEAN_FERRY_01");
      const policyId = String(params.policy_id || "MARITIME_SAFETY_V2");
      const baseInput = buildBatchInputArgs({
        ...params,
        scenario_id: scenarioId,
        policy_id: policyId,
      });

      const toolsInvoked = ["caelus_evaluate_slice", "caelus_explain_outcome"];
      const sliceRes = airlockMcp.invokeAirlockTool({
        toolName: "caelus_evaluate_slice",
        arguments: {
          ...baseInput,
          cutoff_learned_at_ms: cutoffMs,
          advisor_template: "STRESS_TESTER",
        },
      });
      if (!sliceRes.ok) {
        return { ok: false, error: sliceRes };
      }

      const explainRes = airlockMcp.invokeAirlockTool({
        toolName: "caelus_explain_outcome",
        arguments: {
          ...baseInput,
          cutoff_learned_at_ms: cutoffMs,
          state_blake3: sliceRes.state_blake3,
          advisor_template: "EXPLAINER",
        },
      });

      const qLower = queryText.toLowerCase();
      let cfOut = null;
      if (
        qLower.includes("berth") ||
        qLower.includes("rıhtım") ||
        qLower.includes("rihtim") ||
        qLower.includes("karşı") ||
        qLower.includes("karsi") ||
        qLower.includes("what-if") ||
        qLower.includes("stres") ||
        qLower.includes("alternatif")
      ) {
        toolsInvoked.push("caelus_run_counterfactual_branch");
        cfOut = airlockMcp.invokeAirlockTool({
          toolName: "caelus_run_counterfactual_branch",
          arguments: {
            ...baseInput,
            base_cutoff_ms: cutoffMs,
            branch_id: "cf_query_01",
            interventions: [{ target_id: "BERTH_02", override_field: "status", fp_val: "0" }],
            advisor_template: "STRATEGIST",
          },
        });
      }

      const active = sliceRes.active_assertions || [];
      const conflicts = sliceRes.active_conflicts || sliceRes.conflicts || [];
      const missing = sliceRes.missing_corroborations || sliceRes.missing_evidence || [];
      const evidenceRefs = active.map((a) => ({
        event_id: a.event_id,
        source_id: a.source_id,
        epistemic_status: a.epistemic_status,
        fp_val: String(a.fp_val),
        seq_no: String(a.seq_no),
      }));

      const parts = [
        `[MCP Kanıt Yanıtı] Kesit=${cutoffMs} ms | Karar=${sliceRes.verdict} | Kural=${sliceRes.applied_rule_id} | state_blake3=${sliceRes.state_blake3.slice(0, 16)}…`,
      ];
      if (conflicts.length > 0) {
        const c = conflicts[0];
        parts.push(
          `Çelişki Korundu: ${c.subject_id}.${c.metric_key} aralığı [${formatFpMinutesShort(String(c.min_fp_val))}, ${formatFpMinutesShort(String(c.max_fp_val))}] (${(c.source_ids || []).join(" vs ")}).`
        );
      }
      if (missing.length > 0) {
        parts.push(`Eksik Teyit: ${missing.join(", ")}.`);
      }
      if (cfOut && cfOut.ok) {
        parts.push(
          `Karşı-Olgu (${cfOut.branch_id}): ${cfOut.base_verdict} -> ${cfOut.branch_verdict} (Δ gecikme=${formatFpMinutesShort(String(cfOut.delta_delay_min_fp))}, branch_blake3=${cfOut.branch_state_blake3.slice(0, 12)}…).`
        );
      }

      return {
        ok: true,
        envelope: {
          protocol: AG_UI_PROTOCOL,
          msg_type: "ASSISTANT_EVIDENCE_REPLY",
          query: queryText,
          cutoff_learned_at_ms: cutoffMs,
          verdict: sliceRes.verdict,
          applied_rule_id: sliceRes.applied_rule_id,
          state_blake3: sliceRes.state_blake3,
          mcp_tools_invoked: toolsInvoked,
          world_12_risk_band_fp: sliceRes.world_12_risk_band_fp,
          evidence_refs: evidenceRefs,
          triggered_rules: (explainRes && explainRes.triggered_rules) || [sliceRes.applied_rule_id],
          counterfactual_preview: cfOut && cfOut.ok ? cfOut : null,
          structured_answer_tr: parts.join(" "),
        },
      };
    }

    return {
      AG_UI_PROTOCOL,
      SPECIALIST_AGENTS,
      airlockMcp,
      orchestrateSliceStream,
      answerEvidenceBoundQuery,
      sealOperatorActionCard: (sealArgs) => airlockMcp.sealOperatorActionCard(sealArgs),
    };
  }

  return {
    AG_UI_PROTOCOL,
    SPECIALIST_AGENTS,
    formatFpMinutesShort,
    createWarRoomAgUiOrchestrator,
  };
});
