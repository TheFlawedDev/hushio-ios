//
//  ContainerDuration.swift
//  Hushio iOS player plugin — the honest length of a fragmented MP4
//
//  Why this exists
//  ---------------
//  The stream CDN serves audio as a **fragmented** MP4 whose `moov` still carries a non-zero
//  `mvhd` duration *and* a `sidx`/`moof` fragment table of the same length. ISO-BMFF requires
//  `mvhd.duration == 0` for a fragmented movie, and AVFoundation does not tolerate the
//  violation: it **sums** the two, so `AVPlayerItem.duration`, `AVAsset.duration`,
//  `AVAssetTrack.timeRange` and `seekableTimeRanges` all report roughly twice the truth
//  (measured: 221.53 s for a 110.77 s track). The extra half of the timeline is empty, so the
//  scrubber runs past the end of the song and playback sits in silence instead of finishing.
//
//  No public AVFoundation API exposes the un-doubled value, but the container declares it
//  plainly in `mvhd` (and `mehd` for the fragmented case). This file reads those boxes from
//  the first bytes of the media and answers with the duration the file itself states.
//
//  Scope: progressive/fragmented MP4 only. An HLS playlist, a file whose `moov` sits at the
//  end outside the probe window, or anything unparsable returns `nil`, and the caller keeps
//  whatever AVFoundation reported — this helper never invents a number.
//

import Foundation

enum ContainerDuration {
    /// Bytes fetched from the head of the media. Every real-world `moov` for a progressive or
    /// fragmented MP4 the app streams sits at the front, well inside this window (`ftyp` plus
    /// a ~1 KB `moov` for the observed streams).
    static let probeBytes = 65_536
    private static let maxReasonableSeconds = 24.0 * 60 * 60

    /// Declared duration in milliseconds, or `nil` when the window holds no usable box.
    ///
    /// `mvhd` wins when non-zero. A spec-compliant fragmented file leaves it at 0 and puts the
    /// real total in `mehd.fragment_duration`; a non-fragmented file only has `mvhd`.
    static func duration(in data: Data) -> Int64? {
        guard let moov = findTopLevelBox("moov", in: data, range: 0..<data.count) else { return nil }
        if let declared = movieHeaderDuration(in: data, range: moov) {
            return declared
        }
        return fragmentDuration(in: data, range: moov)
    }

    /// Reads the head of a local file or the first `probeBytes` of a network URL.
    ///
    /// The completion always arrives on the main queue, and carries `nil` for any failure:
    /// this is a best-effort refinement, never a hard dependency of playback.
    static func read(
        url: URL,
        headers: [String: String],
        completion: @escaping (Int64?) -> Void
    ) {
        if url.isFileURL {
            DispatchQueue.global(qos: .utility).async {
                let handle = try? FileHandle(forReadingFrom: url)
                let head = ((try? handle?.read(upToCount: probeBytes)) ?? nil) ?? Data()
                try? handle?.close()
                let result = head.isEmpty ? nil : duration(in: head)
                DispatchQueue.main.async { completion(result) }
            }
            return
        }

        var request = URLRequest(url: url)
        request.setValue("bytes=0-\(probeBytes - 1)", forHTTPHeaderField: "Range")
        for (field, value) in headers {
            request.setValue(value, forHTTPHeaderField: field)
        }
        Task.detached(priority: .utility) {
            var head = Data()
            head.reserveCapacity(probeBytes)
            do {
                // `bytes(for:)` streams, so a server that ignores `Range` is cancelled after
                // the probe window instead of buffering the whole file.
                let (stream, _) = try await URLSession.shared.bytes(for: request)
                for try await byte in stream {
                    head.append(byte)
                    if head.count >= probeBytes { break }
                }
            } catch {
                head = Data()
            }
            let result = head.isEmpty ? nil : duration(in: head)
            await MainActor.run { completion(result) }
        }
    }

    // MARK: - ISO-BMFF walking

    private struct Box {
        let type: String
        let payload: Range<Int>
    }

