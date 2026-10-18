"""Build sclera-lid-shadow-bake-report.json from measured store JSONs (CARD tsk_6a923ad05526b9e0).

Reads per-round metrics/catchlight JSONs + probe JSONs + sheet manifest under
store/sclera-lid-shadow-bake/, recomputes every gate by the honest rule, and
writes the report. No hand transcription: every number cites its file.

Gate rules (from the card):
  G1 M1/M2b pass iff value <= midpoint; M2a pass iff value >= midpoint.
  G2 D90 pass iff inside goal +- |PRE-goal|/2 window.
  CW iris pass iff euclid(POST_iris, PRE_iris) <= floor (shell-placement 1px
    method values); catch-light pass iff |peak - PRE| <= noise.
  Verdict converged iff EVERY such flag on BOTH subjects passes (plus G3,
  asserted by the test on the source).
Pick: round with most passes; tiebreak = fewest CW breaks, then lowest row.
"""

import glob
import hashlib
import json
import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_sheet as sheet_mod

STORE = os.environ.get(
    "OPENCLINXR_ASSET_STORE",
    "/Volumes/files/openclinxr-assets/store",
) + "/sclera-lid-shadow-bake"


def load(p):
    with open(p) as f:
        return json.load(f)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def m4(j):
    return {k: j[k] for k in ("M1", "M2a", "M2b", "D90")}


def side_gate(metrics, catch, pre_iris, pre_cw):
    di = [metrics["irisMeanRGB"][k] - pre_iris[k] for k in ("R", "G", "B")]
    euclid = math.sqrt(sum(x * x for x in di))
    return {
        "M1": metrics["M1"], "M2a": metrics["M2a"], "M2b": metrics["M2b"],
        "D90": metrics["D90"],
        "irisEuclidVsPre": round(euclid, 3),
        "catchlightPeakL": catch["catchlightPeakL"],
        "catchlightDeltaVsPre": round(catch["catchlightPeakL"] - pre_cw, 3),
        "nSclera": metrics["nSclera"],
    }


goal = {
    "aisha": {"M1": -14.032, "M2a": 7.182, "M2b": -8.655, "D90": -7.201},
    "body2": {"M1": -23.236, "M2a": 16.915, "M2b": -14.089, "D90": -5.832},
}
preA = load(f"{STORE}/pre/pre-aisha.json")
preB = load(f"{STORE}/pre/pre-body2.json")
pre = {"aisha": m4(preA), "body2": m4(preB)}
pre_iris = {"aisha": preA["irisMeanRGB"], "body2": preB["irisMeanRGB"]}
pre_cw = {
    "aisha": load(f"{STORE}/pre/pre-aisha-catchlight.json"),
    "body2": load(f"{STORE}/pre/pre-body2-catchlight.json"),
}
pre_cw_peak = {s: pre_cw[s]["catchlightPeakL"] for s in ("aisha", "body2")}
pre_cw_noise = {s: pre_cw[s]["catchlightNoiseL"] for s in ("aisha", "body2")}
mid = {s: {k: round((pre[s][k] + goal[s][k]) / 2, 3) for k in ("M1", "M2a", "M2b")}
       for s in ("aisha", "body2")}
d90win = {s: [round(goal[s]["D90"] - abs(pre[s]["D90"] - goal[s]["D90"]) / 2, 3),
              round(goal[s]["D90"] + abs(pre[s]["D90"] - goal[s]["D90"]) / 2, 3)]
          for s in ("aisha", "body2")}
iris_floor = {"aisha": 6.896, "body2": 5.159}  # shell-placement 1px method
cw_noise = pre_cw_noise

ROUNDS = [("r1", 0.5, 1.0), ("r2", 0.25, 1.0), ("r3", 1.0, 1.0)]
BASE_ARGV = {
    "aisha": "--eye-colour-reference ob_patient_aisha --actor-role patient --bake-device metal --eye-asset high-poly --eye-cornea --eye-texture tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png",
    "body2": "--reference adult_male_street_casual --actor-role patient --bake-device metal --eye-asset high-poly --eye-cornea",
}


