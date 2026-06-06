#!/usr/bin/env python3
"""Create a local-only head-detail albedo candidate for Anny model vetting.

This is an authoring cagematch helper, not a production texture generator. It
uses the observed Anny patient UV island to add head-first detail to a copied
texture before isolated Model Vetting Studio review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


NOT_EVIDENCE_FOR = [
    "stablegen_texture_success",
    "b_plus_visual_realism_gate",
    "scene_placement_readiness",
    "quest_readiness",
    "production_asset_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
]


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    image = Image.open(args.base_texture).convert("RGBA").resize((args.size, args.size), Image.Resampling.LANCZOS)
    detail = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(detail, "RGBA")
    width, height = image.size

    def uv_box(u0: float, v0: float, u1: float, v1: float) -> tuple[int, int, int, int]:
        return (round(u0 * width), round(v0 * height), round(u1 * width), round(v1 * height))

    # Observed peds patient skin UV island: head u .352-.647, v .0-.22; face u .413-.587, v .025-.219.
    head = uv_box(0.352, 0.0, 0.648, 0.222)
    face = uv_box(0.413, 0.025, 0.587, 0.220)
    upper_face = uv_box(0.413, 0.025, 0.587, 0.142)
    mouth = uv_box(0.442, 0.123, 0.558, 0.219)

    # Hair/scalp breakup: not a groom, just reduces the bald mannequin read in the upper UV head cap.
    scalp = (head[0] + 8, head[1] + 4, head[2] - 8, head[1] + 92)
    draw.ellipse(scalp, fill=(78, 48, 30, 74))
    hairline = (head[0] + 22, head[1] + 42, head[2] - 22, head[1] + 124)
    draw.arc(hairline, start=188, end=352, fill=(44, 27, 18, 112), width=6)
    for _ in range(120):
        x = random.randint(head[0] + 4, head[2] - 4)
        y = random.randint(head[1] + 4, head[1] + 108)
        shade = random.randint(30, 64)
        alpha = random.randint(10, 28)
        draw.line((x, y, x + random.randint(-6, 6), y + random.randint(2, 12)), fill=(shade, max(18, shade - 9), 14, alpha), width=1)

    # Eye sockets, brows, and mouth separation in the face island.
    ux0, uy0, ux1, uy1 = upper_face
    eye_y = round(uy0 + (uy1 - uy0) * 0.62)
    left_eye = (round(ux0 + (ux1 - ux0) * 0.18), eye_y - 8, round(ux0 + (ux1 - ux0) * 0.42), eye_y + 8)
    right_eye = (round(ux0 + (ux1 - ux0) * 0.58), eye_y - 8, round(ux0 + (ux1 - ux0) * 0.82), eye_y + 8)
    for eye in (left_eye, right_eye):
        draw.ellipse((eye[0] - 8, eye[1] - 5, eye[2] + 8, eye[3] + 6), fill=(82, 50, 38, 34))
        draw.ellipse(eye, fill=(238, 229, 214, 88))
        cx = (eye[0] + eye[2]) // 2
        cy = (eye[1] + eye[3]) // 2
        draw.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=(70, 46, 30, 160))
        draw.ellipse((cx + 1, cy - 2, cx + 2, cy - 1), fill=(255, 255, 238, 128))
        draw.line((eye[0] - 2, eye[1] - 10, eye[2] + 2, eye[1] - 8), fill=(45, 26, 16, 108), width=2)

    mx0, my0, mx1, my1 = mouth
    lip_y = round(my0 + (my1 - my0) * 0.42)
    draw.ellipse((mx0 + 16, lip_y - 8, mx1 - 16, lip_y + 7), fill=(130, 66, 58, 42))
    draw.line((mx0 + 22, lip_y, mx1 - 22, lip_y), fill=(82, 38, 36, 112), width=2)
    draw.line((mx0 + 30, lip_y + 7, mx1 - 30, lip_y + 8), fill=(194, 118, 94, 28), width=1)

    # Skin mottling limited to face/head.
    for _ in range(90):
        x = random.randint(face[0], face[2])
        y = random.randint(face[1], face[3])
        radius = random.randint(1, 2)
        if random.random() < 0.6:
            color = (165, 92, 72, random.randint(4, 10))
        else:
            color = (235, 188, 150, random.randint(4, 9))
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)

    detail = detail.filter(ImageFilter.GaussianBlur(radius=1.2))
    result = Image.alpha_composite(image, detail)
    result.save(output_path)

    report = {
        "schemaVersion": "openclinxr.head-detail-texture-cagematch.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "claimScope": "local_procedural_head_detail_texture_candidate_not_realism_or_production",
        "baseTexturePath": args.base_texture,
        "outputTexturePath": str(output_path),
        "uvAssumption": {
            "headUvBox": [0.352, 0.0, 0.648, 0.222],
            "faceUvBox": [0.413, 0.025, 0.587, 0.220],
            "source": "observed_peds_patient_anny_uv_distribution",
        },
        "features": ["scalp_hairline_breakup", "brow_eye_socket_iris_catchlight", "lip_separation", "face_skin_variation"],
        "sha256": sha256(output_path),
        "providerBoundary": {
            "localOnly": True,
            "externalNetworkUsed": False,
            "paidApiUsed": False,
            "credentialsUsed": False,
            "runtimePromotionAllowed": False,
            "productionAssetReadinessClaimed": False,
        },
        "notEvidenceFor": NOT_EVIDENCE_FOR,
    }
    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


def parse_args() -> argparse.Namespace:
    argv = [item for item in sys.argv[1:] if item != "--"]
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-texture", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report")
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--seed", type=int, default=6060606)
    return parser.parse_args(argv)


def sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    main()
