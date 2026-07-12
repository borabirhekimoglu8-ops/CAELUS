/**
 * CAELUS Mobile — Stable C ABI  (include/mobile/caelus_mobile.h)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The ONLY supported boundary between platform hosts (SwiftUI on iOS, test
 * drivers on Linux/macOS/Windows) and the shared CAELUS core (C++ causal
 * engine + Rust security/audit staticlib).
 *
 * ABI contract (version 1):
 *   • Pure C99 header: fixed-width integers, opaque handles, explicit buffer
 *     lengths.  No C++ types, no exceptions, no Rust panics cross this line.
 *   • Every function returns an explicit int32_t status code (CAELUS_MOBILE_OK
 *     or a negative CAELUS_MOBILE_E_* value), except create (returns handle +
 *     out-status) and destroy (void, NULL-safe).
 *   • Output buffers use the two-call pattern: call with output=NULL or a
 *     too-small capacity → status CAELUS_MOBILE_E_BUFFER_TOO_SMALL and
 *     *out_len set to the exact required byte count; call again with a large
 *     enough buffer → CAELUS_MOBILE_OK and *out_len set to bytes written.
 *     Output is NOT NUL-terminated unless stated.
 *   • A handle is NOT thread-safe. The host must serialise all calls on one
 *     handle (the Swift EngineController actor enforces this).  Concurrent
 *     entry is detected and rejected with CAELUS_MOBILE_E_BUSY.
 *   • Handles are tracked in a process-wide liveness registry: calls on a
 *     destroyed or foreign pointer return CAELUS_MOBILE_E_HANDLE, a second
 *     destroy is a safe no-op, and destroy never frees a handle while a
 *     call is executing on it.  Hosts must still treat the handle as dead
 *     after destroy — the registry is a containment layer, not a lifetime
 *     manager.
 *   • If an unaudited neural mutation cannot be rolled back, the handle
 *     latches POISONED: every subsequent call except destroy/last_error
 *     returns CAELUS_MOBILE_E_POISONED.  The desktop binary fail-stops the
 *     process in the same situation; a mobile app must not crash the host
 *     process, so the poisoned latch is the iOS equivalent.
 *
 * Trust boundaries (identical to desktop; the bridge adds NO bypasses):
 *   • Scenario bytes pass the pinned ed25519 signature gate before parsing
 *     applies them.  Neural authority additionally requires sig_status
 *     "VERIFIED" (pinned production anchor), not dev bypass statuses.
 *   • Neural model buffers pass the pinned neural trust-anchor chain
 *     (signature over exact raw bytes before JSON parsing).
 *   • Audit chain is Blake3-linked NDJSON, ed25519-sealed on destroy/seal.
 *   • Checkpoints are integrity-hashed and bound to the loaded, verified
 *     scenario (topology binding); they are NOT independently signed in V1 —
 *     see docs/CAELUS_MOBILE_ARCHITECTURE.md for the exact threat model.
 * ═══════════════════════════════════════════════════════════════════════════
 */
#ifndef CAELUS_MOBILE_H
#define CAELUS_MOBILE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── Versioning ──────────────────────────────────────────────────────────── */

#define CAELUS_MOBILE_ABI_VERSION UINT32_C(1)

/* ── Status codes ────────────────────────────────────────────────────────── */

enum {
    CAELUS_MOBILE_OK                        = 0,
    CAELUS_MOBILE_E_INVALID_ARGUMENT        = -1,
    CAELUS_MOBILE_E_ABI_MISMATCH            = -2,
    CAELUS_MOBILE_E_ALLOCATION              = -3,
    CAELUS_MOBILE_E_LIFECYCLE               = -4,  /* wrong call order        */
    CAELUS_MOBILE_E_SCENARIO_REJECTED       = -5,  /* signature/parse failure */
    CAELUS_MOBILE_E_MODEL_REJECTED          = -6,  /* trust chain failure     */
    CAELUS_MOBILE_E_BUFFER_TOO_SMALL        = -7,
    CAELUS_MOBILE_E_LEVER_UNKNOWN           = -8,
    CAELUS_MOBILE_E_LEVER_UNAVAILABLE       = -9,  /* lockout / disabled      */
    CAELUS_MOBILE_E_AUDIT_FAILURE           = -10,
    CAELUS_MOBILE_E_CHECKPOINT_INVALID      = -11, /* corrupt / bad integrity */
    CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE = -12, /* wrong scenario/version  */
    CAELUS_MOBILE_E_INTERNAL                = -13, /* contained C++ exception */
    CAELUS_MOBILE_E_POISONED                = -14, /* fail-stop latched       */
    CAELUS_MOBILE_E_UTF8                    = -15,
    CAELUS_MOBILE_E_LIMIT                   = -16, /* input over size limit   */
    CAELUS_MOBILE_E_HANDLE                  = -17, /* magic check failed      */
    CAELUS_MOBILE_E_BUSY                    = -18  /* concurrent entry        */
};

