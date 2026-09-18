#!/usr/bin/env python3
"""Coverage-greedy eyebrow strand reduction for the factory bake.

Port of the ALREADY-PROVEN algorithm from
`tools/openclinxr/evidence/eyebrow-budget/reduce-shipped-eyebrows-v2.ts` (v2) into
Blender/bpy, operating on the live mesh mid-bake.

MECHANISM: whole original strands only (no vertex resampling). Phase 1
(greedy): repeatedly take the strand (connected component) that adds the most
NEW covered grid cells per triangle inside an eye-anchored brow band, until no
strand adds a new cell or the triangle budget is exhausted. Phase 2
(densest-ink-per-tri fill, bstar-sweep select()): the greedy phase flatlines
while budget remains — spend the remainder on the strands carrying the most
projected band-plane ink per triangle, so leftover budget buys arch, not air.
Every kept vertex is an ORIGINAL vertex.

BUDGET: B* = 3,600 triangles was derived in bstar-sweep.ts as the smallest
budget clearing both a 25% band-span floor and a 10% band-ink floor on every
actor in that sweep. Measured 2026-09-18 on the nurse (mindfront_eyebrows_06):
greedy spends the whole 3,600 budget for 247/2304 band cells (10.7%) — the
10% ink floor, and a dusting at face-crop framing. DEFAULT below is re-tuned
to 9,000 (greedy + phase-2 fill; still 3.5x below the 31,968-tri full brow and
far below the 21k-speckle FAILED treatment) so the arch fills.

THE CRITICAL REMAP: this function returns `kept_vertex_indices` — a list mapping
new mesh vertex order (after reduction) to original .obj vertex order. This MUST
be threaded into `facs_shape_key_transfer.transfer_body_shape_keys_to_fitted_mesh`
so it remaps `mhclo.verts` after `mhclo.load()` and before the re-fit, once per
call. The hazard: if you reduce the mesh to M < N vertices and then facs_shape_key_transfer
re-loads the mhclo and re-fits (it does exactly this), the loop will look up
`mhclo.verts[0..M-1]` — succeeding silently and returning WRONG per-vertex
correspondence for every kept vertex whose ORIGINAL index was not its NEW
enumerate position.

DERIVING THE REMAP: tag every vertex with its original index in a bmesh custom
int layer BEFORE deleting anything, then read that layer back off the surviving
vertices in their new mesh order AFTER the delete — that is the ground truth
remap regardless of bmesh's internal reindexing behaviour.

CONNECTED COMPONENTS: the TS scripts union vertices by quantized 5dp POSITION
because glTF export duplicates vertices at UV seams. A native Blender mesh
imported from .obj may or may not have the same duplication for this asset —
compute components BOTH ways (bmesh vertex-index adjacency, and position-quantized
union-find) and check which one lands near the ~1,264-strand count the v1 script's
header cites for a Mindfront brow. Use whichever is correct; do not assume.

EYE-ANCHORED BAND: uses the fitted `eyes_low_poly` mesh (already in scope in the
materializer as `eyes_asset`) to build the band, same role it played in the TS
scripts. The hair/brow objects are baked to an identity transform by
`apply_object_transforms` inside `fit_hair` (embed_library_hair.py:337), so
local == world for `_brow`. Confirm `eyes_asset`'s transform state the same way.
"""

from __future__ import annotations

import bmesh
import bpy
from mathutils import Vector
from typing import Dict, List, Set, Tuple, Optional


# Factory brow budget (measured 2026-09-18): greedy spends the whole 3,600
# for 247/2304 band cells on mindfront_eyebrows_06 — the 10% ink floor, a
# dusting. 9,000 (greedy + phase-2 fill) is still 3.5x below the 31,968-tri
# full brow and far below the 21k-speckle FAILED treatment.
DEFAULT_EYEBROW_BUDGET_TRIS = 9000

# Eye-anchored band grid (matching v2 TS exactly)
GRID_X = 96
GRID_Y = 24
PAD_X = 0.5
Y_BELOW = 0.3
Y_ABOVE = 0.5

# Position quantization for union-find (matching TS 5dp)
POS_QUANTIZE_DP = 5


def _quantize_pos(v: Vector) -> str:
    """Quantize a Vector to 5dp string key, matching TS q() function."""
    return f"{v.x:.5f},{v.y:.5f},{v.z:.5f}"


