#!/usr/bin/env python3
"""Focused pure-NumPy proof for lash_follow_core.py."""

import importlib.util
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("lash_follow_core", HERE / "lash_follow_core.py")
core = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = core
SPEC.loader.exec_module(core)


def _lid_fixture():
    # Four separate triangles: left/right and lower/upper.  Every vertex moves
    # above the 1e-6 m epsilon for its side; the opposite side stays zero.
    vertices = np.array(
        [
            [-2.0, 0.0, -1.0], [-1.0, 0.0, -1.0], [-1.5, 1.0, -1.0],
            [-2.0, 0.0, 1.0], [-1.0, 0.0, 1.0], [-1.5, 1.0, 1.0],
            [1.0, 0.0, -1.0], [2.0, 0.0, -1.0], [1.5, 1.0, -1.0],
            [1.0, 0.0, 1.0], [2.0, 0.0, 1.0], [1.5, 1.0, 1.0],
        ],
        dtype=float,
    )
    triangles = np.arange(12).reshape(-1, 3)
    left = np.zeros_like(vertices)
    right = np.zeros_like(vertices)
    left[:6, 1] = -0.002
    right[6:, 1] = -0.003
    return vertices, triangles, {"left": left, "right": right}


def _regions(body, body_tri, deltas, up_axis=2):
    centres = {"left": np.array([-1.5, 0.0, 0.0]), "right": np.array([1.5, 0.0, 0.0])}
    aabbs = {
        "left": (np.array([-3.0, -1.0, -2.0]), np.array([0.0, 2.0, 2.0])),
        "right": (np.array([0.0, -1.0, -2.0]), np.array([3.0, 2.0, 2.0])),
    }
    return core.build_lid_regions(body, body_tri, deltas, centres, aabbs, up_axis)


def test_regions_snap_and_rigid_follow():
    body, body_tri, deltas = _lid_fixture()
    regions = _regions(body, body_tri, deltas)
    assert set(regions) == {
        ("left", "lower"), ("left", "upper"),
        ("right", "lower"), ("right", "upper"),
    }
    assert all(r.eye_centre[r.up_axis] == 0.0 for r in regions.values())

    # Two index-connected 4-vertex cards, each with its root edge 1 mm in front
    # of its own upper lid.  Grouping is by consecutive fours, not topology.
    lash = np.array(
        [
            [-1.7, 0.2, 1.001], [-1.3, 0.2, 1.001],
            [-1.6, 0.4, 1.004], [-1.4, 0.4, 1.004],
            [1.3, 0.2, 1.001], [1.7, 0.2, 1.001],
            [1.4, 0.4, 1.004], [1.6, 0.4, 1.004],
        ]
    )
    lash_tri = np.array(
        [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]]
    )
    snapped, morphs, bindings = core.bind_lash_cards(
        lash, lash_tri, regions, actor="fixture", max_snap_m=1.0
    )
    assert len(bindings) == 2
    cards = core.connected_cards(len(lash), lash_tri)
    assert [card.tolist() for card in cards] == [[0, 1, 2, 3], [4, 5, 6, 7]]
    assert [b.side for b in bindings] == ["left", "right"]
    for binding in bindings:
        # One translation and one closure delta are rigid across the card.
        card = binding.vertex_indices
        np.testing.assert_allclose(
            snapped[card] - lash[card], np.tile(binding.translation, (len(card), 1))
        )
        own = morphs[f"eye-{binding.side}-closure"][card]
        np.testing.assert_allclose(own, np.tile(binding.closure_delta, (len(card), 1)))
        other = "right" if binding.side == "left" else "left"
        np.testing.assert_array_equal(morphs[f"eye-{other}-closure"][card], 0.0)
    np.testing.assert_allclose(bindings[0].closure_delta, [0.0, -0.002, 0.0])
    np.testing.assert_allclose(bindings[1].closure_delta, [0.0, -0.003, 0.0])


