#!/usr/bin/env python3
"""Shared backface-aware hide selector (e9-r1b B1/B2 simulator core, no id lists).

Real-render semantics: openclinxr_hidden_* prim8 is DISCARDED (transparent), so
post-hide first-hit skips prim8. A post hit counts as see-through when it is a
miss, any hidden, or a BACK-FACING body triangle (dot(ray, normal) > 0).
New see-through = pre skin-frontface AND post hole.
Greedy: drop every flagged tri that is the pre first-hit of any newsee px,
re-run until stable.
"""
import numpy as np
import garment_coverage as gc


def slab_enter(O, D, mn, mx):
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = (mn - O) / D
        t2 = (mx - O) / D
        tmin = np.minimum(t1, t2).max(axis=1)
        tmax = np.maximum(t1, t2).min(axis=1)
    ok = tmax >= np.maximum(tmin, 0)
    return np.where(ok, np.maximum(tmin, 0), np.inf)


def classify_full(G, O, D):
    """G: list of {V (N,3), F (M,3), mat, is_body, is_shirt}. Returns t,c,body,tri,win,back."""
    n = len(O)
    bt = np.full(n, np.inf)
    bc = np.zeros(n, dtype=np.int64)
    bb = np.zeros(n, dtype=bool)
    btri = np.full(n, -1, dtype=np.int64)
    win = np.full(n, -1, dtype=np.int64)
    for gi, g in enumerate(G):
        T = g["V"][g["F"]]
        if len(T) == 0:
            continue
        mn = T.reshape(-1, 3).min(axis=0)
        mx = T.reshape(-1, 3).max(axis=0)
        ent = slab_enter(O, D, mn, mx)
        idx = np.where((ent < bt) & np.isfinite(ent))[0]
        if len(idx) == 0:
            continue
        t2, a2 = gc._ray_tri_arghits(O[idx], D[idx], T, 100.0)
        bet = np.isfinite(t2) & (t2 < bt[idx])
        bi = idx[bet]
        bt[bi] = t2[bet]
        hid = ("hidden" in g["mat"])
        if g["is_shirt"]:
            bc[bi] = 2
        elif hid:
            bc[bi] = 4
        elif g["is_body"]:
            bc[bi] = 1
        else:
            bc[bi] = 3
        bb[bi] = g["is_body"]
        btri[bi] = a2[bet]
        win[bi] = gi
    back = np.zeros(n, dtype=bool)
    for gi, g in enumerate(G):
        if not g["is_body"]:
            continue
        m = (win == gi) & (btri >= 0)
        if not m.any():
            continue
        T = g["V"][g["F"]][btri[m]]
        nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
        back[m] = ((nrm * D[m]).sum(axis=1) > 0)
    return bt, bc, bb, btri, win, back


def greedy_safe(preG, rays, flagged, body0_key=("body", 0)):
    """preG: grade-space prim list with 'mesh','pi'; rays: list of (O, D, cand_idx or None);
    flagged: sorted array of body0 meta tri ids. Returns (safe, dropped, rounds)."""
    hide = np.array(sorted(set(int(t) for t in flagged)), dtype=np.int64)
    all_resp = set()
    rounds = []
    # locate body0 in preG
    b0 = next(i for i, g in enumerate(preG) if g["mesh"].endswith("_body") and g["pi"] == 0)
    for rnd in range(5):
        total = 0
        resp = set()
        per = {}
        for name, (O, D) in rays.items():
            pt, pc, _, ptri, pwin, pback = classify_full(preG, O, D)
            G2 = []
            for g in preG:
                if g["mesh"].endswith("_body") and g["pi"] == 0:
                    keep = np.ones(len(g["F"]), bool)
                    keep[np.array(sorted(hide), dtype=np.int64)] = False
                    G2.append({"mesh": g["mesh"], "pi": g["pi"], "V": g["V"], "F": g["F"][keep],
                               "mat": g["mat"], "is_body": True, "is_shirt": False,
                               "keep": np.where(keep)[0]})
                else:
                    G2.append(g)
            bt, bc, bb, btri, win, back = classify_full(G2, O, D)
            pre_front = (pc == 1) & (~pback)
            post_hole = (bc == 0) | (bc == 4) | (bb & back)
            ns = pre_front & post_hole
            r = set(int(t) for t in ptri[ns & (pwin == b0)] if int(t) >= 0)
            resp.update(r)
            total += int(ns.sum())
            per[name] = int(ns.sum())
        rounds.append({"round": rnd, "hide_n": int(len(hide)), "newsee": total, "resp_n": len(resp), "per_view": per})
        if total == 0:
            break
        hide = np.array(sorted(set(hide.tolist()) - resp), dtype=np.int64)
        all_resp.update(resp)
        if len(resp) == 0:
            break
    return np.array(sorted(hide.tolist()), dtype=np.int64), sorted(all_resp), rounds


