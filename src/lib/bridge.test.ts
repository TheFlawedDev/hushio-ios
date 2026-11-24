import { describe, expect, it } from "vitest";
import { detectPlatform } from "./bridge";

describe("detectPlatform", () => {
  it("maps desktop and Android user agents", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5)")).toBe("macos");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
  });

  it("detects iPhone, iPad and iPod before the Mac OS X branch", () => {
    expect(
      detectPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("ios");
    expect(
      detectPlatform(
        "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("ios");
    expect(
      detectPlatform(
        "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("ios");
  });

  it("keeps a bare Macintosh user agent on macOS", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macos");
  });

  it("refuses unknown user agents", () => {
    expect(() => detectPlatform("Mozilla/5.0 (Unknown Device)")).toThrow("Unsupported platform");
  });
});
