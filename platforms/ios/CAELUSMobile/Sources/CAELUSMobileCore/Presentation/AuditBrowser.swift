//
//  AuditBrowser.swift
//  CAELUSMobileCore
//
//  Read-only presentation parsing of the exported audit NDJSON so the
//  mobile audit screen can browse the chain.  DISPLAY ONLY: integrity
//  verification is the job of the chained Blake3 hashes + ed25519 seal
//  (tools/verify_audit_log.py or an equivalent holder-side verifier); this
//  parser never decides whether a chain is trustworthy.
//
import Foundation

/// One rendered audit chain line.
public struct AuditDisplayRecord: Sendable, Equatable, Identifiable {
    /// Chain sequence number (unique per session).
    public var seq: UInt64
    public var id: UInt64 { seq }
    public var timestampEpochSeconds: Int64
    /// Chain record kind: GENESIS, EVENT, or SEAL.
    public var kind: String
    /// Nested event type for EVENT records (e.g. SCENARIO_ACTIVATED).
    public var eventType: String?
    /// Chain head hash after this record (hex64).
    public var hashHex: String
    /// Compact single-line detail summary of the event payload.
    public var detail: String
}

public enum AuditBrowser {
    /// Parse exported NDJSON into display records, newest last.  Lines that
    /// fail to parse become explicit `UNPARSEABLE` records — they are never
    /// silently dropped, because a malformed line in an audit export is
    /// itself something the operator must see.
    public static func parse(ndjson: Data) -> [AuditDisplayRecord] {
        let text = String(decoding: ndjson, as: UTF8.self)
        var records: [AuditDisplayRecord] = []
        var fallbackSeq = UInt64.max // descending, avoids id collisions
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
            if let record = parseLine(String(line)) {
                records.append(record)
            } else {
                records.append(AuditDisplayRecord(
                    seq: fallbackSeq,
                    timestampEpochSeconds: 0,
                    kind: "UNPARSEABLE",
                    eventType: nil,
                    hashHex: "",
                    detail: String(line.prefix(120))))
                fallbackSeq -= 1
            }
        }
        return records
    }

    static func parseLine(_ line: String) -> AuditDisplayRecord? {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any],
              let kind = dict["type"] as? String else { return nil }
        let seq = (dict["seq"] as? NSNumber)?.uint64Value ?? 0
        let ts = (dict["ts"] as? NSNumber)?.int64Value ?? 0
        let hash = dict["hash"] as? String ?? ""

        var eventType: String?
        var detail = ""
        if let event = dict["event"] as? [String: Any] {
            eventType = event["type"] as? String
            detail = summarize(event)
        } else if kind == "SEAL" {
            detail = "ed25519 seal over the chain head"
        } else if kind == "GENESIS" {
            detail = "session \(dict["session_id"] as? String ?? "?")"
        }
        return AuditDisplayRecord(seq: seq,
                                  timestampEpochSeconds: ts,
                                  kind: kind,
                                  eventType: eventType,
                                  hashHex: hash,
                                  detail: detail)
    }

    /// Deterministic compact "key=value" summary (keys sorted; the noisy
    /// `type` key is rendered separately).
    static func summarize(_ event: [String: Any]) -> String {
        event.keys.sorted()
            .filter { $0 != "type" }
            .prefix(6)
            .compactMap { key -> String? in
                switch event[key] {
                case let string as String:
                    return "\(key)=\(string.count > 24 ? string.prefix(24) + "…" : Substring(string))"
                case let number as NSNumber:
                    // Booleans arrive as NSNumber from JSONSerialization and
                    // render as 0/1 — deterministic and unambiguous.
                    return "\(key)=\(number)"
                default:
                    return nil
                }
            }
            .joined(separator: " ")
    }
}
