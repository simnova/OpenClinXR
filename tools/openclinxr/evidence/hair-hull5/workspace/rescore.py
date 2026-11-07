"""hair-hull5 rescore (E-side): re-score every hull3 gate + redefined sensitivity.

Reads hull4 WS read-only (diag/sens/carve_stats/mismatch/ear/poke/splats).
Re-carves the undilated 6-view hull (same calls as stage_sensitivity's
undilated branch, store=True) to get undilated splats for the hem-excluded
regional comparison. Writes E5/workspace/rescore.json + undilated splats.
Provenance: hull5 occupancy == hull4 baseline_kept final (vox + states).
"""
import json
import sys
from pathlib import Path

import numpy as np

WORKTREE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/hair-groom/hull"))
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/hair-groom"))
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/hair-groom/cage"))
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/evidence/hair-hull4/workspace"))

import hull as H  # noqa: E402
import hull1 as H1  # noqa: E402
import hull2 as H2  # noqa: E402
import hull3 as H3  # noqa: E402
from scipy import ndimage as ndi  # noqa: E402
from work import apply_all, loader, splat_visible_fixed  # noqa: E402

ROOT = WORKTREE
E4 = ROOT / "tools/openclinxr/evidence/hair-hull4"
WS4 = E4 / "workspace"
E5 = ROOT / "tools/openclinxr/evidence/hair-hull5"
WS5 = E5 / "workspace"
WS5.mkdir(parents=True, exist_ok=True)

# --- provenance: promoted occupancy == hull4 baseline ---
b4 = np.load(str(WS4 / "baseline_kept.npz"))
h5 = np.load(str(E5 / "hull.npz"))
assert int(h5["occupancy"].sum()) == int(b4["final"].sum()) == 393153
assert (np.array(h5["occupancy"]) == np.array(b4["final"])).all()
assert (np.array(h5["states_packed"]) == np.array(b4["states_packed"])).all()
assert list(h5["views"]) == ["front", "three_quarter", "three_quarter_mirror",
                             "profile_90", "back", "profile_90_mirror"]
print("PROVENANCE occupancy==hull4-final 393153 vox, states==uint16 max728",
      flush=True)

apply_all()
inp = loader()
V6 = list(inp["views"])
assert V6 == ["front", "three_quarter", "three_quarter_mirror",
              "profile_90", "back", "profile_90_mirror"], V6

diag = json.loads((WS4 / "diag.json").read_text())
stats = json.loads((WS4 / "carve_stats.json").read_text())
sens = json.loads((WS4 / "sens.json").read_text())
ear = json.loads((WS4 / "ear.json").read_text())
pa = json.loads((WS4 / "poke_anatomy.json").read_text())
probe = json.loads((WS4 / "undilated_probe.json").read_text())

# --- baseline splats (honest mirror frame, hull4 fixed) ---
bsplat = {v: np.load(str(WS4 / ("splat_final_%s.npy" % v))).astype(bool)
          for v in V6}
masks = {v: np.array(inp["masks"][v], dtype=bool) for v in V6}


def contour_metrics_views(splat, masks, views):
    out = {}
    for v in views:
        tgt = masks[v]
        h = splat[v]
        hd = ndi.binary_dilation(h, iterations=1)
        bt = tgt ^ ndi.binary_erosion(tgt)
        edt_t = ndi.distance_transform_edt(~bt)
        edt_fill = ndi.distance_transform_edt(~tgt)
        hr, hc = np.nonzero(h & ~tgt)
        de = edt_fill[hr, hc] if hr.size else np.zeros(0)
        tr, tc = np.nonzero(bt & ~hd)
        edt_h = ndi.distance_transform_edt(~hd)
        dm = edt_h[tr, tc] if tr.size else np.zeros(0)
        inter = float((hd & tgt).sum())
        union = float((hd | tgt).sum())
        q = lambda a, p: round(float(np.percentile(a, p)), 2) if a.size else 0.0
        out[v] = {"excessN": int(hr.size), "excessP50": q(de, 50),
                  "excessP95": q(de, 95), "excessMax": q(de, 100),
                  "missN": int(tr.size), "missP50": q(dm, 50),
                  "missP95": q(dm, 95), "missMax": q(dm, 100),
                  "iou": round(inter / union, 4) if union else 0.0,
                  "hullPx": int(hd.sum()), "targetPx": int(tgt.sum())}
    return out


# --- undilated re-carve (same calls as sensitivity undilated branch) ---
print("RECARVE undilated 6-view start", flush=True)
res2 = H.carve_grids(inp, spacing=2.0, dil_px=0, store=True)
filt2 = H.close_and_filter(res2, inp, res2["dil"], res2["occ"])
sp2 = H.pack_states(res2["states"])
usplat = splat_visible_fixed(filt2["final"], sp2, res2["xs"], res2["ys"],
                             res2["zs"], inp)