    /// One level of boxes inside `range`. Sizes of 0 (to end of data) and 1 (64-bit largesize)
    /// are both accepted; the walk stops at the first box that claims more bytes than the
    /// window holds, because everything after it is outside the probe.
    private static func boxes(in data: Data, range: Range<Int>) -> [Box] {
        var boxes: [Box] = []
        var cursor = range.lowerBound
        while cursor + 8 <= range.upperBound {
            let size = Int(be32(data, cursor))
            let type = fourCC(data, cursor + 4)
            var header = 8
            var length = size
            if size == 1 {
                guard cursor + 16 <= range.upperBound else { break }
                let large = be64(data, cursor + 8)
                guard large <= UInt64(Int.max) else { break }
                length = Int(large)
                header = 16
            } else if size == 0 {
                length = range.upperBound - cursor
            }
            guard length >= header, cursor + length <= range.upperBound else { break }
            boxes.append(Box(type: type, payload: (cursor + header)..<(cursor + length)))
            cursor += length
        }
        return boxes
    }

    private static func findTopLevelBox(_ type: String, in data: Data, range: Range<Int>) -> Range<Int>? {
        boxes(in: data, range: range).first { $0.type == type }?.payload
    }

    /// `mvhd`: version/flags, then creation, modification, timescale, duration (32-bit, or
    /// 64-bit duration in version 1).
    private static func movieHeaderDuration(in data: Data, range: Range<Int>) -> Int64? {
        guard let mvhd = boxes(in: data, range: range).first(where: { $0.type == "mvhd" })?.payload else {
            return nil
        }
        let base = mvhd.lowerBound
        guard base + 4 <= mvhd.upperBound else { return nil }
        let version = data[base]
        if version == 1 {
            guard base + 32 <= mvhd.upperBound else { return nil }
            return milliseconds(ticks: be64(data, base + 24), timescale: be32(data, base + 20))
        }
        guard base + 20 <= mvhd.upperBound else { return nil }
        return milliseconds(ticks: UInt64(be32(data, base + 16)), timescale: be32(data, base + 12))
    }

    /// `mvex/mehd/fragment_duration`: the total for a spec-compliant fragmented movie.
    private static func fragmentDuration(in data: Data, range: Range<Int>) -> Int64? {
        guard let mvex = findTopLevelBox("mvex", in: data, range: range),
              let mehd = boxes(in: data, range: mvex).first(where: { $0.type == "mehd" })?.payload
        else { return nil }
        let base = mehd.lowerBound
        guard base + 4 <= mehd.upperBound else { return nil }
        if data[base] == 1 {
            guard base + 12 <= mehd.upperBound else { return nil }
            // `mehd` carries no timescale, so it is expressed in the movie timescale.
            guard let mvhd = movieTimescale(in: data, range: range) else { return nil }
            return milliseconds(ticks: be64(data, base + 4), timescale: mvhd)
        }
        guard base + 8 <= mehd.upperBound else { return nil }
        guard let timescale = movieTimescale(in: data, range: range) else { return nil }
        return milliseconds(ticks: UInt64(be32(data, base + 4)), timescale: timescale)
    }

    private static func movieTimescale(in data: Data, range: Range<Int>) -> UInt32? {
        guard let mvhd = boxes(in: data, range: range).first(where: { $0.type == "mvhd" })?.payload else {
            return nil
        }
        let base = mvhd.lowerBound
        guard base + 4 <= mvhd.upperBound else { return nil }
        if data[base] == 1 {
            guard base + 24 <= mvhd.upperBound else { return nil }
            return be32(data, base + 20)
        }
        guard base + 16 <= mvhd.upperBound else { return nil }
        return be32(data, base + 12)
    }

    private static func milliseconds(ticks: UInt64, timescale: UInt32) -> Int64? {
        guard timescale > 0, ticks > 0 else { return nil }
        let seconds = Double(ticks) / Double(timescale)
        guard seconds.isFinite, seconds > 0, seconds < maxReasonableSeconds else { return nil }
        return Int64((seconds * 1000).rounded())
    }

    private static func be32(_ data: Data, _ offset: Int) -> UInt32 {
        let start = data.startIndex + offset
        return data[start..<start + 4].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    }

    private static func be64(_ data: Data, _ offset: Int) -> UInt64 {
        let start = data.startIndex + offset
        return data[start..<start + 8].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    }

    private static func fourCC(_ data: Data, _ offset: Int) -> String {
        let start = data.startIndex + offset
        return String(decoding: data[start..<start + 4], as: UTF8.self)
    }
}
