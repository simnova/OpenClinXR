"""Approach A (procedural-plus): push iris-centred-c.png annulus further toward
macro-iris photorealism. Frozen zones copied byte-exact: pupil disc r<=38,
limbus/sclera r>=99.5 (per eye). Only 38<r<99.5 is modified."""
import math, hashlib
import numpy as np
from PIL import Image

SRC = "tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png"
DST = "tools/openclinxr/asset-pipeline/eyes/iris-centred-e.png"
CENTRES = [(296, 724), (722, 302)]
R_IN, R_OUT = 38.0, 99.5

def hash01(*parts):
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64

# per-eye deterministic feature params (same seed family, different per eye)
def eye_params(ei):
    n_crypt = 12
    crypt_angles = sorted(hash01("crypt", ei, k) * 360.0 for k in range(n_crypt))
    crypt_width = [2.2 + hash01("cryptw", ei, k) * 3.0 for k in range(n_crypt)]  # deg sigma
    crypt_depth = [0.35 + hash01("cryptd", ei, k) * 0.30 for k in range(n_crypt)]  # max mult dip
    n_fibre = 180
    fibre_gain = [0.78 + hash01("fib", ei, k) * 0.50 for k in range(n_fibre)]
    fibre_hue = [15.0 + hash01("fibhue", ei, k) * 10.0 for k in range(n_fibre)]  # 15-25 deg
    collar_phase = hash01("collar", ei) * 360.0
    return crypt_angles, crypt_width, crypt_depth, fibre_gain, fibre_hue, collar_phase

base = np.array(Image.open(SRC).convert("RGB")).astype(np.float64)
out = base.copy()

for ei, (cx, cy) in enumerate(CENTRES):
    ca, cw, cd, fg, fh, cph = eye_params(ei)
    y0, y1 = max(0, cy - 100), min(1024, cy + 101)
    x0, x1 = max(0, cx - 100), min(1024, cx + 101)
    for y in range(y0, y1):
        for x in range(x0, x1):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy)
            if not (R_IN < r < R_OUT):
                continue
            th = math.degrees(math.atan2(dy, dx)) % 360.0
            rn = (r - R_IN) / (R_OUT - R_IN)  # 0 pupil side .. 1 limbus side

            # 1) fibre striations: 180 fibres, per-fibre gain
            fi = int(th / 360.0 * 180) % 180
            stri = fg[fi]
            # fine sub-striation
            stri *= 1.0 + 0.06 * math.sin(math.radians(th * 36.0) + r * 0.35)

            # 2) crypts: dark radial wedges, strongest mid-band
            band = math.exp(-((rn - 0.45) ** 2) / (2 * 0.22 ** 2))
            dip = 0.0
            for a, w, d in zip(ca, cw, cd):
                dth = abs((th - a + 180.0) % 360.0 - 180.0)
                dip += d * math.exp(-(dth ** 2) / (2 * w ** 2))
            crypt_mult = max(0.30, 1.0 - dip * band)

            # 3) collarette relief: ridge near rn~0.25 (r~53) with zigzag
            zig = 0.25 + 0.10 * math.sin(math.radians(th * 9.0 + cph))
            ridge = math.exp(-((rn - zig) ** 2) / (2 * 0.045 ** 2))
            collar_mult = 1.0 + 0.55 * ridge

            # 4) radial tone: brighter mid, limbal dark ring w/ soft inner edge
            tone = 1.0 + 0.25 * math.exp(-((rn - 0.55) ** 2) / (2 * 0.25 ** 2))
            # soft inner edge ramp from rn=0.80 -> 0.985, down to 0.45
            t = min(1.0, max(0.0, (rn - 0.78) / (0.97 - 0.78)))
            smooth = t * t * (3 - 2 * t)
            tone *= 1.0 - 0.45 * smooth

            mult = stri * crypt_mult * collar_mult * tone

            # edge fades: modulation must converge to identity at both frozen
            # boundaries (pupil r<=38, limbus r>=99.5) to avoid seams
            e0 = min(1.0, max(0.0, rn / 0.12))
            e1 = min(1.0, max(0.0, (1.0 - rn) / 0.12))
            edge = (e0 * e0 * (3 - 2 * e0)) * (e1 * e1 * (3 - 2 * e1))
            mult = 1.0 + (mult - 1.0) * edge

            # 5) per-fibre hue jitter in 15-25 deg espresso band
            hue_t = fh[fi]  # degrees
            # espresso: R dominant; map hue target to G/R ratio tweak
            # base pixel scaled by mult, then shift G channel slightly by fibre hue
            px = base[y, x] * mult
            # hue jitter as small G/B adjustment around neutral espresso
            # hue 15 -> less G, hue 25 -> more G (approx linear in this dark band)
            g_adj = 1.0 + (hue_t - 20.0) / 20.0 * 0.18 * edge
            b_adj = 1.0 - (hue_t - 20.0) / 20.0 * 0.10 * edge
            px[1] *= g_adj
            px[2] *= b_adj
            # hard ceiling: no baked catchlight (keep well under 150)
            px = np.minimum(px, 140.0)
            out[y, x] = np.clip(px, 0, 255)

Image.fromarray(out.astype(np.uint8)).save(DST)
print("wrote", DST)
