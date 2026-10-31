#!/usr/bin/env python3
"""Re-pin decimation report rows to the live GLBs (ci-w9 P3).

The Sep11/Sep10 reports pin bytes/tris/face from bakes that later deliberate
work superseded (Oct8 supine rebake d10314025/4aaf5ba16, Oct10 normal-off
1814a43c/10768617, Oct11 fc57e5a9, Oct25 ceabb545e, Oct29 ef50adee3, Sep28
9f2934536, Sep30 mouth rebuild afe8abced). This script applies the per-row
plan below, asserting each new after-value against a fresh live measurement
(parsed the same way the reports measure: indexed-triangle sums, FACE_RE over
mesh names, first-skin joint count, declared-length bytes) before writing.
before-values stay as the historical record; each touched row gains a
remeasureNote citing the superseding commit. Face-retention ratios and joint
expectations are untouched: they now floor the re-measured source.

Refuses to write if any live measurement disagrees with the plan.
"""
import json
import os
import re
import struct
import subprocess
import sys

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "..", "..", "..", ".."))
GENERATED = os.path.join(REPO, "apps/ui-xr/public/generated-humanoids")
HB03 = os.path.join(REPO, "docs/openclinxr/humanoid-postopt-ladder-2026-09-10.json")
HB05 = os.path.join(REPO, "docs/openclinxr/humanoid-postopt-ladder-face-preserving-2026-09-11.json")
FACE_RE = re.compile(r"eye|brow|lash|teeth|tongue", re.I)


