"""Assemble baseline quad sheet from REAL textures (no procedural dots).

Quadrants (2x2, albedo|normal / roughness|cavity):
- albedo: CC0 MakeHuman toigo_light_skin_female_freckles diffuse (resized)
- normal: sibling mpfb-peds-parent-aisha.skin-normal.png (resized)
- roughness: luminance of sibling skin-baked.png remapped to mid range
- cavity: inverted luminance of sibling skin-baked.png remapped to high range

Writes: docs/openclinxr/skin-llm-sheet-rebake-2026-09-28/input-quad-sheet-baseline.png
New probe file only; never touches materialize_mpfb_humanoid_candidate.py.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

REPO = Path(__file__).resolve().parents[4]
OUT_DIR = REPO / "docs" / "openclinxr" / "skin-llm-sheet-rebake-2026-09-28"
ALBEDO_SRC = Path(
    "/Volumes/files/src/openclinxr/.openclinxr-local/provider-cache/skins/"
    "sources/makehuman-skins01/extracted/skins/toigo_light_skin_female_freckles/"
    "young_lightskinned_female_diffuse_freckles.png"
)
NORMAL_SRC = Path(
    "/Users/patrick/.grok/worktrees/src-openclinxr/parent-fitted-teeth/"
    "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.skin-normal.png"
)
BAKED_SRC = Path(
    "/Users/patrick/.grok/worktrees/src-openclinxr/parent-fitted-teeth/"
    "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.skin-baked.png"
)
TILE = 512


def _tile_rgb(src: Path) -> Image.Image:
    img = Image.open(src).convert("RGB").resize((TILE, TILE), Image.LANCZOS)
    return img


def _remap(lum: Image.Image, lo: int, hi: int) -> Image.Image:
    return lum.point(lambda v: lo + (hi - lo) * v // 255).convert("L")


def main() -> None:
    assert ALBEDO_SRC.exists(), f"missing albedo src: {ALBEDO_SRC}"
    assert NORMAL_SRC.exists(), f"missing normal src: {NORMAL_SRC}"
    assert BAKED_SRC.exists(), f"missing baked src: {BAKED_SRC}"
    albedo = _tile_rgb(ALBEDO_SRC)
    normal = _tile_rgb(NORMAL_SRC)
    lum = Image.open(BAKED_SRC).convert("L").resize((TILE, TILE), Image.LANCZOS)
    roughness = Image.merge("RGB", (_remap(lum, 110, 190),) * 3)
    cavity = Image.merge("RGB", (_remap(ImageOps.invert(lum), 150, 255),) * 3)

    sheet = Image.new("RGB", (TILE * 2, TILE * 2), (0, 0, 0))
    sheet.paste(albedo, (0, 0))
    sheet.paste(normal, (TILE, 0))
    sheet.paste(roughness, (0, TILE))
    sheet.paste(cavity, (TILE, TILE))
    draw = ImageDraw.Draw(sheet)
    for i, lab in enumerate(("albedo (CC0 toigo freckles)", "normal (aisha skin-normal)",
                             "roughness (from skin-baked luma)", "cavity (from skin-baked luma inv)")):
        draw.text((10 + (i % 2) * TILE, 10 + (i // 2) * TILE), lab, fill=(255, 255, 255))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "input-quad-sheet-baseline.png"
    sheet.save(out)
    print("wrote", out, sheet.size,
          f"albedo={ALBEDO_SRC.name} normal={NORMAL_SRC.name} baked={BAKED_SRC.name}")


if __name__ == "__main__":
    main()