def _compute_eye_anchored_band(eyes_obj: bpy.types.Object) -> Tuple[float, float, float, float]:
    """
    Compute the eye-anchored brow band in the eyebrow mesh's LOCAL space.
    
    The TS script uses eyes_low_poly's XY bbox (in glTF space: X=horizontal, Y=vertical up).
    But Blender uses Z-up. After export_yup=True, Blender's Z becomes glTF's Y.
    So we need to use Blender's X (horizontal) and Z (vertical) for the band.
    
    The band pads:
    - X: ±50% of eye bbox width (Blender X)
    - Z: -30% below eye bbox max Z, +50% above eye bbox max Z (Blender Z = glTF Y)
    
    Returns (x0, x1, z0, z1) in eyebrow LOCAL coordinates (Blender space).
    """
    # Get eye vertices in world space, then convert to eyebrow local
    # Since both are identity-transformed (local == world), we can use world coords directly
    eye_coords = [(eyes_obj.matrix_world @ v.co) for v in eyes_obj.data.vertices]
    
    x0 = min(c.x for c in eye_coords)
    x1 = max(c.x for c in eye_coords)
    z0 = min(c.z for c in eye_coords)
    z1 = max(c.z for c in eye_coords)
    
    w = x1 - x0
    h = z1 - z0
    
    band_x0 = x0 - PAD_X * w
    band_x1 = x1 + PAD_X * w
    band_z0 = z1 - Y_BELOW * h  # TS uses y1 (max) as reference; in Blender that's z1
    band_z1 = z1 + Y_ABOVE * h
    
    return (band_x0, band_x1, band_z0, band_z1)


def _build_components_by_adjacency(bm: bmesh.types.BMesh) -> List[Set[int]]:
    """
    Build connected components using bmesh vertex-index adjacency (shared edges).
    Returns list of sets of vertex indices (bm.verts indices).
    """
    n_verts = len(bm.verts)
    parent = list(range(n_verts))
    
    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    
    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    
    # Union vertices sharing an edge
    for e in bm.edges:
        union(e.verts[0].index, e.verts[1].index)
    
    # Collect components
    comp_map: Dict[int, Set[int]] = {}
    for v in bm.verts:
        root = find(v.index)
        if root not in comp_map:
            comp_map[root] = set()
        comp_map[root].add(v.index)
    
    return list(comp_map.values())


def _build_components_by_position(bm: bmesh.types.BMesh) -> List[Set[int]]:
    """
    Build connected components using quantized position union-find (matching TS).
    Returns list of sets of vertex indices (bm.verts indices).
    """
    n_verts = len(bm.verts)
    parent = list(range(n_verts))
    key_of: Dict[str, int] = {}
    
    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    
    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    
    # Union by quantized position
    for i, v in enumerate(bm.verts):
        key = _quantize_pos(v.co)
        if key in key_of:
            union(key_of[key], i)
        else:
            key_of[key] = i
    
    # Also union by face connectivity (triangles)
    for f in bm.faces:
        verts_idx = [v.index for v in f.verts]
        for i in range(len(verts_idx)):
            union(verts_idx[i], verts_idx[(i + 1) % len(verts_idx)])
    
    # Collect components
    comp_map: Dict[int, Set[int]] = {}
    for v in bm.verts:
        root = find(v.index)
        if root not in comp_map:
            comp_map[root] = set()
        comp_map[root].add(v.index)
    
    return list(comp_map.values())


def _triangles_of_component(bm: bmesh.types.BMesh, comp_verts: Set[int]) -> List[List[int]]:
    """
    Get all triangles belonging to a component (set of vertex indices).
    Returns list of [v0_idx, v1_idx, v2_idx] triangles in bm.verts index space.
    """
    comp_set = comp_verts
    tris = []
    for f in bm.faces:
        # Check if all vertices of this face belong to the component
        if all(v.index in comp_set for v in f.verts):
            # Triangulate the face
            if len(f.verts) == 3:
                tris.append([v.index for v in f.verts])
            elif len(f.verts) == 4:
                # Quad -> 2 triangles
                v0, v1, v2, v3 = [v.index for v in f.verts]
                tris.append([v0, v1, v2])
                tris.append([v0, v2, v3])
            else:
                # Polygon -> fan triangulation
                v_indices = [v.index for v in f.verts]
                for i in range(1, len(v_indices) - 1):
                    tris.append([v_indices[0], v_indices[i], v_indices[i + 1]])
    return tris