/* ── Input size limits (bytes) ───────────────────────────────────────────── */

#define CAELUS_MOBILE_MAX_SCENARIO_BYTES   (4u * 1024u * 1024u)
#define CAELUS_MOBILE_MAX_MANIFEST_BYTES   (64u * 1024u)
#define CAELUS_MOBILE_MAX_WEIGHTS_BYTES    (16u * 1024u * 1024u)
#define CAELUS_MOBILE_MAX_SIGNATURE_BYTES  (512u)
#define CAELUS_MOBILE_MAX_CHECKPOINT_BYTES (16u * 1024u * 1024u)
#define CAELUS_MOBILE_MAX_LEVER_ID_BYTES   (256u)
#define CAELUS_MOBILE_MAX_TICKS_PER_CALL   (10000u)

/* ── Engine configuration flags ──────────────────────────────────────────── */

/** Enable deterministic fixed-point neural assurance (requires a verified
 *  scenario, a signed model package, and an open audit chain). */
#define CAELUS_MOBILE_FLAG_NEURAL_ASSURANCE UINT32_C(0x00000001)
/** Measure wall-clock inference duration (telemetry only — NOT part of any
 *  deterministic output; disable for bit-exact replay comparisons). */
#define CAELUS_MOBILE_FLAG_MEASURE_TIMING   UINT32_C(0x00000002)

/* ── App lifecycle phases (audited) ──────────────────────────────────────── */

enum {
    CAELUS_MOBILE_LIFECYCLE_BACKGROUND = 1,
    CAELUS_MOBILE_LIFECYCLE_FOREGROUND = 2,
    CAELUS_MOBILE_LIFECYCLE_TERMINATING = 3
};

/* ── Opaque handle ───────────────────────────────────────────────────────── */

typedef struct CaelusMobileEngine CaelusMobileEngine;

/* ── Platform key protection (Keychain / Secure Enclave hook) ────────────── */

/**
 * Bounded caller-owned key buffer — bit-compatible with the engine-wide
 * CaelusKeyBlob (include/plugin/caelus_plugin_abi.h) and its Rust mirror.
 * For inputs `data` points to `len` readable bytes; for outputs the caller
 * sets `capacity` and the provider writes `len` (≤ capacity) bytes plus the
 * resulting `format` tag.
 */
typedef struct {
    uint8_t* data;
    size_t len;
    size_t capacity;
    uint32_t format;
    uint32_t flags;
} CaelusMobileKeyBlob;

/** Format tag of a plaintext 32-byte identity seed. */
#define CAELUS_MOBILE_KEY_BLOB_RAW_SEED UINT32_C(0x00000001)

/** Callback result contract: return 1 for success, anything else fails. */
typedef uint8_t (*CaelusMobileKeyProtectFn)(
    void* state,
    const CaelusMobileKeyBlob* plaintext,
    CaelusMobileKeyBlob* protected_out);
typedef uint8_t (*CaelusMobileKeyUnprotectFn)(
    void* state,
    const CaelusMobileKeyBlob* protected_in,
    CaelusMobileKeyBlob* plaintext_out);

/**
 * Register the PROCESS-WIDE platform key-protection delegate.  Must be
 * called BEFORE the first caelus_mobile_engine_create_v1 so the device
 * identity seed is persisted only in platform-protected form (on iOS the
 * delegate wraps the seed with a Keychain/Secure Enclave-guarded key; raw
 * seed bytes stay inside the native callback and are never handed to UI
 * code as API surface).
 *
 * Both callbacks non-NULL installs the delegate; both NULL clears it
 * (reverting to the built-in platform fallback, which on iOS/POSIX refuses
 * plaintext persistence).  Exactly one NULL is rejected.  `state` is passed
 * back verbatim to every callback and must outlive the registration.
 */
int32_t caelus_mobile_register_key_protection_v1(
    CaelusMobileKeyProtectFn protect_fn,
    CaelusMobileKeyUnprotectFn unprotect_fn,
    void* state);

/* ── Configuration ───────────────────────────────────────────────────────── */

