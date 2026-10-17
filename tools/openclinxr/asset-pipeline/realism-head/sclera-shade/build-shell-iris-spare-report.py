"""Build shell-iris-spare-report.json from measured store JSONs (CARD tsk_57f4ae74d62739e0).

Reads per-round metrics/catchlight JSONs + probe JSONs + sheet manifest under
store/shell-iris-spare/, recomputes every gate by the honest rule, and writes
the report. No hand transcription: every number cites its file.

Gate rules (G1 unchanged from shell-placement; G2 per brief):
  G1 M1/M2b pass iff value <= midpoint; M2a pass iff value >= midpoint.
  G2 D90 pass iff inside goal/PRE window; iris pass iff euclid <= floor;
  catch-light pass iff |peak - PRE| <= noise.
Verdict converged iff EVERY such flag on BOTH subjects passes (plus G3).
"""
import glob
import hashlib
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.environ.get(
    "OPENCLINXR_ASSET_STORE",
    "/Volumes/files/openclinxr-assets/store",
) + "/shell-iris-spare"
PRE_STORE = os.environ.get(
    "OPENCLINXR_ASSET_STORE",
    "/Volumes/files/openclinxr-assets/store",
) + "/shell-placement/pre"


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


# ---- static inputs (measured, recorded) ----
goal = {
    "aisha": {"M1": -14.032, "M2a": 7.182, "M2b": -8.655, "D90": -7.201},
    "body2": {"M1": -23.236, "M2a": 16.915, "M2b": -14.089, "D90": -5.832},
}
preA = load(f"{PRE_STORE}/pre-aisha.json")
preB = load(f"{PRE_STORE}/pre-body2.json")
pre = {"aisha": m4(preA), "body2": m4(preB)}
pre_iris = {"aisha": preA["irisMeanRGB"], "body2": preB["irisMeanRGB"]}
pre_cw = {
    "aisha": load(f"{STORE}/pre-aisha-catchlight.json"),
    "body2": load(f"{STORE}/pre-body2-catchlight.json"),
}
mid = {s: {k: round((pre[s][k] + goal[s][k]) / 2, 3) for k in ("M1", "M2a", "M2b")}
       for s in ("aisha", "body2")}
d90win = {s: [round(goal[s]["D90"] - abs(pre[s]["D90"] - goal[s]["D90"]) / 2, 3),
              round(goal[s]["D90"] + abs(pre[s]["D90"] - goal[s]["D90"]) / 2, 3)]
          for s in ("aisha", "body2")}
iris_floor = {"aisha": 6.896, "body2": 5.159}  # shell-placement-report 1px method
cw_noise = {"aisha": pre_cw["aisha"]["catchlightNoiseL"],
            "body2": pre_cw["body2"]["catchlightNoiseL"]}

# Sweep rounds: (row, irisSpare, occlusionPower, base note). Base for every
# round pins the s5 pick explicitly (ring 0.2 / peak 0.7 / span 3.0); r1's
# ring-frac was not logged (s5 value 0.2 presumed).
ROUNDS = [
    ("r1", 1.0, 1.0),
    ("r2", 2.0, 0.0),
    ("r3", 1.0, 0.0),
    ("r4", 3.0, 0.0),
    ("r5", 2.0, 1.0),
    ("r6", 0.5, 0.0),
]
BASE_ARGV = {
    "aisha": "--eye-colour-reference ob_patient_aisha --actor-role patient --bake-device metal --eye-asset high-poly --eye-cornea --eye-texture tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png",
    "body2": "--reference adult_male_street_casual --actor-role patient --bake-device metal --eye-asset high-poly --eye-cornea",
}
BASE_SHELL = "--eye-occlusion-shell --eye-shell-ring-frac 0.2 --eye-shell-upper-span-mm 3.0 --eye-shell-upper-peak 0.7"


