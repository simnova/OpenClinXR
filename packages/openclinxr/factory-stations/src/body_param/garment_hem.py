from __future__ import annotations

"""Hem-finish stage (st-hemfin, #124), split out of garment_ops.py to keep each
body_param module under the 1,000-line ceiling. garment_ops re-exports
finish_garment_hem, so existing callers are unchanged."""

try:
    import bpy
except ImportError:
    bpy = None


# ── st-hemfin: reusable hem-finish stage (Q1/Q3 factory capability) ──────────
# Every garment bake can call finish_garment_hem on any fitted garment object.
# The sawn-hem defect (#124) is a height-threshold delete on body topology: the
# boundary left behind is a staircase through triangles, and on MakeClothes
# garments the glTF export additionally splits every quad at UV/normal seams so
# the shipped file carries thousands of 4-vert micro-loops instead of one hem.
#
# Decisions (named per the contract's DECISIONS section):
# - weld-first boundary detection (bmesh remove_doubles at 1e-6 exact): merges
#   export splits without collapsing dense triangles. REJECTED 8 mm band weld:
#   #656 showed it collapses neck/cuff triangles into 2-vert slit loops.
# - planar level of the hem loop to its own minimum (not a height fraction
#   floor): the terminus is DERIVED from the loop, never an authored constant.
# - XY loop-Laplacian smoothing along detected loop order (not coverage
#   presence, not bot_y floor): bounds the turn angle the contract measures.
# - shade smooth + clear custom split normals so the exporter merges coplanar
#   corners (the soup is a normals problem, not an unwelded Blender mesh).
#   REJECTED solidify rim: #121 recorded it re-splits on glTF export into
#   micro-islands. REJECTED bisect_plane: measured on Blender 5.1 even
#   cut-only deletes the whole lower band. Mirrors the Anny rail #124 FIXED
#   path (snap + Laplacian) so both rails finish hems the same way.
# - closed solids (0 boundary loops, e.g. the authored-shut scrub shirt) are
#   cut open ONLY at the hem by deleting the lowest face row, then finished
#   like any open hem. Never hand-authored vertex lists: every vertex the
#   stage touches comes from a detected boundary loop.
# Tris are preserved except for the closed-solid cut (the cap faces that never
# shipped as a hem). No new faces, no extrude, no dissolve.
def _hem_boundary_loops(bm):
    """Boundary loops/chains on a bmesh: edges with exactly one linked face.

    Returns a list of (path, closed) tuples; closed is True when the walk
    returned to its start vertex.
    """
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    adj: dict = {}
    for e in bm.edges:
        if len(e.link_faces) != 1:
            continue
        a = e.verts[0].index
        b = e.verts[1].index
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    visited: set = set()
    loops: list = []
    for start in adj:
        if start in visited:
            continue
        path: list = []
        prev = -1
        cur = start
        closed = False
        while cur not in visited:
            visited.add(cur)
            path.append(cur)
            nxt = -1
            for n in adj.get(cur, ()):
                if n != prev:
                    nxt = n
                    break
            if nxt < 0:
                break
            prev, cur = cur, nxt
            if cur == start:
                closed = True
                break
        if len(path) >= 3:
            loops.append((path, closed))
    return loops


def _longest_band_chain(bm, band, height_axis):
    """Longest boundary path staying inside the hem band (greedy walk).

    Mirrors the instrument's longestPathInGraph: an open-front fused loop
    contributes an open hem arc, a closed hem ring stays closed. Returns
    (order, closed).
    """
    band_adj: dict = {}
    for e in bm.edges:
        if len(e.link_faces) != 1:
            continue
        a = e.verts[0].index
        b = e.verts[1].index
        if a in band and b in band:
            band_adj.setdefault(a, []).append(b)
            band_adj.setdefault(b, []).append(a)
    best: list = []
    for start in band_adj:
        chain = [start]
        seen = {start}
        cur = start
        prev = -1
        while True:
            nxt = -1
            for n in band_adj.get(cur, ()):
                if n != prev and n not in seen:
                    nxt = n
                    break
            if nxt < 0:
                break
            seen.add(nxt)
            chain.append(nxt)
            prev, cur = cur, nxt
        if len(chain) > len(best):
            best = chain
    closed = False
    if len(best) >= 4:
        ends = (best[0], best[-1])
        if ends[1] in band_adj.get(ends[0], ()):
            closed = True
    return best, closed


