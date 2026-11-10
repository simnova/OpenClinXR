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
    # --- st-vitfacet r6 (2026-11-05): skin normalTexture re-bake (F1 dermal
    # recipe, strength 0.8 default; superseding commit d5496bf5b) re-packed six
    # GLB image chunks. Texture bytes only: tris/face/hand/joints hold at their
    # pinned values (asserted live per row by main()).
    "mpfb-clinical-nurse-adult.glb": {
        "bytesAfter": 12353924,
        "triangleCountAfter": 45904,
        "faceAfter": 17725,
        "faceBefore": 17725,
        "handBodyMeshAfter": 12833,
        "note": ("Re-measured 2026-11-10 (teeth F3, tsk_27e0cec12cab410d): the aa upper-shell lateral mean goes -5.79 mm -> 0 (HEAD_MEAN x); 9256 B inside one teeth morph accessor and one accessor min change, tris/face/hand/joints hold (asserted by main()), 12353944 -> 12353924 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-10 (teeth swap, tsk_27e0cec12cab410d): fitted CC0 teeth/tongue replace the hm08 mouth through the byte-preserving retreat/couple chain; tris and face (FACE_RE matches teeth|tongue) grow by the fitted mouth meshes, hand/joints hold (asserted by main()), 9254712 -> 12353944 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 9233948 -> 9254712 B. "
                 "Re-measured 2026-11-05 (st-vitbody3 r2): skin-shade carrier adds actor-derived curvature/cavity plus face 0.15 / body 0.3 detail strengths (face re-picked 0.15 in the r4 sweep, 2026-11-06); bytes-only drift, geometry counts hold (asserted by main()), 8807408 -> 9233948 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-05 (st-vitfacet r7): per-actor dermal seed from the output stem (seeded F1 recipe, strength 0.8 default), bytes-only drift, geometry counts hold (asserted by main()). Superseding commit d5496bf5b. Prior re-measure (st-vitfacet r6) preserved below. "
                 "Re-measured 2026-11-05 (st-vitfacet r6): skin normalTexture re-bake, "
                 "bytes-only drift, geometry counts hold (tris 38958 / face 10779 / hand 12833 / "
                 "joints 137 hold, 8775848 -> 8725404 B). Superseding commit d5496bf5b."),
    },
    # --- st-palette (2026-11-04): sRGB palette fold. Physician is bytes-only
    # (texture refold); face/hand/joints hold. Asserted live.

    "mpfb-clinical-physician-adult.glb": {
        "bytesAfter": 9497600,
        "triangleCountAfter": 41718,
        "faceAfter": 10130,
        "handBodyMeshAfter": 12890,
        "note": ("Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 9476168 -> 9497600 B. "
                 "Re-measured 2026-11-06 (st-vitphys r1): family-skin-albedo deep r8 + vitruvian-eye brown post-export byte stages, "
                 "bytes-only drift (tris 41718 / face 10130 / hand 12890 / joints 137 hold, "
                 "9320372 -> 9476168 B). Supersedes 0ed4fcfc7. Family source sha256 "
                 "a063cce36e87cdadfff349e5982f44ed66bec4666b4375cc814768af337efdca. "
                 "Prior re-measure (st-vitphys r1 r9 attempt, 9320372 -> 9476164 B, superseded before commit) preserved below. "
                 "Re-measured 2026-11-05 (st-vitfacet r7): per-actor dermal seed from the output stem (seeded F1 recipe, strength 0.8 default), bytes-only drift, geometry counts hold (asserted by main()). Superseding commit d5496bf5b. Prior re-measure (st-vitfacet r6) preserved below. "
                 "Re-measured 2026-11-05 (st-vitfacet r6): skin normalTexture re-bake, "
                 "bytes-only drift (tris 41718 / face 10130 / hand 12890 / joints 137 hold, "
                 "9293412 -> 9238432 B). Superseding commit d5496bf5b (re-bake the six "
                 "faceted skin normals at the F1 dermal recipe). "
                 "Prior re-measure (st-palette 3969ae031 sRGB palette fold) preserved in "
                 "git history."),
    },
    # --- HB-03 rows (partner includes the deliberate r5b brow-only geometry change) ---
    "mpfb-family-partner-adult.glb": {
        "bytesAfter": 13327592,
        "triangleCountAfter": 45404,
        "faceBefore": 20375,
        "faceAfter": 20375,
        "handBodyMeshAfter": 13357,
        "note": ("Re-measured 2026-11-10 (teeth F3, tsk_27e0cec12cab410d): the aa upper-shell lateral mean goes -5.79 mm -> 0 (HEAD_MEAN x); 9256 B inside one teeth morph accessor and one accessor min change, tris/face/hand/joints hold (asserted by main()), 13327612 -> 13327592 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-10 (teeth swap, tsk_27e0cec12cab410d): fitted CC0 teeth/tongue replace the hm08 mouth through the byte-preserving retreat/couple chain; tris and face (FACE_RE matches teeth|tongue) grow by the fitted mouth meshes, hand/joints hold (asserted by main()), 10228348 -> 13327612 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 10077060 -> 10228348 B. "
                 "Re-measured 2026-11-05 (st-vitbody3 r2): skin-shade carrier adds actor-derived curvature/cavity plus face 0.15 / body 0.3 detail strengths (face re-picked 0.15 in the r4 sweep, 2026-11-06); bytes-only drift, geometry counts hold (asserted by main()), 9649116 -> 10077060 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-05 (st-vitbrowdense r5b): fitted brow transplant replaces style 10 with the graded style 07 at 9,396 tris, then hair colour is a no-op and the subject-derived roughness breakup is replayed; body 13357 / face 13429 / total 38458 / joints 137 hold after the deliberate brow-only geometry change, 9182096 -> 9649116 B. "
                 "Prior st-vitrough r4: post-export roughness breakup stage writes a subject-derived skin metallicRoughness texture, 9182096 -> 9196228 B. "
                 "Prior st-vitbrow r4: post-export hair colour stage sets scalp+brow baseColorFactor to the authored black token, JSON chunk only, BIN verbatim, 9182184 -> 9182096 B. "
                 "Prior st-vitdark r9: dark-tail soft floor in the skin BaseColor remap only, 9178752 -> 9182184 B. "
                 "Prior r3 render-defect correction 9178416 -> 9178752 B; r2 remap 9330184 -> 9178416 B. "
                 "Prior st-viteye r3 re-measure: commit 931343e6b swapped the Vitruvian iris/sclera image, 9277296 -> 9330184 B. "
                 "Re-measured 2026-10-30 (ci-w11b): bytes-only drift, geometry identical "
                 "(tris 39974 / face 14945 / hand 13357 / joints 137 all hold). Superseding "
                 "commit d1c44f8cd (ci-w11 D1 orphan prune, 10529144 -> 9277296 B). Prior "
                 "re-measure (fc57e5a9 family normalTexture unbind) preserved in git history."),
    },
    "mpfb-viseme-inspect.glb": {
        "bytesAfter": 17141520,
        "triangleCountAfter": 75995,
        "faceAfter": 59706,
        "note": ("Re-measured 2026-11-10 (teeth swap, tsk_27e0cec12cab410d): fitted CC0 teeth/tongue replace the hm08 mouth through the byte-preserving retreat/couple chain; tris and face (FACE_RE matches teeth|tongue) grow by the fitted mouth meshes, hand/joints hold (asserted by main()), 14421480 -> 17141520 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 14021388 -> 14421480 B. "
                 "Re-measured 2026-11-05 (st-vitfacet r7): per-actor dermal seed from the output stem (seeded F1 recipe, strength 0.8 default), bytes-only drift, geometry counts hold (asserted by main()). Superseding commit d5496bf5b. Prior re-measure (st-vitfacet r6) preserved below. "
                 "Re-measured 2026-11-05 (st-vitfacet r6): skin normalTexture re-bake, "
                 "bytes-only drift, geometry counts identical (tris 69067 / face 52778 / "
                 "joints 137 all hold, 13976324 -> 13939760 B). Superseding commit d5496bf5b. "
                 "Prior re-measure (st-hemfin D2 e35ee741a hem-finish splice) preserved in "
                 "git history."),
    },
    "mpfb-gown-adult-patient.glb": {
        "bytesAfter": 10316520,
        "triangleCountAfter": 47233,
        "handBodyMeshAfter": 14928,
        "note": ("Re-measured 2026-11-10 (teeth F3, tsk_27e0cec12cab410d): the aa upper-shell lateral mean goes -5.79 mm -> 0 (HEAD_MEAN x); 9256 B inside one teeth morph accessor and one accessor min change, tris/face/hand/joints hold (asserted by main()), 10316540 -> 10316520 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-10 (teeth swap, tsk_27e0cec12cab410d): fitted CC0 teeth/tongue replace the hm08 mouth through the byte-preserving retreat/couple chain; tris and face (FACE_RE matches teeth|tongue) grow by the fitted mouth meshes, hand/joints hold (asserted by main()), 7217372 -> 10316540 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 7196640 -> 7217372 B. Pre-repack bytes are those of 1c5027169 (last origin/main commit touching this GLB). Prior re-measure preserved below. "
                 "Re-measured 2026-11-05 (st-vitbody3 r2): skin-shade carrier adds actor-derived curvature/cavity plus face 0.15 / body 0.3 detail strengths (face re-picked 0.15 in the r4 sweep, 2026-11-06); bytes-only drift, geometry counts hold (asserted by main()), 6763692 -> 7196640 B. Prior re-measure preserved below. "
                 "Re-measured 2026-10-30 (ci-w11b): bytes-only drift, geometry identical "
                 "(tris 40277 / face 14357 / hand 14928 / joints 138 all hold). Superseding "
                 "commit d1c44f8cd (ci-w11 D1 orphan prune incl. a dead T-shirt material, "
                 "20462724 -> 6763692 B). Prior re-measure (d10314025/4aaf5ba16 supine "
                 "rebake, 1814a43c1 byte-lineage) preserved in git history."),
    },
    "mpfb-peds-patient-child.glb": {
        "bytesAfter": 14341940,
        "triangleCountAfter": 84350,
        "handBodyMeshAfter": 26756,
        "note": ("Re-measured 2026-11-10 (teeth F3, tsk_27e0cec12cab410d): the aa upper-shell lateral mean goes -5.79 mm -> 0 (HEAD_MEAN x); 9256 B inside one teeth morph accessor and one accessor min change, tris/face/hand/joints hold (asserted by main()), 14341960 -> 14341940 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-10 (teeth swap, tsk_27e0cec12cab410d): fitted CC0 teeth/tongue replace the hm08 mouth through the byte-preserving retreat/couple chain; tris and face (FACE_RE matches teeth|tongue) grow by the fitted mouth meshes, hand/joints hold (asserted by main()), 11242708 -> 14341960 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 10842652 -> 11242708 B. Pre-repack bytes are those of 1c5027169 (last origin/main commit touching this GLB). Prior re-measure preserved below. "
                 "Re-measured 2026-11-05 (st-vitbody3 r2): skin-shade carrier adds actor-derived curvature/cavity plus face 0.15 / body 0.3 detail strengths (face re-picked 0.15 in the r4 sweep, 2026-11-06); bytes-only drift, geometry counts hold (asserted by main()), 10418700 -> 10842648 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-04 (st-palette): bytes-only drift, geometry identical "
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
        "bytesAfter": 22269564,
        "triangleCountAfter": 80320,
        "note": ("Re-measured 2026-11-10 (teeth swap, tsk_27e0cec12cab410d): fitted CC0 teeth/tongue replace the hm08 mouth through the byte-preserving retreat/couple chain; tris and face (FACE_RE matches teeth|tongue) grow by the fitted mouth meshes, hand/joints hold (asserted by main()), 19549552 -> 22269564 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 19149460 -> 19549552 B. Pre-repack bytes are those of 7fd92dd87 (last origin/main commit touching this GLB). Prior re-measure preserved below. "
                 "Re-measured 2026-11-06 (st-vitfamily r1 R4 fixed8): albedo-embed stage (post-export byte "
                 "stage, not a rebake; embed_skin_albedo rewrites only the skin material baseColor "
                 "image bytes to the 4096 D4a-exemplar-inpainted + D4b-temple-filled stage3-colour-fixed8.png "
                 "(sha256 pinned as albedoSha256 in the Aisha provenance); geometry/BIN prefix verbatim; tris 73392 / face 52778 / joints 137 hold, "
                 "19144852 -> 19149460 B; supersedes the R3 19144852 B embed). "
                 "Prior st-vitfamily r1 R3 fixed3: albedo-embed stage (post-export byte "
                 "stage, not a rebake; embed_skin_albedo rewrites only the skin material baseColor "
                 "image bytes to the 4096 D4a-exemplar-inpainted + D4b-temple-filled stage3-colour-fixed3.png "
                 "(sha256 recorded in the R3 Aisha provenance); geometry/BIN prefix verbatim; tris 73392 / face 52778 / joints 137 hold, "
                 "19095616 -> 19144852 B; supersedes the R2 19095616 B embed). "
                 "Prior st-vitfamily r1 R2: albedo-embed of the 4096 brow-cleared + temple-feathered stage3-colour-fixed.png "
                 "(10219564 -> 19095616 B; superseded the R1 19097100 B embed). "
                 "Prior st-vitfamily r1: first albedo embed at 19097100 B. "
                 "Prior st-vitbody2 r8: face and body detail TextureInfo values share one 191439 B Vitruvian face tile texture; face scale 90 and stochastic-hex body scale 128 remain independent, removing the rejected Torso payload while geometry counts hold (tris 73392 / face 52778 / joints 137). "
                 "Prior st-vitbody2 r7: the carrier embedded a separate 138314 B Torso crop at scale 118; rejected by native 1:1 anisotropy review and removed. "
                 "Prior st-vitpore r2: the carrier added a 191439 B Vitruvian-derived periodic face detail normal through OPENCLINXR_skin_shade with KHR_texture_transform scale 90; geometry/BIN prefix verbatim; tris 73392 / face 52778 / joints 137 hold, 10021840 -> 10213572 B. "
                 "Prior st-viteye r3 re-measure: 931343e6b swapped the Vitruvian iris/sclera image, 9914108 -> 10021840 B. "
                 "Re-measured 2026-11-04 (st-vitskin): skin-shade carrier stage "
                 "(post-export byte stage, not a rebake; one RG image + "
                 "OPENCLINXR_skin_shade material extension appended, geometry/BIN "
                 "verbatim; tris 73392 / face 52778 / joints 137 hold, "
                 "9700420 -> 9914108 B). Prior re-measure (st-redgarm D1, "
                 "1225b8f95) preserved in git history."),
    },
    "mpfb-peds-nurse-kevin.glb": {
        "bytesAfter": 20026072,
        "triangleCountAfter": 105030,
        "note": ("Re-measured 2026-11-10 (teeth F3, tsk_27e0cec12cab410d): the aa upper-shell lateral mean goes -5.79 mm -> 0 (HEAD_MEAN x); 9256 B inside one teeth morph accessor and one accessor min change, tris/face/hand/joints hold (asserted by main()), 20026092 -> 20026072 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-10 (teeth swap, tsk_27e0cec12cab410d): fitted CC0 teeth/tongue replace the hm08 mouth through the byte-preserving retreat/couple chain; tris and face (FACE_RE matches teeth|tongue) grow by the fitted mouth meshes, hand/joints hold (asserted by main()), 16926856 -> 20026092 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 16526836 -> 16926856 B. Pre-repack bytes are those of 1c5027169 (last origin/main commit touching this GLB). Prior re-measure preserved below. "
                 "Re-measured 2026-11-05 (st-vitbody3 r2): skin-shade carrier adds actor-derived curvature/cavity plus face 0.15 / body 0.3 detail strengths (face re-picked 0.15 in the r4 sweep, 2026-11-06); bytes-only drift, geometry counts hold (asserted by main()), 16105284 -> 16526836 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-05 (st-vitfacet r7): per-actor dermal seed from the output stem (seeded F1 recipe, strength 0.8 default), bytes-only drift, geometry counts hold (asserted by main()). Superseding commit d5496bf5b. Prior re-measure (st-vitfacet r6) preserved below. "
                 "Re-measured 2026-11-05 (st-vitfacet r6): skin normalTexture re-bake, "
                 "bytes-only drift, geometry counts hold (tris 98102 / face 46160 / joints 137 hold, "
                 "16074580 -> 16026048 B; asserted by main()). Superseding commit d5496bf5b. "
                 "Re-measured 2026-11-04 (st-viteye r3): bytes-only drift, geometry counts hold (asserted by main()). Superseding commit 931343e6b (Vitruvian iris/sclera image swap, 15966652 -> 16074580 B). "
                 "Re-measured 2026-11-04 (st-palette): bytes-only drift, geometry counts hold (asserted by main()). Superseding commit 3969ae031 (sRGB palette fold). "
                 "Re-measured 2026-11-02 (st-redgarm D1): shirt 2814->9384 / pants "
                 "810->2704 / boots 9230->30768 tris (+30002; tris 68100->98102, face "
                 "46160 / joints 137 hold; still under the 120000 acceptableSingleProp "
                 "budget). Superseding commit 1225b8f95 (D1 garment smooth: full-res "
                 "transplants + 60-deg post-export smooth). Prior re-measures (HB-05 rung, "
                 "ci-w11b) preserved in git history."),
    },
    "mpfb-peds-parent-aisha.glb": {
        "bytesAfter": 19283980,
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
        "note": ("Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 18883952 -> 19283980 B. Pre-repack bytes are those of 1c5027169 (last origin/main commit touching this GLB). Prior re-measure preserved below. "
                 "Re-measured 2026-11-05 (st-vitbody3 r2): skin-shade carrier adds actor-derived curvature/cavity plus face 0.15 / body 0.3 detail strengths (face re-picked 0.15 in the r4 sweep, 2026-11-06); bytes-only drift, geometry counts hold (asserted by main()), 18446536 -> 18883952 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-04 (st-palette): bytes-only drift, geometry counts hold (asserted by main()). Superseding commit 3969ae031 (sRGB palette fold). "
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
        "bytesAfter": 11262652,
        "triangleCountAfter": 79561,
        "faceBefore": 59706,
        "faceAfter": 59706,
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
            "outputSha256": "881af5057291735f11d48f34055525b666ae955165028baf37750015b6a41be3",
            "note": ("Re-measured 2026-11-10 (teeth swap, tsk_27e0cec12cab410d): fitted CC0 teeth/tongue replace the hm08 mouth through the byte-preserving retreat/couple chain; tris and face (FACE_RE matches teeth|tongue) grow by the fitted mouth meshes, hand/joints hold (asserted by main()), 8542692 -> 11262652 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 8142588 -> 8542692 B. Pre-repack bytes are those of 0ed4fcfc7 (last origin/main commit touching this GLB). Prior re-measure preserved below. "
                     "Re-measured 2026-11-05 (st-vitfacet r7): per-actor dermal seed from the output stem (seeded F1 recipe, strength 0.8 default), bytes-only drift, geometry counts hold (asserted by main()). Superseding commit d5496bf5b. Prior re-measure (st-vitfacet r6) preserved below. "
                "Re-measured 2026-11-05 (st-vitfacet r6): skin normalTexture re-bake, "
                "bytes-only drift (tris 72633 / face 52778 / joints 137 hold, 8061124 -> "
                "8142588 B; sha tracks the live GLB). Superseding commit d5496bf5b. "
                "Prior round-5 detail (rings fit on section centroids + 5-tap loft smoothing with per-ring re-enclosure, seal lips 16->21, "
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
            "note": ("Re-measured 2026-11-10 (teeth swap, tsk_27e0cec12cab410d): fitted CC0 teeth/tongue replace the hm08 mouth through the byte-preserving retreat/couple chain; tris and face (FACE_RE matches teeth|tongue) grow by the fitted mouth meshes, hand/joints hold (asserted by main()), 8542692 -> 11262652 B. Prior re-measure preserved below. "
                 "Re-measured 2026-11-09 (lash-follow r8, tsk_381fda384bdda8dc): repack adds the upper-lash closure morph targets, bytes-only drift, geometry counts hold (asserted by main()), 8142588 -> 8542692 B. Pre-repack bytes are those of 0ed4fcfc7 (last origin/main commit touching this GLB). Prior re-measure preserved below. "
                     "Re-measured 2026-11-05 (st-vitfacet r7): per-actor dermal seed from the output stem (seeded F1 recipe, strength 0.8 default), bytes-only drift, geometry counts hold (asserted by main()). Superseding commit d5496bf5b. Prior re-measure (st-vitfacet r6) preserved below. "
                "Re-measured 2026-11-05 (st-vitfacet r6): skin normalTexture re-bake, "
                "bytes-only drift (tris 72633 / face 52778 / hand 10705 / joints 137 hold, 8061124 -> "
                "8142588 B). Superseding commit d5496bf5b. "
                "Prior re-measure (st-gowninsp round 5): after-values track the round-5 centred-cage "
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