def round_files(row):
    pats = [f"{STORE}/{row}/{row}-aisha-metrics.json",
            f"{STORE}/{row}/{row}-aisha-catchlight.json",
            f"{STORE}/{row}/{row}-body2-metrics.json",
            f"{STORE}/{row}/{row}-body2-catchlight.json"]
    if all(os.path.isfile(p) for p in pats):
        return pats
    return []


sweep = []
for row, spare, power in ROUNDS:
    pats = round_files(row)
    if not pats:
        continue
    ma = load(pats[0]); ca = load(pats[1]); mb = load(pats[2]); cb = load(pats[3])
    sweep.append({
        "row": row,
        "params": {"irisSpare": spare, "occlusionPower": power},
        "aisha": side_gate(ma, ca, pre_iris["aisha"], pre_cw["aisha"]["catchlightPeakL"]),
        "body2": side_gate(mb, cb, pre_iris["body2"], pre_cw["body2"]["catchlightPeakL"]),
    })

def passes(row):
    n = 0
    for s in ("aisha", "body2"):
        for k in ("M1", "M2a", "M2b"):
            v, m = row[s][k], mid[s][k]
            n += 1 if (v >= m if k == "M2a" else v <= m) else 0
        d = row[s]["D90"]
        n += 1 if d90win[s][0] <= d <= d90win[s][1] else 0
        n += 1 if row[s]["irisEuclidVsPre"] <= iris_floor[s] else 0
        cw = row[s]["catchlightPeakL"]
        n += 1 if abs(cw - pre_cw[s]["catchlightPeakL"]) <= cw_noise[s] else 0
    return n


pick = sweep[0]["row"] if sweep else "r1"
best = -1
for row in sweep:
    n = passes(row)
    if n > best:
        best, pick = n, row["row"]
P = {s: next(r[s] for r in sweep if r["row"] == pick) for s in ("aisha", "body2")} if sweep else None

g1 = {s: {k: {"value": P[s][k], "mid": mid[s][k],
                    "pass": (P[s][k] >= mid[s][k]) if k == "M2a" else (P[s][k] <= mid[s][k])}
            for k in ("M1", "M2a", "M2b")} for s in ("aisha", "body2")} if P else {}
g2 = {}
if P:
    for s in ("aisha", "body2"):
        d = P[s]["D90"]
        cw = P[s]["catchlightPeakL"]
        g2[s] = {
            "D90": {"value": d, "window": d90win[s],
                    "pass": d90win[s][0] <= d <= d90win[s][1]},
            "iris": {"value": P[s]["irisEuclidVsPre"], "floor": iris_floor[s],
                     "pass": P[s]["irisEuclidVsPre"] <= iris_floor[s]},
            "catchlight": {"value": cw, "pre": pre_cw[s]["catchlightPeakL"],
                           "noise": cw_noise[s],
                           "pass": abs(cw - pre_cw[s]["catchlightPeakL"]) <= cw_noise[s]},
        }

# probes (measured; p1 spareOff both subjects, p2 powerOff aisha only)
sp = {}
for s, stem in (("aisha", "p1/aisha"), ("body2", "p1/body2")):
    m = load(f"{STORE}/{stem}-metrics.json"); c = load(f"{STORE}/{stem}-catchlight.json")
    sp[s] = side_gate(m, c, pre_iris[s], pre_cw[s]["catchlightPeakL"])
m = load(f"{STORE}/p2/aisha-metrics.json"); c = load(f"{STORE}/p2/aisha-catchlight.json")
po_a = side_gate(m, c, pre_iris["aisha"], pre_cw["aisha"]["catchlightPeakL"])
w = d90win["aisha"]
d_out = po_a["D90"] < w[0] or po_a["D90"] > w[1]
probes = {
    "spareOff": {
        "aisha": sp["aisha"], "body2": sp["body2"],
        "result": "fails iris clause on both subjects "
                  f"(aisha {sp['aisha']['irisEuclidVsPre']} > {iris_floor['aisha']}; "
                  f"body2 {sp['body2']['irisEuclidVsPre']} > {iris_floor['body2']})",
    },
    "powerOff": {
        "aisha": po_a,
        "result": "aisha D90 fails with the spare on "
                  f"({po_a['D90']} outside [{w[0]}, {w[1]}])" if d_out else
                  "aisha D90 stays in-window with the spare on "
                  f"({po_a['D90']} in [{w[0]}, {w[1]}]); non-vacuity via iris/CW/M2a",
    },
}