def _clamp_hem_turns(bm, order, height_axis, hlo, max_turn_deg=70.0, iters=12, closed=True):
    """Peak-turn clamp in path order (Anny #124/#188 pull weights, axis-generic).

    Loop-Laplacian alone leaves needle fold-backs (near-180 deg) where the
    path doubles back on itself: neighbours agree, so the average does not
    move the spike tip. Pulling every vertex whose path turn exceeds the
    bound toward its path neighbours erases the needles. Path order (the
    boundary walk itself) is used rather than an angular sort so open hem
    arcs — whose angular order scrambles the path and invents spikes — are
    clamped along their true topology. Closed rings wrap; open chains
    clamp interior vertices only.
    """
    import math as _math

    others = [height_axis, (height_axis + 1) % 3, (height_axis + 2) % 3]
    ha, hb = others[1], others[2]
    ring = [vi for vi in order if vi < len(bm.verts)]
    n = len(ring)
    if n < 4:
        return
    for _ in range(iters):
        moved = False
        for i in range(n):
            if not closed and (i == 0 or i == n - 1):
                continue
            a = ring[(i - 1) % n]
            b = ring[i]
            c = ring[(i + 1) % n]
            ax = float(bm.verts[b].co[ha]) - float(bm.verts[a].co[ha])
            az = float(bm.verts[b].co[hb]) - float(bm.verts[a].co[hb])
            bx = float(bm.verts[c].co[ha]) - float(bm.verts[b].co[ha])
            bz = float(bm.verts[c].co[hb]) - float(bm.verts[b].co[hb])
            l1 = _math.hypot(ax, az)
            l2 = _math.hypot(bx, bz)
            if l1 < 1e-9 or l2 < 1e-9:
                continue
            cos = max(-1.0, min(1.0, (ax * bx + az * bz) / (l1 * l2)))
            if _math.acos(cos) * 180.0 / _math.pi <= max_turn_deg:
                continue
            bm.verts[b].co[ha] = 0.20 * float(bm.verts[b].co[ha]) + 0.40 * (
                float(bm.verts[a].co[ha]) + float(bm.verts[c].co[ha])
            )
            bm.verts[b].co[hb] = 0.20 * float(bm.verts[b].co[hb]) + 0.40 * (
                float(bm.verts[a].co[hb]) + float(bm.verts[c].co[hb])
            )
            bm.verts[b].co[height_axis] = hlo
            moved = True
        if not moved:
            break


