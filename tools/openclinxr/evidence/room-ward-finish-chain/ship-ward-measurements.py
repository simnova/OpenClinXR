"""Re-run the existing acceptance boxes against learner-URL captures; no box fitting."""
import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / "docs/openclinxr/room-realism/ship-ward-room"
REF = ROOT / "docs/openclinxr/room-realism/imagine-multiview-v2"

def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

c = module("ceiling-measurements")
f = module("floor-skirting-measurements")
def cap(pose):
    return OUT / "after" / ("runtime-" + pose + ".png")

results = {}
for name, pose, box in [
    ("ceiling02", "02-toward-bed-wall", c.CAP02_TILE_BOX),
    ("ceiling03", "03-ceiling-corner", c.CAP03_TILE_BOX),
    ("floor02", "02-toward-bed-wall", f.P02_FLOOR_BOX),
    ("floor06", "06-floor-base", f.P06_FLOOR_PATCH),
]:
    mean, std = c.box_mean(cap(pose), box)
    ref, _ = c.box_mean(REF / (pose + ".jpg"), box)
    delta = [round(a-b, 2) for a,b in zip(mean,ref)]
    results[name] = dict(box=box, mean=mean, std=std, reference=ref,
                         delta=delta, tolerance=8, passes=all(abs(x)<=8 for x in delta))
wall, _ = c.box_mean(cap("02-toward-bed-wall"), c.WALL_BOX)
delta = [round(a-b,2) for a,b in zip(wall,c.WALL_BASE)]
results["wall"] = dict(box=c.WALL_BOX, mean=wall, reference=c.WALL_BASE,
                       delta=delta, tolerance=3, passes=all(abs(x)<=3 for x in delta))
tile, _ = c.box_mean(cap("03-ceiling-corner"), f.TILE_BOX)
baseline = json.loads((ROOT / "docs/openclinxr/room-realism/light-balance/floor-skirting-measurements.json").read_text())["noRegression"]["tileBox"]["stage1Final"]
delta = [round(a-b,2) for a,b in zip(tile,baseline)]
results["floorJobTileNoRegression"] = dict(box=f.TILE_BOX,mean=tile,reference=baseline,
    delta=delta,tolerance=3,passes=all(abs(x)<=3 for x in delta))
floorstd = f.lowfreq_std(cap("06-floor-base"),f.P06_FLOOR_PATCH)
refstd = f.lowfreq_std(REF / "06-floor-base.jpg",f.P06_FLOOR_PATCH)
results["floorBlotch"] = dict(actual=floorstd,reference=refstd,
    passes=all(a<=b+3 for a,b in zip(floorstd,refstd)))
results["diffuser"] = c.diffuser_stats(cap("05-troffer-junction"),c.CAP05_DIFFUSER_BOX,c.CAP05_DIFFUSER_EDGE_BOX)
results["skirting"] = f.edge_peaks(cap("06-floor-base"),f.P06_SKIRT_XRANGE,f.P06_TOP_WINDOW)
results["notEvidenceFor"] = ["Quest headset readiness", "clinical validity"]
(OUT / "runtime-measurements.json").write_text(json.dumps(results,indent=2)+"\n")
print(json.dumps(results,indent=2))

# Deterministic contact sheets of captured pixels, never generated imagery.
for after in sorted((OUT / "after").glob("runtime-*.png")):
    name = after.stem.removeprefix("runtime-")
    before = OUT / "before" / after.name
    for label, paths in [("before-after",[before,after]),
                         ("before-after-reference",[before,after,REF/(name+".jpg")])]:
        sheet = Image.new("RGB",(1280*len(paths),750),"white")
        draw = ImageDraw.Draw(sheet)
        for i,p in enumerate(paths):
            sheet.paste(Image.open(p).convert("RGB"),(1280*i,30))
            draw.text((1280*i+12,8),["before","after","v2 reference"][i],fill="black")
        sheet.save(OUT / (name+"-"+label+".jpg"),quality=90)
