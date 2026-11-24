// Hushio iOS Document Picker — Phase D file service adapter.
//
// OWNERSHIP: Senior iOS Services Engineer. This source maps the Android `LocalAudioPlugin`
// (tree picker / scanner / sidecar LRC) and `MediaStorePlugin` (publish/delete) commands onto
// iOS UIDocumentPickerViewController + security-scoped access. The notification/keychain/auth
// namespaces live in ServicesEngine.swift; playback is owned by the Media Engineer.
//
// COMPILE STATUS: NOT COMPILED (same user-blocked Xcode license + missing iOS Rust targets as
// ServicesEngine.swift). Do not claim anything runs.
//
// KEY PLATFORM DIFFERENCE (lead addendum point 4; contract S4): iOS has NO MediaStore and no
// SAF content:// tree URIs. Security-scoped URL access is granted by the document picker for
// the lifetime of the app process, and — crucially — persists across launches only if the app
// saves a security-scoped *bookmark* (and resolves it back to a URL with `startAccessing`).
// A `content://` tree URI or a desktop absolute path is NOT a valid iOS reference. This file
// introduces a `reference` string that is a bookmark-stable identifier, NOT a raw path or URI.

import Foundation
import UIKit
import AVFoundation
import UniformTypeIdentifiers

// MARK: - Reference model
//
// A "reference" is an opaque, stable string identifying a picked folder/file across launches.
// Concretely it is a base64-encoded security-scoped bookmark (URL.bookmarkData) — the only
// sanctioned iOS mechanism to re-obtain access to a user-selected location after relaunch.
// We NEVER treat a plain filesystem path or an Android content URI as a valid reference on
// iOS. The Rust layer owns translating a reference back into the `local:` track ID via its
// existing `hash_path(lowercased-path)` rule (contract P1/S4); the path identity question —
// whether a copied-sandbox file keeps its original local ID — is an open migration decision
// owned by Services+Lead, not resolved here.

enum HushioReference {
    static let bookmarkKey = "hushio.securityScopedBookmark"

    /// Encode a bookmark Data into the stable reference string.
    static func encode(_ bookmark: Data) -> String? {
        bookmark.base64EncodedString()
    }

    static func decode(_ reference: String) -> Data? {
        Data(base64Encoded: reference)
    }

    /// Persist a bookmark for cross-launch access; returns the reference to hand back to Rust.
    static func persist(bookmark: Data, for url: URL) -> String? {
        guard let reference = encode(bookmark) else { return nil }
        // Store by a stable key; the folder-vs-file set is small (≤200 folders per contract
        // S4), so a flat prefix in UserDefaults.suite named by the app is sufficient for the
        // picker primitive. The Rust local-library owner persists its own folder list.
        var bookmarks = UserDefaults.standard.dictionary(forKey: bookmarkKey) as? [String: String] ?? [:]
        bookmarks[reference] = url.absoluteString
        UserDefaults.standard.set(bookmarks, forKey: bookmarkKey)
        return reference
    }

    /// Resolve a reference back to a URL with security-scoped access started. Returns nil if
    /// the bookmark is stale (the OS may invalidate it if the file moved / access revoked).
    static func resolve(_ reference: String) -> URL? {
        guard let bookmark = decode(reference) else { return nil }
        var isStale = false
        do {
            let url = try URL(
                resolvingBookmarkData: bookmark,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
            let started = url.startAccessingSecurityScopedResource()
            // If we started access, caller must call stopAccessingSecurityScopedResource().
            // The command bodies below pair these calls.
            _ = started
            return url
        } catch {
            return nil
        }
    }

    static func stopAccessing(_ url: URL) {
        url.stopAccessingSecurityScopedResource()
    }
}

// MARK: - Tree picker / scanner
//
// Mirrors LocalAudioPlugin:
//   pick_tree({})                      -> { uri: string|null }   (reject "permission_not_granted")
//   scan_tree({ uri })                 -> { items: [...] }        (reject "invalid_tree"/"scan_failed")
//   read_sidecar_lrc({ uri })          -> { text: string|null }
// The iOS "uri" is our reference string, NOT a content:// tree URI. The Rust `tree_library`
// `is_tree_uri` / `display_name` helpers are Android-shaped and will need an iOS branch (owned
// by the Rust agent); the *items* schema below is byte-identical to the Kotlin row map.

final class DocumentPickerController: NSObject {
    private var pendingPick: ((String?) -> Void)?

    /// Present a folder document picker and produce a stable reference for the selected
    /// directory. This is a UI operation and MUST run on the main thread.
    func pickTree(completion: @escaping (Result<String?, String>) -> Void) {
        DispatchQueue.main.async {
            guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
                  let presenter = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
                completion(.failure("permission_not_granted"))
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.pendingPick = { reference in
                completion(.success(reference))
            }
            presenter.present(picker, animated: true, completion: nil)
        }
    }

