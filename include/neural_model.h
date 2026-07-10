/**
 * CAELUS OS — Signed deterministic neural model package V1.
 *
 * Package layout (fixed filenames, no manifest-controlled paths):
 *   manifest.json  UTF-8 strict JSON, <= 64 KiB
 *   weights.bin    versioned little-endian data-only tensor blob, <= 16 MiB
 *   model.sig      ed25519:<pubkey-hex>:<signature-hex>
 *
 * Signature domain is constructed inside Rust:
 *   CAELUS_NEURAL_MODEL_V1\0 || blake3(manifest bytes) || blake3(weights bytes)
 *
 * Trust failure disables the neural layer; it never weakens scenario/plugin/
 * intel/audit gates and never grants direct access to symbolic state.
 */
#pragma once

#include <array>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

#include "neural_contract.h"
#include "scenario_pack.h" // bounded strict JSON parser shared with scenario packs

#ifndef CAELUS_NEURAL_TRUSTED_PUBKEY_HEX
#define CAELUS_NEURAL_TRUSTED_PUBKEY_HEX \
    "0ec496d12fa6fdd536d7978741d5f002631b70e55da0ee5ce49b72261f8e4db2"
#endif

extern "C" {
uint8_t caelus_blake3_hash(const uint8_t* data, size_t data_len, uint8_t* out_hash32);
uint8_t caelus_verify_neural_model_signature(
    const uint8_t* manifest_hash32,
    const uint8_t* weights_hash32,
    const uint8_t* public_key32,
    const uint8_t* signature64);
}

namespace caelus::neural {

static constexpr size_t kMaxManifestBytesV1 = 64u * 1024u;
static constexpr size_t kMaxWeightsBytesV1 = 16u * 1024u * 1024u;
static constexpr size_t kWeightsHeaderBytesV1 = 48u;
static constexpr uint32_t kWeightsFormatVersionV1 = 1u;
static constexpr uint32_t kWeightsEndianMarkerV1 = UINT32_C(0x01020304);
static constexpr uint32_t kExpectedWeightCountV1 = 4'899u;
static constexpr uint32_t kExpectedBiasCountV1 = 105u;
static constexpr uint32_t kEngineVersionCode = 20'000u; // 2.0.0
static constexpr uint32_t kScenarioSchemaCode = 200u;   // 2.0

enum class ModelLoadStatus : uint32_t {
    Loaded = 0,
    Unavailable,
    IoError,
    ManifestMalformed,
    UnknownManifestField,
    UnsupportedManifest,
    UnsupportedSchema,
    UnsupportedOperator,
    MetadataOverflow,
    ExternalDataRejected,
    DimensionMismatch,
    WeightsMalformed,
    HashMismatch,
    SignatureMalformed,
    SignatureInvalid,
    SignerUntrusted,
};

inline const char* model_load_status_name(ModelLoadStatus status) noexcept {
    switch (status) {
        case ModelLoadStatus::Loaded: return "LOADED";
        case ModelLoadStatus::Unavailable: return "UNAVAILABLE";
        case ModelLoadStatus::IoError: return "IO_ERROR";
        case ModelLoadStatus::ManifestMalformed: return "MANIFEST_MALFORMED";
        case ModelLoadStatus::UnknownManifestField: return "UNKNOWN_MANIFEST_FIELD";
        case ModelLoadStatus::UnsupportedManifest: return "UNSUPPORTED_MANIFEST";
        case ModelLoadStatus::UnsupportedSchema: return "UNSUPPORTED_SCHEMA";
        case ModelLoadStatus::UnsupportedOperator: return "UNSUPPORTED_OPERATOR";
        case ModelLoadStatus::MetadataOverflow: return "METADATA_OVERFLOW";
        case ModelLoadStatus::ExternalDataRejected: return "EXTERNAL_DATA_REJECTED";
        case ModelLoadStatus::DimensionMismatch: return "DIMENSION_MISMATCH";
        case ModelLoadStatus::WeightsMalformed: return "WEIGHTS_MALFORMED";
        case ModelLoadStatus::HashMismatch: return "HASH_MISMATCH";
        case ModelLoadStatus::SignatureMalformed: return "SIGNATURE_MALFORMED";
        case ModelLoadStatus::SignatureInvalid: return "SIGNATURE_INVALID";
        case ModelLoadStatus::SignerUntrusted: return "SIGNER_UNTRUSTED";
    }
    return "UNKNOWN";
}

struct NeuralModelManifestV1 {
    std::string model_id;
    std::string model_version;
    std::string architecture_id;
    std::string weight_format;
    std::string accumulator_format;
    std::string rounding_policy;
    std::string saturation_policy;
    std::string signer_identity;
    std::string training_dataset_hash;
    std::string training_config_hash;
    std::string model_hash;
    std::string weights_hash;
    std::string created_utc;
    std::string generator;
    bool synthetic_only = true;

