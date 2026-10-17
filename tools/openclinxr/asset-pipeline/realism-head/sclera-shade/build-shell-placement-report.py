"""Build shell-placement-report.json from measured store JSONs (CARD tsk_6a46705a72eb008b)."""
import json, hashlib, os

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.environ.get(
    "OPENCLINXR_ASSET_STORE",
    "/Volumes/files/openclinxr-assets/store",
) + "/shell-placement"
R = HERE
OLD = json.load(open(os.path.join(R, "sclera-shade-report.json")))

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

goal = {s: m4(OLD["goal"][s]) for s in ("aisha", "body2")}
pre_report = {s: m4(OLD["pre"][s]) for s in ("aisha", "body2")}
pre = {"aisha": m4(load(f"{STORE}/pre/pre-aisha.json")),
       "body2": m4(load(f"{STORE}/pre/pre-body2.json"))}
mid = {s: {k: round((pre[s][k] + goal[s][k]) / 2, 3) for k in ("M1", "M2a", "M2b")} for s in ("aisha", "body2")}
d90win = {s: [round(goal[s]["D90"] - abs(pre[s]["D90"] - goal[s]["D90"]) / 2, 3),
              round(goal[s]["D90"] + abs(pre[s]["D90"] - goal[s]["D90"]) / 2, 3)] for s in ("aisha", "body2")}
noise = load(f"{STORE}/pre/noise.json")

rounds = [
    ("s1", {"ring_frac": 0.25, "upper_peak": 0.5, "upper_span_mm": 2.0},
     "lid-relative symmetric ring + pupil-guarded upper band; first s1 bake raced a file edit (field bit-identical to diag) and was discarded, true s1 rebaked after the file stabilized"),
    ("s2", {"ring_frac": 0.12, "upper_peak": 0.7, "upper_span_mm": 3.0},
     "narrower ring, stronger/wider band; renders still identical to diag (ring 0.12*oh ~= old ramp; band saturates inside the boost cap)"),
    ("s3", {"ring_frac": 0.2, "upper_peak": 0.7, "upper_span_mm": 3.0},
     "STRUCTURE: asymmetric rings (upper full margin, lower fixed 0.15*margin); first moving round"),
    ("s4", {"ring_frac": 0.2, "upper_peak": 0.7, "upper_span_mm": 3.0},
     "STRUCTURE: + limbus-sparing lateral gate on the upper ring (smoothstep 0.25r..0.55r of |x-cx|)"),
    ("s5", {"ring_frac": 0.2, "upper_peak": 0.7, "upper_span_mm": 3.0},
     "STRUCTURE: + wide lid-relative corner (0.3*eye-width ramp), lower base 0.15 (was 0.3); best round"),
    ("s6", {"ring_frac": 0.2, "upper_peak": 0.7, "upper_span_mm": 3.0},
     "STRUCTURE: + upper-weighted corner (0.35 floor below centre); M2a regressed vs s5"),
]
sweep = []
for row, params, structure in rounds:
    a = load(f"{STORE}/{row}/{row}-aisha.json")
    b = load(f"{STORE}/{row}/{row}-body2.json")
    pa = load(f"{STORE}/pre/pre-aisha.json")
    pb = load(f"{STORE}/pre/pre-body2.json")
    import math
    def extra(j, p):
        di = [j["irisMeanRGB"][k] - p["irisMeanRGB"][k] for k in ("R", "G", "B")]
        return {"irisMeanRGB": {k: j["irisMeanRGB"][k] for k in ("R", "G", "B")},
                "irisEuclidVsPre": round(math.sqrt(sum(x * x for x in di)), 3),
                "skinMedianL": j["skinMedianL"],
                "skinDeltaVsPre": round(j["skinMedianL"] - p["skinMedianL"], 3),
                "scleraP90L": j["scleraP90L"], "nSclera": j["nSclera"]}
    sweep.append({"row": row, "params": params, "structure": structure,
                  "aisha": {**m4(a), **extra(a, pa)},
                  "body2": {**m4(b), **extra(b, pb)}})

def g1eval():
    s5 = [r for r in sweep if r["row"] == "s5"][0]
    out = {}
    for s in ("aisha", "body2"):
        out[s] = {k: {"value": s5[s][k], "mid": mid[s][k],
                      "pass": (s5[s][k] <= mid[s][k]) if k in ("M1", "M2b") else (s5[s][k] >= mid[s][k])}
                  for k in ("M1", "M2a", "M2b")}
    return out