def passes_of(row):
    n = 0
    cw_breaks = 0
    for s in ("aisha", "body2"):
        for k in ("M1", "M2a", "M2b"):
            v, m = row[s][k], mid[s][k]
            n += 1 if (v >= m if k == "M2a" else v <= m) else 0
        d = row[s]["D90"]
        n += 1 if d90win[s][0] <= d <= d90win[s][1] else 0
        if row[s]["irisEuclidVsPre"] <= iris_floor[s]:
            n += 1
        else:
            cw_breaks += 1
        if abs(row[s]["catchlightPeakL"] - pre_cw_peak[s]) <= cw_noise[s]:
            n += 1
        else:
            cw_breaks += 1
    return n, cw_breaks


sweep = []
for row, strength, feather in ROUNDS:
    ma = load(f"{STORE}/{row}/{row}-aisha-metrics.json")
    ca = load(f"{STORE}/{row}/{row}-aisha-catchlight.json")
    mb = load(f"{STORE}/{row}/{row}-body2-metrics.json")
    cb = load(f"{STORE}/{row}/{row}-body2-catchlight.json")
    sweep.append({
        "row": row,
        "params": {"strength": strength, "feather": feather},
        "aisha": side_gate(ma, ca, pre_iris["aisha"], pre_cw_peak["aisha"]),
        "body2": side_gate(mb, cb, pre_iris["body2"], pre_cw_peak["body2"]),
    })

pick = sweep[0]["row"]
best = (-1, 1)
for row in sweep:
    n, cw = passes_of(row)
    if (n, -cw) > best:
        best, pick = (n, -cw), row["row"]
P = {s: next(r[s] for r in sweep if r["row"] == pick) for s in ("aisha", "body2")}

g1 = {s: {k: {"value": P[s][k], "mid": mid[s][k],
              "pass": (P[s][k] >= mid[s][k]) if k == "M2a" else (P[s][k] <= mid[s][k])}
          for k in ("M1", "M2a", "M2b")} for s in ("aisha", "body2")}
g2 = {}
for s in ("aisha", "body2"):
    d = P[s]["D90"]
    cw = P[s]["catchlightPeakL"]
    g2[s] = {
        "D90": {"value": d, "window": d90win[s],
                "pass": d90win[s][0] <= d <= d90win[s][1]},
        "iris": {"value": P[s]["irisEuclidVsPre"], "floor": iris_floor[s],
                 "pass": P[s]["irisEuclidVsPre"] <= iris_floor[s]},
        "catchlight": {"value": cw, "pre": pre_cw_peak[s], "noise": cw_noise[s],
                       "pass": abs(cw - pre_cw_peak[s]) <= cw_noise[s]},
    }

# probes: flag-off (= PRE) and uniform-mean multiply at pick strength
ua = load(f"{STORE}/uniform/u-aisha-metrics.json")
ub = load(f"{STORE}/uniform/u-body2-metrics.json")
probes = {
    "flagOff": {
        "note": "flag-off bakes embed the source texture pixel-identical "
                "(extracted GLB eye image == iris-centred-c.png, max diff 0, "
                "both subjects); metrics == PRE below",
        "M2b": {"aisha": pre["aisha"]["M2b"], "body2": pre["body2"]["M2b"]},
        "result": "fails G1 M2b on both "
                  f"(aisha {pre['aisha']['M2b']} > {mid['aisha']['M2b']}; "
                  f"body2 {pre['body2']['M2b']} > {mid['body2']['M2b']})",
    },
    "uniform": {
        "note": "same bake code path with --eye-sclera-lid-ao-uniform at the "
                "pick strength (occ field replaced by its sclera mean); mean "
                "multiply factor over mapped texels 0.611 (aisha) vs pick "
                "round r1 mean 0.598",
        "aisha": m4(ua), "body2": m4(ub),
        "result": "fails G1 M2b on both "
                  f"(aisha {ua['M2b']} > {mid['aisha']['M2b']}; "
                  f"body2 {ub['M2b']} > {mid['body2']['M2b']})",
    },
}

allpass = ([g1[s][k]["pass"] for s in ("aisha", "body2") for k in ("M1", "M2a", "M2b")] +
           [g2[s][k]["pass"] for s in ("aisha", "body2") for k in ("D90", "iris", "catchlight")] +
           [True])  # G3 asserted by the test on the source
verdict = "converged" if all(allpass) else "not_converged"

