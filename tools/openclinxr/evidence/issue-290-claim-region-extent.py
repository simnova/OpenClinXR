#!/usr/bin/env python3
"""issue-290 — claim region EXTENT measurement.

#289 established that the garment claim region is internally consistent: every face
inside each garment's claim region is either hidden (alpha-0 mask) or behind cloth
(`noGarmentNearby = 0` on four body/slot pairs). This slice measures whether the
claim is the right SIZE, without proposing any target extent and without changing
any threshold (standing rule: no numeric threshold enters a contract until it has
been run against the population and published — this publishes the table).

Per body class x slot it computes, reusing the SHARED pure-numpy predicates from
`garment_coverage.py` (the same module the `body_param_stage.py` factory gate
imports), exactly as the evidence module `garment-covers-its-region.ts` drives them:

  - the claim region's vertical band and per-slice lateral footprint, in body-height
    fractions (region definition: faces whose centroid height is inside the garment's
    full Y extent AND whose centroid |x| is inside the garment's own per-slice
    silhouette — the issue-283 corrected claim);
  - the body-surface faces IMMEDIATELY OUTSIDE each boundary (above band, below band,
    lateral past the silhouette) with their height/lateral position;
  - which of those outside faces the DEFAULT CAPTURE CAMERA sees (facing + frustum +
    occlusion against every skinned humanoid triangle in the scene, transformed by
    each actor's live world placement matrix).

The camera pose and actor placements are read LIVE from the ui-xr scene
(`window.__openClinXrDebugScene`) by the TS driver and passed in via the manifest;
the geometry itself is the shipped GLB (bind pose), so the only pose approximation is
that the clinical-idle pose displaces limbs ~1-3 cm from bind pose (residual, stated
in the artifact).

claimScope: the vertical/lateral EXTENT of the garment claim region on the two shipped
body-param library bodies, and the camera-visible bare-skin census immediately outside
it at the default scene-overview capture camera.
notEvidenceFor: garment aesthetics/quality, clinical wardrobe correctness, Quest
readiness, cloth physics/deformation, any target extent recommendation.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "asset-pipeline" / "makeclothes"))
import garment_coverage as gc  # noqa: E402  (shared predicate; read-only)

# Ring widths for "immediately outside" the claim boundary.
RING_VERTICAL_FRACTION = 0.08          # 8% of body height above/below the band
RING_LATERAL_METERS = gc.RAY_TOLERANCE_M  # 0.06 m past the garment silhouette
HIDE_EPSILON_M = gc.HIDE_EPSILON_M      # 5 mm — the #285 hide-mask band
OCCLUSION_EPS_M = 1e-4                 # ray-hit strictly-before-centroid margin
MAX_FULL_OUTSIDE_RAY_SAMPLE = 4096     # full-outside occlusion sample cap (ring is exact)
N_SLICES = 24                          # matches garment_coverage._lateral_footprint default


def load_mesh(path: str) -> tuple[np.ndarray, np.ndarray]:
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    v = np.asarray(d["position"], dtype=float).reshape(-1, 3)
    f = np.asarray(d["indices"], dtype=np.int64).reshape(-1, 3)
    return v, f


def mat4_from_three_elements(elements: list[float]) -> np.ndarray:
    """three.js matrixWorld.elements (column-major) -> row-major numpy (4,4)."""
    return np.asarray(elements, dtype=float).reshape(4, 4).T


def apply_mat(M: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Apply a 4x4 affine (column-vector convention) to (N,3) points."""
    p = np.concatenate([pts, np.ones((len(pts), 1))], axis=1) @ M.T
    return p[:, :3] / p[:, 3:4]


def quat_to_rot(q: list[float]) -> np.ndarray:
    """three.js quaternion (x,y,z,w) -> 3x3 world rotation (camera local->world)."""
    x, y, z, w = (float(v) for v in q)
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def build_view_proj(cam_pos, cam_quat, fov_deg, aspect, near=0.1, far=100.0):
    """Camera world pose -> (view (4,4), proj (4,4)). Camera looks down local -Z."""
    R = quat_to_rot(cam_quat)  # camera local -> world
    Rt = R.T
    t = -Rt @ np.asarray(cam_pos, dtype=float)
    view = np.eye(4)
    view[:3, :3] = Rt
    view[:3, 3] = t
    f = 1.0 / math.tan(math.radians(float(fov_deg)) / 2.0)
    proj = np.zeros((4, 4))
    proj[0, 0] = f / float(aspect)
    proj[1, 1] = f
    proj[2, 2] = (far + near) / (near - far)
    proj[2, 3] = 2.0 * far * near / (near - far)
    proj[3, 2] = -1.0
    return view, proj