def _cells_covered_by_triangles(
    bm: bmesh.types.BMesh,
    tri_indices: List[List[int]],
    band: Tuple[float, float, float, float]
) -> bytearray:
    """
    Compute which grid cells are covered by a set of triangles.
    Uses X (horizontal) and Z (vertical) coordinates matching Blender's Z-up space
    which becomes glTF's Y-up after export_yup=True.
    Returns bytearray of length GRID_X * GRID_Y (1 = covered).
    """
    x0, x1, z0, z1 = band
    cw = (x1 - x0) / GRID_X
    ch = (z1 - z0) / GRID_Y
    
    hit = bytearray(GRID_X * GRID_Y)
    
    for tri in tri_indices:
        v0 = bm.verts[tri[0]].co
        v1 = bm.verts[tri[1]].co
        v2 = bm.verts[tri[2]].co
        
        ax, az = v0.x, v0.z
        bx, bz = v1.x, v1.z
        cx, cz = v2.x, v2.z
        
        # Triangle area (2D cross product in XZ plane)
        d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az)
        if abs(d) < 1e-12:
            continue
        
        # Bounding box of triangle in grid coordinates
        gx0 = max(0, int((min(ax, bx, cx) - x0) / cw))
        gx1 = min(GRID_X - 1, int((max(ax, bx, cx) - x0) / cw) + 1)
        gz0 = max(0, int((min(az, bz, cz) - z0) / ch))
        gz1 = min(GRID_Y - 1, int((max(az, bz, cz) - z0) / ch) + 1)
        
        for gz in range(gz0, gz1 + 1):
            for gx in range(gx0, gx1 + 1):
                idx = gz * GRID_X + gx
                if hit[idx]:
                    continue
                # Cell center
                px = x0 + (gx + 0.5) * cw
                pz = z0 + (gz + 0.5) * ch
                
                # Barycentric coordinates
                w0 = ((bx - px) * (cz - pz) - (cx - px) * (bz - pz)) / d
                w1 = ((cx - px) * (az - pz) - (ax - px) * (cz - pz)) / d
                w2 = 1.0 - w0 - w1
                
                if w0 >= -1e-6 and w1 >= -1e-6 and w2 >= -1e-6:
                    hit[idx] = 1
    
    return hit


def _projected_ink_of_component(
    bm: bmesh.types.BMesh,
    tri_indices: List[List[int]],
) -> float:
    """
    Projected ink of a component on the band plane (Blender XZ, the plane the
    band grid lives in). Sum of |2D cross product| / 2 over its triangles —
    the same projected-area measure ladder-rebake.ts uses for inkPerEye.
    """
    ink = 0.0
    for tri in tri_indices:
        v0 = bm.verts[tri[0]].co
        v1 = bm.verts[tri[1]].co
        v2 = bm.verts[tri[2]].co
        ink += abs(
            (v1.x - v0.x) * (v2.z - v0.z) - (v2.x - v0.x) * (v1.z - v0.z)
        ) / 2.0
    return ink


