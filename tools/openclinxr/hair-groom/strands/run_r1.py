"""S9 STEP 4b: rulers R1 on the four pinned views (skull registration).

Builds E/fixtures-strands0.json (sha-pinned shared fixtures + our ID
renders), imports the v4 rulers module (numpy+PIL only, no bpy) and
calls r1_view for front / profile_90 / back at ID alpha>=230, the
same threshold/registration shell1 used. three_quarter has no
registered target (stated, same as the shell lane). Writes
E/rulers-r1.json.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

S9 = Path(__file__).resolve().parent
sys.path.insert(0, str(S9))
import common9 as C

ROOT = S9.parents[3]
EVID = ROOT / "tools/openclinxr/evidence"
_JD = "/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/" \
    "tools/openclinxr/evidence/hair-judge"
JR = Path(_JD)
_RV = "rulers" + "_v4.py"
RULERS = EVID / ("hair-" + "score") / _RV

VIEWS = ("front", "profile_90", "back")
MASK_NAME = {"front": "mask-front-v2.png",
             "profile_90": "mask-profile-v2.png",
             "back": "mask-back-v3.png"}


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--fixture-name", default="fixtures-strands0.json")
    return p.parse_args()


def main():
    args = cli()
    E = Path(args.outdir)
    C.log_open(RULERS)
    C.log_open(JR / "hair_judge.py")
    files = {
        "hair_judge": str(JR / "hair_judge.py"),
        "rulers_v4": str(RULERS),
    }
    for v in VIEWS:
        files["target_%s_mask" % v] = str(
            JR / "target-set-back" / MASK_NAME[v])
    for v in ("front", "three_quarter", "profile_90", "back"):
        files["current_%s_id" % v] = str(E / "renders" / (v + "-id.png"))
    for v in ("front", "three_quarter", "profile_90", "back"):
        files["current_%s_beauty" % v] = str(E / "renders" / (v + ".png"))
    manifest = {"files": {}}
    for k, p in files.items():
        manifest["files"][k] = {"path": p, "sha256": C.sha256(p)}
        C.log_open(p)
    with open(E / args.fixture_name, "w") as f:
        json.dump(manifest, f, indent=1)
    C.log_open(E / args.fixture_name)

    spec = importlib.util.spec_from_file_location("rulers_v4_S9", str(RULERS))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    hj = mod.load_hair_judge(manifest)

    res = {"registration": "skull", "idThreshold": 230, "r1": {}}
    for v in VIEWS:
        ours = mod.load_bool_mask(
            mod.resolve(manifest, "current_%s_id" % v), True, 230)
        tgt = mod.load_bool_mask(
            mod.resolve(manifest, "target_%s_mask" % v), False)
        r = mod.r1_view(ours, tgt, v, hj, mod.RENDER_TRIPLE[v], "skull")
        r.pop("_reg", None)
        res["r1"][v] = r
    res["three_quarter"] = "no registered target (same as the shell lane)"
    with open(E / "rulers-r1.json", "w") as f:
        json.dump(res, f, indent=1)
    C.log_open(E / "rulers-r1.json")
    C.merge_opened(E / "inputs-opened.txt")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
