"""Re-run the existing acceptance boxes against learner-URL captures; no box fitting."""
import importlib.util
import json
import os
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / os.environ.get("SHIP_WARD_OUT", "docs/openclinxr/room-realism/ship-ward-room")
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
# Crop-verified pose-04 door boxes for the promoted seed-205 geometry.
door_image = cap("04-door-inside")
glass_box = (575, 230, 599, 368)
leaf_box = (530, 440, 690, 650)
casing_boxes = {
    "left": (493, 250, 508, 600),
    "right": (756, 250, 769, 600),
    "head": (520, 113, 740, 128),
}
casing_wall_boxes = {
    "left": (460, 250, 487, 600),
    "right": (775, 250, 800, 600),
    "head": (520, 90, 740, 105),
}
glass_mean, glass_std = c.box_mean(door_image, glass_box)
leaf_mean, leaf_std = c.box_mean(door_image, leaf_box)
grid = []
x0, y0, x1, y1 = leaf_box
for row in range(3):
    for column in range(2):
        box = (x0 + (x1-x0)*column//2, y0 + (y1-y0)*row//3,
               x0 + (x1-x0)*(column+1)//2, y0 + (y1-y0)*(row+1)//3)
        mean, std = c.box_mean(door_image, box)
        grid.append(dict(row=row, column=column, box=box, mean=mean, std=std,
                         passes=all(value >= 2.5 for value in std)))
results["door"] = {
    "glass": dict(box=glass_box, mean=glass_mean, std=glass_std,
                  reference=[169,180,178], tolerance=20,
                  meanPasses=all(abs(a-b) <= 20 for a,b in zip(glass_mean,[169,180,178])),
                  stdFloor=6, stdPasses=all(value >= 6 for value in glass_std)),
    "leaf": dict(box=leaf_box, mean=leaf_mean, std=leaf_std,
                 reference=[190.3,151.5,103.1], tolerance=12,
                 meanPasses=all(abs(a-b) <= 12 for a,b in zip(leaf_mean,[190.3,151.5,103.1])),
                 rb=round(leaf_mean[0]-leaf_mean[2],2), referenceRb=87.2,
                 rbPasses=abs((leaf_mean[0]-leaf_mean[2])-87.2) <= 15,
                 grid=grid, gridPasses=all(cell["passes"] for cell in grid)),
    "casing": {},
}
for key, box in casing_boxes.items():
    mean = c.box_mean(door_image,box)[0]
    wall_box = casing_wall_boxes[key]
    wall_mean = c.box_mean(door_image,wall_box)[0]
    lower = [round(value+4,2) for value in wall_mean]
    results["door"]["casing"][key] = dict(
        box=box, mean=mean, bandWidthPx=(box[2]-box[0] if key != "head" else box[3]-box[1]),
        adjacentWallBox=wall_box, adjacentWallMean=wall_mean,
        targetLower=lower, targetUpper=[215,215,215],
        meanPasses=all(lo <= value <= 215 for lo,value in zip(lower,mean)),
        widthPasses=10 <= (box[2]-box[0] if key != "head" else box[3]-box[1]) <= 16)
baseline_path = ROOT / "docs/openclinxr/room-realism/ship-ward-room/runtime-measurements.json"
baseline_measurements = json.loads(baseline_path.read_text())
no_regression = {}
for key in ("ceiling02", "ceiling03", "floor02", "floor06", "wall", "floorJobTileNoRegression"):
    prior = baseline_measurements[key]["mean"]
    actual = results[key]["mean"]
    delta = [round(a-b, 2) for a,b in zip(actual,prior)]
    no_regression[key] = dict(actual=actual, baseline=prior, delta=delta,
                              tolerance=3, passes=all(abs(value) <= 3 for value in delta))
results["noRegressionAgainstShippedRuntime"] = no_regression
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