def signed_clearance_for_faces(
    bv: np.ndarray,
    bf: np.ndarray,
    garment_meshes: list[tuple[np.ndarray, np.ndarray]],
    fidx: np.ndarray,
    max_search_m: float = gc.SIGNED_SEARCH_M,
    hide_epsilon_m: float = HIDE_EPSILON_M,
) -> tuple[np.ndarray, int]:
    """Per-face signed clearance (min over 3 vertices) to the union of garment
    surfaces. Sign follows the BODY outward normal (the #285/#289 convention —
    garment normals are degenerate on export, measured). Returns
    (per_face_clearance, covered_face_count) where covered = clearance < eps."""
    if len(fidx) == 0:
        return np.array([], dtype=float), 0
    # Concatenate all garment surfaces into one vertex/triangle set.
    g_verts = []
    g_faces = []
    for gv, gf in garment_meshes:
        base = len(g_verts)
        g_verts.extend(gv.tolist())
        g_faces.extend((gf + base).tolist())
    gv = np.asarray(g_verts, dtype=float)
    gf = np.asarray(g_faces, dtype=np.int64)
    if len(gv) == 0:
        return np.full(len(fidx), np.nan), 0

    gw, gfw = gc.weld_by_position(gv, gf)
    tri_list = gw[gfw]
    vert_to_tris: list[list[int]] = [[] for _ in range(len(gw))]
    for ti in range(len(gfw)):
        for vi in gfw[ti]:
            vert_to_tris[int(vi)].append(ti)

    cell = 0.01
    grid: dict[tuple[int, int, int], list[int]] = {}
    for i, p in enumerate(gw):
        key = (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)), int(math.floor(p[2] / cell)))
        grid.setdefault(key, []).append(i)

    normals = gc._orient_outward(bv, bf)
    face_verts = bv[bf[fidx]]
    pts = face_verts.reshape(-1, 3)
    sample_normals = np.repeat(normals[fidx], 3, axis=0)
    n = len(pts)
    max_cells = int(math.ceil(max_search_m / cell)) + 1
    clearance = np.full(n, np.nan)
    for block in range(0, n, 512):
        bl = pts[block : block + 512]
        bnorm = sample_normals[block : block + 512]
        nb = len(bl)
        cand_v: list[list[int]] = [[] for _ in range(nb)]
        for bi, p in enumerate(bl):
            cx, cy, cz = (
                int(math.floor(p[0] / cell)),
                int(math.floor(p[1] / cell)),
                int(math.floor(p[2] / cell)),
            )
            seen: set[int] = set()
            for r in range(0, max_cells + 1):
                found_any = False
                for dx in range(-r, r + 1):
                    for dy in range(-r, r + 1):
                        for dz in range(-r, r + 1):
                            if max(abs(dx), abs(dy), abs(dz)) != r:
                                continue
                            for j in grid.get((cx + dx, cy + dy, cz + dz), ()):
                                if j not in seen:
                                    seen.add(j)
                                    found_any = True
                if r >= 1 and found_any:
                    break
            cand_v[bi] = list(seen)
        counts = np.array([len(c) for c in cand_v], dtype=np.int64)
        if counts.sum() == 0:
            continue
        offsets = np.concatenate(([0], np.cumsum(counts)))
        flat_c = np.concatenate([np.asarray(c, dtype=np.int64) for c in cand_v])
        delta = gw[flat_c] - np.repeat(bl, counts, axis=0)
        d2v = np.sum(delta * delta, axis=1)
        k = 6
        best_s = np.full(nb, np.inf)
        for bi in range(nb):
            lo, hi = int(offsets[bi]), int(offsets[bi + 1])
            if lo == hi:
                continue
            sub = np.argsort(d2v[lo:hi])[:k]
            tris: set[int] = set()
            for vi in flat_c[lo:hi][sub]:
                tris.update(vert_to_tris[int(vi)])
            if not tris:
                continue
            tarr = np.asarray(sorted(tris), dtype=np.int64)
            p3 = np.broadcast_to(bl[bi][None, :], (len(tarr), 3)).copy()
            q, d2q = gc._closest_points_on_triangles(p3, tri_list[tarr])
            best_j = int(np.argmin(d2q))
            if d2q[best_j] <= max_search_m * max_search_m:
                best_s[bi] = -np.dot(p3[best_j] - q[best_j], bnorm[bi])
        clearance[block : block + nb] = best_s
    per_face = clearance.reshape(len(fidx), 3).min(axis=1)
    covered = int((per_face < hide_epsilon_m).sum())
    return per_face, covered


