"""pass9: children passes for hair-guides-9 via PT/blend_part.run_pass.

M6 maps PT's run_pass(tag A|B) onto brief passes A (~2,000) / B (~50,000)
with part closure + fill ON. PT file is NEVER edited: this wrapper imports
it by path and forces part_closure=True/part_fill=True at call time only
(run_pass itself calls blend_children with False/False defaults, which is
the C0 setting — wrong for this brief).
Usage (from repo root):
  Blender --background --python tools/openclinxr/evidence/hair-guides9/pass9_wrapper.py -- \\
    --guides tools/openclinxr/evidence/hair-guides9/A/guides9.npz \\
    --out tools/openclinxr/evidence/hair-guides9/A --tag A|B
"""
import argparse
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PT = HERE.parent / "hair-part" / "blend_part.py"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--guides", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tag", choices=("A", "B"), required=True)
    aa = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])
    spec = importlib.util.spec_from_file_location("oclx_blend_part", str(PT))
    bp = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = bp
    spec.loader.exec_module(bp)
    _orig = bp.blend_children

    def _forced(guides, cap, n, seed=0, meta=None, part_closure=False, part_fill=False):
        return _orig(guides, cap, n, seed, meta, part_closure=True, part_fill=True)

    bp.blend_children = _forced
    print("PASS9 closure=on fill=on file=%s (unmodified)" % PT, flush=True)
    bp.run_pass(aa.guides, aa.out, aa.tag)
    print("PASS9_DONE %s" % aa.tag, flush=True)


main()
