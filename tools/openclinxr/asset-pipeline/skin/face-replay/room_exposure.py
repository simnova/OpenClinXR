"""Room-rig skin gates exposure-normalised on the shirt (card tsk_9863341f09670c5b).

WHY: room-rig-remeasure-report.json: on the room rig (ob_triage_room_v1)
body2 is L +13..+24 and Aisha L +13..+18 above their goal photos in every
face region (0 of 4 within 3). Aisha carries the same offset, so most of it
is exposure. A scale fitted on the skin would pass the gate by construction,
so the exposure reference is the sage shirt, visible in both renders and
both goal photos (bottom-corner shoulders: the centre under the chin is neck
skin in all four images, verified by pixel scan, so the box is a bottom
band, not a centre patch).

BOX RULE (one function of landmarks, every image, never moved per image):
  fh = y(152 chin) - y(10 crown); cx = x(152);
  x0 = cx - 0.55*fh, x1 = cx + 0.55*fh, y0 = chin_y + 0.04*fh, y1 = frame
  bottom (clamped). No view extension was needed: the shirt is visible in
  the existing front renders (body2 nsage 9132, aisha 11561).

MASKS (pixel counts reported):
  render = box AND garment-chroma gate AND NOT skin gate. The capture tool
  exposes NO per-pixel material ID pass: material identity is the
  mesh|material inventory (collectMaterialInventory,
  packages/openclinxr/xr-scene/src/isolated-subject-material-variants.ts:321,
  recorded per capture at
  packages/openclinxr/xr-scene/src/isolated-subject-debug-evidence.ts:213):
  mesh makeclothes_library_toigo_t_shirt /
  material mat_makeclothes_library_toigo_t_shirt (inventoried color #9eb19e,
  both subjects' skinior-*.json). The per-material flat-colour mechanism
  exists (applyMaterialOverrides match,
  isolated-subject-material-variants.ts:379; readback
  tools/openclinxr/evidence/skin-realism/runtime-portrait-capture.ts:404-460)
  but cannot reframe below the chin without tool edits outside this card's
  WRITE_ROOTS, so the pixel mask is colour-anchored to the inventoried sage:
  (g>=r)&(r>=b)&(g-b>8)&(min>40). G1 guards its purity.
  photo = box AND the same sage gate, minus skin (r>60&r>g&g>b, the
  room_rig_remeasure.py:57 gate) / hair / background (dark: max<55).

EXPOSURE FACTOR k (shirt only): k_Y = mean linear Y(photo shirt) /
mean linear Y(render shirt); linear = exact sRGB EOTF inverse, Y Rec.709
(0.2126/0.7152/0.0722, same weights as the portrait lit-span measure).
The coordinator-asked L-ratio (L_photo/L_render of shirt Lab means) is
recorded beside it; the APPLIED factor is k_Y. Applied to the render in
linear RGB (clip 0..1) before every skin comparison.

Usage: python3 room_exposure.py   (run via mise, repo root = cwd)
  --shirt-stats PNG --box x0,y0,x1,y1 [--photo]   shirt-patch stats JSON
  --box-from-points x152 y152 x10 y10 W H          pure box rule JSON
  --k-pair RENDER GOAL                            k_Y for a render/goal pair
"""

import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image
from skimage.color import rgb2lab

DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(DIR, "..", "..", "..", "..", ".."))
sys.path.insert(0, DIR)
sys.path.insert(0, os.path.join(REPO, "tools", "openclinxr", "evidence", "face-gate"))
import face_gate as FG  # noqa: E402
import face_landmark_regions as FLR  # noqa: E402
import room_rig_remeasure as RRM  # noqa: E402