def g2eval():
    s5 = [r for r in sweep if r["row"] == "s5"][0]
    pa = load(f"{STORE}/pre/pre-aisha.json")
    pb = load(f"{STORE}/pre/pre-body2.json")
    out = {}
    for s, p in (("aisha", pa), ("body2", pb)):
        v = s5[s]
        d = v["D90"]
        out[s] = {"D90": {"value": d, "window": d90win[s], "pass": d90win[s][0] <= d <= d90win[s][1]},
                  "irisEuclidVsPre": v["irisEuclidVsPre"],
                  "irisFloor": {"aisha": 6.896, "body2": 5.159}[s],
                  "skinDeltaVsPre": v["skinDeltaVsPre"]}
    return out

diag_a = load(f"{STORE}/diag/diag-aisha.json")
diag_b = load(f"{STORE}/diag/diag-body2.json")
uni_a = load(f"{STORE}/pre/uniform15-aisha.json")
uni_b = load(f"{STORE}/pre/uniform15-body2.json")
zero_a = load(f"{STORE}/zero/zero-aisha.json")

sheet_files = sorted(os.listdir(f"{STORE}/sheet"))
sheet = {f: sha(f"{STORE}/sheet/{f}") for f in sheet_files}

entry_files = {
    "diag/aisha-overlay.png": "shell alpha (false-colour) + sclera ID mask overlay, aisha front eye band 580px",
    "diag/body2-overlay.png": "shell alpha + sclera ID mask overlay, body2 front eye band 593px",
    "diag/aisha-shadow.png": "shell shadow-field differential (beauty vs PRE-as-noshell), aisha",
    "diag/body2-shadow.png": "shell shadow-field differential, body2",
    "diag/diag-aisha.json": "main-default shell bake metrics, aisha",
    "diag/diag-body2.json": "main-default shell bake metrics, body2",
    "pre/pre-aisha.json": "re-measured PRE (this worktree bake), aisha",
    "pre/pre-body2.json": "re-measured PRE (this worktree bake), body2",
    "pre/noise.json": "1px erode/dilate mask noise floors",
    "pre/uniform15-aisha.json": "uniform-15% probe metrics, aisha",
    "pre/uniform15-body2.json": "uniform-15% probe metrics, body2",
    "zero/zero-aisha.json": "alpha-zero shell probe (= PRE bit ditto metrics), aisha",
}
for r in ("s1", "s2", "s3", "s4", "s5", "s6"):
    entry_files[f"{r}/{r}-aisha.json"] = f"sweep {r} metrics, aisha"
    entry_files[f"{r}/{r}-body2.json"] = f"sweep {r} metrics, body2"
for f in sheet_files:
    entry_files[f"sheet/{f}"] = "sheet band/overlay"

