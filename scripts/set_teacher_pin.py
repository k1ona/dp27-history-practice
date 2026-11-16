"""Sets the PIN that unlocks Teacher mode in the app.

Run: python3 scripts/set_teacher_pin.py YOUR-PIN

Writes a fresh random salt and the matching hash into app/config.json. The PIN itself
is never written anywhere, only its hash, which is why app/config.json is safe to keep
in a public repository. Commit and push app/config.json afterwards, and redeploy, for
the new PIN to take effect on the live site.
"""
import hashlib
import json
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        print("Usage: python3 scripts/set_teacher_pin.py YOUR-PIN")
        raise SystemExit(1)
    pin = sys.argv[1].strip()
    salt = secrets.token_hex(16)
    digest = hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest()
    cfg_path = ROOT / "app" / "config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    cfg["teacherPinHash"] = digest
    cfg["teacherPinSalt"] = salt
    cfg_path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    print(f"Teacher PIN set. {cfg_path} was updated (the PIN itself was not saved anywhere).")
    print("Commit and push app/config.json, then redeploy, for the new PIN to take effect on the live site.")


if __name__ == "__main__":
    main()