def census_boundary(
    bv: np.ndarray,
    bf: np.ndarray,
    cents: np.ndarray,
    body_min: np.ndarray,
    body_height: float,
    band_lo: float,
    band_hi: float,
    footprint: np.ndarray,
    face_set: np.ndarray,
    ring_mask: np.ndarray,
    label: str,
):
    """Summarise a boundary's outside faces: count + height/lateral position.

    Positions in body-height fractions: heightFraction = (cy - bodyMinY)/bodyHeight;
    lateralFraction = |cx|/bodyHeight (the issue asks for both in body-height
    fractions; meters are reported alongside where useful).
    """
    if len(face_set) == 0:
        return {
            "boundary": label,
            "faceCount": 0,
            "ringFaceCount": 0,
            "heightFraction": {"mean": None, "min": None, "max": None},
            "lateralFraction": {"mean": None, "max": None},
        }
    c = cents[face_set]
    hf = (c[:, 1] - body_min[1]) / body_height
    lf = np.abs(c[:, 0]) / body_height
    return {
        "boundary": label,
        "faceCount": int(len(face_set)),
        "ringFaceCount": int(ring_mask.sum()),
        "heightFraction": {
            "mean": round(float(hf.mean()), 4),
            "min": round(float(hf.min()), 4),
            "max": round(float(hf.max()), 4),
        },
        "lateralFraction": {
            "mean": round(float(lf.mean()), 4),
            "max": round(float(lf.max()), 4),
        },
    }


