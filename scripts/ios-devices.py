#!/usr/bin/env python3
"""Print the iOS devices Xcode can actually use, with the reason when it cannot.

`devicectl` reports *pairing*; `xcdevice` reports what Xcode will build for, and its
per-device `error.description` is the actionable sentence ("not paired", "Developer Mode
disabled", "browsing on the local area network"). Only the latter decides whether a
device build can sign, so this helper prints that view.

Output (human readable, used by scripts/ios-signing-check.sh):
    <name>|<available>|<reason>
and a final line:
    DEVELOPER_MODE=<Enabled|Disabled|Unknown>
"""
import json
import subprocess
import sys

DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer"


def run(args: list[str]) -> str:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=60,
            env={"DEVELOPER_DIR": DEVELOPER_DIR, "PATH": "/usr/bin:/bin:/usr/sbin:/sbin"},
        ).stdout
    except Exception:
        return ""


def devices() -> list[dict]:
    raw = run(["xcrun", "xcdevice", "list"])
    try:
        items = json.loads(raw)
    except Exception:
        return []
    return [
        item
        for item in items
        if not item.get("simulator") and str(item.get("platform", "")).endswith("iphoneos")
    ]


def developer_mode(name: str) -> str:
    if not name:
        return "Unknown"
    out = run(["xcrun", "devicectl", "device", "info", "details", "--device", name])
    for line in out.splitlines():
        if "Developer Mode Status:" in line:
            return line.split(":", 1)[1].strip() or "Unknown"
    return "Unknown"


def main() -> int:
    rows = devices()
    if not rows:
        print("NO_DEVICES")
        print("DEVELOPER_MODE=Unknown")
        return 0
    for item in rows:
        name = item.get("name") or "?"
        available = "yes" if item.get("available") else "no"
        reason = (item.get("error") or {}).get("description") or "ready"
        print(f"{name}|{available}|{reason}")
    print(f"DEVELOPER_MODE={developer_mode(rows[0].get('name') or '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
