#!/usr/bin/env python3
"""Recompute metrics, judge, sheet, RESULT, and DONE for hair-int1."""
from __future__ import annotations

import colorsys
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
LANDMARKS = ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json"
G6 = ROOT / "tools/openclinxr/evidence/hair-geo6"
L4 = ROOT / "tools/openclinxr/evidence/hair-look4"
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
MASKS = JUDGE / "target-set-back"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
VIEWS = ("front", "three_quarter", "profile_90", "back")


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    sys.path.insert(0, str(path.parent))
    spec.loader.exec_module(mod)
    return mod


J = load_module("hair_int1_finalize_judge", JUDGE / "hair_judge.py")


def rgb(path):
    return np.asarray(Image.open(path).convert("RGB"), float) / 255.0


def mask(path):
    return np.asarray(Image.open(path).convert("RGBA"))[..., 3] >= 230


def mask_l(path):
    return np.asarray(Image.open(path).convert("L")) >= 128


TARGET_NAMES = {"front":"target-front.png", "three_quarter":"target-three_quarter.png", "profile_90":"target-profile.png", "back":"target-back.png"}
TARGET_MASK_NAMES = {"front":"mask-front-v2.png", "three_quarter":"mask-three_quarter.png", "profile_90":"mask-profile-v2.png", "back":"mask-back-v3.png"}


def luminance(a):
    return .2126*a[..., 0] + .7152*a[..., 1] + .0722*a[..., 2]


def hue_sat(a, m):
    y = luminance(a)
    bright = m & (y >= np.percentile(y[m], 90))
    hsv = np.asarray([colorsys.rgb_to_hsv(*p) for p in a[bright]])
    weights = np.maximum(hsv[:, 1], .02)
    angle = hsv[:, 0] * 2*math.pi
    h = math.degrees(math.atan2(np.sum(np.sin(angle)*weights), np.sum(np.cos(angle)*weights))) % 360
    return {"hueDeg": float(h), "saturation": float(np.median(hsv[:, 1])), "pixels": int(len(hsv))}


def view_metrics(image_path, mask_path):
    a, m = rgb(image_path), mask(mask_path)
    vals = luminance(a)[m]
    return {"p50": float(np.percentile(vals, 50)), "p90": float(np.percentile(vals, 90)), "highlight": hue_sat(a, m), "maskPx": int(m.sum())}


def target_metrics(view):
    a = rgb(TARGET/TARGET_NAMES[view])
    m = mask_l(MASKS/TARGET_MASK_NAMES[view])
    vals = luminance(a)[m]
    return {"p50": float(np.percentile(vals, 50)), "p90": float(np.percentile(vals, 90)), "highlight": hue_sat(a, m), "maskPx": int(m.sum())}


def front_extra(image_path, mask_path):
    a = rgb(image_path)
    m = mask(mask_path) if "-id" in Path(mask_path).name else mask_l(mask_path)
    y = luminance(a)
    yy, xx = np.nonzero(m)
    y0, y1, x0, x1 = yy.min(), yy.max(), xx.min(), xx.max()
    h, w = y1-y0+1, x1-x0+1
    Y, X = np.indices(m.shape)
    crown = m & (Y <= y0+.35*h) & (X >= x0+.35*w) & (X <= x0+.65*w)
    sides = m & (Y >= y0+.18*h) & (Y <= y0+.68*h) & ((X <= x0+.28*w) | (X >= x0+.72*w))
    cheek = (Y >= .40*m.shape[0]) & (Y <= .52*m.shape[0]) & (X >= .39*m.shape[1]) & (X <= .61*m.shape[1]) & ~m
    return {"partSide": float(y[crown].mean()/max(y[sides].mean(), 1e-12)), "faceP50": float(np.percentile(y[cheek], 50))}


def triple(row, keys):
    return ",".join(str(row[k]) for k in keys)


def judge(tag):
    cell = E / "cells" / tag
    lm = json.load(open(LANDMARKS))["judge"]
    out = cell / "judge"
    out.mkdir(exist_ok=True)
    return J.judge(
        str(cell/"front.png"), str(cell/"front-id.png"), tag,
        triple(lm["front"], ("crown_top_row", "chin_row", "face_centre_col")), str(out),
        target_set="back", id_mask_path=str(cell/"front-id.png"),
        profile_mask_path=str(cell/"profile_90-id.png"),
        profile_landmarks=triple(lm["profile"], ("crown_top_row", "chin_row", "forehead_front_col")),
        back_mask_path=str(cell/"back-id.png"),
        back_landmarks=triple(lm["back"], ("crown_top_row", "shoulder_row", "hair_centre_col")),
        target_front_mask=str(MASKS/"mask-front-v2.png"),
        target_profile_mask=str(MASKS/"mask-profile-v2.png"),
        target_back_mask=str(MASKS/"mask-back-v3.png"), overlay_prefix="overlay-",
    )


def metrics(tag):
    cell = E / "cells" / tag
    views = {v: view_metrics(cell/f"{v}.png", cell/f"{v}-id.png") for v in VIEWS}
    views["front"].update(front_extra(cell/"front.png", cell/"front-id.png"))
    judged = judge(tag)
    targets = {v: target_metrics(v) for v in VIEWS}
    targets["front"].update(front_extra(TARGET/"target-front.png", MASKS/"mask-front-v2.png"))
    doc = {
        "tag": tag, "resolution": 1024, "samples": 64,
        "geometrySource": str(G6/"cells/f1/strands.npz"),
        "materialSource": str(L4/"cells/best/metrics.json"),
        "views": views, "targets": targets,
        "judge": {"front": judged["iou"], "profile": judged["profile_view"]["iou"], "back": judged["back_view"]["iou"]},
    }
    (cell/"metrics.json").write_text(json.dumps(doc, indent=2)+"\n")
    return doc


