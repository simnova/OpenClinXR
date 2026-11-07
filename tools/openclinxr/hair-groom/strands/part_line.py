"""hair-part1: seeded jittered part line x = part_x + j(y) (world metres).

j(y) is a sum of three seeded sinusoids along the part (front-back y),
rescaled so max |j| over the part span equals amp_mm, and faded to 0
behind the crown (y < y_lo - fade) so the back/nape split is unchanged.
amp_mm <= 0 returns None: callers keep the legacy straight plane.
"""
from __future__ import annotations

import numpy as np

Y_LO_M = -0.060      # interp_children PART_Y_LO_M
Y_HI_M = 0.0342      # interp_children Y_VERTEX_M
FADE_M = 0.010
WAVE_MM = (11.0, 32.0)


def record(amp_mm, seed):
    """JSON-able description; the case record holds exactly this."""
    rng = np.random.default_rng(int(seed))
    waves = rng.uniform(WAVE_MM[0], WAVE_MM[1], 3) / 1000.0
    phases = rng.uniform(0.0, 2.0 * np.pi, 3)
    weights = rng.uniform(0.5, 1.0, 3)
    ys = np.linspace(Y_LO_M, Y_HI_M, 2001)
    raw = sum(w * np.sin(2.0 * np.pi * ys / L + ph)
              for w, L, ph in zip(weights, waves, phases))
    scale = (float(amp_mm) / 1000.0) / float(np.abs(raw).max())
    return {"ampMm": float(amp_mm), "seed": int(seed),
            "wavelengthsMm": [round(float(v) * 1000.0, 4) for v in waves],
            "phasesRad": [round(float(v), 6) for v in phases],
            "weights": [round(float(v), 6) for v in weights],
            "scale": scale, "yLoM": Y_LO_M, "yHiM": Y_HI_M,
            "fadeM": FADE_M}


def make(amp_mm, seed):
    if float(amp_mm) <= 0.0:
        return None, None
    rec = record(amp_mm, seed)
    waves = np.array(rec["wavelengthsMm"]) / 1000.0
    phases = np.array(rec["phasesRad"])
    weights = np.array(rec["weights"])
    scale = rec["scale"]

    def j(y):
        y = np.asarray(y, dtype=np.float64)
        raw = sum(w * np.sin(2.0 * np.pi * y / L + ph)
                  for w, L, ph in zip(weights, waves, phases))
        f = np.clip((y - (Y_LO_M - FADE_M)) / FADE_M, 0.0, 1.0)
        f = f * f * (3.0 - 2.0 * f)
        return scale * raw * f

    return j, rec
