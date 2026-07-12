//
//  CAELUSMobileApp.swift
//  CAELUS Mobile — iOS application target
//
//  Deliberately minimal: every feature, model, and view lives in the
//  CAELUSMobile Swift package (reviewable + Linux-testable core).  This
//  target only provides the @main entry point, the bundled resources, and
//  the link against CaelusCore.xcframework (tools/build_ios_core.sh).
//
import CAELUSMobileUI
import SwiftUI

@main
struct CAELUSMobileApp: App {
    var body: some Scene {
        CaelusMobileAppScene()
    }
}
