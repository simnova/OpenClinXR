"""Full-frame RGB absolute differences, with no registration, crop or mask."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

root = Path(sys.argv[1])
rows = []
for before in sorted((root / "main").glob("*.png")):
    after = root / "candidate" / before.name
    with Image.open(before) as a, Image.open(after) as b:
        if a.size != b.size:
            raise ValueError(f"size mismatch: {before.name}")
        diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
        mean = sum(ImageStat.Stat(diff).mean) / 3
        maximum = max(high for low, high in diff.getextrema())
        rows.append({"pose": before.stem, "width": a.width, "height": a.height,
                     "meanAbsDiff255": mean, "maxAbsDiff255": maximum,
                     "meanAbsDiffNormalized": mean / 255,
                     "maxAbsDiffNormalized": maximum / 255,
                     "passed": mean <= 0.5})
if len(rows) != 6:
    raise ValueError(f"expected six poses, got {len(rows)}")
print(json.dumps({"metric": "all pixels, all RGB channels; no crop/mask/registration",
                  "thresholdMean255": 0.5, "poses": rows,
                  "passed": all(row["passed"] for row in rows)}, indent=2))
