#!/usr/bin/env python3
"""Build the current|solved compare video for the teeth-gap solver slice.

Layout (1280x960): top row current|solved full heads, bottom row
current|solved mouth close-ups (the 240x180 capture crop at x=500, y=530
top-origin, scaled up). Labels are PNG overlays (no drawtext). Audio comes
from the current clip (same line in both). Quarter = half each dimension.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[3]
GAP = REPO / "docs/openclinxr/mouth-dynamics/teeth-gap"
CURRENT = REPO / "docs/openclinxr/mouth-dynamics/step3/clip.mp4"
SOLVED = GAP / "solved-capture/clip.mp4"
OUT = GAP / "solved-compare.mp4"
QUARTER = GAP / "solved-compare-quarter.mp4"
WORK = Path("/tmp/solved-compare-labels")


def label(text: str, path: Path) -> None:
    font = ImageFont.load_default(size=34)
    img = Image.new("RGBA", (420, 56), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, 419, 55], fill=(10, 18, 16, 220))
    draw.text((14, 8), text, font=font, fill=(255, 255, 255, 255))
    img.save(path)


def main() -> int:
    for clip in (CURRENT, SOLVED):
        if not clip.exists():
            print(f"missing {clip}", file=sys.stderr)
            return 1
    WORK.mkdir(parents=True, exist_ok=True)
    labels = {
        "cur": ("CURRENT", WORK / "cur.png"),
        "sol": ("SOLVED", WORK / "sol.png"),
        "curm": ("CURRENT mouth", WORK / "curm.png"),
        "solm": ("SOLVED mouth", WORK / "solm.png"),
    }
    for text, path in labels.values():
        label(text, path)
    filt = (
        "[0:v]scale=640:480:flags=lanczos[head0];"
        "[1:v]scale=640:480:flags=lanczos[head1];"
        "[0:v]crop=240:180:500:530,scale=640:480:flags=neighbor[mouth0];"
        "[1:v]crop=240:180:500:530,scale=640:480:flags=neighbor[mouth1];"
        "[head0][head1]hstack=inputs=2[top];"
        "[mouth0][mouth1]hstack=inputs=2[bottom];"
        "[top][bottom]vstack=inputs=2[stack];"
        f"[stack][2:v]overlay=8:8[tmp1];[tmp1][3:v]overlay=648:8[tmp2];"
        f"[tmp2][4:v]overlay=8:488[tmp3];[tmp3][5:v]overlay=648:488,"
        "format=yuv420p[v]"
    )
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-i", str(CURRENT), "-i", str(SOLVED),
        "-i", str(labels["cur"][1]), "-i", str(labels["sol"][1]),
        "-i", str(labels["curm"][1]), "-i", str(labels["solm"][1]),
        "-filter_complex", filt,
        "-map", "[v]", "-map", "0:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-movflags", "+faststart", "-shortest", str(OUT),
    ]
    subprocess.run(cmd, check=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(OUT),
         "-vf", "scale=640:480:flags=lanczos",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
         "-movflags", "+faststart", str(QUARTER)],
        check=True,
    )
    print(f"wrote {OUT} {OUT.stat().st_size} bytes")
    print(f"wrote {QUARTER} {QUARTER.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
