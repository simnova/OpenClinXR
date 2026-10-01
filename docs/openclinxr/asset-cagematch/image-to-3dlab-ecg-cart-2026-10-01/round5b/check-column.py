"""Measure column cross sections against Round-3 geometry, without a visual grade."""
import json
from pathlib import Path
import numpy as np
import trimesh
from scipy.spatial import ConvexHull

root = Path(__file__).resolve().parent
case = root.parent
assets = {
    'round3': case/'round3/raw/trellis2/ecg-cart.glb',
    'r5best': case/'round5/arms/r5-best/ecg-cart.glb',
    'r5b': root/'budget/ecg-cart.glb',
}
records = {}
for key, path in assets.items():
    scene = trimesh.load(path, force='scene')
    mesh = trimesh.util.concatenate(tuple(scene.geometry.values()))
    samples = []
    for height in (-0.25, -0.20, -0.15):
        segments = trimesh.intersections.mesh_plane(mesh, [0, 1, 0], [0, height, 0])
        points = segments.reshape(-1, 3)[:, [0, 2]]
        hull = ConvexHull(points)
        extent = np.ptp(points, axis=0)
        samples.append(dict(y=height, xzExtent=extent.tolist(),
                            xzAspectRatio=float(max(extent)/min(extent)),
                            hullArea=float(hull.volume),
                            hullToBoundingRectangleArea=float(hull.volume/np.prod(extent))))
    records[key] = samples
payload = dict(method='Y-up mesh plane intersections, convex hull in XZ; dimension comparison only, not exact-square certification',
               samples=records)
(root/'column-sections.json').write_text(json.dumps(payload, indent=2)+'\n')
print(json.dumps(payload))