typedef struct {
    /** Must be sizeof(CaelusMobileEngineConfigV1). */
    uint32_t struct_size;
    /** Must be CAELUS_MOBILE_ABI_VERSION. */
    uint32_t abi_version;
    /** CAELUS_MOBILE_FLAG_* bit set. */
    uint32_t flags;
    uint32_t reserved;
    /** Engine PRNG seed for deterministic lever evaluation.
     *  0 = time/tick derived (production non-replayable). */
    uint64_t deterministic_seed;
    /** Audit session identity. 0 = derive from wall clock (unique, not
     *  deterministic).  Deterministic tests must pass an explicit value. */
    uint64_t session_id;
    /** Directory for the append-only audit chain (UTF-8, no NUL, must exist
     *  and be writable — on iOS pass an app-sandbox path). Required. */
    const uint8_t* audit_directory_utf8;
    size_t audit_directory_len;
    /** Path of the persistent device identity file (created on first use).
     *  Required.  On iOS place it in an app-sandbox path protected with
     *  NSFileProtectionCompleteUntilFirstUserAuthentication. */
    const uint8_t* identity_path_utf8;
    size_t identity_path_len;
} CaelusMobileEngineConfigV1;

/* ── Lifecycle ───────────────────────────────────────────────────────────── */

/** Runtime ABI version of the linked bridge (compare before create). */
uint32_t caelus_mobile_abi_version_v1(void);

/**
 * Create an engine session.  Opens the audit chain (SESSION_START is the
 * first event) and loads/creates the device identity.
 * Returns NULL on failure with *out_status set (if out_status non-NULL).
 */
CaelusMobileEngine* caelus_mobile_engine_create_v1(
    const CaelusMobileEngineConfigV1* config,
    int32_t* out_status);

/**
 * Destroy the engine.  Seals the audit chain (SESSION_END + ed25519 seal)
 * and frees all native resources.  NULL-safe.  A second destroy of the
 * same pointer is detected via the liveness registry and ignored; a
 * destroy while another call is executing refuses to free (the host broke
 * the serialisation contract — leaking is the only memory-safe response).
 */
void caelus_mobile_engine_destroy_v1(CaelusMobileEngine* engine);

/* ── Scenario ────────────────────────────────────────────────────────────── */

/**
 * Verify + load a signed scenario package from bytes (UTF-8 JSON).
 * Allowed exactly once per handle, before any tick/checkpoint call.
 * On success the causal graph is applied and SCENARIO_ACTIVATED is audited;
 * on rejection the engine stays in the blank pre-scenario state and
 * SCENARIO_REJECTED is audited.
 */
int32_t caelus_mobile_load_scenario_v1(
    CaelusMobileEngine* engine,
    const uint8_t* scenario_json_utf8,
    size_t scenario_json_len);

/* ── Neural model ────────────────────────────────────────────────────────── */

/**
 * Verify + load a signed deterministic neural model package from buffers
 * (manifest.json bytes, weights.bin bytes, model.sig bytes).
 * Requires: CAELUS_MOBILE_FLAG_NEURAL_ASSURANCE, a loaded scenario whose
 * signature status is the pinned production anchor ("VERIFIED"), and no
 * ticks executed yet.  On rejection the engine continues symbolic-only and
 * NEURAL_MODEL_REJECTED is audited (fail-closed, never fail-open).
 */
int32_t caelus_mobile_load_neural_model_v1(
    CaelusMobileEngine* engine,
    const uint8_t* manifest_bytes,
    size_t manifest_len,
    const uint8_t* weights_bytes,
    size_t weights_len,
    const uint8_t* signature_bytes,
    size_t signature_len);

/* ── Simulation ──────────────────────────────────────────────────────────── */

/**
 * Advance the engine tick_count ticks (1..CAELUS_MOBILE_MAX_TICKS_PER_CALL).
 * Each tick: scheduled scenario intel is injected, the causal engine
 * propagates one step, the neural observer records history, and (when a
 * trusted model is active) the audited neural tick sequence runs through
 * the shared runner — identical ordering to the desktop host.
 */
int32_t caelus_mobile_tick_v1(
    CaelusMobileEngine* engine,
    uint32_t tick_count);

/**
 * Apply a scenario lever by identifier (raw bytes, NOT NUL-terminated).
 * *out_success (required) receives 1 if the lever succeeded, 0 if the
 * deterministic roll failed (the failure outcome was applied).
 * Distinguishes unknown levers (E_LEVER_UNKNOWN) from levers in lockout or
 * disabled (E_LEVER_UNAVAILABLE).  The application is audited.
 */
int32_t caelus_mobile_apply_lever_v1(
    CaelusMobileEngine* engine,
    const uint8_t* lever_id,
    size_t lever_id_len,
    uint8_t* out_success);

/* ── State export ────────────────────────────────────────────────────────── */

/**
 * Serialize the full operational state as versioned JSON
 * (type CAELUS_MOBILE_SNAPSHOT_V1): engine scalars, per-node
 * authoritative/reported/trust fixed-point values, edges, levers,
 * hysteresis, neural evidence of the most recent tick, scenario and model
 * identity, and audit chain status.  All fixed-point values are emitted as
 * integers (scale 1e6) — presentation layers divide for display only.
 */
int32_t caelus_mobile_snapshot_json_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len);