def test_upper_region_accepts_exactly_one_moving_vertex():
    body, body_tri, deltas = _lid_fixture()
    deltas["left"][3:6] = 0
    deltas["left"][3, 1] = -0.002
    regions = _regions(body, body_tri, deltas)
    assert regions[("left", "upper")].triangles.tolist() == [[3, 4, 5]]


def test_connected_strip_is_one_rigid_card():
    body, body_tri, deltas = _lid_fixture()
    regions = _regions(body, body_tri, deltas)
    lash = np.array(
        [
            [-1.7, 0.2, 1.001], [-1.3, 0.2, 1.001],
            [-1.6, 0.4, 1.004], [-1.4, 0.4, 1.004],
        ]
    )
    # Three quads sharing edges: one 8-vertex connected strip, not two fixed fours.
    lash = np.concatenate([lash, lash + [0.0, 0.2, 0.0]])
    strip_tri = np.array([[0, 1, 2], [0, 2, 3], [2, 3, 4], [3, 4, 5], [4, 5, 6], [5, 6, 7]])
    snapped, morphs, bindings = core.bind_lash_cards(
        lash, strip_tri, regions, actor="strip-fixture", max_snap_m=1.0
    )
    assert len(bindings) == 1
    np.testing.assert_allclose(snapped - lash, np.tile(bindings[0].translation, (8, 1)))
    np.testing.assert_allclose(morphs["eye-left-closure"], np.tile(bindings[0].closure_delta, (8, 1)))


def test_required_up_axis_catches_gltf_depth_height_confusion():
    body, body_tri, deltas = _lid_fixture()
    # Fixture height is z and depth is y.  z-up yields two regions; the wrong
    # y-up frame puts every triangle centroid on the split and leaves lower empty.
    correct = _regions(body, body_tri, deltas)
    assert set(correct) == {("left", "lower"), ("left", "upper"), ("right", "lower"), ("right", "upper")}
    try:
        _regions(body, body_tri, deltas, up_axis=1)
    except ValueError as exc:
        assert "lower lid region empty" in str(exc)
    else:
        raise AssertionError("wrong up axis did not misassign the fixture")


def test_unmatched_is_flagged_and_left_original():
    body, body_tri, deltas = _lid_fixture()
    regions = _regions(body, body_tri, deltas)
    lash = np.array(
        [
            [-1.7, 0.2, 1.02], [-1.3, 0.2, 1.02],
            [-1.6, 0.4, 1.02], [-1.4, 0.4, 1.02],
        ]
    )
    snapped, morphs, bindings = core.bind_lash_cards(
        lash, np.array([[0, 1, 2], [0, 2, 3]]), regions, "actor-a", 0.00455
    )
    assert bindings[0].flagged_over_max_snap
    assert bindings[0].snap_distance_m > 0.00455
    np.testing.assert_array_equal(snapped, lash)
    np.testing.assert_array_equal(morphs["eye-left-closure"], 0.0)
    np.testing.assert_array_equal(morphs["eye-right-closure"], 0.0)


def test_seat_and_follow_triangle_mismatch_fails():
    try:
        core.CardBinding(
            card_index=7,
            vertex_indices=np.array([0, 1, 2]),
            root_indices=np.array([0]),
            side="left",
            lid="upper",
            seat_triangle_index=2,
            follow_triangle_index=3,
            root_vertex_index=0,
            barycentric=np.array([1.0, 0.0, 0.0]),
            seat_point=np.zeros(3),
            seat_distance_m=0.0,
            translation=np.zeros(3),
            closure_delta=np.zeros(3),
            flagged_over_max_snap=False,
        )
    except ValueError as exc:
        assert "seat triangle and follow triangle must be identical" in str(exc)
    else:
        raise AssertionError("seat != follow was accepted")


