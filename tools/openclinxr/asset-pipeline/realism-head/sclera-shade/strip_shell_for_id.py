"""Strip the occlusion shell + tearline meshes from a baked GLB for ID renders.

CARD tsk_57f4ae74d62739e0: the ID pass documents "occlusion shell and tearline
hidden" (shell-placement-report.json diagnosis), but the variant `hide` path
crashes the lab readback on the shell's unlit material (MeshBasicMaterial has
no .emissive; isolated-subject-material-variants.ts readbackMaterial assumes
Standard/Physical). No harness change is made here. Instead this script writes
a store-side ID-only copy of the round GLB with the shell/tearline mesh slots
cleared (mesh-less nodes; all indices stable), so the ID render keys the full
visible globe exactly as the shell-free PRE bakes do.

Shell-visible ID renders contaminate the mask with shell strength (r1 ID keys
4496 vs r2 3580 at full power): strong-shell rounds lose upper-band keys and
their G1/D90 rest on a shifted population. Stripped ID restores
apples-to-apples PRE-vs-POST (and matches the s5/s6 mask scale).

Usage:
  strip_shell_for_id.py --in <round glb> --out <id glb>
Matches mesh names against: occlusion_shell|tearline (caruncle kept: not globe).
"""

import argparse
import re
import sys

from pygltflib import GLTF2

PAT = re.compile(r"occlusion_shell|tearline", re.IGNORECASE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    args = ap.parse_args()
    g = GLTF2().load(args.inp)
    cleared = []
    for ni, node in enumerate(g.nodes):
        if node.mesh is not None:
            m = g.meshes[node.mesh]
            if m.name and PAT.search(m.name):
                cleared.append((ni, node.name, m.name))
                node.mesh = None
    if not cleared:
        print("REFUSED: no shell/tearline mesh found", file=sys.stderr)
        sys.exit(2)
    g.save(args.out)
    for ni, nn, mn in cleared:
        print(f"cleared node {ni} ({nn}) mesh {mn}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
