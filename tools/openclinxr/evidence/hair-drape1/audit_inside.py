#!/usr/bin/env python3
"""Audit inside only (no modification) for drape1 refinish."""
import sys, json
from pathlib import Path
import numpy as np
E=Path(__file__).resolve().parent
ROOT=E.parents[3]
sys.path[:0]=[str(E),str(ROOT/"tools/openclinxr/evidence/hair-int1"),str(ROOT/"tools/openclinxr/evidence/hair-look1")]
import run_blender as R
import base_children as B
def main():
    argv=sys.argv[sys.argv.index("--")+1:]
    state=R.ST.build_state()
    for tag in argv:
        cell=E/"cells"/tag
        raw=dict(np.load(cell/"strands.npz"))
        pts=np.asarray(raw["points"],float)
        # audit via repair_outside on a copy? repair_outside modifies; use dry-run: call with copy and check audit pre?
        # base_children.repair_outside returns (fixed, audit); audit has pre_inside_total and post_inside_total.
        fixed,audit=B.repair_outside(pts.copy(),state["handle"])
        print("AUDIT",tag,json.dumps(audit),flush=True)
if __name__=="__main__": main()