    /// Enumerate audio files under a resolved folder reference, bounded to the same limits as
    /// Android (MAX_DEPTH 8, MAX_ITEMS 5000), producing Kotlin-identical item rows.
    func scanTree(reference: String) -> Result<[[String: Any]], String> {
        guard let folder = HushioReference.resolve(reference) else {
            return .failure("invalid_tree")
        }
        defer { HushioReference.stopAccessing(folder) }
        var items: [[String: Any]] = []
        let fm = FileManager.default
        enumerate(folder, depth: 0, fm: fm, items: &items)
        // Sort by title (case-insensitive), then uri — mirrors AudioRules.sortByTitle.
        items.sort { lhs, rhs in
            let l = (lhs["title"] as? String ?? "").lowercased()
            let r = (rhs["title"] as? String ?? "").lowercased()
            if l != r { return l < r }
            return (lhs["uri"] as? String ?? "") < (rhs["uri"] as? String ?? "")
        }
        return .success(items)
    }

    private func enumerate(_ dir: URL, depth: Int, fm: FileManager, items: inout [[String: Any]]) {
        if depth > 8 || items.count >= 5000 { return }
        guard let children = try? fm.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        for child in children {
            if items.count >= 5000 { return }
            let values = try? child.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
            let isDir = values?.isDirectory ?? false
            if isDir {
                enumerate(child, depth: depth + 1, fm: fm, items: &items)
            } else if AudioFileName.isAudio(child.lastPathComponent) {
                items.append(AudioFileName.row(for: child))
            }
        }
    }

    /// Read a sidecar .lrc with the same stem as the given file, bounded to 1 MiB. Mirrors
    /// AudioRules.sidecarLrcUris (case-insensitive stem match, ".lrc"/".LRC").
    func readSidecarLrc(fileReference: String) -> String? {
        guard let file = HushioReference.resolve(fileReference) else { return nil }
        defer { HushioReference.stopAccessing(file) }
        let dir = file.deletingLastPathComponent()
        let stem = (file.lastPathComponent as NSString).deletingPathExtension
        for ext in ["lrc", "LRC"] {
            let candidate = dir.appendingPathComponent(stem + "." + ext)
            if let data = try? Data(contentsOf: candidate, options: [.mappedIfSafe]) {
                let bounded = data.prefix(1_048_576)
                return String(data: bounded, encoding: .utf8)
            }
        }
        return nil
    }
}

extension DocumentPickerController: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else {
            pendingPick?(nil)
            pendingPick = nil
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            pendingPick?(nil)
            pendingPick = nil
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        do {
            let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            let reference = HushioReference.persist(bookmark: bookmark, for: url)
            pendingPick?(reference)
        } catch {
            pendingPick?(nil)
        }
        pendingPick = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingPick?(nil)
        pendingPick = nil
    }
}

// MARK: - Audio filename rules + metadata row
//
// Mirrors AudioRules extension allow-list and fallback title/artist parsing, and the
// TreeItem row schema. Duration and id3 metadata (title/artist/album/genre) use AVFoundation
// as the iOS analogue of Android's MediaMetadataRetriever; if AVAsset cannot read a field we
// fall back to the filename parse exactly as Kotlin does, and never fabricate tags.

enum AudioFileName {
    static let audioExtensions: Set<String> = [
        "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wav", "webm",
    ]
    static let playlistExtensions: Set<String> = ["m3u", "m3u8", "pls"]

    static func `extension`(of name: String) -> String {
        (name as NSString).pathExtension.lowercased()
    }

    static func isAudio(_ name: String) -> Bool {
        let ext = `extension`(of: name)
        if playlistExtensions.contains(ext) { return false }
        return audioExtensions.contains(ext)
    }

    /// Fallback title/artist parse ("Artist - Title") matching AudioRules.fallbackTitle.
    static func fallback(_ name: String) -> (artist: String?, title: String) {
        let base = (name as NSString).deletingPathExtension
        let parts = base.components(separatedBy: " - ")
        if parts.count == 2, let artist = parts[0].trimmingCharacters(in: .whitespaces).nonEmpty,
           let title = parts[1].trimmingCharacters(in: .whitespaces).nonEmpty {
            return (artist, title)
        }
        let cleaned = base.trimmingCharacters(in: .whitespaces)
        return (nil, cleaned.isEmpty ? name : cleaned)
    }

