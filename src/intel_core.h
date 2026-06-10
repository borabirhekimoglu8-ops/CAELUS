/**
 * CAELUS OS — Intel-Core Operational Risk & Friction Module
 * Air-Gapped, deterministic operational-risk modelling.
 *
 * SCOPE / ETHICS NOTE
 * ───────────────────
 * This module models *operational* friction from OBSERVABLE, domain-agnostic
 * factors (regulatory/permit overhead, historical delay rates, actor-action
 * probability, route congestion, environmental severity). It deliberately
 * does NOT profile named individuals
 * and contains no pseudo-scientific "psychological"/astrological scoring — those
 * were removed because they were indefensible and a legal/privacy liability.
 *
 * Optional encrypted profile blobs are loaded with a real, self-tested AES-256
 * implementation (FIPS-197 known-answer test at startup). No secret key is
 * hard-coded; the key comes from the CAELUS_ENCLAVE_KEY environment variable
 * (64 hex chars) or, if unset, an ephemeral CSPRNG key (clearly flagged as an
 * unconfigured enclave).
 *
 * Toolchain: C++17
 */

#ifndef CAELUS_INTEL_CORE_H
#define CAELUS_INTEL_CORE_H

#include <string>
#include <vector>
#include <cstdint>
#include <memory>

namespace caelus {
namespace intel {

    /// Upper bound for the friction multiplier handed to the optimiser. Caps the
    /// blast radius of any single input so the constraint model can never receive
    /// an out-of-range / domain-breaking value.
    constexpr double FRICTION_MULTIPLIER_MIN = 1.0;
    constexpr double FRICTION_MULTIPLIER_MAX = 3.0;

    /**
     * @brief Operational risk profile of a domain-agnostic scenario (NOT a person).
     * All vectors are normalized 0.0–1.0 and describe observable conditions.
     */
    struct OperationalRiskProfile {
        std::string scenario_id;   // e.g. "UNIVERSAL_BASELINE"
        std::string region;        // e.g. "UNIVERSAL" (sektör-agnostik)

        double bureaucratic_complexity;   // regulatory / permit / inspection overhead
        double historical_delay_rate;     // share of past runs that missed the deadline
        double labor_action_probability;  // actor slowdown / disruption likelihood
        double route_congestion;          // transit / approach congestion load
        double weather_severity;          // environmental friction
    };

    /**
     * @brief Loads operational risk profiles and evaluates a friction multiplier.
     *
     * Profiles may be supplied as AES-256-CBC-encrypted blobs under profiles/.
     * When none is present, deterministic built-in baselines are used (and this is
     * stated honestly in the log — there is no fake "decryption succeeded" output).
     */
    class ProfileManager {
    public:
        ProfileManager();
        ~ProfileManager();

        /// True if the AES-256 self-test (FIPS-197 KAT + CBC round-trip) passed.
        bool CryptoSelfTestPassed() const;

        /// Human-readable enclave key provenance ("env-provided" / "ephemeral").
        const std::string& EnclaveMode() const;

        /**
         * @brief Load an operational profile by scenario id. If an encrypted blob
         * profiles/<scenario_id>.bin exists and the enclave is healthy, it is
         * decrypted with real AES-256; otherwise a built-in baseline is returned.
         */
        std::unique_ptr<OperationalRiskProfile> LoadProfile(const std::string& scenario_id);

        /**
         * @brief Deterministic friction multiplier from operational factors.
         * Always returns a value clamped to [FRICTION_MULTIPLIER_MIN, MAX].
         *
         * @param profile          Operational risk profile to evaluate.
         * @param regime_exceeded  Optional: set to true when the raw (unclamped)
         *                         multiplier exceeds FRICTION_MULTIPLIER_MAX, i.e.
         *                         the scenario is outside the model's defined domain.
         * @param raw_out          Optional: receives the raw (unclamped) multiplier
         *                         for upstream WS telemetry / logging.
         */
        double CalculateFrictionMultiplier(const OperationalRiskProfile& profile,
                                           bool*   regime_exceeded = nullptr,
                                           double* raw_out         = nullptr) const;

        // ── Real AES-256-CBC (PKCS#7) — usable for provisioning/decryption ──
        /// Encrypt: prepends a random 16-byte IV. Returns empty on error.
        std::vector<uint8_t> EncryptCBC(const std::vector<uint8_t>& plaintext) const;
        /// Decrypt: expects leading IV; strips PKCS#7. Returns empty on error.
        std::vector<uint8_t> DecryptCBC(const std::vector<uint8_t>& ciphertext) const;

    private:
        struct AesContext;
        std::unique_ptr<AesContext> aes_ctx_;
        bool crypto_ok_ = false;
        std::string enclave_mode_ = "uninitialized";

        /// Acquire the key (env or ephemeral), run the self-test, expand the key.
        void InitializeSecureEnclave();

        /// FIPS-197 AES-256 known-answer test (proves the cipher is correct).
        static bool RunAes256Kat();

        /// Built-in deterministic baseline for a scenario id.
        OperationalRiskProfile BuiltinBaseline(const std::string& scenario_id) const;
    };

} // namespace intel
} // namespace caelus

#endif // CAELUS_INTEL_CORE_H
