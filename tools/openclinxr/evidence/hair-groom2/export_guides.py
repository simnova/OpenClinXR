#!/usr/bin/env python3
"""hair-groom2: export guides.npz from grown streamlines (route2 schema).

Same export math as orient s05_export (41-pt arc resample, world-mm ->
head-mm via the station crown, tube_r 3.0) so strands children.py drops
in unchanged. Verdict recomputed by the s05 rule for the record.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
S10 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2"
           "/tools/openclinxr/hair-groom/orient")
sys.path.insert(0, str(S10))
import common_o as CO  # noqa: E402
import measure as ME  # noqa: E402

VIEWS4 = ("front", "three_quarter", "profile_90", "back")


def main():
    t0 = time.time()
    opened = [str(Path(__file__).resolve()), str(S10 / "common_o.py"),
              str(S10 / "measure.py")]
    sys.path.insert(0, str(S10.parent / "route"))
    sys.path.insert(0, str(S10.parent / "cage"))
    sys.path.insert(0, str(S10.parent))
    frame = np.load("/tmp/station0b-run/station-frame.npz")
    opened.append("/tmp/station0b-run/station-frame.npz")
    crown = np.array(frame["point3d/crown"], dtype=np.float64)

    G = np.load(str(E / "grown.npz"))
    opened.append(str(E / "grown.npz"))
    stats = json.loads((E / "grow-stats.json").read_text())
    score = json.loads((E / "score.json").read_text())
    n = len(G["roots_mm"])

    fail = []
    if stats["unreachable"] != 0:
        fail.append("unreachable=%d" % stats["unreachable"])
    if stats["partCrossings"]["crossingsOver2mm"] != 0:
        fail.append("partCrossings=%d"
                    % stats["partCrossings"]["crossingsOver2mm"])
    eg = stats["ear"]
    if not eg["gate"]["pass"]:
        fail.append("ear near3 xpos/xneg=%d/%d covering=%d" % (
            eg["xpos"]["nGuidesNear3mm"], eg["xneg"]["nGuidesNear3mm"],
            eg["occlusion"]["nGuidesCovering"]))
    for view in VIEWS4:
        a, b = score["orientAgree"][view]["wmean"], \
            score["route2Agree"][view]["wmean"]
        if not (a < b):
            fail.append("agree %s %.1f>=%.1f" % (view, a, b))
    for view in VIEWS4:
        w = score["orientRegional"][view]["whole"]
        for m, lim in (("excessP50", 12.0), ("excessP95", 24.0),
                       ("missP50", 12.0), ("missP95", 24.0)):
            if w[m] > lim:
                fail.append("%s %s=%.1f" % (view, m, w[m]))
    if score["orientFaceGuards"]["totalCoveredPx"] != 0:
        fail.append("faceGuards=%d"
                    % score["orientFaceGuards"]["totalCoveredPx"])
    verdict = "ADEQUATE" if not fail else "MODEL_INADEQUATE"

    curves = [np.array(G["curves_mm"][j]) for j in range(n)]
    curves = [c[np.isfinite(c).all(axis=1)] for c in curves]
    ch = np.zeros((n, 41, 3))
    ok_idx = []
    status = []
    for j, c in enumerate(curves):
        if len(c) < 2:
            status.append("unreachable")
            continue
        ch[j] = CO.world_to_head(ME.resample_arc41(c / 1000.0, 41),
                                 crown)
        ok_idx.append(j)
        status.append("grown")
    ok_idx = np.array(ok_idx, dtype=np.int64)
    np.savez_compressed(
        str(E / "guides.npz"), curves_head=ch, crown=crown,
        param_names=np.array(["tube_r"]),
        param_values=np.array([3.0]),
        spec_sha=np.array(["groom1"]),
        status=np.array(status),
        ok_idx=ok_idx,
        roots_file=np.array(["hair-scalp1/roots.npz Poisson "
                             "streamline-grown on orient field "
                             "(hull5 support)"]),
        y_ear_mm=np.array([float(np.asarray(
            G["y_ear_mm"]).ravel()[0])]),
        verdict=np.array([verdict]))
    print("WROTE guides.npz guides=%d ok=%d verdict=%s" % (
        n, len(ok_idx), verdict), flush=True)
    if fail:
        print("FAILURES: " + "; ".join(fail), flush=True)
    prev = []
    if (E / "inputs-opened.txt").exists():
        prev = [ln.strip() for ln in
                (E / "inputs-opened.txt").read_text().splitlines()
                if ln.strip()]
    (E / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(prev) | set(opened))) + "\n")
    print("export done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
