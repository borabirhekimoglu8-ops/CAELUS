/**
 * CAELUS OS — Plugin ABI Contract  (include/plugin/caelus_plugin_abi.h)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * C ABI STABILITY GUARANTEE
 * ═══════════════════════════════════════════════════════════════════════════
 * This header is the ONLY file that external plugin authors must include.
 * It is intentionally pure C99 so it can be compiled by any C or C++
 * toolchain on any platform.  No C++ features, no STL, no exceptions.
 *
 * ABI versioning:  abi_version = (MAJOR << 16) | MINOR
 *   • MAJOR bump → breaking change; old plugins MUST be recompiled.
 *   • MINOR bump → additive only (new fields appended at the END of structs,
 *     new optional vtable fields defaulting to NULL).
 *
 * Air-gap guarantee:  The ABI itself performs no I/O.  All network/file
 * operations are initiated by the engine host, never by this header.
 *
 * Entry point:  Every plugin shared library (.dll / .so) must export one
 * symbol: `caelus_plugin_entry` (type CaelusPluginEntryFn).  The engine
 * calls it once at load time to obtain the VTable pointer.
 * ═══════════════════════════════════════════════════════════════════════════
 */

#ifndef CAELUS_PLUGIN_ABI_H
#define CAELUS_PLUGIN_ABI_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ─── ABI version ─────────────────────────────────────────────────────────── */

#define CAELUS_PLUGIN_ABI_MAJOR   1u
#define CAELUS_PLUGIN_ABI_MINOR   1u
#define CAELUS_PLUGIN_ABI_VERSION ((CAELUS_PLUGIN_ABI_MAJOR << 16u) | CAELUS_PLUGIN_ABI_MINOR)

/** Returns non-zero if the plugin ABI version is binary-compatible with the
 *  running engine. Major version must match; older minor versions remain
 *  compatible because additive fields are appended and checked before use. */
static inline int caelus_abi_compatible(uint32_t plugin_abi_version) {
    uint16_t plug_major = (uint16_t)(plugin_abi_version >> 16u);
    uint16_t plug_minor = (uint16_t)(plugin_abi_version & 0xFFFFu);
    return (plug_major == (uint16_t)CAELUS_PLUGIN_ABI_MAJOR) &&
           (plug_minor <= (uint16_t)CAELUS_PLUGIN_ABI_MINOR);
}

/** KEYMGMT callbacks were appended in ABI 1.1. Engines must not read those
 *  trailing function pointers from vtables advertising ABI 1.0. */
static inline int caelus_abi_has_keymgmt(uint32_t plugin_abi_version) {
    uint16_t plug_major = (uint16_t)(plugin_abi_version >> 16u);
    uint16_t plug_minor = (uint16_t)(plugin_abi_version & 0xFFFFu);
    return (plug_major == (uint16_t)CAELUS_PLUGIN_ABI_MAJOR) && (plug_minor >= 1u);
}

/* ─── Plugin class bitmask ────────────────────────────────────────────────── */

/** A plugin may implement one or more classes simultaneously. */
typedef enum CaelusPluginClass {
    CAELUS_PLUGIN_SOLVER    = 0x01u, /**< Computes optimal schedule from friction  */
    CAELUS_PLUGIN_CONNECTOR = 0x02u, /**< Pulls intel from external data sources   */
    CAELUS_PLUGIN_REPORTER  = 0x04u, /**< Formats and persists operational reports */
    CAELUS_PLUGIN_SCENARIO  = 0x08u, /**< Provides a causal graph / scenario pack  */
    CAELUS_PLUGIN_KEYMGMT   = 0x10u, /**< Protects/unprotects local identity seeds */
} CaelusPluginClass;

/* ─── Solver types ────────────────────────────────────────────────────────── */

/**
 * CaelusSolverRequest — inputs handed to a SOLVER plugin.
 * All time values are in whole minutes since 00:00.
 * friction_multiplier is pre-clamped to [1.0, 3.0].
 */
