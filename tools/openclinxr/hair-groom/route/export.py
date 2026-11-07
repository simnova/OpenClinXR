"""hair-route0 STEP 4: export E/guides.npz + Blender figure + RESULT/DONE.

guides.npz carries the accepted guide curves resampled to 41 arc-uniform
points in head-mm (render_guides.py convention) plus routing provenance.
The Blender figure reuses S4/guides/render_guides.py untouched
(Workbench thin tubes on Aisha, topper excluded).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

import common as C

S7 = Path(__file__).resolve().parent
E = C.E
ROOT = C.ROOT


def resample_arc(pts, m=41):
    pts = np.asarray(pts, dtype=np.float64)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    total = seg.sum()
    if total <= 0:
        return np.repeat(pts[:1], m, axis=0)
    cum = np.concatenate([[0.0], np.cumsum(seg)]) / total
    t = np.linspace(0.0, 1.0, m)
    out = np.zeros((m, 3))
    j = 0
    for k in range(m):
        while j < len(seg) - 1 and cum[j + 1] < t[k]:
            j += 1
        f = 0.0 if cum[j + 1] == cum[j] else (
            (t[k] - cum[j]) / (cum[j + 1] - cum[j]))
        out[k] = pts[j] * (1 - f) + pts[j + 1] * f
    return out


def main():
    E.mkdir(parents=True, exist_ok=True)
    C.track(S7 / "export.py")
    P = np.load(str(E / "paths.npz"))
    spec_sha = str(P["spec_sha"][0])
    assert spec_sha == (E / "spec-sha-before-route.txt").read_text().strip()
    import hashlib
    h = hashlib.sha256((E / "route-spec.json").read_bytes()).hexdigest()
    assert h == spec_sha, "spec sha drift!"
    n = len(P["roots_mm"])
    status = [str(s) for s in P["status"]]
    assert all(s == "smooth" for s in status), status
    crown = np.asarray(P["crown"], dtype=np.float64)
    ch = np.zeros((n, 41, 3))
    for i in range(n):
        c = np.array(P["curves_mm"][i])
        c = c[np.isfinite(c).all(axis=1)]
        ch[i] = C.world_to_head(resample_arc(c / 1000.0, 41), crown)
    gates = json.loads((E / "gates.json").read_text())
    np.savez_compressed(
        str(E / "guides.npz"), curves_head=ch, crown=crown,
        param_names=np.array(["tube_r"]),
        param_values=np.array([3.0]),
        spec_sha=np.array([spec_sha]),
        roots_file=np.array(["hair-scalp1/roots.npz Poisson-12mm n=359"]),
        y_ear_mm=np.array([float(P["y_ear_mm"])]),
        verdict=np.array([gates.get("verdict", "MODEL_INADEQUATE")]))
    print("WROTE guides.npz bytes=%d" % (
        (E / "guides.npz").stat().st_size), flush=True)

    blender = ("/Applications/Blender.app/Contents/MacOS/Blender")
    C.track(ROOT / "tools/openclinxr/hair-groom/guides/render_guides.py")
    C.track(ROOT / "apps/ui-xr/public/generated-humanoids/"
                   "mpfb-peds-parent-aisha.glb")
    C.track(ROOT / "tools/openclinxr/hair-groom/manifests/"
                   "cameras-scorer-v3.json")
    r = subprocess.run(
        [blender, "--background", "--python",
         str(ROOT / "tools/openclinxr/hair-groom/guides/render_guides.py"),
         "--", "--guides-npz", str(E / "guides.npz"), "--outdir", str(E),
         "--glb", str(ROOT / "apps/ui-xr/public/generated-humanoids/"
                            "mpfb-peds-parent-aisha.glb"),
         "--cameras", str(ROOT / "tools/openclinxr/hair-groom/manifests/"
                                "cameras-scorer-v3.json"),
         "--opened", str(E / "blender-opened.txt"), "--stem", "guides"],
        capture_output=True, text=True, timeout=1200)
    print(r.stdout[-2000:], flush=True)
    print(r.stderr[-1000:], flush=True)
    if r.returncode != 0:
        raise RuntimeError("blender render failed rc=%d" % r.returncode)
    assert (E / "guides.png").exists()
    C.write_inputs_log([S7 / "export.py", E / "guides.npz"])


if __name__ == "__main__":
    main()
