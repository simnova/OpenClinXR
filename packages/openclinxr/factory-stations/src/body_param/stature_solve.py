from __future__ import annotations

import sys
from pathlib import Path

from paths import TOOLS_OPENCLINXR, pathlib_path as pathlib_path


def _mpfb_probe_stature(macro: dict, tmp_dir) -> float:
    """Measure MPFB's own stature for a macro dict — REUSE of the #328 probe.

    One copy of the bake-measure-interpolate machinery lives in
    materialize_mpfb_humanoid_candidate.py (create_human → bake_targets →
    bake_modifiers_remove_helpers → GLB export → pure-python stature read). This
    module imports it lazily so the two rails share a solver instead of growing a
    second one (the issue's refused treatment is a closed-form map, and "do not
    re-implement" the solve). The lazy import is safe: that module imports this one
    only inside functions, so there is no cycle.
    """
    _ensure_probe_machinery_path()
    from materialize_mpfb_humanoid_candidate import _bake_and_export_probe  # noqa: E402

    out = pathlib_path(tmp_dir) / "probe.glb"
    try:
        return _bake_and_export_probe(macro, str(out))["statureMeters"]
    finally:
        out.unlink(missing_ok=True)


def _ensure_probe_machinery_path() -> None:
    """Put #328's probe module on sys.path (it lives under evidence/blender, not here).

    The solve is reused, not re-implemented: the bake-measure-interpolate machinery
    (create_human → bake → strip → GLB export → pure-python stature read) stays in
    materialize_mpfb_humanoid_candidate.py and is imported lazily from here.
    """
    probe_dir = TOOLS_OPENCLINXR / "evidence" / "blender"
    probe_dir_str = str(probe_dir)
    if probe_dir_str not in sys.path:
        sys.path.insert(0, probe_dir_str)


def measure_height_reachable_band(macro_base: dict, tmp_dir) -> tuple[float, float]:
    """PER-ACTOR reachable stature band, measured on the MPFB model.

    Probes the model at height macro 0 and 1 with the actor's OTHER macros fixed —
    the counterweight clause (3) of the planted contract: a band cannot be produced
    by echoing a float or evaluating a formula, only by measuring the model twice
    for that actor. Returns (floor_m, ceiling_m) with ceiling > floor.
    """
    _ensure_probe_machinery_path()
    from materialize_mpfb_humanoid_candidate import _bake_and_export_probe  # noqa: E402

    tmp = pathlib_path(tmp_dir)
    tmp.mkdir(parents=True, exist_ok=True)

    def probe(height_macro: float) -> float:
        macro = dict(macro_base)
        macro["height"] = round(float(height_macro), 4)
        out = tmp / f"band_h{macro['height']:.4f}.glb"
        try:
            return _bake_and_export_probe(macro, str(out))["statureMeters"]
        finally:
            out.unlink(missing_ok=True)

    s0 = probe(0.0)
    s1 = probe(1.0)
    floor_m, ceiling_m = (s0, s1) if s0 <= s1 else (s1, s0)
    if not (ceiling_m > floor_m):
        raise RuntimeError(
            f"#329: degenerate height-macro band [{floor_m:.4f}, {ceiling_m:.4f}] m — "
            "the MPFB model does not respond to the height macro for this actor"
        )
    return (floor_m, ceiling_m)


def solve_height_macro_from_stature(
    macro_base: dict,
    target_stature_m: float,
    tmp_dir,
    *,
    tol_m: float = 0.01,
) -> dict:
    """#329 — solve the height macro so the model's own body reaches the target.

    Delegates to #328's `solve_height_macro` (bake-measure-interpolate against the
    exported body — the ALL-PASS treatment (d) in the planted header), then measures
    the solved body once more to record the resulting stature. Refuses loudly when
    the target is outside the measured reachable band rather than shipping a short
    body. MADR 0051 §5 tolerance (±1 cm of the authored height) is the caller's —
    the solve's internal tol is 1 cm and the final probe is reported for the row.
    """
    _ensure_probe_machinery_path()
    from materialize_mpfb_humanoid_candidate import solve_height_macro  # noqa: E402

    tmp = pathlib_path(tmp_dir)
    tmp.mkdir(parents=True, exist_ok=True)
    # Band first, OUTSIDE the try: a degenerate band is its own refusal and must not
    # be re-wrapped (the band variable would not exist in the except block).
    band = measure_height_reachable_band(macro_base, tmp)
    try:
        h_solved = solve_height_macro(
            dict(macro_base), float(target_stature_m), tmp, tol=tol_m
        )
    except RuntimeError as exc:
        raise RuntimeError(
            f"#329: authored height {target_stature_m * 100:.1f} cm is outside this "
            f"actor's measured reachable band [{band[0] * 100:.1f}, "
            f"{band[1] * 100:.1f}] cm on MPFB's own body — refusing to ship a body "
            f"that does not honour the case. Measured band recorded; do NOT widen "
            f"the band to make the row pass. ({exc})"
        ) from exc
    solved_macro = dict(macro_base)
    solved_macro["height"] = round(float(h_solved), 4)
    measured = _mpfb_probe_stature(solved_macro, tmp)
    return {
        "heightMacro": round(float(h_solved), 4),
        "measuredStatureM": measured,
        "reachableBandCm": [round(band[0] * 100.0, 2), round(band[1] * 100.0, 2)],
        "bandMeasured": True,
    }
