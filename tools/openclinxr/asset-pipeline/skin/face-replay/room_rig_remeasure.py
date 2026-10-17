"""Room-rig skin re-measure (card tsk_d4667a3e507da70d).

Measures the IOR 1.4 renders on the product room rig (ob_triage_room_v1)
against the room-rig gates G0-G5 and writes
room-rig-remeasure-report.json. Every number cites its input file + sha;
every threshold cites its source BEFORE the numbers it gates (see
THRESHOLDS in the report).

Method: polygon x eroded-skin gate per face_landmark_regions.py
(ERODE_PX 3) + face_gate region_polygons/raster_masks; Lab via
skimage rgb2lab (D65), same as the box patches. Highlight fractions per
forehead-sheen-report.json metric definitions (DL=10.0, K=0.85 cheek;
+2.0 / 0.95 own-median). Beard sweep via beard_shadow.py weights with the
aisha-real-chain-report.json G4 min-max rule (minimise max per-channel
|dLab| over polygon upperlip_skin+chin, render vs goal).

Usage: python3 room_rig_remeasure.py   (run via mise, repo root = cwd)
"""
import hashlib
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from skimage.color import rgb2lab

DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(DIR, "..", "..", "..", "..", ".."))
sys.path.insert(0, DIR)
sys.path.insert(0, os.path.join(REPO, "tools", "openclinxr", "evidence", "face-gate"))
import face_gate as FG  # noqa: E402
import face_landmark_regions as FLR  # noqa: E402

STORE = "/Volumes/files/openclinxr-assets/store/skin-ior-room"
S = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike"
GOAL_BODY2 = os.path.join(S, "body2", "goal-front.png")
GOAL_AISHA = os.path.join(S, "project", "edit-v9", "edit-0.png")
REPORT_OUT = os.path.join(DIR, "room-rig-remeasure-report.json")
REGIONS = ["forehead", "L_cheek", "R_cheek", "chin", "upperlip_skin"]
REGCHROMA4 = ["forehead", "L_cheek", "R_cheek", "chin"]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rgb(path):
    return np.array(Image.open(path).convert("RGB"))


def skin_gate(rgb):
    r = rgb[..., 0].astype(int)
    g = rgb[..., 1].astype(int)
    b = rgb[..., 2].astype(int)
    m = ((r > 60) & (r > g) & (g > b)).astype(np.uint8) * 255
    m = cv2.erode(m, np.ones((7, 7), np.uint8))
    return (m > 0).astype(np.uint8)


def regions_of(png_path, landmarker):
    """Polygon Lab means + masks + Lab array + landmarker points."""
    pil = Image.open(png_path).convert("RGB")
    rgb = np.array(pil)
    lab = rgb2lab(rgb.astype(float) / 255.0)
    gate = skin_gate(rgb)
    regions, info, polys = FLR.polygon_regions(lab, gate, pil, landmarker)
    w, h = pil.size
    masks = FG.raster_masks(polys, w, h, erode_px=FLR.ERODE_PX)
    smap = {mp: side for side, mp in info["cheek_mapping"].items()}
    got = {}
    for name in REGIONS:
        key = smap.get(name, name) if "cheek" in name else name
        m = masks[key]
        sel = (m > 0) & (gate > 0)
        n = int(sel.sum())
        got[name] = {
            "n": n,
            "Lab": [round(float(v), 2) for v in lab[sel].mean(axis=0)] if n >= FLR.MIN_POLY_N else None,
            "mask": (m > 0),
        }
    pts = FG.detect_points(landmarker, pil)
    return {"regions": got, "info": info, "lab": lab, "rgb": rgb, "gate": gate, "pts": np.array(pts)}


def mean_abs_diff(a_rgb, b_rgb, mask):
    d = np.abs(a_rgb.astype(np.int16) - b_rgb.astype(np.int16)).mean(axis=2)
    sel = mask > 0
    return round(float(d[sel].mean()), 4) if sel.sum() else None