def test_nearest_moving_triangle_can_differ_from_own_region_triangle():
    # The lower triangle reaches up to the upper-card root and is globally
    # nearest, but its centroid is below lidCentre. The card's root centroid
    # is above lidCentre, so F1 must seat/follow on the farther UPPER region.
    vertices = np.array([
        [-2.0, 0.0, -2.0], [-1.0, 0.0, -2.0], [-1.5, 0.0, 1.0],
        [-2.0, 0.2, 1.2], [-1.0, 0.2, 1.2], [-1.5, 0.2, 2.0],
        [1.0, 0.0, -1.0], [2.0, 0.0, -1.0], [1.5, 0.0, -0.5],
        [1.0, 0.2, 0.5], [2.0, 0.2, 0.5], [1.5, 0.2, 1.0],
    ])
    delta_left = np.tile([0.0, -0.002, 0.0], (12, 1))
    delta_right = np.tile([0.0, -0.003, 0.0], (12, 1))
    regions = {
        ("left", "lower"): core.LidRegion("left", "lower", vertices, np.array([[0, 1, 2]]), delta_left, np.array([-1.5, 0, 0]), np.array([-3, -1, -3]), np.array([0, 1, 3]), 2),
        ("left", "upper"): core.LidRegion("left", "upper", vertices, np.array([[3, 4, 5]]), delta_left, np.array([-1.5, 0, 0]), np.array([-3, -1, -3]), np.array([0, 1, 3]), 2),
        ("right", "lower"): core.LidRegion("right", "lower", vertices, np.array([[6, 7, 8]]), delta_right, np.array([1.5, 0, 0]), np.array([0, -1, -3]), np.array([3, 1, 3]), 2),
        ("right", "upper"): core.LidRegion("right", "upper", vertices, np.array([[9, 10, 11]]), delta_right, np.array([1.5, 0, 0]), np.array([0, -1, -3]), np.array([3, 1, 3]), 2),
    }
    lash = np.array([
        [-1.6, 0.0, 1.0], [-1.4, 0.0, 1.0],
        [-1.6, 0.0, 1.1], [-1.4, 0.0, 1.1],
    ])
    lash_tri = np.array([[0, 1, 2], [1, 2, 3]])
    nearest_lower = core.closest_point_on_triangles(lash[0], vertices, np.array([[0, 1, 2]]))[3]
    snapped, morphs, bindings = core.bind_lash_cards(
        lash, lash_tri, regions, "own-region-fixture", max_snap_m=1.0
    )
    binding = bindings[0]
    assert nearest_lower < binding.snap_distance_m
    assert binding.lid == "upper"
    assert binding.seat_triangle_index == binding.follow_triangle_index == 0
    np.testing.assert_allclose(morphs["eye-left-closure"], np.tile([0.0, -0.002, 0.0], (4, 1)))


def test_eye_centroid_wins_when_region_mean_would_disagree():
    body, body_tri, deltas = _lid_fixture()
    # A moving-region mean at z=0 would call this upper.  The anatomical eye
    # centroid at z=.5 makes the z=.3 root lower while retaining a z=1 upper region.
    centres = {"left": np.array([-1.5, 0, .5]), "right": np.array([1.5, 0, .5])}
    aabbs = {
        "left": (np.array([-3, -1, -2]), np.array([0, 2, 2])),
        "right": (np.array([0, -1, -2]), np.array([3, 2, 2])),
    }
    regions = core.build_lid_regions(body, body_tri, deltas, centres, aabbs, 2)
    lash = np.array([[-1.7, .2, .3], [-1.3, .2, .3], [-1.6, .4, .4], [-1.4, .4, .4]])
    _, _, bindings = core.bind_lash_cards(lash, np.array([[0, 1, 2], [0, 2, 3]]), regions, "centroid-fixture", 1.0)
    assert bindings[0].lid == "lower"


def test_raw_class_known_good_is_preserved_by_non_crossing_patch():
    body, body_tri, deltas = _lid_fixture()
    regions = _regions(body, body_tri, deltas)
    lash = np.array([[-1.7, .2, 1.001], [-1.3, .2, 1.001], [-1.6, .4, 1.004], [-1.4, .4, 1.004]])
    snapped, _, bindings = core.bind_lash_cards(lash, np.array([[0, 1, 2], [0, 2, 3]]), regions, "raw-class", 1.0)
    raw = [binding.lid for binding in bindings]
    # Spell out the production comparison without hiding it in the binding.
    patched = ["upper" if snapped[b.root_indices, 2].mean() > regions[(b.side, "upper")].eye_centre[2] else "lower" for b in bindings]
    assert patched == raw == ["upper"]


