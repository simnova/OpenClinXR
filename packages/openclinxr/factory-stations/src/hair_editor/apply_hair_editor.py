"""Hair Editor apply branch. --check validates without bpy; missing pack exits 2."""
import json
import os
import sys

RANGES = {
    "length": (0.0, 10.0),
    "density": (0.0, 1.0),
    "thickness": (0.0, 0.003),
    "frizz": (0.0, 1.0),
    "roll": (0.0, 1.0),
    "roll_radius": (0.001, 0.005),
    "roll_length": (0.001, 0.1),
    "clump": (0.0, 1.0),
    "clump_distance": (0.003, 0.05),
    "clump_shape": (-1.0, 1.0),
    "clump_tip_spread": (0.0, 0.02),
    "noise": (0.0, 1.0),
    "noise_distance": (0.0, 0.01),
    "noise_scale": (0.0, 20.0),
    "noise_shape": (0.0, 1.0),
    "curl": (0.0, 1.0),
    "curl_guide_distance": (0.0, 0.1),
    "curl_radius": (0.0, 0.1),
    "curl_frequency": (0.0, 20.0),
    "color_noise_scale": (0.0, 500.0),
    "darken_root": (0.0, 1.0),
    "root_color_length": (0.0, 1.0),
}

ALLOWED_OPERATORS = (
    "mpfb.setup_hair_operator",
    "mpfb.apply_hair_operator",
    "mpfb.apply_fur_operator",
    "mpfb.apply_material_operator",
    "mpfb.delete_hair_operator",
)

SCALP_PREFIX = "DHAI_"
FUR_PREFIX = "DFAI_"


def clamp_plan_params(plan):
    params = dict(plan.get("params", {}))
    for key, value in list(params.items()):
        if key in ("color1", "color2"):
            if not isinstance(value, list) or len(value) != 4:
                raise ValueError("%s must be RGBA length 4" % key)
            clamped = [min(1.0, max(0.0, float(c))) for c in value]
            clamped[3] = 1.0
            params[key] = clamped
            continue
        if key not in RANGES:
            raise ValueError("unknown slider %s" % key)
        lo, hi = RANGES[key]
        params[key] = min(hi, max(lo, float(value)))
    out = dict(plan)
    out["params"] = params
    return out


def prefix_for(family, asset):
    prefix = FUR_PREFIX if family == "fur" else SCALP_PREFIX
    return "%s%s_%s" % (prefix, asset, "prop")


def main(argv):
    if "--check" in argv:
        idx = argv.index("--check")
        raw = argv[idx + 1] if idx + 1 < len(argv) else "{}"
        try:
            plan = json.loads(raw)
        except json.JSONDecodeError as exc:
            print("invalid JSON: %s" % exc)
            return 1
        try:
            clamped = clamp_plan_params(plan)
        except ValueError as exc:
            print("invalid: %s" % exc)
            return 1
        print(json.dumps(clamped))
        return 0
    blend = os.environ.get("OPENCLINXR_HAIR_EDITOR_BLEND", "")
    if not blend or not os.path.exists(blend):
        print("install Hair editor pack")
        return 2
    import bpy  # noqa: F401

    plan_file = None
    if "--plan" in argv and argv.index("--plan") + 1 < len(argv):
        plan_file = argv[argv.index("--plan") + 1]
    _ = (ALLOWED_OPERATORS, plan_file, blend, prefix_for)
    print("hair editor apply branch guarded: no live MPFB human in this environment")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