def match_meta_to_glb(doc_prims, meta):
    """Match meta meshes to GLB prims by (material, vert count).

    doc_prims: list of {mesh, pi, mat, verts} in GLB order.
    Returns list (meta order) of (mesh, pi). Asserts exactly one match each.
    """
    match = []
    used = set()
    for m in meta["meshes"]:
        cands = [(d["mesh"], d["pi"]) for d in doc_prims
                 if d["mat"] == m["mat"] and d["verts"] == m["verts"]
                 and (d["mesh"], d["pi"]) not in used]
        assert len(cands) == 1, f"meta ambiguous: {m['name']} -> {cands}"
        match.append(cands[0])
        used.add(cands[0])
    return match


def pregs_for_frame(meshes, voff, vcount, frame_grade, per_mesh_index,
                    is_body, is_shirt):
    """Build grade-space prim list for one frame.

    frame_grade: (TOTALV,3) grade-space verts in meta order.
    Body entry F is the FULL meta tri table (local index == meta tri id).
    """
    out = []
    for j in range(len(meshes)):
        out.append({"mesh": meshes[j]["name"], "pi": 0,
                    "V": frame_grade[voff[j]:voff[j] + vcount[j]],
                    "mat": meshes[j]["mat"], "F": per_mesh_index[j],
                    "is_body": is_body[j], "is_shirt": is_shirt[j]})
    return out


def _body0_index(preG):
    b0 = [i for i, g in enumerate(preG)
          if g["mesh"].endswith("_body") and g["pi"] == 0]
    assert len(b0) == 1, f"body0 ambiguous: {b0}"
    return b0[0]