def highlight_fractions(roe):
    """HL_cheek + HL_own on the forehead polygon (forehead-sheen metric)."""
    lab, gate = roe["lab"], roe["gate"]
    w = lab.shape[1]
    masks_all = roe["regions"]
    # cheek union for medians: use L+R cheek masks
    csel = np.zeros_like(gate, bool)
    for cn in ("L_cheek", "R_cheek"):
        csel |= masks_all[cn]["mask"] & (gate > 0)
    cheek_med_l = float(np.median(lab[..., 0][csel]))
    cc = np.sqrt(lab[..., 1][csel] ** 2 + lab[..., 2][csel] ** 2)
    cheek_med_c = float(np.median(cc))
    fsel = masks_all["forehead"]["mask"] & (gate > 0)
    fL = lab[..., 0][fsel]
    fC = np.sqrt(lab[..., 1][fsel] ** 2 + lab[..., 2][fsel] ** 2)
    hl_cheek = float(((fL > cheek_med_l + 10.0) & (fC < 0.85 * cheek_med_c)).mean())
    own_med_l = float(np.median(fL))
    own_med_c = float(np.median(fC))
    hl_own = float(((fL > own_med_l + 2.0) & (fC < 0.95 * own_med_c)).mean())
    return {
        "HL_cheek": round(hl_cheek, 4),
        "HL_own": round(hl_own, 4),
        "medL": round(float(np.median(fL)), 2),
        "medC": round(float(np.median(fC)), 2),
        "n": int(fsel.sum()),
    }


def nasolabial_mask(shape_hw, pts):
    """14px-wide bands along P[98]->P[61] (L) and P[327]->P[327]... (R: 327->291).

    Indices from face_gate.INDICES (nose base 98/327 = nostril outers,
    mouth corners 61/291): the fold runs nostril-outer -> mouth corner.
    """
    h, w = shape_hw
    m = np.zeros((h, w), np.uint8)
    for a, b in ((98, 61), (327, 291)):
        pa = (int(round(float(pts[a][0]))), int(round(float(pts[a][1]))))
        pb = (int(round(float(pts[b][0]))), int(round(float(pts[b][1]))))
        cv2.line(m, pa, pb, 255, 14)
    return (m > 0)


def highpass_contrast(gray_u8, mask, ksize=5):
    blur = cv2.blur(gray_u8, (ksize, ksize))
    hp = gray_u8.astype(np.float32) - blur.astype(np.float32)
    sel = mask > 0
    return round(float(np.sqrt((hp[sel] ** 2).mean())), 3) if sel.sum() else None


def crease_contrast(gray_u8, mask, sigma_small, sigma_large):
    """Difference-of-Gaussians band contrast (crease scale, not pore scale)."""
    small = cv2.GaussianBlur(gray_u8, (0, 0), sigma_small)
    large = cv2.GaussianBlur(gray_u8, (0, 0), sigma_large)
    dog = small.astype(np.float32) - large.astype(np.float32)
    sel = mask > 0
    return round(float(np.sqrt((dog[sel] ** 2).mean())), 3) if sel.sum() else None