def make_sheet():
    columns = [
        ("front", "front", None), ("three_quarter", "three_quarter", None),
        ("profile_90", "profile_90", None), ("back", "back", None),
        ("ear crop", "three_quarter", (100,240,484,624)),
        ("back crop", "back", (320,280,704,664)),
        ("part crop", "front", (412,120,612,320)),
    ]
    rows = ("TS", "i0", "i1")
    tile, label = 256, 28
    canvas = Image.new("RGB", (tile*len(columns), (tile+label)*len(rows)), "white")
    draw = ImageDraw.Draw(canvas)
    for ri, row in enumerate(rows):
        for ci, (title, view, crop) in enumerate(columns):
            source = TARGET/TARGET_NAMES[view] if row == "TS" else E/f"cells/{row}/{view}.png"
            im = Image.open(source).convert("RGB")
            if crop:
                im = im.crop(crop)
            im = im.resize((tile,tile), Image.Resampling.LANCZOS)
            x, y = ci*tile, ri*(tile+label)
            canvas.paste(im, (x,y+label))
            draw.text((x+7,y+8), f"{row} | {title}", fill="black")
    canvas.save(E/"look-sheet.png")


def f6(x):
    return f"{x:.6f}"


def main():
    i0, i1 = metrics("i0"), metrics("i1")
    diag = json.load(open(E/"part-diagnosis.json"))
    delta = {k: i1["judge"][k]-i0["judge"][k] for k in i0["judge"]}
    face_move = abs(i1["views"]["front"]["faceP50"]-i0["views"]["front"]["faceP50"])/i0["views"]["front"]["faceP50"]
    gates = {"faceWithin5Percent": face_move <= .05, "absDeltaIouWithin001": all(abs(x) <= .01 for x in delta.values())}
    assert all(gates.values()), (gates, delta, face_move)
    make_sheet()
    lines = [
        "HAIR INT 1 — F1 GEOMETRY + LOOK-4 MATERIAL + PART DIAGNOSIS", "",
        "PARAMS::HUANG melanin=0.887321 redness=0.361525 Reflection=0.401852 SecondaryReflection=1.372479 roughness=0.390002 Random=0.019248; camera-relative rig", "",
    ]
    for tag, doc in (("i0",i0),("i1",i1)):
        lines.append(f"{tag.upper()}::IoU front={f6(doc['judge']['front'])} profile={f6(doc['judge']['profile'])} back={f6(doc['judge']['back'])}; part/side={f6(doc['views']['front']['partSide'])}; face={f6(doc['views']['front']['faceP50'])}")
        for view in VIEWS:
            v=doc["views"][view]; h=v["highlight"]
            t=doc["targets"][view]; th=t["highlight"]
            lines.append(f"{tag}.{view}::p50={f6(v['p50'])} vs TS {f6(t['p50'])}; p90={f6(v['p90'])} vs TS {f6(t['p90'])}; hue={f6(h['hueDeg'])} vs TS {f6(th['hueDeg'])}; sat={f6(h['saturation'])} vs TS {f6(th['saturation'])}")
        lines.append("")
    lines += [
        f"GATES::face move={face_move*100:.3f}% PASS<=5%; dIoU front={delta['front']:+.6f} profile={delta['profile']:+.6f} back={delta['back']:+.6f} PASS |dIoU|<=0.01", "",
        f"PART BAND i0::hairFraction={diag['band']['hairFraction']:.6f} skinFraction={diag['band']['skinFraction']:.6f} hairLum={diag['band']['hair']['meanLuminance']:.6f} hairHue={diag['band']['hair']['meanHueDeg']:.3f} skinLum={diag['band']['skin']['meanLuminance']:.6f} skinHue={diag['band']['skin']['meanHueDeg']:.3f} bandLum={diag['band']['bandLuminance']:.6f} part/side={diag['band']['partSide']:.6f}",
    ]
    for key in ("a","b","c"):
        c=diag["candidates"][key]
        lines.append(f"CANDIDATE {key.upper()} {c['status']}::{c['label']}; hairFraction={c['hairFraction']:.6f} skinFraction={c['skinFraction']:.6f} bandLum={c['bandLuminance']:.6f} part/side={c['partSide']:.6f}")
    lines += [
        f"APPLIED::candidate B only; i1 close-up hairFraction={diag['i1Band']['hairFraction']:.6f} skinFraction={diag['i1Band']['skinFraction']:.6f} bandLum={diag['i1Band']['bandLuminance']:.6f} part/side={diag['i1Band']['partSide']:.6f}", "",
        "SAW::The bright warm/skin-coloured centre part still reads wrong first versus TS. The supported +50% root cover is directionally correct but weak at full scale (part/side 2.180072 -> 2.175571, still above 1.6); the next mismatch is the broad vertically banded copper-brown curtain, especially in the back crop.",
    ]
    (E/"RESULT.txt").write_text("\n".join(lines)+"\n")
    (E/"DONE.txt").write_text("DONE: i0/i1 four-view 1024x64 renders, v6 judge, photometrics, 512 part diagnosis and three one-change probes, comparison sheet, gates, and RESULT are present.\n")
    print(json.dumps({"gates":gates,"deltaIou":delta,"faceMove":face_move,"i0Part":i0["views"]["front"]["partSide"],"i1Part":i1["views"]["front"]["partSide"]},indent=2))


if __name__ == "__main__":
    main()
