#!/usr/bin/env python3
"""Pure NumPy eyelash rest-seat, blink-follow, and eyeball intrusion math.

Upper regions contain triangles with at least one vertex moving more than
``LID_MOVE_EPS_M`` and whose centroid is above that side's eye-shell centroid.
Lower regions contain every body triangle below the eye centroid inside the
eye-shell proof AABB, including a static lower lid.  Blender callers pass z-up
(2), while glTF callers pass y-up (1).

Each index-connected component is one rigid card/strip.  Its root band is
the nearest half of its vertices to the union of the four lid regions.  The
card side is the nearer side, while upper/lower is fixed by the root-band
centroid against that side's lid centre on the explicit up axis.  The nearest
triangle in that own region is BOTH the rest seat and closure-follow triangle.
Closure movement is rigid: barycentric body closure delta at that exact seat
point is copied to every card vertex.  There is no separate follow donor.

Eyeball/cornea intrusion uses generalized triangle winding number rather
than an axis-aligned ray, avoiding vertex/edge parity ambiguity.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

LID_MOVE_EPS_M = 1.0e-6
MAX_SNAP_M = 0.00455


@dataclass(frozen=True)
class LidRegion:
    side: str
    lid: str
    vertices: np.ndarray
    triangles: np.ndarray
    closure_delta: np.ndarray
    eye_centre: np.ndarray
    proof_aabb_min: np.ndarray
    proof_aabb_max: np.ndarray
    up_axis: int


@dataclass(frozen=True)
class CardBinding:
    card_index: int
    vertex_indices: np.ndarray
    root_indices: np.ndarray
    side: str
    lid: str
    seat_triangle_index: int
    follow_triangle_index: int
    root_vertex_index: int
    barycentric: np.ndarray
    seat_point: np.ndarray
    seat_distance_m: float
    translation: np.ndarray
    closure_delta: np.ndarray
    flagged_over_max_snap: bool

    def __post_init__(self):
        if self.seat_triangle_index != self.follow_triangle_index:
            raise ValueError(
                "F1 seat triangle and follow triangle must be identical "
                f"for card {self.card_index}: "
                f"{self.seat_triangle_index} != {self.follow_triangle_index}"
            )

    @property
    def snap_distance_m(self) -> float:
        return float(self.seat_distance_m)

    @property
    def follow_bind_distance_m(self) -> float:
        """F1: follow is evaluated at the seat point on the same triangle."""
        return 0.0


def _as_triangles(triangles: np.ndarray) -> np.ndarray:
    tri = np.asarray(triangles, dtype=np.int64)
    if tri.ndim == 1:
        tri = tri.reshape(-1, 3)
    if tri.ndim != 2 or tri.shape[1] != 3:
        raise ValueError(f"triangles must be Nx3, got {tri.shape}")
    return tri


def closest_point_on_triangle(point, a, b, c):
    """Return closest point and barycentric weights (Ericson region test)."""
    p = np.asarray(point, dtype=float)
    a, b, c = (np.asarray(x, dtype=float) for x in (a, b, c))
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = float(ab @ ap), float(ac @ ap)
    if d1 <= 0.0 and d2 <= 0.0:
        return a.copy(), np.array([1.0, 0.0, 0.0])
    bp = p - b
    d3, d4 = float(ab @ bp), float(ac @ bp)
    if d3 >= 0.0 and d4 <= d3:
        return b.copy(), np.array([0.0, 1.0, 0.0])
    vc = d1 * d4 - d3 * d2
    if vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
        v = d1 / (d1 - d3)
        return a + v * ab, np.array([1.0 - v, v, 0.0])
    cp = p - c
    d5, d6 = float(ab @ cp), float(ac @ cp)
    if d6 >= 0.0 and d5 <= d6:
        return c.copy(), np.array([0.0, 0.0, 1.0])
    vb = d5 * d2 - d1 * d6
    if vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
        w = d2 / (d2 - d6)
        return a + w * ac, np.array([1.0 - w, 0.0, w])
    va = d3 * d6 - d5 * d4
    if va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        return b + w * (c - b), np.array([0.0, 1.0 - w, w])
    denom = va + vb + vc
    if abs(denom) < 1.0e-20:
        # Degenerate input is not a valid bind surface.
        raise ValueError("degenerate lid triangle")
    v, w = vb / denom, vc / denom
    return a + ab * v + ac * w, np.array([1.0 - v - w, v, w])


def closest_point_on_triangles(point, vertices, triangles):
    verts = np.asarray(vertices, dtype=float)
    tri = _as_triangles(triangles)
    # Exact branch-and-bound: point-to-triangle-AABB distance is a lower
    # bound.  Evaluate in lower-bound order and stop once no unseen triangle
    # can beat the current exact result.  This preserves the Ericson result
    # while avoiding full scans on high-resolution shipped bodies.
    triangle_vertices = verts[tri]
    lower = triangle_vertices.min(axis=1)
    upper = triangle_vertices.max(axis=1)
    outside = np.maximum(np.maximum(lower - point, point - upper), 0.0)
    lower_bound_sq = np.einsum("ij,ij->i", outside, outside)
    order = np.argsort(lower_bound_sq, kind="stable")
    best = None
    for i in order:
        if best is not None and lower_bound_sq[i] > best[0]:
            break
        ids = tri[i]
        try:
            q, bary = closest_point_on_triangle(point, *verts[ids])
        except ValueError:
            continue
        d2 = float((q - point) @ (q - point))
        if best is None or d2 < best[0]:
            best = (d2, i, q, bary)
    if best is None:
        raise ValueError("no non-degenerate triangles")
    return best[1], best[2], best[3], best[0] ** 0.5


def build_lid_regions(
    body_vertices: np.ndarray,
    body_triangles: np.ndarray,
    closure_deltas: dict[str, np.ndarray],
    eye_centres: dict[str, np.ndarray],
    eye_proof_aabbs: dict[str, tuple[np.ndarray, np.ndarray]],
    up_axis: int,
    epsilon_m: float = LID_MOVE_EPS_M,
    upper_any_moving: bool = True,
) -> dict[tuple[str, str], LidRegion]:
    """Build P2 upper-moving and lower proof-AABB lid regions."""
    if up_axis not in (0, 1, 2):
        raise ValueError(f"up_axis must be 0, 1, or 2, got {up_axis!r}")
    vertices = np.asarray(body_vertices, dtype=float)
    tri = _as_triangles(body_triangles)
    regions: dict[tuple[str, str], LidRegion] = {}
    for side in ("left", "right"):
        if side not in closure_deltas:
            raise ValueError(f"missing {side} closure delta")
        delta = np.asarray(closure_deltas[side], dtype=float)
        eye_centre = np.asarray(eye_centres[side], dtype=float)
        proof_min, proof_max = (
            np.asarray(value, dtype=float) for value in eye_proof_aabbs[side]
        )
        if delta.shape != vertices.shape:
            raise ValueError(f"{side} delta shape {delta.shape} != {vertices.shape}")
        moving = np.linalg.norm(delta, axis=1) > epsilon_m
        moving_tri = tri[
            np.any(moving[tri], axis=1)
            if upper_any_moving
            else np.all(moving[tri], axis=1)
        ]
        if not len(moving_tri):
            raise ValueError(
                f"{side} lid region empty at closure epsilon {epsilon_m:g} m"
            )
        centroids = vertices[tri].mean(axis=1)
        upper = moving_tri[
            vertices[moving_tri, up_axis].mean(axis=1) > eye_centre[up_axis]
        ]
        inside_proof = np.all((centroids >= proof_min) & (centroids <= proof_max), axis=1)
        lower = tri[inside_proof & (centroids[:, up_axis] < eye_centre[up_axis])]
        for lid, selected in (("upper", upper), ("lower", lower)):
            if not len(selected):
                raise ValueError(f"{side} {lid} lid region empty")
            regions[(side, lid)] = LidRegion(
                side=side,
                lid=lid,
                vertices=vertices,
                triangles=selected,
                closure_delta=delta,
                eye_centre=eye_centre,
                proof_aabb_min=proof_min,
                proof_aabb_max=proof_max,
                up_axis=up_axis,
            )
    return regions


def connected_cards(vertex_count: int, triangles: np.ndarray) -> list[np.ndarray]:
    """Return deterministic index-connected lash components."""
    if vertex_count <= 0:
        raise ValueError(f"lash card enumeration found no vertex in {vertex_count} verts")
    tri = _as_triangles(triangles)
    parent = np.arange(vertex_count, dtype=np.int64)

    def find(value: int) -> int:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = int(parent[value])
        return value

    for ids in tri:
        if np.any(ids < 0) or np.any(ids >= vertex_count):
            raise ValueError(f"lash triangle index outside 0..{vertex_count - 1}")
        root = find(int(ids[0]))
        for value in ids[1:]:
            other = find(int(value))
            if root != other:
                parent[other] = root
    groups: dict[int, list[int]] = {}
    for value in range(vertex_count):
        groups.setdefault(find(value), []).append(value)
    return [
        np.asarray(values, dtype=np.int64)
        for _, values in sorted(groups.items(), key=lambda item: item[1][0])
    ]


def welded_boundary_loops(
    vertices: np.ndarray,
    triangles: np.ndarray,
    weld_tolerance_m: float = 1.0e-6,
) -> list[np.ndarray]:
    """Return deterministic simple boundary cycles after position welding.

    Each returned id is one canonical source vertex for its welded position.
    Boundary components that are not degree-two cycles refuse implicitly and
    are omitted: they are not anatomical opening loops.
    """
    if weld_tolerance_m <= 0:
        raise ValueError("weld tolerance must be positive")
    verts = np.asarray(vertices, dtype=float)
    tri = _as_triangles(triangles)
    keys = np.rint(verts / weld_tolerance_m).astype(np.int64)
    welded_by_key: dict[tuple[int, int, int], int] = {}
    welded = np.empty(len(verts), dtype=np.int64)
    source_by_welded: dict[int, list[int]] = {}
    for source, key_array in enumerate(keys):
        key = tuple(int(value) for value in key_array)
        weld_id = welded_by_key.setdefault(key, len(welded_by_key))
        welded[source] = weld_id
        source_by_welded.setdefault(weld_id, []).append(source)
    counts: dict[tuple[int, int], int] = {}
    for ids in welded[tri]:
        for a, b in ((ids[0], ids[1]), (ids[1], ids[2]), (ids[2], ids[0])):
            edge = tuple(sorted((int(a), int(b))))
            counts[edge] = counts.get(edge, 0) + 1
    adjacency: dict[int, set[int]] = {}
    for (a, b), count in counts.items():
        if count == 1:
            adjacency.setdefault(a, set()).add(b)
            adjacency.setdefault(b, set()).add(a)
    loops = []
    remaining = set(adjacency)
    while remaining:
        seed = min(remaining)
        stack, component = [seed], set()
        while stack:
            value = stack.pop()
            if value in component:
                continue
            component.add(value)
            stack.extend(adjacency[value] - component)
        remaining -= component
        if len(component) < 3 or any(len(adjacency[value]) != 2 for value in component):
            continue
        start = min(component)
        previous, current = -1, start
        cycle = []
        while True:
            cycle.append(current)
            choices = sorted(adjacency[current] - ({previous} if previous >= 0 else set()))
            nxt = choices[0]
            if nxt == start:
                break
            if nxt in cycle:
                cycle = []
                break
            previous, current = current, nxt
        if cycle and len(cycle) == len(component):
            loops.append(np.asarray([
                min(source_by_welded[weld_id]) for weld_id in cycle
            ], dtype=np.int64))
    return sorted(loops, key=lambda loop: (int(loop[0]), len(loop)))


def select_eye_margin_loop(
    vertices: np.ndarray,
    loops: list[np.ndarray],
    eye_centre: np.ndarray,
    eye_aabb: tuple[np.ndarray, np.ndarray],
    up_axis: int,
    minimum_vertices: int = 10,
) -> dict:
    """Select one anatomical x/y-overlapping eye loop, then its upper margin."""
    verts = np.asarray(vertices, dtype=float)
    centre = np.asarray(eye_centre, dtype=float)
    proof_min, proof_max = (np.asarray(value, dtype=float) for value in eye_aabb)
    horizontal_axes = sorted({0, up_axis})
    candidates = []
    for loop_index, loop in enumerate(loops):
        points = verts[loop]
        loop_min, loop_max = points.min(axis=0), points.max(axis=0)
        overlaps = all(
            loop_max[axis] >= proof_min[axis] and loop_min[axis] <= proof_max[axis]
            for axis in horizontal_axes
        )
        if not overlaps:
            continue
        distance = float(np.linalg.norm(points.mean(axis=0) - centre))
        candidates.append((distance, loop_index, loop))
    if not candidates:
        return {"status": "no-eye-opening-loop", "loop": np.asarray([], dtype=np.int64), "margin": np.asarray([], dtype=np.int64)}
    _, loop_index, loop = min(candidates, key=lambda row: (row[0], row[1]))
    margin = loop[verts[loop, up_axis] > centre[up_axis]]
    return {
        "status": "ok" if len(margin) >= minimum_vertices else "margin-below-minimum",
        "loopIndex": loop_index,
        "loop": loop,
        "margin": margin,
    }


def no_new_penetration(main_counts: dict, patched_counts: dict) -> bool:
    """M3: each patched per-card/per-pose count may not exceed main."""
    return all(
        int(patched_counts.get(key, 0)) <= int(main_counts.get(key, 0))
        for key in set(main_counts) | set(patched_counts)
    )


def eye_horizontal_axis(
    eye_centres: dict[str, np.ndarray], up_axis: int
) -> np.ndarray:
    """Return the unit left-to-right eye line projected off the up axis."""
    if up_axis not in (0, 1, 2):
        raise ValueError(f"up_axis must be 0, 1, or 2, got {up_axis!r}")
    axis = (
        np.asarray(eye_centres["right"], dtype=float)
        - np.asarray(eye_centres["left"], dtype=float)
    )
    axis[up_axis] = 0.0
    length = float(np.linalg.norm(axis))
    if length <= 1.0e-12:
        raise ValueError("projected left-right eye line has zero length")
    return axis / length


def moving_lid_upper_hull(
    body_vertices: np.ndarray,
    body_closure_delta: np.ndarray,
    eye_centre: np.ndarray,
    horizontal_axis: np.ndarray,
    up_axis: int,
    vertex_source: str = "body",
    epsilon_m: float = LID_MOVE_EPS_M,
) -> dict:
    """Build the r8 upper hull of moving upper-lid body vertices.

    The explicit ``vertex_source`` assertion is a counterweight: substituting
    a lash root or eye-shell point for the denominator is refused. Points are
    ``(horizontal projection, abs(closure dy))``. Coincident x positions keep
    the greatest magnitude (then lowest vertex id), and the clockwise half of
    monotone chain is the upper hull. A real notch is deliberately bridged,
    conservatively increasing the margin magnitude and lowering travelPct.
    """
    if vertex_source != "body":
        raise ValueError(
            "hull vertex must be a body vertex; "
            f"refusing vertex_source={vertex_source!r}"
        )
    vertices = np.asarray(body_vertices, dtype=float)
    delta = np.asarray(body_closure_delta, dtype=float)
    centre = np.asarray(eye_centre, dtype=float)
    axis = np.asarray(horizontal_axis, dtype=float)
    if vertices.shape != delta.shape or vertices.ndim != 2 or vertices.shape[1] != 3:
        raise ValueError("body vertices and closure delta must be matching Nx3 arrays")
    if up_axis not in (0, 1, 2):
        raise ValueError(f"up_axis must be 0, 1, or 2, got {up_axis!r}")
    axis_length = float(np.linalg.norm(axis))
    if abs(axis_length - 1.0) > 1.0e-9 or abs(axis[up_axis]) > 1.0e-12:
        raise ValueError("horizontal_axis must be unit length and perpendicular to up_axis")
    projection = (vertices - centre) @ axis
    moving_ids = np.flatnonzero(
        (vertices[:, up_axis] > centre[up_axis])
        & (np.abs(delta[:, up_axis]) > epsilon_m)
    )
    if len(moving_ids) < 2:
        raise ValueError("moving upper-lid hull needs at least two body vertices")
    by_x: dict[float, int] = {}
    for vertex_index in moving_ids:
        x = float(projection[vertex_index])
        incumbent = by_x.get(x)
        if incumbent is None or (
            abs(float(delta[vertex_index, up_axis])), -int(vertex_index)
        ) > (
            abs(float(delta[incumbent, up_axis])), -int(incumbent)
        ):
            by_x[x] = int(vertex_index)
    candidates = [{
        "vertexIndex": vertex_index,
        "x": x,
        "dy": float(delta[vertex_index, up_axis]),
        "source": "body",
    } for x, vertex_index in sorted(by_x.items())]
    if len(candidates) < 2:
        raise ValueError("moving upper-lid hull has no horizontal span")

    def cross(a: dict, b: dict, c: dict) -> float:
        return ((b["x"] - a["x"]) * (abs(c["dy"]) - abs(a["dy"]))
                - (abs(b["dy"]) - abs(a["dy"])) * (c["x"] - a["x"]))

    points: list[dict] = []
    for candidate in candidates:
        while len(points) >= 2 and cross(points[-2], points[-1], candidate) >= 0.0:
            points.pop()
        points.append(candidate)
    return {
        "status": "ok",
        "points": points,
    }


def interpolate_lid_upper_hull(hull: dict, x: float) -> dict:
    """Linearly interpolate the body-vertex upper hull at one card root x."""
    points = hull.get("points", [])
    if any(point.get("source") != "body" for point in points):
        raise ValueError("hull vertex must be a body vertex")
    if len(points) < 2:
        raise ValueError("moving upper-lid hull needs at least two points")
    x = float(x)
    if x < points[0]["x"] or x > points[-1]["x"]:
        return {"status": "no_margin", "x": x, "marginDy": None}
    for point in points:
        if abs(x - point["x"]) <= 1.0e-12:
            return {"status": "ok", "x": x, "marginDy": float(point["dy"])}
    for left, right in zip(points, points[1:]):
        if left["x"] <= x <= right["x"]:
            span = right["x"] - left["x"]
            if span <= 0:
                continue
            t = (x - left["x"]) / span
            magnitude = abs(left["dy"]) + t * (abs(right["dy"]) - abs(left["dy"]))
            sign_source = left if left["dy"] * right["dy"] >= 0 or t <= 0.5 else right
            return {
                "status": "ok",
                "x": x,
                "marginDy": float(np.copysign(magnitude, sign_source["dy"])),
            }
    raise ValueError("upper-hull interpolation could not bracket in-span x")


# Compatibility names for the Blender repacker and earlier evidence callers.
moving_lid_envelope = moving_lid_upper_hull
interpolate_lid_envelope = interpolate_lid_upper_hull


def bind_lash_cards(
    lash_vertices: np.ndarray,
    lash_triangles: np.ndarray,
    regions: dict[tuple[str, str], LidRegion],
    actor: str,
    max_snap_m: float = MAX_SNAP_M,
):
    """Seat/follow cards on one own-region triangle; flag instead of forcing."""
    lash = np.asarray(lash_vertices, dtype=float)
    cards = connected_cards(len(lash), lash_triangles)
    if not cards:
        raise ValueError(f"{actor}: no lash cards")
    snapped = lash.copy()
    morphs = {
        "eye-left-closure": np.zeros_like(lash),
        "eye-right-closure": np.zeros_like(lash),
    }
    bindings: list[CardBinding] = []
    ordered_regions = [regions[k] for k in sorted(regions)]
    if len(ordered_regions) != 4:
        raise ValueError(f"{actor}: expected four lid regions, found {len(ordered_regions)}")

    for card_index, card in enumerate(cards):
        # Root-band membership is based on the closure-defined lid surface,
        # never the general body. Ties break by original vertex index.
        distances = []
        for vi in card:
            distances.append(min(
                closest_point_on_triangles(
                    lash[vi], region.vertices, region.triangles
                )[3]
                for region in ordered_regions
            ))
        root_count = max(1, (len(card) + 1) // 2)
        order = np.lexsort((card, np.asarray(distances)))
        roots = np.sort(card[order[:root_count]])

        root_centroid = lash[roots].mean(axis=0)
        side_rows = []
        for side in ("left", "right"):
            side_distance = min(
                closest_point_on_triangles(
                    root_centroid,
                    regions[(side, lid)].vertices,
                    regions[(side, lid)].triangles,
                )[3]
                for lid in ("lower", "upper")
            )
            side_rows.append((side_distance, side))
        side = min(side_rows)[1]
        side_region = regions[(side, "upper")]
        lid = "upper" if root_centroid[side_region.up_axis] > side_region.eye_centre[side_region.up_axis] else "lower"
        region = regions[(side, lid)]

        root_matches = []
        for root_vertex in roots:
            for ti, body_ids in enumerate(region.triangles):
                try:
                    seat_point, bary = closest_point_on_triangle(
                        lash[root_vertex], *region.vertices[body_ids]
                    )
                except ValueError:
                    continue
                translation = seat_point - lash[root_vertex]
                patched_root_up = root_centroid[region.up_axis] + translation[region.up_axis]
                preserves_class = (
                    patched_root_up > region.eye_centre[region.up_axis]
                    if lid == "upper"
                    else patched_root_up <= region.eye_centre[region.up_axis]
                )
                if preserves_class:
                    distance = float(np.linalg.norm(translation))
                    root_matches.append((distance, int(root_vertex), ti, seat_point, bary))
        if not root_matches:
            raise ValueError(
                f"{actor}: card {card_index} has no {side} {lid} seat preserving raw class"
            )
        seat_distance, root_vertex, ti, seat_point, bary = min(
            root_matches, key=lambda row: (row[0], row[1], row[2])
        )
        body_ids = region.triangles[ti]
        flagged = seat_distance > max_snap_m
        if flagged:
            # F4: preserve original bytes geometrically for this card and give
            # it zero closure motion. The caller records the unreviewed flag.
            translation = np.zeros(3, dtype=float)
            closure_delta = np.zeros(3, dtype=float)
        else:
            translation = seat_point - lash[root_vertex]
            closure_delta = bary @ region.closure_delta[body_ids]
            snapped[card] += translation
            morphs[f"eye-{side}-closure"][card] = closure_delta
        bindings.append(
            CardBinding(
                card_index=card_index,
                vertex_indices=card,
                root_indices=roots,
                side=side,
                lid=lid,
                seat_triangle_index=ti,
                follow_triangle_index=ti,
                root_vertex_index=root_vertex,
                barycentric=bary,
                seat_point=seat_point,
                seat_distance_m=seat_distance,
                translation=translation,
                closure_delta=closure_delta,
                flagged_over_max_snap=flagged,
            )
        )
    return snapped, morphs, bindings


def points_inside_mesh_winding(
    points: np.ndarray,
    mesh_vertices: np.ndarray,
    mesh_triangles: np.ndarray,
    threshold: float = 0.5,
) -> np.ndarray:
    """Classify points using generalized winding number (solid angle / 4pi)."""
    points = np.asarray(points, dtype=float).reshape(-1, 3)
    vertices = np.asarray(mesh_vertices, dtype=float)
    tri = _as_triangles(mesh_triangles)
    out = np.zeros(len(points), dtype=bool)
    # Classify against each closed connected shell independently, then OR.
    # This prevents opposite-oriented nested globe/cornea shells cancelling.
    parent = np.arange(len(vertices), dtype=np.int64)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = int(parent[a])
        return a

    for ids in tri:
        root = find(int(ids[0]))
        for vertex in ids[1:]:
            other = find(int(vertex))
            if root != other:
                parent[other] = root
    shells: dict[int, list[np.ndarray]] = {}
    for ids in tri:
        shells.setdefault(find(int(ids[0])), []).append(ids)

    for shell_triangles in shells.values():
        shell_tri = np.asarray(shell_triangles, dtype=np.int64)
        used = np.unique(shell_tri)
        mesh_min, mesh_max = vertices[used].min(axis=0), vertices[used].max(axis=0)
        candidates = np.where(
            (~out) & np.all((points >= mesh_min) & (points <= mesh_max), axis=1)
        )[0]
        triangle_vertices = vertices[shell_tri]
        # Vectorize the triangle dimension.  A small point batch keeps the
        # high-poly cornea path bounded while avoiding a Python loop per triangle.
        for start in range(0, len(candidates), 16):
            point_ids = candidates[start:start + 16]
            rel = triangle_vertices[None, :, :, :] - points[point_ids, None, None, :]
            a, b, c = rel[:, :, 0], rel[:, :, 1], rel[:, :, 2]
            la = np.linalg.norm(a, axis=2)
            lb = np.linalg.norm(b, axis=2)
            lc = np.linalg.norm(c, axis=2)
            boundary = np.any(
                np.minimum(np.minimum(la, lb), lc) < 1.0e-12, axis=1
            )
            numerator = np.einsum("bti,bti->bt", a, np.cross(b, c))
            denominator = (
                la * lb * lc
                + np.einsum("bti,bti->bt", a, b) * lc
                + np.einsum("bti,bti->bt", b, c) * la
                + np.einsum("bti,bti->bt", c, a) * lb
            )
            total = np.sum(2.0 * np.arctan2(numerator, denominator), axis=1)
            out[point_ids] |= boundary | (
                np.abs(total / (4.0 * np.pi)) > threshold
            )
    return out


def close_mesh_boundary_loops(mesh_vertices, mesh_triangles):
    """Return a closed measurement copy by fan-capping manifold boundary loops.

    No source eyeball vertex is moved.  Each boundary loop gets one centroid
    vertex and consistently reversed cap triangles.  Non-manifold boundaries
    fail closed because their volume has no unambiguous inside.
    """
    vertices = np.asarray(mesh_vertices, dtype=float)
    tri = _as_triangles(mesh_triangles)
    edge_rows: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for a, b, c in tri:
        for start, end in ((a, b), (b, c), (c, a)):
            key = tuple(sorted((int(start), int(end))))
            edge_rows.setdefault(key, []).append((int(start), int(end)))
    nonmanifold = [edge for edge, rows in edge_rows.items() if len(rows) > 2]
    if nonmanifold:
        raise ValueError(f"eyeball mesh has {len(nonmanifold)} non-manifold edges")
    boundary_directed = [rows[0] for rows in edge_rows.values() if len(rows) == 1]
    if not boundary_directed:
        return vertices.copy(), tri.copy(), {
            "boundaryEdges": 0, "boundaryLoops": 0, "capTriangles": 0
        }
    adjacency: dict[int, list[int]] = {}
    directed = set(boundary_directed)
    for a, b in boundary_directed:
        adjacency.setdefault(a, []).append(b)
        adjacency.setdefault(b, []).append(a)
    bad_degree = [vertex for vertex, neighbours in adjacency.items() if len(neighbours) != 2]
    if bad_degree:
        raise ValueError(
            f"eyeball boundary is not closed loops; {len(bad_degree)} verts have degree != 2"
        )
    remaining = {tuple(sorted(edge)) for edge in boundary_directed}
    loops = []
    while remaining:
        first_edge = min(remaining)
        first, current = first_edge
        loop = [first, current]
        remaining.remove(first_edge)
        while current != first:
            choices = [
                nxt for nxt in adjacency[current]
                if tuple(sorted((current, nxt))) in remaining
            ]
            if not choices:
                raise ValueError("eyeball boundary loop did not close")
            nxt = min(choices)
            remaining.remove(tuple(sorted((current, nxt))))
            if nxt == first:
                break
            loop.append(nxt)
            current = nxt
        # Traverse in the source face-edge direction; cap edges must reverse it.
        source_votes = sum(
            (loop[i], loop[(i + 1) % len(loop)]) in directed
            for i in range(len(loop))
        )
        if source_votes < len(loop) / 2:
            loop.reverse()
        loops.append(loop)
    closed_vertices = vertices.tolist()
    caps = []
    for loop in loops:
        centre_index = len(closed_vertices)
        closed_vertices.append(vertices[loop].mean(axis=0).tolist())
        for i, a in enumerate(loop):
            b = loop[(i + 1) % len(loop)]
            caps.append((a, centre_index, b))
    closed_triangles = np.concatenate([tri, np.asarray(caps, dtype=np.int64)])
    return np.asarray(closed_vertices), closed_triangles, {
        "boundaryEdges": len(boundary_directed),
        "boundaryLoops": len(loops),
        "capTriangles": len(caps),
    }


def count_inside_mesh(points, mesh_vertices, mesh_triangles) -> int:
    return int(points_inside_mesh_winding(points, mesh_vertices, mesh_triangles).sum())
