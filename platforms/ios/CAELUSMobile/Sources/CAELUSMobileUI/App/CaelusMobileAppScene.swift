//
//  CaelusMobileAppScene.swift
//  CAELUSMobileUI
//
//  The complete app scene.  The Xcode application target stays a single
//  file:
//
//      import CAELUSMobileUI
//      import SwiftUI
//
//      @main
//      struct CAELUSMobileApp: App {
//          var body: some Scene { CaelusMobileAppScene() }
//      }
//
//  keeping every feature inside the reviewable, testable Swift package.
//
#if os(iOS) && canImport(SwiftUI)
import SwiftUI

public struct CaelusMobileAppScene: Scene {
    public init() {}

    public var body: some Scene {
        WindowGroup {
            CaelusRootView()
        }
    }
}
#endif