def reduce_eyebrow_mesh(
    brow_obj: bpy.types.Object,
    eyes_obj: bpy.types.Object,
    budget_tris: int = DEFAULT_EYEBROW_BUDGET_TRIS,
) -> Tuple[bpy.types.Object, Dict]:
    """
    Reduce the eyebrow mesh using coverage-greedy strand selection.
    
    Args:
        brow_obj: The fitted eyebrow mesh object (identity transform, local == world)
        eyes_obj: The fitted eyes_low_poly mesh object (for eye-anchored band)
        budget_tris: Triangle budget (default 3600 from bstar-sweep.ts)
    
    Returns:
        (brow_obj, evidence_dict) where evidence_dict contains:
        - beforeTris, afterTris
        - beforeVerts, afterVerts
        - keptStrands, droppedStrands
        - bandCellsCovered, bandCellsTotal (2304 = 96*24)
        - kept_vertex_indices: list mapping new mesh vertex index -> original .obj vertex index
        - component_method: "adjacency" or "position" (whichever matched expected strand count)
    """
    print(f"[eyebrow_reduction] Starting reduction on {brow_obj.name}")
    print(f"[eyebrow_reduction] Budget: {budget_tris} tris")
    
    # Print bounding boxes for axis confirmation
    brow_bbox_local = _get_bbox(brow_obj, local=True)
    brow_bbox_world = _get_bbox(brow_obj, local=False)
    eyes_bbox_local = _get_bbox(eyes_obj, local=True)
    eyes_bbox_world = _get_bbox(eyes_obj, local=False)
    print(f"[eyebrow_reduction] Brow bbox LOCAL:  {brow_bbox_local}")
    print(f"[eyebrow_reduction] Brow bbox WORLD:  {brow_bbox_world}")
    print(f"[eyebrow_reduction] Eyes bbox LOCAL:  {eyes_bbox_local}")
    print(f"[eyebrow_reduction] Eyes bbox WORLD:  {eyes_bbox_world}")
    
    # Build bmesh from brow mesh
    bm = bmesh.new()
    bm.from_mesh(brow_obj.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    
    original_vert_count = len(bm.verts)
    original_tri_count = sum(max(len(f.verts) - 2, 0) for f in bm.faces)
    print(f"[eyebrow_reduction] Original: {original_vert_count} verts, {original_tri_count} tris")
    
    # Tag every vertex with its original index BEFORE any deletion
    orig_idx_layer = bm.verts.layers.int.new("orig_idx")
    for v in bm.verts:
        v[orig_idx_layer] = v.index
    
    # Compute components both ways and pick the one matching ~1,264 strands
    comps_adj = _build_components_by_adjacency(bm)
    comps_pos = _build_components_by_position(bm)
    
    print(f"[eyebrow_reduction] Components by adjacency: {len(comps_adj)}")
    print(f"[eyebrow_reduction] Components by position:  {len(comps_pos)}")
    
    # The v1 script header cites ~1,264 strands for a Mindfront brow
    # Choose the method that gives a count closest to that
    target_strands = 1264
    if abs(len(comps_adj) - target_strands) <= abs(len(comps_pos) - target_strands):
        components = comps_adj
        component_method = "adjacency"
    else:
        components = comps_pos
        component_method = "position"
    
    print(f"[eyebrow_reduction] Using {component_method} method ({len(components)} strands)")
    
    # Build triangle lists per component
    comp_tris = []
    for comp in components:
        tris = _triangles_of_component(bm, comp)
        if tris:
            comp_tris.append((comp, tris))
    
    # Compute eye-anchored band
    band = _compute_eye_anchored_band(eyes_obj)
    print(f"[eyebrow_reduction] Eye-anchored band: x[{band[0]:.4f},{band[1]:.4f}] y[{band[2]:.4f},{band[3]:.4f}]")
    
    # Precompute cell coverage per component
    comp_cells = []
    comp_tri_counts = []
    for comp, tris in comp_tris:
        cells = _cells_covered_by_triangles(bm, tris, band)
        covered = sum(cells)
        comp_cells.append(cells)
        comp_tri_counts.append(len(tris))
    
    # Coverage-greedy selection (matching v2 TS exactly)
    global_hit = bytearray(GRID_X * GRID_Y)
    kept_comp_indices = []
    kept_tris = 0
    pool = list(range(len(comp_tris)))
    
    while pool:
        best_idx = -1
        best_gain_per_tri = 0.0
        
        for i in pool:
            tri_count = comp_tri_counts[i]
            if kept_tris + tri_count > budget_tris:
                continue
            
            # Compute gain: new cells this component would add
            cells = comp_cells[i]
            gain = sum(1 for c in range(len(cells)) if cells[c] and not global_hit[c])
            gain_per_tri = gain / tri_count if tri_count > 0 else 0
            
            if gain > 0 and gain_per_tri > best_gain_per_tri:
                best_gain_per_tri = gain_per_tri
                best_idx = i
        
        if best_idx < 0 or best_gain_per_tri <= 0:
            break
        
        # Keep this component
        cells = comp_cells[best_idx]
        for c in range(len(cells)):
            if cells[c]:
                global_hit[c] = 1
        kept_comp_indices.append(best_idx)
        kept_tris += comp_tri_counts[best_idx]
        pool.remove(best_idx)

    # Phase 2 — densest-ink-per-tri fill (bstar-sweep select()): the greedy
    # phase flatlines while budget remains, because no leftover strand adds a
    # NEW band cell. Spend the remainder ordered by projected band-plane ink
    # per triangle, so leftover budget buys arch density, not air. Whole
    # strands only — still no resampling, still original vertices.
    if pool and kept_tris < budget_tris:
        comp_ink = []
        for k in range(len(comp_tris)):
            tris_k = comp_tris[k][1]
            ink = _projected_ink_of_component(bm, tris_k)
            n = comp_tri_counts[k]
            comp_ink.append(ink / n if n > 0 else 0.0)
        pool.sort(key=lambda k: comp_ink[k], reverse=True)
        for k in list(pool):
            if kept_tris + comp_tri_counts[k] > budget_tris:
                continue
            cells_k = comp_cells[k]
            for c in range(len(cells_k)):
                if cells_k[c]:
                    global_hit[c] = 1
            kept_comp_indices.append(k)
            kept_tris += comp_tri_counts[k]
            pool.remove(k)
        print(f"[eyebrow_reduction] Phase 2 densest fill spent to {kept_tris} tris")

    dropped_strands = len(pool)
    kept_strands = len(kept_comp_indices)
    band_cells_covered = sum(global_hit)
    band_cells_total = GRID_X * GRID_Y
    
    print(f"[eyebrow_reduction] Kept {kept_strands} strands ({kept_tris} tris), dropped {dropped_strands}")
    print(f"[eyebrow_reduction] Band coverage: {band_cells_covered}/{band_cells_total} cells")
    
    # Collect all vertices to KEEP (from kept components)
    keep_verts = set()
    for idx in kept_comp_indices:
        keep_verts.update(comp_tris[idx][0])
    
    # Delete faces not in kept components
    faces_to_drop = []
    for f in bm.faces:
        if not all(v.index in keep_verts for v in f.verts):
            faces_to_drop.append(f)
    
    if faces_to_drop:
        bmesh.ops.delete(bm, geom=faces_to_drop, context='FACES')
    
    # Delete isolated vertices
    verts_to_drop = [v for v in bm.verts if not v.link_faces]
    if verts_to_drop:
        bmesh.ops.delete(bm, geom=verts_to_drop, context='VERTS')
    
    bm.verts.ensure_lookup_table()
    
    # Read back the original indices of surviving vertices in NEW mesh order
    kept_vertex_indices = [v[orig_idx_layer] for v in bm.verts]
    
    after_vert_count = len(bm.verts)
    after_tri_count = sum(max(len(f.verts) - 2, 0) for f in bm.faces)
    
    print(f"[eyebrow_reduction] After reduction: {after_vert_count} verts, {after_tri_count} tris")
    print(f"[eyebrow_reduction] Kept vertex indices (first 10): {kept_vertex_indices[:10]}")
    
    # Write back to mesh
    bm.to_mesh(brow_obj.data)
    bm.free()
    brow_obj.data.update()
    
    # Verify bone weights survived (spot check)
    if brow_obj.vertex_groups:
        vg = brow_obj.vertex_groups[0]
        if after_vert_count > 0:
            v = brow_obj.data.vertices[0]
            for ge in v.groups:
                if ge.group == vg.index:
                    print(f"[eyebrow_reduction] Spot-check: kept vert 0 has weight {ge.weight:.4f} in group {vg.name}")
                    break
    
    evidence = {
        "beforeTris": original_tri_count,
        "afterTris": after_tri_count,
        "beforeVerts": original_vert_count,
        "afterVerts": after_vert_count,
        "keptStrands": kept_strands,
        "droppedStrands": dropped_strands,
        "bandCellsCovered": band_cells_covered,
        "bandCellsTotal": band_cells_total,
        "keptVertexIndices": kept_vertex_indices,
        "componentMethod": component_method,
    }
    
    return brow_obj, evidence


def _get_bbox(obj: bpy.types.Object, local: bool = True) -> Dict[str, List[float]]:
    """Get bounding box of object in local or world space."""
    if local:
        xs = [v.co.x for v in obj.data.vertices]
        ys = [v.co.y for v in obj.data.vertices]
        zs = [v.co.z for v in obj.data.vertices]
    else:
        mw = obj.matrix_world
        xs = [(mw @ v.co).x for v in obj.data.vertices]
        ys = [(mw @ v.co).y for v in obj.data.vertices]
        zs = [(mw @ v.co).z for v in obj.data.vertices]
    
    return {
        "min": [min(xs), min(ys), min(zs)],
        "max": [max(xs), max(ys), max(zs)],
        "size": [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)],
    }


if __name__ == "__main__":
    # Allow running as standalone for testing (requires Blender context)
    pass