/* ── Checkpoint / restore ────────────────────────────────────────────────── */

/**
 * Serialize a resumable checkpoint (type CAELUS_MOBILE_CHECKPOINT_V1).
 * Binds: format version, engine version, ABI version, scenario id + hash,
 * model hash (when loaded), neural mode, tick, session id, audit chain head
 * + entry count, complete engine state (graph + runtime + PRNG seed), and a
 * Blake3 integrity hash over the canonical payload.  CHECKPOINT_CREATED is
 * audited.
 */
int32_t caelus_mobile_checkpoint_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len);

/**
 * Restore a checkpoint produced by caelus_mobile_checkpoint_v1.
 * Requires the SAME verified scenario to be loaded first; validates format
 * version, engine version, integrity hash, scenario hash binding, topology
 * binding against the signed scenario (node/edge/lever/loop/hysteresis
 * identifiers and static parameters), and engine structural invariants.
 * Ticks must not have been executed on this handle yet.
 * On success the engine adopts the checkpoint state, neural temporal history
 * restarts with explicit missing-data masks (history is re-observed, never
 * fabricated), and CHECKPOINT_RESTORED is audited with the prior chain head.
 */
int32_t caelus_mobile_restore_checkpoint_v1(
    CaelusMobileEngine* engine,
    const uint8_t* checkpoint_bytes,
    size_t checkpoint_len);

/* ── Audit ───────────────────────────────────────────────────────────────── */

/** UTF-8 path of the active audit segment file (two-call pattern). */
int32_t caelus_mobile_audit_path_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len);

/**
 * Audit chain status as compact JSON:
 * {"open":bool,"sealed":bool,"entries":u64,"chain_head":"hex64",
 *  "session_id":"hex16"}.
 * `open` = the chain context is live (export/read possible);
 * `sealed` = the SEAL line has been written — no further events accepted.
 */
int32_t caelus_mobile_audit_status_json_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len);

/**
 * Read back the full audit NDJSON for export (two-call pattern; bounded by
 * CAELUS_MOBILE_MAX_CHECKPOINT_BYTES).  Reads the current segment file from
 * disk; REPORT_EXPORTED is audited AFTER the read, so the exported bytes
 * verify cleanly up to their own last line.
 */
int32_t caelus_mobile_export_audit_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len);

/** Append an APP_LIFECYCLE audit event (phase = CAELUS_MOBILE_LIFECYCLE_*). */
int32_t caelus_mobile_note_lifecycle_v1(
    CaelusMobileEngine* engine,
    uint32_t phase);

/** Seal the audit chain now (idempotent).  After sealing, further audited
 *  operations fail with CAELUS_MOBILE_E_AUDIT_FAILURE; use before final
 *  export when the session is complete. */
int32_t caelus_mobile_seal_session_v1(CaelusMobileEngine* engine);

/* ── Error reporting ─────────────────────────────────────────────────────── */

/**
 * Human-readable description of the most recent failure on this handle
 * (UTF-8, two-call pattern).  Never fails on a poisoned handle — this and
 * destroy are the only calls that still work.
 */
int32_t caelus_mobile_last_error_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len);

/* ── Crypto helpers for platform layers ──────────────────────────────────── */

/**
 * Blake3 hash of data into out_hash32 (32 bytes).  Stateless; used by the
 * Swift layer to verify Core ML advisory package blobs against their signed
 * manifests without re-implementing hashing.
 */
int32_t caelus_mobile_blake3_v1(
    const uint8_t* data,
    size_t data_len,
    uint8_t* out_hash32);

/**
 * Verify an ed25519 model-package signature (domain CAELUS_NEURAL_MODEL_V1:
 * manifest Blake3 + blob Blake3) against the COMPILED-IN neural trust
 * anchor.  Stateless.  Returns CAELUS_MOBILE_OK only for a valid signature
 * by the pinned key — arbitrary caller-supplied keys are deliberately NOT
 * accepted.  Used for Core ML advisory packages, which share the signing
 * scheme with deterministic assurance packages.
 */
int32_t caelus_mobile_verify_model_signature_v1(
    const uint8_t* manifest_hash32,
    const uint8_t* blob_hash32,
    const uint8_t* signature64);

/**
 * COMPILED-IN public trust anchors as compact JSON (two-call pattern):
 * {"type":"CAELUS_MOBILE_TRUST_ANCHORS_V1","abi_version":u32,
 *  "engine_version":"…","scenario_pubkey":"hex64","neural_pubkey":"hex64"}.
 * Stateless; PUBLIC key material only.  The Swift trust screen renders
 * these values so the UI can never drift from what the binary enforces.
 */
int32_t caelus_mobile_trusted_anchors_json_v1(
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* CAELUS_MOBILE_H */