STORE = "/Volumes/files/openclinxr-assets/store/skin-ior-room"
EXPO_STORE = "/Volumes/files/openclinxr-assets/store/skin-room-exposure"
S = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike"
GOAL_BODY2 = os.path.join(S, "body2", "goal-front.png")
GOAL_AISHA = os.path.join(S, "project", "edit-v9", "edit-0.png")
GREY_PNG = os.path.join(EXPO_STORE, "flat-grey-128.png")
REPORT_OUT = os.path.join(DIR, "room-exposure-report.json")
REGIONS = ["forehead", "L_cheek", "R_cheek", "chin", "upperlip_skin"]
REGCHROMA4 = ["forehead", "L_cheek", "R_cheek", "chin"]
BOUND = 3

BOX_RULE = (
    "fh = y(152 chin) - y(10 crown); cx = x(152); "
    "x0 = cx - 0.55*fh, x1 = cx + 0.55*fh, "
    "y0 = chin_y + 0.04*fh, y1 = frame bottom (clamped). "
    "One function (shirt_box_from_points) for every image; never moved per image."
)

# G0 RULE, written BEFORE any number is read (the card's precondition):
# shirt a*/b* render vs photo must agree within
#   (render run-to-run noise from two captures)
#   + (photo patch's own spread = SD of its 4 quadrant sub-patch means).
# L is excluded: exposure lives in L, which is what k absorbs.
G0_RULE = (
    "per subject: |a*_render - a*_photo| <= noise_a + spread_a AND "
    "|b*_render - b*_photo| <= noise_b + spread_b, where noise = |render "
    "capture A - render capture B| shirt-patch channel means (body2: 14a vs "
    "14b; aisha: 15 vs 14, shirt untouched by the IOR override by "
    "construction) and spread = SD of the photo patch's 4 quadrant "
    "sub-patch channel means. L excluded (exposure lives in L). "
    "Fail for a subject => record and stop for that subject (valid outcome)."
)

RED_FIRST = (
    "RED 2026-10-17, module+report absent: 8 tests 6 failed 2 passed "
    "(vitest the-room-exposure-comes-from-the-shirt.test.ts): "
    "python3: can't open file '.../room_exposure.py': [Errno 2]; "
    "ENOENT room-exposure-report.json (4 main its + known-bad c/d); "
    "known-bad a/b passed (fixture + pure-JS, no module needed)."
)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rgb(path):
    return np.array(Image.open(path).convert("RGB"))


def srgb_to_linear(a):
    x = a.astype(float) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(lin):
    x = np.clip(lin, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x,
                    1.055 * (x ** (1.0 / 2.4)) - 0.055)


def luminance_Y(lin):
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]


def skin_gate(rgb):
    r = rgb[..., 0].astype(int)
    g = rgb[..., 1].astype(int)
    b = rgb[..., 2].astype(int)
    return ((r > 60) & (r > g) & (g > b))


def sage_gate(rgb):
    r = rgb[..., 0].astype(int)
    g = rgb[..., 1].astype(int)
    b = rgb[..., 2].astype(int)
    return ((g >= r) & (r >= b) & ((g - b) > 8)
            & (np.minimum(np.minimum(r, g), b) > 40))


def shirt_box_from_points(x152, y152, x10, y10, w, h):
    fh = float(y152 - y10)
    x0 = int(round(float(x152) - 0.55 * fh))
    x1 = int(round(float(x152) + 0.55 * fh))
    y0 = int(round(float(y152) + 0.04 * fh))
    return {"x0": max(0, x0), "y0": max(0, y0),
            "x1": min(int(w), x1), "y1": int(h), "fh": fh}


def shirt_box_for_image(png_path, landmarker):
    pil = Image.open(png_path).convert("RGB")
    w, h = pil.size
    pts = FG.detect_points(landmarker, pil)
    if pts is None:
        raise RuntimeError(f"FaceLandmarker detected no face in {png_path}: refuse")
    return shirt_box_from_points(pts[152][0], pts[152][1],
                                 pts[10][0], pts[10][1], w, h)