def greedy_over_frames(frames, flagged, origins, rays, start=None,
                        max_rounds=500, log=None, on_round=None,
                        on_combo=None, start_round=0):
    """Greedy responsibility-drop over bind + posed frames.

    frames: list of (name, preG); preG entries {mesh,pi,V,F,mat,is_body,
      is_shirt}, body0 F in meta-tri-id space.
    flagged: full rule-flagged body0 tri ids (default start).
    start: initial hide set (subset of flagged); default flagged.
    origins: {view: (3,)} ray origins; rays: {view: (N,3)} full-frame dirs.
    on_combo: optional fn(combo_idx, combo_name, newsee_or_None) called once
      per frame x view combo (progress only; no effect on results).
    start_round: round number label for the first computed round (resume only;
      no effect on results).
    Per round and combo, candidates = rays hitting current-hide faces only
    (sound: post differs from pre only by hide-tri removal), then full
    pre/post classify on candidates. resp = pre body0 tri ids of newsee rays
    (always within hide: a newsee ray's pre first-hit must be a removed tri).
    Returns (safe, dropped, rounds); rounds[i] holds per_combo newsee counts
    and resp_by_frame {id: [combo, ...]}.
    """
    hide = np.array(sorted(set(int(t) for t in
                                (flagged if start is None else start))),
                    dtype=np.int64)
    flagged_set = set(int(t) for t in flagged)
    assert set(hide.tolist()) <= flagged_set, "start must be a subset of flagged"
    all_resp = set()
    rounds = []
    rnd = start_round
    ci = [0]

    def _cb(combo, n):
        if on_combo is not None:
            on_combo(ci[0], combo, n)
        ci[0] += 1
    while True:
        total = 0
        resp = set()
        per_combo = {}
        resp_by_frame: dict = {}
        ci[0] = 0
        for fname, preG in frames:
            b0 = _body0_index(preG)
            bV = preG[b0]["V"]
            bF = preG[b0]["F"]
            hide_faces = bV[bF[np.asarray(hide, dtype=np.int64)]] \
                if len(hide) else np.zeros((0, 3, 3))
            if len(hide):
                mn = hide_faces.reshape(-1, 3).min(axis=0)
                mx = hide_faces.reshape(-1, 3).max(axis=0)
            for view, D in rays.items():
                combo = f"{fname}:{view}"
                O = np.broadcast_to(origins[view], D.shape)
                if len(hide) == 0:
                    per_combo[combo] = 0
                    _cb(combo, 0)
                    continue
                ent = slab_enter(O, D, mn, mx)
                c0 = np.where(np.isfinite(ent))[0]
                if len(c0) == 0:
                    per_combo[combo] = 0
                    _cb(combo, 0)
                    continue
                Oc0 = np.broadcast_to(origins[view], (len(c0), 3)).copy()
                tt, _ = gc._ray_tri_arghits(Oc0, D[c0], hide_faces, 100.0)
                cand = c0[np.isfinite(tt)]
                if len(cand) == 0:
                    per_combo[combo] = 0
                    _cb(combo, 0)
                    continue
                Oc = np.broadcast_to(origins[view], (len(cand), 3)).copy()
                Dc = D[cand]
                pt, pc, _, ptri, pwin, pback = classify_full(preG, Oc, Dc)
                G2 = []
                for g in preG:
                    if g["mesh"].endswith("_body") and g["pi"] == 0:
                        keep = np.ones(len(g["F"]), bool)
                        keep[np.asarray(hide, dtype=np.int64)] = False
                        G2.append({"mesh": g["mesh"], "pi": g["pi"], "V": g["V"],
                                   "F": g["F"][keep], "mat": g["mat"],
                                   "is_body": True, "is_shirt": False})
                    else:
                        G2.append(g)
                _, bc, bb, _, _, back = classify_full(G2, Oc, Dc)
                pre_front = (pc == 1) & (~pback)
                post_hole = (bc == 0) | (bc == 4) | (bb & back)
                ns = pre_front & post_hole
                n = int(ns.sum())
                per_combo[combo] = n
                _cb(combo, n)
                total += n
                r = set(int(t) for t in ptri[ns & (pwin == b0)])
                resp.update(r)
                for t in r:
                    resp_by_frame.setdefault(t, []).append(combo)
        assert resp <= flagged_set, f"resp outside flagged: {sorted(resp - flagged_set)[:5]}"
        assert resp <= set(hide.tolist()), \
            f"resp outside hide: {sorted(resp - set(hide.tolist()))[:5]}"
        rounds.append({"round": rnd, "hide_n": int(len(hide)), "newsee": total,
                       "resp_n": len(resp), "per_combo": per_combo,
                       "resp_by_frame": {str(k): sorted(v)
                                         for k, v in sorted(resp_by_frame.items())}})
        if log is not None:
            log(f"round {rnd}: hide={len(hide)} newsee={total} resp={len(resp)}")
        if on_round is not None:
            on_round(rounds[-1], [int(t) for t in hide])
        if total == 0:
            break
        hide = np.array(sorted(set(hide.tolist()) - resp), dtype=np.int64)
        all_resp.update(resp)
        rnd += 1
        if rnd >= max_rounds:
            raise RuntimeError(f"no convergence after {max_rounds} rounds")
    return (np.array(sorted(hide.tolist()), dtype=np.int64),
            sorted(all_resp), rounds)