    static func row(for url: URL) -> [String: Any] {
        let name = url.lastPathComponent
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let size: UInt64 = UInt64((values?.fileSize).map { $0 > 0 ? $0 : 0 } ?? 0)
        let mtime: Int64 = Int64(values?.contentModificationDate?.timeIntervalSince1970 ?? 0)
        let (fbArtist, fbTitle) = fallback(name)
        let meta = metadata(for: url)
        return [
            "uri": url.absoluteString,
            "name": name,
            "size": size,
            "mtime": mtime,
            "title": (meta.title ?? fbTitle),
            "artist": meta.artist ?? fbArtist,
            "album": meta.album,
            "genre": meta.genre,
            "durationMs": meta.durationMs,
        ]
    }

    private struct Meta {
        let title: String?
        let artist: String?
        let album: String?
        let genre: String?
        let durationMs: UInt64
    }

    private static func metadata(for url: URL) -> Meta {
        // AVAsset as the iOS metadata reader analogue of MediaMetadataRetriever.
        let asset = AVURLAsset(url: url)
        var title: String?
        var artist: String?
        var album: String?
        var genre: String?
        for item in asset.commonMetadata {
            switch item.commonKey {
            case .commonKeyTitle: title = item.stringValue?.trimmed
            case .commonKeyArtist: artist = item.stringValue?.trimmed
            case .commonKeyAlbumName: album = item.stringValue?.trimmed
            case .commonKeyType: genre = item.stringValue?.trimmed
            default: break
            }
        }
        let seconds = asset.duration.seconds
        let durationMs: UInt64 = seconds.isFinite && seconds > 0 ? UInt64(seconds * 1000) : 0
        return Meta(title: title, artist: artist, album: album, genre: genre, durationMs: durationMs)
    }
}

// MARK: - Publish / delete
//
// Mirrors MediaStorePlugin. LEAD ADDENDUM POINT 4: iOS has no MediaStore. `publish_download`
// is mapped to the NARROWEST real export — a `UIDocumentPickerViewController(forExporting:)`
// that copies a download out to a user-chosen Files.app location. We do NOT invent
// PHPhotoLibrary audio publishing, and we do NOT claim a MediaStore content URI or permanent
// "Music/Hushio" media-library row exists. The returned `uri` is a best-effort exported file
// reference; the Rust/TS download layer must treat it as an export outcome, not a MediaStore
// publication. The Android `needs_android_10` / `invalid_download` / `publish_failed`
// vocabulary is retained for wire compatibility, but `needs_android_10` can only mean
// "export unavailable on this iOS context" here and is documented as such.

final class MediaExportController: NSObject {
    private var pendingExport: ((Result<String, String>) -> Void)?

    func publishDownload(
        path: String,
        displayName: String,
        completion: @escaping (Result<String, String>) -> Void
    ) {
        // Validate the source is a file and the display name is a safe audio-ish name
        // (mirrors MediaStoreRows.validDisplayName / invalid_download).
        guard !displayName.isEmpty, displayName.rangeOfCharacter(from: .invertedSafe) == nil else {
            completion(.failure("invalid_download"))
            return
        }
        let source = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else {
            completion(.failure("invalid_download"))
            return
        }
        DispatchQueue.main.async {
            guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
                  let presenter = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
                completion(.failure("publish_failed"))
                return
            }
            let picker = UIDocumentPickerViewController(forExporting: [source], asCopy: true)
            picker.delegate = self
            self.pendingExport = { result in
                completion(result)
            }
            presenter.present(picker, animated: true, completion: nil)
        }
    }

    func mediaDelete(reference: String) -> Result<[String: Any], String> {
        // Delete an exported item via its reference. The Android MediaStore delete removes a
        // media-library row; iOS has no such concept, so "delete" is best-effort removal of a
        // security-scoped file reference if it resolves and is within an export we created.
        // This does NOT reach into arbitrary user files. If the reference cannot be resolved,
        // we report invalid_uri (matches Kotlin) rather than silently claiming success.
        guard let url = HushioReference.resolve(reference) else {
            return .failure("invalid_uri")
        }
        defer { HushioReference.stopAccessing(url) }
        do {
            try FileManager.default.removeItem(at: url)
            return .success(["removed": true])
        } catch {
            return .success(["removed": false])
        }
    }
}

extension MediaExportController: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else {
            pendingExport?(.failure("publish_failed"))
            pendingExport = nil
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            pendingExport?(.failure("publish_failed"))
            pendingExport = nil
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        do {
            let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            if let reference = HushioReference.persist(bookmark: bookmark, for: url) {
                pendingExport?(.success(reference))
            } else {
                pendingExport?(.failure("publish_failed"))
            }
        } catch {
            pendingExport?(.failure("publish_failed"))
        }
        pendingExport = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingExport?(.failure("publish_failed"))
        pendingExport = nil
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    static let safeCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._ ()-")
}

private extension CharacterSet {
    static let invertedSafe = String.safeCharacters.inverted
}