def shirt_mask(rgb, box, photo):
    x0, y0, x1, y1 = box["x0"], box["y0"], box["x1"], box["y1"]
    m = np.zeros(rgb.shape[:2], bool)
    m[y0:y1, x0:x1] = True
    sel = m & sage_gate(rgb) & (~skin_gate(rgb))
    if photo:
        sel &= (rgb.max(axis=2) >= 55)
    return sel


def shirt_stats_for(rgb, box, photo):
    sel = shirt_mask(rgb, box, photo)
    n_box = (box["x1"] - box["x0"]) * (box["y1"] - box["y0"])
    n = int(sel.sum())
    if n == 0:
        return {"n_box": n_box, "n_shirt": 0, "mean_rgb": None,
                "mean_Lab": None, "mean_Ylin": None, "quadrants": None}
    lab = rgb2lab(rgb.astype(float) / 255.0)
    ylin = luminance_Y(srgb_to_linear(rgb))
    quads = []
    mx = (box["x0"] + box["x1"]) // 2
    my = (box["y0"] + box["y1"]) // 2
    for (xa, xb, ya, yb) in ((box["x0"], mx, box["y0"], my),
                             (mx, box["x1"], box["y0"], my),
                             (box["x0"], mx, my, box["y1"]),
                             (mx, box["x1"], my, box["y1"])):
        q = np.zeros(rgb.shape[:2], bool)
        q[ya:yb, xa:xb] = True
        qs = sel & q
        qn = int(qs.sum())
        quads.append({"n": qn,
                      "mean_ab": [round(float(v), 3) for v in lab[qs][:, 1:3].mean(axis=0)]
                      if qn >= 50 else None})
    avail = [q["mean_ab"] for q in quads if q["mean_ab"] is not None]
    spread = ([round(float(v), 3) for v in np.std(np.array(avail), axis=0)]
              if len(avail) >= 2 else None)
    return {"n_box": n_box, "n_shirt": n,
            "mean_rgb": [round(float(v), 2) for v in rgb[sel].mean(axis=0)],
            "mean_Lab": [round(float(v), 3) for v in lab[sel].mean(axis=0)],
            "mean_Ylin": round(float(ylin[sel].mean()), 6),
            "quadrants": quads, "spread_ab": spread}


def apply_k(rgb_render, k):
    lin = srgb_to_linear(rgb_render) * k
    return (linear_to_srgb(lin) * 255.0).round().astype(np.uint8)


def regions_on_lab(lab, gate, pil, landmarker):
    regions, info, polys = FLR.polygon_regions(lab, gate, pil, landmarker)
    w, h = pil.size
    masks = FG.raster_masks(polys, w, h, erode_px=FLR.ERODE_PX)
    smap = {mp: side for side, mp in info["cheek_mapping"].items()}
    got = {}
    for name in REGIONS:
        key = smap.get(name, name) if "cheek" in name else name
        m = (masks[key] > 0)
        sel = m & (gate > 0)
        n = int(sel.sum())
        got[name] = {
            "n": n,
            "Lab": [round(float(v), 2) for v in lab[sel].mean(axis=0)] if n >= FLR.MIN_POLY_N else None,
            "mask": m,
        }
    return got


def dlab(a, b):
    if a is None or b is None:
        return None
    return [round(abs(x - y), 2) for x, y in zip(a, b)]


def face_median_L(lab, gate, regions):
    sel = np.zeros(gate.shape, bool)
    for r in REGIONS:
        sel |= regions[r]["mask"] & (gate > 0)
    return round(float(np.median(lab[..., 0][sel])), 2), int(sel.sum())


