// swift-tools-version:5.9
// =============================================================================
//  CAELUS Mobile — Swift package
//
//  Targets:
//    • CaelusBridgeC       — Clang module over the stable C ABI header
//                            (include/mobile/caelus_mobile.h).  Header-only:
//                            symbol resolution comes from the platform link
//                            step (CaelusCore.xcframework in the Xcode app,
//                            dist/host static libraries in Linux CI).
//    • CAELUSMobileCore    — platform-independent engine access layer:
//                            EngineController actor, snapshot DTOs, checkpoint
//                            store, security policy, report builder.  Builds
//                            and tests on Linux against the real native core.
//    • CAELUSMobileUI      — SwiftUI feature surface (iPhone Command Center,
//                            iPad Causal Map, levers, neural observer, audit,
//                            reports, settings).  Compiles to an empty module
//                            where SwiftUI is unavailable.
//    • CAELUSMobileCoreTests — XCTest suite; on Linux it links the host-built
//                            bridge + Rust staticlib (tools/build_host_bridge.sh).
// =============================================================================
import PackageDescription
import Foundation

// Absolute repo root derived from this manifest's location:
// <root>/platforms/ios/CAELUSMobile/Package.swift
let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let repoRoot = packageDirectory
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .path

#if os(Linux)
/// Linux CI/dev: link the host-compiled bridge archive + Rust staticlib so
/// XCTest exercises the REAL native core (no mocks).  Build them first with
/// tools/build_host_bridge.sh.
let hostBridgeLinkerSettings: [LinkerSetting] = [
    .unsafeFlags([
        "-L\(repoRoot)/dist/host",
        "-lcaelus_host_bridge",
        "-lcaelus_network",
        // Versioned soname: Ubuntu images often lack the unversioned
        // libstdc++.so dev symlink in the linker's default search path.
        "-Xlinker", "-l:libstdc++.so.6",
        "-ldl",
        "-lpthread",
        "-lm",
    ])
]
#else
/// Apple platforms: the app target links dist/ios/CaelusCore.xcframework
/// (tools/build_ios_core.sh); the package itself adds no linker flags so it
/// stays consumable from Xcode without unsafe-flag restrictions.
let hostBridgeLinkerSettings: [LinkerSetting] = []
#endif

var targets: [Target] = [
    .target(
        name: "CaelusBridgeC",
        path: "Sources/CaelusBridgeC"
    ),
    .target(
        name: "CAELUSMobileCore",
        dependencies: ["CaelusBridgeC"],
        path: "Sources/CAELUSMobileCore"
    ),
    .target(
        name: "CAELUSMobileUI",
        dependencies: ["CAELUSMobileCore"],
        path: "Sources/CAELUSMobileUI"
    ),
    .testTarget(
        name: "CAELUSMobileCoreTests",
        dependencies: ["CAELUSMobileCore"],
        path: "Tests/CAELUSMobileCoreTests",
        linkerSettings: hostBridgeLinkerSettings
    ),
]

#if os(Linux)
// Headless BS-01 end-to-end demonstration through the exact mobile stack
// (Swift EngineController → C ABI → shared core).  Linux-only target so the
// package stays consumable from Xcode without unsafe linker flags.
targets.append(
    .executableTarget(
        name: "caelus-mobile-demo",
        dependencies: ["CAELUSMobileCore"],
        path: "Sources/CaelusMobileDemo",
        linkerSettings: hostBridgeLinkerSettings
    )
)
#endif

let package = Package(
    name: "CAELUSMobile",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "CAELUSMobileCore", targets: ["CAELUSMobileCore"]),
        .library(name: "CAELUSMobileUI", targets: ["CAELUSMobileUI"]),
    ],
    targets: targets,
    cxxLanguageStandard: .cxx17
)