def test_welded_boundary_margin_on_small_open_hole():
    # Two body primitives each carry alternating annulus faces and their own
    # UV-seam vertex copies. Only a cross-primitive position weld reconstructs
    # the two 24-vertex boundary cycles.
    count = 24
    angle = np.arange(count) * 2 * np.pi / count
    outer = np.column_stack([np.cos(angle), np.sin(angle), np.zeros(count)])
    inner = np.column_stack([.5 * np.cos(angle), .5 * np.sin(angle), np.zeros(count)])
    primitive = np.concatenate([outer, inner])
    faces = []
    for i in range(count):
        j = (i + 1) % count
        faces.extend([[i, j, count + j], [i, count + j, count + i]])
    faces = np.asarray(faces)
    first, second = faces[::2], faces[1::2] + len(primitive)
    vertices = np.concatenate([primitive, primitive.copy()])
    triangles = np.concatenate([first, second])
    loops = core.welded_boundary_loops(vertices, triangles, 1e-6)
    assert sorted(map(len, loops)) == [24, 24]
    selected = core.select_eye_margin_loop(
        vertices, loops, np.array([0, -.2, 0]),
        (np.array([-.7, -.7, -.1]), np.array([.7, .7, .1])), 1, 10,
    )
    assert selected["status"] == "ok"
    assert len(selected["loop"]) == 24 and len(selected["margin"]) >= 10

    refused = core.select_eye_margin_loop(
        vertices, [np.asarray([0, 1, 2, 3])], np.zeros(3),
        (np.array([-2, -2, -1]), np.array([2, 2, 1])), 1, 10,
    )
    assert refused["status"] == "margin-below-minimum"


def test_r3_no_new_penetration_rule():
    assert core.no_new_penetration({("card-1", "rest"): 4}, {("card-1", "rest"): 4})
    assert core.no_new_penetration({("card-1", "rest"): 4}, {("card-1", "rest"): 2})
    assert not core.no_new_penetration({("card-1", "rest"): 4}, {("card-1", "rest"): 5})


def _envelope_fixture():
    centre = np.zeros(3)
    axis = np.array([1., 0., 0.])
    body = np.array([[0., .1, 0.], [.1, .1, 0.], [.2, .1, 0.], [.3, .1, 0.]])
    delta = np.array([[0., -.002, 0.], [0., -.004, 0.], [0., -.006, 0.], [0., -.008, 0.]])
    return body, delta, centre, axis


def test_narrow_card_interpolates_envelope_instead_of_zero():
    body, delta, centre, axis = _envelope_fixture()
    envelope = core.moving_lid_upper_hull(body, delta, centre, axis, 1)
    # A root narrower than any vertex spacing still reads linear interpolation.
    row = core.interpolate_lid_envelope(envelope, .15)
    assert row["status"] == "ok" and np.isclose(row["marginDy"], -.005)


def test_envelope_outside_span_is_no_margin():
    body, delta, centre, axis = _envelope_fixture()
    envelope = core.moving_lid_upper_hull(body, delta, centre, axis, 1)
    row = core.interpolate_lid_envelope(envelope, .31)
    assert row == {"status": "no_margin", "x": .31, "marginDy": None}


