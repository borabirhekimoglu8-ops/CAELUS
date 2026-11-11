//
//  FixedPoint.swift
//  CAELUSMobileCore
//
//  PRESENTATION-ONLY conversion of engine fixed-point integers (scale 1e6).
//  Nothing produced here may ever be fed back into the engine or into any
//  deterministic computation — the boundary carries Int64 in both directions.
//
import Foundation

public enum FixedPoint {
    /// The engine-wide scale (FP_SCALE).  ABI v1 constant.
    public static let scale: Int64 = 1_000_000

    /// Lossy Double for UI display only.
    public static func displayValue(_ fp: Int64) -> Double {
        Double(fp) / Double(scale)
    }

    /// "0.482" style short decimal for UI labels (exact integer math for the
    /// common ranges, so display strings are stable across platforms).
    public static func decimalString(_ fp: Int64, fractionDigits: Int = 3) -> String {
        precondition((0...6).contains(fractionDigits))
        let sign = fp < 0 ? "-" : ""
        let magnitude = fp.magnitude
        let whole = magnitude / UInt64(scale)
        var fraction = magnitude % UInt64(scale)
        var digits = 6
        while digits > fractionDigits {
            fraction /= 10
            digits -= 1
        }
        if fractionDigits == 0 { return "\(sign)\(whole)" }
        let padded = String(format: "%0\(fractionDigits)llu", fraction)
        return "\(sign)\(whole).\(padded)"
    }

    /// "48.2%" style percentage for probability-like values in [0, 1e6].
    public static func percentString(_ fp: Int64, fractionDigits: Int = 1) -> String {
        let scaled = fp * 100
        return decimalString(scaled, fractionDigits: fractionDigits) + "%"
    }
}
