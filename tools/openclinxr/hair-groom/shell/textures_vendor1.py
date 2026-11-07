"""S8 shell1 STEP 3a (pure python, seeded): shell strand textures.

Same generator as S8/textures_vendor.py (vendored from cards0 commit
bc02ca945: SIZE 2048, CELL 1024, 2600 strands/cell, 25 clumps, same
taper/clump/tilt/gradient code, rng(7+cell)) with ONE stated divergence:
the per-cell u-border fade (3% smoothstep to zero at the cell u edges)
is OFF. That fade is a cards-only construct (per-card atlas quadrants);
shell1 samples the FULL map with the flow UV, so the fade drew two
translucent fault lines across the shell (u=0/1 at the back midline,
u=0.5 at the front). Strand coverage/taper/tip-fade are unchanged, so
strand ends and gaps still read; only the cell-edge fault lines go.

Second stated divergence: all four cells are BIT-IDENTICAL (same seed,
same wav_amp), i.e. one periodic cell tiled 2x2. Reason: the shell flow
UV wraps in u at the back midline (u 0/1 cut); with differing cell
content the wrap interpolates/samples across unrelated strands (torn
fragments along the meridian) and the stacked-cell boundary at v=0.5
draws a strand/aniso step across the curtain. Splatting wraps in x
(modulo CELL, stated below), so the single cell is periodic and the map
tiles seamlessly in both axes. Cost: strand variety = one cell; the
tiling period is 0.5 UV (~30 cm on the shell, sub-visual at 1024 px).

Reads: nothing (self-seeded). Writes: E1/textures/*.png.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

S8 = Path(__file__).resolve().parent
sys.path.insert(0, str(S8))
from common import log_open  # noqa: E402
from textures_vendor import (  # noqa: E402
    CELL,
    N_CLUMP,
    N_STRAND,
    SEED,
    SIZE,
    smoothstep,
)

ROOT = S8.parents[3]
E = ROOT / "tools/openclinxr/evidence/hair-shell1" / "textures"


def render_cell_periodic(rng: np.random.Generator, wav_amp: float):
    """Same strand model as textures_vendor.render_cell, except column
    splatting wraps modulo CELL (stated): the cell tiles seamlessly in
    x. (Upstream clips at 0/CELL-1, which breaks periodicity.)"""
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
        cols = np.mod(np.round(x)[:, None].astype(np.int64)
                      + off[None, :], CELL)
        rows = np.repeat(ys[:, None], len(off), axis=1)
        dd = np.abs(cols - x[:, None])
        dd = np.minimum(dd, CELL - dd)  # periodic distance across the wrap
        d = dd / np.maximum(w[:, None], 1e-6)
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
        rng = np.random.default_rng(SEED)  # identical cells (stated)
        cov, val, tilt, wsum = render_cell_periodic(rng, wav_amp=3.0)
        # NO cell u-border fade (stated shell1 divergence; see docstring).
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
    print("TEXTURES1_DONE cells=4 strands=%d size=%d (no cell-edge fade)" % (
        4 * N_STRAND, SIZE), flush=True)


if __name__ == "__main__":
    main()
