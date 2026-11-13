#!/usr/bin/env python3
"""Unit tests for rehide-poking-skin.py + backface_hide_select.py (stdlib + numpy).

Runnable as: python3 tools/openclinxr/asset-pipeline/makeclothes/test_rehide_poking_skin.py
or via pytest. Covers the review findings without running the 23-minute tool:

F1/F8 (posed gate): the tool REFUSES (exit 2, naming sample-grade-poses.ts)
  when any of --rays-dir/--poses-meta/--poses-dir is missing. Every missing-arg
  combination is tested individually; there is no bind-only or rule-only
  fallback mode. The pre-existing end-to-end tests (which exercised the bypass)
  now build minimal posed+capture inputs.
F9 (cardinality): the frame set must be exactly the input GLB's clips x 8
  frames; wrong clip names or per-clip counts != 8 refuse loudly.
F2c (selector non-vacuity): greedy_over_frames on a small synthetic scene must
  drop the known triangle whose hide opens see-through (and keep the control).
  Replacing the selector with "return all flagged" fails this test.
"""

import contextlib
import importlib.util
import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location("rehide_poking_skin", HERE / "rehide-poking-skin.py")
assert SPEC is not None and SPEC.loader is not None
REHIDE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = REHIDE
SPEC.loader.exec_module(REHIDE)
import backface_hide_select as SEL  # noqa: E402  (needs sys.path above)


