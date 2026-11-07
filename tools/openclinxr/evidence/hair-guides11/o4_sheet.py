"""O4: target-vs-guides11 comparison sheet (8 cells, 1024px each)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
TS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
pairs = [("target-front.png", "guides11_front.png", "TS-front", "ours-front"),
         ("target-three_quarter.png", "guides11_three_quarter.png", "TS-3/4", "ours-3/4"),
         ("target-profile.png", "guides11_profileR.png", "TS-profile", "ours-profileR"),
         ("target-back.png", "guides11_back.png", "TS-back", "ours-back")]
cells = []
for tsn, ourn, tsl, ourl in pairs:
    for src, lab in ((TS / tsn, tsl), (E / ourn, ourl)):
        im = Image.open(src).convert("RGB")
        if im.size != (1024, 1024):
            im = im.resize((1024, 1024))
        cells.append((im, lab))
Wd, Hd, lab = 1024, 1024, 36
sheet = Image.new("RGB", (Wd * 8, Hd + lab), (20, 20, 20))
dr = ImageDraw.Draw(sheet)
for k, (im, lb) in enumerate(cells):
    sheet.paste(im, (k * Wd, lab))
    dr.text((k * Wd + 10, 10), lb, fill=(255, 165, 0))
sheet.save(E / "target-vs-guides11.png")
print("WROTE", E / "target-vs-guides11.png")
