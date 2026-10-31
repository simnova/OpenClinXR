"""Re-pin case stage-3 output shas from recorded run dirs (card tsk_3dc1802d0ca2b36c).

Modes:
  placeholder  set the beard/detail expected pins for aisha+body2 to all-zero
               with a placeholder source (re-pin run A records placeholder
               expectations; the seven-stages (report) test routes them iff
               the live pins equal the run actuals after rederive).
  rederive     set the same pins to the actual output shas of the named run
               dirs (run A), with sources naming the run files.

Surgical text replacement only: every old snippet is read from the parsed
JSON (never typed), and each replacement asserts exactly one occurrence, so
the diff touches only the intended value/source lines. No skin script is
touched.

Usage (python only via mise, R3):
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/evidence/station-skin-int/repin_case_pins.py \
    --root <worktree> --mode placeholder
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/evidence/station-skin-int/repin_case_pins.py \
    --root <worktree> --mode rederive --runs aisha:5,body2:8
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

CARD = "tsk_3dc1802d0ca2b36c"
FACE_REL = "packages/openclinxr/stations/face-realism/src/case-inputs.json"
CASES_DIR = "/Volumes/files/openclinxr-assets/store/face-station-cases"
ZERO = "0" * 64
PIN_KEYS = ("stage3_beard", "stage3_detail")
OUT_FILES = {"stage3_beard": "albedo_beard.png", "stage3_detail": "albedo_detail.png"}
CASES = ("aisha", "body2")


def sha_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace_pin(
    text: str, old_value: str, old_source: str, new_value: str, new_source: str, what: str
) -> str:
    """Replace one expected_out_sha256 value+source pair atomically.

    Both snippets are read from the parsed JSON (never typed). The source
    string is asserted unique. `what` scopes the search to one case block
    (`cases.<case>`), because placeholder sources repeat across cases: the
    value must sit on the immediately preceding line (the file's
    value-then-source schema), so a sha shared with another pin (e.g. the
    aisha socket sha reused by the beard pin) cannot collide.
    """
    case, _, key = what.partition(".")
    block_start = text.find(f'\n  "{case}": {{')
    if block_start == -1:
        raise SystemExit(f"refused: {what}: case block not found")
    rest = text[block_start + 1 :]
    m = re.search(r'\n  "[a-z0-9_]+": \{', rest)
    block_end = block_start + 1 + (m.start() + 1 if m else len(rest))
    block = text[block_start:block_end]
    key_at = block.find(f'"{key}": {{')
    if key_at == -1:
        raise SystemExit(f"refused: {what}: key block not found")
    nxt = re.search(r'"stage3_\w+": \{', block[key_at + len(key) :])
    window = block[key_at : key_at + len(key) + nxt.start()] if nxt else block[key_at:]
    src_snip = f'"source": "{old_source}"'
    if window.count(src_snip) != 1:
        raise SystemExit(f"refused: {what}.source occurs {window.count(src_snip)}x in case window (want 1)")
    s = window.find(src_snip)
    val_snip = f'"value": "{old_value}"'
    v = window.rfind(val_snip, 0, s)
    if v == -1:
        raise SystemExit(f"refused: {what}.value not found before its source")
    between = window[v + len(val_snip) : s]
    if re.fullmatch(r",\s*", between) is None:
        raise SystemExit(f"refused: {what}.value not adjacent to its source")
    line_start = window.rfind("\n", 0, v) + 1
    indent = window[line_start:v]
    if indent.strip() != "":
        raise SystemExit(f"refused: {what}.value line has unexpected prefix")
    new_snip = f'{indent}"value": "{new_value}",\n{indent}"source": "{new_source}"'
    new_window = window[:line_start] + new_snip + window[s + len(src_snip) :]
    new_block = block[:key_at] + new_window + block[key_at + len(window) :]
    return text[:block_start] + new_block + text[block_end:]


def main() -> None:
    args = parse_args()
    root = Path(args.root)
    face_file = root / FACE_REL
    text = face_file.read_text()
    doc = json.loads(text)

    if args.mode == "placeholder":
        for case in CASES:
            for key in PIN_KEYS:
                node = doc["cases"][case][key]["value"]["expected_out_sha256"]
                old_value, old_source = node["value"], node["source"]
                new_source = (
                    "placeholder: re-pinned from run A "
                    f"(this card {CARD}); see tools/openclinxr/evidence/"
                    "station-skin-int/station-skin-int-report.json"
                )
                text = replace_pin(text, old_value, old_source, ZERO, new_source, f"{case}.{key}")
    else:
        runs = parse_runs(args.runs)
        for case in CASES:
            if case not in runs:
                raise SystemExit(f"refused: no run given for {case} (--runs aisha:N,body2:M)")
            run_dir = Path(CASES_DIR) / case / f"run{runs[case]}"
            records = run_dir / "stage-records.json"
            if not records.is_file():
                raise SystemExit(f"refused: no stage records at {records}")
            for key in PIN_KEYS:
                out = run_dir / OUT_FILES[key]
                if not out.is_file():
                    raise SystemExit(f"refused: no stage output at {out}")
                actual = sha_file(out)
                node = doc["cases"][case][key]["value"]["expected_out_sha256"]
                old_value, old_source = node["value"], node["source"]
                new_source = (
                    f"face-station-cases/{case}/run{runs[case]}/{OUT_FILES[key]} "
                    f"({CARD} run A; station standalone {key} with the skin-card flags)"
                )
                text = replace_pin(text, old_value, old_source, actual, new_source, f"{case}.{key}")
                print(f"{case}.{key}: {old_value[:12]} -> {actual[:12]} from run{runs[case]}/{OUT_FILES[key]}")

    face_file.write_text(text)
    print(f"wrote {face_file} ({args.mode})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--mode", required=True, choices=("placeholder", "rederive"))
    parser.add_argument("--runs", default="")
    return parser.parse_args()


def parse_runs(spec: str) -> dict[str, int]:
    runs: dict[str, int] = {}
    for part in spec.split(","):
        if not part.strip():
            continue
        case, _, num = part.partition(":")
        runs[case.strip()] = int(num.strip())
    return runs


if __name__ == "__main__":
    main()