def dump_image(png_path, landmarker, out_npz):
    """Phase A: detect once, persist everything phase B needs (no mediapipe)."""
    pil = Image.open(png_path).convert("RGB")
    rgb = np.array(pil)
    lab = rgb2lab(rgb.astype(float) / 255.0)
    gate = skin_gate(rgb)
    regions, info, polys = FLR.polygon_regions(lab, gate, pil, landmarker)
    w, h = pil.size
    masks = FG.raster_masks(polys, w, h, erode_px=FLR.ERODE_PX)
    smap = {mp: side for side, mp in info["cheek_mapping"].items()}
    packed = {}
    means = {}
    for name in REGIONS:
        key = smap.get(name, name) if "cheek" in name else name
        m = (masks[key] > 0)
        packed[name] = m
        sel = m & (gate > 0)
        n = int(sel.sum())
        means[name] = ([round(float(v), 2) for v in lab[sel].mean(axis=0)]
                       if n >= FLR.MIN_POLY_N else None)
    pts = FG.detect_points(landmarker, pil)
    np.savez_compressed(out_npz, rgb=rgb, gate=gate,
                        **{f"mask_{k}": v for k, v in packed.items()},
                        pts=np.array(pts))
    with open(out_npz + ".means.json", "w") as f:
        json.dump({"means": means, "info": {k: v for k, v in info.items()
                                            if k in ("spread_px", "cheek_mapping")},
                   "sha256": sha256_file(png_path), "path": png_path}, f, indent=1)
    print(f"dumped {png_path} -> {out_npz}", flush=True)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", nargs=2, metavar=("PNG", "NPZ"), default=None)
    ap.add_argument("--from-dumps", default=None)
    args = ap.parse_args()
    if args.dump:
        landmarker = FLR.create_landmarker()
        dump_image(args.dump[0], landmarker, args.dump[1])
        return
    from_dumps = args.from_dumps
    landmarker = None if from_dumps else FLR.create_landmarker()
    P = lambda *parts: os.path.join(*parts)  # noqa: E731
    renders = {
        "body2_base": P(STORE, "skinior-body2-base-front.png"),
        "body2_15a": P(STORE, "skinior-body2-15a-front.png"),
        "body2_15b": P(STORE, "skinior-body2-15b-front.png"),
        "body2_14a": P(STORE, "skinior-body2-14a-front.png"),
        "body2_14b": P(STORE, "skinior-body2-14b-front.png"),
        "aisha_15": P(STORE, "skinior-aisha-15-front.png"),
        "aisha_14": P(STORE, "skinior-aisha-14-front.png"),
        "bw0": P(STORE, "sweep", "skinior-body2-bw0-front.png"),
        "bw0p5": P(STORE, "sweep", "skinior-body2-bw0p5-front.png"),
        "bw0p75": P(STORE, "sweep", "skinior-body2-bw0p75-front.png"),
        "bw1p0": P(STORE, "sweep", "skinior-body2-bw1p0-front.png"),
    }
    roe = {}
    if from_dumps:
        def load_dump(key, png_path):
            base = os.path.join(from_dumps, key)
            z = np.load(base + ".npz")
            with open(base + ".npz.means.json") as f:
                meta = json.load(f)
            rgb = z["rgb"]
            lab = rgb2lab(rgb.astype(float) / 255.0)
            return {"regions": {r: {"Lab": meta["means"][r], "mask": z[f"mask_{r}"] > 0}
                                 for r in REGIONS},
                    "info": meta["info"], "lab": lab, "rgb": rgb,
                    "gate": z["gate"], "pts": z["pts"]}
        for k, v in renders.items():
            print(f"load {k}", flush=True)
            roe[k] = load_dump(k, v)
        print("load goal_body2", flush=True)
        goal_body2 = load_dump("goal_body2", GOAL_BODY2)
        print("load goal_aisha", flush=True)
        goal_aisha = load_dump("goal_aisha", GOAL_AISHA)
    else:
        for k, v in renders.items():
            print(f"regions_of {k}", flush=True)
            roe[k] = regions_of(v, landmarker)
        print("regions_of goal_body2", flush=True)
        goal_body2 = regions_of(GOAL_BODY2, landmarker)
        print("regions_of goal_aisha", flush=True)
        goal_aisha = regions_of(GOAL_AISHA, landmarker)
    print("regions done", flush=True)

    # ---- G0: per-region run-to-run noise (denominator) ----
    g0 = {"regions": {}, "global": {}}
    for pair, tag in ((("body2_15a", "body2_15b"), "ior15"), (("body2_14a", "body2_14b"), "ior14")):
        a, b = roe[pair[0]], roe[pair[1]]
        g0["regions"][tag] = {
            r: mean_abs_diff(a["rgb"], b["rgb"], (a["regions"][r]["mask"] & (a["gate"] > 0)).astype(np.uint8))
            for r in REGIONS
        }
        g0["global"][tag] = mean_abs_diff(a["rgb"], b["rgb"], np.ones(a["rgb"].shape[:2], np.uint8))
    # ---- G1: base vs ior15 control ----
    g1 = {"regions": {}, "global": None}
    a, b = roe["body2_base"], roe["body2_15a"]
    g1["regions"] = {
        r: mean_abs_diff(a["rgb"], b["rgb"], (a["regions"][r]["mask"] & (a["gate"] > 0)).astype(np.uint8))
        for r in REGIONS
    }
    g1["global"] = mean_abs_diff(a["rgb"], b["rgb"], np.ones(a["rgb"].shape[:2], np.uint8))
    d = np.abs(a["rgb"].astype(np.int16) - b["rgb"].astype(np.int16))
    g1["frac_px_any_diff"] = round(float((d.sum(axis=2) > 0).mean()), 6)
    g1["frac_px_diff_gt1"] = round(float(((d > 1).any(axis=2)).mean()), 6)
    g1["max_abs"] = int(d.max())

    # ---- G3: highlight fractions ----
    g3 = {k: highlight_fractions(roe[k]) for k in ("body2_15a", "body2_14a", "aisha_15", "aisha_14")}
    g3["goal_body2"] = highlight_fractions(goal_body2)
    g3["goal_aisha"] = highlight_fractions(goal_aisha)

    # ---- G4a: regional dLab vs goal ----
    def dlab_table(render_key, goal_roe):
        out = {}
        for r in REGIONS:
            rl, gl = render_key["regions"][r]["Lab"], goal_roe["regions"][r]["Lab"]
            out[r] = [round(abs(a - b), 2) for a, b in zip(rl, gl)] if rl and gl else None
        return out

    g4a = {
        "body2_14a_vs_goal": dlab_table(roe["body2_14a"], goal_body2),
        "aisha_14_vs_goal": dlab_table(roe["aisha_14"], goal_aisha),
    }

    def within3_count(table):
        return sum(1 for r in REGCHROMA4 if table[r] is not None and all(x <= 3 for x in table[r]))

    g4a["body2_L_within3_of_4"] = sum(
        1 for r in REGCHROMA4
        if g4a["body2_14a_vs_goal"][r] is not None and g4a["body2_14a_vs_goal"][r][0] <= 3
    )

    # ---- G4b: beard sweep (upperlip_skin + chin, min max per-channel |dLab|) ----
    g4b = {}
    for w, key in (("0", "bw0"), ("0.5", "bw0p5"), ("0.75", "bw0p75"), ("0.9", "body2_14a"), ("1.0", "bw1p0")):
        per = {}
        worst = 0.0
        for r in ("upperlip_skin", "chin"):
            rl, gl = roe[key]["regions"][r]["Lab"], goal_body2["regions"][r]["Lab"]
            dl = [round(abs(x - y), 2) for x, y in zip(rl, gl)]
            per[r] = dl
            worst = max(worst, max(dl))
        g4b[w] = {"per_region": per, "max_abs_dlab": round(worst, 2)}
    g4b_choice = min(g4b, key=lambda w: g4b[w]["max_abs_dlab"])

    # ---- G4c: forehead residual + gap-closure analog ----
    fh14 = g4a["body2_14a_vs_goal"]["forehead"]
    fh15 = dlab_table(roe["body2_15a"], goal_body2)["forehead"]
    g4c = {"forehead_residual_14a": fh14, "forehead_residual_15a": fh15}
    gap = {}
    for i, ch in enumerate("Lab"):
        denom = fh15[i]
        gap[ch] = round((denom - fh14[i]) / denom, 3) if denom else None
    g4c["gap_closure_15_to_14"] = gap

    # ---- G5: record-only residuals ----
    def face_median_L(roe_d):
        sel = np.zeros_like(roe_d["gate"], bool)
        for r in REGIONS:
            sel |= roe_d["regions"][r]["mask"] & (roe_d["gate"] > 0)
        return round(float(np.median(roe_d["lab"][..., 0][sel])), 2), int(sel.sum())

    g5 = {}
    g5["body2_render_face_median_L"], g5["body2_render_face_n"] = face_median_L(roe["body2_14a"])
    g5["body2_goal_face_median_L"], g5["body2_goal_face_n"] = face_median_L(goal_body2)
    g5["warm_medium_anchor_L"] = 49.26
    g5["warm_medium_anchor_source"] = (
        "tools/openclinxr/asset-pipeline/skin/families/tone-report.json:tone_anchors_Lab.warm_medium[0]"
    )
    for key, groe, tag in (("body2_14a", roe["body2_14a"], "render"), ("goal_body2", goal_body2, "goal")):
        gray = (0.299 * groe["rgb"][..., 0] + 0.587 * groe["rgb"][..., 1] + 0.114 * groe["rgb"][..., 2]).astype(np.uint8)
        fmask = (groe["regions"]["forehead"]["mask"] & (groe["gate"] > 0)).astype(np.uint8)
        nl = (nasolabial_mask(groe["rgb"].shape[:2], groe["pts"]) & (groe["gate"] > 0)).astype(np.uint8)
        g5[f"{tag}_forehead_hp_contrast"] = highpass_contrast(gray, fmask)
        g5[f"{tag}_nasolabial_hp_contrast"] = highpass_contrast(gray, nl)
        g5[f"{tag}_nasolabial_n"] = int(nl.sum())
        # Crease-scale band (handback 1): DoG sigmas from the measured
        # forehead-polygon bbox height fh_h (creases span ~fh_h/50..fh_h/14
        # px at 1280); the 5x5 box above resolves pores, this resolves folds.
        ys, xs = np.where(fmask > 0)
        fh_h = int(ys.max() - ys.min()) if len(ys) else 0
        s_small = max(2.0, round(fh_h / 50.0, 1))
        s_large = max(6.0, round(fh_h / 14.0, 1))
        g5[f"{tag}_forehead_bbox_h"] = fh_h
        g5[f"{tag}_crease_band_sigmas"] = [s_small, s_large]
        g5[f"{tag}_forehead_crease_contrast"] = crease_contrast(gray, fmask, s_small, s_large)
        g5[f"{tag}_nasolabial_crease_contrast"] = crease_contrast(gray, nl, s_small, s_large)
    g5["highpass_kernel"] = "5x5 box blur (cv2.blur ksize 5); contrast = RMS(gray - blur) over mask (pore scale)"
    g5["crease_kernel"] = ("difference of Gaussians G(sigma_small) - G(sigma_large), sigmas from forehead bbox "
                           "height (small = fh_h/50, large = fh_h/14); contrast = RMS(DoG) over mask (fold scale)")
    g5["nasolabial_indices"] = {"L": [98, 61], "R": [327, 291], "width_px": 14,
                                "source": "tools/openclinxr/evidence/face-gate/face_gate.py:INDICES"}

    render_files = []
    for rid, views in (("skinior-body2-15a", [0, 25, 40]), ("skinior-body2-14a", [0, 25, 40]),
                       ("skinior-aisha-15", [0, 25, 40]), ("skinior-aisha-14", [0, 25, 40])):
        for v in views:
            suf = "front" if v == 0 else f"yaw{v}"
            p = os.path.join(STORE, f"{rid}-{suf}.png")
            render_files.append({"path": p, "sha256": sha256_file(p)})

    # ---- G2: readback ior + non-skin inventory identity ----
    def record(rid):
        with open(os.path.join(STORE, f"{rid}.json")) as f:
            return json.load(f)

    g2 = {}
    for subj, s15, s14 in (("body2", "skinior-body2-15a", "skinior-body2-14a"),
                           ("aisha", "skinior-aisha-15", "skinior-aisha-14")):
        r15, r14 = record(s15), record(s14)
        inv15 = {(e["mesh"], e["material"]): e for e in r15["materialInventory"]}
        inv14 = {(e["mesh"], e["material"]): e for e in r14["materialInventory"]}
        skin_names = {r15["skinOverrideApplied"]["matchedMaterials"][0],
                      r14["skinOverrideApplied"]["matchedMaterials"][0]}
        nonskin_same = all(
            inv15[k] == inv14[k] for k in inv15 if k[1] not in skin_names
        ) and set(inv15) == set(inv14)
        skin_type_15 = [e["type"] for e in r15["materialInventory"] if e["material"] in skin_names][0]
        skin_type_14 = [e["type"] for e in r14["materialInventory"] if e["material"] in skin_names][0]
        g2[subj] = {
            "skin_material": sorted(skin_names),
            "ior_15": r15["skinOverrideApplied"]["ior"],
            "ior_14": r14["skinOverrideApplied"]["ior"],
            "skin_type_15": skin_type_15,
            "skin_type_14": skin_type_14,
            "nonskin_inventory_identical_15_vs_14": nonskin_same,
        }
    g2["base_skin_type"] = [e["type"] for e in record("skinior-body2-base")["materialInventory"]
                            if e["material"] == "mpfb_skin_adult_male_street_casual"][0]

    report = {
        "card": "tsk_d4667a3e507da70",
        "code": {
            "SKIN_IOR": 1.4,
            "SKIN_F0": round(((1.4 - 1) / (1.4 + 1)) ** 2, 4),
            "F0_source": ("Tuchin, Tissue Optics 3rd ed., Table 1.3 (skin n=1.36-1.43); "
                          "GPU Gems 3 ch. 14 (d'Eon & Luebke) models the skin air-tissue interface at IOR 1.4; "
                          "F0 = ((n-1)/(n+1))^2 = 0.0278 beside SKIN_IOR in "
                          "packages/openclinxr/xr-scene/src/isolated-subject-material-variants.ts"),
            "explicit_override_field": "SkinOverride.ior (G1 control only; default SKIN_IOR)",
            "product_runtime_note": (
                "NOT TESTED on the learner exam runtime: no file under apps/ui-xr/src references "
                "isolated-subject-material-variants (grep, 2026-10-17). Consumed by the measurement "
                "harness only: packages/openclinxr/xr-scene/src/isolated-subject-lab.ts:41-43 "
                "(import) and :341 (applySkinOverride in the variant path), served via "
                "apps/ui-xr/isolated-subject.html. No apps/** file edited."),
        },
        "inputs": {
            "body2_glb": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/body2/run2/body2-lidconform.glb"},
            "body2_albedo": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/body2/run2/albedo_beard.png"},
            "body2_roughness": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/body2/run2/roughness.png"},
            "body2_normal": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/body2/run2/body2-lidconform.skin-normal.png"},
            "aisha_glb": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/aisha/run2/aisha-lidconform.glb"},
            "aisha_albedo": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/aisha/run2/albedo_beard.png"},
            "aisha_roughness": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/aisha/run2/roughness.png"},
            "aisha_normal": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/aisha/run2/aisha-lidconform.skin-normal.png"},
            "goal_body2": {"path": GOAL_BODY2},
            "goal_aisha": {"path": GOAL_AISHA},
            "rig": {"path": "apps/ui-xr/public/xr-assets/lighting/ob_triage_room_v1.rig.json"},
            "case_report": {"path": "packages/openclinxr/factory-stations/src/face_realism/case-run-report.json",
                            "note": "latest runs: body2/run2 + aisha/run2"},
        },
        "thresholds": {
            "G0": {"threshold": "per-region run-to-run meanAbsDiff (15a vs 15b, 14a vs 14b); denominator for all enforced gates",
                   "threshold_source": "card tsk_d4667a3e507da70 (G0); instrument face_landmark_regions.py ERODE_PX 3"},
            "G1": {"threshold": "per-region + global meanAbsDiff(base, 15a) within G0 noise (0.0); falsifier: else stop and report the diff",
                   "threshold_source": "card tsk_d4667a3e507da70 (G1)"},
            "G2": {"threshold": "skinOverrideApplied.ior == 1.4 exactly (body2 + aisha); non-skin collectMaterialInventory identical 15 vs 14",
                   "threshold_source": "card tsk_d4667a3e507da70 (G2)"},
            "G3": {"threshold": "HL drops 1.5 -> 1.4 on BOTH metrics AND stays >= lower goal value (cheek floor 0.0618, own floor 0.0393); not matte",
                   "threshold_source": ("forehead-sheen-report.json goals (body2 HL_cheek 0.6054/HL_own 0.1746; "
                                        "aisha-edit-0 HL_cheek 0.0618/HL_own 0.0393) + metric defs (DL=10.0, K=0.85 cheek; "
                                        "+2.0/0.95 own-median)")},
            "G4a": {"threshold": "per-channel |dLab| <= 3 (BOUND 3) for the 4 regchroma regions; L-field 3-of-4 count",
                    "threshold_source": ("tools/openclinxr/asset-pipeline/skin/face-replay/"
                                         "the-tone-is-solved-per-region-and-a-painted-scalp-refuses.test.ts:30")},
            "G4b": {"threshold": "minimise max per-channel |dLab| over polygon upperlip_skin+chin (render vs goal); recommend only",
                    "threshold_source": "aisha-real-chain-report.json G4_polygon_sweep (chosen_weight 0.9)"},
            "G4c": {"threshold": "report forehead residual dLab + transfer/gap-closure beside studio numbers (record)",
                    "threshold_source": "forehead-field-report.json + forehead-sheen-report.json gates.G5"},
            "G5": {"threshold": "record only, no fix (face-polygon median L vs goal + warm_medium anchor; high-pass wrinkle contrast)",
                   "threshold_source": "station lane grade c7cd115a5 (record-only residuals)"},
        },
        "gates": {
            "G0": {"threshold_source": "card tsk_d4667a3e507da70 (G0); instrument face_landmark_regions.py ERODE_PX 3",
                   **g0},
            "G1": {"threshold_source": "card tsk_d4667a3e507da70 (G1)",
                   **g1},
            "G2": {"threshold_source": "card tsk_d4667a3e507da70 (G2)", **g2},
            "G3": {"threshold_source": ("forehead-sheen-report.json goals + metric defs"),
                   "values": g3},
            "G4": {"threshold_source": "BOUND 3 test:30; aisha-real-chain G4; fhfield/fhsheen reports",
                   "regional_dlab": g4a, "beard_sweep": {**g4b, "room_rig_choice": g4b_choice,
                                                         "station_choice": 0.9,
                                                         "recommendation": "keep chain-manifest (no change)"},
                   "ior_gap_closure": g4c,
                   "albedo_edit_transfer": {
                       "measured": False,
                       "reason": ("NOT MEASURED on the room rig: the studio ratio's albedo leg "
                                  "(albedo_delta_a_face_mean 3.828 from the +a* transfer bake) was never "
                                  "re-baked for the room rig, and room-side the albedo delta is 0 by "
                                  "construction (IOR lives in the material, same albedo_beard). "
                                  "The ior_gap_closure above is the room-side analog.")}},
            "G5": {"threshold_source": "station lane grade c7cd115a5 (record-only)", **g5},
            "G6": {"threshold_source": "card tsk_d4667a3e507da70 (G6)", "grade": "pending lane manager"},
        },
        "renders": render_files,
        "landmarker": {"model_path": FLR.model_path(), "model_sha256": FLR.model_sha(FLR.model_path())},
    }
    for k, v in report["inputs"].items():
        if k == "case_report":
            continue
        v["sha256"] = sha256_file(v["path"])
    with open(REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print(f"wrote {REPORT_OUT}")
    print("G2:", json.dumps(g2))
    print("G0:", json.dumps(g0))
    print("G1:", json.dumps(g1))
    print("G3:", json.dumps(g3))
    print("G4a:", json.dumps(g4a))
    print("G4b choice:", g4b_choice, json.dumps(g4b))
    print("G4c:", json.dumps(g4c))
    print("G5:", json.dumps(g5))


if __name__ == "__main__":
    main()
