//
//  Theme.swift
//  CAELUSMobileUI
//
//  Central status→color mapping and small formatting helpers so every
//  screen renders the same state the same way (including high-contrast
//  semantic colors and Dynamic Type friendly text styles).
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI

enum Theme {
    // MARK: Regime / state colors (semantic, dark-mode aware)

    static func color(for regime: OperationalRegime) -> Color {
        switch regime {
        case .nominal: return .green
        case .strained: return .yellow
        case .regimeExceeded: return .orange
        case .outage: return .red
        }
    }

    static func color(for decision: GateDecision?) -> Color {
        guard let decision else { return .secondary.opacity(0.6) }
        switch decision {
        case .acceptedAdvisory, .acceptedBounded: return .green
        case .symbolicFallback: return .orange
        case .unknown: return .gray
        default: return .red
        }
    }

    static func color(for mode: NeuralMode) -> Color {
        switch mode {
        case .symbolicOnly: return .blue
        case .advisory: return .purple
        case .assurance: return .teal
        case .unknown: return .gray
        }
    }

    static func color(for kind: NodeKind) -> Color {
        switch kind {
        case .service: return .blue
        case .buffer: return .teal
        case .queue: return .indigo
        case .perishable: return .orange
        case .gate: return .purple
        case .adversary: return .red
        }
    }

    /// Trust coloring: full trust (1.0) → green, degraded → orange/red.
    static func trustColor(fp: Int64) -> Color {
        switch fp {
        case 900_000...: return .green
        case 600_000..<900_000: return .yellow
        case 300_000..<600_000: return .orange
        default: return .red
        }
    }

    /// Risk probability coloring (fixed-point 1e6).
    static func riskColor(fp: Int64) -> Color {
        switch fp {
        case ..<250_000: return .green
        case 250_000..<500_000: return .yellow
        case 500_000..<750_000: return .orange
        default: return .red
        }
    }
}

// MARK: Formatting helpers

extension Int64 {
    /// Fixed-point → "0.750" style decimal for display.
    var fpDecimal: String { FixedPoint.decimalString(self) }
    /// Fixed-point → "75.0%" style percentage for display.
    var fpPercent: String { FixedPoint.percentString(self) }
}

extension UInt64 {
    /// Virtual minutes → "2d 4h 30m" style duration.
    var virtualDuration: String {
        let days = self / (24 * 60)
        let hours = (self % (24 * 60)) / 60
        let minutes = self % 60
        if days > 0 { return "\(days)d \(hours)h \(minutes)m" }
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(minutes)m"
    }
}
#endif
