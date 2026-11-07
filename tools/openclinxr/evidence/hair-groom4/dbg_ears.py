#!/usr/bin/env python3
"""hair-groom4 WORKER helper: ear-box counts + ear sheet for current final/id512."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E4 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/evidence/hair-groom4")
E3 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/evidence/hair-groom3")
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
sys.path.insert(0, "/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/hair-groom/orient")
import common_o as CO  # noqa: E402

inp = CO.load_all()
MASKS = {"front": "mask-front.png", "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png"}
IDS = {"groom3": {v: E3 / ("v2b/id512/%s-id.png" % v) for v in MASKS},
       "cur": {v: E4 / ("final/id512/%s-id.png" % v) for v in MASKS}}
BEAU = {"groom3": None,
        "cur": {v: E4 / ("final/id512/%s.png" % v) for v in MASKS}}

for v in ("front", "three_quarter", "profile_90"):
    t = np.array(Image.open(SCR / MASKS[v]).resize((512, 512),
                                                   Image.NEAREST)) > 127
    print("==", v)
    for tag in ("groom3", "cur"):
        a = np.array(Image.open(IDS[tag][v]).convert("RGBA"))[:, :, 3]
        cam = inp["cams"]["views"][v]
        line = [tag]
        for side in ("xpos", "xneg"):
            pin = np.asarray(inp["pinna"][side]) / 1000.0
            cc, rr, dd = CO.C2.ENV.project_to_render(pin, cam,
                                                    inp["sensor"])
            m = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                 & (dd > 0))
            c0, r0 = cc[m].mean() / 2, rr[m].mean() / 2
            box = (slice(max(int(r0) - 5, 0), int(r0) + 6),
                   slice(max(int(c0) - 5, 0), int(c0) + 6))
            line.append("%s:%d" % (side, int((a[box] >= 230).sum())))
        for side in ("xpos", "xneg"):
            pin = np.asarray(inp["pinna"][side]) / 1000.0
            cc, rr, dd = CO.C2.ENV.project_to_render(pin, cam,
                                                    inp["sensor"])
            m = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                 & (dd > 0))
            c0, c1, r0, r1 = (float(cc[m].min()), float(cc[m].max()),
                              float(rr[m].min()), float(rr[m].max()))
            h = r1 - r0
            face = pin.mean(axis=0) + np.array([0, -0.05, 0.0])
            fx, _, _ = CO.C2.ENV.project_to_render(face[None, :], cam,
                                                  inp["sensor"])
            sx = 1.0 if float(fx[0]) - (c0 + c1) / 2 >= 0 else -1.0
            edge = c0 if sx < 0 else c1
            fl = sorted([edge, edge + sx * 60.0])
            flr = [r1 - 0.30 * h, r1]
            nkr = [r1, r1 + 70.0]
            nkc = [c0 - 25.0, c1 + 25.0]
            s = 0.5
            for zn, (zc, zr) in (("FL", (fl, flr)), ("NK", (nkc, nkr))):
                bx = (slice(max(int(zr[0] * s), 0),
                            min(int(zr[1] * s), 512)),
                      slice(max(int(zc[0] * s), 0),
                            min(int(zc[1] * s), 512)))
                line.append("%s%s:o%d" % (
                    side, zn, int(((a[bx] >= 230) & ~t[bx]).sum())))
        print(" ".join(line))

rows = [("target", None), ("cur48", "cur")]
cols = {"3q ear": ("target-three_quarter-a1.png", "three_quarter.png",
                   (380, 660, 330, 610)),
        "prof ear": ("target-profile.png", "profile_90.png",
                     (250, 530, 270, 550))}
T = 340
sheet = Image.new("RGB", (100 + 2 * T, 2 * (T + 24)), (18, 18, 18))
dr = ImageDraw.Draw(sheet)
for i, (label, src) in enumerate(rows):
    for j, (cn, (tn, rn, box)) in enumerate(cols.items()):
        c0, c1, r0, r1 = box
        if src is None:
            im = Image.open(SCR / tn).convert("RGB")
            s = 1.0
        else:
            im = Image.open(E4 / ("final/id512/%s" % rn)).convert("RGB")
            s = im.size[0] / 1024.0
        cell = im.crop((int(c0 * s), int(r0 * s), int(c1 * s),
                        int(r1 * s))).resize((T, T))
        sheet.paste(cell, (100 + j * T, i * (T + 24) + 24))
        if i == 0:
            dr.text((100 + j * T + 8, 4), cn, fill=(240, 240, 240))
    dr.text((10, i * (T + 24) + (T + 24) // 2), label,
            fill=(240, 240, 240))
sheet.save(E4 / "dbg-cur48-ears.png")
print("wrote dbg-cur48-ears.png")
