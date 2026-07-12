//
//  CaelusMobileError.swift
//  CAELUSMobileCore
//
//  Typed Swift mirror of the stable C ABI status codes
//  (include/mobile/caelus_mobile.h).  Every native call the EngineController
//  makes is converted into one of these cases; raw Int32 codes never reach
//  feature code or views.
//
import Foundation

/// One-to-one mapping of `CAELUS_MOBILE_E_*`.  The raw values mirror the C
/// header and are behaviourally verified by the Linux test suite against the
/// real bridge (see `EngineControllerTests.testErrorMapping…`).
public enum CaelusStatusCode: Int32, Sendable, Equatable {
    case ok = 0
    case invalidArgument = -1
    case abiMismatch = -2
    case allocation = -3
    case lifecycle = -4
    case scenarioRejected = -5
    case modelRejected = -6
    case bufferTooSmall = -7
    case leverUnknown = -8
    case leverUnavailable = -9
    case auditFailure = -10
    case checkpointInvalid = -11
    case checkpointIncompatible = -12
    case internalFailure = -13
    case poisoned = -14
    case invalidUTF8 = -15
    case inputTooLarge = -16
    case staleHandle = -17
    case busy = -18
}

/// Typed error surface of the native engine.  `detail` carries the
/// human-readable description retrieved from `caelus_mobile_last_error_v1`
/// whenever one was available.
public enum CaelusMobileError: Error, Equatable, Sendable {
    case invalidArgument(detail: String)
    case abiMismatch(detail: String)
    case allocationFailure(detail: String)
    case lifecycleViolation(detail: String)
    case scenarioRejected(detail: String)
    case modelRejected(detail: String)
    case bufferTooSmall(detail: String)
    case leverUnknown(detail: String)
    case leverUnavailable(detail: String)
    case auditFailure(detail: String)
    case checkpointInvalid(detail: String)
    case checkpointIncompatible(detail: String)
    case internalFailure(detail: String)
    case enginePoisoned(detail: String)
    case invalidUTF8(detail: String)
    case inputTooLarge(detail: String)
    case staleHandle(detail: String)
    case engineBusy(detail: String)
    /// The controller was shut down (or never created); no native handle.
    case engineUnavailable
    /// The native snapshot/status JSON could not be decoded into DTOs.
    case payloadDecoding(detail: String)
    /// A status code this build does not know (newer bridge than app).
    case unknownStatus(code: Int32, detail: String)

    public init(status: Int32, detail: String) {
        switch CaelusStatusCode(rawValue: status) {
        case .invalidArgument: self = .invalidArgument(detail: detail)
        case .abiMismatch: self = .abiMismatch(detail: detail)
        case .allocation: self = .allocationFailure(detail: detail)
        case .lifecycle: self = .lifecycleViolation(detail: detail)
        case .scenarioRejected: self = .scenarioRejected(detail: detail)
        case .modelRejected: self = .modelRejected(detail: detail)
        case .bufferTooSmall: self = .bufferTooSmall(detail: detail)
        case .leverUnknown: self = .leverUnknown(detail: detail)
        case .leverUnavailable: self = .leverUnavailable(detail: detail)
        case .auditFailure: self = .auditFailure(detail: detail)
        case .checkpointInvalid: self = .checkpointInvalid(detail: detail)
        case .checkpointIncompatible:
            self = .checkpointIncompatible(detail: detail)
        case .internalFailure: self = .internalFailure(detail: detail)
        case .poisoned: self = .enginePoisoned(detail: detail)
        case .invalidUTF8: self = .invalidUTF8(detail: detail)
        case .inputTooLarge: self = .inputTooLarge(detail: detail)
        case .staleHandle: self = .staleHandle(detail: detail)
        case .busy: self = .engineBusy(detail: detail)
        case .ok, .none:
            self = .unknownStatus(code: status, detail: detail)
        }
    }
}

extension CaelusMobileError: CustomStringConvertible {
    public var description: String {
        switch self {
        case .invalidArgument(let detail): return "invalid argument: \(detail)"
        case .abiMismatch(let detail): return "ABI mismatch: \(detail)"
        case .allocationFailure(let detail): return "allocation failure: \(detail)"
        case .lifecycleViolation(let detail): return "lifecycle violation: \(detail)"
        case .scenarioRejected(let detail): return "scenario rejected: \(detail)"
        case .modelRejected(let detail): return "neural model rejected: \(detail)"
        case .bufferTooSmall(let detail): return "buffer too small: \(detail)"
        case .leverUnknown(let detail): return "unknown lever: \(detail)"
        case .leverUnavailable(let detail): return "lever unavailable: \(detail)"
        case .auditFailure(let detail): return "audit failure: \(detail)"
        case .checkpointInvalid(let detail): return "checkpoint invalid: \(detail)"
        case .checkpointIncompatible(let detail):
            return "checkpoint incompatible: \(detail)"
        case .internalFailure(let detail): return "internal failure: \(detail)"
        case .enginePoisoned(let detail): return "engine poisoned: \(detail)"
        case .invalidUTF8(let detail): return "invalid UTF-8: \(detail)"
        case .inputTooLarge(let detail): return "input too large: \(detail)"
        case .staleHandle(let detail): return "stale handle: \(detail)"
        case .engineBusy(let detail): return "engine busy: \(detail)"
        case .engineUnavailable: return "engine unavailable (shut down)"
        case .payloadDecoding(let detail): return "payload decoding: \(detail)"
        case .unknownStatus(let code, let detail):
            return "unknown status \(code): \(detail)"
        }
    }
}
