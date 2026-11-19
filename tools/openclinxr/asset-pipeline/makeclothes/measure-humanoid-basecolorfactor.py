#!/usr/bin/env python3
"""Regenerate the humanoid baseColorFactor audit from the live GLBs (ci-w9 P2).

Measures name/factor/texture from every shipped body in
apps/ui-xr/public/generated-humanoids/*.glb (GLB JSON chunk, same method as
the 2026-09-10 audit) and rewrites
docs/openclinxr/humanoid-basecolorfactor-audit-2026-09-10.json so the audit
is regenerated, not hand-edited.

Per row the script reuses the prior reason/origin when the live row still
matches the old audit row (name, factor within 5e-4, texture flag) and the
cited literal still sits within +/-3 lines; otherwise it relocates the
numeric triple in the same file, then in a bounded tree search
(tracked .py/.ts/.js/.mts/.json under tools/ packages/ apps/), else records
"no numeric literal in tree" honestly (the refusal clause, not an invented
literal, decides those rows). Every row cites the commit that last changed
its body (bodyLastChanged from git log on the GLB).

Usage: mise exec -- python3 tools/openclinxr/asset-pipeline/makeclothes/measure-humanoid-basecolorfactor.py [--body <body.glb>]
  Default (no flag) re-measures every shipped body. With --body, only that
  body is re-measured from live bytes; every other row is carried through
  byte-identical so the diff touches only the named body.
"""

import json
import os
import re
import struct
import subprocess
import sys

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
GENERATED = os.path.join(REPO, "apps/ui-xr/public/generated-humanoids")
AUDIT_PATH = os.path.join(REPO, "docs/openclinxr/humanoid-basecolorfactor-audit-2026-09-10.json")
NO_LITERAL = "no numeric literal in tree"

FLOAT_RE = re.compile(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)")
GROUP_RE = re.compile(r"[\(\[](.*?)[\)\]]")

# Only producer code can set a factor: test files and fixtures never count as
# origins, no matter what numbers they contain.
PRODUCER_DIRS = [
    "tools/openclinxr/asset-pipeline",
    "tools/openclinxr/evidence",
    "packages/openclinxr/factory-stations",
]
SKIP_RE = re.compile(r"\.test\.[tj]s$|/fixtures/|/__tests__/")

MATERIALIZE = "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"
AUTOMATE = "tools/openclinxr/asset-pipeline/anny/automate_blender.py"
HAIRLIB = "tools/openclinxr/asset-pipeline/makeclothes/embed_library_hair.py"
GARMENT_OPS = "packages/openclinxr/factory-stations/src/body_param/garment_ops.py"


def family_files(material):
    m = material
    if m.startswith("openclinxr_hidden"):
        return [GARMENT_OPS]
    if "hair" in m:
        return [HAIRLIB, AUTOMATE, MATERIALIZE]
    if "eyebrow" in m or "eyelash" in m or "teeth" in m or "tongue" in m \
            or m.startswith("mpfb_skin") or "eyes" in m:
        return [MATERIALIZE]
    return [AUTOMATE, MATERIALIZE, HAIRLIB, GARMENT_OPS]


def sh(*args):
    return subprocess.run(args, cwd=REPO, capture_output=True, text=True).stdout


def live_materials(body):
    with open(os.path.join(GENERATED, body), "rb") as f:
        raw = f.read()
    json_len = struct.unpack("<I", raw[12:16])[0]
    gltf = json.loads(raw[20 : 20 + json_len].decode("utf-8"))
    rows = []
    for m in gltf.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        rows.append(
            {
                "name": m.get("name", "(unnamed)"),
                "factor": list(pbr["baseColorFactor"]) if pbr.get("baseColorFactor") is not None else None,
                "tex": bool(pbr.get("baseColorTexture")),
            }
        )
    return rows


def factors_equal(a, b):
    if a is None or b is None:
        return a == b
    return len(a) == len(b) and all(abs(x - y) < 5e-4 for x, y in zip(a, b))


def origin_holds(origin):
    nums = re.findall(r"\d+\.\d+", origin.get("literal", ""))
    if len(nums) < 3 or not origin.get("file"):
        return False
    p = os.path.join(REPO, origin["file"])
    if not os.path.exists(p):
        return False
    with open(p, encoding="utf-8", errors="replace") as f:
        src = f.read().split("\n")
    lo = max(0, origin["line"] - 1 - 3)
    hi = min(len(src), origin["line"] - 1 + 4)
    window = "\n".join(src[lo:hi])
    return all(n in window for n in nums[:3])