typedef struct CaelusSolverRequest {
    double   friction_multiplier;    /**< Clamped to [1.0, FRICTION_MULTIPLIER_MAX] */
    int32_t  task_start_min;         /**< Task starts (e.g. 360 = 06:00)             */
    int32_t  target_deadline_min;    /**< Target deadline (e.g. 480 = 08:00)         */
    int32_t  commit_overhead_min;    /**< Fixed overhead per completion cycle         */
    int32_t  base_transit_low_min;   /**< Minimum transit time at μ=1.0              */
    int32_t  base_transit_high_min;  /**< Maximum transit time at μ=1.0              */
} CaelusSolverRequest;

/**
 * CaelusSolverResult — outputs produced by a SOLVER plugin.
 * The engine consumes `arrival_min` and `completion_min` for deadline verdict.
 */
typedef struct CaelusSolverResult {
    int32_t  travel_low;         /**< Scaled lower band (minutes)                   */
    int32_t  travel_high;        /**< Scaled upper band (minutes)                   */
    int32_t  arrival_min;        /**< When the tracked item arrives (since 00:00)    */
    int32_t  completion_min;     /**< When the cycle completes (since 00:00)         */
    uint8_t  on_time;            /**< 1 = completion_min <= target_deadline_min      */
    uint8_t  feasible;           /**< 1 = solver found a valid solution              */
    uint8_t  regime_exceeded;    /**< 1 = friction demand was beyond model domain    */
    uint8_t  _pad;
    char     status_msg[64];     /**< Human-readable status (NUL-terminated ASCII)   */
} CaelusSolverResult;

/* ─── Connector types ─────────────────────────────────────────────────────── */

/**
 * CaelusIntelEvent — a single field-intelligence observation.
 * Produced by CONNECTOR plugins and injected into the engine's intel queue.
 */
typedef struct CaelusIntelEvent {
    double   friction_coeff;    /**< Observed friction [0.0, 1.0]            */
    uint8_t  crisis_level;      /**< 0=NOMINAL 1=ELEVATED 2=HIGH 3=CRITICAL  */
    uint8_t  _pad[7];
    char     memo[128];         /**< Bounded ASCII memo (NUL-terminated)      */
    uint64_t source_slot_id;    /**< OTP slot ID of the reporting device       */
    uint64_t observed_at_tick;  /**< Engine tick when observation was made     */
} CaelusIntelEvent;

/* ─── Reporter types ──────────────────────────────────────────────────────── */

/**
 * CaelusReportPayload — summary of one completed engine cycle.
 * Passed to REPORTER plugins after RunOptimizationCycle completes.
 */
typedef struct CaelusReportPayload {
    char     scenario_id[64];   /**< Active scenario identifier (NUL-terminated) */
    double   final_friction;    /**< Friction multiplier used by the solver       */
    int32_t  completion_min;    /**< Solver's completion time                     */
    uint8_t  on_time;           /**< 1 = OTP met                                 */
    uint8_t  regime_exceeded;   /**< 1 = friction domain was violated             */
    uint8_t  _pad[2];
    uint64_t tick_nr;           /**< Monotonic engine cycle counter               */
} CaelusReportPayload;

/* ─── KEYMGMT types (ABI minor 1+) ────────────────────────────────────────── */

/** Format tag for CaelusKeyBlob::format. Providers may add private tags. */
typedef enum CaelusKeyBlobFormat {
    CAELUS_KEY_BLOB_RAW_SEED         = 0x00000001u, /**< 32-byte raw identity seed, memory only */
    CAELUS_KEY_BLOB_PROTECTED_OS     = 0x00000002u, /**< OS-protected blob (e.g. DPAPI)          */
    CAELUS_KEY_BLOB_PROTECTED_TPM    = 0x00000003u, /**< TPM-sealed blob or handle wrapper       */
    CAELUS_KEY_BLOB_PROTECTED_PLUGIN = 0x00000004u, /**< Provider-defined protected format       */
} CaelusKeyBlobFormat;

/**
 * CaelusKeyBlob — bounded caller-owned key buffer.
 *
 * For input blobs: data points to len readable bytes; capacity is ignored.
 * For output blobs: caller allocates data/capacity; provider writes at most
 * capacity bytes and sets len to bytes written. If capacity is too small, the
 * provider returns 0 and may set len to the required size.
 *
 * Security contract:
 *   - Plaintext seeds are passed only in memory and must not be persisted by
 *     the engine as raw bytes.
 *   - KEYMGMT providers implement platform protection (DPAPI, TPM, enclave,
 *     or an audited air-gapped equivalent) behind this ABI.
 *   - The caller owns zeroization of plaintext buffers after use; providers
 *     must not retain pointers to caller buffers.
 */