for v, m in usplat.items():
    np.save(str(WS5 / ("splat_undil_%s.npy" % v)), np.array(m, dtype=bool))
below2 = H1.below_shoulder(filt2["final"], res2["xs"], res2["ys"], res2["zs"])
undil = {"keptFinal": int(filt2["final"].sum()),
         "keepLabel": filt2["keep_label"],
         "nCompPre": filt2["n_pre"], "nCompPost": filt2["n_post"],
         "nAdded": filt2["nAdded"], "droppedTouchVox": int(
             sum(filt2["dropped_touch"].values())),
         "belowShoulder": below2,
         "splatPx": {v: int(np.array(m).sum()) for v, m in usplat.items()}}
(WS5 / "undilated_recarve.json").write_text(json.dumps(undil, indent=1))
print("RECARVE undil kept=%d keepLabel=%s nComp=%d/%d belowL/R=%d/%d" % (
    undil["keptFinal"], undil["keepLabel"], undil["nCompPre"],
    undil["nCompPost"], below2["sideL"]["vox"], below2["sideR"]["vox"]),
    flush=True)

# --- hem-excluded regional comparison ---
hem = {v: H3.hem_start_row(masks[v]) for v in V6}
mask_nh = {}
splat_base_nh = {}
splat_undil_nh = {}
for v in V6:
    hs = hem[v]
    mn = masks[v].copy()
    mn[hs:, :] = False
    mask_nh[v] = mn
    sb = bsplat[v].copy()
    sb[hs:, :] = False
    splat_base_nh[v] = sb
    su = np.array(usplat[v], dtype=bool)
    su[hs:, :] = False
    splat_undil_nh[v] = su
cm_base_nh = contour_metrics_views(splat_base_nh, mask_nh, V6)
cm_undil_nh = contour_metrics_views(splat_undil_nh, mask_nh, V6)
regional = {}
fragile_nh = []
for v in V6:
    deltas = {}
    for m in ("excessP95", "missP95"):
        d = abs(cm_undil_nh[v][m] - cm_base_nh[v][m])
        deltas[m] = round(d, 2)
        if d > 5.0:
            fragile_nh.append("%s/%s: base %s vs undil %s" % (
                v, m, cm_base_nh[v][m], cm_undil_nh[v][m]))
    regional[v] = {"base": {k: cm_base_nh[v][k] for k in
                            ("excessP95", "missP95", "excessN", "missN")},
                   "undil": {k: cm_undil_nh[v][k] for k in
                              ("excessP95", "missP95", "excessN", "missN")},
                   "delta": deltas,
                   "hemStartRow": hem[v]}
# hem-band miss: rows >= hemStart, hull vs mask
hem_miss = {}
for v in V6:
    hs = hem[v]
    tgt_h = masks[v][hs:, :]
    hd_b = ndi.binary_dilation(bsplat[v], iterations=1)[hs:, :]
    hd_u = ndi.binary_dilation(np.array(usplat[v], dtype=bool),
                               iterations=1)[hs:, :]
    bt = tgt_h ^ ndi.binary_erosion(tgt_h)
    for name, hd in (("base", hd_b), ("undil", hd_u)):
        tr, tc = np.nonzero(bt & ~hd)
        edt_h = ndi.distance_transform_edt(~hd)
        dm = edt_h[tr, tc] if tr.size else np.zeros(0)
        q = lambda a, p: round(float(np.percentile(a, p)), 2) if a.size else 0.0
        hem_miss.setdefault(v, {})[name] = {
            "missN": int(tr.size), "missP50": q(dm, 50),
            "missP95": q(dm, 95), "missMax": q(dm, 100),
            "maskHemPx": int(tgt_h.sum())}

# --- gate (i): no region lost ---
gate_i = {"undilKeepLabel": undil["keepLabel"],
          "undilSplatPx": undil["splatPx"],
          "undilBelow": {k: below2[k]["vox"] for k in
                         ("front", "sideL", "sideR", "back")},
          "pass": bool(undil["keepLabel"] != 0
                       and all(p > 0 for p in undil["splatPx"].values())
                       and below2["sideL"]["vox"] > 0
                       and below2["sideR"]["vox"] > 0
                       and below2["back"]["vox"] > 0)}
gate_ii = {"regionalNonHemDelta": regional, "fragileNonHem": fragile_nh,
           "pass": bool(not fragile_nh)}