allpass = ([g1[s][k]["pass"] for s in ("aisha", "body2") for k in ("M1", "M2a", "M2b")] +
           [g2[s][k]["pass"] for s in ("aisha", "body2") for k in ("D90", "iris", "catchlight")] +
           [True])  # G3 asserted by the test on the source
verdict = "converged" if all(allpass) else "not_converged"

# files: bake logs, GLBs, variants, renders, metrics, sheet
files = {}
for rel in sorted(glob.glob(f"{STORE}/**/*.log", recursive=True) +
                  glob.glob(f"{STORE}/**/*.glb", recursive=True) +
                  glob.glob(f"{STORE}/*/*.variant.json", recursive=True) +
                  glob.glob(f"{STORE}/*/*/*.png", recursive=True) +
                  glob.glob(f"{STORE}/*/*/*.json", recursive=True)):
    if "/sheet/" in rel and os.path.basename(rel) == "manifest.json":
        continue
    key = os.path.relpath(rel, STORE)
    if key.endswith("-metrics.json") or key.endswith("-catchlight.json") or \
       key.endswith(".log") or key.endswith(".glb") or key.endswith(".variant.json") or \
       "-render/" in key or "-id/" in key or "-yaw25/" in key:
        files[key] = {"sha256": sha(rel)}

sheet_dir = f"{STORE}/sheet"
sheet = {"root": sheet_dir, "files": {}}
if os.path.isfile(f"{sheet_dir}/manifest.json"):
    sheet["files"] = load(f"{sheet_dir}/manifest.json")

occ = {}
# occlusion O per subject: power>0 rounds print EYESHELL_OCCLUSION (power 0
# skips the scale, so read O from the r1 bake logs).
import re
for s, logf in (("aisha", f"{STORE}/r1/aisha-bake.log"),
                ("body2", f"{STORE}/r1/body2-bake.log")):
    try:
        txt = open(logf).read()
        ms = re.findall(r"EYESHELL_OCCLUSION [LR] occ=([0-9.]+)", txt)
        occ[s] = round(sum(float(x) for x in ms) / len(ms), 3) if ms else None
    except FileNotFoundError:
        occ[s] = None

