#!/usr/bin/env node
/**
 * CAELUS OS — Offline i18n Catalog Synchronizer (`tools/sync_war_room_i18n_bundle.mjs`)
 *
 * Reads `locales/<lang>/{common,plain,technical}.json`, verifies 100% 1-to-1 key parity
 * across all languages and registers (`plain` <-> `technical`), and generates the zero-network
 * UMD runtime `ui/war_room_i18n.js` for Browser, `file://`, WASM Standalone, and Node.js.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const localesDir = path.join(repoRoot, "locales");

const SUPPORTED_LOCALES = ["tr", "en"];
const NAMESPACES = ["common", "plain", "technical"];

function loadSortedJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const out = {};
  for (const k of Object.keys(parsed).sort()) {
    out[k] = String(parsed[k]);
  }
  return out;
}

const catalog = {};
for (const loc of SUPPORTED_LOCALES) {
  catalog[loc] = {};
  for (const ns of NAMESPACES) {
    const fp = path.join(localesDir, loc, `${ns}.json`);
    catalog[loc][ns] = loadSortedJson(fp);
  }
}

// Verify strict parity before emitting
for (const ns of NAMESPACES) {
  const baseKeys = Object.keys(catalog.tr[ns]);
  for (const loc of SUPPORTED_LOCALES) {
    const locKeys = Object.keys(catalog[loc][ns]);
    const missing = baseKeys.filter((k) => !locKeys.includes(k));
    const extra = locKeys.filter((k) => !baseKeys.includes(k));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `Locale parity mismatch in ${loc}/${ns}.json: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`
      );
    }
  }
}

// Verify plain.json <-> technical.json register symmetry
for (const loc of SUPPORTED_LOCALES) {
  const plainKeys = Object.keys(catalog[loc].plain);
  const techKeys = Object.keys(catalog[loc].technical);
  const missingInTech = plainKeys.filter((k) => !techKeys.includes(k));
  const extraInTech = techKeys.filter((k) => !plainKeys.includes(k));
  if (missingInTech.length > 0 || extraInTech.length > 0) {
    throw new Error(
      `Register parity mismatch in ${loc} plain vs technical: missingInTech=${JSON.stringify(missingInTech)} extraInTech=${JSON.stringify(extraInTech)}`
    );
  }
}

const embeddedJson = JSON.stringify(catalog, null, 2);

const outputJs = `/**
 * CAELUS OS — Dual-Axis Plain-Language UX & 100% Offline Translation Engine (\`war_room_i18n.js\`)
 *
 * Katman 1 (Master Spesifikasyon §2.1 & §2.2, Yasa A-3 & A-4):
 * - Çift Eksenli Dil Matrisi: \`locale\` ("tr" | "en" + genişletilebilir yerel paketler) × \`register\` ("plain" | "technical").
 * - Varsayılan Açılış Modu: \`locale = "tr"\`, \`register = "plain"\` (Sade Operatör Görünümü).
 * - Determinizm Garantisi: Dil veya anlatım seviyesi değiştiğinde çekirdek \`state_blake3\` özeti 0 bit değişir.
 * - Hava Boşluklu Çalışma: Sıfır harici HTTP/CDN isteği; \`Intl.NumberFormat\` ve \`Intl.DateTimeFormat\` ile yerel birim dönüşümü (\`knot\` ↔ \`km/sa\`, \`NM\` ↔ \`km\`, \`UTC\` ↔ \`Yerel Saat\`).
 *
 * Auto-synchronized from \`locales/{tr,en}/{common,plain,technical}.json\` via \`tools/sync_war_room_i18n_bundle.mjs\`.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    let nodeFs = null;
    let nodePath = null;
    try {
      nodeFs = require("node:fs");
      nodePath = require("node:path");
    } catch (_) {}
    module.exports = factory(nodeFs, nodePath);
  } else {
    root.CaelusWarRoomI18n = factory(null, null);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (nodeFs, nodePath) {
  "use strict";

  const DEFAULT_LOCALE = "tr";
  const DEFAULT_REGISTER = "plain";
  const SUPPORTED_LOCALES = ["tr", "en"];
  const SUPPORTED_REGISTERS = ["plain", "technical"];

  const EMBEDDED_LOCALE_CATALOG = ${embeddedJson};

  function cloneCatalog(src) {
    return JSON.parse(JSON.stringify(src));
  }

  function loadRuntimeCatalog(repoRootDir) {
    const active = cloneCatalog(EMBEDDED_LOCALE_CATALOG);
    if (nodeFs && nodePath) {
      const rootDir = repoRootDir || nodePath.resolve(__dirname, "..");
      const localesRoot = nodePath.join(rootDir, "locales");
      if (nodeFs.existsSync(localesRoot)) {
        for (const loc of Object.keys(active)) {
          for (const ns of ["common", "plain", "technical"]) {
            const fp = nodePath.join(localesRoot, loc, ns + ".json");
            if (nodeFs.existsSync(fp)) {
              try {
                active[loc][ns] = JSON.parse(nodeFs.readFileSync(fp, "utf8"));
              } catch (_) {}
            }
          }
        }
      }
    }
    return active;
  }

  const runtimeCatalog = loadRuntimeCatalog();

  function normalizeLocale(locale) {
    const s = String(locale || DEFAULT_LOCALE).trim().toLowerCase();
    return runtimeCatalog[s] ? s : DEFAULT_LOCALE;
  }

  function normalizeRegister(register) {
    const s = String(register || DEFAULT_REGISTER).trim().toLowerCase();
    return s === "technical" ? "technical" : "plain";
  }

  function getIntlLocaleTag(locale) {
    const loc = normalizeLocale(locale);
    return loc === "tr" ? "tr-TR" : "en-US";
  }

  function interpolateTemplate(templateStr, params = {}) {
    if (typeof templateStr !== "string") return "";
    return templateStr.replace(/\\{([a-zA-Z0-9_]+)\\}/g, (_, key) => {
      if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined && params[key] !== null) {
        return String(params[key]);
      }
      return "{" + key + "}";
    });
  }

  /**
   * Çift eksenli sözlük sorgusu (\`locale\` × \`register\`).
   * Önce seçili \`register\` (\`plain\` veya \`technical\`), bulunamazsa \`common\` sözlüğüne bakar.
   */
  function t(key, params = {}, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const reg = normalizeRegister(ctx.register);
    const bundle = runtimeCatalog[loc] || runtimeCatalog[DEFAULT_LOCALE];
    const regDict = bundle[reg] || {};
    const commonDict = bundle.common || {};
    const raw = Object.prototype.hasOwnProperty.call(regDict, key)
      ? regDict[key]
      : Object.prototype.hasOwnProperty.call(commonDict, key)
        ? commonDict[key]
        : key;
    return interpolateTemplate(raw, params);
  }

  function registerLocaleCatalog(localeCode, bundleObj) {
    const code = String(localeCode || "").trim().toLowerCase();
    if (!code || !bundleObj) return false;
    runtimeCatalog[code] = {
      common: { ...(bundleObj.common || {}) },
      plain: { ...(bundleObj.plain || {}) },
      technical: { ...(bundleObj.technical || {}) },
    };
    if (!SUPPORTED_LOCALES.includes(code)) {
      SUPPORTED_LOCALES.push(code);
    }
    return true;
  }

  function formatDecimalFromFpBigInt(fpBig, decimals, locale, explicitPlus = false) {
    const neg = fpBig < 0n;
    const abs = neg ? -fpBig : fpBig;
    const scale = 1000000n;
    let factor = 1n;
    for (let i = 0; i < decimals; i++) factor *= 10n;
    const step = scale / factor;
    const roundedUnits = (abs + step / 2n) / step;
    const intPart = roundedUnits / factor;
    const fracPart = roundedUnits % factor;
    const numVal = Number(intPart) + (decimals > 0 ? Number(fracPart) / Number(factor) : 0);

    let formatted;
    try {
      formatted = new Intl.NumberFormat(getIntlLocaleTag(locale), {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(numVal);
    } catch (_) {
      const sep = normalizeLocale(locale) === "tr" ? "," : ".";
      formatted =
        decimals > 0
          ? intPart.toString() + sep + fracPart.toString().padStart(decimals, "0")
          : intPart.toString();
    }
    const prefix = neg ? "-" : explicitPlus ? "+" : "";
    return prefix + formatted;
  }

  function formatFpMinutes(fpDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const minUnit = t("unit.min_short", {}, { locale: loc });
    const explicitPlus = ctx.signed !== false;
    try {
      const v = BigInt(String(fpDecStr || "0"));
      const numStr = formatDecimalFromFpBigInt(v, 1, loc, explicitPlus);
      return numStr + " " + minUnit;
    } catch (_) {
      return String(fpDecStr || "0") + " " + minUnit;
    }
  }

  function formatFpMeters(fpDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const mUnit = t("unit.meter_short", {}, { locale: loc });
    const decimals = ctx.decimals === 1 ? 1 : 2;
    try {
      const v = BigInt(String(fpDecStr || "0"));
      return formatDecimalFromFpBigInt(v, decimals, loc, false) + " " + mUnit;
    } catch (_) {
      return String(fpDecStr || "0") + " " + mUnit;
    }
  }

  /**
   * Sabit noktalı knot değerini (\`1e6\` ölçekli) kayan nokta hatası olmadan \`knot\` veya \`km/sa\` (\`km/h\`) olarak biçimler.
   * Tam dönüşüm: \`1 knot = 1.852 km/h\` -> \`(fp * 1852n + 500n) / 1000n\`.
   */
  function formatFpSpeedKn(fpKnDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const speedUnit = ctx.speedUnit === "kmh" ? "kmh" : "kn";
    try {
      const knFp = BigInt(String(fpKnDecStr || "0"));
      if (speedUnit === "kmh") {
        const kmhFp = (knFp * 1852n + 500n) / 1000n;
        return formatDecimalFromFpBigInt(kmhFp, 1, loc, false) + " " + t("unit.kmh_short", {}, { locale: loc });
      }
      return formatDecimalFromFpBigInt(knFp, 1, loc, false) + " " + t("unit.kn_short", {}, { locale: loc });
    } catch (_) {
      return String(fpKnDecStr || "0") + " " + t("unit.kn_short", {}, { locale: loc });
    }
  }

  /**
   * Sabit noktalı deniz mili (\`NM * 1e6\`) değerini \`NM\` veya \`km\` olarak biçimler.
   */
  function formatFpDistanceNm(fpNmDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const distUnit = ctx.distanceUnit === "km" ? "km" : "nm";
    try {
      const nmFp = BigInt(String(fpNmDecStr || "0"));
      if (distUnit === "km") {
        const kmFp = (nmFp * 1852n + 500n) / 1000n;
        return formatDecimalFromFpBigInt(kmFp, 1, loc, false) + " " + t("unit.km_short", {}, { locale: loc });
      }
      return formatDecimalFromFpBigInt(nmFp, 1, loc, false) + " " + t("unit.nm_short", {}, { locale: loc });
    } catch (_) {
      return String(fpNmDecStr || "0") + " " + t("unit.nm_short", {}, { locale: loc });
    }
  }

  function formatClockMs(msDecStr, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const clockMode = ctx.clockMode === "LOCAL" ? "LOCAL" : "UTC";
    try {
      const ms = Number(BigInt(String(msDecStr)));
      const d = new Date(ms);
      if (clockMode === "LOCAL") {
        const hhmmss = new Intl.DateTimeFormat(getIntlLocaleTag(loc), {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(d);
        return hhmmss + " " + t("topbar.clock_local", {}, { locale: loc });
      }
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      const ss = String(d.getUTCSeconds()).padStart(2, "0");
      return hh + ":" + mm + ":" + ss + " UTC";
    } catch (_) {
      return String(msDecStr) + " ms";
    }
  }

  function formatVerdict(verdictCode, params = {}, ctx = {}) {
    const code = String(verdictCode || "KANIT_YETERSİZ");
    const loc = normalizeLocale(ctx.locale);
    const reg = normalizeRegister(ctx.register);
    const key = "verdict." + code;
    const thresholdLabel = params.threshold_label || formatFpMinutes(String(params.max_allowed_fp || "20000000"), { locale: loc, signed: false });
    return t(
      key,
      {
        policy_id: params.policy_id || "MARITIME_SAFETY_V2",
        rule_id: params.rule_id || "RULE_SLA_BREACH_CORROBORATED",
        threshold_label: thresholdLabel,
        missing_groups:
          Array.isArray(params.missing_groups) && params.missing_groups.length > 0
            ? params.missing_groups.join(", ")
            : params.missing_groups || "OBSERVATION",
      },
      { locale: loc, register: reg }
    );
  }

  function formatEpistemic(epistemicCode, ctx = {}) {
    const code = String(epistemicCode || "CLAIM").toUpperCase();
    return t("epistemic." + code, {}, ctx);
  }

  function formatEpistemicShort(epistemicCode, ctx = {}) {
    const reg = normalizeRegister(ctx.register);
    const code = String(epistemicCode || "CLAIM").toUpperCase();
    if (reg === "technical") return code;
    return t("epistemic." + code, {}, { locale: ctx.locale, register: "plain" });
  }

  function formatSourceName(sourceId, ctx = {}) {
    const reg = normalizeRegister(ctx.register);
    const rawId = String(sourceId || "unknown");
    if (reg === "technical") return rawId;
    const key = "source." + rawId;
    const resolved = t(key, {}, { locale: ctx.locale, register: "plain" });
    return resolved === key ? rawId : resolved;
  }

  function formatAlarmBadge(severityOrVerdict, ctx = {}) {
    const s = String(severityOrVerdict || "").toUpperCase();
    if (s === "CRITICAL" || s === "KURAL_İHLALİ") return t("alarm.critical", {}, ctx);
    if (s === "SERIOUS") return t("alarm.serious", {}, ctx);
    if (s === "CAUTION" || s === "STALE") return t("alarm.caution", {}, ctx);
    if (s === "NOMINAL" || s === "GEÇTİ" || s === "FRESH") return t("alarm.nominal", {}, ctx);
    return t("alarm.awaiting", {}, ctx);
  }

  /**
   * §2.1 Kanonik Mesaj Anahtarı Çözümleyici:
   * Çekirdek ve Sidecar yalnızca \`msg_id\` + \`params\` üretir; bu fonksiyon seçili \`locale\` ve \`register\`
   * için insan veya denetim metnini deterministik olarak üretir.
   */
  function resolveCanonicalMessage(msgId, params = {}, ctx = {}) {
    const loc = normalizeLocale(ctx.locale);
    const reg = normalizeRegister(ctx.register);
    const id = String(msgId || "");

    if (id === "verdict.pass") {
      return formatVerdict("GEÇTİ", params, { locale: loc, register: reg });
    }
    if (id === "verdict.rule_breach") {
      return formatVerdict("KURAL_İHLALİ", params, { locale: loc, register: reg });
    }
    if (id === "verdict.insufficient_corroboration") {
      return formatVerdict("KANIT_YETERSİZ", params, { locale: loc, register: reg });
    }
    if (id === "epistemic.observation") {
      return formatEpistemic("OBSERVATION", { locale: loc, register: reg });
    }
    if (id === "epistemic.claim") {
      return formatEpistemic("CLAIM", { locale: loc, register: reg });
    }
    if (id === "epistemic.hypothesis") {
      return formatEpistemic("HYPOTHESIS", { locale: loc, register: reg });
    }
    if (id === "security.source_equivocation") {
      return t(
        "security.ERR_SOURCE_EQUIVOCATION",
        {
          source_id: params.source_id || "unknown",
          seq_no: String(params.seq_no || "0"),
        },
        { locale: loc, register: reg }
      );
    }
    if (id === "temporal.bitemporal_slice") {
      return t("temporal.bitemporal_axis", params, { locale: loc, register: reg });
    }
    if (id === "counterfactual.branch_delta") {
      return t("counterfactual.branch_title", params, { locale: loc, register: reg });
    }
    if (id === "explain.outcome") {
      const verdictCode = String(params.verdict_code || "KANIT_YETERSİZ");
      const verdictLabel = formatVerdict(verdictCode, params, { locale: loc, register: "plain" });
      return t(
        "explain.outcome_summary",
        {
          verdict_label: verdictLabel,
          verdict_code: verdictCode,
          rule_id: params.rule_id || "—",
          group_count: String(params.group_count !== undefined ? params.group_count : "0"),
          state_blake3: String(params.state_blake3 || ""),
        },
        { locale: loc, register: reg }
      );
    }
    return t(id, params, { locale: loc, register: reg });
  }

  function verifyCatalogParity() {
    const issues = [];
    const baseCommon = Object.keys(runtimeCatalog.tr.common).sort();
    const basePlain = Object.keys(runtimeCatalog.tr.plain).sort();
    const baseTech = Object.keys(runtimeCatalog.tr.technical).sort();

    if (JSON.stringify(basePlain) !== JSON.stringify(baseTech)) {
      issues.push("TR plain vs technical keys differ");
    }

    for (const loc of Object.keys(runtimeCatalog)) {
      const cKeys = Object.keys(runtimeCatalog[loc].common || {}).sort();
      const pKeys = Object.keys(runtimeCatalog[loc].plain || {}).sort();
      const tKeys = Object.keys(runtimeCatalog[loc].technical || {}).sort();
      if (JSON.stringify(cKeys) !== JSON.stringify(baseCommon)) {
        issues.push(loc + "/common keys differ from tr/common");
      }
      if (JSON.stringify(pKeys) !== JSON.stringify(basePlain)) {
        issues.push(loc + "/plain keys differ from tr/plain");
      }
      if (JSON.stringify(tKeys) !== JSON.stringify(baseTech)) {
        issues.push(loc + "/technical keys differ from tr/technical");
      }
      for (const [ns, dict] of [
        ["common", runtimeCatalog[loc].common],
        ["plain", runtimeCatalog[loc].plain],
        ["technical", runtimeCatalog[loc].technical],
      ]) {
        for (const [k, v] of Object.entries(dict || {})) {
          if (typeof v !== "string" || v.trim().length === 0) {
            issues.push(loc + "/" + ns + ":" + k + " is empty");
          }
        }
      }
    }

    return {
      ok: issues.length === 0,
      locales: Object.keys(runtimeCatalog),
      commonKeyCount: baseCommon.length,
      plainKeyCount: basePlain.length,
      technicalKeyCount: baseTech.length,
      issues,
    };
  }

  return {
    DEFAULT_LOCALE,
    DEFAULT_REGISTER,
    SUPPORTED_LOCALES,
    SUPPORTED_REGISTERS,
    EMBEDDED_LOCALE_CATALOG,
    normalizeLocale,
    normalizeRegister,
    getIntlLocaleTag,
    t,
    registerLocaleCatalog,
    formatFpMinutes,
    formatFpMeters,
    formatFpSpeedKn,
    formatFpDistanceNm,
    formatClockMs,
    formatVerdict,
    formatEpistemic,
    formatEpistemicShort,
    formatSourceName,
    formatAlarmBadge,
    resolveCanonicalMessage,
    verifyCatalogParity,
    getCatalogSnapshot() {
      return cloneCatalog(runtimeCatalog);
    },
  };
});
`;

const targetPath = path.join(repoRoot, "ui", "war_room_i18n.js");
fs.writeFileSync(targetPath, outputJs, "utf8");
console.log(
  `[sync_war_room_i18n] OK -> ui/war_room_i18n.js (${Object.keys(catalog.tr.common).length} common + ${Object.keys(catalog.tr.plain).length} plain + ${Object.keys(catalog.tr.technical).length} technical keys across [${SUPPORTED_LOCALES.join(", ")}])`
);
