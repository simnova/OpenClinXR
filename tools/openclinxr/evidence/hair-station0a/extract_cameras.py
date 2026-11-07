#!/usr/bin/env python3
"""Evidence-only extraction: scorer v3 camera frame -> station cameras file.

Reads (never modifies):
  hair-hem2/scores/c_curve/score.json  (render.cameras + orientation.transforms)
  hair-score/orientation.py            (RENDER_TRIPLES, TARGET_TRIPLES_RAW,
                                        SKULL_OFFSET_MM, SKULL_H_MM constants,
                                        parsed via ast — not imported)
Writes (the station's new pinned input):
  tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json
Camera records (lensMm, location, matrixWorld) are copied VERBATIM.
Registration triples are the scorer's effective inputs: rounded render
triples + raw target triples with the skull-mode front offset applied by
the same formula, then cross-checked by recomputing the three stored
orientation transforms exactly.
"""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-p7")
SCORE = ROOT / "tools/openclinxr/evidence/hair-hem2/scores/c_curve/score.json"
ORIENTATION = ROOT / "tools/openclinxr/evidence/hair-score/orientation.py"
OUT = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
VIEWS = ("front", "three_quarter", "profile_90", "back", "crown_top")
REG_VIEWS = ("front", "profile_90", "back")


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    score = json.loads(SCORE.read_text())
    assert score["schemaVersion"] == "openclinxr.hair-score.v3", score["schemaVersion"]
    tree = ast.parse(ORIENTATION.read_text())
    consts = {}
    wanted = {"RENDER_TRIPLES", "TARGET_TRIPLES_RAW", "SKULL_OFFSET_MM", "SKULL_H_MM"}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 \
                and isinstance(node.targets[0], ast.Name) \
                and node.targets[0].id in wanted:
            consts[node.targets[0].id] = ast.literal_eval(node.value)
    assert wanted <= set(consts), sorted(consts)
    render_triples = consts["RENDER_TRIPLES"]
    raw = consts["TARGET_TRIPLES_RAW"]
    h_mm = float(consts["SKULL_H_MM"])
    assert float(consts["SKULL_OFFSET_MM"]) == 10.0

    def target_triple(view):
        a, b, c = [float(v) for v in raw[view]]
        if view == "front":
            a = a + 10.0 * ((b - a) / h_mm)
        return (a, b, c)

    views = {}
    for view in VIEWS:
        cam = score["render"]["cameras"][view]
        views[view] = {
            "lensMm": float(cam["lensMm"]),
            "location": [[float(v) for v in row] if isinstance(row, list) else float(row)
                         for row in cam["location"]] if isinstance(cam["location"], list) else None,
            "matrixWorld": [[float(v) for v in row] for row in cam["matrixWorld"]],
        }
        assert views[view]["location"] == [float(v) for v in cam["location"]]
        assert views[view]["matrixWorld"] == [[float(v) for v in r] for r in cam["matrixWorld"]]
        assert views[view]["lensMm"] == float(cam["lensMm"])

    reg_render = {v: [float(x) for x in render_triples[v]] for v in REG_VIEWS}
    reg_target = {v: list(target_triple(v)) for v in REG_VIEWS}

    check = {}
    for view in REG_VIEWS:
        a_r, b_r, c_r = reg_render[view]
        a_t, b_t, c_t = reg_target[view]
        s = (b_t - a_t) / (b_r - a_r)
        got = {"scale": s, "tx": c_t - s * c_r, "ty": a_t - s * a_r}
        want = score["orientation"][view]["transform"]
        delta = {k: abs(got[k] - want[k]) for k in got}
        check[view] = {"recomputed": got, "stored": want, "absDelta": delta}
        assert all(v < 1e-12 for v in delta.values()), (view, delta)

    doc = {
        "source": {"scoreLabel": "scorer v3 c_curve score document",
                   "scoreSha256": sha(SCORE),
                   "schemaVersion": score["schemaVersion"],
                   "orientationSha256": sha(ORIENTATION),
                   "resolutionPx": int(score["render"]["resolutionPx"])},
        "sensorWidthMm": 36.0,
        "views": views,
        "registrationRenderTriples": reg_render,
        "registrationTargetTriples": reg_target,
        "targetTripleProvenance": "raw target-set landmarks + skull-mode front offset "
            "a += 10mm * (H_target_raw / %.16f)" % h_mm,
        "orientationCrossCheck": check,
    }
    OUT.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
    print("WROTE", OUT, sha(OUT))
    for view in REG_VIEWS:
        print(" ", view, "render", reg_render[view], "target",
              [round(x, 6) for x in reg_target[view]])


if __name__ == "__main__":
    main()