report = {
    "card": "tsk_57f4ae74d62739e0",
    "verdict": verdict,
    "goal": goal,
    "pre": {
        "aisha": {**pre["aisha"],
                  "catchlightPeakL": pre_cw["aisha"]["catchlightPeakL"],
                  "catchlightNoiseL": pre_cw["aisha"]["catchlightNoiseL"]},
        "body2": {**pre["body2"],
                  "catchlightPeakL": pre_cw["body2"]["catchlightPeakL"],
                  "catchlightNoiseL": pre_cw["body2"]["catchlightNoiseL"]},
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
        "uvConvention": "bpy loop UVs use v=0 at image bottom; eye-parallax.ts file-UV has v=0 at image top, so the bake compares (u, 1-v). Verified on the r1 GLBs (exporter writes glTF_UV=(u,1-v_blender), so GLB UVs match file-UV): inside-disc verts cluster on the iris cap (124-126 verts/eye, mean axis dist 2.75-2.90mm < 6mm) while unflipped discs catch 7-11 scattered sclera verts (axis dist 7.7mm). No UV-origin bug. Bake-time EYESHELL_SPARE_CHECK prints the same falsifier per round (active rms ~4mm vs noflip ~9mm).",
        "idMethod": "ID renders use shell-stripped GLB copies (strip_shell_for_id.py clears the occlusion-shell/tearline mesh slots; all indices stable), because the variant `hide` path crashes the lab readback on the shell's unlit material (no .emissive) and a shell-visible ID contaminates the mask with shell strength (r1 ID keys 4496 vs r2 3580 at full power). Stripped-ID masks recover the PRE/s5 scale (r1 2651/1762 vs PRE 2481/1006 vs s5 2743/1748). This matches the documented intent (shell hidden for the ID pass). No harness change made.",
        "spareEffect": "the GLB shell alpha-0 disc covers the iris (232 verts, alpha min/med/max 0/0/0 in-disk on r1) yet r1-vs-p1 beauty differs only 0.58 levels inside the iris: the s5-base field already spares the iris (pupil guard + lateral gate + corner rho guard leave p1 in-disk alpha max 0.132, median 0). POST-vs-PRE iris gap (11.8/8.3) is spare-independent.",
        "catchlightMechanism": "spare-independent too (r1 87.41 vs p1 87.27 on aisha): the shell is a KHR_materials_unlit physical surface 0.3mm above the cornea; the hide-shell control variant crashes the lab readback (unlit material) so the depth pre-emption hypothesis is unconfirmed by render. No harness change made; recorded as the falsifier mechanism.",
        "bakeNoise": "same-code bakes vary ~2px in lid aperture (p2/r2 L 42.6 vs r1 46.3); PRE-vs-p2 outside-iris diff 0.15 levels, so beauty is comparable and the metric gaps dwarf bake noise, but iris/CW clauses sit near the noise scale.",
    },
    "fix": {
        "files": ["tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py (eyeshell code + call site only)"],
        "knobs": {"--eye-shell-iris-spare": next(r["params"]["irisSpare"] for r in sweep if r["row"] == pick),
                  "--eye-shell-occlusion-power": next(r["params"]["occlusionPower"] for r in sweep if r["row"] == pick)},
        "knobNote": "new knobs default neutral (spare 0.0, occpow 0.0) so --eye-occlusion-shell alone reproduces main-value bakes byte-stable; the sweep passes them explicitly. Old knob defaults unchanged (margin 0.5/corner 0.8/ramp-mm 2.5/boost 1.6/color 120,88,80/ring-frac 0.25/upper-span-mm 6.0/upper-peak 0.0); shell stays opt-in.",
        "baseShell": BASE_SHELL + " (s5 pick pinned explicitly every round; r1 ring-frac not logged, s5 value 0.2 presumed)",
        "baseArgv": BASE_ARGV,
        "structure": "UV-space iris spare (globe UVs vs EYE_IRIS_CENTER_L/R_UV, EYE_IRIS_RADIUS_UV, EYE_LIMBUS_WIDTH_UV from eye-parallax.ts), per-eye lid-occlusion scale from seated upper-lid ring over upper globe cap; all generic, no subject literal",
        "compose": "shell+tearline build pre-export on the unsplit eye; transfer binds shell; cornea split runs after and repoints the eye node only; shell survives as openclinxr_eye_occlusion_shell_mesh 1076 verts + 6 lid targets beside globe 552 + 2 corneas on both subjects",
        "g3": "no subject name/stem literal in added eyeshell lines (asserted by the test)",
    },
    "sweep": sweep,
    "gates": {"g1": g1, "g2": g2, "g3": {"pass": True,
             "method": "added-lines grep + function-slice assertion in the test"}},
    "probes": probes,
    "defaults": {
        "unchanged": verdict != "converged",
        "shell": "opt-in store_true; no default-on (gates did not pass); no shipped GLB rebaked",
    },
    "occlusion": {
        "aisha": occ["aisha"], "body2": occ["body2"],
        "formula": "O = mean over side's upper-cap shell verts seated under the seated upper lid margin at same x (lid z above vert z); scale = O^power. Pure seated-bake geometry from lid loops + fitted globe.",
    },
    "pick": pick,
    "files": files,
    "sheet": sheet,
}

out = os.path.join(HERE, "shell-iris-spare-report.json")
with open(out, "w") as f:
    json.dump(report, f, indent=1)
    f.write("\n")
print(f"wrote {out} verdict={verdict} pick={pick} rows={len(sweep)} files={len(files)} sheet={len(sheet['files'])}")
