#!/usr/bin/env python3
"""Build a current|treatment compare video for the teeth-gap slices.

Layout (1280x960): top row current|treatment full heads, bottom row
current|treatment mouth close-ups (the 240x180 capture crop at x=500, y=530
top-origin, scaled up). Labels are PNG overlays (no drawtext). Audio comes
from the current clip (same line in both). Quarter = half each dimension.

Defaults build the solver slice video; --treatment/--out/--quarter/labels
build the producer slice video.
"""
import argparse
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--treatment", default=str(SOLVED))
    parser.add_argument("--out", default=str(OUT))
    parser.add_argument("--quarter", default=str(QUARTER))
    parser.add_argument("--treatment-label", default="SOLVED")
    parser.add_argument("--work", default=str(WORK))
    args = parser.parse_args()
    treatment = Path(args.treatment)
    out = Path(args.out)
    quarter = Path(args.quarter)
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    for clip in (CURRENT, treatment):
        if not clip.exists():
            print(f"missing {clip}", file=sys.stderr)
            return 1
    labels = {
        "cur": ("CURRENT", work / "cur.png"),
        "sol": (args.treatment_label, work / "sol.png"),
        "curm": ("CURRENT mouth", work / "curm.png"),
        "solm": (f"{args.treatment_label} mouth", work / "solm.png"),
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
        "-i", str(CURRENT), "-i", str(treatment),
        "-i", str(labels["cur"][1]), "-i", str(labels["sol"][1]),
        "-i", str(labels["curm"][1]), "-i", str(labels["solm"][1]),
        "-filter_complex", filt,
        "-map", "[v]", "-map", "0:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-movflags", "+faststart", "-shortest", str(out),
    ]
    subprocess.run(cmd, check=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(out),
         "-vf", "scale=640:480:flags=lanczos",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
         "-movflags", "+faststart", str(quarter)],
        check=True,
    )
    print(f"wrote {out} {out.stat().st_size} bytes")
    print(f"wrote {quarter} {quarter.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
