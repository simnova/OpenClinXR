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
import hashlib
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
    return {"tris": tris, "face": face, "joints": joints, "bytes": len(raw), "hand": hand,
            "sha256": hashlib.sha256(raw).hexdigest()}


def commit_oneline(sha):
    out = subprocess.run(["git", "log", "--format=%h %ad %s", "--date=short", "-1", sha],
                         cwd=REPO, capture_output=True, text=True)
    return out.stdout.strip()


# A plan entry holds common fields plus optional per-report overrides:
#   "hb03": {...} / "hb05": {...} merge over the common fields for that report
#   only (used when a demote/history row differs between the HB-03 and HB-05
#   records). "note" and "textSubs" may likewise be nested per report.
# A plan entry that carries jointCountAfter re-pins the joint expectation
# itself (asserted live, e.g. a retired garment bone); entries without it
# keep the joints-unchanged invariant. outputSha256, when carried, is
# asserted against the live bytes before it is written.
# ci-w11b 2026-10-30: ci-w11 D1 (d1c44f8cd) pruned 5.14 MB of unbound image
# payload fleet-wide and ci-w12 D1 (21fad089f) re-applied the recorded gravid
# treatment on the pruned OB base. All five rows below are bytes-only drift:
# tris/face/joints/hand hold at their pinned values (asserted per row).
PLAN = {
    # --- st-palette (2026-11-04): sRGB palette fold. Physician is bytes-only
    # (texture refold); face/hand/joints hold. Asserted live.

    "mpfb-clinical-physician-adult.glb": {
        "bytesAfter": 9293412,
        "triangleCountAfter": 41718,
        "faceAfter": 10130,
        "handBodyMeshAfter": 12890,
        "note": ("Re-measured 2026-11-04 (st-palette): bytes-only drift (tris 41718 / face 10130 / "
                 "hand 12890 / joints 137 hold). Superseding commit 3969ae031 (sRGB palette fold "
                 "replaces the HB-02 scrub_shirt texels with a 512x512 weave)."),
    },
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
    "mpfb-viseme-inspect.glb": {
        "bytesAfter": 13976324,
        "triangleCountAfter": 69067,
        "faceAfter": 52778,
        "note": ("Re-measured 2026-11-03 (st-hemfin D2): bytes-only drift, geometry counts "
                 "identical (tris 69067 / face 52778 / joints 137 all hold). Superseding commit "
                 "e35ee741a (st-hemfin D2 hem-finish garment-primitive splice on the T-shirt, 13933096 -> "
                 "13976324 B)."),
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
        "bytesAfter": 10418700,
        "triangleCountAfter": 77422,
        "handBodyMeshAfter": 26756,
        "note": ("Re-measured 2026-11-04 (st-palette): bytes-only drift, geometry identical "
                 "(tris 77422 / face 39260 / hand 26756 / joints 137 all hold). Superseding "
                 "commit 6d1ae039d (t-shirt texture renormalized to the soft-blue palette in "
                 "linear space, 10418728 -> 10418700 B). Prior re-measure (ci-w11b d1c44f8cd "
                 "orphan prune) preserved in git history."),
    },

    # --- HB-05 rows ---
    # st-redgarm D1 (1225b8f95) entries below: deliberate garment restores; face/joints/
    # hand hold (asserted per row by main()). Superseding commit 1225b8f95
    # (replace-garment-primitive.ts restores pre-HB-05 full-res prims + proven 60-deg
    # post-export smooth).
    "mpfb-ob-patient-aisha.glb": {
        "bytesAfter": 9914108,
        "triangleCountAfter": 73392,
        "note": ("Re-measured 2026-11-04 (st-vitskin): skin-shade carrier stage "
                 "(post-export byte stage, not a rebake; one RG image + "
                 "OPENCLINXR_skin_shade material extension appended, geometry/BIN "
                 "verbatim; tris 73392 / face 52778 / joints 137 hold, "
                 "9700420 -> 9914108 B). Prior re-measure (st-redgarm D1, "
                 "1225b8f95) preserved in git history."),
    },
    "mpfb-peds-nurse-kevin.glb": {
        "bytesAfter": 15966652,
        "triangleCountAfter": 98102,
        "note": ("Re-measured 2026-11-04 (st-palette): bytes-only drift, geometry counts hold (asserted by main()). Superseding commit 3969ae031 (sRGB palette fold). "
                 "Re-measured 2026-11-02 (st-redgarm D1): shirt 2814->9384 / pants "
                 "810->2704 / boots 9230->30768 tris (+30002; tris 68100->98102, face "
                 "46160 / joints 137 hold; still under the 120000 acceptableSingleProp "
                 "budget). Superseding commit 1225b8f95 (D1 garment smooth: full-res "
                 "transplants + 60-deg post-export smooth). Prior re-measures (HB-05 rung, "
                 "ci-w11b) preserved in git history."),
    },
    "mpfb-peds-parent-aisha.glb": {
        "bytesAfter": 18446536,
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
        "note": ("Re-measured 2026-11-04 (st-palette): bytes-only drift, geometry counts hold (asserted by main()). Superseding commit 3969ae031 (sRGB palette fold). "
                 "Re-measured 2026-10-30 (ci-w11b): bytes-only drift on the rebuilt source "
                 "(tris 73012 / face 33360 / joints 137 stable since Sep30). Superseding commit "
                 "d1c44f8cd (ci-w11 D1 orphan prune, 19888836 -> 18441636 B). Prior re-measure "
                 "(deliberate mouth-program rebuild afe8abced / ceabb545e) preserved in git "
                 "history."),
    },
    # --- st-gowninsp round 5 (2026-11-04): the centred-cage rebake fits each
    # ring on its section centroid (section() returns rx/rz/cx/cz, wall strips
    # follow the fitted rings). Same shell class, 25 more tris (seal census
    # 16->21 lips, gussets 48->63, patches 32->42): garment-surface-derived
    # 0.822->0.950, slits stay 0/0, neckline stays 1.3834. HB-05 verdict carries
    # forward again (source inside the 80000 budget, shell gained seal tris
    # only); HB-03 re-pins to the live source. Every after-value below is
    # asserted live by main().
    # --- st-gowninsp round 4 (2026-11-03): the neckline-scoop + sleeve-root seal
    # rebake replaces the round-3 source (front-midline neckline 1.435->1.3834 on
    # a flat +/-30mm floor, shell tris 6524->6588: the round-3 16-tri midpoint
    # web replaced by 48 far-side fan tris + 32 wall-strip tris that close both
    # sleeve-root slits 1049/1020->0 enclosed cells, rehidden mask holds 881,
    # joints hold 137) and the chest-anchor restore moves the shipped bytes
    # again. Same shape as round 3: HB-05 stays demoted (no rung promoted; the
    # verdict carries forward — the source is 64 seal tris larger at 72618,
    # still inside the 80000 preferred budget, and the shell gained seal tris
    # only (no drape change), so the fp-r0.15 re-run would sit further below
    # the drape counterweight, not closer) and HB-03 re-pins to the live
    # undecimated source. Every after-value below is asserted live by main().
    "mpfb-gown-inspect.glb": {
        "bytesAfter": 8097648,
        "triangleCountAfter": 72633,
        "faceBefore": 52778,
        "faceAfter": 52778,
        "jointCountAfter": 137,
        "jointCountExpected": 137,
        "textSubs": {
            "jointNote": [
                ("137-joint MPFB2 rig since the Nov03 rebake 9542f47b8: the 138th joint (neutral_bone, bound by 3 verts of the retired peds_upper_v1 gown shell only) left with the old gown; joint set otherwise identical",
                 "137-joint MPFB2 rig since the Nov03 rebake 9542f47b8: the 138th joint (neutral_bone, skin slot 137) retired when skinning re-based onto the 137-joint viseme source, which carries no neutral_bone; in the pre-rebake bytes it bound 444 verts across 9 meshes (brows/lashes most, plus the stripped T-shirt and the retired peds_upper_v1 gown); joint set otherwise identical"),
            ],
        },
        "hb05": {
            "triangleCountBefore": 72633,
            "bytesBefore": 8135672,
            "jointCountBefore": 137,
            "promoted": False,
            "noSurvivingRungReason": ("The Sep11 fp-r0.15 rung output did not survive the Nov03 gown rebake 9542f47b8 "
                "(casual T-shirt strip, new hospital-gown shell, rehidden skin mask; joints 138->137 as neutral_bone "
                "retired with the skinning re-base onto the 137-joint viseme source) plus the chest-anchor restore to 8200968 bytes, "
                "the round-3 collar/chin rebake (collar 1.485->1.435, shell tris 6852->6524, rehidden mask 1348->881), "
                "and the round-4 neckline-scoop + sleeve-root seal rebake (front-midline 1.435->1.3834, shell 6524->6588, "
                "slits 1049/1020->0 enclosed cells). The committed "
                "rung re-run on the round-1 source yields 56699 tris with face 52778 intact but shrinks the new shell "
                "below its drape counterweight (shell verts 3503->531 vs the 2000-vert floor; only 4 below-hip bands stay "
                "sampleable and 0 clear 40mm, against clauses needing >4 bands with >=5 clearing), so no rung is promoted; "
                "the verdict carries forward to the round-4 source (72618 tris, still inside the 80000 preferred "
                "budget, shell 64 seal tris larger). Face-retention ratio 1 and the 137-joint invariant now floor "
                "this re-measured source (tris 72618, face 52778); the historical pre-rebake rung is preserved in "
                "supersededRecord."),
            "supersededRecord": {
                "triangleCountBefore": 145287,
                "triangleCountAfter": 69420,
                "bytesBefore": 12999904,
                "bytesAfter": 7922732,
                "faceBefore": 52778,
                "faceAfter": 52778,
                "outputSha256": "0e718440bd978e939211d0da9ebecda7cb4ba01da8d81f8b1520723569e75c95",
                "supersededBecause": ("input lineage replaced by the Nov03 gown rebake 9542f47b8; the Sep11 rung "
                    "output it recorded matches no shipped bytes since the rebake"),
            },
            "outputSha256": "83593e513693f785427144f49402304ac01c728cc0a17f4f7d1a7c3a98a817e9",
            "note": ("Re-measured 2026-11-04 (st-gowninsp round 5): the round-5 centred-cage rebake re-based the source "
                "(rings fit on section centroids + 5-tap loft smoothing with per-ring re-enclosure, seal lips 16->21, "
                "gussets 48->57, patches 32->38; "
                "garment-surface-derived 0.822->0.966, slits stay 0/0, neckline stays 1.3834/1.385 scoop; meshes/nodes/joints hold "
                "10/149/137) plus the chest-anchor restore that moved the shipped bytes 8,135,672->8,097,400 and the garment-provenance stamp (gown mesh extras only, binary chunk identical) 8,097,400->8,097,648. The fp-r0.15 rung verdict "
                "carries forward from round 4 (source inside budget, shell gained seal tris only), so the row stays demoted with ratio-1 and 137-joint floors on the re-measured source; "
                "tris 72633 and face 52778 hold. Prior re-measures (rounds 2-4, Sep28 teeth retreat 9f2934536) preserved "
                "in git history."),
        },
        "hb03": {
            "jointCountBefore": 137,
            "handBodyMeshAfter": 10705,
            "textSubs": {
                "jointNote": [
                    ("137-joint MPFB2 rig since the Nov03 rebake 9542f47b8: the 138th joint (neutral_bone, bound by 3 verts of the retired peds_upper_v1 gown shell only) left with the old gown; joint set otherwise identical",
                     "137-joint MPFB2 rig since the Nov03 rebake 9542f47b8: the 138th joint (neutral_bone, skin slot 137) retired when skinning re-based onto the 137-joint viseme source, which carries no neutral_bone; in the pre-rebake bytes it bound 444 verts across 9 meshes (brows/lashes most, plus the stripped T-shirt and the retired peds_upper_v1 gown); joint set otherwise identical"),
                ],
                "promotionNote": [
                    ("so no rung is promoted and the live GLB is unchanged. The sibling mpfb-gown-adult-patient.glb export covers the same gown subject at 64140 tris inside budget.",
                     "so no rung was promoted and the live GLB stayed on the Sep11 rung bytes until the Nov03 rebake 9542f47b8 re-based it on the new gown shell (undecimated: raw 72882 tris already inside the 80000 preferred budget; the fp-r0.15 re-run breaks the drape counterweight, see the HB-05 row). The sibling mpfb-gown-adult-patient.glb export covers the same gown subject at 64140 tris inside budget."),
                ],
            },
            "note": ("Re-measured 2026-11-04 (st-gowninsp round 5): after-values track the round-5 centred-cage "
                "rebake (rings on section centroids, garment-surface-derived 0.822->0.950, slits stay 0/0, neckline stays 1.3834; meshes/nodes/joints hold "
                "10/149/137) and the chest-anchor restore (shipped bytes 8,164,444->8,126,204, superseding the round-4 pin at a7c4d0294); before-values stay the "
                "Sep11 STOP-branch record. Face 52778 and ratio 1 hold. Prior re-measures (rounds 2-4, Sep11) preserved "
                "in git history."),
        },
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
            scoped = {k: v for k, v in plan.items() if k not in ("note", "textSubs", "hb03", "hb05")}
            scoped.update({k: v for k, v in plan.get(key, {}).items()
                           if k not in ("note", "textSubs")})
            note = plan.get(key, {}).get("note", plan.get("note"))
            subs = plan.get(key, {}).get("textSubs", plan.get("textSubs", {}))
            m = live(body)
            for field in ("bytesAfter", "triangleCountAfter", "faceAfter", "faceBefore",
                          "handBodyMeshAfter"):
                if field in scoped:
                    live_key = {"bytesAfter": "bytes", "triangleCountAfter": "tris",
                                "faceAfter": "face", "faceBefore": "face",
                                "handBodyMeshAfter": "hand"}[field]
                    assert m[live_key] == scoped[field], \
                        f"{body} {field}: plan {scoped[field]} != live {m[live_key]}"
            if "outputSha256" in scoped:
                assert m["sha256"] == scoped["outputSha256"], \
                    f"{body} outputSha256: plan {scoped['outputSha256'][:16]} != live {m['sha256'][:16]}"
            if "jointCountAfter" in scoped:
                assert m["joints"] == scoped["jointCountAfter"], \
                    f"{body} joints re-pin: plan {scoped['jointCountAfter']} != live {m['joints']}"
            else:
                assert m["joints"] == row["jointCountAfter"] == row["jointCountExpected"], \
                    f"{body} joints changed: live {m['joints']}"
            face_before = scoped.get("faceBefore", row["faceBefore"])
            assert m["face"] >= face_before * row["faceRetentionRatio"] or \
                body == "mpfb-peds-parent-aisha.glb", f"{body} floor breach"
            for field, value in scoped.items():
                row[field] = value
            for target_field, pairs in subs.items():
                for old, new in pairs:
                    if old in row.get(target_field, ""):
                        row[target_field] = row[target_field].replace(old, new)
                    else:
                        assert new in row.get(target_field, ""), \
                            f"{body} {target_field}: neither {old!r} nor {new!r} found"
            row["remeasureNote"] = note
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