gate_iii = {"hemBandMissReported": hem_miss}
sens1 = sens["spacing1mm"]
gate_1mm = {"maxDelta": sens1["maxContourDeltaPx"],
            "fragile": sens1["fragile"], "pass": bool(not sens1["fragile"])}

# --- all other gates from WS4 numbers ---
cm = diag["contour"]
excess = {v: {"p95": cm[v]["excessP95"],
              "pass": bool(cm[v]["excessP95"] <= 4.0)} for v in V6}
roots = diag["rootProx"]["all"]
dropped_n = sum(stats["droppedTouch"].values())
single = {"nComponents": diag["components"]["nComponents"],
          "largestFrac": diag["components"]["largestFrac"],
          "droppedTouchVox": dropped_n,
          "droppedTouchFrac": round(dropped_n / max(1, stats["keptFinal"]), 5),
          "pass": bool(diag["components"]["nComponents"] == 1
                       and dropped_n <= 0.001 * stats["keptFinal"])}
beyond = {v: int(round(pa[v]["hairlikeN"]
                       * (1.0 - pa[v]["hairlikeDistToMask"]["fracWithin3px"])))
          for v in ("front", "three_quarter", "profile_90", "back")}
dome = bool(roots["fracWithin6mm"] >= 0.95
            and diag["thickness"]["crown"]["p50"] >= 8.0)
mismatch = {"hairlikeBeyond3px": beyond, "maxBeyond": max(beyond.values()),
            "domeCoveredNoShell": dome, "pass": bool(max(beyond.values()) <= 15
                                                    and dome)}
hd_back = ndi.binary_dilation(bsplat["back"], iterations=1)
sym = H2.sym_ratio(hd_back)
sym_raw = H2.sym_ratio(bsplat["back"])
backsym = {"L_over_R": sym["L_over_R"], "raw": sym_raw["L_over_R"],
           "pass": bool(0.9 <= sym["L_over_R"] <= 1.1)}
below = diag["belowShoulder"]
side = {"sideL": below["sideL"]["vox"], "sideR": below["sideR"]["vox"],
        "L_over_R": round(below["sideL"]["vox"] / max(1, below["sideR"]["vox"]), 4),
        "pass": bool(0.8 <= below["sideL"]["vox"] / max(1, below["sideR"]["vox"]) <= 1.25)}
occ = np.array(h5["occupancy"])
fl = occ[::-1, :, :]
miou = round(float((occ & fl).sum()) / max(1, float((occ | fl).sum())), 4)
earpass = all(c.get("pass_le20", True) for v in ("front", "three_quarter",
                                                 "profile_90")
              for c in (ear["coverage"][v][e]
                        for e in ("earXneg", "earXpos")) if c.get("visible"))
earcov = {"pass": bool(earpass),
          "maxVisibleFrac": max(c["coverageFrac"] for v in
                                ("front", "three_quarter", "profile_90")
                                for e in ("earXneg", "earXpos")
                                for c in [ear["coverage"][v][e]]
                                if c.get("visible")),
          "clearanceMinMm": ear["clearanceMm"]["overall_min_mm"]}

out = {"provenance": "hull5 occupancy == hull4 WS/baseline_kept final",
       "keptFinal": stats["keptFinal"], "volMm3": diag["volMm3"],
       "excess": excess, "roots": roots, "single": single,
       "mismatch": mismatch, "backsym": backsym, "side": side,
       "volMirrorIoU": miou, "ear": earcov,
       "sens1mm": gate_1mm,
       "sensRedefined_i": gate_i, "sensRedefined_ii": gate_ii,
       "sensRedefined_iii": gate_iii,
       "sensOldUndil": {"maxDelta": sens["undilated"]["maxContourDeltaPx"],
                        "fragile": sens["undilated"]["fragile"]}}
overall = all([all(v["pass"] for v in excess.values()),
               roots["fracWithin6mm"] >= 0.95, single["pass"],
               mismatch["pass"], gate_1mm["pass"], gate_i["pass"],
               gate_ii["pass"], backsym["pass"], earcov["pass"], side["pass"]])
out["overallPass"] = bool(overall)
(WS5 / "rescore.json").write_text(json.dumps(out, indent=1))
print(json.dumps({"excess": {k: v["p95"] for k, v in excess.items()},
                  "roots": roots["fracWithin6mm"], "single": single,
                  "mismatch": mismatch, "sens1mm": gate_1mm,
                  "gate_i": gate_i, "gate_ii_fragile": fragile_nh,
                  "backsym": backsym, "side": side, "miou": miou,
                  "ear": earcov, "overall": bool(overall)}, indent=1),
      flush=True)
