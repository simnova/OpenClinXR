"""Procedural-receipt tests via the actual binder (stdlib only, shared fixtures).

No artifact snapshots, no implementation string asserts, no numpy/scipy:
builds the shared fixture GLB from test_bind_unittest, runs the real
bind_skin_normal.py with a procedural-style report, and proves the stage
copies the actual report facts (runtime/derivationMode/generator/
renderRecipe/flags/bakeRecipe) and appends history without rewriting it.
"""
import hashlib
import json
import os
import sys
import unittest

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import test_bind_unittest as _tu

class TestProceduralReceipt(unittest.TestCase):
    def _fresh(self):
        t = _tu.BindTests("test_happy_path_and_replay_exact")
        t.setUp()
        import shutil
        self.addCleanup(shutil.rmtree, t.tmp, True)
        return t


def _proceduralize(t, runtime="pyT/numpyT/scipyT/analytic-heightfield/NO-BLENDER/NO-MESH-BAKE"):
    rep = json.load(open(t.rep))
    rep.update({
        "derivationMode": "procedural-stylized-analytic-heightfield: test",
        "generator": "python-test analytic-heightfield",
        "renderRecipe": "test heightfield render",
        "meshSurfaceBake": False,
        "measuredSkinPores": False,
        "photorealClaim": False,
        "bindingScope": "test",
        "vshaScope": "test",
        "runtime": runtime,
    })
    json.dump(rep, open(t.rep, "w"))
    return rep


class TestProceduralReceipt(unittest.TestCase):
    def _fresh(self):
        t = _tu.BindTests("test_happy_path_and_replay_exact")
        t.setUp()
        import shutil
        self.addCleanup(shutil.rmtree, t.tmp, True)
        return t

    def test_stage_copies_actual_report_receipt(self):
        t = self._fresh()
        rep = _proceduralize(t)
        o, args = t.out("proc-out.glb")
        r = _tu.run_bind(args)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-500:])
        st = json.load(open(o + ".prov.json"))["stages"][-1]
        self.assertEqual(st["runtime"], rep["runtime"])
        self.assertIn("NO-BLENDER", st["runtime"])
        self.assertEqual(st["derivationMode"], rep["derivationMode"])
        self.assertEqual(st["generator"], rep["generator"])
        self.assertEqual(st["renderRecipe"], rep["renderRecipe"])
        self.assertIs(st["meshSurfaceBake"], False)
        self.assertIs(st["measuredSkinPores"], False)
        self.assertIs(st["photorealClaim"], False)
        self.assertEqual(st["bakeRecipe"], rep["recipe"])
        self.assertEqual(st["codeSha"],
                        hashlib.sha256(open(os.path.join(DIR, "..", "bind_skin_normal.py"), "rb").read()).hexdigest())

    def test_history_append_only(self):
        t = self._fresh()
        _proceduralize(t)
        before = json.load(open(t.prov))
        n0 = len(before.get("stages", []))
        o, args = t.out("proc-hist.glb")
        r = _tu.run_bind(args)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-500:])
        new = json.load(open(o + ".prov.json"))
        self.assertEqual(len(new["stages"]), n0 + 1)
        self.assertEqual(new["stages"][:-1], before.get("stages", []))
        for k, v in before.items():
            if k not in ("outputSha256", "outputBytes", "stages"):
                self.assertEqual(new[k], v)
        glb = open(o, "rb").read()
        self.assertEqual(new["outputSha256"], hashlib.sha256(glb).hexdigest())
        self.assertEqual(new["outputBytes"], len(glb))


if __name__ == "__main__":
    unittest.main()