def finish_garment_hem(
    garment,
    *,
    height_axis: int = 2,
    smooth_iters: int = 28,
    cut_closed_solids: bool = True,
) -> dict:
    """Finish the hem of any fitted garment object (Blender bmesh ops only).

    Runs post-fit, pre-weights: welds export splits, opens closed solids at
    the hem, levels the hem loop to its own minimum, Laplacian-smooths it in
    the horizontal plane, shade-smooths so the export merges indices.
    Returns a provenance-recordable report dict.
    """
    import bmesh as _bm

    report: dict = {"enabled": True, "stage": "finish_garment_hem"}
    mesh = garment.data
    report["vertsImport"] = len(mesh.vertices)
    report["facesImport"] = len(mesh.polygons)
    bm = _bm.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    report["loopsBefore"] = len(_hem_boundary_loops(bm))

    before_v = len(bm.verts)
    _bm.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.verts.index_update()
    bm.edges.index_update()
    bm.faces.index_update()
    report["vertsAfterWeld"] = len(bm.verts)
    report["weldRemoved"] = before_v - len(bm.verts)

    loops = _hem_boundary_loops(bm)
    report["loopsAfterWeld"] = len(loops)
    if not loops and cut_closed_solids:
        zs = [v.co[height_axis] for v in bm.verts]
        lo = min(zs)
        for band in (0.004, 0.012):
            cands = [
                f
                for f in bm.faces
                if min(v.co[height_axis] for v in f.verts) <= lo + band
            ]
            if not cands:
                continue
            _bm.ops.delete(bm, geom=list(cands), context="FACES")
            bm.verts.ensure_lookup_table()
            bm.edges.ensure_lookup_table()
            bm.faces.ensure_lookup_table()
            bm.verts.index_update()
            bm.edges.index_update()
            bm.faces.index_update()
            loops = _hem_boundary_loops(bm)
            if loops:
                report["cutBandMeters"] = band
                report["cutFaces"] = len(cands)
                break
        # Drop verts orphaned by the cap delete (no linked faces): they carry
        # orphan edges that bloat the export but are never boundary (0 faces).
        # Hem-ring verts keep their surviving faces and are untouched.
        if loops:
            orphaned = [v for v in bm.verts if not v.link_faces]
            if orphaned:
                _bm.ops.delete(bm, geom=orphaned, context="VERTS")
                bm.verts.ensure_lookup_table()
                bm.edges.ensure_lookup_table()
                bm.faces.ensure_lookup_table()
                bm.verts.index_update()
                bm.edges.index_update()
                bm.faces.index_update()
                report["cutOrphanVerts"] = len(orphaned)
                loops = _hem_boundary_loops(bm)
        report["loopsAfterCut"] = len(loops)
    if not loops:
        report["note"] = "closed solid with no cuttable hem band; left closed"
        bm.free()
        return report

    def _loop_span(path):
        hs = [bm.verts[i].co[height_axis] for i in path]
        return min(hs), max(hs)

    others = [height_axis, (height_axis + 1) % 3, (height_axis + 2) % 3]
    ha, hb = others[1], others[2]
    global_lo = min(bm.verts[i].co[height_axis] for path, _ in loops for i in path)
    # Hem = the instrument's own selection, reproduced in Blender: the lowest
    # loop's bottom-22% band chain (open-front fused loops contribute their
    # hem arc; closed rings contribute their lowest arc), plus any other
    # loop whose band reaches the global hem zone (multi-fragment cut hems).
    # Leveling/smoothing exactly the measured chain cannot cliff its edge:
    # every chain vertex takes the chain minimum.
    def _loop_band(loop_path):
        # Fused open-front loops span the whole torso (hem + front opening):
        # smooth only their bottom-22% hem arc so the neckline above survives.
        # Closed rings (hem/cuff/collar, span < 15 cm) smooth whole — the
        # instrument measures the hem arc, and a wholly-regular ring's every
        # arc is regular.
        hs = [(bm.verts[i].co[height_axis], i) for i in loop_path]
        lo = min(h for h, _ in hs)
        hi = max(h for h, _ in hs)
        if hi - lo <= 0.15:
            return set(loop_path)
        span = max(hi - lo, 1e-6)
        in_band = {i for h, i in hs if h <= lo + span * 0.22}
        if len(in_band) >= 6:
            return in_band
        if len(loop_path) <= 12:
            return set(loop_path)
        return in_band

    chains: list = []
    for path, _ in sorted(loops, key=lambda t: sum(
            bm.verts[i].co[height_axis] for i in t[0]) / len(t[0])):
        band = _loop_band(path)
        if not band:
            continue
        band_min = min(bm.verts[i].co[height_axis] for i in band)
        if band_min > global_lo + 0.03:
            continue
        chain = _longest_band_chain(bm, band, height_axis)
        if len(chain[0]) >= 4:
            chains.append(chain)
    chains = [c for c in chains if len(c[0]) >= 4]
    report["hemLoopCount"] = len(chains)
    for order, closed in chains:
        hlo = min(bm.verts[i].co[height_axis] for i in order)
        for i in order:
            bm.verts[i].co[height_axis] = hlo
        lam = 0.5
        for _ in range(max(smooth_iters, 1)):
            new_xy: dict = {}
            n = len(order)
            for k, vi in enumerate(order):
                if closed:
                    a = bm.verts[order[(k - 1) % n]].co
                    b = bm.verts[order[(k + 1) % n]].co
                else:
                    a = bm.verts[order[max(k - 1, 0)]].co
                    b = bm.verts[order[min(k + 1, n - 1)]].co
                v = bm.verts[vi].co
                new_xy[vi] = (
                    v[ha] + lam * ((a[ha] + b[ha]) / 2 - v[ha]),
                    v[hb] + lam * ((a[hb] + b[hb]) / 2 - v[hb]),
                )
            for vi, (nx, ny) in new_xy.items():
                bm.verts[vi].co[ha] = nx
                bm.verts[vi].co[hb] = ny
                bm.verts[vi].co[height_axis] = hlo
        _clamp_hem_turns(bm, order, height_axis, hlo, closed=closed)
    report["hemLeveledLoops"] = len(chains)
    report["hemVerts"] = sum(len(c[0]) for c in chains)

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True
    try:
        if mesh.has_custom_normals:
            bpy.ops.object.mode_set(mode="OBJECT")
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception as exc:
        report["clearNormalsError"] = "%s: %s" % (type(exc).__name__, exc)
    try:
        report["hasCustomNormalsAfter"] = bool(mesh.has_custom_normals)
    except Exception:
        pass
    report["vertsExport"] = len(mesh.vertices)
    report["facesExport"] = len(mesh.polygons)
    report["note"] = "hem leveled to loop minima + loop-Laplacian; smooth export"
    return report
