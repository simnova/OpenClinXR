"""Unit tests for fixed bind_skin_normal.py (stdlib only, self-built fixtures).

Retains 9 original negatives (happy+replay, wrong-actor, map mismatch,
report/map mismatch, bake-src mismatch, no-clobber, missing skin, noUV,
-O refuses) plus: flat refuses w/o outputs despite report bars:true,
incoherent noise refuses, independent coherent positive passes, -O flat
refuses, metadata receipt/history exact, gray-PNG format refusal,
interlaced-PNG format refusal. No numpy/PIL.
Run: python3 tests/test_bind_unittest.py -v
"""
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

_HERE = os.path.dirname(os.path.abspath(__file__))
_CANDS = [os.path.join(_HERE, "..", "bind_skin_normal.py"),
          os.path.join(_HERE, "bind_skin_normal.py")]
BIND = next(p for p in _CANDS if os.path.exists(p))
sys.path.insert(0, os.path.dirname(BIND))
from normal_metrics import decode_png, stats  # noqa: E402


def _chunk(t, d):
    return (struct.pack(">I", len(d)) + t + d
            + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF))


def png_rgb(w, h, fn):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r, g, b = fn(x, y)
            raw += bytes((r & 255, g & 255, b & 255))
    comp = zlib.compress(bytes(raw))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", comp) + _chunk(b"IEND", b""))


def png_gray(w=32, h=32, v=128):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += bytes([v & 255]) * w
    comp = zlib.compress(bytes(raw))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", comp) + _chunk(b"IEND", b""))


def interlaced_rgb(png):
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    ln = struct.unpack(">I", png[8:12])[0]
    assert png[12:16] == b"IHDR" and ln == 13
    ihdr = bytearray(png[16:29])
    ihdr[12] = 1
    crc = struct.pack(">I", zlib.crc32(b"IHDR" + bytes(ihdr)) & 0xFFFFFFFF)
    return png[:16] + bytes(ihdr) + crc + png[29:]


def solid(w=32, h=32, c=(128, 128, 255)):
    return png_rgb(w, h, lambda x, y: c)


def pore_like(n=64):
    def fn(x, y):
        r = int(128 + 40 * math.sin(2 * math.pi * x / 64))
        g = int(128 + 40 * math.cos(2 * math.pi * y / 64))
        return (r, g, 255)
    return png_rgb(n, n, fn)


def noise_png(n=64, seed=12345):
    s = seed
    def rnd():
        nonlocal s
        s = (1103515245 * s + 12345) & 0x7FFFFFFF
        return (s >> 8) & 255
    return png_rgb(n, n, lambda x, y: (rnd(), rnd(), rnd()))