def test_one_moving_vertex_counterweight_fails_under_80():
    # Exercise the production binder twice: first on the strong tri, then on
    # an r7-eligible tri with exactly one weak moving vertex. The re-seat uses
    # the real closest point, barycentrics, and rigid follow donor.
    weak_tri = np.array([
        [-1.7, .1, 0.], [-1.3, .1, 0.], [-1.5, .3, 0.],
    ])
    dummy = weak_tri + [0., 0., 10.]
    region_vertices = np.vstack([dummy, weak_tri])
    strong_delta = np.zeros_like(region_vertices)
    strong_delta[3:6, 1] = -.006
    weak_delta = np.zeros_like(region_vertices)
    weak_delta[3, 1] = -.0003
    eye = np.array([-1.5, 0., 0.])
    proof_min, proof_max = np.array([-3., -1., -2.]), np.array([0., 2., 12.])

    def region(side, lid, triangles, delta):
        return core.LidRegion(side, lid, region_vertices, np.asarray(triangles), delta,
                              eye if side == "left" else -eye,
                              proof_min, proof_max, 1)

    inert_left = np.tile([0., -.002, 0.], (6, 1))
    inert_right = np.tile([0., -.003, 0.], (6, 1))
    common = {
        ("left", "lower"): region("left", "lower", [[0, 1, 2]], inert_left),
        ("right", "lower"): region("right", "lower", [[0, 1, 2]], inert_right),
        ("right", "upper"): region("right", "upper", [[0, 1, 2]], inert_right),
    }
    before_regions = {**common, ("left", "upper"): region("left", "upper", [[3, 4, 5]], strong_delta)}
    after_regions = {**common, ("left", "upper"): region("left", "upper", [[0, 1, 2], [3, 4, 5]], weak_delta)}
    lash = np.array([
        [-1.65, .12, .001], [-1.35, .12, .001],
        [-1.6, .28, .004], [-1.4, .28, .004],
    ])
    lash_tri = np.array([[0, 1, 2], [1, 2, 3]])
    _, _, before = core.bind_lash_cards(lash, lash_tri, before_regions, "cw-before", 1.)
    _, _, after = core.bind_lash_cards(lash, lash_tri, after_regions, "cw-after", 1.)
    assert before[0].seat_triangle_index == 0
    assert after[0].seat_triangle_index == 1
    assert np.count_nonzero(np.linalg.norm(weak_delta[[3, 4, 5]], axis=1) > core.LID_MOVE_EPS_M) == 1

    envelope_body = np.array([[-1.8, .2, 0.], [-1.6, .2, 0.], [-1.4, .2, 0.], [-1.2, .2, 0.]])
    envelope_delta = np.tile([0., -.006, 0.], (4, 1))
    envelope = core.moving_lid_envelope(envelope_body, envelope_delta, eye, np.array([1., 0., 0.]), 1)
    root_x = float((lash[after[0].root_indices].mean(axis=0) - eye) @ np.array([1., 0., 0.]))
    margin = core.interpolate_lid_envelope(envelope, root_x)["marginDy"]
    before_pct = 100 * before[0].closure_delta[1] / margin
    after_pct = 100 * after[0].closure_delta[1] / margin
    assert np.isclose(before_pct, 100)
    assert abs(weak_delta[3, 1]) < .1 * abs(margin)
    assert after_pct < 80


def test_dense_inner_lid_vertices_do_not_change_upper_hull():
    centre = np.zeros(3)
    axis = np.array([1., 0., 0.])
    sparse_body = np.array([[0., .1, 0.], [.3, .1, 0.], [.6, .1, 0.]])
    sparse_delta = np.array([[0., -.006, 0.], [0., -.008, 0.], [0., -.006, 0.]])
    dense_body = np.vstack([sparse_body, [[x, .1, 0.] for x in np.linspace(.05, .55, 21)]])
    dense_delta = np.vstack([sparse_delta, [[0., -.002, 0.] for _ in range(21)]])
    sparse = core.moving_lid_upper_hull(sparse_body, sparse_delta, centre, axis, 1)
    dense = core.moving_lid_upper_hull(dense_body, dense_delta, centre, axis, 1)
    assert [p["vertexIndex"] for p in sparse["points"]] == [0, 1, 2]
    assert [p["vertexIndex"] for p in dense["points"]] == [0, 1, 2]
    for x in np.linspace(0., .6, 13):
        assert np.isclose(
            core.interpolate_lid_upper_hull(sparse, x)["marginDy"],
            core.interpolate_lid_upper_hull(dense, x)["marginDy"],
        )