    uint32_t manifest_version = 0;
    uint32_t neural_abi_version = 0;
    uint32_t feature_schema_version = 0;
    uint32_t output_schema_version = 0;
    uint32_t fixed_point_scale = 0;
    uint32_t history_ticks = 0;
    uint32_t input_features = 0;
    uint32_t hidden_dimensions = 0;
    uint32_t message_passing_layers = 0;
    uint32_t engine_version_min = 0;
    uint32_t engine_version_max = 0;
    uint32_t scenario_schema_min = 0;
    uint32_t scenario_schema_max = 0;
    uint32_t weights_size = 0;
    uint32_t weight_count = 0;
    uint32_t bias_count = 0;
    uint32_t weight_scale_denominator = 0;
    int64_t activation_min_fp = 0;
    int64_t activation_max_fp = 0;
    std::vector<std::string> operators;
};

struct NeuralModelPackage {
    ModelLoadStatus status = ModelLoadStatus::Unavailable;
    std::string error;
    NeuralModelManifestV1 manifest;
    std::vector<uint8_t> weights;
    std::array<uint8_t, 32> manifest_hash{};
    std::array<uint8_t, 32> weights_hash{};
    std::array<uint8_t, 32> signer_pubkey{};

    bool trusted() const noexcept { return status == ModelLoadStatus::Loaded; }
};

namespace model_detail {

inline int hex_nibble(char c) noexcept {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return 10 + c - 'a';
    if (c >= 'A' && c <= 'F') return 10 + c - 'A';
    return -1;
}

template <size_t N>
inline bool decode_hex(const std::string& text, std::array<uint8_t, N>& out) noexcept {
    if (text.size() != N * 2u) return false;
    for (size_t i = 0; i < N; ++i) {
        const int hi = hex_nibble(text[i * 2u]);
        const int lo = hex_nibble(text[i * 2u + 1u]);
        if (hi < 0 || lo < 0) return false;
        out[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
}

inline std::string hex_encode(const uint8_t* data, size_t len) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::string out;
    out.resize(len * 2u);
    for (size_t i = 0; i < len; ++i) {
        out[i * 2u] = kHex[(data[i] >> 4u) & 0x0fu];
        out[i * 2u + 1u] = kHex[data[i] & 0x0fu];
    }
    return out;
}

inline bool constant_time_equal(const uint8_t* lhs, const uint8_t* rhs, size_t len) noexcept {
    uint8_t diff = 0;
    for (size_t i = 0; i < len; ++i) diff |= static_cast<uint8_t>(lhs[i] ^ rhs[i]);
    return diff == 0;
}

inline bool read_file_bounded(const std::string& path, size_t limit,
                              std::vector<uint8_t>& out) {
    std::error_code ec;
    const auto file_status = std::filesystem::symlink_status(path, ec);
    if (ec || std::filesystem::is_symlink(file_status) ||
        !std::filesystem::is_regular_file(file_status)) {
        return false;
    }
    std::ifstream file(path, std::ios::binary);
    if (!file) return false;
    file.seekg(0, std::ios::end);
    const std::streamoff size = file.tellg();
    if (size <= 0 || static_cast<uint64_t>(size) > static_cast<uint64_t>(limit)) {
        return false;
    }
    file.seekg(0, std::ios::beg);
    out.resize(static_cast<size_t>(size));
    file.read(reinterpret_cast<char*>(out.data()), size);
    return file.good() || file.eof();
}

inline bool valid_utf8(const std::vector<uint8_t>& bytes) noexcept {
    size_t i = 0;
    while (i < bytes.size()) {
        const uint8_t first = bytes[i++];
        if (first <= 0x7fu) continue;
        uint32_t codepoint = 0;
        size_t continuation = 0;
        uint32_t minimum = 0;
        if (first >= 0xc2u && first <= 0xdfu) {
            codepoint = first & 0x1fu;
            continuation = 1;
            minimum = 0x80u;
        } else if (first >= 0xe0u && first <= 0xefu) {
            codepoint = first & 0x0fu;
            continuation = 2;
            minimum = 0x800u;
        } else if (first >= 0xf0u && first <= 0xf4u) {
            codepoint = first & 0x07u;
            continuation = 3;
            minimum = 0x10000u;
        } else {
            return false;
        }
        if (i + continuation > bytes.size()) return false;
        for (size_t n = 0; n < continuation; ++n) {
            const uint8_t next = bytes[i++];
            if ((next & 0xc0u) != 0x80u) return false;
            codepoint = (codepoint << 6u) | (next & 0x3fu);
        }
        if (codepoint < minimum || codepoint > 0x10ffffu ||
            (codepoint >= 0xd800u && codepoint <= 0xdfffu)) {
            return false;
        }
    }
    return true;
}

inline bool u32_field(const JsonVal& root, const char* name, uint32_t& out) noexcept {
    const JsonVal* value = root.find(name);
    if (!value || value->type != JsonVal::Int || value->i < 0 ||
        static_cast<uint64_t>(value->i) >
            static_cast<uint64_t>((std::numeric_limits<uint32_t>::max)())) {
        return false;
    }
    out = static_cast<uint32_t>(value->i);
    return true;
}

inline bool i64_field(const JsonVal& root, const char* name, int64_t& out) noexcept {
    const JsonVal* value = root.find(name);
    if (!value || value->type != JsonVal::Int) return false;
    out = value->i;
    return true;
}

inline bool string_field(const JsonVal& root, const char* name, std::string& out,
                         size_t max_len) {
    const JsonVal* value = root.find(name);
    if (!value || value->type != JsonVal::Str || value->s.empty() ||
        value->s.size() > max_len) {
        return false;
    }
    out = value->s;
    return true;
}

inline bool known_top_level_field(const std::string& key) noexcept {
    static constexpr const char* kKnown[] = {
        "manifest_version", "neural_abi_version", "feature_schema_version",
        "output_schema_version", "model_id", "model_version", "architecture_id",
        "weight_format", "accumulator_format", "fixed_point_scale",
        "rounding_policy", "saturation_policy", "history_ticks", "input_features",
        "hidden_dimensions", "message_passing_layers", "engine_version_min",
        "engine_version_max", "scenario_schema_min", "scenario_schema_max",
        "training_dataset_hash", "training_config_hash", "model_hash",
        "weights_hash", "weights_size", "weight_count", "bias_count",
        "operators", "quantization", "creation_metadata", "signer_identity",
        "external_data"
    };
    for (const char* known : kKnown) if (key == known) return true;
    return false;
}

inline bool exact_object_fields(const JsonVal& object,
                                const std::vector<std::string>& expected) {
    if (object.type != JsonVal::Obj || object.o.size() != expected.size()) return false;
    for (const auto& kv : object.o) {
        bool found = false;
        for (const auto& name : expected) {
            if (kv.first == name) {
                found = true;
                break;
            }
        }
        if (!found) return false;
    }
    return true;
}

inline bool parse_manifest(const std::vector<uint8_t>& bytes,
                           NeuralModelManifestV1& out,
                           ModelLoadStatus& status,
                           std::string& error) {
    const char* begin = reinterpret_cast<const char*>(bytes.data());
    JsonParser parser(begin, bytes.size());
    JsonVal root;
    if (!parser.parse(root) || root.type != JsonVal::Obj) {
        status = ModelLoadStatus::ManifestMalformed;
        error = "manifest is not strict JSON object";
        return false;
    }
    for (const auto& field : root.o) {
        if (!known_top_level_field(field.first)) {
            status = ModelLoadStatus::UnknownManifestField;
            error = "unknown manifest field: " + field.first;
            return false;
        }
    }

    if (!u32_field(root, "manifest_version", out.manifest_version) ||
        !u32_field(root, "neural_abi_version", out.neural_abi_version) ||
        !u32_field(root, "feature_schema_version", out.feature_schema_version) ||
        !u32_field(root, "output_schema_version", out.output_schema_version) ||
        !u32_field(root, "fixed_point_scale", out.fixed_point_scale) ||
        !u32_field(root, "history_ticks", out.history_ticks) ||
        !u32_field(root, "input_features", out.input_features) ||
        !u32_field(root, "hidden_dimensions", out.hidden_dimensions) ||
        !u32_field(root, "message_passing_layers", out.message_passing_layers) ||
        !u32_field(root, "engine_version_min", out.engine_version_min) ||
        !u32_field(root, "engine_version_max", out.engine_version_max) ||
        !u32_field(root, "scenario_schema_min", out.scenario_schema_min) ||
        !u32_field(root, "scenario_schema_max", out.scenario_schema_max) ||
        !u32_field(root, "weights_size", out.weights_size) ||
        !u32_field(root, "weight_count", out.weight_count) ||
        !u32_field(root, "bias_count", out.bias_count) ||
        !string_field(root, "model_id", out.model_id, 63) ||
        !string_field(root, "model_version", out.model_version, 31) ||
        !string_field(root, "architecture_id", out.architecture_id, 63) ||
        !string_field(root, "weight_format", out.weight_format, 31) ||
        !string_field(root, "accumulator_format", out.accumulator_format, 31) ||
        !string_field(root, "rounding_policy", out.rounding_policy, 31) ||
        !string_field(root, "saturation_policy", out.saturation_policy, 63) ||
        !string_field(root, "signer_identity", out.signer_identity, 64) ||
        !string_field(root, "training_dataset_hash", out.training_dataset_hash, 64) ||
        !string_field(root, "training_config_hash", out.training_config_hash, 64) ||
        !string_field(root, "model_hash", out.model_hash, 64) ||
        !string_field(root, "weights_hash", out.weights_hash, 64)) {
        status = ModelLoadStatus::ManifestMalformed;
        error = "required manifest field missing, malformed, or over limit";
        return false;
    }

    const JsonVal& operators = root["operators"];
    if (operators.type != JsonVal::Arr || operators.a.empty() || operators.a.size() > 16u) {
        status = ModelLoadStatus::ManifestMalformed;
        error = "operators must be a bounded non-empty array";
        return false;
    }
    static constexpr const char* kSupportedOperators[] = {
        "integer_linear", "integer_message_sum", "bias_add",
        "clamped_relu", "hard_sigmoid", "mean_pool"
    };
    for (const auto& value : operators.a) {
        if (value.type != JsonVal::Str) {
            status = ModelLoadStatus::ManifestMalformed;
            error = "operator name must be a string";
            return false;
        }
        bool supported = false;
        for (const char* name : kSupportedOperators) {
            if (value.s == name) {
                supported = true;
                break;
            }
        }
        if (!supported) {
            status = ModelLoadStatus::UnsupportedOperator;
            error = "unsupported operator: " + value.s;
            return false;
        }
        for (const auto& existing : out.operators) {
            if (existing == value.s) {
                status = ModelLoadStatus::ManifestMalformed;
                error = "duplicate operator: " + value.s;
                return false;
            }
        }
        out.operators.push_back(value.s);
    }
    if (out.operators.size() != 6u) {
        status = ModelLoadStatus::UnsupportedOperator;
        error = "V1 requires exactly six deterministic operators";
        return false;
    }

    const JsonVal& quant = root["quantization"];
    if (!exact_object_fields(quant, {"weight_dtype", "accumulator_dtype",
                                     "weight_scale_denominator",
                                     "activation_min_fp", "activation_max_fp"})) {
        status = ModelLoadStatus::ManifestMalformed;
        error = "quantization object fields are incomplete or unknown";
        return false;
    }
    std::string weight_dtype;
    std::string accumulator_dtype;
    if (!string_field(quant, "weight_dtype", weight_dtype, 16) ||
        !string_field(quant, "accumulator_dtype", accumulator_dtype, 16) ||
        !u32_field(quant, "weight_scale_denominator", out.weight_scale_denominator) ||
        !i64_field(quant, "activation_min_fp", out.activation_min_fp) ||
        !i64_field(quant, "activation_max_fp", out.activation_max_fp) ||
        weight_dtype != "int8" || accumulator_dtype != "int64") {
        status = ModelLoadStatus::UnsupportedManifest;
        error = "unsupported quantization metadata";
        return false;
    }

    const JsonVal& creation = root["creation_metadata"];
    if (!exact_object_fields(creation, {"created_utc", "generator", "synthetic_only"}) ||
        !string_field(creation, "created_utc", out.created_utc, 32) ||
        !string_field(creation, "generator", out.generator, 63) ||
        creation["synthetic_only"].type != JsonVal::Bool) {
        status = ModelLoadStatus::ManifestMalformed;
        error = "creation_metadata fields are incomplete or unknown";
        return false;
    }
    out.synthetic_only = creation["synthetic_only"].b;

    const JsonVal& external = root["external_data"];
    if (external.type != JsonVal::Arr) {
        status = ModelLoadStatus::ManifestMalformed;
        error = "external_data must be an array";
        return false;
    }
    if (!external.a.empty()) {
        status = ModelLoadStatus::ExternalDataRejected;
        error = "external model data references are forbidden";
        return false;
    }
    return true;
}

inline uint32_t read_u32_le(const uint8_t* p) noexcept {
    return static_cast<uint32_t>(p[0]) |
           (static_cast<uint32_t>(p[1]) << 8u) |
           (static_cast<uint32_t>(p[2]) << 16u) |
           (static_cast<uint32_t>(p[3]) << 24u);
}

inline uint64_t read_u64_le(const uint8_t* p) noexcept {
    return static_cast<uint64_t>(read_u32_le(p)) |
           (static_cast<uint64_t>(read_u32_le(p + 4)) << 32u);
}

inline bool validate_weights_header(const std::vector<uint8_t>& data,
                                    const NeuralModelManifestV1& manifest,
                                    std::string& error) {
    static constexpr uint8_t kMagic[8] = {'C','A','E','L','N','N','1','\0'};
    if (data.size() < kWeightsHeaderBytesV1 ||
        !constant_time_equal(data.data(), kMagic, sizeof(kMagic))) {
        error = "weights magic/header is malformed";
        return false;
    }
    const uint32_t version = read_u32_le(data.data() + 8);
    const uint32_t endian = read_u32_le(data.data() + 12);
    const uint32_t features = read_u32_le(data.data() + 16);
    const uint32_t hidden = read_u32_le(data.data() + 20);
    const uint32_t layers = read_u32_le(data.data() + 24);
    const uint32_t weights = read_u32_le(data.data() + 28);
    const uint32_t biases = read_u32_le(data.data() + 32);
    const uint32_t reserved = read_u32_le(data.data() + 36);
    const uint64_t payload_bytes = read_u64_le(data.data() + 40);
    if (version != kWeightsFormatVersionV1 || endian != kWeightsEndianMarkerV1 ||
        features != manifest.input_features || hidden != manifest.hidden_dimensions ||
        layers != manifest.message_passing_layers || weights != manifest.weight_count ||
        biases != manifest.bias_count || reserved != 0u ||
        weights != kExpectedWeightCountV1 || biases != kExpectedBiasCountV1) {
        error = "weights header dimensions do not match manifest/V1 architecture";
        return false;
    }
    const uint64_t expected_payload =
        static_cast<uint64_t>(weights) + static_cast<uint64_t>(biases) * 4u;
    const uint64_t expected_total = static_cast<uint64_t>(kWeightsHeaderBytesV1) +
                                    expected_payload;
    if (payload_bytes != expected_payload ||
        expected_total != static_cast<uint64_t>(data.size()) ||
        manifest.weights_size != data.size()) {
        error = "weights payload size/count overflow or mismatch";
        return false;
    }
    return true;
}

inline bool parse_signature(const std::vector<uint8_t>& raw,
                            std::array<uint8_t, 32>& public_key,
                            std::array<uint8_t, 64>& signature) {
    std::string text(reinterpret_cast<const char*>(raw.data()), raw.size());
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    static const std::string prefix = "ed25519:";
    if (text.compare(0, prefix.size(), prefix) != 0) return false;
    const size_t separator = text.find(':', prefix.size());
    if (separator == std::string::npos ||
        text.find(':', separator + 1u) != std::string::npos) return false;
    return decode_hex(text.substr(prefix.size(), separator - prefix.size()), public_key) &&
           decode_hex(text.substr(separator + 1u), signature);
}

} // namespace model_detail

inline bool default_trusted_neural_pubkey(std::array<uint8_t, 32>& out) noexcept {
    return model_detail::decode_hex(std::string(CAELUS_NEURAL_TRUSTED_PUBKEY_HEX), out);
}

class NeuralModelLoader final {
public:
    static NeuralModelPackage load(
        const std::string& directory,
        uint32_t engine_version,
        uint32_t scenario_schema) noexcept;

private:
    static NeuralModelPackage load_with_key(
        const std::string& directory,
        const std::array<uint8_t, 32>& trusted_public_key,
        uint32_t engine_version,
        uint32_t scenario_schema) noexcept;
};

inline NeuralModelPackage NeuralModelLoader::load_with_key(
    const std::string& directory,
    const std::array<uint8_t, 32>& trusted_public_key,
    uint32_t engine_version,
    uint32_t scenario_schema) noexcept {
    NeuralModelPackage package;
    try {
        std::vector<uint8_t> manifest_bytes;
        std::vector<uint8_t> signature_bytes;
        const std::string separator =
            (!directory.empty() && (directory.back() == '/' || directory.back() == '\\'))
                ? "" : "/";
        if (!model_detail::read_file_bounded(directory + separator + "manifest.json",
                                              kMaxManifestBytesV1, manifest_bytes) ||
            !model_detail::read_file_bounded(directory + separator + "weights.bin",
                                              kMaxWeightsBytesV1, package.weights) ||
            !model_detail::read_file_bounded(directory + separator + "model.sig",
                                              512u, signature_bytes)) {
            package.status = ModelLoadStatus::Unavailable;
            package.error = "model package files unavailable, empty, or over size limit";
            return package;
        }
        // Authenticate the exact raw bytes before invoking the JSON parser.
        // This keeps unauthenticated manifests off the recursive parser path.
        std::array<uint8_t, 64> signature{};
        if (!model_detail::parse_signature(
                signature_bytes, package.signer_pubkey, signature)) {
            package.status = ModelLoadStatus::SignatureMalformed;
            package.error = "model.sig format is malformed";
            return package;
        }
        if (!model_detail::constant_time_equal(
                package.signer_pubkey.data(), trusted_public_key.data(), 32u)) {
            package.status = ModelLoadStatus::SignerUntrusted;
            package.error = "model signer does not match dedicated neural trust anchor";
            return package;
        }
        if (caelus_blake3_hash(manifest_bytes.data(), manifest_bytes.size(),
                               package.manifest_hash.data()) != 1u ||
            caelus_blake3_hash(package.weights.data(), package.weights.size(),
                               package.weights_hash.data()) != 1u) {
            package.status = ModelLoadStatus::IoError;
            package.error = "Blake3 hash service failed";
            return package;
        }
        if (caelus_verify_neural_model_signature(
                package.manifest_hash.data(), package.weights_hash.data(),
                package.signer_pubkey.data(), signature.data()) != 1u) {
            package.status = ModelLoadStatus::SignatureInvalid;
            package.error = "neural model Ed25519 signature is invalid";
            return package;
        }
        if (!model_detail::valid_utf8(manifest_bytes)) {
            package.status = ModelLoadStatus::ManifestMalformed;
            package.error = "manifest is not valid UTF-8";
            return package;
        }
        if (!model_detail::parse_manifest(
                manifest_bytes, package.manifest, package.status, package.error)) {
            return package;
        }
        const auto& m = package.manifest;
        if (m.signer_identity !=
            model_detail::hex_encode(
                trusted_public_key.data(), trusted_public_key.size())) {
            package.status = ModelLoadStatus::SignerUntrusted;
            package.error = "manifest signer_identity does not match neural trust anchor";
            return package;
        }
        if (m.manifest_version != CAELUS_NN_MANIFEST_V1 ||
            m.neural_abi_version != CAELUS_NEURAL_ABI_V1 ||
            m.feature_schema_version != CAELUS_FEATURE_SCHEMA_V1 ||
            m.output_schema_version != CAELUS_NEURAL_OUTPUT_V1 ||
            m.architecture_id != "caelus_temporal_mp_int8_v1" ||
            m.weight_format != "int8_le_v1" ||
            m.accumulator_format != "int64" ||
            m.fixed_point_scale != CAELUS_NEURAL_FP_SCALE ||
            m.rounding_policy != "toward_zero" ||
            m.saturation_policy != "explicit_int64_saturating" ||
            m.weight_scale_denominator == 0u ||
            m.activation_min_fp != 0 ||
            m.activation_max_fp != CAELUS_NEURAL_FP_SCALE) {
            package.status = ModelLoadStatus::UnsupportedManifest;
            package.error = "manifest ABI, architecture, arithmetic, or activation is unsupported";
            return package;
        }
        if (m.history_ticks != CAELUS_NEURAL_HISTORY_TICKS_V1 ||
            m.input_features != CAELUS_NEURAL_FEATURES_V1 ||
            m.hidden_dimensions != CAELUS_NEURAL_HIDDEN_V1 ||
            m.message_passing_layers != 2u ||
            m.weight_count != kExpectedWeightCountV1 ||
            m.bias_count != kExpectedBiasCountV1) {
            package.status = ModelLoadStatus::DimensionMismatch;
            package.error = "manifest tensor dimensions do not match V1 runtime";
            return package;
        }
        if (m.engine_version_min > m.engine_version_max ||
            m.scenario_schema_min > m.scenario_schema_max ||
            m.engine_version_min > engine_version || m.engine_version_max < engine_version ||
            m.scenario_schema_min > scenario_schema ||
            m.scenario_schema_max < scenario_schema) {
            package.status = ModelLoadStatus::UnsupportedSchema;
            package.error = "model does not support this engine/scenario schema";
            return package;
        }
        if (!model_detail::validate_weights_header(package.weights, m, package.error)) {
            package.status = ModelLoadStatus::WeightsMalformed;
            return package;
        }
        const std::string actual_weights_hash =
            model_detail::hex_encode(
                package.weights_hash.data(), package.weights_hash.size());
        if (m.weights_hash != actual_weights_hash || m.model_hash != actual_weights_hash) {
            package.status = ModelLoadStatus::HashMismatch;
            package.error = "manifest model/weights hash does not match weights.bin";
            return package;
        }
        std::array<uint8_t, 32> training_hash{};
        std::array<uint8_t, 32> config_hash{};
        if (!model_detail::decode_hex(m.training_dataset_hash, training_hash) ||
            !model_detail::decode_hex(m.training_config_hash, config_hash)) {
            package.status = ModelLoadStatus::ManifestMalformed;
            package.error = "training provenance hashes are malformed";
            return package;
        }
        package.status = ModelLoadStatus::Loaded;
        package.error.clear();
        return package;
    } catch (...) {
        package.status = ModelLoadStatus::IoError;
        package.error = "exception while loading model package";
        return package;
    }
}

inline NeuralModelPackage NeuralModelLoader::load(
    const std::string& directory,
    uint32_t engine_version,
    uint32_t scenario_schema) noexcept {
    std::array<uint8_t, 32> trusted_public_key{};
    if (!default_trusted_neural_pubkey(trusted_public_key)) {
        NeuralModelPackage package;
        package.status = ModelLoadStatus::UnsupportedManifest;
        package.error = "compiled neural trust anchor is malformed";
        return package;
    }
    return load_with_key(
        directory, trusted_public_key, engine_version, scenario_schema);
}

inline NeuralModelPackage load_neural_model_package(
    const std::string& directory,
    uint32_t engine_version = kEngineVersionCode,
    uint32_t scenario_schema = kScenarioSchemaCode) noexcept {
    return NeuralModelLoader::load(directory, engine_version, scenario_schema);
}

} // namespace caelus::neural
