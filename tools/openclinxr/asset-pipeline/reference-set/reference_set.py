"""Replayable reference-set record (reference-set station).

A reference set freezes the one-shot Imagine picks behind a case: every
per-case reference (goal portrait, face-core tile, scalp island edit, eye
texture, brow band) was produced by Grok Imagine, which has no seed. A
second run for the same case would produce a different human. This module
records the picks (prompts + sha256 + sizes + lock + acceptance) in a
tracked manifest.json while the BYTES live under a gitignored store root.

Layout: manifest names shas + store-relative paths; the resolver finds
bytes by sha under a configurable store root and REFUSES on missing or
mismatched bytes (case, kind and expected sha in the message). No
fallback, no regeneration, no model call anywhere in this file (pure
stdlib + PIL + numpy: no subprocess, no socket, no fetch).

Subcommands:
  record  add an entry from files that already exist (computes shas;
          validates aspect vs the reference input and that the file
          decodes as an image of sane entropy: rejects placeholders
          and flat images; tone-flags goal portraits)
  verify  every entry resolvable under --store-root with matching shas
  replay  print resolved paths for a case (zero model calls)

Store root is a CLI flag (or REFERENCE_SET_STORE_ROOT); it has no
compiled-in default, so no absolute path ever lands in tracked files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

VERSION = 1
KINDS = ("goal_front", "goal_yaw", "face_tile", "scalp_island",
         "eye_texture", "brow_band")
# Aspect gate: relative |out-ref|/ref on w/h. History: accepted picks drift
# 0.7-2.1% (face tile 710x430->1312x784 = 1.35%, brow C 1550x800->1424x720
# = 2.08%); gross inventions (square from wide, portrait from texture)
# differ by 10x more. Exact-size matching is wrong: sizes legitimately
# change across calls, and the 2000x512-type failure left no bytes to
# record anyway.
ASPECT_TOLERANCE = 0.03
# Flat-image gate: grayscale std below this is a placeholder/solid fill,
# never a texture (real tiles measure in the tens).
FLAT_STD_MIN = 2.0
MIN_DIM = 8
# Tone tokens: sRGB triples from the repo factory, recorded in
# S/skins/pick.py:12 ("TONES sRGB from the repo factory, NOT invented
# here"). Lab via D65 sRGB->Lab, same formula as pick.py srgb2lab.
TONE_TOKENS = {
    "warm_light": (0.78, 0.62, 0.52),
    "warm_medium": (0.66, 0.50, 0.40),
}
FACECORE_BOX = (0.35, 0.32, 0.65, 0.60)
# Flag bar: dLab 10.63 measured on the accepted Aisha goal-front
# (S/project/edit-v9/edit-0.png face-core box mean Lab vs warm_light
# token Lab); rounded up. A goal farther from its token than Aisha's
# accepted goal is from hers gets flagged (recorded, never blocking).
TONE_FLAG_THRESHOLD = 10.7
TONE_FLAG_SOURCE = (
    "dLab 10.63 = accepted Aisha goal-front face-core box mean Lab vs "
    "warm_light token Lab (D65 sRGB, S/skins/pick.py:12); bar 10.7"
)

REFUSE_CODES = ("REFUSE_MISSING", "REFUSE_SHA_MISMATCH", "REFUSE_FLAT",
                "REFUSE_ASPECT", "REFUSE_NOT_IMAGE", "REFUSE_SCHEMA")


class Refuse(Exception):
    pass


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ m.T
    f = xyz / np.array([0.95047, 1.0, 1.08883])
    fx = np.where(f > 0.008856, np.cbrt(f), (903.3 * f + 16) / 116)
    return np.stack([116 * fx[..., 1] - 16,
                     500 * (fx[..., 0] - fx[..., 1]),
                     200 * (fx[..., 1] - fx[..., 2])], axis=-1)


def facecore_mean_lab(image_path: Path) -> list[float]:
    im = Image.open(image_path).convert("RGB")
    w, h = im.size
    x0, y0, x1, y1 = (int(FACECORE_BOX[0] * w), int(FACECORE_BOX[1] * h),
                      int(FACECORE_BOX[2] * w), int(FACECORE_BOX[3] * h))
    core = np.asarray(im.crop((x0, y0, x1, y1)))
    return [float(v) for v in
            srgb_to_lab(core).reshape(-1, 3).mean(axis=0)]


def tone_check(image_path: Path, token: str) -> dict:
    if token not in TONE_TOKENS:
        raise Refuse(f"REFUSE_SCHEMA unknown phenotype tone {token!r}: "
                     f"refuse (want one of {sorted(TONE_TOKENS)})")
    goal_lab = facecore_mean_lab(image_path)
    token_lab = [float(v) for v in
                 srgb_to_lab(np.array([[[c * 255 for c in
                                         TONE_TOKENS[token]]]]))[0, 0]]
    dist = float(np.linalg.norm(np.array(goal_lab) - np.array(token_lab)))
    return {"phenotype_tone": token,
            "goal_facecore_lab": [round(v, 2) for v in goal_lab],
            "token_lab": [round(v, 2) for v in token_lab],
            "distance_dLab": round(dist, 2),
            "threshold_dLab": TONE_FLAG_THRESHOLD,
            "threshold_source": TONE_FLAG_SOURCE,
            "flagged": dist > TONE_FLAG_THRESHOLD}


def decode_check(path: Path) -> tuple[int, int, float]:
    try:
        im = Image.open(path).convert("RGB")
        im.load()
    except Exception as e:
        raise Refuse(f"REFUSE_NOT_IMAGE {path.name} does not decode as "
                     f"an image ({e}): refuse")
    w, h = im.size
    if w < MIN_DIM or h < MIN_DIM:
        raise Refuse(f"REFUSE_NOT_IMAGE {path.name} is {w}x{h} "
                     f"(min {MIN_DIM}): refuse")
    gray = np.asarray(im.convert("L"), dtype=np.float64)
    return w, h, float(gray.std())


def validate_new_output(ref_path: Path | None, out_path: Path,
                        kind: str) -> tuple[int, int]:
    w, h, std = decode_check(out_path)
    if std < FLAT_STD_MIN:
        raise Refuse(f"REFUSE_FLAT {out_path.name} grayscale std "
                     f"{std:.2f} < {FLAT_STD_MIN} (placeholder/flat "
                     f"fill): refuse")
    if ref_path is not None:
        rw, rh, _ = decode_check(ref_path)
        for name, a, b in (("aspect", w / h, rw / rh),):
            if abs(a - b) / b > ASPECT_TOLERANCE:
                raise Refuse(
                    f"REFUSE_ASPECT {out_path.name} {w}x{h} vs "
                    f"reference {ref_path.name} {rw}x{rh} "
                    f"(rel aspect drift {abs(a - b) / b:.3f} > "
                    f"{ASPECT_TOLERANCE}): refuse")
    return w, h


def load_manifest(path: Path) -> dict:
    try:
        m = json.loads(path.read_text())
    except Exception as e:
        raise Refuse(f"REFUSE_SCHEMA {path} unreadable ({e}): refuse")
    if m.get("version") != VERSION or "cases" not in m:
        raise Refuse(f"REFUSE_SCHEMA {path} version != {VERSION}: refuse")
    return m


def resolve_entry(store_root: Path, case: str, kind: str,
                  entry: dict) -> Path:
    out = entry.get("output", {})
    rel = out.get("store_relpath")
    want = out.get("sha256")
    if not rel or not want:
        raise Refuse(f"REFUSE_MISSING case {case} kind {kind}: no stored "
                     f"output record: refuse (no placeholder)")
    p = store_root / rel
    if not p.is_file():
        raise Refuse(f"REFUSE_MISSING case {case} kind {kind}: "
                     f"{rel} absent under store root: refuse "
                     f"(no placeholder)")
    actual = sha256_file(p)
    if actual != want:
        raise Refuse(f"REFUSE_SHA_MISMATCH case {case} kind {kind}: "
                     f"{rel} sha {actual[:16]} != expected "
                     f"{want[:16]}: refuse")
    return p


def cmd_record(args: argparse.Namespace) -> dict:
    if args.kind not in KINDS:
        raise Refuse(f"REFUSE_SCHEMA kind {args.kind!r} not in "
                     f"{list(KINDS)}: refuse")
    manifest_path = Path(args.manifest)
    m = load_manifest(manifest_path) if manifest_path.is_file() else {
        "version": VERSION, "cases": {}}
    if m.get("version") != VERSION:
        raise Refuse("REFUSE_SCHEMA version drift: refuse")
    out_path = Path(args.output)
    ref_path = Path(args.ref_input) if args.ref_input else None
    if ref_path is not None and not ref_path.is_file() \
            and not args.ref_input_note:
        raise Refuse(f"REFUSE_MISSING reference input {ref_path} absent: "
                     f"refuse (pass --ref-input-note for legacy inputs "
                     f"whose bytes were never retained)")
    w, h = validate_new_output(
        ref_path if ref_path is not None and ref_path.is_file() else None,
        out_path, args.kind)
    prompt = Path(args.prompt_file).read_text().strip()
    if not prompt:
        raise Refuse("REFUSE_SCHEMA empty prompt: refuse")
    entry: dict = {
        "prompt": prompt,
        "generator": args.generator,
        "created": args.created,
        "reference_input": ({
            "store_relpath": args.ref_relpath or
            (ref_path.name if ref_path else None),
            "sha256": sha256_file(ref_path)
            if ref_path is not None and ref_path.is_file() else None,
            "size": list(decode_check(ref_path)[:2])
            if ref_path is not None and ref_path.is_file() else None,
            "note": args.ref_input_note,
        }),
        "output": {
            "store_relpath": args.out_relpath,
            "sha256": sha256_file(out_path),
            "size": [w, h],
        },
        "lock": json.loads(Path(args.lock_report).read_text())
        if args.lock_report else None,
        "acceptance": {"grader": args.grader, "verdict": args.verdict,
                       "source": args.accept_source},
        "rejected": json.loads(args.rejected_json)
        if args.rejected_json else [],
    }
    if args.kind in ("goal_front", "goal_yaw"):
        if not args.phenotype_tone:
            raise Refuse("REFUSE_SCHEMA goal kinds need "
                         "--phenotype-tone: refuse")
        entry["tone"] = tone_check(out_path, args.phenotype_tone)
    m["cases"].setdefault(args.case, {"references": {}})["references"][
        args.kind] = entry
    if args.phenotype_tone:
        m["cases"][args.case]["phenotype_tone"] = args.phenotype_tone
    manifest_path.write_text(json.dumps(m, indent=1) + "\n")
    return entry


def cmd_verify(args: argparse.Namespace) -> dict:
    m = load_manifest(Path(args.manifest))
    root = Path(args.store_root)
    ok, missing_input = 0, 0
    for case, cdata in m["cases"].items():
        for kind, entry in cdata.get("references", {}).items():
            resolve_entry(root, case, kind, entry)
            ok += 1
            ri = entry.get("reference_input", {})
            if ri.get("sha256"):
                p = root / ri["store_relpath"]
                if not p.is_file() or sha256_file(p) != ri["sha256"]:
                    raise Refuse(
                        f"REFUSE_SHA_MISMATCH case {case} kind {kind} "
                        f"reference input {ri['store_relpath']}: refuse")
            else:
                missing_input += 1
    return {"entries_ok": ok,
            "inputs_unrecorded": missing_input,
            "store_root": str(root)}


def cmd_replay(args: argparse.Namespace) -> dict:
    m = load_manifest(Path(args.manifest))
    root = Path(args.store_root)
    if args.case not in m["cases"]:
        raise Refuse(f"REFUSE_MISSING case {args.case}: no record: "
                     f"refuse (no placeholder)")
    out = {}
    for kind, entry in m["cases"][args.case].get("references",
                                                 {}).items():
        out[kind] = str(resolve_entry(root, args.case, kind, entry))
    return out


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    r.add_argument("--manifest", required=True)
    r.add_argument("--case", required=True)
    r.add_argument("--kind", required=True, choices=KINDS)
    r.add_argument("--prompt-file", required=True)
    r.add_argument("--ref-input", default=None)
    r.add_argument("--ref-relpath", default=None)
    r.add_argument("--ref-input-note", default=None)
    r.add_argument("--output", required=True)
    r.add_argument("--out-relpath", required=True)
    r.add_argument("--generator", required=True)
    r.add_argument("--created", required=True)
    r.add_argument("--lock-report", default=None)
    r.add_argument("--grader", required=True)
    r.add_argument("--verdict", required=True,
                   choices=("accepted", "rejected"))
    r.add_argument("--accept-source", required=True)
    r.add_argument("--rejected-json", default=None)
    r.add_argument("--phenotype-tone", default=None)
    v = sub.add_parser("verify")
    v.add_argument("--manifest", required=True)
    v.add_argument("--store-root", required=True)
    j = sub.add_parser("replay")
    j.add_argument("--manifest", required=True)
    j.add_argument("--store-root", required=True)
    j.add_argument("--case", required=True)
    sub.add_parser("check")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "check":
        print("REFERENCE_SET_CHECK ok")
        return 0
    store_default = os.environ.get("REFERENCE_SET_STORE_ROOT")
    if args.cmd in ("verify", "replay") and not args.store_root \
            and store_default:
        args.store_root = store_default
    try:
        if args.cmd == "record":
            entry = cmd_record(args)
            print(json.dumps({"recorded": args.kind,
                              "sha256": entry["output"]["sha256"],
                              "tone": entry.get("tone")}, indent=1))
        elif args.cmd == "verify":
            print(json.dumps(cmd_verify(args), indent=1))
        elif args.cmd == "replay":
            print(json.dumps(cmd_replay(args), indent=1))
    except Refuse as e:
        print(str(e), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