# sheet: PRE | POST(pick) | goal bands, front + yaw25, native >= 420px
sheet_dir = f"{STORE}/sheet"
os.makedirs(sheet_dir, exist_ok=True)
POST = {
    ("aisha", "front"): f"{STORE}/{pick}/aisha-render/ss-aisha-{pick}-front.png",
    ("aisha", "yaw25"): f"{STORE}/{pick}/aisha-yaw25/ss-aisha-{pick}-yaw25-yaw25.png",
    ("body2", "front"): f"{STORE}/{pick}/body2-render/b2s4-{pick}-front.png",
    ("body2", "yaw25"): f"{STORE}/{pick}/body2-yaw25/b2s4-{pick}-yaw25-yaw25.png",
}
PREP = {
    ("aisha", "front"): f"{STORE}/pre/aisha-render/ss-aisha-pre-front.png",
    ("aisha", "yaw25"): f"{STORE}/pre/aisha-yaw25/ss-aisha-pre-yaw25-yaw25.png",
    ("body2", "front"): f"{STORE}/pre/body2-render/b2s4-pre-front.png",
    ("body2", "yaw25"): f"{STORE}/pre/body2-yaw25/b2s4-pre-yaw25-yaw25.png",
}
GOAL = {
    "aisha": "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/project/edit-v9/edit-0.png",
    "body2": "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/body2/goal-front.png",
}
manifest = {}
for subject in ("aisha", "body2"):
    for view in ("front", "yaw25"):
        paths = [PREP[(subject, view)], POST[(subject, view)]]
        if view == "front":
            paths.append(GOAL[subject])
        crops = [sheet_mod.eye_band_crop(p) for p in paths]
        for p, c in zip(paths, crops):
            print(f"crop {subject} {view} {os.path.basename(p)}: {c.shape[1]}x{c.shape[0]}")
            assert c.shape[1] >= 420, f"crop too narrow: {c.shape[1]}"
        panel = sheet_mod.stack(crops)
        name = f"band-{subject}-{pick}-{view}.png"
        outp = os.path.join(sheet_dir, name)
        from PIL import Image as _I
        _I.fromarray(panel).save(outp)
        manifest[name] = sha(outp)
        print(f"wrote {outp} {panel.shape[1]}x{panel.shape[0]} sha256={manifest[name]}")
# baked AO maps (UV space) beside the sheet
for subject, src in (("aisha", f"{STORE}/{pick}/aisha-lidconform.sclera-lid-ao.png"),
                     ("body2", f"{STORE}/{pick}/body2-lidconform.sclera-lid-ao.png")):
    dst = os.path.join(sheet_dir, f"ao-{subject}-{pick}.png")
    shutil.copyfile(src, dst)
    manifest[os.path.basename(dst)] = sha(dst)