def build_triple_index():
    """(path, line, literal-line) hits keyed by rounded triple, deterministic order.

    Producer code only (PRODUCER_DIRS, never tests/fixtures): a tint triple
    must cite the code that sets it. A group must contain at least three
    dotted decimals so every indexed hit passes the test's literal check
    (originHoldsLiteral needs three \\d+\\.\\d+ numbers in the cited window).
    """
    files = sh("git", "ls-files", *PRODUCER_DIRS).split()
    exts = (".py", ".ts", ".js", ".mts", ".json", ".mhmat")
    index = {}
    for rel in sorted(files):
        if SKIP_RE.search(rel):
            continue
        if not rel.endswith(exts):
            continue
        p = os.path.join(REPO, rel)
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                lines = f.read().split("\n")
        except OSError:
            continue
        for i, line in enumerate(lines):
            for grp in GROUP_RE.findall(line):
                if len(re.findall(r"\d+\.\d+", grp)) < 3:
                    continue
                nums = [float(x) for x in FLOAT_RE.findall(grp)]
                if len(nums) >= 3:
                    key = (round(nums[0], 4), round(nums[1], 4), round(nums[2], 4))
                    index.setdefault(key, []).append(
                        {"file": rel, "line": i + 1, "literal": line.strip()[:200]}
                    )
    return index


def find_literal(index, factor, prefer_files=()):
    key = (round(factor[0], 4), round(factor[1], 4), round(factor[2], 4))
    hits = index.get(key, [])
    if not hits:
        # tolerance fallback: any indexed triple within 5e-4 on all channels
        near = []
        for k, v in index.items():
            if all(abs(a - b) < 5e-4 for a, b in zip(k, factor[:3])):
                near.extend(v)
        hits = near
    if not hits:
        return None
    for pf in prefer_files:
        same = [h for h in hits if h["file"] == pf]
        if same:
            return sorted(same, key=lambda h: h["line"])[0]
    return sorted(hits, key=lambda h: (h["file"], h["line"]))[0]


def is_white_factor(factor):
    return factor is not None and all(abs(x - 1) < 5e-4 for x in factor[:3])


# Convention for a row that measures textured with factor absent (MAPS-TOIGO
# hair-material-maps stage wires authored maps post-export, so the old
# flat-colour reason/kind no longer describes the bytes).
TEXTURED_FACTOR_ABSENT_KIND = "authored texture, factor absent (defaults white)"
TEXTURED_FACTOR_ABSENT_REASON = (
    "Factor absent = glTF default white; the baseColorTexture carries the look. "
    "Maps wired post-export by the hair-material-maps stage; decisions recorded in "
    "docs/madr/0066-post-export-hair-material-maps-stage.md.")
STAGE_FILE_FALLBACK = "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py"
WIRING_NEEDLE = 'pbr["baseColorTexture"]'


