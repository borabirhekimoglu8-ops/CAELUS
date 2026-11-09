//
//  BiometricAuthorizer.swift
//  CAELUSMobileUI
//
//  Face ID / Touch ID / passcode confirmation of user INTENT for critical
//  actions.  This never replaces cryptographic validation — the native core
//  verifies signatures unconditionally; biometrics only prove that the
//  person holding the device meant to trigger the action.
//
import CAELUSMobileCore
import Foundation

#if canImport(LocalAuthentication)
import LocalAuthentication

public struct BiometricAuthorizer: UserIntentAuthorizer {
    public init() {}

    public func confirmIntent(for action: CriticalAction,
                              reason: String) async -> Bool {
        let context = LAContext()
        context.localizedReason = reason
        var probeError: NSError?
        // Biometrics with passcode fallback; fail closed when neither is
        // available (an unprotected device cannot confirm intent).
        let policy = LAPolicy.deviceOwnerAuthentication
        guard context.canEvaluatePolicy(policy, error: &probeError) else {
            return false
        }
        do {
            return try await context.evaluatePolicy(
                policy,
                localizedReason: "\(action.displayName): \(reason)")
        } catch {
            return false
        }
    }
}
#endif
