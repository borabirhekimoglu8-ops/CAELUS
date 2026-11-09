//
//  KeychainKeyProtection.swift
//  CAELUSMobileCore
//
//  iOS/macOS key-protection provider: the device identity seed is wrapped
//  with AES-GCM under a random 256-bit wrapping key that lives ONLY in the
//  Keychain (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly — survives
//  app relaunch, never leaves the device, never lands in backups that
//  restore to another device).
//
//  Why wrap-then-store instead of storing the seed in the Keychain
//  directly: the Rust identity layer owns the identity FILE format and its
//  atomic-replace semantics (shared with desktop).  Wrapping keeps that
//  single code path while guaranteeing the file content is useless without
//  this device's Keychain entry.
//
//  Compiled only where CryptoKit + Security exist (iOS 16+/macOS 13+
//  per Package.swift); Linux hosts use a test provider instead.
//
#if canImport(CryptoKit) && canImport(Security)
import CryptoKit
import Foundation
import Security

public struct KeychainKeyProtection: KeyProtectionProvider {
    /// Keychain identity of the wrapping key entry.
    public let service: String
    public let account: String

    public init(service: String = "com.caelus.mobile.identity-wrap",
                account: String = "device-identity-v1") {
        self.service = service
        self.account = account
    }

    public func protect(rawSeed: [UInt8]) -> ProtectedKeyMaterial? {
        guard rawSeed.count == 32, let key = loadOrCreateWrappingKey() else {
            return nil
        }
        do {
            let sealed = try AES.GCM.seal(Data(rawSeed), using: key)
            guard let combined = sealed.combined else { return nil }
            return ProtectedKeyMaterial(bytes: Array(combined),
                                        format: KeyBlobFormat.protectedOS)
        } catch {
            return nil
        }
    }

    public func unprotect(material: ProtectedKeyMaterial) -> [UInt8]? {
        guard material.format == KeyBlobFormat.protectedOS,
              let key = loadWrappingKey() else {
            return nil
        }
        do {
            let box = try AES.GCM.SealedBox(combined: Data(material.bytes))
            let seed = try AES.GCM.open(box, using: key)
            guard seed.count == 32 else { return nil }
            return Array(seed)
        } catch {
            return nil
        }
    }

    // MARK: Keychain plumbing

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private func loadWrappingKey() -> SymmetricKey? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data,
              data.count == 32 else {
            return nil
        }
        return SymmetricKey(data: data)
    }

    private func loadOrCreateWrappingKey() -> SymmetricKey? {
        if let existing = loadWrappingKey() { return existing }

        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        var attributes = baseQuery()
        attributes[kSecValueData as String] = keyData
        attributes[kSecAttrAccessible as String] =
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecSuccess { return key }
        if status == errSecDuplicateItem {
            // Concurrent first-run creation: the other writer won; use theirs
            // so wrap/unwrap stay consistent.
            return loadWrappingKey()
        }
        return nil
    }
}
#endif