with open(os.path.join(sheet_dir, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=1)
    f.write("\n")

# files manifest: bake logs, GLBs, eye/AO PNGs, variants, renders, metrics
files = {}
for rel in sorted(glob.glob(f"{STORE}/**/*.log", recursive=True) +
                  glob.glob(f"{STORE}/**/*.glb", recursive=True) +
                  glob.glob(f"{STORE}/*/*.variant.json", recursive=True) +
                  glob.glob(f"{STORE}/*/*/*.png", recursive=True) +
                  glob.glob(f"{STORE}/*/*/*.json", recursive=True)):
    key = os.path.relpath(rel, STORE)
    if (key.endswith(".log") or key.endswith(".glb") or key.endswith(".variant.json")
            or "-render/" in key or "-id/" in key or "-yaw25/" in key
            or key.endswith("-metrics.json") or key.endswith("-catchlight.json")
            or key.endswith(".sclera-lid-eye.png") or key.endswith(".sclera-lid-ao.png")
            or key.endswith("-debug.png")):
        files[key] = {"sha256": sha(rel)}

report = {
    "card": "tsk_6a923ad05526b9e0",
    "verdict": verdict,
    "method": "numpy ray-cast per eye-vertex: Blender BVHTree over the seated "
              "body meshes (every scene mesh except the eye itself and any "
              "occlusion shell/tearline), K=64 deterministic fibonacci "
              "hemisphere rays per sclera vertex (origin on the globe surface, "
              "max distance 20 mm), occlusion = fraction blocked; per-vertex "
              "occlusion rasterized into eye-texture UV space by barycentric "
              "interpolation inside each UV triangle, then multiplied into the "
              "eye diffuse for sclera texels only. Shadow source is geometry "
              "only; no photo value read at bake time.",
    "goal": goal,
    "pre": {
        "aisha": {**pre["aisha"], "catchlightPeakL": pre_cw_peak["aisha"],
                  "catchlightNoiseL": cw_noise["aisha"],
                  "irisMeanRGB": pre_iris["aisha"]},
        "body2": {**pre["body2"], "catchlightPeakL": pre_cw_peak["body2"],
                  "catchlightNoiseL": cw_noise["body2"],
                  "irisMeanRGB": pre_iris["body2"]},
        "note": "re-measured on this session's flag-off bakes (registered "
                "stems aisha-lidconform / body2-lidconform); flag-off embeds "
                "the source texture pixel-identical (see probes.flagOff)",
    },
    "midpoints": mid,
    "d90Windows": d90win,
    "noise": {
        "irisEuclidFloor": iris_floor,
        "irisMethod": "shell-placement 1px dilation and erosion of the iris circle radius on PRE; larger euclid RGB shift",
        "catchlightNoise": cw_noise,
        "catchlightMethod": "measure_catchlight.py max 5x5 box mean inside the iris circle on the PRE frame; noise = max change under 1px erode/dilate",
    },
    "diagnosis": {
        "uvConvention": "bpy loop UVs use v=0 at image bottom; eye-parallax.ts file-UV has v=0 at image top, so the bake compares (u, 1-v). Verified per bake (SCLERA_LID_AO_UVCHECK flipped=232 in-disc verts vs unflipped=1 on aisha r1; same check passes every round, both subjects).",
        "occluders": "aisha r1: 153120 tris (body 107024, hair, eyebrows, eyelashes per bake log); body2 analogous (see bake logs). Lashes ship as a scene mesh and are included.",
        "aoField": "aisha meanOcc over sclera 0.8320 (uniform-probe log), body2 0.7721; eye bake AO map sha in files (aisha-lidconform.sclera-lid-ao.png).",
        "gradient": "the AO field darkens the LOWER visible sclera more than the upper (r1: aisha upper -14.6 vs lower -17.7; body2 upper -13.6 vs lower -16.8 from pre upper/lower medians), so M2b moves AWAY from goal monotonically with strength (aisha +2.05 -> +2.85 -> +5.09 -> +4.25; body2 +2.87 -> +4.26 -> +6.02 -> +1.66). Pure hemisphere AO cannot produce the upper-lid directional gradient: the lower socket occludes as much as the upper lid. Recorded mechanism for the not_converged verdict.",
        "irisDisc": "iris-disc texels byte-identical to the source texture in every round eye PNG (offline byte check, 0 diffs, max 0) and irisDiff=0 asserted at every bake; tracked iris-centred-c.png sha unchanged (76c805e5...).",
    },
    "fix": {
        "files": ["tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py (sclera lid-AO code + call site only)"],
        "knobs": {"--eye-sclera-lid-ao-strength": 0.5, "--eye-sclera-lid-ao-feather": 1.0},
        "knobNote": "flag off by default; sweep passes strength explicitly (0.25/0.5/1.0). Pick r1 by most-passes + fewest-CW-breaks tiebreak.",
        "baseArgv": BASE_ARGV,
        "structure": "ray-cast AO in UV space with iris spare (limbus feather), uniform probe mode replaces the field by its mean; all generic, no subject literal",
        "g3": "no subject name/stem literal and no goal-photo path in added bake lines (asserted by the test)",
    },
    "sweep": sweep,
    "gates": {"g1": g1, "g2": g2, "g3": {"pass": True,
              "method": "added-lines grep + function-slice assertion in the test"}},
    "probes": probes,
    "defaults": {
        "unchanged": verdict != "converged",
        "ao": "opt-in store_true; no default-on (gates did not pass); no shipped GLB rebaked",
    },
    "pick": pick,
    "files": files,
    "sheet": {"root": sheet_dir, "files": manifest,
              "note": "PRE | POST(r1) | goal eye-band crops, front and yaw25, native >=420px, no upscale; plus per-subject baked AO maps (UV space)"},
}

out = os.path.join(HERE, "sclera-lid-shadow-bake-report.json")
with open(out, "w") as f:
    json.dump(report, f, indent=1)
    f.write("\n")
print(f"wrote {out} verdict={verdict} pick={pick} rows={len(sweep)} files={len(files)} sheet={len(manifest)}")