def make_glb(path, old_normal, albedo, skin_name="skin-test-mat",
             with_uv=True, garment_uv=False, body_name="body-test",
             retired=True):
    prim = {"POSITION": 0}
    if with_uv:
        prim["TEXCOORD_0"] = 1
    meshes = [{"name": body_name,
               "primitives": [{"attributes": dict(prim), "material": 0}]}]
    if garment_uv:
        meshes.append({"name": "garment",
                       "primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 1},
                                        "material": 0}]})
    if retired:
        images = [{"name": "albedo", "mimeType": "image/png", "bufferView": 0},
                  {"name": "old.skin-normal", "mimeType": "image/png", "bufferView": 1}]
        textures = [{"source": 0}]
        bvs = [{"byteOffset": 0, "byteLength": len(albedo)},
               {"byteOffset": len(albedo), "byteLength": len(old_normal)}]
        blob = albedo + old_normal
    else:
        images = [{"name": "albedo", "mimeType": "image/png", "bufferView": 0}]
        textures = []
        bvs = [{"byteOffset": 0, "byteLength": len(albedo)}]
        blob = albedo
    doc = {
        "asset": {"version": "2.0"},
        "materials": [{"name": skin_name}],
        "meshes": meshes,
        "images": images,
        "textures": textures,
        "bufferViews": bvs,
        "buffers": [{"byteLength": len(blob)}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                      {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC2"}]
        if with_uv or garment_uv else
        [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    glb = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
           + struct.pack("<II", len(js), 0x4E4F534A) + js
           + struct.pack("<II", len(blob), 0x004E4942) + blob)
    open(path, "wb").write(glb)
    return hashlib.sha256(glb).hexdigest()


def run_bind(args, opt_O=False):
    cmd = [sys.executable] + (["-O"] if opt_O else []) + [BIND] + args
    return subprocess.run(cmd, capture_output=True, text=True)


class BindTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="bindtest")
        self.old = solid(16, 16, (150, 100, 200))
        self.alb = solid(8, 8, (200, 150, 120))
        self.new = pore_like()
        st = stats(decode_png(self.new))
        assert all(st["bars"]), st
        self.glb = os.path.join(self.tmp, "in.glb")
        self.srcsha = make_glb(self.glb, self.old, self.alb)
        self.sidecar = os.path.join(self.tmp, "old.skin-normal.png")
        open(self.sidecar, "wb").write(self.old)
        self.prov = os.path.join(self.tmp, "p.json")
        json.dump({"schemaVersion": "openclinxr.generated-humanoid-provenance.v1",
                   "licenseChain": ["CC0-test"], "promotionGates": {"g": True},
                   "generatedAt": "2026-01-01T00:00:00Z",
                   "outputSha256": self.srcsha, "outputBytes": os.path.getsize(self.glb),
                   "byteLineage": {"why": "keep"},
                   "history": ["a"]}, open(self.prov, "w"))
        self.npng = os.path.join(self.tmp, "n.png")
        open(self.npng, "wb").write(self.new)
        self.rep = os.path.join(self.tmp, "bake.json")
        json.dump({"inputGlbFullSha": self.srcsha, "bakeInputGlbFullSha": self.srcsha,
                   "outputPngSha": hashlib.sha256(self.new).hexdigest(),
                   "recipe": "test-recipe", "vsha": "fixture", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test",
                   "derivationMode": "procedural-stylized-analytic-heightfield: test",
                   "generator": "python-test analytic-heightfield",
                   "renderRecipe": "test heightfield",
                   "meshSurfaceBake": False, "measuredSkinPores": False,
                   "photorealClaim": False, "bindingScope": "test",
                   "vshaScope": "test",
                   "runtime": "pythontest/analytic-heightfield/NO-BLENDER/NO-MESH-BAKE",
                   "pore": {"feature": "F1", "scale": 24.0, "detail": 2.0,
                            "roughness": 0.6, "bumpStrength": 0.142,
                            "bumpDistance": 0.0018, "mappingScale": 6.0},
                   "macro": {"kind": "curvature-pointiness-bump", "strength": 1.25,
                             "distance": 0.02, "subdiv": 2}}, open(self.rep, "w"))
        self.base = ["--src", self.glb, "--new-normal", self.npng,
                     "--expect-src-sha", self.srcsha,
                     "--expect-png-sha", hashlib.sha256(self.new).hexdigest(),
                     "--skin-sub", "skin-test", "--old-sidecar", self.sidecar,
                     "--prov-in", self.prov, "--recipe", "test-recipe",
                     "--bake-report", self.rep]

    def out(self, name="out.glb"):
        o = os.path.join(self.tmp, name)
        return o, self.base + ["--out", o, "--prov-out", o + ".prov.json"]

    def test_happy_path_and_replay_exact(self):
        o, args = self.out()
        r = run_bind(args)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])
        rep = json.loads(r.stdout.strip().split("BIND ", 1)[1])
        self.assertEqual(rep["bars"], [True, True, True])
        self._assert_container(o)
        o2, args2 = self.out("out2.glb")
        r2 = run_bind(args2)
        self.assertEqual(r2.returncode, 0, r2.stderr[-500:])
        self.assertEqual(hashlib.sha256(open(o, "rb").read()).hexdigest(),
                         hashlib.sha256(open(o2, "rb").read()).hexdigest())

    def test_wrong_actor_src_sha(self):
        o, args = self.out()
        args[args.index("--expect-src-sha") + 1] = "0" * 64
        self.assertNotEqual(run_bind(args).returncode, 0)

    def test_mismatched_normal_sha(self):
        o, args = self.out()
        args[args.index("--expect-png-sha") + 1] = "1" * 64
        self.assertNotEqual(run_bind(args).returncode, 0)

    def test_report_map_mismatch(self):
        bad = os.path.join(self.tmp, "badreport.json")
        d = json.load(open(self.rep))
        d["outputPngSha"] = "2" * 64
        json.dump(d, open(bad, "w"))
        o, args = self.out()
        args[args.index("--bake-report") + 1] = bad
        self.assertNotEqual(run_bind(args).returncode, 0)

    def test_report_bake_src_mismatch_same_body(self):
        other = os.path.join(self.tmp, "other.glb")
        osha = make_glb(other, solid(16, 16, (1, 2, 3)), self.alb)
        o, args = self.out()
        args[args.index("--src") + 1] = other
        args[args.index("--expect-src-sha") + 1] = osha
        self.assertNotEqual(run_bind(args).returncode, 0)

    def test_no_clobber_out_and_prov(self):
        o, args = self.out()
        open(o, "wb").write(b"x")
        po = o + ".prov.json"
        open(po, "w").write('{"keep": true}')
        self.assertNotEqual(run_bind(args).returncode, 0)
        self.assertEqual(open(po).read(), '{"keep": true}')

    def test_missing_skin_material(self):
        g = os.path.join(self.tmp, "nomat.glb")
        s = make_glb(g, self.old, self.alb, skin_name="other-mat")
        rr = os.path.join(self.tmp, "nomat-bake.json")
        json.dump({"inputGlbFullSha": s, "bakeInputGlbFullSha": s,
                   "outputPngSha": hashlib.sha256(self.new).hexdigest(),
                   "recipe": "test-recipe", "vsha": "x", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test"},
                  open(rr, "w"))
        o, args = self.out("nomat-out.glb")
        args[args.index("--src") + 1] = g
        args[args.index("--expect-src-sha") + 1] = s
        args[args.index("--bake-report") + 1] = rr
        self.assertNotEqual(run_bind(args).returncode, 0)

    def test_skin_no_uv_despite_garment_uv(self):
        g = os.path.join(self.tmp, "nouv.glb")
        s = make_glb(g, self.old, self.alb, with_uv=False, garment_uv=True)
        rr = os.path.join(self.tmp, "nouv-bake.json")
        json.dump({"inputGlbFullSha": s, "bakeInputGlbFullSha": s,
                   "outputPngSha": hashlib.sha256(self.new).hexdigest(),
                   "recipe": "test-recipe", "vsha": "x", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test"},
                  open(rr, "w"))
        o, args = self.out("nouv-out.glb")
        args[args.index("--src") + 1] = g
        args[args.index("--expect-src-sha") + 1] = s
        args[args.index("--bake-report") + 1] = rr
        r = run_bind(args)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("TEXCOORD", r.stdout + r.stderr)

    def test_opt_O_still_refuses(self):
        o, args = self.out()
        args[args.index("--expect-src-sha") + 1] = "0" * 64
        r = run_bind(args, opt_O=True)
        self.assertNotEqual(r.returncode, 0)
        o2, args2 = self.out("o-clobber.glb")
        open(o2, "wb").write(b"x")
        self.assertNotEqual(run_bind(args2, opt_O=True).returncode, 0)

    def test_flat_refuses_no_outputs_despite_report_bars_true(self):
        flat = solid(64, 64, (128, 128, 255))
        fp = os.path.join(self.tmp, "flat.png")
        open(fp, "wb").write(flat)
        rr = os.path.join(self.tmp, "flat-bake.json")
        json.dump({"inputGlbFullSha": self.srcsha, "bakeInputGlbFullSha": self.srcsha,
                   "outputPngSha": hashlib.sha256(flat).hexdigest(),
                   "recipe": "test-recipe", "vsha": "x", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test",
                   "bars": {"sdGe8": True, "flatLe04": True, "incohLe06": True}},
                  open(rr, "w"))
        o, args = self.out("flat-out.glb")
        args[args.index("--new-normal") + 1] = fp
        args[args.index("--expect-png-sha") + 1] = hashlib.sha256(flat).hexdigest()
        args[args.index("--bake-report") + 1] = rr
        r = run_bind(args)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))
        self.assertFalse(os.path.exists(o + ".prov.json"))

    def test_incoherent_noise_refuses_no_outputs(self):
        nz = noise_png()
        st = stats(decode_png(nz))
        self.assertEqual(st["bars"][2], False)
        np_ = os.path.join(self.tmp, "noise.png")
        open(np_, "wb").write(nz)
        rr = os.path.join(self.tmp, "noise-bake.json")
        json.dump({"inputGlbFullSha": self.srcsha, "bakeInputGlbFullSha": self.srcsha,
                   "outputPngSha": hashlib.sha256(nz).hexdigest(),
                   "recipe": "test-recipe", "vsha": "x", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test"},
                  open(rr, "w"))
        o, args = self.out("noise-out.glb")
        args[args.index("--new-normal") + 1] = np_
        args[args.index("--expect-png-sha") + 1] = hashlib.sha256(nz).hexdigest()
        args[args.index("--bake-report") + 1] = rr
        r = run_bind(args)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))
        self.assertFalse(os.path.exists(o + ".prov.json"))

    def test_independent_coherent_positive_passes(self):
        o, args = self.out("coh-out.glb")
        r = run_bind(args)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-500:])
        rep = json.loads(r.stdout.strip().split("BIND ", 1)[1])
        self.assertEqual(rep["bars"], [True, True, True])
        self._assert_container(o)

    def test_opt_O_flat_refuses_no_outputs(self):
        flat = solid(64, 64, (128, 128, 255))
        fp = os.path.join(self.tmp, "flatO.png")
        open(fp, "wb").write(flat)
        rr = os.path.join(self.tmp, "flatO-bake.json")
        json.dump({"inputGlbFullSha": self.srcsha, "bakeInputGlbFullSha": self.srcsha,
                   "outputPngSha": hashlib.sha256(flat).hexdigest(),
                   "recipe": "test-recipe", "vsha": "x", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test"},
                  open(rr, "w"))
        o, args = self.out("flatO-out.glb")
        args[args.index("--new-normal") + 1] = fp
        args[args.index("--expect-png-sha") + 1] = hashlib.sha256(flat).hexdigest()
        args[args.index("--bake-report") + 1] = rr
        self.assertNotEqual(run_bind(args, opt_O=True).returncode, 0)
        self.assertFalse(os.path.exists(o))

    def _report_for(self, png_bytes, name):
        rr = os.path.join(self.tmp, name)
        json.dump({"inputGlbFullSha": self.srcsha, "bakeInputGlbFullSha": self.srcsha,
                   "outputPngSha": hashlib.sha256(png_bytes).hexdigest(),
                   "recipe": "test-recipe", "vsha": "x", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test"},
                  open(rr, "w"))
        return rr

    def test_gray_png_refuses_no_outputs(self):
        g = png_gray()
        self.assertIsNone(decode_png(g))
        gp = os.path.join(self.tmp, "gray.png")
        open(gp, "wb").write(g)
        o, args = self.out("gray-out.glb")
        args[args.index("--new-normal") + 1] = gp
        args[args.index("--expect-png-sha") + 1] = hashlib.sha256(g).hexdigest()
        args[args.index("--bake-report") + 1] = self._report_for(g, "gray-bake.json")
        r = run_bind(args)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))
        self.assertFalse(os.path.exists(o + ".prov.json"))

    def test_interlaced_png_refuses_no_outputs(self):
        iz = interlaced_rgb(self.new)
        self.assertIsNone(decode_png(iz))
        ip = os.path.join(self.tmp, "inter.png")
        open(ip, "wb").write(iz)
        o, args = self.out("inter-out.glb")
        args[args.index("--new-normal") + 1] = ip
        args[args.index("--expect-png-sha") + 1] = hashlib.sha256(iz).hexdigest()
        args[args.index("--bake-report") + 1] = self._report_for(iz, "inter-bake.json")
        r = run_bind(args)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))
        self.assertFalse(os.path.exists(o + ".prov.json"))

    def test_stage_copies_actual_report_facts(self):
        rr = os.path.join(self.tmp, "facts-bake.json")
        json.dump({"inputGlbFullSha": self.srcsha, "bakeInputGlbFullSha": self.srcsha,
                   "outputPngSha": hashlib.sha256(self.new).hexdigest(),
                   "recipe": "facts-recipe-v9", "vsha": "x", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test",
                   "derivationMode": "procedural-stylized-analytic-heightfield: facts",
                   "generator": "python-facts analytic-heightfield",
                   "renderRecipe": "facts heightfield render",
                   "meshSurfaceBake": False, "measuredSkinPores": False,
                   "photorealClaim": False, "bindingScope": "facts",
                   "vshaScope": "facts",
                   "runtime": "pythonfacts/numpyfacts/analytic-heightfield/NO-BLENDER/NO-MESH-BAKE",
                   "pore": {"mechanism": "facts-pore", "seed": 7, "strength": 0.77}},
                  open(rr, "w"))
        o, args = self.out("facts-out.glb")
        args[args.index("--bake-report") + 1] = rr
        args[args.index("--recipe") + 1] = "facts-recipe-v9"
        r = run_bind(args)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-500:])
        st = json.load(open(o + ".prov.json"))["stages"][-1]
        self.assertEqual(st["bakeRecipe"], "facts-recipe-v9")
        self.assertEqual(st["bakePore"]["seed"], 7)
        self.assertEqual(st["runtime"],
                        "pythonfacts/numpyfacts/analytic-heightfield/NO-BLENDER/NO-MESH-BAKE")
        self.assertEqual(st["derivationMode"],
                        "procedural-stylized-analytic-heightfield: facts")
        self.assertEqual(st["renderRecipe"], "facts heightfield render")
        self.assertIs(st["meshSurfaceBake"], False)
        self.assertNotIn("b0.3-D0.0018+macro", st["runtime"])

    def test_receipt_current_and_history_exact(self):
        o, args = self.out("meta-out.glb")
        before = json.load(open(self.prov))
        r = run_bind(args)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])
        after = json.load(open(o + ".prov.json"))
        glb = open(o, "rb").read()
        self.assertEqual(after["outputSha256"], hashlib.sha256(glb).hexdigest())
        self.assertEqual(after["outputBytes"], len(glb))
        self.assertEqual(after["stages"][-1]["priorOutputSha256"], before["outputSha256"])
        self.assertEqual(after["stages"][-1]["priorOutputBytes"], before["outputBytes"])
        for k in ["schemaVersion", "licenseChain", "promotionGates",
                  "generatedAt", "byteLineage", "history"]:
            self.assertEqual(after[k], before[k])
        self.assertEqual(len(after["stages"]), len(before.get("stages", [])) + 1)


    def _append_fixture(self):
        glb = os.path.join(self.tmp, "append-in.glb")
        srcsha = make_glb(glb, self.old, self.alb, retired=False)
        rep = os.path.join(self.tmp, "append-bake.json")
        json.dump({"inputGlbFullSha": srcsha, "bakeInputGlbFullSha": srcsha,
                   "outputPngSha": hashlib.sha256(self.new).hexdigest(),
                   "recipe": "test-recipe", "vsha": "x", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test",
                   "derivationMode": "procedural-stylized-analytic-heightfield: test",
                   "generator": "python-test analytic-heightfield",
                   "renderRecipe": "test heightfield render",
                   "meshSurfaceBake": False, "measuredSkinPores": False,
                   "photorealClaim": False, "bindingScope": "test", "vshaScope": "test",
                   "runtime": "pythontest/analytic-heightfield/NO-BLENDER/NO-MESH-BAKE"},
                  open(rep, "w"))
        prov = os.path.join(self.tmp, "append-prov.json")
        json.dump({"stages": []}, open(prov, "w"))
        return glb, srcsha, rep, prov

    def _append_args(self, glb, srcsha, rep, prov, out):
        return ["--src", glb, "--new-normal", self.npng,
                "--expect-src-sha", srcsha,
                "--expect-png-sha", hashlib.sha256(self.new).hexdigest(),
                "--skin-sub", "skin-test-mat",
                "--prov-in", prov, "--recipe", "test-recipe",
                "--bake-report", rep, "--append-new-image",
                "--out", out, "--prov-out", out + ".prov.json"]

    def _glb_json(self, path):
        d = open(path, "rb").read()
        jl, = struct.unpack("<I", d[12:16])
        return json.loads(d[20:20 + jl]), d

    def _assert_container(self, path):
        j, d = self._glb_json(path)
        jl, = struct.unpack("<I", d[12:16])
        binlen = struct.unpack("<I", d[20 + jl:20 + jl + 4])[0]
        self.assertIn("buffers", j)
        self.assertEqual(len(j["buffers"]), 1)
        self.assertEqual(j["buffers"][0]["byteLength"], binlen)
        for v in j.get("bufferViews", []):
            self.assertLessEqual(v.get("byteOffset", 0) + v.get("byteLength", 0), binlen)

    def test_append_new_image_positive(self):
        glb, srcsha, rep, prov = self._append_fixture()
        j0, _ = self._glb_json(glb)
        old_views = [dict(v) for v in j0["bufferViews"]]
        n_img, n_tex = len(j0["images"]), len(j0.get("textures", []))
        o = os.path.join(self.tmp, "append-out.glb")
        r = run_bind(self._append_args(glb, srcsha, rep, prov, o))
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-500:])
        j2, d2 = self._glb_json(o)
        si = [m for m in j2["materials"] if "skin-test" in m.get("name", "")]
        self.assertEqual(len(si), 1)
        self.assertEqual(si[0]["normalTexture"]["scale"], 1.0)
        self.assertEqual(j2["bufferViews"][:-1], old_views)
        self.assertEqual(len(j2["images"]), n_img + 1)
        self.assertEqual(len(j2.get("textures", [])), n_tex + 1)
        st = json.load(open(o + ".prov.json"))["stages"][-1]
        self.assertEqual(st["flow"], "append-new-image")
        self.assertIs(st["oldNormalSha"], None)
        self.assertEqual(j2["bufferViews"][-1]["buffer"], 0)
        jl2, = struct.unpack("<I", d2[12:16])
        binlen = struct.unpack("<I", d2[20 + jl2:20 + jl2 + 4])[0]
        self.assertEqual(binlen % 4, 0)
        self._assert_container(o)
        rep_out = json.loads(r.stdout.strip().split("BIND ", 1)[1])
        self.assertEqual(rep_out["bars"], [True, True, True])
        self.assertEqual(rep_out["flow"], "append-new-image")

    def test_append_refuses_when_already_bound(self):
        glb, srcsha, rep, prov = self._append_fixture()
        o = os.path.join(self.tmp, "append-once.glb")
        r = run_bind(self._append_args(glb, srcsha, rep, prov, o))
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-500:])
        o2 = os.path.join(self.tmp, "append-twice.glb")
        sha2 = hashlib.sha256(open(o, "rb").read()).hexdigest()
        rep2 = os.path.join(self.tmp, "append-bake2.json")
        d = json.load(open(rep))
        d.update({"inputGlbFullSha": sha2, "bakeInputGlbFullSha": sha2})
        json.dump(d, open(rep2, "w"))
        r2 = run_bind(self._append_args(o, sha2, rep2, o + ".prov.json", o2))
        self.assertNotEqual(r2.returncode, 0)
        self.assertIn("already bound", r2.stderr)
        self.assertFalse(os.path.exists(o2))
        self.assertFalse(os.path.exists(o2 + ".prov.json"))


    def _reuse_glb(self, path, mutate=None):
        images = [{"name": "albedo", "mimeType": "image/png", "bufferView": 0},
                  {"name": "skin-normal", "mimeType": "image/png", "bufferView": 1}]
        textures = [{"source": 0}, {"source": 1}]
        bvs = [{"byteOffset": 0, "byteLength": len(self.alb)},
               {"byteOffset": len(self.alb), "byteLength": len(self.old)}]
        blob = self.alb + self.old
        if mutate:
            images, textures = mutate(images, textures)
        doc = {
            "asset": {"version": "2.0"},
            "materials": [{"name": "skin-test-mat"}],
            "meshes": [{"name": "body-test",
                        "primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 1},
                                        "material": 0}]}],
            "images": images, "textures": textures, "bufferViews": bvs,
            "buffers": [{"byteLength": len(blob)}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                          {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC2"}],
        }
        js = json.dumps(doc, separators=(",", ":")).encode()
        while len(js) % 4:
            js += b" "
        glb = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
               + struct.pack("<II", len(js), 0x4E4F534A) + js
               + struct.pack("<II", len(blob), 0x004E4942) + blob)
        open(path, "wb").write(glb)
        return hashlib.sha256(glb).hexdigest()

    def _reuse_args(self, glb, srcsha, rep, prov, out, oldsha=None, extra=()):
        a = ["--src", glb, "--new-normal", self.npng,
             "--expect-src-sha", srcsha,
             "--expect-png-sha", hashlib.sha256(self.new).hexdigest(),
             "--expect-old-sha", oldsha or hashlib.sha256(self.old).hexdigest(),
             "--skin-sub", "skin-test-mat",
             "--prov-in", prov, "--recipe", "test-recipe",
             "--bake-report", rep, "--reuse-unbound-normal-texture",
             "--out", out, "--prov-out", out + ".prov.json"]
        return a + list(extra)

    def _reuse_rep_prov(self, srcsha, name):
        rr = os.path.join(self.tmp, name + ".json")
        json.dump({"inputGlbFullSha": srcsha, "bakeInputGlbFullSha": srcsha,
                   "outputPngSha": hashlib.sha256(self.new).hexdigest(),
                   "recipe": "test-recipe", "vsha": "x", "bodyMeshBase": "body-test",
                   "bodyMesh": "body-test",
                   "derivationMode": "procedural-stylized-analytic-heightfield: test",
                   "generator": "python-test analytic-heightfield",
                   "renderRecipe": "test heightfield",
                   "meshSurfaceBake": False, "measuredSkinPores": False,
                   "photorealClaim": False, "bindingScope": "test", "vshaScope": "test",
                   "runtime": "pythontest/analytic-heightfield/NO-BLENDER/NO-MESH-BAKE"},
                  open(rr, "w"))
        pv = os.path.join(self.tmp, name + ".prov.json")
        json.dump({"stages": []}, open(pv, "w"))
        return rr, pv

    def _view_bytes(self, path):
        d = open(path, "rb").read()
        jl, = struct.unpack("<I", d[12:16])
        j = json.loads(d[20:20 + jl])
        off = 20 + jl
        bl, = struct.unpack("<I", d[off:off + 4])
        binary = d[off + 8:off + 8 + bl]
        out = {}
        for vi, v in enumerate(j["bufferViews"]):
            s = v.get("byteOffset", 0)
            out[vi] = binary[s:s + v["byteLength"]]
        return j, out

    def test_reuse_positive_reuses_orphan_index(self):
        g = os.path.join(self.tmp, "reuse-in.glb")
        s = self._reuse_glb(g)
        rep, prov = self._reuse_rep_prov(s, "reuse-bake")
        o = os.path.join(self.tmp, "reuse-out.glb")
        r = run_bind(self._reuse_args(g, s, rep, prov, o))
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-800:])
        j0, b0 = self._view_bytes(g)
        j2, b2 = self._view_bytes(o)
        self.assertEqual(len(j2["textures"]), len(j0["textures"]))
        self.assertEqual(len(j2["images"]), len(j0["images"]))
        si = next(i for i, m in enumerate(j2["materials"]) if "skin-test" in m["name"])
        self.assertEqual(j2["materials"][si]["normalTexture"], {"index": 1, "scale": 1.0})
        self.assertEqual(b2[0], b0[0])
        self.assertEqual(b2[1], self.new)
        self.assertEqual(j2["meshes"], j0["meshes"])
        self.assertEqual(j2["accessors"], j0["accessors"])
        rep_out = json.loads(r.stdout.strip().split("BIND ", 1)[1])
        self.assertEqual(rep_out["flow"], "reuse-unbound-normal-texture")
        st = json.load(open(o + ".prov.json"))["stages"][-1]
        self.assertEqual(st["flow"], "reuse-unbound-normal-texture")
        self._assert_container(o)

    def _reuse_refuses(self, mutate, extra=(), oldsha=None, name="reuse-neg"):
        g = os.path.join(self.tmp, name + "-in.glb")
        s = self._reuse_glb(g, mutate=mutate)
        rep, prov = self._reuse_rep_prov(s, name + "-bake")
        o = os.path.join(self.tmp, name + "-out.glb")
        args = self._reuse_args(g, s, rep, prov, o, oldsha=oldsha, extra=extra)
        r = run_bind(args)
        self.assertNotEqual(r.returncode, 0, name)
        self.assertFalse(os.path.exists(o), name)
        self.assertFalse(os.path.exists(o + ".prov.json"), name)
        return r

    def test_reuse_refuses_shared_albedo(self):
        def m(images, textures):
            textures[0]["source"] = 1
            return images, textures
        self._reuse_refuses(m, name="reuse-shared")

    def test_reuse_refuses_other_material_normal(self):
        def m(images, textures):
            return images, textures
        g = os.path.join(self.tmp, "reuse-mat-in.glb")
        s = self._reuse_glb(g, mutate=m)
        j, _ = self._glb_json(g)
        j["materials"].append({"name": "other-mat", "normalTexture": {"index": 1}})
        d = open(g, "rb").read()
        jl, = struct.unpack("<I", d[12:16])
        off = 20 + jl
        bl, = struct.unpack("<I", d[off:off + 4])
        binary = d[off + 8:off + 8 + bl]
        doc = json.dumps(j, separators=(",", ":")).encode()
        while len(doc) % 4:
            doc += b" "
        open(g, "wb").write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(doc) + 8 + len(binary))
                            + struct.pack("<II", len(doc), 0x4E4F534A) + doc
                            + struct.pack("<II", len(binary), 0x004E4942) + binary)
        s = hashlib.sha256(open(g, "rb").read()).hexdigest()
        rep, prov = self._reuse_rep_prov(s, "reuse-mat-bake")
        o = os.path.join(self.tmp, "reuse-mat-out.glb")
        r = run_bind(self._reuse_args(g, s, rep, prov, o))
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))

    def test_reuse_refuses_khr_nested_texture_info(self):
        def m(images, textures):
            textures[1]["extensions"] = {"KHR_texture_transform": {"offset": [0, 0]}}
            return images, textures
        self._reuse_refuses(m, name="reuse-khr")

    def test_reuse_refuses_multi_parent(self):
        def m(images, textures):
            textures.append({"source": 1})
            return images, textures
        self._reuse_refuses(m, name="reuse-multi")

    def test_reuse_refuses_wrong_old_hash(self):
        self._reuse_refuses(None, oldsha="0" * 64, name="reuse-wronghash")

    def test_reuse_refuses_trust_flag(self):
        self._reuse_refuses(None, extra=("--trust-name-match",), name="reuse-trust")

    def test_reuse_refuses_opaque_image_ref(self):
        def m(images, textures):
            images[1]["extensions"] = {"X": 1}
            return images, textures
        self._reuse_refuses(m, name="reuse-opaque")

    def test_reuse_no_clobber_writes_nothing(self):
        g = os.path.join(self.tmp, "reuse-clob-in.glb")
        s = self._reuse_glb(g)
        rep, prov = self._reuse_rep_prov(s, "reuse-clob-bake")
        o = os.path.join(self.tmp, "reuse-clob-out.glb")
        open(o, "wb").write(b"x")
        po = o + ".prov.json"
        open(po, "w").write('{"keep": true}')
        r = run_bind(self._reuse_args(g, s, rep, prov, o))
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(open(o, "rb").read(), b"x")
        self.assertEqual(open(po).read(), '{"keep": true}')

    def test_reuse_refuses_occlusion_with_extra_keys(self):
        g = os.path.join(self.tmp, "reuse-occ-in.glb")
        s = self._reuse_glb(g)
        j, _ = self._glb_json(g)
        j["materials"].append({"name": "other-mat",
                               "occlusionTexture": {"index": 1, "strength": 0.5}})
        self._rewrite_glb(g, j)
        s = hashlib.sha256(open(g, "rb").read()).hexdigest()
        rep, prov = self._reuse_rep_prov(s, "reuse-occ-bake")
        o = os.path.join(self.tmp, "reuse-occ-out.glb")
        r = run_bind(self._reuse_args(g, s, rep, prov, o))
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))
        self.assertFalse(os.path.exists(o + ".prov.json"))

    def _rewrite_glb(self, path, j):
        d = open(path, "rb").read()
        jl, = struct.unpack("<I", d[12:16])
        off = 20 + jl
        bl, = struct.unpack("<I", d[off:off + 4])
        binary = d[off + 8:off + 8 + bl]
        doc = json.dumps(j, separators=(",", ":")).encode()
        while len(doc) % 4:
            doc += b" "
        open(path, "wb").write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(doc) + 8 + len(binary)) + struct.pack("<II", len(doc), 0x4E4F534A) + doc + struct.pack("<II", len(binary), 0x004E4942) + binary)

    def test_reuse_refuses_opaque_root_reference(self):
        g = os.path.join(self.tmp, "reuse-root-in.glb")
        s = self._reuse_glb(g)
        j, _ = self._glb_json(g)
        j["extensions"] = {"X_root": {"texture": 1}}
        self._rewrite_glb(g, j)
        s = hashlib.sha256(open(g, "rb").read()).hexdigest()
        rep, prov = self._reuse_rep_prov(s, "reuse-root-bake")
        o = os.path.join(self.tmp, "reuse-root-out.glb")
        r = run_bind(self._reuse_args(g, s, rep, prov, o))
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))
        self.assertFalse(os.path.exists(o + ".prov.json"))

    def test_reuse_refuses_accessor_bufferview_sharing(self):
        g = os.path.join(self.tmp, "reuse-acc-in.glb")
        s = self._reuse_glb(g)
        j, _ = self._glb_json(g)
        j["accessors"].append({"bufferView": 1, "componentType": 5126, "count": 1, "type": "SCALAR"})
        self._rewrite_glb(g, j)
        s = hashlib.sha256(open(g, "rb").read()).hexdigest()
        rep, prov = self._reuse_rep_prov(s, "reuse-acc-bake")
        o = os.path.join(self.tmp, "reuse-acc-out.glb")
        r = run_bind(self._reuse_args(g, s, rep, prov, o))
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))
        self.assertFalse(os.path.exists(o + ".prov.json"))

    def test_replacement_refuses_expect_old_sha(self):
        o, args = self.out("oldsha-out.glb")
        r = run_bind(args + ["--expect-old-sha", "0" * 64])
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))
        self.assertFalse(os.path.exists(o + ".prov.json"))

    def test_reuse_refuses_non_png_target(self):
        g = os.path.join(self.tmp, "reuse-badmime-in.glb")
        s = self._reuse_glb(g)
        j, _ = self._glb_json(g)
        j["images"][1]["mimeType"] = "image/jpeg"
        self._rewrite_glb(g, j)
        s = hashlib.sha256(open(g, "rb").read()).hexdigest()
        rep, prov = self._reuse_rep_prov(s, "reuse-badmime-bake")
        o = os.path.join(self.tmp, "reuse-badmime-out.glb")
        r = run_bind(self._reuse_args(g, s, rep, prov, o))
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(o))
        self.assertFalse(os.path.exists(o + ".prov.json"))


if __name__ == "__main__":
    unittest.main()
