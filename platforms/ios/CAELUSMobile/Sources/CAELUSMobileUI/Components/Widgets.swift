//
//  Widgets.swift
//  CAELUSMobileUI
//
//  Small shared building blocks used across feature screens.
//
#if os(iOS) && canImport(SwiftUI)
import CAELUSMobileCore
import SwiftUI
import UIKit

/// Colored capsule badge for short status strings.
struct StatusBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
            .accessibilityLabel(Text(text))
    }
}

/// One compact metric with caption, value, and optional color accent.
struct MetricTile: View {
    let caption: String
    let value: String
    var accent: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(caption)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.headline.monospacedDigit())
                .foregroundStyle(accent)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(caption): \(value)"))
    }
}

/// Card-style section container for the Command Center.
struct SectionCard<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// Labeled row: caption left, value right (monospaced for hashes/ids).
struct KeyValueRow: View {
    let key: String
    let value: String
    var monospaced = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(key)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .font(monospaced ? .caption.monospaced() : .body)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Inline banner for surfaced errors with a dismiss affordance.
struct ErrorBanner: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .accessibilityLabel(Text("Dismiss error"))
        }
        .padding(12)
        .background(Color.red.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Horizontal fixed-point probability bar (0…1) with themed color.
struct ProbabilityBar: View {
    let labelText: String
    let valueFP: Int64

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(labelText).font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Text(valueFP.fpPercent)
                    .font(.caption2.monospacedDigit())
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.15))
                    Capsule()
                        .fill(Theme.riskColor(fp: valueFP))
                        .frame(width: proxy.size.width
                            * CGFloat(min(max(FixedPoint.displayValue(valueFP), 0), 1)))
                }
            }
            .frame(height: 6)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(labelText) \(valueFP.fpPercent)"))
    }
}
#endif
