"""Card atlas colour measured under the groom rig (numpy + Pillow; Blender's python).

    <blender python> calib_colour.py --strands <groom round> --base <no-hair round> \
        --cards <card round> --atlas-in <atlas.png> --atlas-out <atlas.png> --record <json> \
        [--gain-in <previous record>]

The atlas tiles are rendered under a uniform white world (atlas_bake.py), a single strand sheet with
no self-shadowing, so a Principled card textured with them renders lighter than the HUANG volume it
stands for (cards-r1: crown light tan against a near-black groom). This step measures, under the
SAME camera rig, lights and view transform (groom.py camera_rig, AgX), the mean hair colour of the
strand round and of the card round and scales the atlas RGB by their ratio:

  hair mask per view = pixels whose sRGB value differs from the no-hair base render of the same view
                       by more than MASK_DIFF in any channel (base = render_cards.py --hide-cards);
  mean               = per view, mean of the masked pixels linearised with the sRGB curve (AgX is not
                       sRGB; the ratio is applied iteratively, so the curve only sets step size);
  gain_c             = gain_in_c / geometric mean over the four views of (mean_cards_c / mean_strands_c).
                       Equal view weight: a Lambertian card cannot follow the strands' view dependence
                       (s1 probe, uncalibrated: cards/strands 1.6x front, 3.8x back, because the rim
                       light reaches the card base colour head-on while the HUANG volume returns it
                       mostly in the R lobe away from the back camera); pixel pooling would let the back
                       view's 5x pixel count set the gain and darken the front;
  atlas_out RGB      = sRGB(lin(atlas_in RGB) x gain_c / gain_in_c ... ) i.e. lin(atlas_raw) x gain_c,
                       alpha unchanged. atlas_in is always the uncalibrated atlas_bake.py output.
Per-view residuals (cards / strands per channel) are recorded so a regional colour split is visible.
No colour is picked by hand: the target is the graded strand round's own render.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

VIEWS = ("front", "three_quarter_left", "side", "back")
GAIN_STEP = 0.01         # albedo gain quantum
MASK_DIFF = 12 / 255.0   # sRGB difference from the no-hair base that counts as hair


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def load(p):
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0


def hair_mean(rd, base):
    per, acc, cnt = {}, np.zeros(3), 0
    for v in VIEWS:
        im, b = load(Path(rd) / (v + ".png")), load(Path(base) / (v + ".png"))
        m = (np.abs(im - b).max(2) > MASK_DIFF)
        px = lin(im[m])
        lum = im[m] @ [0.2126, 0.7152, 0.0722]
        per[v] = {"px": int(m.sum()), "meanLin": px.mean(0).tolist(),
                  "lumSrgbP50P95P99": np.percentile(lum, [50, 95, 99]).tolist(),
                  "lumSrgbMean": float((im[m] @ [0.2126, 0.7152, 0.0722]).mean())}
        acc += px.sum(0)
        cnt += len(px)
    return acc / cnt, per


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for k in ("strands", "base", "cards", "atlas-in", "atlas-out", "record"):
        ap.add_argument("--" + k, required=True)
    ap.add_argument("--gain-in", default=None)
    a = ap.parse_args()
    gin = np.ones(3) if not a.gain_in else np.array(json.loads(Path(a.gain_in).read_text())["gain"])
    ms, ps = hair_mean(a.strands, a.base)
    mc, pc = hair_mean(a.cards, a.base)
    ratios = np.array([np.array(pc[v]["meanLin"]) / np.array(ps[v]["meanLin"]) for v in VIEWS])
    # rounded to GAIN_STEP: the calibration renders run on the GPU, whose output differs slightly run to
    # run (gain 4th decimal, cards-r2 s4 rerun); the rounded gain, hence the atlas, is reproducible
    gain = np.round(gin / np.exp(np.log(ratios).mean(0)) / GAIN_STEP) * GAIN_STEP
    im = np.asarray(Image.open(a.atlas_in).convert("RGBA"), dtype=np.float64) / 255.0
    rgb = srgb(lin(im[..., :3]) * gain[None, None])
    out = np.concatenate([rgb, im[..., 3:]], 2)
    Image.fromarray(np.round(out * 255).astype(np.uint8)).save(a.atlas_out, compress_level=9)
    rec = {"tool": "tools/openclinxr/hair-groom-2/cards/calib_colour.py",
           "strandsRound": a.strands, "baseRound": a.base, "cardsRound": a.cards,
           "atlasIn": a.atlas_in, "atlasInSha256": sha(a.atlas_in), "atlasOut": a.atlas_out,
           "atlasOutSha256": sha(a.atlas_out), "gainIn": gin.tolist(), "gain": gain.tolist(),
           "meanLinStrands": ms.tolist(), "meanLinCards": mc.tolist(), "cardsOverStrands": (mc / ms).tolist(),
           "cardsOverStrandsGeoMeanOfViews": np.exp(np.log(ratios).mean(0)).tolist(),
           "perView": {v: {"strands": ps[v], "cards": pc[v],
                           "cardsOverStrands": (np.array(pc[v]["meanLin"]) / np.array(ps[v]["meanLin"])).tolist()}
                       for v in VIEWS},
           "maskDiff": MASK_DIFF}
    Path(a.record).write_text(json.dumps(rec, indent=1))
    print("CALIB_DONE", json.dumps({k: rec[k] for k in ("gain", "cardsOverStrands", "cardsOverStrandsGeoMeanOfViews")}))
    for v in VIEWS:
        print(v, np.round(rec["perView"][v]["cardsOverStrands"], 3), ps[v]["px"], pc[v]["px"])


if __name__ == "__main__":
    main()