def test_upper_hull_notch_counterweight_is_conservative():
    centre = np.zeros(3)
    axis = np.array([1., 0., 0.])
    body = np.array([[0., .1, 0.], [.5, .1, 0.], [1., .1, 0.]])
    delta = np.array([[0., -.008, 0.], [0., -.002, 0.], [0., -.008, 0.]])
    hull = core.moving_lid_upper_hull(body, delta, centre, axis, 1)
    hull_value = core.interpolate_lid_upper_hull(hull, .5)["marginDy"]
    notch_value = delta[1, 1]
    print("COUNTERWEIGHT hull notch", "hull", hull_value, "notch-vert", notch_value)
    assert [p["vertexIndex"] for p in hull["points"]] == [0, 2]
    assert abs(hull_value) > abs(notch_value)
    assert abs(100 * -.004 / hull_value) < abs(100 * -.004 / notch_value)


def test_static_vertex_never_becomes_envelope_point_and_provenance_refuses():
    body, delta, centre, axis = _envelope_fixture()
    # Vertex 4 shares bin 1 with moving vertex 1 but has a larger static height.
    body = np.vstack([body, [.11, .5, 0.]])
    delta = np.vstack([delta, [0., 0., 0.]])
    envelope = core.moving_lid_upper_hull(body, delta, centre, axis, 1)
    assert 4 not in [point["vertexIndex"] for point in envelope["points"]]
    bad = {**envelope, "points": [{**envelope["points"][0], "source": "lash-root"}, *envelope["points"][1:]]}
    try:
        core.interpolate_lid_envelope(bad, .1)
    except ValueError as exc:
        assert "must be a body vertex" in str(exc)
    else:
        raise AssertionError("non-body envelope point was accepted")


def test_winding_inside_outside():
    # Start with an open tetrahedron (one triangular boundary loop), close a
    # measurement copy, then classify without changing its four source verts.
    vertices = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], float)
    triangles = np.array([[0, 2, 1], [0, 1, 3], [0, 3, 2]])
    closed_vertices, closed_triangles, closure = core.close_mesh_boundary_loops(
        vertices, triangles
    )
    assert closure == {"boundaryEdges": 3, "boundaryLoops": 1, "capTriangles": 3}
    np.testing.assert_array_equal(closed_vertices[:4], vertices)
    points = np.array([[0.1, 0.1, 0.1], [2.0, 2.0, 2.0]])
    np.testing.assert_array_equal(
        core.points_inside_mesh_winding(points, closed_vertices, closed_triangles),
        [True, False],
    )
    assert core.count_inside_mesh(points, closed_vertices, closed_triangles) == 1


if __name__ == "__main__":
    test_regions_snap_and_rigid_follow()
    test_upper_region_accepts_exactly_one_moving_vertex()
    test_connected_strip_is_one_rigid_card()
    test_required_up_axis_catches_gltf_depth_height_confusion()
    test_unmatched_is_flagged_and_left_original()
    test_seat_and_follow_triangle_mismatch_fails()
    test_nearest_moving_triangle_can_differ_from_own_region_triangle()
    test_eye_centroid_wins_when_region_mean_would_disagree()
    test_raw_class_known_good_is_preserved_by_non_crossing_patch()
    test_welded_boundary_margin_on_small_open_hole()
    test_r3_no_new_penetration_rule()
    test_narrow_card_interpolates_envelope_instead_of_zero()
    test_envelope_outside_span_is_no_margin()
    test_one_moving_vertex_counterweight_fails_under_80()
    test_dense_inner_lid_vertices_do_not_change_upper_hull()
    test_upper_hull_notch_counterweight_is_conservative()
    test_static_vertex_never_becomes_envelope_point_and_provenance_refuses()
    test_winding_inside_outside()
    print("PASS lash_follow_core: connected cards, r8 moving-lid upper-hull/interpolation/no_margin/provenance/density/notch counterweight, any-moving upper own-region, same-triangle seat/follow, F4 flags, required up axis, closed winding")
