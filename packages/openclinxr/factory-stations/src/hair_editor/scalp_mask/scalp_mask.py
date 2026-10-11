"""Scalp mask stage: remove roots below hairline and in part band."""
import argparse, json, sys

SIZE = 1024

def part_line_u(part_side, part_offset):
    if part_side == "center":
        return 0.5
    if part_side == "left":
        return 0.5 - part_offset
    if part_side == "right":
        return 0.5 + part_offset
    return None

def run(inp):
    try:
        import numpy as np
    except ImportError:
        print("error: numpy required", file=sys.stderr)
        sys.exit(2)
    hr = inp.get("hairlineRatio")
    if not isinstance(hr, (int, float)) or not (0.5 <= hr <= 0.8):
        print("error: hairlineRatio must be in [0.5, 0.8]", file=sys.stderr)
        sys.exit(1)
    part_side = inp.get("partSide", "center")
    if part_side not in ("center", "left", "right", "none"):
        print("error: invalid partSide", file=sys.stderr)
        sys.exit(1)
    part_offset = float(inp.get("partOffsetFraction", 0.0))
    part_width = float(inp.get("partWidthMm", 2))
    uv_width = float(inp.get("uvWidthMm", 160))
    roots = inp.get("roots", [])
    r = np.asarray(roots, dtype=float)
    n = len(roots)
    u = r[:, 0] if n else np.zeros(0)
    v = r[:, 1] if n else np.zeros(0)
    below = v > hr
    in_part = np.zeros(n, dtype=bool)
    pl = part_line_u(part_side, part_offset)
    if pl is not None:
        half_u = (part_width / 2.0) / uv_width
        in_part = (np.abs(u - pl) <= half_u) & (v < hr)
    keep_mask = ~(below | in_part)
    keep = [int(i) for i in np.flatnonzero(keep_mask)]
    # measured gap over crown arc v<0.5 between nearest kept roots either side
    gap_mm = part_width
    if pl is not None:
        crown = (v < 0.5) & keep_mask
        left = u[crown] < pl
        right = u[crown] >= pl
        if np.any(left) and np.any(right):
            gap_mm = float((np.min(u[crown][right]) - np.max(u[crown][left])) * uv_width)
        else:
            gap_mm = float(part_width)
    else:
        gap_mm = 0.0
    out = {
        "keepIndices": keep,
        "removedBelowHairline": int(np.sum(below)),
        "removedInPart": int(np.sum(in_part & ~below)),
        "partGapMm": gap_mm,
        "hairlineV": float(hr),
        "maskSize": SIZE,
    }
    return out, keep_mask, float(hr), pl, (part_width / 2.0) / uv_width if pl is not None else 0.0

def write_mask(path, keep_mask_unused, hr, pl, half_u):
    from PIL import Image
    import numpy as np
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    v = yy / (SIZE - 1)
    u = xx / (SIZE - 1)
    m = np.full((SIZE, SIZE), 255, dtype=np.uint8)
    m[v > hr] = 0
    if pl is not None:
        m[(np.abs(u - pl) <= half_u) & (v < hr)] = 0
    Image.fromarray(m, mode="L").save(path)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--out-mask", default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    with open(a.input) as f:
        inp = json.load(f)
    out, keep_mask, hr, pl, half_u = run(inp)
    if a.out_mask:
        write_mask(a.out_mask, keep_mask, hr, pl, half_u)
    print(json.dumps(out))

if __name__ == "__main__":
    main()
