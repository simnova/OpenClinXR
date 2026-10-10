"""Used-row gather tests against production glb_positions/_same (bake_final_rest) and positions (validate)."""
import importlib.util
import json
import pathlib
import struct
import sys
import types
import unittest

HERE = pathlib.Path(__file__).resolve()
BAKE = HERE.with_name("bake_final_rest.py")
VALIDATE = HERE.parents[3] / "evidence" / "factory-skin-publication" / "validate.py"

sys.modules.setdefault("bpy", types.ModuleType("bpy"))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bake = _load("production_bake_final_rest", BAKE)
validator = _load("production_validate", VALIDATE)


def _glb(position_rows, prim_index_lists, shared_position=True):
    """Build a minimal GLB. prim_index_lists: list per primitive of index lists."""
    blob = bytearray()
    accessors = []
    pos_accs = []
    if shared_position:
        raw = b"".join(struct.pack("<fff", *r) for r in position_rows)
        off = len(blob)
        blob.extend(raw)
        accessors.append({"bufferView": 0, "byteOffset": off, "componentType": 5126,
                          "type": "VEC3", "count": len(position_rows)})
        pos_accs = [0] * len(prim_index_lists)
    else:
        for rows in position_rows:
            raw = b"".join(struct.pack("<fff", *r) for r in rows)
            off = len(blob)
            blob.extend(raw)
            accessors.append({"bufferView": 0, "byteOffset": off, "componentType": 5126,
                              "type": "VEC3", "count": len(rows)})
            pos_accs.append(len(accessors) - 1)
    primitives = []
    for pi, idx in enumerate(prim_index_lists):
        fmt, ct = ("H", 5123) if max(idx) < 65536 else ("I", 5125)
        raw = b"".join(struct.pack("<" + fmt, i) for i in idx)
        off = len(blob)
        blob.extend(raw)
        accessors.append({"bufferView": 0, "byteOffset": off, "componentType": ct,
                          "type": "SCALAR", "count": len(idx)})
        primitives.append({"attributes": {"POSITION": pos_accs[pi]}, "indices": len(accessors) - 1})
    while len(blob) % 4:
        blob.append(0)
    doc = {"asset": {"version": "2.0"}, "meshes": [{"primitives": primitives}],
           "accessors": accessors, "bufferViews": [{"buffer": 0, "byteLength": len(blob)}],
           "buffers": [{"byteLength": len(blob)}]}
    js = json.dumps(doc).encode()
    while len(js) % 4:
        js += b" "
    head = struct.pack("<III", 12 + 8 + len(js) + 8 + len(blob), 0x46546C67, 2)
    jchunk = struct.pack("<II", len(js), 0x4E4F534A) + js
    bchunk = struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
    return head + jchunk + bchunk


class UsedRowGather(unittest.TestCase):
    def test_sparse(self):
        rows = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
        raw = _glb(rows, [[0, 2, 0]])
        for fn in (bake.glb_positions, validator.positions):
            self.assertEqual(len(fn(raw)["0:0"]), 2)

    def test_shared_accessor(self):
        rows = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (5.0, 5.0, 5.0)]
        raw = _glb(rows, [[0, 1], [1, 2]])
        for fn in (bake.glb_positions, validator.positions):
            got = fn(raw)
            self.assertEqual(len(got["0:0"]), 2)
            self.assertEqual(len(got["0:1"]), 2)
            self.assertEqual(len(got["0:0"]) + len(got["0:1"]), 4)

    def test_displacement(self):
        pts = [[0.0, 0.0, 0.0], [1.0, 2.0, 3.0]]
        self.assertTrue(bake._same(pts, [list(p) for p in pts]))
        moved = [list(p) for p in pts]
        moved[1] = [moved[1][0] + 2e-6, moved[1][1], moved[1][2]]
        self.assertFalse(bake._same(pts, moved))

    def test_threshold_is_1e_minus_6(self):
        src = BAKE.read_text()
        self.assertIn("abs(x - y) > 1e-6", src)

    def test_real_file_mesh4(self):
        p = (HERE.parents[5] / "apps" / "ui-xr" / "public" / "xr-assets" / "humanoids"
             / "candidates" / "mpfb-peds-parent-aisha.motion-bind.glb")
        import hashlib
        raw = p.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),
                         "538c29ecc7a38a416079e4c0f567083a3078189ce12ba4936ea3478be5f53561")
        jl = struct.unpack_from("<I", raw, 12)[0]
        doc = json.loads(raw[20:20 + jl])
        raw_sum = sum(doc["accessors"][pr["attributes"]["POSITION"]]["count"]
                      for pr in doc["meshes"][4]["primitives"])
        self.assertEqual(raw_sum, 17793)
        for fn in (bake.glb_positions, validator.positions):
            got = fn(raw)
            total = sum(len(v) for k, v in got.items() if k.startswith("4:"))
            self.assertEqual(total, 16061)


if __name__ == "__main__":
    unittest.main()