typedef struct CaelusKeyBlob {
    uint8_t* data;
    size_t   len;
    size_t   capacity;
    uint32_t format;
    uint32_t flags;
} CaelusKeyBlob;

/* ─── Engine service functions (engine → plugin callbacks) ───────────────── */

/**
 * CaelusEngineFns — the set of engine capabilities made available to plugins.
 * Every plugin receives a pointer to this struct during `init` and may cache
 * it for use in subsequent callbacks.  The engine guarantees the struct
 * outlives any plugin that received it.
 *
 * All functions are optional: a NULL pointer means the capability is not
 * available in this engine build (e.g. emit_json is NULL when WS is disabled).
 */
typedef struct CaelusEngineFns {
    /** Opaque engine instance (do not dereference directly). */
    void* engine_ctx;

    /** Emit a JSON line to the War Room telemetry stream.
     *  payload MUST be a single-line JSON object (no embedded newlines).
     *  Returns 1 on success, 0 if the WS emitter is not running.
     *  Thread-safe. */
    uint8_t (*emit_json)(void* engine_ctx, const char* json_line);

    /** Inject a field intel event into the engine's intel queue.
     *  Called by CONNECTOR plugins to push external data into the engine.
     *  friction_coeff clamped to [0,1]; crisis_level clamped to [0,3].
     *  memo must be ≤127 bytes UTF-8 (not NUL-assumed).
     *  Returns 1 on success. Thread-safe. */
    uint8_t (*inject_intel)(void* engine_ctx,
                            double  friction_coeff,
                            uint8_t crisis_level,
                            const char* memo,
                            size_t      memo_len);

    /** Read the current monotonic engine tick counter.
     *  In --det-mode this returns the virtual clock tick.
     *  Thread-safe (atomic load). */
    uint64_t (*current_tick)(void* engine_ctx);
} CaelusEngineFns;

/* ─── The Plugin VTable (main contract) ──────────────────────────────────── */

/**
 * CaelusPluginVTable — the binary contract between the engine and a plugin.
 *
 * Layout rules (ABI stability):
 *   1. Existing fields MUST NOT be reordered or resized.
 *   2. New fields are APPENDED at the end of the struct.
 *   3. The engine always checks `abi_version` before accessing any field.
 *   4. All function pointers MAY be NULL; the engine skips NULL callbacks.
 *   5. Class-specific methods (`solve`, `pull_intel`, `report`) SHOULD be NULL
 *      for plugin classes that do not implement them.
 *
 * Memory ownership:
 *   • `name` and `version` point to static storage (plugin's .rodata).
 *     The engine never frees them.
 *   • `plugin_state` (passed to each callback) is owned by the plugin.
 *     The engine never allocates or frees it; `init` sets it up,
 *     `cleanup` tears it down.
 */
