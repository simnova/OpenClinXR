#!/usr/bin/env python3
"""STEP 2 (hair-transport2) children-only transport variants (guides untouched).

Variants (all K=5, same frames/populations/length-restore/tip-fade as geo7):
  r1 = transport for curtain-region children only, all others bit-identical a1.
  r2 = transport for ALL children + per-point lateral renormalisation.
  r3 = r1 + renormalisation for the transported (curtain) children.

Renormalisation (reviewer Fable): each transported child's in-sheet (world-x,
lateral) offset is reset at every arc point to its root offset magnitude:
  off_x(j) = sign(off_x(j) or dx_root) * |dx_root|,
where dx_root = child_root_x - blended-guide-root_x and off(j) is the
post-blend, post-tip-fade transported offset. Tangents (y/z) keep the
transported direction field; only lateral magnitude is restored, countering
the tip-fade's pull toward the guide average. The existing strict end clamp
is applied to transported children only, so rear children in r1/r3 stay
bit-identical to a1 until the Blender collider audit.

Collider audit + end treatment: existing geo7 repair.py flow (repair_outside
x3 w/ strict clamp + final repair) via E/repair.py in Blender.

System python (numpy only). Writes cells/<tag>/{strands_raw.npz,loft_meta.json}.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
GEO7 = ROOT / "tools/openclinxr/evidence/hair-geo7"
sys.path.insert(0, str(GEO7))
import frame_transport as FT  # noqa: E402

K = 5
CH = 4096


def build(tag: str, curtain_only: bool, renorm: bool) -> dict:
    gd = np.load(FT.GUIDES)
    gpts = np.asarray(gd["points"], float)
    groots = np.asarray(gd["roots"], float)
    cap = np.load(FT.CAP)
    cx = float(cap["cx"])
    scalp_center = np.array([cx, float(cap["Cy"]), float(cap["Cz"])])
    a1 = np.load(FT.A1)
    croots = np.asarray(a1["roots"], float)
    corig = np.asarray(a1["points"], float)
    radii = np.asarray(a1["radii"])
    apex_y = float(np.asarray(a1["apex_y"]))

    curtain = FT.curtain_guide_mask(groots, np.asarray(gd["liftoff"]),
                                    np.asarray(gd["frontal_drape"]), cx, float(cap["Cy"]))
    side_c = croots[:, 0] >= cx
    side_g = groots[:, 0] >= cx
    is_curtain_child = np.zeros(len(croots), bool)
    for s in range(0, len(croots), CH):
        take = slice(s, s + CH)
        for side in (False, True):
            ids = np.flatnonzero(side_c[take] == side)
            if not len(ids):
                continue
            gc = np.flatnonzero(curtain & (side_g == side))
            gr = np.flatnonzero(~curtain & (side_g == side))
            dc = np.linalg.norm(croots[take][ids, None, :] - groots[gc][None, :, :], axis=2).min(axis=1)
            dr = np.linalg.norm(croots[take][ids, None, :] - groots[gr][None, :, :], axis=2).min(axis=1)
            is_curtain_child[np.arange(s, s + len(side_c[take]))[ids]] = (dr - dc) >= 0.0
    print(f"guides={len(gpts)} curtain={curtain.sum()} children={len(croots)} "
          f"curtain_region={is_curtain_child.sum()} rear_region={(~is_curtain_child).sum()}", flush=True)

    normals = groots - scalp_center[None, :]
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    F = np.stack([FT.transport(gpts[j], normals[j]) for j in range(len(gpts))]).astype(np.float64)

    L_orig = FT.arc_lengths(corig)[:, -1]
    gu = FT.arc_lengths(gpts)
    gu = gu / np.maximum(gu[:, -1, None], 1e-9)
    fade_g = 1.0 - FT.smooth01((gu - FT.FADE_START) / (1.0 - FT.FADE_START))

    transported = is_curtain_child if curtain_only else np.ones(len(croots), bool)
    new = np.empty_like(corig)
    new[~transported] = corig[~transported]  # untouched population stays a1
    for s in range(0, len(croots), CH):
        take = np.arange(s, min(s + CH, len(croots)))
        C = len(take)
        near = np.empty((C, K), np.int64)
        w = np.empty((C, K))
        for side in (False, True):
            ids = np.flatnonzero(side_c[take] == side)
            if not len(ids):
                continue
            for ii in ids:
                pop = np.flatnonzero(((curtain & is_curtain_child[take[ii]])
                                      | (~curtain & ~is_curtain_child[take[ii]])) & (side_g == side))
                d = np.linalg.norm(groots[pop] - croots[take[ii]], axis=1)
                k = min(K, len(pop))
                part = np.argpartition(d, k - 1)[:k]
                order = np.argsort(d[part])
                near[ii, :k] = pop[part[order]]
                dd = d[part[order]]
                if k < K:
                    near[ii, k:] = near[ii, 0]
                    dd = np.concatenate([dd, np.full(K - k, dd[0] + 1e-3)])
                wi = 1.0 / np.maximum(dd, 1e-6)
                w[ii] = wi / wi.sum()
        G = gpts[near]
        Fk = F[near]
        delta = np.einsum("ckij,ckj->cki", np.transpose(Fk[:, :, 0, :, :], (0, 1, 3, 2)),
                          croots[take][:, None, :] - groots[near])
        off = np.einsum("ckpij,ckj->ckpi", Fk, delta)
        off *= fade_g[near][..., None]
        lofts = G + off
        blend = np.einsum("ck,ckpi->cpi", w, lofts)
        if renorm:
            grows = np.einsum("ck,ck->c", w, G[:, :, 0, 0])
            dx_root = croots[take][:, 0] - grows
            ox = blend[..., 0] - np.einsum("ck,ck->c", w, G[:, :, 0, 0])[:, None]
            sgn = np.sign(ox)
            zero = sgn == 0.0
            sgn[zero] = np.broadcast_to(np.sign(dx_root)[:, None], sgn.shape)[zero]
            blend[..., 0] = np.einsum("ck,ck->c", w, G[:, :, 0, 0])[:, None] + sgn * np.abs(dx_root)[:, None]
        blend[:, 0, :] = croots[take]
        Lb = FT.arc_lengths(blend)[:, -1]
        scale = L_orig[take] / np.maximum(Lb, 1e-9)
        grown = croots[take][:, None, :] + (blend - croots[take][:, None, :]) * scale[:, None, None]
        tmask = transported[take]
        new[take[tmask]] = grown[tmask]
        print(f"  chunk {s}/{len(croots)}", flush=True)
    # Existing strict end treatment on transported children only.
    sub = FT.clamp_ends_vertical(new[transported])
    new[transported] = sub

    cell = HERE / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cell / "strands_raw.npz",
                        points=new.astype(np.float32), roots=croots.astype(np.float32),
                        radii=radii, apex_y=np.array(apex_y), cx=np.array(cx))
    meta = {"K": K, "variant": tag, "curtainOnly": bool(curtain_only), "renormalised": bool(renorm),
            "method": "frame-transport loft + IDW blend + length-restore (geo7 replica)",
            "renorm": ("post-blend post-fade lateral reset: off_x(j) = sign * |root_x - guideblend_root_x|"
                       if renorm else None),
            "untouchedPopulation": ("rear-region children bit-identical to a1 pre-audit"
                                    if curtain_only else None),
            "curtainChildren": int(is_curtain_child.sum()), "rearChildren": int((~is_curtain_child).sum()),
            "transportedChildren": int(transported.sum()),
            "lengthRestore": "per-strand scale to a1 arc length about the root (transported only)",
            "endTreatment": "strict clamp_ends_vertical on transported children only",
            "guides": "guides16.npz untouched"}
    (cell / "loft_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"WROTE {cell / 'strands_raw.npz'}", flush=True)
    return meta


if __name__ == "__main__":
    want = set(sys.argv[1:]) or {"r1", "r2", "r3"}
    for _tag, _co, _rn in (("r1", True, False), ("r2", False, True), ("r3", True, True)):
        if _tag not in want:
            continue
        print(f"=== {_tag} curtain_only={_co} renorm={_rn} ===", flush=True)
        print(json.dumps(build(_tag, _co, _rn), indent=2), flush=True)
