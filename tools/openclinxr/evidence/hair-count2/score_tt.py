#!/usr/bin/env python3
"""hair-count2 TT adapter: score.py v3 with one extra socket write.

Stock score.py v3 configure_color() sets Color / R lobe / TRT lobe /
Roughness and leaves the Huang 'TT lobe' (Transmission) socket at the
Blender default 1.0; the params key lobe_T is known-but-unconsumed in
COLOR mode. tt0/tt05 need real Transmission changes, so this driver
imports score.py unmodified (its sha is recorded as the scorer input)
and wraps configure_color to also write params['lobe_T'] into the
'TT lobe' socket. All cameras, ID pass, judge, photometrics, bands and
orientation code paths are score.py v3 verbatim.

Run inside Blender:
  Blender --background --python score_tt.py -- \
    --strands STRANDS.npz --params PARAMS.json --out OUT [--crown-top]
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"


def load_score():
    spec = importlib.util.spec_from_file_location("hair_count2_score_v3", SCORE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main():
    S = load_score()
    orig_configure = S.configure_color
    tt_record = {}

    def configure_color_tt(obj, params):
        readback = orig_configure(obj, params)
        node = S.find_hair_node(obj)
        sockets = {s.identifier: s for s in node.inputs}
        tt = float(params.get("lobe_T", 1.0))
        sockets["TT lobe"].default_value = tt
        readback["TT lobe"] = float(sockets["TT lobe"].default_value)
        tt_record["value"] = float(sockets["TT lobe"].default_value)
        return readback

    S.configure_color = configure_color_tt
    S.main()
    print("HAIR_COUNT2_TT_ADAPTER", tt_record.get("value"), flush=True)


if __name__ == "__main__":
    main()