typedef struct CaelusPluginVTable {
    /* ── Identification ────────────────────────────────────────── */
    uint32_t    abi_version;   /**< Must equal CAELUS_PLUGIN_ABI_VERSION      */
    uint32_t    plugin_class;  /**< Bitmask of CaelusPluginClass values        */
    const char* name;          /**< Human-readable name (static, UTF-8)        */
    const char* version;       /**< SemVer string "MAJOR.MINOR.PATCH" (static) */

    /* ── Lifecycle ──────────────────────────────────────────────── */
    /**
     * init — called once when the plugin is registered.
     * @param plugin_state  Opaque pointer for plugin-owned state.  The engine
     *                      passes the same pointer to all subsequent callbacks.
     *                      Stateless plugins may set this to NULL.
     * @param fns           Engine service functions; valid for plugin lifetime.
     * @return 1 on success; 0 on failure (plugin will NOT be registered).
     */
    uint8_t (*init)(void* plugin_state, const CaelusEngineFns* fns);

    /**
     * cleanup — called once at engine shutdown (or plugin unregistration).
     * Must release all plugin-owned resources.  NULL = no cleanup needed.
     */
    void (*cleanup)(void* plugin_state);

    /* ── Event dispatch (all plugin classes) ───────────────────── */
    /**
     * on_tick — called once per engine cycle.
     * tick_nr is monotonically increasing (0-based).
     * Returns 1 to continue receiving ticks; 0 to self-unregister.
     * NULL = plugin does not handle ticks.
     */
    uint8_t (*on_tick)(void* plugin_state, uint64_t tick_nr);

    /**
     * on_intel — called when the engine processes an intel packet.
     * pkt points to the packet; valid only for the duration of the call.
     * NULL = plugin does not handle intel events.
     */
    uint8_t (*on_intel)(void* plugin_state, const CaelusIntelEvent* evt);

    /* ── SOLVER-specific ─────────────────────────────────────────── */
    /**
     * solve — compute the optimal schedule (SOLVER class only).
     * req  → input constraints (pre-clamped friction, time windows).
     * out  → result struct to be filled by the plugin.
     * Returns 1 on success, 0 on failure (engine uses fallback solver).
     * NULL → not a solver plugin.
     *
     * IMPORTANT: This function MUST be stateless and re-entrant.
     *            The engine may call it from any thread.
     */
    uint8_t (*solve)(const CaelusSolverRequest* req, CaelusSolverResult* out);

    /* ── CONNECTOR-specific ──────────────────────────────────────── */
    /**
     * pull_intel — drain pending events from an external source (CONNECTOR).
     * out_events  → caller-allocated array of max_events CaelusIntelEvent.
     * out_count   → filled with the number of events actually written (≤max).
     * Returns 1 if at least one event was returned, 0 if the source is empty.
     * NULL → not a connector plugin.
     */
    uint8_t (*pull_intel)(void*              plugin_state,
                          CaelusIntelEvent*  out_events,
                          size_t             max_events,
                          size_t*            out_count);

    /* ── REPORTER-specific ───────────────────────────────────────── */
    /**
     * report — emit a formatted operational report (REPORTER).
     * payload     → summary of the completed engine cycle.
     * output_path → filesystem path (UTF-8) or NULL for stdout/default sink.
     * Returns 1 on success, 0 on failure (engine logs a warning).
     * NULL → not a reporter plugin.
     */
    uint8_t (*report)(void*                    plugin_state,
                      const CaelusReportPayload* payload,
                      const char*              output_path);

    /* ── KEYMGMT-specific (ABI minor version 1+) ─────────────────── */
    /**
     * protect_key — convert a memory-only raw seed into a protected blob.
     *
     * Typical providers:
     *   - Windows plugin: CryptProtectData / DPAPI.
     *   - POSIX plugin: TPM-sealed blob or externally provisioned secure store.
     *
     * This ABI deliberately does not define a plaintext disk fallback. The
     * Rust identity path can later call the registered KEYMGMT plugin through
     * the engine host instead of writing raw `caelus_identity.key` bytes.
     *
     * Returns 1 on success, 0 on failure or insufficient output capacity.
     */
    uint8_t (*protect_key)(void* plugin_state,
                           const CaelusKeyBlob* plaintext,
                           CaelusKeyBlob* protected_out);

    /**
     * unprotect_key — recover a raw seed into caller-owned memory.
     *
     * The caller must zeroize plaintext_out->data after deriving the signing
     * key. Providers must not persist or retain the recovered plaintext.
     *
     * Returns 1 on success, 0 on failure or insufficient output capacity.
     */
    uint8_t (*unprotect_key)(void* plugin_state,
                             const CaelusKeyBlob* protected_in,
                             CaelusKeyBlob* plaintext_out);

    /* ── Extensibility ───────────────────────────────────────────── */
    /* Future fields appended here; old engines skip them safely.     */
} CaelusPluginVTable;

/* ─── Plugin entry point ──────────────────────────────────────────────────── */

/**
 * Every plugin shared library MUST export this symbol.
 * The engine calls it once after loading the library.
 * Returns a pointer to a STATIC VTable (no heap allocation required).
 *
 * C declaration:
 *   const CaelusPluginVTable* caelus_plugin_entry(void);
 *
 * Rust #[no_mangle]:
 *   pub extern "C" fn caelus_plugin_entry() -> *const CaelusPluginVTable
 */
#define CAELUS_PLUGIN_ENTRY_SYMBOL "caelus_plugin_entry"

typedef const CaelusPluginVTable* (*CaelusPluginEntryFn)(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* CAELUS_PLUGIN_ABI_H */