def camera_classify(
    face_idx: np.ndarray,
    cents: np.ndarray,
    normals: np.ndarray,
    M: np.ndarray,
    cam_pos: np.ndarray,
    view: np.ndarray,
    proj: np.ndarray,
    own_garment_tris_w: np.ndarray,
    all_humanoid_tris_w: np.ndarray,
    max_rays: int,
):
    """5-way camera partition for faces: visible / outsideFrustum / backFacing /
    occludedByGarment / occludedByBodyOrOther.

    World frame: faces transformed by the actor placement matrix M. Visibility =
    in frustum AND front-facing AND no humanoid triangle hit strictly before the
    centroid along the camera ray. own_garment_tris_w = this figure's garment +
    footwear triangles (world); all_humanoid_tris_w = every skinned mesh of every
    actor in the scene (world) — the honest "does the learner see it" occluder set.
    """
    empty = {"visible": 0, "outsideFrustum": 0, "backFacing": 0, "occludedByGarment": 0,
             "occludedByBodyOrOther": 0, "sampledFaceCount": 0, "occlusionSampled": False}
    if len(face_idx) == 0:
        return empty
    n = len(face_idx)
    sample = face_idx if n <= max_rays else face_idx[:: max(1, n // max_rays)]
    sampled = len(sample) != n
    cw = apply_mat(M, cents[sample])
    # Normal transform: inverse-transpose of the linear part (correct under the
    # runtime's non-uniform placement scale, e.g. (0.85, 0.8545, 0.85) measured on
    # the live parent), then normalized.
    lin = M[:3, :3]
    nw = normals[sample] @ np.linalg.inv(lin).T
    nnorm = np.linalg.norm(nw, axis=1, keepdims=True)
    nw = nw / (nnorm + 1e-12)

    to_cam = cam_pos[None, :] - cw
    facing = np.sum(nw * to_cam, axis=1) > 0.0

    # frustum: project to NDC
    h = np.concatenate([cw, np.ones((len(cw), 1))], axis=1)
    clip = h @ view.T @ proj.T
    w = clip[:, 3:4]
    with np.errstate(divide="ignore", invalid="ignore"):
        ndc = clip[:, :3] / w
    in_frustum = (w[:, 0] > 0) & (np.abs(ndc[:, 0]) <= 1.0) & (np.abs(ndc[:, 1]) <= 1.0) & (np.abs(ndc[:, 2]) <= 1.0)

    t_c = np.linalg.norm(to_cam, axis=1)
    dirs = to_cam / (t_c[:, None] + 1e-12)

    # occlusion: any humanoid tri hit < t_c - eps; garment-specific: own garments only.
    occ_any = np.zeros(len(cw), dtype=bool)
    occ_garment = np.zeros(len(cw), dtype=bool)
    if len(all_humanoid_tris_w) > 0:
        hits = gc._ray_tri_hits(cw, dirs, all_humanoid_tris_w, max_t=100.0)
        occ_any = np.isfinite(hits) & (hits < t_c - OCCLUSION_EPS_M)
    if len(own_garment_tris_w) > 0:
        hits_g = gc._ray_tri_hits(cw, dirs, own_garment_tris_w, max_t=100.0)
        occ_garment = np.isfinite(hits_g) & (hits_g < t_c - OCCLUSION_EPS_M)

    code = np.zeros(len(cw), dtype=np.int64)
    code[~in_frustum] = 1
    code[in_frustum & ~facing] = 2
    code[in_frustum & facing & occ_garment] = 3
    code[in_frustum & facing & ~occ_garment & occ_any] = 4
    visible = in_frustum & facing & ~occ_any

    counts = {
        "visible": int(visible.sum()),
        "outsideFrustum": int((code == 1).sum()),
        "backFacing": int((code == 2).sum()),
        "occludedByGarment": int((code == 3).sum()),
        "occludedByBodyOrOther": int((code == 4).sum()),
        "sampledFaceCount": int(len(cw)),
        "occlusionSampled": sampled,
    }
    return counts


def compute_figure(manifest: dict, fig: dict) -> dict:
    bv, bf = load_mesh(fig["bodyMeshPath"])
    body_min = bv.min(axis=0)
    body_max = bv.max(axis=0)
    body_height = float(body_max[1] - body_min[1])

    normals = gc._orient_outward(bv, bf)
    tri_verts = bv[bf]
    cents = tri_verts.mean(axis=1)

    M = mat4_from_three_elements(fig["matrixWorldElements"])

    # Garment meshes with their slot labels (upper/lower/footwear are all occluders
    # for the camera test; upper/lower are the claim slots).
    garments = []
    for gm in fig["garmentMeshes"]:
        gv, gf = load_mesh(gm["path"])
        garments.append({**gm, "verts": gv, "faces": gf})

    cam = manifest["camera"]
    cam_pos = np.asarray(cam["position"], dtype=float)
    view, proj = build_view_proj(cam["position"], cam["quaternion"], cam["fov"], cam["aspect"])

    # World occluder soup: every skinned humanoid mesh of every actor. For the
    # SUBJECT actor, the subject's own garment/footwear triangles are separated so
    # `occludedByGarment` (skin behind this figure's own cloth) is distinct from
    # `occludedByBodyOrOther` (self-occlusion by the figure's body, or any other
    # actor's geometry in the way of the camera ray).
    all_w_tris = []
    own_w_garment_tris = []
    for actor in manifest["actors"]:
        Ma = mat4_from_three_elements(actor["matrixWorldElements"])
        for om in actor["occluderMeshes"]:
            ov, of = load_mesh(om["path"])
            wv = apply_mat(Ma, ov)
            all_w_tris.append(wv[of])
            if actor.get("isSubject", False) and om.get("kind") in ("garment", "footwear"):
                own_w_garment_tris.append(wv[of])
    all_humanoid_tris_w = (
        np.concatenate(all_w_tris, axis=0) if all_w_tris else np.zeros((0, 3, 3), dtype=float)
    )
    own_garment_tris_w = (
        np.concatenate(own_w_garment_tris, axis=0) if own_w_garment_tris else np.zeros((0, 3, 3), dtype=float)
    )

    slots = {}
    for slot_cfg in fig["slots"]:
        slot_label = slot_cfg["slot"]
        gm = next(g for g in garments if g["slot"] == slot_label)
        gv, gf = gm["verts"], gm["faces"]
        band_lo = float(gv[:, 1].min())
        band_hi = float(gv[:, 1].max())
        footprint = gc._lateral_footprint(gv, band_lo, band_hi, height_axis=1, lateral_axis=0, n_slices=N_SLICES)

        # Region selection — EXACTLY the shared predicate's claim (issue-283).
        sel = (cents[:, 1] > band_lo) & (cents[:, 1] < band_hi)
        slice_k = np.clip(
            ((cents[:, 1] - band_lo) / (band_hi - band_lo) * len(footprint)).astype(np.int64),
            0, len(footprint) - 1,
        )
        sel = sel & (np.abs(cents[:, 0]) <= footprint[slice_k])
        region_count = int(sel.sum())

        # Outside classification (disjoint, covers all non-region faces).
        above = np.where(cents[:, 1] >= band_hi)[0]
        below = np.where(cents[:, 1] <= band_lo)[0]
        inband = np.where((cents[:, 1] > band_lo) & (cents[:, 1] < band_hi))[0]
        lateral = inband[np.abs(cents[inband, 0]) > footprint[slice_k[inband]]]

        ring_v = RING_VERTICAL_FRACTION * body_height
        above_ring = above[(cents[above, 1] >= band_hi) & (cents[above, 1] < band_hi + ring_v)]
        below_ring = below[(cents[below, 1] > band_lo - ring_v) & (cents[below, 1] <= band_lo)]
        lat = np.abs(cents[lateral, 0])
        lat_ring = lateral[lat <= footprint[slice_k[lateral]] + RING_LATERAL_METERS]

        # Signed clearance (covered by ANY garment surface) for ring faces.
        all_garment_pairs = [(g["verts"], g["faces"]) for g in garments]
        ring_all = np.concatenate([above_ring, below_ring, lat_ring])
        _cl, covered_ring = signed_clearance_for_faces(bv, bf, all_garment_pairs, ring_all)
        covered_map = {}
        if len(ring_all):
            # same ordering as the concatenation above
            cursor = 0
            for name, arr in (("above", above_ring), ("below", below_ring), ("lateral", lat_ring)):
                k = len(arr)
                covered_map[name] = int((_cl[cursor : cursor + k] < HIDE_EPSILON_M).sum()) if k else 0
                cursor += k

        boundaries = {}
        for name, face_set, ring in (
            ("above", above, above_ring),
            ("below", below, below_ring),
            ("lateral", lateral, lat_ring),
        ):
            ring_mask = np.isin(face_set, ring)
            base = census_boundary(bv, bf, cents, body_min, body_height, band_lo, band_hi,
                                   footprint, face_set, ring_mask, name)
            ring_cam = camera_classify(ring, cents, normals, M, cam_pos, view, proj,
                                       own_garment_tris_w, all_humanoid_tris_w, max_rays=10_000_000)
            full_cam = camera_classify(face_set, cents, normals, M, cam_pos, view, proj,
                                       own_garment_tris_w, all_humanoid_tris_w,
                                       max_rays=MAX_FULL_OUTSIDE_RAY_SAMPLE)
            boundary = {
                "boundary": name,
                "faceCount": base["faceCount"],
                "heightFraction": base["heightFraction"],
                "lateralFraction": base["lateralFraction"],
                "immediateRing": {
                    "faceCount": base["ringFaceCount"],
                    "camera": ring_cam,
                    "coveredByGarmentCount": covered_map.get(name, 0),
                    "bareSkinCount": base["ringFaceCount"] - covered_map.get(name, 0),
                },
                "fullOutside": {
                    "faceCount": base["faceCount"],
                    "camera": full_cam,
                },
            }
            boundaries[name] = boundary

        slots[slot_label] = {
            "garmentMeshName": gm.get("meshName", ""),
            "garmentTriangleCount": int(len(gf)),
            "bandMeters": [round(band_lo, 4), round(band_hi, 4)],
            "bandBodyHeightFraction": [
                round((band_lo - body_min[1]) / body_height, 4),
                round((band_hi - body_min[1]) / body_height, 4),
            ],
            "lateralFootprintMeters": {
                "min": round(float(footprint.min()), 4),
                "max": round(float(footprint.max()), 4),
                "perSlice": [round(float(v), 4) for v in footprint],
            },
            "lateralFootprintBodyHeightFraction": {
                "min": round(float(footprint.min()) / body_height, 4),
                "max": round(float(footprint.max()) / body_height, 4),
            },
            "regionFaceCount": region_count,
            "boundaries": boundaries,
        }

    return {
        "bodyClassId": fig["bodyClassId"],
        "glbPath": fig.get("glbPath", ""),
        "actorId": fig.get("actorId", ""),
        "bodyHeightMeters": round(body_height, 4),
        "actorWorldPlacement": {
            "matrixWorldElements": fig["matrixWorldElements"],
        },
        "slots": slots,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="issue-290 claim region extent measurement")
    p.add_argument("--manifest", required=True, help="input manifest JSON (camera + actors + occluders)")
    p.add_argument("--out", required=True, help="output report JSON")
    args = p.parse_args(argv)

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    figures = []
    for i, f in enumerate(manifest["figures"]):
        print(f"issue-290: figure {i + 1}/{len(manifest['figures'])} {f['bodyClassId']} ...", flush=True)
        fig = compute_figure(manifest, f)
        figures.append(fig)
        for slot, s in fig["slots"].items():
            print(
                f"issue-290:   [{slot}] band={s['bandBodyHeightFraction']} "
                f"latMax={s['lateralFootprintBodyHeightFraction']['max']} region={s['regionFaceCount']}",
                flush=True,
            )
    out = {
        "schemaVersion": "openclinxr.issue-290.claim-region-extent.v1",
        "figures": figures,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"issue-290: wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
