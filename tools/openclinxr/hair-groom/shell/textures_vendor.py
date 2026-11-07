"""S8 STEP 3a (pure python, seeded): procedural strand textures.

Provenance: tools/openclinxr/hair-groom/cards/textures.py does not exist
in this worktree (no cards/ directory; cards/ is read-only per the
brief), so it cannot be imported. The generator below is vendored from
commit bc02ca945 (hair-cards0) with IDENTICAL seeds, sizes, and strand
parameters (SIZE 2048, CELL 1024, N_STRAND 2600/cell, N_CLUMP 25,
widths 1.5-2.6 px, clump pull 0.55 v^2, taper v>=0.90, tip fade
0.92-1.0, u-border fade 3%, wav_amp 3.0+cell, rng(7+cell), flow
R=128+tilt*800, gradient 0.5+0.5*ss(0,0.4,v)). The strand-atlas,
flow-map, and root-tip-gradient outputs are therefore the same maps by
construction; byte-parity with cards0 cannot be checked in this
worktree (its evidence lives on another lane). The per-card id-strip is
NOT generated (a shell has no cards; roughness is a fixed 0.40).

Reads: nothing (self-seeded). Writes: E/textures/*.png.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

S8 = Path(__file__).resolve().parent
sys.path.insert(0, str(S8))
from common import log_open  # noqa: E402

ROOT = S8.parents[3]
E = ROOT / "tools/openclinxr/evidence/hair-shell0" / "textures"

SIZE = 2048
CELL = 1024
N_STRAND = 2600
N_CLUMP = 25
SEED = 7


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def render_cell(rng: np.random.Generator, wav_amp: float):
    cov = np.zeros((CELL, CELL), dtype=np.float32)
    val = np.zeros((CELL, CELL), dtype=np.float32)
    tilt = np.zeros((CELL, CELL), dtype=np.float32)
    wsum = np.zeros((CELL, CELL), dtype=np.float32)
    ys = np.arange(CELL)
    v = ys / (CELL - 1)
    taper = 1.0 - smoothstep(0.90, 1.0, v)
    tip_fade = 1.0 - smoothstep(0.92, 1.0, v)
    pull = v * v
    centres = rng.uniform(40, CELL - 40, size=N_CLUMP)
    assign = rng.integers(0, N_CLUMP, size=N_STRAND)
    x0 = rng.uniform(0, CELL, size=N_STRAND)
    bright = rng.uniform(0.82, 1.0, size=N_STRAND)
    phase = rng.uniform(0, 2 * np.pi, size=N_STRAND)
    width = rng.uniform(1.5, 2.6, size=N_STRAND)
    for s in range(N_STRAND):
        cx = centres[assign[s]] + wav_amp * np.sin(2 * np.pi * ys / CELL + phase[s])
        x = x0[s] + (cx - x0[s]) * pull * 0.55
        dx = np.gradient(x)
        w = np.maximum(width[s] * 0.5, 0.4) * taper + 0.15
        half = int(np.ceil(float(w.max()) + 1.0))
        off = np.arange(-half, half + 1)
        cols = np.clip(np.round(x)[:, None] + off[None, :],
                       0, CELL - 1).astype(np.int64)
        rows = np.repeat(ys[:, None], len(off), axis=1)
        d = np.abs(cols - x[:, None]) / np.maximum(w[:, None], 1e-6)
        m = np.clip(1.0 - d, 0.0, 1.0) * tip_fade[:, None]
        np.maximum.at(cov, (rows, cols), m)
        np.maximum.at(val, (rows, cols), m * bright[s])
        np.add.at(tilt, (rows, cols), m * dx[:, None])
        np.add.at(wsum, (rows, cols), m)
    return cov, val, tilt, wsum


def main():
    E.mkdir(parents=True, exist_ok=True)
    log_open(Path(__file__))
    atlas_rgb = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    atlas_a = np.zeros((SIZE, SIZE), dtype=np.uint8)
    flow = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    flow[:, :] = (128, 255, 128)
    for cell in range(4):
        rng = np.random.default_rng(SEED + cell)
        cov, val, tilt, wsum = render_cell(rng, wav_amp=3.0 + 1.0 * cell)
        uh = np.arange(CELL) / (CELL - 1)
        edge = (smoothstep(0.0, 0.03, uh) * (1.0 - smoothstep(0.97, 1.0, uh)))
        cov = cov * edge[None, :]
        val = val * edge[None, :]
        oy, ox = (cell // 2) * CELL, (cell % 2) * CELL
        sl = (slice(oy, oy + CELL), slice(ox, ox + CELL))
        a = np.clip(cov * 255.0, 0, 255).astype(np.uint8)
        vv = np.clip(val * 255.0, 0, 255).astype(np.uint8)
        atlas_a[sl] = a
        atlas_rgb[sl] = np.stack([vv, vv, vv], -1)
        t = np.zeros_like(tilt)
        m = wsum > 1e-9
        t[m] = tilt[m] / wsum[m]
        r = np.clip(128.0 + t * 800.0, 0, 255).astype(np.uint8)
        has = cov > 0.02
        cell_flow = np.stack([r, np.full_like(r, 255),
                              np.full_like(r, 128)], -1)
        fsl = flow[sl]
        fsl[has] = cell_flow[has]
        flow[sl] = fsl
    Image.fromarray(atlas_rgb).save(E / "strand-atlas-rgb.png")
    Image.fromarray(atlas_a).save(E / "strand-atlas-alpha.png")
    rgba = np.dstack([atlas_rgb, atlas_a])
    Image.fromarray(rgba).save(E / "strand-atlas.png")
    Image.fromarray(flow).save(E / "flow-map.png")
    v = np.arange(1024) / 1023
    g = 0.5 + 0.5 * smoothstep(0.0, 0.4, v)
    grad = np.tile((np.clip(g, 0, 1) * 255).astype(np.uint8)[None, :], (16, 1))
    Image.fromarray(grad.T).save(E / "root-tip-gradient.png")
    for p in ("strand-atlas.png", "strand-atlas-rgb.png",
              "strand-atlas-alpha.png", "flow-map.png",
              "root-tip-gradient.png"):
        log_open(E / p)
    print("TEXTURES_DONE cells=4 strands=%d size=%d (vendored cards0 seeds)" % (
        4 * N_STRAND, SIZE), flush=True)


if __name__ == "__main__":
    main()
