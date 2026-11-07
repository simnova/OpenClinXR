"""Blender command-line entry point for the canonical hair scene."""
import argparse
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hair_scene


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--views", default="front")
    parser.add_argument("--params")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--samples", type=int, default=64)
    parser.add_argument("--fingerprint-only", action="store_true")
    parser.add_argument("--geometry-test", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    try:
        handle = hair_scene.build_scene(args.params)
        fp = hair_scene.fingerprint(handle)
        (out / "fingerprint.json").write_text(json.dumps(fp, indent=2) + "\n")
        result = {"ok": True, "fingerprint": fp}
        if args.geometry_test:
            before = hair_scene.get_editable_points(handle)
            hair_scene.set_editable_points(handle, before)
            after = hair_scene.get_editable_points(handle)
            error_mm = float(abs(after - before).max() * 1000.0)
            query = before[:4, :2].reshape(-1, 3)
            distances, normals = hair_scene.surface_distance(handle, query)
            result["geometryTest"] = {
                "shape": list(before.shape),
                "dtype": str(before.dtype),
                "identityRoundtripMaxErrorMm": error_mm,
                "surfaceQueryCount": int(distances.size),
                "surfaceDistancesFinite": bool(__import__("numpy").isfinite(distances).all()),
                "surfaceNormalsFinite": bool(__import__("numpy").isfinite(normals).all()),
                "usesEvaluatedHeadBVHTree": True,
                "vertexOnlyDistanceExposed": False,
            }
            if error_mm >= 0.01:
                raise RuntimeError("editable point identity roundtrip %.9f mm >= 0.01 mm" % error_mm)
        if not args.fingerprint_only:
            views = tuple(item.strip() for item in args.views.split(",") if item.strip())
            rendered = hair_scene.render_views(handle, out, args.size, args.samples, views)
            result["renders"] = rendered
            if "front" in rendered:
                result["metrics"] = hair_scene.measure(
                    rendered["front"]["png"], rendered["front"]["id_png"])
        (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, sort_keys=True))
    except Exception:
        error = traceback.format_exc()
        result = {"ok": False, "error": error}
        (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(error)
        raise


if __name__ == "__main__":
    main()
