#!/usr/bin/env python3
"""hair-hem1 STEP 3 figures: crops-best.png (native) + look-sheet.png."""
import numpy as np
from PIL import Image

E = "tools/openclinxr/evidence/hair-hem1"
T = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back"
BEST = "c_best8"


def native(p):
    return np.asarray(Image.open(p).convert("RGB"))


# crops-best: rows back/front/profile hem bands (native), cols base|best|TS
bands = {"back": (600, 850), "front": (550, 800), "profile_90": (550, 800)}
rows = []
for v, (y0, y1) in bands.items():
    cols = []
    for src in [f"{E}/base/{v}.png", f"{E}/scores/{BEST}/{v}.png",
                f"{T}/target-{v.split('_')[0]}.png"]:
        im = native(src)[y0:y1, :, :]
        cols.append(im)
    rows.append(np.hstack(cols))
Image.fromarray(np.vstack(rows)).save(f"{E}/crops-best.png")
print("crops-best:", np.vstack(rows).shape)

# look-sheet: rows TS|base|best; cols front512, profile512, back512, backhem(pad)
fr = []
for tag, srcs in [("TS", [f"{T}/target-front.png", f"{T}/target-profile.png",
                           f"{T}/target-back.png"]),
                  ("base", [f"{E}/base/front.png",
                             f"{E}/base/profile_90.png", f"{E}/base/back.png"]),
                  ("best", [f"{E}/scores/{BEST}/front.png",
                             f"{E}/scores/{BEST}/profile_90.png",
                             f"{E}/scores/{BEST}/back.png"])]:
    panels = [np.asarray(Image.open(p).convert("RGB").resize((512, 512),
                      Image.LANCZOS)) for p in srcs]
    hem = native(srcs[2])[600:850, 150:874, :]          # 724x250 native
    hem = np.asarray(Image.fromarray(hem).resize((512, 178), Image.LANCZOS))
    pad = np.full((512 - 178, 512, 3), 114, np.uint8)
    panels.append(np.vstack([hem, pad]))
    fr.append(np.hstack(panels))
Image.fromarray(np.vstack(fr)).save(f"{E}/look-sheet.png")
print("look-sheet:", np.vstack(fr).shape)