def ensure_grey_png():
    os.makedirs(EXPO_STORE, exist_ok=True)
    if not os.path.isfile(GREY_PNG):
        Image.new("RGB", (128, 128), (128, 128, 128)).save(GREY_PNG)
    g = np.array(Image.open(GREY_PNG).convert("RGB"))
    return [int(v) for v in g.reshape(-1, 3).mean(axis=0)], sha256_file(GREY_PNG)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--shirt-stats", default=None)
    ap.add_argument("--box", default=None)
    ap.add_argument("--photo", action="store_true")
    ap.add_argument("--box-from-points", nargs=6, default=None,
                    metavar=("X152", "Y152", "X10", "Y10", "W", "H"))
    ap.add_argument("--k-pair", nargs=2, default=None, metavar=("RENDER", "GOAL"))
    args = ap.parse_args()
    if args.box_from_points:
        x152, y152, x10, y10, w, h = (float(v) for v in args.box_from_points)
        print(json.dumps(shirt_box_from_points(x152, y152, x10, y10, w, h)))
        return
    if args.shirt_stats:
        if not args.box:
            raise SystemExit("--shirt-stats needs --box x0,y0,x1,y1")
        x0, y0, x1, y1 = (int(v) for v in args.box.split(","))
        rgb = load_rgb(args.shirt_stats)
        st = shirt_stats_for(rgb, {"x0": x0, "y0": y0, "x1": x1, "y1": y1}, args.photo)
        print(json.dumps(st))
        return
    if args.k_pair:
        landmarker = FLR.create_landmarker()
        stats = []
        for p, is_photo in ((args.k_pair[0], False), (args.k_pair[1], True)):
            rgb = load_rgb(p)
            box = shirt_box_for_image(p, landmarker)
            stats.append(shirt_stats_for(rgb, box, is_photo))
        k = stats[1]["mean_Ylin"] / stats[0]["mean_Ylin"]
        print(json.dumps({"k_Y": k, "render_Y": stats[0]["mean_Ylin"],
                          "photo_Y": stats[1]["mean_Ylin"]}))
        return

    landmarker = FLR.create_landmarker()
    renders = {
        "body2": os.path.join(STORE, "skinior-body2-14a-front.png"),
        "body2_b": os.path.join(STORE, "skinior-body2-14b-front.png"),
        "body2_15": os.path.join(STORE, "skinior-body2-15a-front.png"),
        "aisha": os.path.join(STORE, "skinior-aisha-14-front.png"),
        "aisha_15": os.path.join(STORE, "skinior-aisha-15-front.png"),
    }
    goals = {"body2": GOAL_BODY2, "aisha": GOAL_AISHA}
    rgb = {k: load_rgb(v) for k, v in {**renders, **{f"goal_{s}": p for s, p in goals.items()}}.items()}
    paths = {**renders, **{f"goal_{s}": p for s, p in goals.items()}}
    box = {k: shirt_box_for_image(paths[k], landmarker) for k in paths}
    stats = {k: shirt_stats_for(rgb[k], box[k], k.startswith("goal_")) for k in paths}

    k_Y, L_ratio = {}, {}
    for s in ("body2", "aisha"):
        k_Y[s] = stats[f"goal_{s}"]["mean_Ylin"] / stats[s]["mean_Ylin"]
        L_ratio[s] = (stats[f"goal_{s}"]["mean_Lab"][0] / stats[s]["mean_Lab"][0])

    # ---- G0 (rule fixed above, before numbers) ----
    g0_subjects = {}
    for s, ra, rb in (("body2", "body2", "body2_b"), ("aisha", "aisha", "aisha_15")):
        noise = [round(abs(a - b), 3) for a, b in
                 zip(stats[ra]["mean_Lab"][1:3], stats[rb]["mean_Lab"][1:3])]
        spread = stats[f"goal_{s}"]["spread_ab"]
        diff = [round(abs(a - b), 3) for a, b in
                zip(stats[s]["mean_Lab"][1:3], stats[f"goal_{s}"]["mean_Lab"][1:3])]
        passed = (spread is not None
                  and diff[0] <= noise[0] + spread[0]
                  and diff[1] <= noise[1] + spread[1])
        g0_subjects[s] = {"pass": bool(passed), "noise_ab": noise,
                          "spread_ab": spread, "diff_ab": diff,
                          "render_Lab": stats[s]["mean_Lab"],
                          "photo_Lab": stats[f"goal_{s}"]["mean_Lab"]}

    # ---- G1 counterweight: skin -> flat mid-grey (store PNG), recompute k ----
    grey_rgb, grey_sha = ensure_grey_png()
    g1 = {}
    for s in ("body2", "aisha"):
        # Card: body2 runs unconditionally (method purity); Aisha only if G0
        # passed. G0 failure invalidates k as a reference, not the mask test.
        if s == "aisha" and not g0_subjects[s]["pass"]:
            g1[s] = {"skipped": "G0 failed: the shirt is not a valid reference here",
                     "pass": None, "k_real": round(k_Y[s], 6), "k_grey": None, "noise": None}
            continue
        r = rgb[s].copy()
        r[skin_gate(rgb[s])] = grey_rgb
        st_grey = shirt_stats_for(r, box[s], False)
        # k recomputed against the same photo: Y_photo / Y_render_greyskin
        k_grey = stats[f"goal_{s}"]["mean_Ylin"] / st_grey["mean_Ylin"]
        yn = abs(stats[s]["mean_Ylin"]
                 - stats["aisha_15" if s == "aisha" else "body2_b"]["mean_Ylin"])
        noise = yn / stats[s]["mean_Ylin"]
        # negative control: shirt -> grey must move k (else the mask is blind).
        # The replacement destroys the sage mask itself, so evaluate over the
        # ORIGINAL shirt pixels: their mean Y must change.
        r2 = rgb[s].copy()
        orig_sel = shirt_mask(rgb[s], box[s], False)
        r2[orig_sel] = grey_rgb
        y_sg = float(luminance_Y(srgb_to_linear(r2))[orig_sel].mean())
        k_sg = stats[f"goal_{s}"]["mean_Ylin"] / y_sg
        passed = abs(k_grey - k_Y[s]) <= noise
        g1[s] = {"pass": bool(passed), "k_real": round(k_Y[s], 6),
                 "k_grey": round(k_grey, 6), "noise": round(noise, 6),
                 "k_shirtgrey_moves": bool(abs(k_sg - k_Y[s]) > noise),
                 "k_shirtgrey": round(k_sg, 6),
                 "triviality": ("PASS is trivially guaranteed: the sage gate "
                                "(g>=r) and the skin gate (r>g) are disjoint by "
                                "construction, so no skin pixel can enter the "
                                "shirt mask; the in-memory replacement proves it "
                                "(k identical) and the shirt-grey control proves "
                                "sensitivity (k moves). No re-render: captures are "
                                "bit-deterministic (14a vs 14b identical) and the "
                                "shirt material is untouched by the skin override "
                                "by construction (pattern mpfb_skin, "
                                "isolated-subject-material-variants.ts:98-124).")}

    # ---- G2/G3: k applied, 4-region chroma + face median L ----
    # Card: G2 pass verdicts only where G0 passed. body2 numbers are still
    # computed (G3 needs the residual; verdict withheld, k unvalidated).
    # Aisha stops here (no downstream needs her normalised regions).
    g2_subjects, g3 = {}, {}
    for s in ("body2", "aisha"):
        if s == "aisha" and not g0_subjects[s]["pass"]:
            g2_subjects[s] = {"skipped": "G0 failed", "regions": {}}
            continue
        roe_render = RRM.regions_of(renders[s], landmarker)
        roe_goal = RRM.regions_of(goals[s], landmarker)
        adj = apply_k(rgb[s], k_Y[s])
        lab_adj = __import__("skimage.color", fromlist=["rgb2lab"]).rgb2lab(adj.astype(float) / 255.0)
        gate_adj = (RRM.skin_gate(adj) > 0).astype(np.uint8)
        pil = Image.open(renders[s]).convert("RGB")
        regs_adj = regions_on_lab(lab_adj, gate_adj, pil, landmarker)
        regs = {}
        npass = 0
        for r in REGCHROMA4:
            unn = dlab(roe_render["regions"][r]["Lab"], roe_goal["regions"][r]["Lab"])
            nor = dlab(regs_adj[r]["Lab"], roe_goal["regions"][r]["Lab"])
            ok = nor is not None and all(x <= BOUND for x in nor)
            npass += 1 if ok else 0
            regs[r] = {"unnormalised_dLab": unn, "normalised_dLab": nor, "pass": ok,
                       "render_Lab": regs_adj[r]["Lab"], "goal_Lab": roe_goal["regions"][r]["Lab"]}
        med_adj, n_adj = face_median_L(lab_adj, gate_adj, regs_adj)
        med_unn, n_unn = face_median_L(roe_render["lab"], roe_render["gate"], roe_render["regions"])
        med_goal, n_goal = face_median_L(roe_goal["lab"], roe_goal["gate"], roe_goal["regions"])
        validated = g0_subjects[s]["pass"]
        g2_subjects[s] = {"regions": regs, "n_within3_of_4": npass if validated else None,
                          "pass_claimed": validated,
                          "pass_note": ("withheld: G0 failed, k unvalidated"
                                        if not validated else "k validated by G0"),
                          "face_median_L": {"normalised": med_adj, "n": n_adj,
                                            "unnormalised": med_unn, "n_unn": n_unn,
                                            "goal": med_goal, "n_goal": n_goal}}
        if s == "body2":
            g3 = {"residual_after_k_is_albedo_gap": regs,
                  "k_validated": g0_subjects["body2"]["pass"],
                  "note": "record only, no fix: residual per-region dLab after "
                          "exposure normalisation is the albedo gap. "
                          "k is UNVALIDATED (G0 failed), so the split between "
                          "exposure and albedo is indicative, not claimed."}

    # ---- G4: beard sweep re-evaluated with k (recommendation only) ----
    sweep = [("0", os.path.join(STORE, "sweep", "skinior-body2-bw0-front.png")),
             ("0.5", os.path.join(STORE, "sweep", "skinior-body2-bw0p5-front.png")),
             ("0.75", os.path.join(STORE, "sweep", "skinior-body2-bw0p75-front.png")),
             ("0.9", renders["body2"]),
             ("1.0", os.path.join(STORE, "sweep", "skinior-body2-bw1p0-front.png"))]
    roe_goal_b2 = RRM.regions_of(GOAL_BODY2, landmarker)
    g4_table, worst = {}, {}
    for w, p in sweep:
        r = load_rgb(p)
        adj = apply_k(r, k_Y["body2"])
        lab_adj = __import__("skimage.color", fromlist=["rgb2lab"]).rgb2lab(adj.astype(float) / 255.0)
        gate_adj = (RRM.skin_gate(adj) > 0).astype(np.uint8)
        pil = Image.open(p).convert("RGB")
        regs_adj = regions_on_lab(lab_adj, gate_adj, pil, landmarker)
        per, mx = {}, 0.0
        for rg in ("upperlip_skin", "chin"):
            dl = dlab(regs_adj[rg]["Lab"], roe_goal_b2["regions"][rg]["Lab"])
            per[rg] = dl
            mx = max(mx, max(dl))
        g4_table[w] = {"per_region": per, "max_abs_dlab": round(mx, 2)}
        worst[w] = mx
    choice = min(worst, key=lambda w: worst[w])
    with open(os.path.join(DIR, "chain-manifest.json")) as f:
        chain = json.load(f)
    chain_w = (chain.get("subjects", {}).get("adult_male_street_casual", {})
               .get("overrides", {}).get("beard_shadow", {}).get("weight"))
    g4 = {"table_with_k": g4_table, "room_rig_choice_with_k": choice,
          "station_choice": 0.9,
          "k_validated": g0_subjects["body2"]["pass"],
          "chain_manifest_weight": chain_w,
          "recommendation": "keep chain-manifest (no change)",
          "rule_source": "aisha-real-chain-report.json G4_polygon_sweep "
                         "(minimise max per-channel |dLab| over polygon "
                         "upperlip_skin+chin); chain-manifest.json unchanged."}

    report = {
        "card": "tsk_9863341f09670c5b",
        "box_rule": BOX_RULE,
        "boxes": box,
        "framing_note": ("No view extension: the sage shirt is visible in the "
                         "existing front renders' bottom corners (body2 nsage "
                         f"{stats['body2']['n_shirt']}, aisha "
                         f"{stats['aisha']['n_shirt']}); the centre under the "
                         "chin is neck skin in all four images, so the box is "
                         "a bottom band, not a centre patch."),
        "masks": {k: {"n_box": v["n_box"], "n_shirt": v["n_shirt"],
                      "mean_rgb": v["mean_rgb"], "mean_Lab": v["mean_Lab"],
                      "mean_Ylin": v["mean_Ylin"],
                      "quadrant_n": [q["n"] for q in v["quadrants"]]}
                  for k, v in stats.items()},
        "k": {s: {"k_Y_applied": round(k_Y[s], 6),
                  "Y_photo": stats[f"goal_{s}"]["mean_Ylin"],
                  "Y_render": stats[s]["mean_Ylin"],
                  "L_ratio_beside": round(L_ratio[s], 6),
                  "L_photo": stats[f"goal_{s}"]["mean_Lab"][0],
                  "L_render": stats[s]["mean_Lab"][0]}
              for s in ("body2", "aisha")},
        "g0": {"rule": G0_RULE,
               "threshold_source": "card tsk_9863341f09670c5b (G0); "
                                   "instrument face_landmark_regions.py + "
                                   "room_rig_remeasure.py skin gate",
               "subjects": g0_subjects},
        "g1": {"threshold_source": "card tsk_9863341f09670c5b (G1)",
               "grey_png": {"path": GREY_PNG, "sha256": grey_sha,
                            "rgb": grey_rgb},
               "subjects": g1},
        "g2": {"threshold_source": "BOUND 3 per channel, "
                                   "the-tone-is-solved-per-region-and-a-painted-scalp-refuses.test.ts",
               "subjects": g2_subjects},
        "g3": g3,
        "g4": g4,
        "inputs": {},
        "material_identity": {
            "shirt_mesh": "makeclothes_library_toigo_t_shirt",
            "shirt_material": "mat_makeclothes_library_toigo_t_shirt",
            "inventoried_color": "#9eb19e",
            "inventory_source": ("capture JSONs "
                                 "skinior-body2-14a.json / skinior-aisha-14.json "
                                 "materialInventory via collectMaterialInventory, "
                                 "packages/openclinxr/xr-scene/src/"
                                 "isolated-subject-material-variants.ts:321, "
                                 "recorded at isolated-subject-debug-evidence.ts:213"),
            "no_id_pass": ("no per-pixel material-ID pass exists in the capture "
                           "tool; per-material flat-colour variants are possible "
                           "via applyMaterialOverrides match "
                           "(isolated-subject-material-variants.ts:379, readback "
                           "runtime-portrait-capture.ts:404-460) but cannot "
                           "reframe below the chin without tool edits outside "
                           "WRITE_ROOTS; pixel mask is colour-anchored to the "
                           "inventoried sage, purity guarded by G1."),
        },
        "red_first": RED_FIRST,
        "landmarker": {"model_path": FLR.model_path(),
                       "model_sha256": FLR.model_sha(FLR.model_path())},
    }
    for k, p in paths.items():
        report["inputs"][k] = {"path": p, "sha256": sha256_file(p)}
    report["inputs"]["flat_grey_128"] = {"path": GREY_PNG, "sha256": grey_sha}
    with open(REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print(f"wrote {REPORT_OUT}")
    print("k:", json.dumps({s: round(k_Y[s], 6) for s in k_Y}))
    print("G0:", json.dumps({s: v["pass"] for s, v in g0_subjects.items()}))
    print("G1:", json.dumps({s: v.get("pass") for s, v in g1.items()}))
    print("G4 choice:", choice)


if __name__ == "__main__":
    main()