report = {
    "card": "tsk_6a46705a72eb008b",
    "verdict": "not_converged",
    "goal": {s: {**goal[s], "nSclera": OLD["goal"][s]["nSclera"]} for s in ("aisha", "body2")},
    "pre": {"report": pre_report, "remeasured": pre,
            "note": "re-measured on this worktree's PRE bakes (body POSITION bit-identical to the pinned conform GLBs); aisha reproduces the report exactly, body2 within 0.14",
            "bakeArgv": {
                "aisha": "--eye-colour-reference ob_patient_aisha --actor-role patient --bake-device metal --eye-asset high-poly --eye-cornea --eye-texture tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png",
                "body2": "--reference adult_male_street_casual --actor-role patient --bake-device metal --eye-asset high-poly --eye-cornea"}},
    "midpoints": mid,
    "d90Windows": d90win,
    "noise": {"mask": {s: noise[s]["noise"] for s in ("aisha", "body2")},
              "irisEuclidFloor": {"aisha": 6.896, "body2": 5.159},
              "irisMethod": "1px dilation and erosion of the iris circle radius on PRE; larger euclid RGB shift",
              "enforcement": "every |PRE-goal|/2 exceeds its mask floor, so every G1/G2-D90 clause is enforced; iris clause enforced against the iris floor; skin judged against the M1 mask floor",
              "halves": {"aisha": {"/2": {k: round(abs(pre["aisha"][k] - goal["aisha"][k]) / 2, 3) for k in ("M1", "M2a", "M2b", "D90")}},
                         "body2": {"/2": {k: round(abs(pre["body2"][k] - goal["body2"][k]) / 2, 3) for k in ("M1", "M2a", "M2b", "D90")}}}},
    "diagnosis": {
        "overlay": "diag/aisha-overlay.png + diag/body2-overlay.png (shell-only veil as intensity vs ID sclera mask, native eye bands 580/593px)",
        "veil": "shell veil present over the whole visible band on both (aisha uc 98/lc 99/ul 120/ll 110 vs surround 196; body2 ~71-73 all quads vs surround 110)",
        "shadow": {"aisha": {"all": -43.18, "uc": -47.24, "lc": -44.46, "ul": -38.89, "ll": -38.6, "iris": 0.0},
                   "body2": {"all": -36.53, "uc": -38.35, "lc": -36.27, "ul": -36.66, "ll": -33.7, "iris": 0.0}},
        "diagMetrics": {"aisha": m4(diag_a), "body2": m4(diag_b)},
        "conclusion": "main-code shell floods the seated band uniformly: the whole visible strip sits inside the absolute 2.5mm margin ramp, so the field has almost no vertical gradient (body2 M2b +0.37 under a -36.5 uniform shadow) while the 0.5 margin over-darkens aisha (M1 -45.5 vs goal -14.0). The old report's canthi-only body2 behaviour came from the reverted pocket/gate code, not main. Alpha-zero shell reproduces PRE exactly (zero/zero-aisha.json), so the field is the lever and it saturates via the boost cap/corner.",
        "donorWindow": "fixed y 1.50..1.60 misses body2 lids (~1.65, globe centre z 1.653 vs aisha 1.546); replaced by shell-span-derived band (body2 ylo 1.6312/yhi 1.6754, aisha 1.5237/1.5686)"},
    "fix": {
        "files": ["tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py (eyeshell code + call site only)"],
        "knobs": {"--eye-shell-ring-frac": 0.25, "--eye-shell-upper-span-mm": 6.0, "--eye-shell-upper-peak": 0.0},
        "knobNote": "peak 0.0 keeps the band off at defaults; old knob defaults unchanged (margin 0.5/corner 0.8/ramp-mm 2.5/boost 1.6/color 120,88,80); shell stays opt-in",
        "structure": "asymmetric lid-relative rings (upper full margin, lower fixed 0.15*margin), limbus-sparing lateral gate (0.25r..0.55r), wide lid-relative corner (0.3*eye-width ramp, upper-weighted 0.35 floor), pupil-guarded upper band (0.5r limbus); all fixed fractions generic, no subject literal",
        "compose": "shell+tearline build pre-export on the unsplit eye; transfer binds shell; cornea split runs after and repoints the eye node only; shell survives as openclinxr_eye_occlusion_shell_mesh 1076 verts + 6 lid targets beside globe 552 + 2 corneas on both subjects",
        "g3": "no subject name/stem literal in added eyeshell lines (asserted by the test)"},
    "sweep": sweep,
    "gates": {"g1": g1eval(), "g2": g2eval(),
              "g3": {"pass": True, "method": "added-lines grep + function-slice assertion in the test"}},
    "probes": {
        "shellOff": {"M2b": {"aisha": pre["aisha"]["M2b"], "body2": pre["body2"]["M2b"]},
                     "result": "fails G1 on both (midpoints -3.30/-5.64)"},
        "uniform15": {"aisha": m4(uni_a), "body2": m4(uni_b),
                      "result": "fails G1 on both (M2a/M2b short of midpoint); fails G2-D90 on body2 (+7.45 vs window top +6.94); aisha D90 (-9.56) lands inside, so the probe pair shows the clauses are non-vacuous per subject, not per clause"}},
    "defaults": {"unchanged": True, "shell": "opt-in store_true; no default-on (gates did not pass); no shipped GLB rebaked"},
    "sheet": {"root": "/Volumes/files/openclinxr-assets/store/shell-placement/sheet",
              "note": "front + yaw25 eye bands PRE vs POST (s5), native >=420px, plus goal bands and step-1 overlays/shadow diffs",
              "files": sheet},
    "files": {p: {"sha256": sha(f"{STORE}/{p}"), "note": n} for p, n in entry_files.items()},
}
out = os.path.join(R, "shell-placement-report.json")
with open(out, "w") as f:
    json.dump(report, f, indent=1)
print("WROTE", out, len(json.dumps(report)), "bytes")
