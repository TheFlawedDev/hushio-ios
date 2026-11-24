// P8 controlled-audio probe: drives the SHIPPING PlayerEngine (same source file that is
// compiled into the app) against a deterministic local WAV on the iOS simulator runtime.
// It asserts real AVPlayer progression, pause, and seek — no mocks, no fabricated state.

import AVFoundation
import Foundation

func fail(_ message: String) -> Never {
  print("P8 FAIL: \(message)")
  exit(1)
}

let wavPath = "/tmp/p8/tone.wav"
guard FileManager.default.fileExists(atPath: wavPath) else {
  fail("missing \(wavPath)")
}

let engine = PlayerEngine()
var snapshots: [PlayerSnapshot] = []
engine.onSnapshot = { snapshots.append($0) }
engine.onError = { id, code, message, _ in
  print("engine error id=\(id) code=\(code) message=\(message)")
}

let item = PlayerQueueItem(
  id: "local:p8-probe",
  title: "P8 Tone",
  artist: "Probe",
  durationMs: 8000,
  url: "",
  headers: [:],
  liked: false,
  expiresAtEpochMs: nil,
  contentUri: "file://" + wavPath,
  artworkUrl: nil
)

let accepted = engine.setQueue([item], startIndex: 0, startPositionMs: 0)
guard accepted == 1 else { fail("setQueue accepted \(accepted)") }

engine.play()

func pump(seconds: Double) {
  RunLoop.current.run(until: Date().addingTimeInterval(seconds))
}

// 1) duration must come from the decoded asset, not the wire hint
pump(seconds: 1.5)
let afterLoad = engine.state()
print("P8 after load: playing=\(afterLoad.playing) buffering=\(afterLoad.buffering) "
  + "positionMs=\(afterLoad.positionMs) durationMs=\(afterLoad.durationMs) id=\(afterLoad.id ?? "nil")")
guard afterLoad.durationMs >= 7000 && afterLoad.durationMs <= 9000 else {
  fail("decoded duration \(afterLoad.durationMs)ms is not the ~8000ms WAV")
}

// 2) real progression
let p0 = afterLoad.positionMs
pump(seconds: 2.0)
let moving = engine.state()
print("P8 progression: \(p0)ms -> \(moving.positionMs)ms playing=\(moving.playing) buffering=\(moving.buffering)")
guard moving.positionMs > p0 + 800 else {
  fail("position did not advance (still \(moving.positionMs)ms)")
}
guard moving.playing else { fail("engine reports not playing while advancing") }

// 3) pause holds position
engine.pause()
pump(seconds: 0.4)
let paused = engine.state()
pump(seconds: 1.0)
let stillPaused = engine.state()
print("P8 pause: paused=\(paused.playing) \(paused.positionMs)ms -> \(stillPaused.positionMs)ms")
guard !paused.playing && !stillPaused.playing else { fail("pause did not hold") }
guard abs(stillPaused.positionMs - paused.positionMs) < 500 else {
  fail("position advanced while paused")
}

// 4) seek
engine.seek(6000)
pump(seconds: 0.6)
let sought = engine.state()
print("P8 seek: positionMs=\(sought.positionMs)")
guard sought.positionMs >= 5500 && sought.positionMs <= 6800 else {
  fail("seek to 6000ms landed at \(sought.positionMs)ms")
}

// 5) snapshot stream is non-empty and id-tagged
guard !snapshots.isEmpty else { fail("no snapshots emitted") }
guard snapshots.contains(where: { $0.id == "local:p8-probe" }) else {
  fail("snapshots are not tagged with the current item id")
}

print("P8 PASS: snapshots=\(snapshots.count) decodedDurationMs=\(afterLoad.durationMs) "
  + "advancedTo=\(moving.positionMs)ms seek=\(sought.positionMs)ms")
engine.invalidate()
