"""Runtime hooks injected into groom9 without changing station code."""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
STORE = Path("/Volumes/files/openclinxr-assets/store/hair-groom10diag")
STORE.mkdir(parents=True, exist_ok=True)

_names: list[str] = []
_maxima: list[np.ndarray] = []
_argmax: list[np.ndarray] = []
_prev: np.ndarray | None = None
_raw_gi: np.ndarray | None = None
_raw_w: np.ndarray | None = None


def _stage_delta(cur: np.ndarray, prev: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-child maximum point displacement and its sample index."""
    n = len(cur)
    mx = np.empty(n, dtype=np.float32)
    at = np.empty(n, dtype=np.uint8)
    chunk = 8192
    for a in range(0, n, chunk):
        sl = slice(a, min(a + chunk, n))
        d = np.linalg.norm(cur[sl] - prev[sl], axis=2) * 1000.0
        at[sl] = np.argmax(d, axis=1).astype(np.uint8)
        mx[sl] = d[np.arange(len(d)), at[sl]].astype(np.float32)
    return mx, at


def capture_raw(children, gi_c, w_c):
    global _prev, _raw_gi, _raw_w
    cur = np.asarray(children, dtype=np.float64)
    _prev = cur.copy()
    _raw_gi = np.asarray(gi_c, dtype=np.int32).copy()
    _raw_w = np.asarray(w_c, dtype=np.float32).copy()
    np.savez_compressed(STORE / "raw-interpolation.npz",
                        points=cur.astype(np.float32))
    print("DIAG_STAGE raw_interpolation saved", flush=True)


def capture_stage(name, children):
    global _prev
    cur = np.asarray(children, dtype=np.float64)
    if _prev is None:
        raise RuntimeError("capture_raw must run first")
    mx, at = _stage_delta(cur, _prev)
    _names.append(str(name))
    _maxima.append(mx)
    _argmax.append(at)
    _prev = cur.copy()
    print("DIAG_STAGE %s moved=%d gt5=%d max=%.3fmm" % (
        name, int((mx > 1e-6).sum()), int((mx > 5.0).sum()),
        float(mx.max())), flush=True)


def finalize_diag(children, gi_c, w_c, pool, parent, cxyz, g_res_p):
    """Write compact all-child maxima plus exact interpolation metadata."""
    if _raw_gi is None or _raw_w is None or _prev is None:
        raise RuntimeError("diagnostic hooks incomplete")
    cur = np.asarray(children, dtype=np.float64)
    if not np.array_equal(cur, _prev):
        capture_stage("unattributed_tail", cur)
    stage_max = np.stack(_maxima, axis=1)
    stage_at = np.stack(_argmax, axis=1)
    final_gi = np.asarray(gi_c, dtype=np.int32)
    final_w = np.asarray(w_c, dtype=np.float32)
    pool = np.asarray(pool, dtype=np.int32)
    # Maximum same-sample distance between any two guides in a blend.
    g = np.asarray(g_res_p, dtype=np.float64)[final_gi]
    sep = np.zeros(len(g), dtype=np.float32)
    root_sep = np.zeros(len(g), dtype=np.float32)
    for i in range(g.shape[1]):
        for j in range(i + 1, g.shape[1]):
            d = np.linalg.norm(g[:, i] - g[:, j], axis=2).max(axis=1)
            active = (final_w[:, i] > 1e-8) & (final_w[:, j] > 1e-8)
            sep[active] = np.maximum(
                sep[active], (d[active] * 1000.0).astype(np.float32))
            rd = np.linalg.norm(g[:, i, 0] - g[:, j, 0], axis=1)
            root_sep[active] = np.maximum(
                root_sep[active], (rd[active] * 1000.0).astype(np.float32))
    np.savez_compressed(
        E / "stage-displacements.npz",
        stage_names=np.asarray(_names),
        max_mm=stage_max,
        argmax_sample=stage_at,
        raw_guide_idx=pool[_raw_gi],
        raw_guide_w=_raw_w,
        final_guide_idx=pool[final_gi],
        final_guide_w=final_w,
        guide_separation_max_mm=sep,
        guide_root_separation_max_mm=root_sep,
        parent=np.asarray(parent, dtype=np.int32),
        roots=np.asarray(cxyz, dtype=np.float32),
    )
    print("DIAG_STAGE wrote %s (%d children x %d stages)" % (
        E / "stage-displacements.npz", len(cur), len(_names)), flush=True)
