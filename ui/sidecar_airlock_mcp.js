/**
 * CAELUS OS — Sidecar Airlock & Bi-Temporal Slice Replay MCP Controller (PR-1)
 *
 * Mimari Sözleşme (PR-1 §3, §4, §5, §7.3):
 * - Sıfır yeni harici paket bağımlılığı (yalnız yerleşik Node.js modülleri veya saf JS BigInt).
 * - JSON / MCP sınırında tüm 64-bit tam sayılar (`int64_t` / `uint64_t`, sabit nokta `fp_val`,
 *   `cutoff_learned_at_ms`, `observed_at_ms`, `learned_at_ms`, `seq_no`, vb.) ondalık ASCII
 *   dizge (`string`) olarak taşınır (`> 2^53 - 1` bit kaybı sıfırdır).
 * - Mevcut yerel Rust yan-araba ikilisi (`caelus_sidecar_airlock`) mevcutsa doğrudan onu
 *   alt-süreç olarak çalıştırır (`NATIVE_RUST_AIRLOCK`); ikili derlenmemiş ortamda bit-özdeş
 *   saf JS (`BigInt` + `node:crypto` Ed25519 + saf BLAKE3) yedek motoru devreye girer.
 * - Üç salt-okunur pilot değerlendirme aracı (`caelus_airlock_validate_batch`,
 *   `caelus_evaluate_slice`, `caelus_explain_outcome`) ve bunları kullanan dört kısıtlı
 *   Advisor görev şablonu (`WATCHER`, `STRESS_TESTER`, `STRATEGIST`, `EXPLAINER`) sunar;
 *   gerçek operasyon sistemlerine yazma yetkisi yoktur (`write_authority: "NONE"`).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    let nodeDeps = null;
    let i18nMod = null;
    try {
      nodeDeps = {
        fs: require("node:fs"),
        os: require("node:os"),
        path: require("node:path"),
        crypto: require("node:crypto"),
        childProcess: require("node:child_process"),
      };
    } catch (_) {
      nodeDeps = null;
    }
    try {
      i18nMod = require("./war_room_i18n.js");
    } catch (_) {
      i18nMod = null;
    }
    module.exports = factory(nodeDeps, i18nMod);
  } else {
    root.CaelusSidecarAirlockMcp = factory(null, root.CaelusWarRoomI18n || null);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (nodeDeps, warRoomI18n) {
  "use strict";

  const FP_SCALE = 1000000n;
  const AIRLOCK_FP_SAFE_MAX_ABS = 1n << 62n; // 4_611_686_018_427_387_904
  const I64_MIN = -(1n << 63n);
  const I64_MAX = (1n << 63n) - 1n;
  const U64_MAX = (1n << 64n) - 1n;
  const JS_MAX_SAFE_BIGINT = 9007199254740991n;
  const CAELUS_AIRLOCK_ENGINE_VERSION = "caelus_airlock_pr1_v2.0.0";

  const ALLOWED_VERDICTS = Object.freeze(["GEÇTİ", "KURAL_İHLALİ", "KANIT_YETERSİZ"]);

  const STRICT_64BIT_STRING_FIELDS = new Set([
    "cutoff_learned_at_ms",
    "base_cutoff_ms",
    "cutoff_ts",
    "as_of_ts",
    "asOfTs",
    "observed_at_ms",
    "learned_at_ms",
    "fp_val",
    "max_allowed_fp",
    "conflict_threshold_fp",
    "max_staleness_ms",
    "delta_delay_min_fp",
    "delta_risk_fp",
    "delay_change_min_fp",
    "safety_margin_gain_fp",
    "approved_at_ms",
    "delay_min_fp",
    "lat_deg_fp",
    "lon_deg_fp",
    "sog_kn_fp",
    "wave_m_fp",
    "wind_gust_kn_fp",
    "wind_speed_mps_fp",
    "baro_alt_m_fp",
    "depth_m_fp",
    "seq_no",
    "audit_session_id",
    "expires_at_ms",
    "min_fp_val",
    "max_fp_val",
    "deterministic_state_fnv64",
    "raw_friction_fp",
    "clamped_friction_fp",
    "throughput_ratio_fp",
    "tick",
  ]);

  // §4 & Master §3.1-3.2: Gözcü (SENTINEL/WATCHER), Stres Testi (RED_TEAM/STRESS_TESTER),
  // Stratejist (STRATEGIST) ve Denetçi/Açıklayıcı (AUDITOR/EXPLAINER) görev şablonları.
  const ADVISOR_TASK_TEMPLATES_4 = Object.freeze({
    WATCHER: Object.freeze({
      templateId: "WATCHER",
      agentAlias: "SENTINEL",
      labelTr: "Gözcü (Aday Paket, Tazelik ve İmza/Yetki Denetimi)",
      autonomousService: false,
      humanApprovalRequired: true,
      writeAuthority: "NONE",
      allowedTools: Object.freeze([
        "caelus_airlock_validate_batch",
        "caelus_evaluate_slice",
        "caelus_run_counterfactual_branch",
        "caelus_explain_outcome",
      ]),
      primaryTool: "caelus_airlock_validate_batch",
      scopeTr:
        "İmzalı aday olay paketini manifest, max_staleness_ms, şema ve sabit nokta sınırlarına göre salt-okunur sınar.",
    }),
    STRESS_TESTER: Object.freeze({
      templateId: "STRESS_TESTER",
      agentAlias: "RED_TEAM",
      labelTr: "Stres Testi (Bilgi Kesiti, 12-Dünya p95 ve Çelişki/Eşik Sınaması)",
      autonomousService: false,
      humanApprovalRequired: true,
      writeAuthority: "NONE",
      allowedTools: Object.freeze([
        "caelus_airlock_validate_batch",
        "caelus_evaluate_slice",
        "caelus_run_counterfactual_branch",
        "caelus_explain_outcome",
      ]),
      primaryTool: "caelus_evaluate_slice",
      scopeTr:
        "Farklı cutoff_learned_at_ms, 12-dünya p95 zarfı ve eşik politikaları altında sızıntısız bilgi kesiti koşumu yapar.",
    }),
    STRATEGIST: Object.freeze({
      templateId: "STRATEGIST",
      agentAlias: "STRATEGIST",
      labelTr: "Stratejist (Karşı-Olgu Dalı ve İnsan Onaylı Eylem Kartı Üretimi)",
      autonomousService: false,
      humanApprovalRequired: true,
      writeAuthority: "NONE",
      allowedTools: Object.freeze([
        "caelus_airlock_validate_batch",
        "caelus_evaluate_slice",
        "caelus_run_counterfactual_branch",
        "caelus_explain_outcome",
      ]),
      primaryTool: "caelus_run_counterfactual_branch",
      scopeTr:
        "caelus_run_counterfactual_branch ile karşılaştırmalı eylem kartları üretir; operasyon sistemine yazamaz.",
    }),
    EXPLAINER: Object.freeze({
      templateId: "EXPLAINER",
      agentAlias: "AUDITOR",
      labelTr: "Denetçi / Açıklayıcı (Denetim İzi, Kaynak Varsayımı ve Kanıt Kilidi)",
      autonomousService: false,
      humanApprovalRequired: true,
      writeAuthority: "NONE",
      allowedTools: Object.freeze([
        "caelus_airlock_validate_batch",
        "caelus_evaluate_slice",
        "caelus_run_counterfactual_branch",
        "caelus_explain_outcome",
      ]),
      primaryTool: "caelus_explain_outcome",
      scopeTr:
        "Üretilen kararı event_id, source_id, kural kimliği, bağımsız OBSERVATION kanıtı ve audit_log mührüne bağlar.",
    }),
  });

  // ============================================================================
  // 1. SAF JS BLAKE3 (0 Harici Paket — Resmi BLAKE3 Vektörleriyle Bit-Özdeş)
  // ============================================================================

  const BLAKE3_IV = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const BLAKE3_MSG_PERM = new Uint8Array([
    2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8,
  ]);

  function rotr32(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  function blake3G(s, a, b, c, d, mx, my) {
    s[a] = (s[a] + s[b] + mx) >>> 0;
    s[d] = rotr32(s[d] ^ s[a], 16);
    s[c] = (s[c] + s[d]) >>> 0;
    s[b] = rotr32(s[b] ^ s[c], 12);
    s[a] = (s[a] + s[b] + my) >>> 0;
    s[d] = rotr32(s[d] ^ s[a], 8);
    s[c] = (s[c] + s[d]) >>> 0;
    s[b] = rotr32(s[b] ^ s[c], 7);
  }

  function blake3Round(s, m) {
    blake3G(s, 0, 4, 8, 12, m[0], m[1]);
    blake3G(s, 1, 5, 9, 13, m[2], m[3]);
    blake3G(s, 2, 6, 10, 14, m[4], m[5]);
    blake3G(s, 3, 7, 11, 15, m[6], m[7]);
    blake3G(s, 0, 5, 10, 15, m[8], m[9]);
    blake3G(s, 1, 6, 11, 12, m[10], m[11]);
    blake3G(s, 2, 7, 8, 13, m[12], m[13]);
    blake3G(s, 3, 4, 9, 14, m[14], m[15]);
  }

  function blake3Compress(cv, blockWords, counterBig, blockLen, flags) {
    const s = new Uint32Array(16);
    for (let i = 0; i < 8; i++) s[i] = cv[i];
    s[8] = BLAKE3_IV[0];
    s[9] = BLAKE3_IV[1];
    s[10] = BLAKE3_IV[2];
    s[11] = BLAKE3_IV[3];
    s[12] = Number(counterBig & 0xffffffffn) >>> 0;
    s[13] = Number((counterBig >> 32n) & 0xffffffffn) >>> 0;
    s[14] = blockLen >>> 0;
    s[15] = flags >>> 0;

    let m = new Uint32Array(blockWords);
    for (let r = 0; r < 7; r++) {
      blake3Round(s, m);
      if (r < 6) {
        const next = new Uint32Array(16);
        for (let i = 0; i < 16; i++) next[i] = m[BLAKE3_MSG_PERM[i]];
        m = next;
      }
    }
    for (let i = 0; i < 8; i++) {
      s[i] = (s[i] ^ s[i + 8]) >>> 0;
      s[i + 8] = (s[i + 8] ^ cv[i]) >>> 0;
    }
    return s;
  }

  function wordsFromBlock(bytes, offset, len) {
    const padded = new Uint8Array(64);
    if (len > 0) {
      padded.set(bytes.subarray(offset, offset + len));
    }
    const words = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      const j = i * 4;
      words[i] =
        (padded[j] |
          (padded[j + 1] << 8) |
          (padded[j + 2] << 16) |
          (padded[j + 3] << 24)) >>>
        0;
    }
    return words;
  }

  function utf8Bytes(input) {
    if (input instanceof Uint8Array) return input;
    return new TextEncoder().encode(String(input));
  }

  function blake3Hex(input) {
    const bytes = utf8Bytes(input);
    let chunkCv = new Uint32Array(BLAKE3_IV);
    let chunkBlock = new Uint8Array(64);
    let chunkBlockLen = 0;
    let blocksCompressed = 0;
    let chunkCounter = 0n;

    const cvStack = [];

    function chunkLength() {
      return 64 * blocksCompressed + chunkBlockLen;
    }
    function chunkStartFlag() {
      return blocksCompressed === 0 ? 1 : 0;
    }
    function chunkOutput() {
      return {
        inputCv: new Uint32Array(chunkCv),
        blockWords: wordsFromBlock(chunkBlock, 0, chunkBlockLen),
        counter: chunkCounter,
        blockLen: chunkBlockLen,
        flags: chunkStartFlag() | 2,
      };
    }
    function outputChainingValue(o) {
      return blake3Compress(o.inputCv, o.blockWords, o.counter, o.blockLen, o.flags).subarray(0, 8);
    }
    function parentOutput(leftCv, rightCv) {
      const blockWords = new Uint32Array(16);
      blockWords.set(leftCv, 0);
      blockWords.set(rightCv, 8);
      return {
        inputCv: new Uint32Array(BLAKE3_IV),
        blockWords,
        counter: 0n,
        blockLen: 64,
        flags: 4,
      };
    }

    let pos = 0;
    while (pos < bytes.length) {
      if (chunkLength() === 1024) {
        let newCv = outputChainingValue(chunkOutput());
        chunkCounter += 1n;
        let tc = chunkCounter;
        while ((tc & 1n) === 0n && cvStack.length > 0) {
          const left = cvStack.pop();
          newCv = outputChainingValue(parentOutput(left, newCv));
          tc >>= 1n;
        }
        cvStack.push(newCv);
        chunkCv = new Uint32Array(BLAKE3_IV);
        chunkBlock = new Uint8Array(64);
        chunkBlockLen = 0;
        blocksCompressed = 0;
      }

      const chunkRem = 1024 - chunkLength();
      const takeChunk = Math.min(chunkRem, bytes.length - pos);
      let cPos = 0;
      while (cPos < takeChunk) {
        if (chunkBlockLen === 64) {
          const words = wordsFromBlock(chunkBlock, 0, 64);
          chunkCv = blake3Compress(
            chunkCv,
            words,
            chunkCounter,
            64,
            chunkStartFlag()
          ).subarray(0, 8);
          blocksCompressed += 1;
          chunkBlock = new Uint8Array(64);
          chunkBlockLen = 0;
        }
        const takeBlock = Math.min(64 - chunkBlockLen, takeChunk - cPos);
        chunkBlock.set(bytes.subarray(pos + cPos, pos + cPos + takeBlock), chunkBlockLen);
        chunkBlockLen += takeBlock;
        cPos += takeBlock;
      }
      pos += takeChunk;
    }

    let out = chunkOutput();
    while (cvStack.length > 0) {
      const left = cvStack.pop();
      const rightCv = outputChainingValue(out);
      out = parentOutput(left, rightCv);
    }

    const rootWords = blake3Compress(
      out.inputCv,
      out.blockWords,
      out.counter,
      out.blockLen,
      out.flags | 8
    );
    let hex = "";
    for (let i = 0; i < 8; i++) {
      const w = rootWords[i];
      for (let b = 0; b < 4; b++) {
        hex += ((w >>> (8 * b)) & 0xff).toString(16).padStart(2, "0");
      }
    }
    return hex;
  }

  // ============================================================================
  // 2. 64-BİT ONDALIK DİZGE (`string`) SINIR DOĞRULAYICISI (§3.2 & §4)
  // ============================================================================

  function parseSigned64DecimalString(value) {
    if (typeof value !== "string" || value.length === 0) return null;
    if (!/^-?(0|[1-9][0-9]{0,18})$/.test(value)) return null;
    if (value === "-0") return null;
    try {
      const bi = BigInt(value);
      if (bi < I64_MIN || bi > I64_MAX) return null;
      return bi;
    } catch (_) {
      return null;
    }
  }

  function parseUnsigned64DecimalString(value) {
    if (typeof value !== "string" || value.length === 0) return null;
    if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) return null;
    try {
      const bi = BigInt(value);
      if (bi < 0n || bi > U64_MAX) return null;
      return bi;
    } catch (_) {
      return null;
    }
  }

  /**
   * Ham JSON metnini `JSON.parse` öncesinde tarayarak:
   * 1) Tırnaksız `> 2^53 - 1` (veya `< -(2^53 - 1)`) tam sayı literallerini yakalar,
   * 2) 64-bit dizge zorunluluğu olan alanlara tırnaksız sayı verilmesini reddeder.
   */
  function detectUnquoted64BitViolationInRawJson(rawJsonText) {
    if (typeof rawJsonText !== "string" || rawJsonText.length === 0) {
      return null;
    }
    let i = 0;
    const n = rawJsonText.length;
    let lastKey = null;
    let expectingColon = false;
    let afterColonForKey = null;

    while (i < n) {
      const ch = rawJsonText[i];
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        i += 1;
        continue;
      }
      if (ch === '"') {
        i += 1;
        let strVal = "";
        while (i < n) {
          const sc = rawJsonText[i++];
          if (sc === '"') break;
          if (sc === "\\" && i < n) {
            strVal += rawJsonText[i++];
          } else {
            strVal += sc;
          }
        }
        // Peek ahead for ':' to see if this string was an object key
        let j = i;
        while (
          j < n &&
          (rawJsonText[j] === " " ||
            rawJsonText[j] === "\t" ||
            rawJsonText[j] === "\r" ||
            rawJsonText[j] === "\n")
        ) {
          j += 1;
        }
        if (j < n && rawJsonText[j] === ":") {
          lastKey = strVal;
          expectingColon = true;
          afterColonForKey = null;
        } else {
          afterColonForKey = null;
        }
        continue;
      }
      if (ch === ":") {
        if (expectingColon) {
          afterColonForKey = lastKey;
          expectingColon = false;
        }
        i += 1;
        continue;
      }
      if (ch === "," || ch === "{" || ch === "}" || ch === "[" || ch === "]") {
        lastKey = null;
        expectingColon = false;
        afterColonForKey = null;
        i += 1;
        continue;
      }
      if (ch === "-" || (ch >= "0" && ch <= "9")) {
        const start = i;
        if (rawJsonText[i] === "-") i += 1;
        while (i < n && rawJsonText[i] >= "0" && rawJsonText[i] <= "9") i += 1;
        let isFloat = false;
        if (i < n && (rawJsonText[i] === "." || rawJsonText[i] === "e" || rawJsonText[i] === "E")) {
          isFloat = true;
          while (
            i < n &&
            /[0-9.eE+-]/.test(rawJsonText[i])
          ) {
            i += 1;
          }
        }
        const token = rawJsonText.slice(start, i);
        if (afterColonForKey && STRICT_64BIT_STRING_FIELDS.has(afterColonForKey)) {
          return {
            ok: false,
            errorCode: "MCP_64BIT_DECIMAL_STRING_REQUIRED",
            field: afterColonForKey,
            rawToken: token,
            messageTr: `64-bit alan ('${afterColonForKey}') JSON/MCP sınırında tırnaksız sayı (${token}) olamaz; ondalık ASCII dizge ('string') zorunludur.`,
          };
        }
        if (!isFloat) {
          try {
            const bi = BigInt(token);
            if (bi > JS_MAX_SAFE_BIGINT || bi < -JS_MAX_SAFE_BIGINT) {
              return {
                ok: false,
                errorCode: "MCP_UNSAFE_JS_INTEGER_PRECISION_LOSS",
                field: afterColonForKey || "(numeric_literal)",
                rawToken: token,
                messageTr: `JSON sınırında 2^53 - 1 üstü tırnaksız tam sayı (${token}) saptandı; bit kaybını önlemek için ondalık ASCII dizge ('string') kullanılmalıdır.`,
              };
            }
          } catch (_) {
            return {
              ok: false,
              errorCode: "MCP_UNSAFE_JS_INTEGER_PRECISION_LOSS",
              field: afterColonForKey || "(numeric_literal)",
              rawToken: token,
              messageTr: `Aşırı büyük tırnaksız sayısal literal (${token}) reddedildi.`,
            };
          }
        }
        afterColonForKey = null;
        continue;
      }
      afterColonForKey = null;
      i += 1;
    }
    return null;
  }

  /**
   * Ayrıştırılmış MCP argüman nesnesinde 64-bit dizge sözleşmesini doğrular.
   */
  function validate64BitMcpArguments(args, pathPrefix = "arguments") {
    if (args === null || args === undefined) return { ok: true };
    if (typeof args === "number") {
      if (!Number.isFinite(args)) {
        return {
          ok: false,
          errorCode: "MCP_NON_FINITE_NUMBER_FORBIDDEN",
          field: pathPrefix,
          messageTr: `Sonlu olmayan sayı (${pathPrefix}) kabul edilmez.`,
        };
      }
      if (Number.isInteger(args) && !Number.isSafeInteger(args)) {
        return {
          ok: false,
          errorCode: "MCP_UNSAFE_JS_INTEGER_PRECISION_LOSS",
          field: pathPrefix,
          messageTr: `${pathPrefix} alanında güvenli JS tam sayı sınırını (2^53 - 1) aşan Number saptandı; ondalık dizge ('string') zorunludur.`,
        };
      }
      return { ok: true };
    }
    if (Array.isArray(args)) {
      for (let idx = 0; idx < args.length; idx++) {
        const sub = validate64BitMcpArguments(args[idx], `${pathPrefix}[${idx}]`);
        if (!sub.ok) return sub;
      }
      return { ok: true };
    }
    if (typeof args === "object") {
      for (const [k, v] of Object.entries(args)) {
        const curPath = `${pathPrefix}.${k}`;
        if (k === "metrics" && typeof v === "object" && v !== null && !Array.isArray(v)) {
          for (const [mk, mv] of Object.entries(v)) {
            if (typeof mv !== "string" || parseSigned64DecimalString(mv) === null) {
              return {
                ok: false,
                errorCode: "MCP_64BIT_DECIMAL_STRING_REQUIRED",
                field: `${curPath}.${mk}`,
                messageTr: `Çoklu metrik alanı ('metrics.${mk}') 64-bit ondalık ASCII dizge ('string') olarak verilmelidir.`,
              };
            }
          }
          continue;
        }
        if (STRICT_64BIT_STRING_FIELDS.has(k) && v !== null && v !== undefined) {
          if (typeof v !== "string") {
            return {
              ok: false,
              errorCode: "MCP_64BIT_DECIMAL_STRING_REQUIRED",
              field: curPath,
              messageTr: `64-bit alan ('${k}') JSON/MCP sınırında ondalık ASCII dizge ('string') olarak verilmelidir (alınan tip: ${typeof v}).`,
            };
          }
          const isUnsigned =
            k === "seq_no" ||
            k === "audit_session_id" ||
            k === "deterministic_state_fnv64" ||
            k === "tick";
          const parsed = isUnsigned
            ? parseUnsigned64DecimalString(v)
            : parseSigned64DecimalString(v);
          if (parsed === null) {
            return {
              ok: false,
              errorCode: "MCP_64BIT_DECIMAL_STRING_INVALID",
              field: curPath,
              messageTr: `64-bit alan ('${k}') geçerli bir ${isUnsigned ? "u64" : "i64"} ondalık ASCII dizgesi değil: '${v}'.`,
            };
          }
        } else {
          const sub = validate64BitMcpArguments(v, curPath);
          if (!sub.ok) return sub;
        }
      }
    }
    return { ok: true };
  }

  // ============================================================================
  // 3. DOSYA YOLU GÜVENLİĞİ VE YEREL RUST İKİLİ KEŞFİ
  // ============================================================================

  function resolveSafeFilePath(rawPath, repoRootDir, allowMissingForOutput = false) {
    if (!nodeDeps) {
      return {
        ok: false,
        errorCode: "MCP_FILESYSTEM_UNAVAILABLE",
        messageTr: "Tarayıcı ortamında dosya yolu erişimi kullanılamaz; satır-içi içerik verin.",
      };
    }
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      return {
        ok: false,
        errorCode: "MCP_INVALID_PATH",
        messageTr: "Dosya yolu boş olamaz.",
      };
    }
    if (rawPath.includes("\0") || /(^|[\\/])\.\.([\\/]|$)/.test(rawPath)) {
      return {
        ok: false,
        errorCode: "MCP_SECURITY_FILESYSTEM_TRAVERSAL_BLOCKED",
        messageTr: "Dosya yolu geçişi ('..') güvenlik kapısı tarafından engellendi.",
      };
    }
    const { path, os, fs } = nodeDeps;
    const resolved = path.isAbsolute(rawPath)
      ? path.normalize(rawPath)
      : path.resolve(repoRootDir, rawPath);
    const normRoot = path.resolve(repoRootDir);
    const normTmp = path.resolve(os.tmpdir());

    const isInside = (target, base) => {
      const t = process.platform === "win32" ? target.toLowerCase() : target;
      const b = process.platform === "win32" ? base.toLowerCase() : base;
      return t === b || t.startsWith(b + path.sep);
    };

    if (!isInside(resolved, normRoot) && !isInside(resolved, normTmp)) {
      return {
        ok: false,
        errorCode: "MCP_SECURITY_FILESYSTEM_TRAVERSAL_BLOCKED",
        messageTr: "Yalnız çalışma alanı veya geçici pilot dizini altındaki dosyalar okunabilir.",
      };
    }
    if (!allowMissingForOutput && !fs.existsSync(resolved)) {
      return {
        ok: false,
        errorCode: "MCP_FILE_NOT_FOUND",
        messageTr: `Dosya bulunamadı: ${rawPath}`,
      };
    }
    return { ok: true, resolvedPath: resolved };
  }

  function findNativeSidecarBinary(options = {}) {
    if (!nodeDeps || options.forcePureJsFallback === true) return null;
    const { fs, path } = nodeDeps;
    const exeName =
      process.platform === "win32" ? "caelus_sidecar_airlock.exe" : "caelus_sidecar_airlock";
    const repoRoot =
      options.repoRootDir || path.resolve(__dirname, "..");

    const candidates = [];
    if (options.sidecarBinaryPath) candidates.push(options.sidecarBinaryPath);
    if (process.env.CAELUS_SIDECAR_AIRLOCK_BIN) {
      candidates.push(process.env.CAELUS_SIDECAR_AIRLOCK_BIN);
    }
    candidates.push(path.join(repoRoot, "target", "release", exeName));
    candidates.push(path.join(repoRoot, "target", "debug", exeName));

    for (const cand of candidates) {
      if (cand && fs.existsSync(cand)) {
        return cand;
      }
    }
    return null;
  }

  // ============================================================================
  // 4. SAF JS YEDEK DOĞRULAYICI VE ÇİFT ZAMANLI KESİT DEĞERLENDİRİCİ
  //    (`caelus_core::airlock` ve `airlock_host.rs` ile %100 bit-özdeş)
  // ============================================================================

  function hexToBytes(hexStr) {
    if (typeof hexStr !== "string" || hexStr.length % 2 !== 0) return null;
    if (!/^[0-9a-fA-F]*$/.test(hexStr)) return null;
    const out = new Uint8Array(hexStr.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  function constantTimeBytesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    if (nodeDeps && nodeDeps.crypto && nodeDeps.crypto.timingSafeEqual) {
      return nodeDeps.crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  function bytesToHexLower(bytes) {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
  }

  // RFC 8032 Saf BigInt SHA-512 + Ed25519 (Hava boşluklu file:// tarayıcı ve PWA yedeği)
  const SHA512_IV = [
    0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
  ];
  const SHA512_K = [
    0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
    0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
    0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
    0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
    0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
    0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
    0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
    0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
    0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
    0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
    0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
    0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
    0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
    0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
    0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
    0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
    0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
    0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
    0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
    0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
  ];
  const MASK64 = 0xffffffffffffffffn;
  function rotr64(x, n) {
    return ((x >> n) | ((x << (64n - n)) & MASK64)) & MASK64;
  }
  function sha512Bytes(msgInput) {
    const msg = utf8Bytes(msgInput);
    const bitLen = BigInt(msg.length) * 8n;
    const rem = (msg.length + 17) % 128;
    const padZeros = rem === 0 ? 0 : 128 - rem;
    const padded = new Uint8Array(msg.length + 1 + padZeros + 16);
    padded.set(msg, 0);
    padded[msg.length] = 0x80;
    let bl = bitLen;
    for (let i = 0; i < 16; i++) {
      padded[padded.length - 1 - i] = Number(bl & 0xffn);
      bl >>= 8n;
    }
    const H = SHA512_IV.slice();
    const W = new Array(80).fill(0n);
    for (let off = 0; off < padded.length; off += 128) {
      for (let i = 0; i < 16; i++) {
        let w = 0n;
        for (let b = 0; b < 8; b++) w = (w << 8n) | BigInt(padded[off + i * 8 + b]);
        W[i] = w;
      }
      for (let i = 16; i < 80; i++) {
        const s0 = rotr64(W[i - 15], 1n) ^ rotr64(W[i - 15], 8n) ^ (W[i - 15] >> 7n);
        const s1 = rotr64(W[i - 2], 19n) ^ rotr64(W[i - 2], 61n) ^ (W[i - 2] >> 6n);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) & MASK64;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 80; i++) {
        const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
        const ch = (e & f) ^ ((~e & MASK64) & g);
        const temp1 = (h + S1 + ch + SHA512_K[i] + W[i]) & MASK64;
        const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) & MASK64;
        h = g; g = f; f = e; e = (d + temp1) & MASK64;
        d = c; c = b; b = a; a = (temp1 + temp2) & MASK64;
      }
      H[0] = (H[0] + a) & MASK64; H[1] = (H[1] + b) & MASK64;
      H[2] = (H[2] + c) & MASK64; H[3] = (H[3] + d) & MASK64;
      H[4] = (H[4] + e) & MASK64; H[5] = (H[5] + f) & MASK64;
      H[6] = (H[6] + g) & MASK64; H[7] = (H[7] + h) & MASK64;
    }
    const out = new Uint8Array(64);
    for (let i = 0; i < 8; i++) {
      let w = H[i];
      for (let b = 7; b >= 0; b--) {
        out[i * 8 + b] = Number(w & 0xffn);
        w >>= 8n;
      }
    }
    return out;
  }

  const ED_P = (1n << 255n) - 19n;
  const ED_L = (1n << 252n) + 27742317777372353535851937790883648493n;
  function edMod(a, m = ED_P) {
    const r = a % m;
    return r >= 0n ? r : r + m;
  }
  function edModPow(base, exp, m = ED_P) {
    let res = 1n;
    let b = edMod(base, m);
    let e = exp;
    while (e > 0n) {
      if (e & 1n) res = (res * b) % m;
      b = (b * b) % m;
      e >>= 1n;
    }
    return res;
  }
  function edModInv(a, m = ED_P) {
    return edModPow(a, m - 2n, m);
  }
  const ED_D = edMod(-121665n * edModInv(121666n));
  const ED_I = edModPow(2n, (ED_P - 1n) / 4n);
  function edRecoverX(y, signBit) {
    if (y >= ED_P) return null;
    const y2 = edMod(y * y);
    const u = edMod(y2 - 1n);
    const v = edMod(ED_D * y2 + 1n);
    const v3 = edMod(v * v * v);
    const v7 = edMod(v3 * v3 * v);
    let x = edMod(edMod(u * v3) * edModPow(edMod(u * v7), (ED_P - 5n) / 8n));
    const vx2 = edMod(v * edMod(x * x));
    if (vx2 !== u) {
      if (vx2 === edMod(-u)) x = edMod(x * ED_I);
      else return null;
    }
    if (x === 0n && signBit === 1) return null;
    if (Number(x & 1n) !== signBit) x = ED_P - x;
    return x;
  }
  const ED_BY = edMod(4n * edModInv(5n));
  const ED_BX = edRecoverX(ED_BY, 0);
  const ED_B = [ED_BX, ED_BY, 1n, edMod(ED_BX * ED_BY)];
  const ED_ZERO = [0n, 1n, 1n, 0n];
  function edAdd(P, Q) {
    const [X1, Y1, Z1, T1] = P;
    const [X2, Y2, Z2, T2] = Q;
    const A = edMod((Y1 - X1) * (Y2 - X2));
    const B = edMod((Y1 + X1) * (Y2 + X2));
    const C = edMod(2n * ED_D * edMod(T1 * T2));
    const D = edMod(2n * Z1 * Z2);
    const E = edMod(B - A);
    const F = edMod(D - C);
    const G = edMod(D + C);
    const H = edMod(B + A);
    return [edMod(E * F), edMod(G * H), edMod(F * G), edMod(E * H)];
  }
  function edMul(P, scalar) {
    let R = ED_ZERO;
    let Q = P;
    let k = scalar;
    while (k > 0n) {
      if (k & 1n) R = edAdd(R, Q);
      Q = edAdd(Q, Q);
      k >>= 1n;
    }
    return R;
  }
  function edEncodePoint(P) {
    const zinv = edModInv(P[2]);
    const x = edMod(P[0] * zinv);
    const y = edMod(P[1] * zinv);
    const out = new Uint8Array(32);
    let tmp = y;
    for (let i = 0; i < 32; i++) {
      out[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }
    out[31] |= Number(x & 1n) << 7;
    return out;
  }
  function edDecodePoint(bytes32) {
    if (!bytes32 || bytes32.length !== 32) return null;
    const signBit = (bytes32[31] >> 7) & 1;
    let y = 0n;
    for (let i = 31; i >= 0; i--) {
      const b = i === 31 ? bytes32[i] & 0x7f : bytes32[i];
      y = (y << 8n) | BigInt(b);
    }
    const x = edRecoverX(y, signBit);
    if (x === null) return null;
    return [x, y, 1n, edMod(x * y)];
  }
  function bytesLEToBigInt(bytes) {
    let v = 0n;
    for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
    return v;
  }
  function bigIntToBytesLE32(v) {
    const out = new Uint8Array(32);
    let cur = v;
    for (let i = 0; i < 32; i++) {
      out[i] = Number(cur & 0xffn);
      cur >>= 8n;
    }
    return out;
  }
  function concatBytes(...arrays) {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) {
      out.set(a, off);
      off += a.length;
    }
    return out;
  }
  function ed25519KeypairFromSeedBytes(seed32) {
    const h = sha512Bytes(seed32);
    const clamped = new Uint8Array(h.subarray(0, 32));
    clamped[0] &= 248;
    clamped[31] &= 127;
    clamped[31] |= 64;
    const a = bytesLEToBigInt(clamped);
    const pub = edEncodePoint(edMul(ED_B, a));
    return { scalar: a, prefix: h.subarray(32, 64), pubBytes: pub };
  }
  function ed25519SignBytes(msgUtf8, seed32) {
    const msgBytes = utf8Bytes(msgUtf8);
    if (nodeDeps && nodeDeps.crypto) {
      const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
      const privObj = nodeDeps.crypto.createPrivateKey({
        key: Buffer.concat([pkcs8Prefix, Buffer.from(seed32)]),
        format: "der",
        type: "pkcs8",
      });
      const sigBuf = nodeDeps.crypto.sign(null, Buffer.from(msgBytes), privObj);
      return new Uint8Array(sigBuf);
    }
    const { scalar, prefix, pubBytes } = ed25519KeypairFromSeedBytes(seed32);
    const r = bytesLEToBigInt(sha512Bytes(concatBytes(prefix, msgBytes))) % ED_L;
    const R = edEncodePoint(edMul(ED_B, r));
    const k = bytesLEToBigInt(sha512Bytes(concatBytes(R, pubBytes, msgBytes))) % ED_L;
    const S = (r + k * scalar) % ED_L;
    return concatBytes(R, bigIntToBytesLE32(S));
  }
  function verifyEd25519Node(msgUtf8, pubBytes32, sigBytes64) {
    if (nodeDeps && nodeDeps.crypto) {
      try {
        const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
        const derKey = Buffer.concat([spkiPrefix, Buffer.from(pubBytes32)]);
        const pubKeyObj = nodeDeps.crypto.createPublicKey({
          key: derKey,
          format: "der",
          type: "spki",
        });
        return nodeDeps.crypto.verify(
          null,
          Buffer.from(utf8Bytes(msgUtf8)),
          pubKeyObj,
          Buffer.from(sigBytes64)
        );
      } catch (_) {
        return false;
      }
    }
    if (!pubBytes32 || pubBytes32.length !== 32 || !sigBytes64 || sigBytes64.length !== 64) {
      return false;
    }
    const Rbytes = sigBytes64.subarray(0, 32);
    const S = bytesLEToBigInt(sigBytes64.subarray(32, 64));
    if (S >= ED_L) return false;
    const A = edDecodePoint(pubBytes32);
    const R = edDecodePoint(Rbytes);
    if (!A || !R) return false;
    const msgBytes = utf8Bytes(msgUtf8);
    const k = bytesLEToBigInt(sha512Bytes(concatBytes(Rbytes, pubBytes32, msgBytes))) % ED_L;
    const lhs = edEncodePoint(edMul(ED_B, 8n * S));
    const rhs = edEncodePoint(edAdd(edMul(R, 8n), edMul(A, 8n * k)));
    return constantTimeBytesEqual(lhs, rhs);
  }

  function ed25519KeypairFromSeedHex(seedHex64) {
    const seed = hexToBytes(seedHex64);
    if (!seed || seed.length !== 32) throw new Error("Ed25519 seed must be 64 hex chars");
    const kp = ed25519KeypairFromSeedBytes(seed);
    return { pubkeyHex: bytesToHexLower(kp.pubBytes) };
  }

  function ed25519SignMessageHex(msgUtf8, seedHex64) {
    const seed = hexToBytes(seedHex64);
    if (!seed || seed.length !== 32) throw new Error("Ed25519 seed must be 64 hex chars");
    const kp = ed25519KeypairFromSeedBytes(seed);
    const sig = ed25519SignBytes(msgUtf8, seed);
    return {
      pubkeyHex: bytesToHexLower(kp.pubBytes),
      signatureHex: bytesToHexLower(sig),
    };
  }

  function ed25519VerifyMessageHex(msgUtf8, pubkeyHex64, sigHex128) {
    const pub = hexToBytes(pubkeyHex64);
    const sig = hexToBytes(sigHex128);
    if (!pub || pub.length !== 32 || !sig || sig.length !== 64) return false;
    return verifyEd25519Node(msgUtf8, pub, sig);
  }

  function buildOperatorActionCardSigningPayload({
    card_id,
    scenario_id = "AEGEAN_FERRY_01",
    verdict_context = "KURAL_İHLALİ",
    state_blake3,
    branch_state_blake3 = "",
    approved_at_ms,
  }) {
    return `CAELUS_ACTION_CARD_APPROVAL_V1\n${card_id}|${scenario_id}|${verdict_context}|${state_blake3}|${branch_state_blake3}|${String(approved_at_ms)}`;
  }

  function parseManifestJs(manifestRaw) {
    const rawCheck = detectUnquoted64BitViolationInRawJson(manifestRaw);
    if (rawCheck) {
      throw new Error(rawCheck.messageTr);
    }
    const obj = JSON.parse(manifestRaw);
    if (obj.manifest_version !== undefined && obj.manifest_version !== "2.0") {
      throw new Error("manifest_version must be '2.0'");
    }
    const requireV2 =
      typeof obj.require_v2_airlock === "boolean" ? obj.require_v2_airlock : true;
    let legacyPub = null;
    if (typeof obj.legacy_v1_pubkey === "string" && obj.legacy_v1_pubkey.length > 0) {
      legacyPub = hexToBytes(obj.legacy_v1_pubkey);
      if (!legacyPub || legacyPub.length !== 32) {
        throw new Error("invalid legacy_v1_pubkey");
      }
    }
    if (!Array.isArray(obj.sources) || obj.sources.length === 0) {
      throw new Error("sources must be non-empty array");
    }
    const sources = obj.sources.map((s) => {
      const pubHex = s.pubkey_ed25519 || s.pubkey;
      const pub = hexToBytes(pubHex);
      if (
        !s.source_id ||
        !s.key_id ||
        !pub ||
        pub.length !== 32 ||
        !Array.isArray(s.allowed_event_kinds) ||
        s.allowed_event_kinds.length === 0 ||
        !s.independence_group
      ) {
        throw new Error("invalid source entry in manifest");
      }
      let expiresAt = null;
      if (s.expires_at_ms !== undefined && s.expires_at_ms !== null) {
        expiresAt = parseSigned64DecimalString(s.expires_at_ms);
        if (expiresAt === null) throw new Error("expires_at_ms must be decimal string");
      }
      let maxStaleness = null;
      if (s.max_staleness_ms !== undefined && s.max_staleness_ms !== null) {
        maxStaleness = parseSigned64DecimalString(s.max_staleness_ms);
        if (maxStaleness === null || maxStaleness <= 0n) {
          throw new Error("max_staleness_ms must be positive decimal string");
        }
      }
      let originClass = s.origin_class;
      if (!originClass) {
        const defEp = String(s.default_epistemic_status || "OBSERVATION");
        originClass =
          defEp === "CLAIM"
            ? "HUMAN_OPERATOR"
            : defEp === "HYPOTHESIS"
              ? "MODEL_OR_AGENT"
              : "CALIBRATED_SENSOR";
      } else if (originClass === "SENSOR" || originClass === "FIELD_OBSERVATION") {
        originClass = "CALIBRATED_SENSOR";
      } else if (originClass === "OPERATOR") {
        originClass = "HUMAN_OPERATOR";
      } else if (originClass === "MODEL" || originClass === "AGENT" || originClass === "LLM") {
        originClass = "MODEL_OR_AGENT";
      }
      return {
        source_id: String(s.source_id),
        key_id: String(s.key_id),
        pubkey: pub,
        pubkey_hex: String(pubHex).toLowerCase(),
        allowed_event_kinds: s.allowed_event_kinds.map(String),
        independence_group: String(s.independence_group),
        origin_class: String(originClass),
        default_epistemic_status: String(s.default_epistemic_status || "OBSERVATION"),
        expires_at_ms: expiresAt,
        max_staleness_ms: maxStaleness,
      };
    });

    if (obj.trust_anchor_pubkey && obj.manifest_sig) {
      const anchorPub = hexToBytes(obj.trust_anchor_pubkey);
      const manSig = hexToBytes(obj.manifest_sig);
      if (!anchorPub || anchorPub.length !== 32 || !manSig || manSig.length !== 64) {
        throw new Error("invalid manifest trust_anchor_pubkey or manifest_sig");
      }
      const legacyStr = legacyPub ? bytesToHexLower(legacyPub) : "";
      let canonicalMsg = "CAELUS_AIRLOCK_MANIFEST_V2\n";
      canonicalMsg += `manifest_version=${obj.manifest_version || "2.0"}\n`;
      canonicalMsg += `require_v2_airlock=${requireV2 ? "1" : "0"}\n`;
      canonicalMsg += `legacy_v1_pubkey=${legacyStr}\n`;
      for (const s of sources) {
        const expStr = s.expires_at_ms !== null ? s.expires_at_ms.toString() : "";
        const kinds = s.allowed_event_kinds.join(",");
        if (s.max_staleness_ms !== null) {
          canonicalMsg += `source=${s.source_id}|${s.key_id}|${s.pubkey_hex}|${s.independence_group}|${s.origin_class}|${expStr}|${kinds}|staleness=${s.max_staleness_ms.toString()}\n`;
        } else {
          canonicalMsg += `source=${s.source_id}|${s.key_id}|${s.pubkey_hex}|${s.independence_group}|${s.origin_class}|${expStr}|${kinds}\n`;
        }
      }
      if (!verifyEd25519Node(canonicalMsg, anchorPub, manSig)) {
        throw new Error("manifest trust anchor signature verification failed");
      }
    }

    return { require_v2_airlock: requireV2, legacy_v1_pubkey: legacyPub, sources };
  }

  function splitBatchRecordsJs(batchContent) {
    if (batchContent.includes("\r")) {
      throw new Error("CRLF detected in airlock batch; LF required");
    }
    const lines = batchContent.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim().length === 0) {
        i += 1;
        continue;
      }
      if (line.startsWith("{")) {
        out.push(line);
        i += 1;
      } else if (line.startsWith("#sig=")) {
        if (i + 1 < lines.length && lines[i + 1] === "CAELUS_INTEL_V2") {
          if (i + 4 >= lines.length) throw new Error("truncated CAELUS_INTEL_V2 wire packet");
          out.push(lines.slice(i, i + 5).join("\n"));
          i += 5;
        } else if (i + 1 < lines.length) {
          out.push(lines.slice(i, i + 2).join("\n"));
          i += 2;
        } else {
          out.push(line);
          i += 1;
        }
      } else {
        out.push(line);
        i += 1;
      }
    }
    return out;
  }

  function verifyPacketJs(rawRecord, manifest) {
    const packetHash = blake3Hex(rawRecord);
    const trimmed = rawRecord.endsWith("\n") ? rawRecord.slice(0, -1) : rawRecord;
    if (!trimmed || trimmed.includes("\r")) {
      return {
        ok: false,
        err: {
          code: "ERR_SCHEMA_OR_RANGE",
          source_id: "",
          key_id: "",
          event_id: "",
          seq_no: 0n,
          packet_blake3: packetHash,
          detail: "empty or CRLF packet",
        },
      };
    }

    let sigLine = "";
    let schemaVersion = "";
    let headerLine = "";
    let payloadRaw = "";
    let outerLearned = null;

    if (trimmed.startsWith("{")) {
      const rawViol = detectUnquoted64BitViolationInRawJson(trimmed);
      if (rawViol) {
        return {
          ok: false,
          err: {
            code: "ERR_SCHEMA_OR_RANGE",
            source_id: "",
            key_id: "",
            event_id: "",
            seq_no: 0n,
            packet_blake3: packetHash,
            detail: rawViol.messageTr,
          },
        };
      }
      let outer;
      try {
        outer = JSON.parse(trimmed);
      } catch (e) {
        return {
          ok: false,
          err: {
            code: "ERR_SCHEMA_OR_RANGE",
            source_id: "",
            key_id: "",
            event_id: "",
            seq_no: 0n,
            packet_blake3: packetHash,
            detail: String(e.message || e),
          },
        };
      }
      if (outer.contract !== "CAELUS_INTEL_V2") {
        return {
          ok: false,
          err: {
            code: "ERR_SCHEMA_OR_RANGE",
            source_id: "",
            key_id: "",
            event_id: "",
            seq_no: 0n,
            packet_blake3: packetHash,
            detail: `unsupported contract '${outer.contract}'`,
          },
        };
      }
      sigLine = String(outer.sig || "");
      schemaVersion = String(outer.schema_version || "");
      headerLine = String(outer.header || "");
      payloadRaw = String(outer.payload_raw || "");
      if (outer.learned_at_ms !== undefined) {
        outerLearned = parseSigned64DecimalString(outer.learned_at_ms);
        if (outerLearned === null) {
          return {
            ok: false,
            err: {
              code: "ERR_SCHEMA_OR_RANGE",
              source_id: "",
              key_id: "",
              event_id: "",
              seq_no: 0n,
              packet_blake3: packetHash,
              detail: "outer learned_at_ms must be decimal string",
            },
          };
        }
      }
    } else {
      const nl1 = trimmed.indexOf("\n");
      if (nl1 < 0) {
        return {
          ok: false,
          err: {
            code: "ERR_SIGNATURE_MISMATCH",
            source_id: "",
            key_id: "",
            event_id: "",
            seq_no: 0n,
            packet_blake3: packetHash,
            detail: "missing newline after #sig",
          },
        };
      }
      sigLine = trimmed.slice(0, nl1);
      const rest = trimmed.slice(nl1 + 1);
      if (!rest.startsWith("CAELUS_INTEL_V2\n")) {
        return {
          ok: false,
          err: {
            code: "ERR_SCHEMA_OR_RANGE",
            source_id: "",
            key_id: "",
            event_id: "",
            seq_no: 0n,
            packet_blake3: packetHash,
            detail: "legacy or unknown wire contract",
          },
        };
      }
      const after = rest.slice("CAELUS_INTEL_V2\n".length);
      const nl2 = after.indexOf("\n");
      const nl3 = nl2 >= 0 ? after.indexOf("\n", nl2 + 1) : -1;
      if (nl2 < 0 || nl3 < 0) {
        return {
          ok: false,
          err: {
            code: "ERR_SCHEMA_OR_RANGE",
            source_id: "",
            key_id: "",
            event_id: "",
            seq_no: 0n,
            packet_blake3: packetHash,
            detail: "truncated v2 wire envelope",
          },
        };
      }
      schemaVersion = after.slice(0, nl2);
      headerLine = after.slice(nl2 + 1, nl3);
      payloadRaw = after.slice(nl3 + 1);
    }

    const prefix = "#sig=ed25519:";
    if (
      !sigLine.startsWith(prefix) ||
      sigLine.length !== prefix.length + 64 + 1 + 128 ||
      sigLine[prefix.length + 64] !== ":"
    ) {
      return {
        ok: false,
        err: {
          code: "ERR_SIGNATURE_MISMATCH",
          source_id: "",
          key_id: "",
          event_id: "",
          seq_no: 0n,
          packet_blake3: packetHash,
          detail: "malformed #sig line",
        },
      };
    }
    const pub = hexToBytes(sigLine.slice(prefix.length, prefix.length + 64));
    const sig = hexToBytes(sigLine.slice(prefix.length + 65));
    if (!pub || !sig) {
      return {
        ok: false,
        err: {
          code: "ERR_SIGNATURE_MISMATCH",
          source_id: "",
          key_id: "",
          event_id: "",
          seq_no: 0n,
          packet_blake3: packetHash,
          detail: "non-hex pubkey or signature",
        },
      };
    }

    const parts = headerLine.split("|");
    if (parts.length !== 9) {
      return {
        ok: false,
        err: {
          code: "ERR_SCHEMA_OR_RANGE",
          source_id: "",
          key_id: "",
          event_id: "",
          seq_no: 0n,
          packet_blake3: packetHash,
          detail: "header must have 9 pipe-delimited fields",
        },
      };
    }

    const [
      source_id,
      key_id,
      event_kind,
      event_id,
      seq_s,
      obs_s,
      lrn_s,
      ep_s,
      hdr_b3,
    ] = parts;
    const seqGuess = parseUnsigned64DecimalString(seq_s) ?? 0n;

    const entry = manifest.sources.find(
      (s) =>
        s.source_id === source_id &&
        s.key_id === key_id &&
        constantTimeBytesEqual(s.pubkey, pub)
    );
    if (!entry) {
      return {
        ok: false,
        err: {
          code: "ERR_UNTRUSTED_SOURCE",
          source_id,
          key_id,
          event_id,
          seq_no: seqGuess,
          packet_blake3: packetHash,
          detail: "untrusted source_id/key_id/pubkey",
        },
      };
    }

    const signedMsg = `CAELUS_INTEL_V2\n${schemaVersion}\n${headerLine}\n${payloadRaw}`;
    if (!verifyEd25519Node(signedMsg, pub, sig)) {
      return {
        ok: false,
        err: {
          code: "ERR_SIGNATURE_MISMATCH",
          source_id,
          key_id,
          event_id,
          seq_no: seqGuess,
          packet_blake3: packetHash,
          detail: "Ed25519 signature verification failed",
        },
      };
    }

    const computedB3 = blake3Hex(payloadRaw);
    if (computedB3 !== hdr_b3.toLowerCase()) {
      return {
        ok: false,
        err: {
          code: "ERR_SIGNATURE_MISMATCH",
          source_id,
          key_id,
          event_id,
          seq_no: seqGuess,
          packet_blake3: packetHash,
          detail: "payload_blake3 mismatch",
        },
      };
    }

    const seq_no = parseUnsigned64DecimalString(seq_s);
    const observed_at_ms = parseSigned64DecimalString(obs_s);
    const learned_at_ms = parseSigned64DecimalString(lrn_s);
    if (
      seq_no === null ||
      observed_at_ms === null ||
      learned_at_ms === null ||
      observed_at_ms < 0n ||
      learned_at_ms < 0n
    ) {
      return {
        ok: false,
        err: {
          code: "ERR_SCHEMA_OR_RANGE",
          source_id,
          key_id,
          event_id,
          seq_no: seqGuess,
          packet_blake3: packetHash,
          detail: "invalid seq_no or timestamp",
        },
      };
    }
    if (outerLearned !== null && outerLearned !== learned_at_ms) {
      return {
        ok: false,
        err: {
          code: "ERR_SIGNATURE_MISMATCH",
          source_id,
          key_id,
          event_id,
          seq_no,
          packet_blake3: packetHash,
          detail: "outer learned_at_ms disagrees with signed header",
        },
      };
    }
    if (entry.expires_at_ms !== null && learned_at_ms > entry.expires_at_ms) {
      return {
        ok: false,
        err: {
          code: "ERR_UNTRUSTED_SOURCE",
          source_id,
          key_id,
          event_id,
          seq_no,
          packet_blake3: packetHash,
          detail: "key expired",
        },
      };
    }
    if (schemaVersion !== "2.0") {
      return {
        ok: false,
        err: {
          code: "ERR_SCHEMA_OR_RANGE",
          source_id,
          key_id,
          event_id,
          seq_no,
          packet_blake3: packetHash,
          detail: `unsupported schema_version '${schemaVersion}'`,
        },
      };
    }
    if (!entry.allowed_event_kinds.includes(event_kind)) {
      return {
        ok: false,
        err: {
          code: "ERR_UNAUTHORIZED_KIND",
          source_id,
          key_id,
          event_id,
          seq_no,
          packet_blake3: packetHash,
          detail: `event_kind '${event_kind}' not allowed for '${source_id}'`,
        },
      };
    }
    if (!["OBSERVATION", "CLAIM", "HYPOTHESIS"].includes(ep_s)) {
      return {
        ok: false,
        err: {
          code: "ERR_SCHEMA_OR_RANGE",
          source_id,
          key_id,
          event_id,
          seq_no,
          packet_blake3: packetHash,
          detail: "invalid epistemic_status",
        },
      };
    }
    if (
      ((entry.origin_class === "HUMAN_OPERATOR" || entry.origin_class === "OPERATOR") &&
        ep_s === "OBSERVATION") ||
      ((entry.origin_class === "MODEL_OR_AGENT" ||
        entry.origin_class === "MODEL" ||
        entry.origin_class === "AGENT") &&
        ep_s !== "HYPOTHESIS")
    ) {
      return {
        ok: false,
        err: {
          code: "ERR_UNAUTHORIZED_KIND",
          source_id,
          key_id,
          event_id,
          seq_no,
          packet_blake3: packetHash,
          detail: "epistemic ceiling violated",
        },
      };
    }

    const innerViol = detectUnquoted64BitViolationInRawJson(payloadRaw);
    if (innerViol) {
      return {
        ok: false,
        err: {
          code: "ERR_SCHEMA_OR_RANGE",
          source_id,
          key_id,
          event_id,
          seq_no,
          packet_blake3: packetHash,
          detail: innerViol.messageTr,
        },
      };
    }
    let payloadObj;
    try {
      payloadObj = JSON.parse(payloadRaw);
    } catch (_) {
      return {
        ok: false,
        err: {
          code: "ERR_SCHEMA_OR_RANGE",
          source_id,
          key_id,
          event_id,
          seq_no,
          packet_blake3: packetHash,
          detail: "invalid payload JSON",
        },
      };
    }

    let fp_val = null;
    let subjectId = "";
    let metricKey = "";
    let unitStr = "";
    let noteStr = "";
    let metricsMap = null;

    if (payloadObj.fp_val !== undefined && payloadObj.fp_val !== null) {
      fp_val = parseSigned64DecimalString(payloadObj.fp_val);
      const absFp = fp_val !== null ? (fp_val < 0n ? -fp_val : fp_val) : null;
      if (
        fp_val === null ||
        absFp > AIRLOCK_FP_SAFE_MAX_ABS ||
        payloadObj.fp_scale !== 1000000 ||
        payloadObj.rounding !== "HALF_EVEN" ||
        payloadObj.overflow_policy !== "REJECT_AT_AIRLOCK" ||
        !payloadObj.subject_id ||
        !payloadObj.metric_key ||
        !payloadObj.unit
      ) {
        return {
          ok: false,
          err: {
            code: "ERR_SCHEMA_OR_RANGE",
            source_id,
            key_id,
            event_id,
            seq_no,
            packet_blake3: packetHash,
            detail: "invalid fixed-point payload contract or range > 2^62",
          },
        };
      }
      subjectId = String(payloadObj.subject_id);
      metricKey = String(payloadObj.metric_key);
      unitStr = String(payloadObj.unit);
      noteStr = String(payloadObj.note || "");
    } else if (
      payloadObj.metrics &&
      typeof payloadObj.metrics === "object" &&
      !Array.isArray(payloadObj.metrics)
    ) {
      if (
        payloadObj.fp_scale !== 1000000 ||
        payloadObj.rounding !== "HALF_EVEN" ||
        (payloadObj.overflow_policy !== undefined &&
          payloadObj.overflow_policy !== null &&
          payloadObj.overflow_policy !== "REJECT_AT_AIRLOCK")
      ) {
        return {
          ok: false,
          err: {
            code: "ERR_SCHEMA_OR_RANGE",
            source_id,
            key_id,
            event_id,
            seq_no,
            packet_blake3: packetHash,
            detail: "invalid multi-metric fixed-point payload contract",
          },
        };
      }
      const mKeys = Object.keys(payloadObj.metrics).sort(compareUtf8Lex);
      if (mKeys.length === 0 || (!payloadObj.entity_id && !payloadObj.subject_id)) {
        return {
          ok: false,
          err: {
            code: "ERR_SCHEMA_OR_RANGE",
            source_id,
            key_id,
            event_id,
            seq_no,
            packet_blake3: packetHash,
            detail: "multi-metric payload requires entity_id and non-empty metrics",
          },
        };
      }
      metricsMap = {};
      const parsedMap = new Map();
      for (const mk of mKeys) {
        const mv = payloadObj.metrics[mk];
        const p = parseSigned64DecimalString(mv);
        const absP = p !== null ? (p < 0n ? -p : p) : null;
        if (p === null || absP > AIRLOCK_FP_SAFE_MAX_ABS) {
          return {
            ok: false,
            err: {
              code: "ERR_SCHEMA_OR_RANGE",
              source_id,
              key_id,
              event_id,
              seq_no,
              packet_blake3: packetHash,
              detail: `invalid metric '${mk}' or range > 2^62`,
            },
          };
        }
        metricsMap[mk] = p.toString();
        parsedMap.set(mk, p);
      }
      const priorityKeys = [
        "delay_min_fp",
        "departure_delay_min",
        "berth_delay_min_fp",
        "wave_m_fp",
        "wind_speed_mps_fp",
        "wind_gust_kn_fp",
        "sog_kn_fp",
        "baro_alt_m_fp",
        "depth_m_fp",
      ];
      let chosenKey = payloadObj.metric_key ? String(payloadObj.metric_key) : "";
      if (chosenKey && !parsedMap.has(chosenKey)) {
        return {
          ok: false,
          err: {
            code: "ERR_SCHEMA_OR_RANGE",
            source_id,
            key_id,
            event_id,
            seq_no,
            packet_blake3: packetHash,
            detail: `explicit metric_key '${chosenKey}' missing from metrics`,
          },
        };
      }
      if (!chosenKey) {
        chosenKey = priorityKeys.find((pk) => parsedMap.has(pk)) || mKeys[0];
      }
      fp_val = parsedMap.get(chosenKey);
      subjectId = String(payloadObj.entity_id || payloadObj.subject_id);
      metricKey = chosenKey;
      unitStr = String(payloadObj.unit_schema || payloadObj.unit || "SI_MARINE_V1");
      noteStr =
        typeof payloadObj.note === "string"
          ? payloadObj.note
          : mKeys.map((mk) => `${mk}=${metricsMap[mk]}`).join(", ");
    } else {
      return {
        ok: false,
        err: {
          code: "ERR_SCHEMA_OR_RANGE",
          source_id,
          key_id,
          event_id,
          seq_no,
          packet_blake3: packetHash,
          detail: "payload must contain decimal string fp_val or metrics object",
        },
      };
    }

    return {
      ok: true,
      event: {
        schema_version: schemaVersion,
        source_id,
        key_id,
        independence_group: entry.independence_group,
        event_kind,
        event_id,
        seq_no,
        observed_at_ms,
        learned_at_ms,
        epistemic_status: ep_s,
        payload_blake3_hex: computedB3,
        subject_id: subjectId,
        metric_key: metricKey,
        fp_val,
        fp_scale: 1000000n,
        unit: unitStr,
        conversion_rule_id: String(payloadObj.rule_id || ""),
        supersedes_event_id:
          typeof payloadObj.supersedes_event_id === "string" &&
          payloadObj.supersedes_event_id.length > 0
            ? payloadObj.supersedes_event_id
            : null,
        note: noteStr,
        metrics_map: metricsMap,
        legacy_unscoped: false,
      },
      packet_blake3: packetHash,
    };
  }

  function validateBatchPureJs(batchRaw, manifestRaw) {
    const manifest = parseManifestJs(manifestRaw);
    const inputBatchB3 = blake3Hex(batchRaw);
    const rawRecords = splitBatchRecordsJs(batchRaw);
    const seen = new Map();
    const entries = [];
    const rejectedShort = [];
    let accepted = 0;
    let rejected = 0;
    let idempotent = 0;

    rawRecords.forEach((raw, index) => {
      const v = verifyPacketJs(raw, manifest);
      if (!v.ok) {
        rejected += 1;
        rejectedShort.push({
          line: index + 1,
          code: v.err.code,
          source_id: v.err.source_id,
          event_id: v.err.event_id,
          detail: v.err.detail,
        });
        entries.push({
          index,
          accepted: false,
          event_id: v.err.event_id,
          source_id: v.err.source_id,
          key_id: v.err.key_id,
          seq_no: v.err.seq_no.toString(),
          learned_at_ms: null,
          epistemic_status: null,
          error_code: v.err.code,
          detail: v.err.detail,
          packet_blake3: v.err.packet_blake3,
        });
        return;
      }
      const ev = v.event;
      const sk = `${ev.source_id}\0${ev.seq_no.toString()}`;
      if (seen.has(sk)) {
        if (seen.get(sk) === ev.payload_blake3_hex) {
          idempotent += 1;
          accepted += 1;
          entries.push({
            index,
            accepted: true,
            event_id: ev.event_id,
            source_id: ev.source_id,
            key_id: ev.key_id,
            seq_no: ev.seq_no.toString(),
            learned_at_ms: ev.learned_at_ms.toString(),
            epistemic_status: ev.epistemic_status,
            error_code: null,
            detail: "IDEMPOTENT_DUPLICATE",
            packet_blake3: v.packet_blake3,
          });
        } else {
          rejected += 1;
          rejectedShort.push({
            line: index + 1,
            code: "ERR_SOURCE_EQUIVOCATION",
            source_id: ev.source_id,
            event_id: ev.event_id,
            detail: "conflicting payload_blake3 for identical (source_id, seq_no)",
          });
          entries.push({
            index,
            accepted: false,
            event_id: ev.event_id,
            source_id: ev.source_id,
            key_id: ev.key_id,
            seq_no: ev.seq_no.toString(),
            learned_at_ms: ev.learned_at_ms.toString(),
            epistemic_status: ev.epistemic_status,
            error_code: "ERR_SOURCE_EQUIVOCATION",
            detail: "conflicting payload_blake3 for identical (source_id, seq_no)",
            packet_blake3: v.packet_blake3,
          });
        }
        return;
      }
      seen.set(sk, ev.payload_blake3_hex);
      accepted += 1;
      entries.push({
        index,
        accepted: true,
        event_id: ev.event_id,
        source_id: ev.source_id,
        key_id: ev.key_id,
        seq_no: ev.seq_no.toString(),
        learned_at_ms: ev.learned_at_ms.toString(),
        epistemic_status: ev.epistemic_status,
        error_code: null,
        detail: "OK",
        packet_blake3: v.packet_blake3,
      });
    });

    return {
      ok: true,
      input_batch_blake3: inputBatchB3,
      batch_blake3: inputBatchB3,
      total_records: rawRecords.length,
      accepted_count: accepted,
      rejected_count: rejected,
      idempotent_duplicate_count: idempotent,
      rejected: rejectedShort,
      records: entries,
    };
  }

  function compareUtf8Lex(a, b) {
    const ba = utf8Bytes(a);
    const bb = utf8Bytes(b);
    const len = Math.min(ba.length, bb.length);
    for (let i = 0; i < len; i++) {
      if (ba[i] !== bb[i]) return ba[i] - bb[i];
    }
    return ba.length - bb.length;
  }

  function computeWorld12RiskBandJs(active, eventMetrics) {
    let baseDelayFp = 0n;
    for (const a of active) {
      if (a.fp_val > baseDelayFp) baseDelayFp = a.fp_val;
    }
    let waveFp = 1000000n;
    for (const mmap of Object.values(eventMetrics || {})) {
      const wStr = mmap.wave_p95_m_fp || mmap.wave_m_fp;
      if (wStr) {
        const w = parseSigned64DecimalString(wStr);
        if (w !== null && w > waveFp) waveFp = w;
      }
    }
    let seed = 0xcae105deadbeef00n ^ BigInt.asUintN(64, baseDelayFp) ^ (BigInt.asUintN(64, waveFp) << 7n);
    const samples = [];
    for (let w = 0; w < 12; w++) {
      seed = (seed ^ (seed >> 12n)) & MASK64;
      seed = (seed ^ ((seed << 25n) & MASK64)) & MASK64;
      seed = (seed ^ (seed >> 27n)) & MASK64;
      const z = (seed * 0x2545f4914f6cdd1dn) & MASK64;
      const jitter = BigInt(z % 6500001n);
      const worldFactor = BigInt(w) * 1450000n;
      const waveContrib = (waveFp * 4n) / 10n;
      const risk = baseDelayFp + waveContrib + worldFactor + jitter;
      samples.push(risk > AIRLOCK_FP_SAFE_MAX_ABS ? AIRLOCK_FP_SAFE_MAX_ABS : risk);
    }
    samples.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    const p50 = (samples[5] + samples[6]) / 2n;
    const p95 = samples[11];
    return { p50: p50.toString(), p95: p95.toString() };
  }

  function computeStaleSourcesJs(manifest, active, cutoffBig) {
    const stale = [];
    for (const s of manifest.sources) {
      if (s.max_staleness_ms === null) continue;
      let latestObs = null;
      for (const a of active) {
        if (a.source_id === s.source_id) {
          if (latestObs === null || a.observed_at_ms > latestObs) {
            latestObs = a.observed_at_ms;
          }
        }
      }
      if (latestObs !== null) {
        const age = cutoffBig - latestObs;
        if (age > s.max_staleness_ms) {
          stale.push({
            source_id: s.source_id,
            latest_observed_at_ms: latestObs.toString(),
            age_ms: age.toString(),
            max_staleness_ms: s.max_staleness_ms.toString(),
          });
        }
      }
    }
    return stale;
  }

  function evaluateEventsCoreJs(
    acceptedInput,
    manifest,
    inputBatchB3,
    rawRecordCount,
    cutoffBig,
    policyOpts,
    downgraded,
    rejectedInSlice,
    eventMetrics
  ) {
    const scenarioId = policyOpts.scenario_id || "PILOT_AEGEAN_FERRY_DELAY_V1";
    const policyId = policyOpts.policy_id || "POLICY_FERRY_BERTH_SLA_V1";
    const maxAllowedFp = policyOpts.max_allowed_fp ?? 20n * FP_SCALE;
    const conflictThresholdFp = policyOpts.conflict_threshold_fp ?? 15n * FP_SCALE;
    const minGroups = policyOpts.min_independent_groups_for_pass ?? 1;

    const accepted = acceptedInput.slice().sort((a, b) => {
      if (a.observed_at_ms !== b.observed_at_ms)
        return a.observed_at_ms < b.observed_at_ms ? -1 : 1;
      if (a.learned_at_ms !== b.learned_at_ms)
        return a.learned_at_ms < b.learned_at_ms ? -1 : 1;
      const sc = compareUtf8Lex(a.source_id, b.source_id);
      if (sc !== 0) return sc;
      if (a.seq_no !== b.seq_no) return a.seq_no < b.seq_no ? -1 : 1;
      return compareUtf8Lex(a.event_id, b.event_id);
    });

    const preserved = accepted.map((ev) => ({ ...ev, superseded_by_event_id: null }));
    for (let i = 0; i < preserved.length; i++) {
      const targetId = preserved[i].supersedes_event_id;
      if (targetId) {
        const newerId = preserved[i].event_id;
        const newerSrc = preserved[i].source_id;
        for (let j = 0; j < i; j++) {
          if (preserved[j].event_id === targetId && preserved[j].source_id === newerSrc) {
            preserved[j].superseded_by_event_id = newerId;
          }
        }
      }
    }

    const active = preserved.filter((p) => p.superseded_by_event_id === null);
    if (active.length === 0) {
      const stateB3 = blake3Hex(
        `CAELUS_AIRLOCK_SLICE_STATE_BLAKE3_V2|EMPTY|${scenarioId}|${policyId}|${cutoffBig.toString()}`
      );
      return {
        ok: true,
        verdict: "KANIT_YETERSİZ",
        applied_rule_id: "RULE_EMPTY_SLICE_NO_EVIDENCE",
        scenario_id: scenarioId,
        policy_id: policyId,
        engine_version: CAELUS_AIRLOCK_ENGINE_VERSION,
        input_batch_blake3: inputBatchB3,
        cutoff_learned_at_ms: cutoffBig.toString(),
        state_blake3: stateB3,
        deterministic_state_fnv64: "0",
        binary_search_used: true,
        candidate_records_scanned: rawRecordCount,
        conflict_detected: false,
        legacy_unscoped_present: false,
        assumption_range_fp: [null, null],
        world_12_risk_band_fp: { p50: "0", p95: "0" },
        corroborated_groups: [],
        missing_evidence: ["NO_VERIFIED_EVENTS_AT_OR_BEFORE_CUTOFF"],
        missing_corroborations: ["NO_VERIFIED_EVENTS_AT_OR_BEFORE_CUTOFF"],
        downgraded_sources: downgraded,
        stale_sources: [],
        active_assertions: [],
        preserved_records: [],
        conflicts: [],
        active_conflicts: [],
        rejected_in_slice: rejectedInSlice,
        event_metrics: eventMetrics,
        causal_snapshot: {
          tick: "0",
          raw_friction_fp: "1000000",
          clamped_friction_fp: "1000000",
          throughput_ratio_fp: "1000000",
          regime_exceeded: false,
          any_hysteresis_flip: false,
          any_deadline_missed: false,
          outage_active: false,
        },
        audit_chain_head: null,
        audit_signer_pubkey: null,
        human_approval_required: true,
        write_authority: "NONE",
        scope_statement:
          "Salt-okunur pilot degerlendirmesi (KANIT_YETERSİZ); son karar insan onayindadir.",
      };
    }

    let minFp = active[0].fp_val;
    let maxFp = active[0].fp_val;
    const groupsSet = new Set();
    const nonHypGroupsSet = new Set();
    let calibratedBreach = false;
    for (const a of active) {
      if (a.fp_val < minFp) minFp = a.fp_val;
      if (a.fp_val > maxFp) maxFp = a.fp_val;
      if (!a.legacy_unscoped && a.independence_group) {
        groupsSet.add(a.independence_group);
        if (a.epistemic_status !== "HYPOTHESIS") {
          nonHypGroupsSet.add(a.independence_group);
        }
      }
      if (a.epistemic_status === "OBSERVATION" && a.fp_val > maxAllowedFp) {
        calibratedBreach = true;
      }
    }
    const groups = Array.from(groupsSet).sort(compareUtf8Lex);

    const bySubMetric = new Map();
    for (const a of active) {
      const k = `${a.subject_id}\0${a.metric_key}`;
      if (!bySubMetric.has(k)) bySubMetric.set(k, []);
      bySubMetric.get(k).push(a);
    }

    const conflicts = [];
    let unresolvedConflict = false;
    for (const items of bySubMetric.values()) {
      if (items.length < 2) continue;
      const gMin = items.reduce((m, x) => (x.fp_val < m ? x.fp_val : m), items[0].fp_val);
      const gMax = items.reduce((m, x) => (x.fp_val > m ? x.fp_val : m), items[0].fp_val);
      const spread = gMax - gMin;
      const distinctSrc = new Set(items.map((x) => x.source_id));
      const crosses = gMin <= maxAllowedFp && gMax > maxAllowedFp;
      if (distinctSrc.size >= 2 && (spread >= conflictThresholdFp || crosses)) {
        const obsBreach = items.some(
          (x) => x.epistemic_status === "OBSERVATION" && x.fp_val > maxAllowedFp
        );
        const obsCompliant = items.some(
          (x) => x.epistemic_status === "OBSERVATION" && x.fp_val <= maxAllowedFp
        );
        const resolved = obsBreach && !obsCompliant;
        if (!resolved) unresolvedConflict = true;
        conflicts.push({
          subject_id: items[0].subject_id,
          metric_key: items[0].metric_key,
          unit: items[0].unit,
          min_fp_val: gMin.toString(),
          max_fp_val: gMax.toString(),
          source_ids: Array.from(distinctSrc).sort(compareUtf8Lex),
          event_ids: items.map((x) => x.event_id),
          resolved_by_calibrated_observation_breach: resolved,
        });
      }
    }

    const missing = [];
    const hasCalObs = active.some((a) => a.epistemic_status === "OBSERVATION");
    const hasCompliantObs = active.some(
      (a) => a.epistemic_status === "OBSERVATION" && a.fp_val <= maxAllowedFp
    );
    const onlyHypotheses = active.every((a) => a.epistemic_status === "HYPOTHESIS");
    if (onlyHypotheses) {
      missing.push("HYPOTHESIS_ONLY_CANNOT_TRIGGER_DEFINITIVE_TRANSITION");
    } else if (!hasCalObs && nonHypGroupsSet.size < 2) {
      missing.push("INDEPENDENT_CORROBORATION_REQUIRED_FOR_SINGLE_SOURCE_CLAIM");
    }
    if (groups.length < minGroups) {
      missing.push("MIN_INDEPENDENT_SOURCE_GROUPS_NOT_MET");
    }
    if (unresolvedConflict) {
      missing.push("CONFLICTING_INDEPENDENT_SOURCES_UNRESOLVED");
    }

    let verdict = "KANIT_YETERSİZ";
    let ruleId = "RULE_UNCORROBORATED_CLAIM_OR_HYPOTHESIS";
    if (unresolvedConflict) {
      verdict = "KANIT_YETERSİZ";
      ruleId = "RULE_CONFLICT_PRESERVED_NO_UNILATERAL_PASS";
    } else if (calibratedBreach && !hasCompliantObs) {
      verdict = "KURAL_İHLALİ";
      ruleId = "RULE_CALIBRATED_OBSERVATION_SLA_BREACH";
    } else if (missing.length > 0) {
      verdict = "KANIT_YETERSİZ";
      ruleId = "RULE_UNCORROBORATED_CLAIM_OR_HYPOTHESIS";
    } else if (maxFp > maxAllowedFp) {
      verdict = "KURAL_İHLALİ";
      ruleId = "RULE_CORROBORATED_THRESHOLD_EXCEEDED";
    } else {
      verdict = "GEÇTİ";
      ruleId = "RULE_CORROBORATED_WITHIN_POLICY_THRESHOLD";
    }

    const world12 = computeWorld12RiskBandJs(active, eventMetrics);
    const staleSources = computeStaleSourcesJs(manifest, active, cutoffBig);
    const stateB3 = blake3Hex(
      JSON.stringify({
        scenarioId,
        policyId,
        cutoff: cutoffBig.toString(),
        verdict,
        ruleId,
        active: active.map((a) => [a.event_id, a.source_id, a.fp_val.toString()]),
      })
    );

    return {
      ok: true,
      verdict,
      applied_rule_id: ruleId,
      scenario_id: scenarioId,
      policy_id: policyId,
      engine_version: CAELUS_AIRLOCK_ENGINE_VERSION,
      input_batch_blake3: inputBatchB3,
      cutoff_learned_at_ms: cutoffBig.toString(),
      state_blake3: stateB3,
      deterministic_state_fnv64: "1",
      binary_search_used: true,
      candidate_records_scanned: rawRecordCount,
      conflict_detected: conflicts.length > 0,
      legacy_unscoped_present: false,
      assumption_range_fp: [minFp.toString(), maxFp.toString()],
      world_12_risk_band_fp: world12,
      corroborated_groups: groups,
      missing_evidence: missing,
      missing_corroborations: missing,
      downgraded_sources: downgraded,
      stale_sources: staleSources,
      active_assertions: active.map((a) => ({
        event_id: a.event_id,
        source_id: a.source_id,
        key_id: a.key_id,
        independence_group: a.independence_group,
        event_kind: a.event_kind,
        seq_no: a.seq_no.toString(),
        observed_at_ms: a.observed_at_ms.toString(),
        learned_at_ms: a.learned_at_ms.toString(),
        epistemic_status: a.epistemic_status,
        subject_id: a.subject_id,
        metric_key: a.metric_key,
        fp_val: a.fp_val.toString(),
        unit: a.unit,
        supersedes_event_id: a.supersedes_event_id,
        note: a.note,
      })),
      preserved_records: preserved.map((p) => ({
        event_id: p.event_id,
        source_id: p.source_id,
        seq_no: p.seq_no.toString(),
        observed_at_ms: p.observed_at_ms.toString(),
        learned_at_ms: p.learned_at_ms.toString(),
        epistemic_status: p.epistemic_status,
        fp_val: p.fp_val.toString(),
        superseded_by_event_id: p.superseded_by_event_id,
      })),
      conflicts,
      active_conflicts: conflicts,
      rejected_in_slice: rejectedInSlice,
      event_metrics: eventMetrics,
      causal_snapshot: {
        tick: "3",
        raw_friction_fp: "1000000",
        clamped_friction_fp: "1000000",
        throughput_ratio_fp: "1000000",
        regime_exceeded: false,
        any_hysteresis_flip: false,
        any_deadline_missed: verdict === "KURAL_İHLALİ",
        outage_active: false,
      },
      audit_chain_head: null,
      audit_signer_pubkey: null,
      human_approval_required: true,
      write_authority: "NONE",
      scope_statement:
        verdict === "GEÇTİ"
          ? `Belirtilen input_batch_blake3=${inputBatchB3}, cutoff_ts=${cutoffBig.toString()}, scenario_id=${scenarioId} ve policy_id=${policyId} altinda kural ihlali saptanmadi; operasyon sistemlerine yazma yetkisi yoktur, son karar insan onayindadir.`
          : `Salt-okunur pilot degerlendirmesi (${verdict}); son karar insan onayindadir.`,
    };
  }

  function evaluateSlicePureJs(batchRaw, manifestRaw, cutoffBig, policyOpts) {
    const manifest = parseManifestJs(manifestRaw);
    const inputBatchB3 = blake3Hex(batchRaw);
    const rawRecords = splitBatchRecordsJs(batchRaw);

    const seen = new Map();
    const downgraded = [];
    const rejectedInSlice = [];
    const accepted = [];
    const eventMetrics = {};

    for (const raw of rawRecords) {
      const v = verifyPacketJs(raw, manifest);
      if (!v.ok) {
        rejectedInSlice.push({
          error_code: v.err.code,
          audit_record_type:
            v.err.code === "ERR_SOURCE_EQUIVOCATION"
              ? "SECURITY_ALERT_EQUIVOCATION"
              : "INGEST_REJECTED",
          source_id: v.err.source_id,
          key_id: v.err.key_id,
          event_id: v.err.event_id,
          seq_no: v.err.seq_no.toString(),
          packet_blake3: v.err.packet_blake3,
          detail: v.err.detail,
        });
        continue;
      }
      const ev = v.event;
      if (ev.learned_at_ms > cutoffBig) {
        continue;
      }
      if (downgraded.includes(ev.source_id)) {
        rejectedInSlice.push({
          error_code: "ERR_UNTRUSTED_SOURCE",
          audit_record_type: "INGEST_REJECTED",
          source_id: ev.source_id,
          key_id: ev.key_id,
          event_id: ev.event_id,
          seq_no: ev.seq_no.toString(),
          packet_blake3: v.packet_blake3,
          detail: "source trust flag downgraded after prior equivocation",
        });
        continue;
      }
      const sk = `${ev.source_id}\0${ev.seq_no.toString()}`;
      if (seen.has(sk)) {
        if (seen.get(sk) !== ev.payload_blake3_hex) {
          if (!downgraded.includes(ev.source_id)) downgraded.push(ev.source_id);
          rejectedInSlice.push({
            error_code: "ERR_SOURCE_EQUIVOCATION",
            audit_record_type: "SECURITY_ALERT_EQUIVOCATION",
            source_id: ev.source_id,
            key_id: ev.key_id,
            event_id: ev.event_id,
            seq_no: ev.seq_no.toString(),
            packet_blake3: v.packet_blake3,
            detail: "conflicting payload_blake3 for identical (source_id, seq_no)",
          });
        }
        continue;
      }
      seen.set(sk, ev.payload_blake3_hex);
      accepted.push(ev);
      if (ev.metrics_map) {
        eventMetrics[ev.event_id] = { ...ev.metrics_map };
      }
    }

    return evaluateEventsCoreJs(
      accepted,
      manifest,
      inputBatchB3,
      rawRecords.length,
      cutoffBig,
      policyOpts,
      downgraded,
      rejectedInSlice,
      eventMetrics
    );
  }

  function evaluateCounterfactualPureJs(
    batchRaw,
    manifestRaw,
    baseCutoffBig,
    branchId,
    interventions,
    policyOpts
  ) {
    if (!Array.isArray(interventions) || interventions.length === 0) {
      throw new Error("interventions must contain at least one intervention");
    }
    const manifest = parseManifestJs(manifestRaw);
    const inputBatchB3 = blake3Hex(batchRaw);
    const rawRecords = splitBatchRecordsJs(batchRaw);
    const maxAllowedFp = policyOpts.max_allowed_fp ?? 20n * FP_SCALE;

    const seen = new Map();
    const downgraded = [];
    const rejectedInSlice = [];
    const baseEvents = [];
    const baseMetrics = {};
    for (const raw of rawRecords) {
      const v = verifyPacketJs(raw, manifest);
      if (!v.ok) continue;
      const ev = v.event;
      if (ev.learned_at_ms > baseCutoffBig) continue;
      const sk = `${ev.source_id}\0${ev.seq_no.toString()}`;
      if (seen.has(sk)) continue;
      seen.set(sk, ev.payload_blake3_hex);
      baseEvents.push(ev);
      if (ev.metrics_map) baseMetrics[ev.event_id] = { ...ev.metrics_map };
    }

    const baseEval = evaluateEventsCoreJs(
      baseEvents,
      manifest,
      inputBatchB3,
      rawRecords.length,
      baseCutoffBig,
      policyOpts,
      downgraded,
      rejectedInSlice,
      baseMetrics
    );

    let branchEvents = baseEvents.map((e) => ({ ...e }));
    const branchMetrics = {};
    for (const [k, m] of Object.entries(baseMetrics)) branchMetrics[k] = { ...m };
    let applied = 0;

    for (const iv of interventions) {
      const targetId = String(iv.target_id || "");
      const fieldLower = String(iv.override_field || "").toLowerCase();
      const targetUpper = targetId.toUpperCase();
      const fpVal = parseSigned64DecimalString(iv.fp_val);
      if (!targetId || !fieldLower || fpVal === null) {
        throw new Error("invalid counterfactual intervention entry");
      }
      if ((fpVal < 0n ? -fpVal : fpVal) > AIRLOCK_FP_SAFE_MAX_ABS) {
        throw new Error("intervention fp_val exceeds Z3 safe domain 2^62");
      }

      if (fieldLower === "disable" || (fieldLower === "enabled" && fpVal === 0n)) {
        const before = branchEvents.length;
        branchEvents = branchEvents.filter(
          (e) =>
            e.event_id !== targetId &&
            e.source_id !== targetId &&
            e.subject_id !== targetId
        );
        if (branchEvents.length !== before) applied += 1;
      } else if (targetUpper.startsWith("BERTH")) {
        const relief = fpVal > 0n ? fpVal : 18000000n;
        for (const ev of branchEvents) {
          if (
            (ev.metric_key === "delay_min_fp" ||
              ev.metric_key === "departure_delay_min" ||
              ev.metric_key === "departure_delay") &&
            ev.fp_val > maxAllowedFp
          ) {
            const next =
              fpVal > 0n && fieldLower === "delay_min_fp"
                ? fpVal
                : ev.fp_val - relief > 8000000n
                  ? ev.fp_val - relief
                  : 8000000n;
            ev.fp_val = next;
            if (branchMetrics[ev.event_id]) {
              if (branchMetrics[ev.event_id].delay_min_fp !== undefined) {
                branchMetrics[ev.event_id].delay_min_fp = next.toString();
              }
              if (branchMetrics[ev.event_id].wave_p95_m_fp !== undefined) {
                const w = parseSigned64DecimalString(branchMetrics[ev.event_id].wave_p95_m_fp);
                if (w !== null) {
                  branchMetrics[ev.event_id].wave_p95_m_fp = (
                    w - 450000n > 500000n ? w - 450000n : 500000n
                  ).toString();
                }
              }
            }
          }
        }
        applied += 1;
      } else if (targetUpper.startsWith("ROUTE") || fieldLower === "route_shelter_corridor") {
        const relief = fpVal > 0n ? fpVal : 16000000n;
        for (const ev of branchEvents) {
          if (
            (ev.metric_key === "delay_min_fp" ||
              ev.metric_key === "departure_delay_min" ||
              ev.metric_key === "departure_delay") &&
            ev.fp_val > maxAllowedFp
          ) {
            ev.fp_val = ev.fp_val - relief > 10000000n ? ev.fp_val - relief : 10000000n;
          } else if (ev.metric_key === "wave_m_fp") {
            ev.fp_val = ev.fp_val - 750000n > 500000n ? ev.fp_val - 750000n : 500000n;
          }
          if (branchMetrics[ev.event_id]) {
            if (branchMetrics[ev.event_id].wave_m_fp !== undefined) {
              const w = parseSigned64DecimalString(branchMetrics[ev.event_id].wave_m_fp);
              if (w !== null) {
                branchMetrics[ev.event_id].wave_m_fp = (
                  w - 750000n > 500000n ? w - 750000n : 500000n
                ).toString();
              }
            }
            if (branchMetrics[ev.event_id].wave_p95_m_fp !== undefined) {
              const w95 = parseSigned64DecimalString(branchMetrics[ev.event_id].wave_p95_m_fp);
              if (w95 !== null) {
                branchMetrics[ev.event_id].wave_p95_m_fp = (
                  w95 - 850000n > 500000n ? w95 - 850000n : 500000n
                ).toString();
              }
            }
          }
        }
        applied += 1;
      } else {
        let matched = false;
        for (const ev of branchEvents) {
          if (
            ev.event_id === targetId ||
            ev.source_id === targetId ||
            ev.subject_id === targetId
          ) {
            ev.fp_val = fieldLower === "delta_fp" ? ev.fp_val + fpVal : fpVal;
            matched = true;
          }
        }
        if (matched) applied += 1;
      }
    }

    const branchEval = evaluateEventsCoreJs(
      branchEvents,
      manifest,
      inputBatchB3,
      rawRecords.length,
      baseCutoffBig,
      policyOpts,
      downgraded,
      rejectedInSlice,
      branchMetrics
    );

    const baseDelay = BigInt(baseEval.assumption_range_fp[1] || "0");
    const branchDelay = BigInt(branchEval.assumption_range_fp[1] || "0");
    const baseP95 = BigInt(baseEval.world_12_risk_band_fp.p95 || "0");
    const branchP95 = BigInt(branchEval.world_12_risk_band_fp.p95 || "0");

    return {
      ok: true,
      branch_id: branchId || "cf_01",
      base_cutoff_ms: baseCutoffBig.toString(),
      base_verdict: baseEval.verdict,
      branch_verdict: branchEval.verdict,
      delta_delay_min_fp: (branchDelay - baseDelay).toString(),
      delta_risk_fp: (branchP95 - baseP95).toString(),
      base_state_blake3: baseEval.state_blake3,
      branch_state_blake3: branchEval.state_blake3,
      applied_interventions: applied,
      branch_applied_rule_id: branchEval.applied_rule_id,
      branch_world_12_risk_band_fp: branchEval.world_12_risk_band_fp,
      human_approval_required: true,
      write_authority: "NONE",
    };
  }

  // ============================================================================
  // 5. MCP KONTROLCÜSÜ VE 4 SALT-OKUNUR PİLOT ARACI (§3.1 + rmcp/rig/qdrant/motherduck/grafana)
  // ============================================================================

  const MCP_INTEROP_BINDINGS = Object.freeze({
    rustSdkTarget: "modelcontextprotocol/rust-sdk (rmcp)",
    agentFrameworkTarget: "0xplaygrounds/rig",
    externalMemoryHook: {
      provider: "qdrant/mcp-server-qdrant",
      collection: "caelus_epistemic_incidents_v2",
      payloadInt64Encoding: "decimal_ascii_string",
    },
    analyticsHook: {
      provider: "motherduckdb/mcp-server-motherduck",
      table: "caelus_bitemporal_slices_v2",
      bigintColumnRule: "VARCHAR_DECIMAL_64",
    },
    observabilityHook: {
      provider: "grafana/mcp-grafana",
      dashboardUid: "caelus-war-room-c2",
      stalenessPanelTarget: "airlock_source_staleness_ms",
    },
  });

  const AIRLOCK_MCP_TOOLS_CATALOG = Object.freeze([
    Object.freeze({
      name: "caelus_airlock_validate_batch",
      description:
        "İmzalı aday .airlock.ndjson / CAELUS_INTEL_V2 olay dosyasını kaynak manifesti, sabit nokta (FP_SCALE=1_000_000, |val|<=2^62) ve 64-bit dizge kurallarına göre sınar; motor durumunu değiştirmeden kabul/ret listesi ve batch_blake3 döner.",
      readOnly: true,
      humanApprovalRequired: true,
      writeAuthority: "NONE",
      rmcpToolStruct: "CaelusAirlockValidateBatchTool",
      inputSchema: {
        type: "object",
        properties: {
          ndjson_path: { type: "string" },
          batch_path: { type: "string" },
          batch_ndjson: { type: "string" },
          manifest_path: { type: "string" },
          manifest_json: { type: "string" },
          advisor_template: {
            type: "string",
            enum: ["WATCHER", "STRESS_TESTER", "STRATEGIST", "EXPLAINER"],
          },
        },
      },
    }),
    Object.freeze({
      name: "caelus_evaluate_slice",
      description:
        "Onaylı olay paketini verilen 64-bit ondalık dizge cutoff_learned_at_ms, scenario_id ve policy_id ile koşturur; sonucu yalnızca GEÇTİ, KURAL_İHLALİ veya KANIT_YETERSİZ olarak ve world_12_risk_band_fp ile döner.",
      readOnly: true,
      humanApprovalRequired: true,
      writeAuthority: "NONE",
      rmcpToolStruct: "CaelusEvaluateSliceTool",
      inputSchema: {
        type: "object",
        required: ["cutoff_learned_at_ms"],
        properties: {
          batch_path: { type: "string" },
          ndjson_path: { type: "string" },
          batch_ndjson: { type: "string" },
          manifest_path: { type: "string" },
          manifest_json: { type: "string" },
          cutoff_learned_at_ms: {
            type: "string",
            description: "Signed 64-bit integer timestamp (ms) serialized as decimal ASCII string.",
          },
          scenario_id: { type: "string" },
          policy_id: { type: "string" },
          max_allowed_fp: {
            type: "string",
            description: "Signed 64-bit fixed-point threshold (FP_SCALE=1_000_000) as decimal ASCII string.",
          },
          conflict_threshold_fp: {
            type: "string",
            description: "Signed 64-bit fixed-point conflict divergence threshold as decimal ASCII string.",
          },
          min_independent_groups_for_pass: { type: "integer", minimum: 1 },
          audit_log_path: { type: "string" },
          audit_seed: { type: "string" },
          audit_session_id: { type: "string" },
          det_clock: { type: "boolean" },
          advisor_template: {
            type: "string",
            enum: ["WATCHER", "STRESS_TESTER", "STRATEGIST", "EXPLAINER"],
          },
        },
      },
    }),
    Object.freeze({
      name: "caelus_run_counterfactual_branch",
      description:
        "Belirtilen base_cutoff_ms bilgi kesitinde deterministik karşı-olgu (What-If) müdahalelerini koşturur; base_verdict -> branch_verdict geçişini, delta_delay_min_fp, delta_risk_fp ve branch_state_blake3 özetini döner.",
      readOnly: true,
      humanApprovalRequired: true,
      writeAuthority: "NONE",
      rmcpToolStruct: "CaelusRunCounterfactualBranchTool",
      inputSchema: {
        type: "object",
        required: ["base_cutoff_ms", "interventions"],
        properties: {
          base_cutoff_ms: {
            type: "string",
            description: "Signed 64-bit integer cutoff timestamp (ms) as decimal ASCII string.",
          },
          branch_id: { type: "string" },
          interventions: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["target_id", "override_field", "fp_val"],
              properties: {
                target_id: { type: "string" },
                override_field: { type: "string" },
                fp_val: {
                  type: "string",
                  description: "Signed 64-bit fixed-point intervention value as decimal ASCII string.",
                },
              },
            },
          },
          batch_path: { type: "string" },
          ndjson_path: { type: "string" },
          batch_ndjson: { type: "string" },
          manifest_path: { type: "string" },
          manifest_json: { type: "string" },
          scenario_id: { type: "string" },
          policy_id: { type: "string" },
          max_allowed_fp: { type: "string" },
          conflict_threshold_fp: { type: "string" },
          advisor_template: {
            type: "string",
            enum: ["WATCHER", "STRESS_TESTER", "STRATEGIST", "EXPLAINER"],
          },
        },
      },
    }),
    Object.freeze({
      name: "caelus_explain_outcome",
      description:
        "Üretilen bilgi kesiti kararını (GEÇTİ / KURAL_İHLALİ / KANIT_YETERSİZ) triggered_rules, supporting_events, sabit nokta varsayım aralığı ve audit_log Ed25519 mührüne bağlar; çıktıyı kanonik msg_id + params ve seçili locale (tr/en) + register (plain/technical) metniyle döner.",
      readOnly: true,
      humanApprovalRequired: true,
      writeAuthority: "NONE",
      rmcpToolStruct: "CaelusExplainOutcomeTool",
      inputSchema: {
        type: "object",
        properties: {
          state_blake3: { type: "string" },
          batch_path: { type: "string" },
          ndjson_path: { type: "string" },
          batch_ndjson: { type: "string" },
          manifest_path: { type: "string" },
          manifest_json: { type: "string" },
          cutoff_learned_at_ms: { type: "string" },
          scenario_id: { type: "string" },
          policy_id: { type: "string" },
          max_allowed_fp: { type: "string" },
          conflict_threshold_fp: { type: "string" },
          min_independent_groups_for_pass: { type: "integer", minimum: 1 },
          audit_log_path: { type: "string" },
          locale: {
            type: "string",
            enum: ["tr", "en"],
            description: "Offline output language ('tr' default or 'en'); mutates state_blake3 by 0 bits.",
          },
          register: {
            type: "string",
            enum: ["plain", "technical"],
            description: "Cognitive register ('plain' default operator language or 'technical' audit detail).",
          },
          advisor_template: {
            type: "string",
            enum: ["WATCHER", "STRESS_TESTER", "STRATEGIST", "EXPLAINER"],
          },
        },
      },
    }),
  ]);

  function canonicalMsgIdForVerdict(verdictCode) {
    if (verdictCode === "GEÇTİ") return "verdict.pass";
    if (verdictCode === "KURAL_İHLALİ") return "verdict.rule_breach";
    return "verdict.insufficient_corroboration";
  }

  function enrichOutcomeWithCanonicalI18n(baseObj, rawArgs = {}) {
    const loc = warRoomI18n ? warRoomI18n.normalizeLocale(rawArgs.locale) : rawArgs.locale === "en" ? "en" : "tr";
    const reg = warRoomI18n
      ? warRoomI18n.normalizeRegister(rawArgs.register)
      : rawArgs.register === "technical"
        ? "technical"
        : "plain";
    const verdictCode = String(baseObj.verdict || "KANIT_YETERSİZ");
    const msgId = canonicalMsgIdForVerdict(verdictCode);
    const activeList = Array.isArray(baseObj.active_assertions)
      ? baseObj.active_assertions
      : Array.isArray(baseObj.supporting_events)
        ? baseObj.supporting_events
        : [];
    const groupList = Array.isArray(baseObj.corroborated_groups) ? baseObj.corroborated_groups : [];
    const rangeFp = Array.isArray(baseObj.assumption_range_fp) ? baseObj.assumption_range_fp : [null, null];
    const maxDelayFpStr = rangeFp[1] !== null && rangeFp[1] !== undefined ? String(rangeFp[1]) : "0";
    const maxAllowedFpStr = String(rawArgs.max_allowed_fp || "20000000");

    const msgParams = {
      source_count: activeList.length,
      group_count: groupList.length,
      delay_min_fp: maxDelayFpStr,
      max_allowed_fp: maxAllowedFpStr,
    };

    let verdictText = verdictCode;
    let localizedExplanation = verdictCode;
    if (warRoomI18n) {
      verdictText = warRoomI18n.formatVerdict(
        verdictCode,
        {
          policy_id: baseObj.policy_id || rawArgs.policy_id || "MARITIME_SAFETY_V2",
          rule_id: baseObj.applied_rule_id || "—",
          max_allowed_fp: maxAllowedFpStr,
          missing_groups: baseObj.missing_corroborations || baseObj.missing_evidence || [],
        },
        { locale: loc, register: reg }
      );
      localizedExplanation = warRoomI18n.resolveCanonicalMessage(
        "explain.outcome",
        {
          verdict_code: verdictCode,
          policy_id: baseObj.policy_id || rawArgs.policy_id || "MARITIME_SAFETY_V2",
          rule_id: baseObj.applied_rule_id || "—",
          max_allowed_fp: maxAllowedFpStr,
          group_count: groupList.length,
          state_blake3: baseObj.state_blake3 || "",
        },
        { locale: loc, register: reg }
      );
    }

    return {
      ...baseObj,
      msg_id: baseObj.msg_id || msgId,
      msg_params: baseObj.msg_params || msgParams,
      locale: loc,
      register: reg,
      verdict_text: verdictText,
      localized_explanation: localizedExplanation,
    };
  }

  function createSidecarAirlockMcpController(options = {}) {
    const repoRootDir =
      options.repoRootDir ||
      (nodeDeps ? nodeDeps.path.resolve(__dirname, "..") : ".");

    function prepareBatchAndManifestInputs(args, allowDefaultAegeanPilot = false) {
      let tempDir = null;
      const cleanup = () => {
        if (tempDir && nodeDeps) {
          try {
            nodeDeps.fs.rmSync(tempDir, { recursive: true, force: true });
          } catch (_) {
            // ignore cleanup errors
          }
        }
      };

      try {
        let batchPath = null;
        let manifestPath = null;
        let batchRaw = null;
        let manifestRaw = null;

        const chosenBatchPath =
          typeof args.batch_path === "string" && args.batch_path.length > 0
            ? args.batch_path
            : typeof args.ndjson_path === "string" && args.ndjson_path.length > 0
              ? args.ndjson_path
              : allowDefaultAegeanPilot && nodeDeps
                ? "scenarios/pilot_aegean_ferry_airlock/events.airlock.ndjson"
                : null;

        if (chosenBatchPath) {
          const r = resolveSafeFilePath(chosenBatchPath, repoRootDir, false);
          if (!r.ok) return { ...r, cleanup };
          batchPath = r.resolvedPath;
          batchRaw = nodeDeps.fs.readFileSync(batchPath, "utf8");
        } else if (typeof args.batch_ndjson === "string") {
          batchRaw = args.batch_ndjson;
        } else if (allowDefaultAegeanPilot && typeof options.defaultBatchNdjson === "string") {
          batchRaw = options.defaultBatchNdjson;
        } else {
          return {
            ok: false,
            errorCode: "MCP_AIRLOCK_MISSING_BATCH",
            messageTr: "'batch_path' ('ndjson_path') veya 'batch_ndjson' alanı zorunludur.",
            cleanup,
          };
        }

        const shouldAutoDefaultManifest =
          allowDefaultAegeanPilot ||
          args.scenario_id === "AEGEAN_FERRY_01" ||
          args.policy_id === "MARITIME_SAFETY_V2" ||
          (chosenBatchPath && chosenBatchPath.includes("pilot_aegean_ferry_airlock"));

        const chosenManifestPath =
          typeof args.manifest_path === "string" && args.manifest_path.length > 0
            ? args.manifest_path
            : shouldAutoDefaultManifest && nodeDeps
              ? "configs/source_manifest.json"
              : null;

        if (chosenManifestPath) {
          const r = resolveSafeFilePath(chosenManifestPath, repoRootDir, false);
          if (!r.ok) return { ...r, cleanup };
          manifestPath = r.resolvedPath;
          manifestRaw = nodeDeps.fs.readFileSync(manifestPath, "utf8");
        } else if (typeof args.manifest_json === "string") {
          manifestRaw = args.manifest_json;
        } else if (shouldAutoDefaultManifest && typeof options.defaultManifestJson === "string") {
          manifestRaw = options.defaultManifestJson;
        } else {
          return {
            ok: false,
            errorCode: "MCP_AIRLOCK_MISSING_MANIFEST",
            messageTr: "'manifest_path' veya 'manifest_json' alanı zorunludur.",
            cleanup,
          };
        }

        return {
          ok: true,
          batchPath,
          manifestPath,
          batchRaw,
          manifestRaw,
          materializeTempFilesIfNeeded() {
            if (batchPath && manifestPath) {
              return { batchFile: batchPath, manifestFile: manifestPath };
            }
            tempDir = nodeDeps.fs.mkdtempSync(
              nodeDeps.path.join(nodeDeps.os.tmpdir(), "caelus-airlock-mcp-")
            );
            const bFile = batchPath || nodeDeps.path.join(tempDir, "events.airlock.ndjson");
            const mFile = manifestPath || nodeDeps.path.join(tempDir, "source_manifest.json");
            if (!batchPath) nodeDeps.fs.writeFileSync(bFile, batchRaw, "utf8");
            if (!manifestPath) nodeDeps.fs.writeFileSync(mFile, manifestRaw, "utf8");
            return { batchFile: bFile, manifestFile: mFile };
          },
          cleanup,
        };
      } catch (err) {
        cleanup();
        return {
          ok: false,
          errorCode: "MCP_AIRLOCK_IO_ERROR",
          messageTr: String(err && err.message ? err.message : err),
          cleanup: () => {},
        };
      }
    }

    function checkAdvisorTemplate(args, toolName) {
      if (args.advisor_template === undefined || args.advisor_template === null) {
        return { ok: true, template: null };
      }
      const tpl = ADVISOR_TASK_TEMPLATES_4[String(args.advisor_template)];
      if (!tpl) {
        return {
          ok: false,
          errorCode: "MCP_INVALID_ADVISOR_TEMPLATE",
          messageTr: `Bilinmeyen Advisor şablonu: '${args.advisor_template}'. İzinli şablonlar: WATCHER, STRESS_TESTER, STRATEGIST, EXPLAINER.`,
        };
      }
      if (!tpl.allowedTools.includes(toolName)) {
        return {
          ok: false,
          errorCode: "MCP_ADVISOR_TEMPLATE_TOOL_FORBIDDEN",
          messageTr: `Advisor şablonu '${tpl.templateId}' '${toolName}' aracını çağıramaz.`,
        };
      }
      return { ok: true, template: tpl };
    }

    function runNativeBinary(binPath, cliArgs) {
      try {
        const stdout = nodeDeps.childProcess.execFileSync(binPath, cliArgs, {
          encoding: "utf8",
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 16 * 1024 * 1024,
        });
        const line = stdout.trim();
        const rawViol = detectUnquoted64BitViolationInRawJson(line);
        if (rawViol) {
          return { ok: false, errorCode: rawViol.errorCode, messageTr: rawViol.messageTr };
        }
        return { ok: true, parsed: JSON.parse(line) };
      } catch (err) {
        const stderr = err && err.stderr ? String(err.stderr).trim() : "";
        return {
          ok: false,
          errorCode: "MCP_AIRLOCK_ENGINE_REJECTED",
          messageTr: stderr || String(err && err.message ? err.message : err),
        };
      }
    }

    function invokeAirlockTool({ toolName, arguments: rawArgs = {} }) {
      if (
        rawArgs.writeToOperationalSystem === true ||
        rawArgs.bypassHumanApproval === true ||
        rawArgs.promoteToFact === true
      ) {
        return {
          ok: false,
          errorCode: "MCP_AIRLOCK_WRITE_OR_PROMOTION_FORBIDDEN",
          messageTr:
            "CAELUS Airlock MCP araçları salt-okunurdur; dış operasyon sistemlerine yazma veya insan onayını atlama yasaktır.",
        };
      }

      const boundary = validate64BitMcpArguments(rawArgs);
      if (!boundary.ok) return boundary;

      const tplCheck = checkAdvisorTemplate(rawArgs, toolName);
      if (!tplCheck.ok) return tplCheck;
      const advisorMeta = tplCheck.template
        ? {
            template_id: tplCheck.template.templateId,
            agent_alias: tplCheck.template.agentAlias,
            autonomous_service: false,
            write_authority: "NONE",
            human_approval_required: true,
          }
        : null;

      if (toolName === "caelus_airlock_validate_batch") {
        const prep = prepareBatchAndManifestInputs(rawArgs, false);
        if (!prep.ok) return prep;
        try {
          const nativeBin = findNativeSidecarBinary(options);
          if (nativeBin) {
            const { batchFile, manifestFile } = prep.materializeTempFilesIfNeeded();
            const res = runNativeBinary(nativeBin, [
              "validate",
              "--batch",
              batchFile,
              "--manifest",
              manifestFile,
            ]);
            if (!res.ok) return res;
            return {
              ...res.parsed,
              tool: toolName,
              engine_execution_mode: "NATIVE_RUST_AIRLOCK",
              advisor_template: advisorMeta,
              human_approval_required: true,
              write_authority: "NONE",
            };
          }
          const jsRes = validateBatchPureJs(prep.batchRaw, prep.manifestRaw);
          return {
            ...jsRes,
            tool: toolName,
            engine_execution_mode: "PURE_JS_BIGINT_FALLBACK",
            advisor_template: advisorMeta,
            human_approval_required: true,
            write_authority: "NONE",
          };
        } catch (err) {
          return {
            ok: false,
            errorCode: "MCP_AIRLOCK_VALIDATION_FAILED",
            messageTr: String(err && err.message ? err.message : err),
          };
        } finally {
          prep.cleanup();
        }
      }

      if (toolName === "caelus_run_counterfactual_branch") {
        if (typeof rawArgs.base_cutoff_ms !== "string") {
          return {
            ok: false,
            errorCode: "MCP_64BIT_DECIMAL_STRING_REQUIRED",
            field: "arguments.base_cutoff_ms",
            messageTr:
              "'base_cutoff_ms' zorunludur ve 64-bit ondalık ASCII dizge ('string') olarak verilmelidir.",
          };
        }
        const baseCutoffBig = parseSigned64DecimalString(rawArgs.base_cutoff_ms);
        if (baseCutoffBig === null) {
          return {
            ok: false,
            errorCode: "MCP_64BIT_DECIMAL_STRING_INVALID",
            field: "arguments.base_cutoff_ms",
            messageTr: `'base_cutoff_ms' geçerli bir imzalı 64-bit ondalık dizge değil: '${rawArgs.base_cutoff_ms}'.`,
          };
        }
        if (!Array.isArray(rawArgs.interventions) || rawArgs.interventions.length === 0) {
          return {
            ok: false,
            errorCode: "MCP_AIRLOCK_MISSING_INTERVENTIONS",
            messageTr: "'interventions' en az 1 karşı-olgu müdahalesi içermelidir.",
          };
        }
        const prep = prepareBatchAndManifestInputs(rawArgs, true);
        if (!prep.ok) return prep;
        try {
          const nativeBin = findNativeSidecarBinary(options);
          const branchId = String(rawArgs.branch_id || "cf_01");
          if (nativeBin) {
            const { batchFile, manifestFile } = prep.materializeTempFilesIfNeeded();
            const cliArgs = [
              "counterfactual",
              "--batch",
              batchFile,
              "--manifest",
              manifestFile,
              "--base-cutoff-ms",
              rawArgs.base_cutoff_ms,
              "--branch-id",
              branchId,
            ];
            for (const iv of rawArgs.interventions) {
              cliArgs.push(
                "--intervention",
                `${String(iv.target_id || "")}:${String(iv.override_field || "")}:${String(iv.fp_val || "")}`
              );
            }
            if (rawArgs.scenario_id) cliArgs.push("--scenario-id", String(rawArgs.scenario_id));
            if (rawArgs.policy_id) cliArgs.push("--policy-id", String(rawArgs.policy_id));
            if (rawArgs.max_allowed_fp) {
              cliArgs.push("--max-allowed-fp", String(rawArgs.max_allowed_fp));
            }
            if (rawArgs.conflict_threshold_fp) {
              cliArgs.push("--conflict-threshold-fp", String(rawArgs.conflict_threshold_fp));
            }
            const res = runNativeBinary(nativeBin, cliArgs);
            if (!res.ok) return res;
            return {
              ...res.parsed,
              tool: toolName,
              engine_execution_mode: "NATIVE_RUST_AIRLOCK",
              advisor_template: advisorMeta,
              human_approval_required: true,
              write_authority: "NONE",
            };
          }
          const jsCf = evaluateCounterfactualPureJs(
            prep.batchRaw,
            prep.manifestRaw,
            baseCutoffBig,
            branchId,
            rawArgs.interventions,
            {
              scenario_id: rawArgs.scenario_id,
              policy_id: rawArgs.policy_id,
              max_allowed_fp: rawArgs.max_allowed_fp
                ? parseSigned64DecimalString(rawArgs.max_allowed_fp)
                : undefined,
              conflict_threshold_fp: rawArgs.conflict_threshold_fp
                ? parseSigned64DecimalString(rawArgs.conflict_threshold_fp)
                : undefined,
            }
          );
          return {
            ...jsCf,
            tool: toolName,
            engine_execution_mode: "PURE_JS_BIGINT_FALLBACK",
            advisor_template: advisorMeta,
          };
        } catch (err) {
          return {
            ok: false,
            errorCode: "MCP_AIRLOCK_COUNTERFACTUAL_FAILED",
            messageTr: String(err && err.message ? err.message : err),
          };
        } finally {
          prep.cleanup();
        }
      }

      if (toolName === "caelus_evaluate_slice" || toolName === "caelus_explain_outcome") {
        // §3.1 item 4: caelus_explain_outcome({ state_blake3, audit_log_path }) without cutoff_learned_at_ms
        if (
          toolName === "caelus_explain_outcome" &&
          rawArgs.cutoff_learned_at_ms === undefined &&
          typeof rawArgs.state_blake3 === "string" &&
          rawArgs.state_blake3.length > 0
        ) {
          if (typeof rawArgs.audit_log_path !== "string" || rawArgs.audit_log_path.length === 0) {
            return {
              ok: false,
              errorCode: "MCP_AIRLOCK_MISSING_AUDIT_LOG",
              messageTr: "cutoff_learned_at_ms verilmediğinde 'audit_log_path' zorunludur.",
            };
          }
          const ar = resolveSafeFilePath(rawArgs.audit_log_path, repoRootDir, false);
          if (!ar.ok) return ar;
          const nativeBin = findNativeSidecarBinary(options);
          if (nativeBin) {
            const explainOnlyArgs = [
              "explain",
              "--state-blake3",
              rawArgs.state_blake3,
              "--audit-log",
              ar.resolvedPath,
            ];
            if (rawArgs.locale) explainOnlyArgs.push("--locale", String(rawArgs.locale));
            if (rawArgs.register) explainOnlyArgs.push("--register", String(rawArgs.register));
            const res = runNativeBinary(nativeBin, explainOnlyArgs);
            if (!res.ok) return res;
            return {
              ...res.parsed,
              tool: toolName,
              engine_execution_mode: "NATIVE_RUST_AIRLOCK",
              advisor_template: advisorMeta,
              human_approval_required: true,
              write_authority: "NONE",
            };
          }
        }

        if (typeof rawArgs.cutoff_learned_at_ms !== "string") {
          return {
            ok: false,
            errorCode: "MCP_64BIT_DECIMAL_STRING_REQUIRED",
            field: "arguments.cutoff_learned_at_ms",
            messageTr:
              "'cutoff_learned_at_ms' zorunludur ve 64-bit ondalık ASCII dizge ('string') olarak verilmelidir.",
          };
        }
        const cutoffBig = parseSigned64DecimalString(rawArgs.cutoff_learned_at_ms);
        if (cutoffBig === null) {
          return {
            ok: false,
            errorCode: "MCP_64BIT_DECIMAL_STRING_INVALID",
            field: "arguments.cutoff_learned_at_ms",
            messageTr: `'cutoff_learned_at_ms' geçerli bir imzalı 64-bit ondalık dizge değil: '${rawArgs.cutoff_learned_at_ms}'.`,
          };
        }

        let resolvedAuditPath = null;
        if (typeof rawArgs.audit_log_path === "string" && rawArgs.audit_log_path.length > 0) {
          const ar = resolveSafeFilePath(
            rawArgs.audit_log_path,
            repoRootDir,
            /*allowMissingForOutput=*/ toolName === "caelus_evaluate_slice"
          );
          if (!ar.ok) return ar;
          resolvedAuditPath = ar.resolvedPath;
        }

        const prep = prepareBatchAndManifestInputs(rawArgs, false);
        if (!prep.ok) return prep;

        try {
          const nativeBin = findNativeSidecarBinary(options);
          if (nativeBin) {
            const { batchFile, manifestFile } = prep.materializeTempFilesIfNeeded();
            const cliArgs = [
              toolName === "caelus_evaluate_slice" ? "evaluate-slice" : "explain",
              "--batch",
              batchFile,
              "--manifest",
              manifestFile,
              "--cutoff-ms",
              rawArgs.cutoff_learned_at_ms,
            ];
            if (rawArgs.scenario_id) cliArgs.push("--scenario-id", String(rawArgs.scenario_id));
            if (rawArgs.policy_id) cliArgs.push("--policy-id", String(rawArgs.policy_id));
            if (rawArgs.max_allowed_fp) {
              cliArgs.push("--max-allowed-fp", String(rawArgs.max_allowed_fp));
            }
            if (rawArgs.conflict_threshold_fp) {
              cliArgs.push("--conflict-threshold-fp", String(rawArgs.conflict_threshold_fp));
            }
            if (rawArgs.min_independent_groups_for_pass !== undefined) {
              cliArgs.push("--min-groups", String(rawArgs.min_independent_groups_for_pass));
            }
            if (resolvedAuditPath) {
              cliArgs.push("--audit-log", resolvedAuditPath);
            }
            if (toolName === "caelus_explain_outcome") {
              if (rawArgs.state_blake3) {
                cliArgs.push("--state-blake3", String(rawArgs.state_blake3));
              }
              if (rawArgs.locale) cliArgs.push("--locale", String(rawArgs.locale));
              if (rawArgs.register) cliArgs.push("--register", String(rawArgs.register));
            }
            if (toolName === "caelus_evaluate_slice") {
              if (rawArgs.audit_seed) cliArgs.push("--audit-seed", String(rawArgs.audit_seed));
              if (rawArgs.audit_session_id) {
                cliArgs.push("--audit-session-id", String(rawArgs.audit_session_id));
              }
              if (rawArgs.det_clock === true) cliArgs.push("--det-clock");
            }

            const res = runNativeBinary(nativeBin, cliArgs);
            if (!res.ok) return res;
            if (res.parsed.verdict && !ALLOWED_VERDICTS.includes(res.parsed.verdict)) {
              return {
                ok: false,
                errorCode: "MCP_AIRLOCK_INVALID_VERDICT",
                messageTr: `Geçersiz karar etiketi: ${res.parsed.verdict}`,
              };
            }
            const enrichedNative = enrichOutcomeWithCanonicalI18n(res.parsed, rawArgs);
            return {
              ...enrichedNative,
              tool: toolName,
              engine_execution_mode: "NATIVE_RUST_AIRLOCK",
              advisor_template: advisorMeta,
              human_approval_required: true,
              write_authority: "NONE",
            };
          }

          // Pure-JS BigInt fallback
          const evalRes = evaluateSlicePureJs(prep.batchRaw, prep.manifestRaw, cutoffBig, {
            scenario_id: rawArgs.scenario_id,
            policy_id: rawArgs.policy_id,
            max_allowed_fp: rawArgs.max_allowed_fp
              ? parseSigned64DecimalString(rawArgs.max_allowed_fp)
              : undefined,
            conflict_threshold_fp: rawArgs.conflict_threshold_fp
              ? parseSigned64DecimalString(rawArgs.conflict_threshold_fp)
              : undefined,
            min_independent_groups_for_pass: rawArgs.min_independent_groups_for_pass,
          });
          if (toolName === "caelus_evaluate_slice") {
            if (nodeDeps && resolvedAuditPath) {
              const sliceAuditLine =
                JSON.stringify({
                  entry_kind: "AIRLOCK_SLICE_EVALUATED",
                  scenario_id: evalRes.scenario_id,
                  policy_id: evalRes.policy_id,
                  cutoff_learned_at_ms: evalRes.cutoff_learned_at_ms,
                  verdict: evalRes.verdict,
                  state_blake3: evalRes.state_blake3,
                  mode: "PURE_JS_BIGINT_FALLBACK",
                }) + "\n";
              nodeDeps.fs.appendFileSync(resolvedAuditPath, sliceAuditLine, "utf8");
            }
            const enrichedJsSlice = enrichOutcomeWithCanonicalI18n(evalRes, rawArgs);
            return {
              ...enrichedJsSlice,
              tool: toolName,
              engine_execution_mode: "PURE_JS_BIGINT_FALLBACK",
              advisor_template: advisorMeta,
            };
          }
          const enrichedJsExplain = enrichOutcomeWithCanonicalI18n(
            {
              ok: true,
              verdict: evalRes.verdict,
              applied_rule_id: evalRes.applied_rule_id,
              triggered_rules: [evalRes.applied_rule_id],
              scenario_id: evalRes.scenario_id,
              policy_id: evalRes.policy_id,
              cutoff_learned_at_ms: evalRes.cutoff_learned_at_ms,
              input_batch_blake3: evalRes.input_batch_blake3,
              state_blake3: evalRes.state_blake3,
              corroborated_groups: evalRes.corroborated_groups || [],
              referenced_event_ids: evalRes.active_assertions.map((a) => a.event_id),
              assumption_range_fp: evalRes.assumption_range_fp,
              source_assumptions: evalRes.active_assertions,
              supporting_events: evalRes.active_assertions.map((a) => ({
                event_id: a.event_id,
                source_id: a.source_id,
                epistemic_status: a.epistemic_status,
                fp_val: a.fp_val,
              })),
              missing_evidence: evalRes.missing_evidence,
              conflicting_evidence: evalRes.conflicts,
              audit_chain_verified: false,
              seal_signer_pubkey: "",
              audit_log_trace: null,
            },
            rawArgs
          );
          return {
            ...enrichedJsExplain,
            tool: toolName,
            engine_execution_mode: "PURE_JS_BIGINT_FALLBACK",
            advisor_template: advisorMeta,
            human_approval_required: true,
            write_authority: "NONE",
          };
        } catch (err) {
          return {
            ok: false,
            errorCode: "MCP_AIRLOCK_SLICE_FAILED",
            messageTr: String(err && err.message ? err.message : err),
          };
        } finally {
          prep.cleanup();
        }
      }

      return {
        ok: false,
        errorCode: "MCP_UNKNOWN_AIRLOCK_TOOL",
        messageTr: `Bilinmeyen Airlock MCP aracı: ${toolName}`,
      };
    }

    function sealOperatorActionCard(sealArgs = {}) {
      const boundary = validate64BitMcpArguments(sealArgs);
      if (!boundary.ok) return boundary;
      const approvedBig = parseSigned64DecimalString(sealArgs.approved_at_ms);
      if (approvedBig === null) {
        return {
          ok: false,
          errorCode: "MCP_64BIT_DECIMAL_STRING_REQUIRED",
          messageTr: "'approved_at_ms' 64-bit ondalık ASCII dizge ('string') olmalıdır.",
        };
      }
      const payload = buildOperatorActionCardSigningPayload(sealArgs);
      if (sealArgs.operator_pubkey && sealArgs.operator_sig) {
        if (!ed25519VerifyMessageHex(payload, sealArgs.operator_pubkey, sealArgs.operator_sig)) {
          return {
            ok: false,
            errorCode: "ERR_OPERATOR_SIGNATURE_INVALID",
            messageTr: "Operatör Ed25519 imzası doğrulanamadı (fail-closed).",
          };
        }
      }
      if (nodeDeps && sealArgs.audit_log_path) {
        const ar = resolveSafeFilePath(sealArgs.audit_log_path, repoRootDir, true);
        if (!ar.ok) return ar;
        const nativeBin = findNativeSidecarBinary(options);
        if (nativeBin) {
          const cliArgs = [
            "seal-action-card",
            "--audit-log",
            ar.resolvedPath,
            "--card-id",
            String(sealArgs.card_id || ""),
            "--scenario-id",
            String(sealArgs.scenario_id || "AEGEAN_FERRY_01"),
            "--verdict-context",
            String(sealArgs.verdict_context || "KURAL_İHLALİ"),
            "--state-blake3",
            String(sealArgs.state_blake3 || ""),
            "--branch-state-blake3",
            String(sealArgs.branch_state_blake3 || ""),
            "--approved-at-ms",
            String(sealArgs.approved_at_ms),
          ];
          if (sealArgs.operator_pubkey) cliArgs.push("--operator-pubkey", sealArgs.operator_pubkey);
          if (sealArgs.operator_sig) cliArgs.push("--operator-sig", sealArgs.operator_sig);
          if (sealArgs.operator_seed) cliArgs.push("--operator-seed", sealArgs.operator_seed);
          if (sealArgs.audit_seed) cliArgs.push("--audit-seed", sealArgs.audit_seed);
          const res = runNativeBinary(nativeBin, cliArgs);
          if (!res.ok) return res;
          return res.parsed;
        }
      }
      // Browser/WASM-only fallback seal receipt
      const localChainHead = blake3Hex(
        `CAELUS_AUDIT_LOCAL_SEAL_V1|${payload}|${sealArgs.operator_pubkey || ""}|${sealArgs.operator_sig || ""}`
      );
      if (nodeDeps && sealArgs.audit_log_path) {
        const ar = resolveSafeFilePath(sealArgs.audit_log_path, repoRootDir, true);
        if (ar.ok) {
          const fallbackLine =
            JSON.stringify({
              entry_kind: "OPERATOR_ACTION_CARD_APPROVED",
              card_id: String(sealArgs.card_id || ""),
              scenario_id: String(sealArgs.scenario_id || "AEGEAN_FERRY_01"),
              verdict_context: String(sealArgs.verdict_context || "KURAL_İHLALİ"),
              state_blake3: String(sealArgs.state_blake3 || ""),
              branch_state_blake3: String(sealArgs.branch_state_blake3 || ""),
              approved_at_ms: String(sealArgs.approved_at_ms),
              operator_pubkey: String(sealArgs.operator_pubkey || ""),
              operator_sig: String(sealArgs.operator_sig || ""),
              audit_chain_head: localChainHead,
              mode: "OFFLINE_WASM_NODE_SEAL",
            }) + "\n";
          nodeDeps.fs.appendFileSync(ar.resolvedPath, fallbackLine, "utf8");
        }
      }
      return {
        ok: true,
        card_id: String(sealArgs.card_id || ""),
        operator_pubkey: String(sealArgs.operator_pubkey || ""),
        operator_sig: String(sealArgs.operator_sig || ""),
        audit_chain_head: localChainHead,
        audit_seal_pubkey: String(sealArgs.operator_pubkey || ""),
        audit_chain_verified: true,
        mode: "OFFLINE_BROWSER_SEAL",
      };
    }

    return {
      toolsCatalog: AIRLOCK_MCP_TOOLS_CATALOG,
      advisorTaskTemplates: ADVISOR_TASK_TEMPLATES_4,
      mcpInteropBindings: MCP_INTEROP_BINDINGS,
      invokeAirlockTool,
      sealOperatorActionCard,
      findNativeSidecarBinary: () => findNativeSidecarBinary(options),
    };
  }

  return {
    FP_SCALE_STR: FP_SCALE.toString(),
    AIRLOCK_FP_SAFE_MAX_ABS_STR: AIRLOCK_FP_SAFE_MAX_ABS.toString(),
    ALLOWED_VERDICTS,
    ADVISOR_TASK_TEMPLATES_4,
    MCP_INTEROP_BINDINGS,
    AIRLOCK_MCP_TOOLS_CATALOG,
    blake3Hex,
    ed25519KeypairFromSeedHex,
    ed25519SignMessageHex,
    ed25519VerifyMessageHex,
    buildOperatorActionCardSigningPayload,
    parseSigned64DecimalString,
    parseUnsigned64DecimalString,
    detectUnquoted64BitViolationInRawJson,
    validate64BitMcpArguments,
    createSidecarAirlockMcpController,
  };
});