def stage_origin_for_body(body):
    """Origin for a newly textured row: the stage file from the sidecar's
    byteLineage record (FU8 maps level names the stage), line = the
    pbr["baseColorTexture"] wiring line found in that file (never hard-coded).
    Falls back to STAGE_FILE_FALLBACK only when no record names the stage file."""
    stage_file = STAGE_FILE_FALLBACK
    try:
        with open(os.path.join(GENERATED, body.replace(".glb", ".provenance.json")),
                  encoding="utf-8") as f:
            sidecar = json.load(f)
        cur = sidecar.get("byteLineage")
        while isinstance(cur, dict):
            for key in ("correctedBy", "tool"):
                val = cur.get(key)
                if isinstance(val, str) and "apply_hair_material_maps" in val:
                    hit = re.search(r"tools/\S*apply_hair_material_maps\.py", val)
                    if hit:
                        stage_file = hit.group(0)
            argv = cur.get("derivationArgv")
            if isinstance(argv, list):
                for arg in argv:
                    if isinstance(arg, str) and arg.endswith("apply_hair_material_maps.py"):
                        tail = re.search(r"tools/\S*apply_hair_material_maps\.py", arg)
                        if tail:
                            stage_file = tail.group(0)
            rec = cur.get("recordedBefore")
            cur = rec.get("byteLineage") if isinstance(rec, dict) else None
    except (OSError, ValueError):
        pass
    try:
        with open(os.path.join(REPO, stage_file), encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                if WIRING_NEEDLE in line:
                    return {"file": stage_file, "line": i, "literal": line.strip()[:200]}
    except OSError as exc:
        raise RuntimeError(
            f"newly-textured row for {body}: cannot read stage file {stage_file}") from exc
    raise RuntimeError(
        f"newly-textured row for {body}: wiring line {WIRING_NEEDLE!r} not found in {stage_file}")


WHITE_NO_LITERAL_NOTE = (
    " Re-measured 2026-10-30: the live factor is white, whose setter in the tree "
    "is the undotted HB-02 bake reset (tools/openclinxr/asset-pipeline/trellis/"
    "bake-humanoid-albedo.ts:307,312 `[1, 1, 1, 1]`) or the materializer white "
    "fallback (tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"
    ":1129); no dotted triple the mechanical literal check can cite exists, so the "
    "row honestly declares no literal — the refusal clause decides (white rows are "
    "refusal-exempt, the byte-match clause still pins the value).")


def last_changed(body):
    out = sh("git", "log", "--format=%H %ad %s", "--date=short", "-1", "--",
             "apps/ui-xr/public/generated-humanoids/" + body).strip()
    return out


def main():
    with open(AUDIT_PATH, encoding="utf-8") as f:
        old = json.load(f)
    old_rows = {}
    for r in old["rows"]:
        old_rows[(r["body"], r["material"])] = r
    index = build_triple_index()
    bodies = sorted(f for f in os.listdir(GENERATED) if f.endswith(".glb"))
    only_body = sys.argv[sys.argv.index("--body") + 1] if "--body" in sys.argv else None
    if only_body is not None and only_body not in bodies:
        sys.exit(f"--body {only_body}: not a shipped body in {GENERATED}")
    selected = set(bodies) if only_body is None else {only_body}
    rows = []
    stats = {"reused": 0, "relocated": 0, "searched": 0, "unresolved": 0, "nullfactor": 0}
    for body in bodies:
        if body not in selected:
            rows.extend(r for r in old["rows"] if r["body"] == body)
            continue
        changed = last_changed(body)
        for m in live_materials(body):
            prev = old_rows.get((body, m["name"]))
            rowo = None
            if prev is not None and factors_equal(prev["baseColorFactor"], m["factor"]) \
                    and prev["hasBaseColorTexture"] == m["tex"]:
                if m["factor"] is None:
                    stats["nullfactor"] += 1
                    rowo = dict(prev)
                    note = ("Re-measured 2026-10-30: factor absent from live bytes "
                            "(glTF default white); effective value unchanged.")
                    rowo["reason"] = prev.get("reason", "") if note in prev.get("reason", "") \
                        else prev.get("reason", "") + " " + note
                    rowo["reason"] = rowo["reason"].strip()
                elif origin_holds(prev["origin"]):
                    stats["reused"] += 1
                    rowo = dict(prev)
                    # Scrub a stale relocation note when it cites a file the
                    # origin no longer points at (prior-round search garbage).
                    stale = re.search(
                        r"origin (?:relocated|first recorded) 2026-10-30 to (\S+)",
                        rowo.get("reason", ""))
                    if stale and stale.group(1).rstrip(".") != (
                            f"{prev['origin'].get('file')}:{prev['origin'].get('line')}"):
                        rowo["reason"] = re.sub(
                            r"origin (?:relocated|first recorded) 2026-10-30 to \S+",
                            f"origin confirmed 2026-10-30 at "
                            f"{prev['origin']['file']}:{prev['origin']['line']}",
                            rowo["reason"])
                else:
                    hit = find_literal(index, m["factor"], prefer_files=[
                        prev["origin"].get("file"),
                        *family_files(m["name"]),
                    ]) if not is_white_factor(m["factor"]) else None
                    if hit:
                        stats["relocated"] += 1
                        rowo = dict(prev)
                        rowo["origin"] = {"file": hit["file"], "line": hit["line"], "literal": hit["literal"]}
                        new_note = f"origin relocated 2026-10-30 to {hit['file']}:{hit['line']}"
                        old_reason = prev.get("reason", "")
                        if re.search(r"origin (?:relocated|first recorded) 2026-10-30 to \S+", old_reason):
                            rowo["reason"] = re.sub(
                                r"origin (?:relocated|first recorded) 2026-10-30 to \S+",
                                new_note, old_reason)
                        else:
                            rowo["reason"] = (old_reason + f" {new_note}.").strip()
                    else:
                        stats["unresolved"] += 1
                        rowo = dict(prev)
                        rowo["origin"] = {"file": "", "line": 0, "literal": NO_LITERAL}
                        note = (WHITE_NO_LITERAL_NOTE if is_white_factor(m["factor"]) else (
                            " Re-measured 2026-10-30: no numeric literal for this triple "
                            "remains in the tree; row says so, refusal clause decides."))
                        rowo["reason"] = prev.get("reason", "") if note.strip() in prev.get("reason", "") \
                            else (prev.get("reason", "") + note).strip()
            else:
                if m["factor"] is not None and not is_white_factor(m["factor"]):
                    hit = find_literal(index, m["factor"],
                                       prefer_files=family_files(m["name"]))
                else:
                    hit = None
                if m["factor"] is None:
                    stats["nullfactor"] += 1
                elif is_white_factor(m["factor"]):
                    stats["unresolved"] += 1
                elif hit:
                    stats["searched"] += 1
                else:
                    stats["unresolved"] += 1
                if (m["factor"] is None and m["tex"] and prev is not None
                        and not prev.get("hasBaseColorTexture")):
                    # Texture newly wired since the recorded row (MAPS-TOIGO
                    # hair-material-maps stage): the stale flat-colour
                    # reason/kind no longer describe the bytes, so emit the
                    # textured/factor-absent convention fresh (no .py:line in
                    # reason text; the structured origin names the wiring line
                    # found in the stage file, never a hard-coded line).
                    rowo = {
                        "body": body,
                        "material": m["name"],
                        "baseColorFactor": None,
                        "hasBaseColorTexture": True,
                        "reason": TEXTURED_FACTOR_ABSENT_REASON,
                        "origin": stage_origin_for_body(body),
                        "kind": TEXTURED_FACTOR_ABSENT_KIND,
                    }
                    if prev.get("decision"):
                        rowo["decision"] = prev["decision"]
                else:
                    base_reason = (prev.get("reason", "") + " " if prev else "")
                if rowo is None and hit:
                    reason = (base_reason + (
                        f"Measured {m['factor']} on live bytes ({'textured' if m['tex'] else 'untextured'}); "
                        f"origin first recorded 2026-10-30 at {hit['file']}:{hit['line']}.")).strip()
                    origin = {"file": hit["file"], "line": hit["line"], "literal": hit["literal"]}
                elif rowo is None and m["factor"] is None:
                    reason = (base_reason + (
                        "Measured on live bytes 2026-10-30: factor absent (glTF default white); "
                        f"{'textured' if m['tex'] else 'untextured'}.")).strip()
                    origin = dict(prev["origin"]) if prev and prev.get("origin") else {"file": "", "line": 0, "literal": NO_LITERAL}
                elif rowo is None and is_white_factor(m["factor"]):
                    reason = (base_reason + (
                        f"Measured {m['factor']} on live bytes ({'textured' if m['tex'] else 'untextured'}); "
                        + WHITE_NO_LITERAL_NOTE)).strip()
                    origin = {"file": "", "line": 0, "literal": NO_LITERAL}
                elif rowo is None:
                    reason = (base_reason + (
                        f"Measured {m['factor']} on live bytes ({'textured' if m['tex'] else 'untextured'}); "
                        "no numeric literal in tree — row says so, refusal clause decides.")).strip()
                    origin = {"file": "", "line": 0, "literal": NO_LITERAL}
                if rowo is None:
                    rowo = {
                        "body": body,
                        "material": m["name"],
                        "baseColorFactor": m["factor"],
                        "hasBaseColorTexture": m["tex"],
                        "reason": reason,
                        "origin": origin,
                    }
                if prev and prev.get("kind") and "kind" not in rowo:
                    rowo["kind"] = prev["kind"]
                if prev and prev.get("decision"):
                    rowo["decision"] = prev["decision"]
            rowo["bodyLastChanged"] = changed
            rows.append(rowo)
    spread = {}
    for r in rows:
        f = r["baseColorFactor"]
        if r["hasBaseColorTexture"] and f is not None and not (
                abs(f[0] - 1) < 1e-6 and abs(f[1] - 1) < 1e-6 and abs(f[2] - 1) < 1e-6):
            spread.setdefault(f"{f[0]:.2f},{f[1]:.2f},{f[2]:.2f}", []).append(f"{r['body']}::{r['material']}")
    hidden = sum(1 for r in rows if r["baseColorFactor"] is not None
                 and all(abs(x) < 1e-9 for x in r["baseColorFactor"][:3]))
    new_audit = dict(old)
    new_audit["generated"] = "2026-09-10 (method); re-measured 2026-10-30 by measure-humanoid-basecolorfactor.py for the 20 shipped bodies"
    regen_note = ("; regenerated 2026-10-30 from live GLB bytes; "
                   "each row cites the last commit touching its body in bodyLastChanged")
    new_audit["method"] = old["method"] if regen_note in old["method"] else old["method"] + regen_note
    new_audit["bodies"] = bodies
    new_audit["bodyCount"] = len(bodies)
    new_audit["materialRowCount"] = len(rows)
    new_audit["factorSpreadTexturedNonWhite"] = spread
    new_audit["hiddenVerdict"] = re.sub(r"\d+ openclinxr_hidden",
                                        f"{hidden} openclinxr_hidden", old.get("hiddenVerdict", ""))
    new_audit["rows"] = rows
    with open(AUDIT_PATH, "w", encoding="utf-8") as f:
        json.dump(new_audit, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"bodies={len(bodies)} rows={len(rows)} " + " ".join(f"{k}={v}" for k, v in stats.items()))


if __name__ == "__main__":
    sys.exit(main())
