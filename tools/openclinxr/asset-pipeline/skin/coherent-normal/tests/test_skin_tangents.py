"""Unit tests for skin_tangents.py (stdlib only). Three r184 parity: quad, mirrored UV,
Gram-Schmidt orthogonality, fail-closed (degenerate/non-finite/existing-TANGENT guard lives in binder)."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from skin_tangents import compute_tangents  # noqa: E402


def quad():
    pos = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.0, 0.0), (0.0, 1.0, 0.0)]
    nrm = [(0.0, 0.0, 1.0)] * 4
    uv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    return pos, nrm, uv, [0, 1, 2, 0, 2, 3]


class TangentTests(unittest.TestCase):
    def test_quad_tangent_x_handedness_plus(self):
        t = compute_tangents(*quad())
        for x, y, z, w in t:
            self.assertAlmostEqual(x, 1.0, places=5)
            self.assertAlmostEqual(y, 0.0, places=5)
            self.assertAlmostEqual(z, 0.0, places=5)
            self.assertEqual(w, 1.0)

    def test_mirrored_uv_flips_handedness(self):
        pos, nrm, _, idx = quad()
        uv = [(0.0, 0.0), (-1.0, 0.0), (-1.0, 1.0), (0.0, 1.0)]
        t = compute_tangents(pos, nrm, uv, idx)
        for x, y, z, w in t:
            self.assertAlmostEqual(x, -1.0, places=5)
            self.assertEqual(w, -1.0)

    def test_gram_schmidt_orthogonalizes(self):
        pos, _, uv, idx = quad()
        nrm = [(0.20094414372133132, 0.0, 0.9796027006414901)] * 4  # tilted unit normal
        t = compute_tangents(pos, nrm, uv, idx)
        for x, y, z, w in t:
            d = x * nrm[0][0] + z * nrm[0][2]
            self.assertAlmostEqual(d / math.sqrt(x * x + y * y + z * z), 0.0, places=4)

    def test_degenerate_uv_refuses(self):
        pos, nrm, _, idx = quad()
        uv = [(0.0, 0.0)] * 4
        with self.assertRaises(ValueError):
            compute_tangents(pos, nrm, uv, idx)

    def test_nonfinite_refuses(self):
        pos, nrm, uv, idx = quad()
        bad = list(pos)
        bad[0] = (float("nan"), 0.0, 0.0)
        with self.assertRaises(ValueError):
            compute_tangents(bad, nrm, uv, idx)

    def test_oob_index_refuses(self):
        pos, nrm, uv, _ = quad()
        with self.assertRaises(ValueError):
            compute_tangents(pos, nrm, uv, [0, 1, 99])




class BoundaryTests(unittest.TestCase):
    def _doc(self, n=2):
        import struct as _s
        pos = _s.pack('<6f', 0, 0, 0, 1, 0, 0)
        nrm = _s.pack('<6f', 0, 0, 1, 0, 0, 1)
        uv = _s.pack('<4f', 0, 0, 1, 1)
        idx = _s.pack('<3H', 0, 1, 0)
        blob = pos + nrm + uv + idx
        doc = {"accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 2, "type": "VEC3"},
            {"bufferView": 1, "componentType": 5126, "count": 2, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": 2, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5123, "count": 3, "type": "SCALAR"}],
            "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 24},
                {"buffer": 0, "byteOffset": 24, "byteLength": 24},
                {"buffer": 0, "byteOffset": 48, "byteLength": 16},
                {"buffer": 0, "byteOffset": 64, "byteLength": 6}],
            "meshes": [{"primitives": [{"material": 0, "mode": 4,
                "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                "indices": 3}]}],
            "materials": [{}]}
        return doc, blob

    def test_view_crossing_refuses(self):
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from skin_tangents import read_accessor_floats
        doc, blob = self._doc()
        doc["bufferViews"][0]["byteLength"] = 4  # shrink view so accessor crosses
        with self.assertRaises(ValueError):
            read_accessor_floats(doc, blob, 0)

    def test_negative_offset_refuses(self):
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from skin_tangents import read_accessor_floats
        doc, blob = self._doc()
        doc["accessors"][0]["byteOffset"] = -4
        with self.assertRaises(ValueError):
            read_accessor_floats(doc, blob, 0)

    def test_bool_offset_refuses(self):
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from skin_tangents import read_accessor_floats
        doc, blob = self._doc()
        doc["accessors"][0]["byteOffset"] = True
        with self.assertRaises(ValueError):
            read_accessor_floats(doc, blob, 0)

    def test_bad_stride_refuses(self):
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from skin_tangents import read_accessor_floats
        doc, blob = self._doc()
        doc["bufferViews"][0]["byteStride"] = 4  # < row bytes 12
        with self.assertRaises(ValueError):
            read_accessor_floats(doc, blob, 0)

    def test_float_indices_refuses(self):
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from skin_tangents import read_indices
        doc, blob = self._doc()
        doc["accessors"][3]["componentType"] = 5126
        with self.assertRaises(ValueError):
            read_indices(doc, blob, 3)

    def test_nontriangle_mode_refuses(self):
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from skin_tangents import compute_skin_tangents_for_primitive
        doc, blob = self._doc()
        doc["meshes"][0]["primitives"][0]["mode"] = 5
        with self.assertRaises(ValueError):
            compute_skin_tangents_for_primitive(doc, blob, doc["meshes"][0]["primitives"][0], 0)

    def test_quad_additive_attr_preserved(self):
        pos, nrm, uv, idx = quad()
        t = compute_tangents(pos, nrm, uv, idx)
        self.assertEqual(len(t), 4)
        for q in t:
            self.assertEqual(len(q), 4)


class AppendTangentsTests(unittest.TestCase):
    def _quad_doc(self, n=4, mode=4, tangent=False, bad_type=None):
        import struct as _s
        import json as _j
        import copy as _c
        pos = _s.pack('<12f', 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0)
        nrm = _s.pack('<12f', 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1)
        uv = _s.pack('<8f', 0, 0, 1, 0, 1, 1, 0, 1)
        idx = _s.pack('<6H', 0, 1, 2, 0, 2, 3)
        blob = bytearray(pos + nrm + uv + idx)
        nrm_tp = bad_type or "VEC3"
        doc = {"accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3"},
            {"bufferView": 1, "componentType": 5126, "count": 4, "type": nrm_tp},
            {"bufferView": 2, "componentType": 5126, "count": 4, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5123, "count": 6, "type": "SCALAR"}],
            "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 48},
                {"buffer": 0, "byteOffset": 48, "byteLength": 48},
                {"buffer": 0, "byteOffset": 96, "byteLength": 32},
                {"buffer": 0, "byteOffset": 128, "byteLength": 12}],
            "meshes": [{"primitives": [{"material": 0, "mode": mode,
                "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                "indices": 3}]}],
            "materials": [{}]}
        if tangent:
            doc["meshes"][0]["primitives"][0]["attributes"]["TANGENT"] = 99
        return doc, blob

    def test_append_positive_counts_and_growth(self):
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        import copy, json
        from skin_tangents import append_skin_tangents
        doc, blob = self._quad_doc()
        snap = json.dumps(doc, sort_keys=True)
        n_views, n_acc = len(doc["bufferViews"]), len(doc["accessors"])
        newbin, meta = append_skin_tangents(doc, bytes(blob), 0)
        self.assertEqual(len(doc["bufferViews"]), n_views + 1)
        self.assertEqual(len(doc["accessors"]), n_acc + 1)
        self.assertEqual(doc["meshes"][0]["primitives"][0]["attributes"]["TANGENT"], n_acc)
        pad = (-len(blob)) % 4
        self.assertEqual(len(newbin), len(blob) + pad + 4 * 16)
        self.assertEqual(newbin[:len(blob)], bytes(blob))
        self.assertEqual(doc["bufferViews"][-1]["byteLength"], 4 * 16)
        self.assertEqual(doc["accessors"][-1], {"bufferView": n_views, "componentType": 5126, "count": 4, "type": "VEC4"})
        # original BIN prefix + non-target JSON untouched
        old = json.loads(snap)
        for k in ("meshes", "materials"):
            pass
        self.assertEqual(doc["bufferViews"][:-1], old["bufferViews"])
        self.assertEqual(doc["accessors"][:-1], old["accessors"])
        self.assertEqual(meta["count"], 4)

    def test_append_negative_no_mutation(self):
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        import copy, json
        from skin_tangents import append_skin_tangents
        for kw in ({"mode": 5}, {"tangent": True}, {"bad_type": "VEC2"}):
            doc, blob = self._quad_doc(**kw)
            snap_doc = json.dumps(doc, sort_keys=True)
            snap_bin = bytes(blob)
            with self.assertRaises(ValueError):
                append_skin_tangents(doc, bytes(blob), 0)
            self.assertEqual(json.dumps(doc, sort_keys=True), snap_doc)
            self.assertEqual(bytes(blob), snap_bin)


class TangentCliTests(unittest.TestCase):
    def _quad_reuse_glb(self, path, albedo, old, mode=4):
        import struct as _s
        import json as _j
        import hashlib as _h
        pos = _s.pack('<12f', 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0)
        nrm = _s.pack('<12f', 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1)
        uv = _s.pack('<8f', 0, 0, 1, 0, 1, 1, 0, 1)
        idx = _s.pack('<6H', 0, 1, 2, 0, 2, 3)
        parts = [albedo, old, pos, nrm, uv, idx]
        bvs = []
        blob_parts = []
        off = 0
        for p in parts:
            bvs.append({"buffer": 0, "byteOffset": off, "byteLength": len(p)})
            blob_parts.append(p)
            off += len(p)
            pad = (-off) % 4
            if pad:
                blob_parts.append(b"\x00" * pad)
                off += pad
        blob = b"".join(blob_parts)
        doc = {"asset": {"version": "2.0"},
            "materials": [{"name": "skin-test-mat"}],
            "meshes": [{"name": "body-test", "primitives": [{
                "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                "indices": 3, "material": 0, "mode": mode}]}],
            "images": [{"name": "albedo", "mimeType": "image/png", "bufferView": 0},
                       {"name": "skin-normal", "mimeType": "image/png", "bufferView": 1}],
            "textures": [{"source": 0}, {"source": 1}],
            "bufferViews": bvs,
            "buffers": [{"byteLength": len(blob)}],
            "accessors": [
                {"bufferView": 0 + 2, "componentType": 5126, "count": 4, "type": "VEC3"},
                {"bufferView": 1 + 2, "componentType": 5126, "count": 4, "type": "VEC3"},
                {"bufferView": 2 + 2, "componentType": 5126, "count": 4, "type": "VEC2"},
                {"bufferView": 3 + 2, "componentType": 5123, "count": 6, "type": "SCALAR"}]}
        js = _j.dumps(doc, separators=(",", ":")).encode()
        while len(js) % 4:
            js += b" "
        glb = (_s.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
               + _s.pack("<II", len(js), 0x4E4F534A) + js
               + _s.pack("<II", len(blob), 0x004E4942) + blob)
        open(path, "wb").write(glb)
        return _h.sha256(glb).hexdigest()

    def _rep_prov(self, tmp, srcsha, newbytes, name):
        import json as _j
        import hashlib as _h
        rr = tmp + "/" + name + ".json"
        _j.dump({"inputGlbFullSha": srcsha, "bakeInputGlbFullSha": srcsha,
                 "outputPngSha": _h.sha256(newbytes).hexdigest(),
                 "recipe": "test-recipe", "vsha": "x", "bodyMeshBase": "body-test",
                 "bodyMesh": "body-test",
                 "derivationMode": "procedural-stylized-analytic-heightfield: test",
                 "generator": "python-test analytic-heightfield",
                 "renderRecipe": "test heightfield",
                 "meshSurfaceBake": False, "measuredSkinPores": False,
                 "photorealClaim": False, "bindingScope": "test", "vshaScope": "test",
                 "runtime": "pythontest/analytic-heightfield/NO-BLENDER/NO-MESH-BAKE"},
                open(rr, "w"))
        pv = tmp + "/" + name + ".prov.json"
        _j.dump({"stages": []}, open(pv, "w"))
        return rr, pv

    def test_cli_tangent_positive(self):
        import sys, os, json, struct, hashlib, tempfile
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from test_bind_unittest import pore_like, solid
        from test_bind_unittest import run_bind
        tmp = tempfile.mkdtemp(prefix="tancli")
        old = pore_like(8)
        alb = solid(8, 8, (200, 150, 120))
        new = pore_like()
        g = os.path.join(tmp, "in.glb")
        s = self._quad_reuse_glb(g, alb, old)
        np_ = os.path.join(tmp, "n.png")
        open(np_, "wb").write(new)
        rep, prov = self._rep_prov(tmp, s, new, "bake")
        o = os.path.join(tmp, "out.glb")
        args = ["--src", g, "--new-normal", np_,
                "--expect-src-sha", s,
                "--expect-png-sha", hashlib.sha256(new).hexdigest(),
                "--expect-old-sha", hashlib.sha256(old).hexdigest(),
                "--skin-sub", "skin-test-mat",
                "--prov-in", prov, "--recipe", "test-recipe",
                "--bake-report", rep, "--reuse-unbound-normal-texture",
                "--coherent-skin-tangents",
                "--out", o, "--prov-out", o + ".prov.json"]
        r = run_bind(args)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-800:])
        d = open(o, "rb").read()
        jl, = struct.unpack("<I", d[12:16])
        j = json.loads(d[20:20 + jl])
        self.assertEqual(j["meshes"][0]["primitives"][0]["attributes"]["TANGENT"], 4)
        self.assertEqual(len(j["bufferViews"]), 7)
        self.assertEqual(len(j["accessors"]), 5)
        st = json.load(open(o + ".prov.json"))["stages"][-1]
        self.assertIn("tangentDerivation", st)
        self.assertEqual(st["tangentDerivation"]["tangentCount"], 4)
        self.assertIn("tangent basis derives from original positions/normals/UV",
                      st["derivation"])
        self.assertNotIn("source GLB used for binding identity/UV slot only",
                         st["derivation"])

    def test_cli_default_no_tangent_key_and_badmode_no_output(self):
        import sys, os, json, struct, hashlib, tempfile
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from test_bind_unittest import pore_like, solid
        from test_bind_unittest import run_bind
        tmp = tempfile.mkdtemp(prefix="tancli2")
        old = pore_like(8)
        alb = solid(8, 8, (200, 150, 120))
        new = pore_like()
        g = os.path.join(tmp, "in.glb")
        s = self._quad_reuse_glb(g, alb, old)
        np_ = os.path.join(tmp, "n.png")
        open(np_, "wb").write(new)
        rep, prov = self._rep_prov(tmp, s, new, "bake2")
        o = os.path.join(tmp, "out.glb")
        args = ["--src", g, "--new-normal", np_,
                "--expect-src-sha", s,
                "--expect-png-sha", hashlib.sha256(new).hexdigest(),
                "--expect-old-sha", hashlib.sha256(old).hexdigest(),
                "--skin-sub", "skin-test-mat",
                "--prov-in", prov, "--recipe", "test-recipe",
                "--bake-report", rep, "--reuse-unbound-normal-texture",
                "--out", o, "--prov-out", o + ".prov.json"]
        r = run_bind(args)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-800:])
        st = json.load(open(o + ".prov.json"))["stages"][-1]
        self.assertNotIn("tangentDerivation", st)
        self.assertIn("source GLB used for binding identity/UV slot only",
                      st["derivation"])
        # bad mode refuses with no outputs
        g2 = os.path.join(tmp, "bad.glb")
        s2 = self._quad_reuse_glb(g2, alb, old, mode=5)
        rep2, prov2 = self._rep_prov(tmp, s2, new, "bake3")
        o2 = os.path.join(tmp, "bad-out.glb")
        args2 = ["--src", g2, "--new-normal", np_,
                 "--expect-src-sha", s2,
                 "--expect-png-sha", hashlib.sha256(new).hexdigest(),
                 "--expect-old-sha", hashlib.sha256(old).hexdigest(),
                 "--skin-sub", "skin-test-mat",
                 "--prov-in", prov2, "--recipe", "test-recipe",
                 "--bake-report", rep2, "--reuse-unbound-normal-texture",
                 "--coherent-skin-tangents",
                 "--out", o2, "--prov-out", o2 + ".prov.json"]
        r2 = run_bind(args2)
        self.assertNotEqual(r2.returncode, 0)
        self.assertFalse(os.path.exists(o2))
        self.assertFalse(os.path.exists(o2 + ".prov.json"))


if __name__ == "__main__":
    unittest.main()
