// Wire-facing Swift results carry error strings (matching the Rust/Kotlin wire error
// codes: "unknown_key", "secret_failed", "invalid_url", …) rather than rich Swift error
// types. `String` needs a trivial Error conformance for those `Result<_, String>` values.
extension String: Error {}