def _build_fixture(tmp: Path, poke_z: float = -0.001, keep_z: float = -0.5) -> Path:
    """Write a micro-GLB with one animation clip; return its path.

    Garment: dense grid (2 cm pitch) at z=0, y in [0.1, 0.6]. Density matters:
    body_hide_mask finds candidate garment vertices through a 1 cm spatial
    hash, so a 4-corner quad has no vertex near the body samples and every
    clearance reads NaN. Body tri0 sits 1 mm behind the garment plane (its
    engine-recovered outward normal points -z, so signed clearance is -1 mm,
    inside the 5 mm hide epsilon -> poking); tri1 sits 500 mm behind, past the
    80 mm search radius -> NaN -> kept. One animation clip ("clipA") is present
    so the posed-cardinality gate has a clip set to check (channels/samplers
    are empty: the tool only reads clip names; geometry comes from meta bins).
    """

    body_v = np.array(
        [
            [0.00, 0.30, poke_z],
            [0.10, 0.30, poke_z],
            [0.05, 0.40, poke_z],
            [0.50, 0.30, keep_z],
            [0.60, 0.30, keep_z],
            [0.55, 0.40, keep_z],
        ],
        dtype=np.float32,
    )
    body_i = np.array([0, 1, 2, 3, 4, 5], dtype=np.uint16)
    xs = np.arange(-0.3, 0.9001, 0.02)
    ys = np.arange(0.1, 0.6001, 0.02)
    gx, gy = np.meshgrid(xs, ys)
    gar_v = np.stack([gx.ravel(), gy.ravel(), np.zeros(gx.size)], axis=1).astype(np.float32)
    nx, ny = len(xs), len(ys)
    quads = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            a, b, c, d = j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i
            quads.append((a, b, c))
            quads.append((a, c, d))
    gar_i = np.asarray(quads, dtype=np.int64).reshape(-1)
    assert gar_v.shape[0] < 65536
    gar_i = gar_i.astype(np.uint16)

    binary = bytearray()
    views = []

    def view(payload: bytes, target: int) -> int:
        while len(binary) % 4:
            binary.append(0)
        off = len(binary)
        binary.extend(payload)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(payload), "target": target})
        return len(views) - 1

    pos_view = view(body_v.tobytes(), 34962)
    idx_view = view(body_i.tobytes(), 34963)
    gpos_view = view(gar_v.tobytes(), 34962)
    gidx_view = view(gar_i.tobytes(), 34963)

    def acc(v: int, comp: int, count: int, typ: str) -> dict:
        return {"bufferView": v, "byteOffset": 0, "componentType": comp, "count": count, "type": typ}

    doc = {
        "asset": {"version": "2.0"},
        "materials": [{"name": "mpfb_skin_test"}, {"name": "openclinxr_hidden_test"}],
        "meshes": [
            {
                "name": "test_body",
                "primitives": [
                    {"attributes": {"POSITION": 0}, "indices": 1, "material": 0},
                    {"attributes": {"POSITION": 0}, "indices": 1, "material": 1},
                ],
            },
            {
                "name": "scrub_shirt",
                "primitives": [{"attributes": {"POSITION": 2}, "indices": 3, "material": 0}],
            },
        ],
        "accessors": [
            acc(pos_view, 5126, 6, "VEC3"),
            acc(idx_view, 5123, 6, "SCALAR"),
            acc(gpos_view, 5126, int(gar_v.shape[0]), "VEC3"),
            acc(gidx_view, 5123, int(gar_i.size), "SCALAR"),
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
        "animations": [{"name": "clipA", "channels": [], "samplers": []}],
    }
    path = tmp / "fixture.glb"
    REHIDE.write_glb(str(path), doc, bytes(binary))
    return path


def _build_posed_inputs(tmp: Path, glb_path: Path) -> tuple[str, str, str]:
    """Write minimal posed+capture inputs the gate accepts; return dir/meta/dir.

    meta meshes mirror the GLB prims in GLB order (unique by material+verts);
    frames = {clipA: 8 static bind bins}; rays = 4 dirs aimed away from the
    fixture so the greedy trivially keeps every flagged tri.
    """
    doc, binary = REHIDE.read_glb(str(glb_path))
    materials = [m.get("name", "") for m in doc.get("materials", [])]
    # Meta mirrors GLTFLoader: one entry per PRIM, named <mesh> for the first
    # prim of a mesh and <mesh>_<k> for later prims (the tool's is_body check
    # accepts the suffixed names; _body0_index keys on the exact body name).
    entries = []
    prim_no: dict[str, int] = {}
    for m in doc.get("meshes", []):
        for pi, p in enumerate(m.get("primitives", [])):
            v = np.asarray(REHIDE.decode(doc, binary, p["attributes"]["POSITION"]), dtype=float)
            idx = np.asarray(REHIDE.decode(doc, binary, p["indices"]).reshape(-1), dtype=np.int64)
            k = prim_no.get(str(m.get("name", "")), 0)
            prim_no[str(m.get("name", ""))] = k + 1
            entry_name = str(m.get("name", "")) if k == 0 else f"{m.get('name', '')}_{k}"
            entries.append({"name": entry_name, "mat": materials[p["material"]],
                            "verts": int(v.shape[0]), "index": idx.reshape(-1, 3).tolist(),
                            "pos": v})
    bind = np.concatenate([e["pos"] for e in entries], axis=0)
    total_v = int(bind.shape[0])

    d = tmp / "posed"
    d.mkdir()
    clip = next(a["name"] for a in doc.get("animations", []))
    files = []
    for k in range(8):
        fn = f"{clip}_f{k}.bin"
        (d / fn).write_bytes(np.asarray(bind, dtype=np.float32).tobytes())
        files.append(fn)
    meta = {"meshes": [{k: e[k] for k in ("name", "mat", "verts", "index")} for e in entries],
            "frames": {clip: files},
            "clips": [{"name": clip, "duration": 1.0}]}
    (d / "meta.json").write_text(json.dumps(meta))
    side = {"gradeNorm": {"scale": [1.0, 1.0, 1.0], "position": [0.0, 0.0, 0.0]},
            "cap_front": {"origin": [0.0, 0.35, 5.0]},
            "cap_tq": {"origin": [5.0, 0.35, 5.0]}}
    (d / "t2_rays.json").write_text(json.dumps(side))
    away = np.array([[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
                    dtype=np.float32)
    (d / "rays_full_front_s2.bin").write_bytes(away.tobytes())
    (d / "rays_full_tq_s2.bin").write_bytes(away.tobytes())
    return str(d), str(d / "meta.json"), str(d)


def _read(path: Path):
    return REHIDE.read_glb(str(path))


def _refuse(argv: list[str]) -> str:
    """Run main expecting the loud posed-gate refusal; return stderr."""
    err = io.StringIO()
    with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
        with unittest.TestCase().assertRaises(SystemExit) as cm:
            REHIDE.main(argv)
    unittest.TestCase().assertEqual(cm.exception.code, 2)
    return err.getvalue()


class MoveContract(unittest.TestCase):
    def test_moves_poking_tris_and_reuses_accessors(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            rays, meta, pdir = _build_posed_inputs(tmp, src)
            out = tmp / "out.glb"
            rep = tmp / "report.json"
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                rc = REHIDE.main(["--in", str(src), "--out", str(out), "--report", str(rep),
                                  "--rays-dir", rays, "--poses-meta", meta, "--poses-dir", pdir])
            self.assertEqual(rc, 0)
            report = json.loads(rep.read_text())
            self.assertEqual(report["movedTrisTotal"], 1)
            self.assertEqual(report["safeSelectedTotal"], 1)
            self.assertEqual(report["inputSha256"], REHIDE.sha256_file(str(src)))
            self.assertEqual(report["outputSha256"], REHIDE.sha256_file(str(out)))

            pre_doc, pre_bin = _read(src)
            live_doc, live_bin = _read(out)
            # BIN prefix: tool only appends.
            self.assertTrue(live_bin[: len(pre_bin)] == pre_bin)
            # Only two index accessors + two views appended; nothing else touched.
            self.assertEqual(len(live_doc["accessors"]), len(pre_doc["accessors"]) + 2)
            self.assertEqual(len(live_doc["bufferViews"]), len(pre_doc["bufferViews"]) + 2)
            for i in range(len(pre_doc["accessors"])):
                a, b = pre_doc["accessors"][i], live_doc["accessors"][i]
                self.assertEqual(a, b, f"pre-range accessor {i} rewritten")
            # Skin prim trimmed to the kept tri; appended prim reuses attributes.
            body = next(m for m in live_doc["meshes"] if m["name"] == "test_body")
            self.assertEqual(len(body["primitives"]), 3)
            skin, fresh = body["primitives"][0], body["primitives"][2]
            kept = np.asarray(REHIDE.decode(live_doc, live_bin, skin["indices"]).reshape(-1))
            self.assertEqual(list(kept), [3, 4, 5])
            self.assertEqual(fresh["attributes"], skin["attributes"])
            moved = np.asarray(REHIDE.decode(live_doc, live_bin, fresh["indices"]).reshape(-1))
            self.assertEqual(list(moved), [0, 1, 2])
            mats = [m["name"] for m in live_doc["materials"]]
            self.assertTrue(mats[fresh["material"]].startswith("openclinxr_hidden_"))
            self.assertEqual(report["hiddenTargetMaterialIndex"], fresh["material"])

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            rays, meta, pdir = _build_posed_inputs(tmp, src)
            out = tmp / "out.glb"
            rep = tmp / "report.json"
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                rc = REHIDE.main(["--in", str(src), "--out", str(out), "--report", str(rep),
                                  "--dry", "--rays-dir", rays, "--poses-meta", meta,
                                  "--poses-dir", pdir])
            self.assertEqual(rc, 0)
            self.assertFalse(out.exists())
            report = json.loads(rep.read_text())
            self.assertTrue(report["dry"])
            self.assertEqual(report["movedTrisTotal"], 1)

    def test_in_place_rewrites_input(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            rays, meta, pdir = _build_posed_inputs(tmp, src)
            before = REHIDE.sha256_file(str(src))
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                rc = REHIDE.main(["--in", str(src), "--in-place",
                                  "--rays-dir", rays, "--poses-meta", meta,
                                  "--poses-dir", pdir])
            self.assertEqual(rc, 0)
            self.assertNotEqual(REHIDE.sha256_file(str(src)), before)
            doc, binary = _read(src)
            body = next(m for m in doc["meshes"] if m["name"] == "test_body")
            self.assertEqual(len(body["primitives"]), 3)

    def test_refuses_when_nothing_moves(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            # Both tris far behind the garment (past the 80 mm search): rule moves nothing.
            src = _build_fixture(tmp, poke_z=-0.5, keep_z=-0.6)
            rays, meta, pdir = _build_posed_inputs(tmp, src)
            out = tmp / "out.glb"
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(ValueError):
                    REHIDE.main(["--in", str(src), "--out", str(out),
                                 "--rays-dir", rays, "--poses-meta", meta,
                                 "--poses-dir", pdir])
            self.assertFalse(out.exists())

    def test_refuses_without_hidden_primitive(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            rays, meta, pdir = _build_posed_inputs(tmp, src)
            doc, binary = _read(src)
            body = next(m for m in doc["meshes"] if m["name"] == "test_body")
            body["primitives"] = [body["primitives"][0]]
            REHIDE.write_glb(str(src), doc, binary)
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(ValueError):
                    REHIDE.main(["--in", str(src), "--out", str(tmp / "o.glb"),
                                 "--rays-dir", rays, "--poses-meta", meta,
                                 "--poses-dir", pdir])


class PosedGateContract(unittest.TestCase):
    """F1/F8: every missing posed/capture input refuses loudly (exit 2)."""

    def _args(self, tmp: Path, rays=None, meta=None, pdir=None) -> list[str]:
        src = _build_fixture(tmp)
        r, m, p = _build_posed_inputs(tmp, src)
        argv = ["--in", str(src), "--out", str(tmp / "o.glb")]
        if rays is not None:
            argv += ["--rays-dir", r if rays is True else rays]
        if meta is not None:
            argv += ["--poses-meta", m if meta is True else meta]
        if pdir is not None:
            argv += ["--poses-dir", p if pdir is True else pdir]
        return argv

    def _all_missing_named(self, err: str, missing: list[str]):
        self.assertIn("sample-grade-poses.ts", err)
        for flag in missing:
            self.assertIn(flag, err)

    def test_refuses_without_any_posed_input(self):
        with tempfile.TemporaryDirectory() as td:
            err = _refuse(self._args(Path(td)))
        self._all_missing_named(err, ["--rays-dir", "--poses-meta", "--poses-dir"])

    def test_refuses_when_each_arg_missing_individually(self):
        combos = [
            ({"rays": True}, ["--poses-meta", "--poses-dir"]),
            ({"meta": True}, ["--rays-dir", "--poses-dir"]),
            ({"pdir": True}, ["--rays-dir", "--poses-meta"]),
            ({"rays": True, "meta": True}, ["--poses-dir"]),
            ({"rays": True, "pdir": True}, ["--poses-meta"]),
            ({"meta": True, "pdir": True}, ["--rays-dir"]),
        ]
        for present, missing in combos:
            with tempfile.TemporaryDirectory() as td, self.subTest(present=sorted(present)):
                argv = self._args(Path(td), **{k: True for k in present})
                err = _refuse(argv)
                self._all_missing_named(err, missing)

    def test_refuses_when_rays_dir_has_no_sidecar_files(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            _, meta, pdir = _build_posed_inputs(tmp, src)
            empty = tmp / "empty-rays"
            empty.mkdir()
            err = _refuse(["--in", str(src), "--out", str(tmp / "o.glb"),
                           "--rays-dir", str(empty),
                           "--poses-meta", meta, "--poses-dir", pdir])
            self.assertIn("sample-grade-poses.ts", err)

    def test_refuses_when_poses_meta_is_absent(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            r, _, p = _build_posed_inputs(tmp, src)
            err = _refuse(["--in", str(src), "--out", str(tmp / "o.glb"),
                           "--rays-dir", r,
                           "--poses-meta", str(tmp / "no-such-meta.json"),
                           "--poses-dir", p])
            self.assertIn("sample-grade-poses.ts", err)

    def test_refuses_when_poses_dir_is_absent(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            r, m, _ = _build_posed_inputs(tmp, src)
            err = _refuse(["--in", str(src), "--out", str(tmp / "o.glb"),
                           "--rays-dir", r, "--poses-meta", m,
                           "--poses-dir", str(tmp / "no-such-poses-dir")])
            self.assertIn("sample-grade-poses.ts", err)


class CardinalityContract(unittest.TestCase):
    """F9: the frame set must be exactly the GLB's clips x 8 frames."""

    def test_refuses_when_meta_clips_differ_from_glb_clips(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            r, m, p = _build_posed_inputs(tmp, src)
            meta = json.loads(Path(m).read_text())
            (Path(p) / "other_f0.bin").write_bytes(b"\x00" * 12)
            meta["frames"] = {"otherClip": ["other_f0.bin"]}
            Path(m).write_text(json.dumps(meta))
            err = _refuse(["--in", str(src), "--out", str(tmp / "o.glb"),
                           "--rays-dir", r, "--poses-meta", m, "--poses-dir", p])
            self.assertIn("clips", err)

    def test_refuses_when_a_clip_has_fewer_than_8_frames(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            r, m, p = _build_posed_inputs(tmp, src)
            meta = json.loads(Path(m).read_text())
            (meta["frames"]["clipA"],) = (meta["frames"]["clipA"][:7],)
            Path(m).write_text(json.dumps(meta))
            err = _refuse(["--in", str(src), "--out", str(tmp / "o.glb"),
                           "--rays-dir", r, "--poses-meta", m, "--poses-dir", p])
            self.assertIn("8 frames", err)

    def test_refuses_when_glb_carries_no_clips(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            src = _build_fixture(tmp)
            r, m, p = _build_posed_inputs(tmp, src)
            doc, binary = _read(src)
            doc["animations"] = []
            REHIDE.write_glb(str(src), doc, binary)
            err = _refuse(["--in", str(src), "--out", str(tmp / "o.glb"),
                           "--rays-dir", r, "--poses-meta", m, "--poses-dir", p])
            self.assertIn("clips", err)


class GreedyContract(unittest.TestCase):
    """F2c: the greedy must drop a known triangle whose hide opens see-through."""

    def test_greedy_drops_triangle_that_opens_a_hole(self):
        # Body: tri0 (flagged, must drop) + tri1 (control, must keep).
        # Behind tri0 there is nothing -> hiding it opens a miss hole.
        # Behind tri1 sits a shirt quad -> hiding it still hits shirt.
        V = np.array([[0.00, 0.30, 0.0], [0.10, 0.30, 0.0], [0.05, 0.40, 0.0],
                      [0.50, 0.30, 0.0], [0.60, 0.30, 0.0], [0.55, 0.40, 0.0]])
        F = np.array([[0, 1, 2], [3, 4, 5]], dtype=np.int64)
        S = np.array([[0.40, 0.20, -0.1], [0.70, 0.20, -0.1],
                      [0.70, 0.50, -0.1], [0.40, 0.50, -0.1]])
        SF = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
        body = {"mesh": "t_body", "pi": 0, "V": V, "F": F,
                "mat": "mpfb_skin", "is_body": True, "is_shirt": False}
        shirt = {"mesh": "shirt", "pi": 0, "V": S, "F": SF,
                 "mat": "cloth", "is_body": False, "is_shirt": True}
        origin = np.array([0.05, 0.35, 1.0])
        d1 = np.array([0.50, 0.00, -1.0])
        d1 = d1 / np.linalg.norm(d1)
        origins = {"front": origin}
        rays = {"front": np.array([[0.0, 0.0, -1.0], d1])}
        frames = [("bind", [body, shirt])]
        safe, dropped, rounds = SEL.greedy_over_frames(
            frames, np.array([0, 1], dtype=np.int64), origins, rays)
        # Round 0 must actually see the hole (else the test proves nothing).
        self.assertGreater(rounds[0]["newsee"], 0)
        self.assertEqual(list(safe), [1])
        self.assertEqual(list(dropped), [0])
        self.assertEqual(rounds[-1]["newsee"], 0)


if __name__ == "__main__":
    unittest.main()