def live(body):
    with open(os.path.join(GENERATED, body), "rb") as f:
        raw = f.read()
    assert raw[:4] == b"glTF", body
    assert struct.unpack("<I", raw[8:12])[0] == len(raw), body
    jl = struct.unpack("<I", raw[12:16])[0]
    g = json.loads(raw[20:20 + jl].decode())
    acc = g.get("accessors", [])
    tris = face = hand = 0
    for m in g.get("meshes", []):
        n = m.get("name", "")
        t = sum(acc[p["indices"]]["count"] // 3 for p in m["primitives"] if "indices" in p)
        tris += t
        if FACE_RE.search(n):
            face += t
        if re.search(r"_body$", n):
            hand += t
    skins = g.get("skins", [])
    joints = None
    if skins:
        joints = len(skins[0]["joints"])
    return {"tris": tris, "face": face, "joints": joints, "bytes": len(raw), "hand": hand}


def commit_oneline(sha):
    out = subprocess.run(["git", "log", "--format=%h %ad %s", "--date=short", "-1", sha],
                         cwd=REPO, capture_output=True, text=True)
    return out.stdout.strip()


# body -> {field: new_value} plus provenance notes. Every after-value is
# asserted against a fresh live measurement before the row is touched.
# ci-w11b 2026-10-30: ci-w11 D1 (d1c44f8cd) pruned 5.14 MB of unbound image
# payload fleet-wide and ci-w12 D1 (21fad089f) re-applied the recorded gravid
# treatment on the pruned OB base. All five rows below are bytes-only drift:
# tris/face/joints/hand hold at their pinned values (asserted per row).
PLAN = {
    # --- HB-03 rows (bytes only; tris/face/hand/joints asserted unchanged) ---
    "mpfb-family-partner-adult.glb": {
        "bytesAfter": 9277296,
        "triangleCountAfter": 39974,
        "handBodyMeshAfter": 13357,
        "note": ("Re-measured 2026-10-30 (ci-w11b): bytes-only drift, geometry identical "
                 "(tris 39974 / face 14945 / hand 13357 / joints 137 all hold). Superseding "
                 "commit d1c44f8cd (ci-w11 D1 orphan prune, 10529144 -> 9277296 B). Prior "
                 "re-measure (fc57e5a9 family normalTexture unbind) preserved in git history."),
    },
    "mpfb-gown-adult-patient.glb": {
        "bytesAfter": 6763692,
        "triangleCountAfter": 40277,
        "handBodyMeshAfter": 14928,
        "note": ("Re-measured 2026-10-30 (ci-w11b): bytes-only drift, geometry identical "
                 "(tris 40277 / face 14357 / hand 14928 / joints 138 all hold). Superseding "
                 "commit d1c44f8cd (ci-w11 D1 orphan prune incl. a dead T-shirt material, "
                 "20462724 -> 6763692 B). Prior re-measure (d10314025/4aaf5ba16 supine "
                 "rebake, 1814a43c1 byte-lineage) preserved in git history."),
    },
    "mpfb-peds-patient-child.glb": {
        "bytesAfter": 10418728,
        "triangleCountAfter": 77422,
        "handBodyMeshAfter": 26756,
        "note": ("Re-measured 2026-10-30 (ci-w11b): bytes-only drift, geometry identical "
                 "(tris 77422 / face 39260 / hand 26756 / joints 137 all hold). Superseding "
                 "commit d1c44f8cd (ci-w11 D1 orphan prune, 11743252 -> 10418728 B). Prior "
                 "re-measures (walk bind 91aa4b5d3, travel 7d71273e3, teeth 9f2934536) "
                 "preserved in git history."),
    },
    # --- HB-05 rows ---
    "mpfb-ob-patient-aisha.glb": {
        "bytesAfter": 8828240,
        "triangleCountAfter": 69067,
        "note": ("Re-measured 2026-10-30 (ci-w11b): bytes-only drift, geometry identical "
                 "at the decimation grain (tris 69067 / face 52778 / joints 137 all hold; "
                 "the gravid displacement field moves verts within the same topology). "
                 "Superseding commits d1c44f8cd (ci-w11 D1 orphan prune, 10069400 -> "
                 "8828240 B) and 21fad089f (ci-w12 D1 gravid re-apply on the pruned base, "
                 "1104 displacements, anchors verified +-0.085). Prior re-measure "
                 "(10768617 normal-off proof) preserved in git history."),
    },
    "mpfb-peds-parent-aisha.glb": {
        "bytesAfter": 18441636,
        "triangleCountAfter": 73012,
        "faceBefore": 33360,
        "faceAfter": 33360,
        "promoted": False,
        "noSurvivingRungReason": ("The Sep11 fp-r0.4 rung output did not survive the Sep30 mouth "
            "rebuild afe8abced (fitted CC0 teeth 192->7120 tris, coverage-reduced brow "
            "35334->8988 per the #597 strand budget, mesh renaming) plus the Oct mouth program; "
            "Oct24 lineage ba3e8229e and Oct25 albedo ceabb545e kept the rebuilt geometry "
            "(face 33360 / tris 73012 / joints 137 stable since Sep30). Face-retention ratio 1 "
            "and the 137-joint invariant now floor this re-measured source; historical "
            "pre-rebuild face 52778 preserved in previousFaceBefore."),
        "previousFaceBefore": 52778,
        "note": ("Re-measured 2026-10-30 (ci-w11b): bytes-only drift on the rebuilt source "
                 "(tris 73012 / face 33360 / joints 137 stable since Sep30). Superseding commit "
                 "d1c44f8cd (ci-w11 D1 orphan prune, 19888836 -> 18441636 B). Prior re-measure "
                 "(deliberate mouth-program rebuild afe8abced / ceabb545e) preserved in git "
                 "history."),
    },
}


def main():
    for path, key in ((HB03, "hb03"), (HB05, "hb05")):
        with open(path, encoding="utf-8") as f:
            report = json.load(f)
        rows = {r["body"]: r for r in report["bodies"]}
        for body, plan in PLAN.items():
            if body not in rows:
                continue
            row = rows[body]
            m = live(body)
            for field in ("bytesAfter", "triangleCountAfter", "faceAfter", "faceBefore",
                          "handBodyMeshAfter"):
                if field in plan:
                    live_key = {"bytesAfter": "bytes", "triangleCountAfter": "tris",
                                "faceAfter": "face", "faceBefore": "face",
                                "handBodyMeshAfter": "hand"}[field]
                    assert m[live_key] == plan[field], \
                        f"{body} {field}: plan {plan[field]} != live {m[live_key]}"
            assert m["joints"] == row["jointCountAfter"] == row["jointCountExpected"], \
                f"{body} joints changed: live {m['joints']}"
            assert m["face"] >= row["faceBefore"] * row["faceRetentionRatio"] or \
                body == "mpfb-peds-parent-aisha.glb", f"{body} floor breach"
            for field, value in plan.items():
                if field in ("note", "textSubs"):
                    continue
                row[field] = value
            for target_field, subs in plan.get("textSubs", {}).items():
                for old, new in subs:
                    if old in row.get(target_field, ""):
                        row[target_field] = row[target_field].replace(old, new)
                    else:
                        assert new in row.get(target_field, ""), \
                            f"{body} {target_field}: neither {old!r} nor {new!r} found"
            row["remeasureNote"] = plan["note"]
        stamp = ("; re-pinned 2026-10-30 from live GLB bytes by "
                 "tools/openclinxr/asset-pipeline/trellis/repin-decimation-rows.py (ci-w9 P3)")
        if "re-pinned 2026-10-30" not in str(report.get("generated", "")):
            report["generated"] = str(report.get("generated", "")) + stamp
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1, ensure_ascii=False)
            f.write("\n")
    print("re-pinned OK; per-row live assertions held")


if __name__ == "__main__":
    sys.exit(main())
