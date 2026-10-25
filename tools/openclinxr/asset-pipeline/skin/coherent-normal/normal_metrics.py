"""Stdlib PNG decode + EXACT original normal-test metrics (no numpy/PIL).

Accepts 8-bit RGB/RGBA only, non-interlaced, standard compression/filter
methods; any other colour type (grey/grey-alpha/palette) or nonzero
compression/filter/interlace method is refused (None). Ports decodePng/stats
from tools/openclinxr/evidence/the-skin-normal-map-carries-surface-detail.test.ts:
8-bit RGB/RGBA, filters 0-4, inflate via zlib. stats: every 4th texel, skip
pure-black gutter, flat = |R-128|<=2 and |G-128|<=2 and B>=251, sd(R)
population, adjMAD = row-wise |dR| mean, incoh = adjMAD/sd. Bars: sd>=8,
flat<=0.4, incoh<=0.6. Undecodable/unsupported/empty -> None (caller REFUSEs).
"""
import struct
import zlib

FLAT_TOL = 2
MAX_FLAT = 0.40
MIN_SD = 8.0
MAX_INCOH = 0.6


def decode_png(b):
    if not isinstance(b, (bytes, bytearray)) or len(b) < 8:
        return None
    if bytes(b[:8]) != b"\x89PNG\r\n\x1a\n":
        return None
    w = h = 0
    depth = 0
    colour = -1
    comp = filt = inter = -1
    idat = bytearray()
    off = 8
    n = len(b)
    try:
        while off + 8 <= n:
            ln = struct.unpack(">I", bytes(b[off:off + 4]))[0]
            typ = bytes(b[off + 4:off + 8])
            body = bytes(b[off + 8:off + 8 + ln])
            if len(body) != ln:
                return None
            if typ == b"IHDR":
                if ln < 13:
                    return None
                w = struct.unpack(">I", body[0:4])[0]
                h = struct.unpack(">I", body[4:8])[0]
                depth = body[8]
                colour = body[9]
                comp = body[10]
                filt = body[11]
                inter = body[12]
            elif typ == b"IDAT":
                idat += body
            elif typ == b"IEND":
                break
            off += 12 + ln
    except Exception:
        return None
    if depth != 8 or w == 0 or h == 0:
        return None
    if comp != 0 or filt != 0 or inter != 0:
        return None
    if colour == 2:
        ch = 3
    elif colour == 6:
        ch = 4
    else:
        return None
    try:
        raw = zlib.decompress(bytes(idat))
    except Exception:
        return None
    stride = w * ch
    if len(raw) < (stride + 1) * h:
        return None
    out = bytearray(stride * h)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        if f > 4:
            return None
        base = y * stride
        for x in range(stride):
            rb = raw[p + x]
            a = out[base + x - ch] if x >= ch else 0
            bb = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 0:
                v = rb
            elif f == 1:
                v = rb + a
            elif f == 2:
                v = rb + bb
            elif f == 3:
                v = rb + ((a + bb) >> 1)
            else:
                pa = abs(bb - c)
                pb = abs(a - c)
                pc = abs(a + bb - 2 * c)
                if pa <= pb and pa <= pc:
                    v = rb + a
                elif pb <= pc:
                    v = rb + bb
                else:
                    v = rb + c
            out[base + x] = v & 0xFF
        p += stride
        prev = out[base:base + stride]
    return {"w": w, "h": h, "chans": ch, "data": bytes(out)}


def stats(dec):
    w, h, ch, d = dec["w"], dec["h"], dec["chans"], dec["data"]
    rs = []
    adj = []
    flat = 0
    for y in range(0, h, 4):
        prev = None
        for x in range(0, w, 4):
            i = (y * w + x) * ch
            r = d[i]
            g = d[i + 1] if ch > 1 else r
            bl = d[i + 2] if ch > 2 else r
            if r == 0 and g == 0 and bl == 0:
                prev = None
                continue
            rs.append(r)
            if abs(r - 128) <= FLAT_TOL and abs(g - 128) <= FLAT_TOL and bl >= 253 - FLAT_TOL:
                flat += 1
            if prev is not None:
                adj.append(abs(r - prev))
            prev = r
    if not rs:
        return {"sd": 0.0, "flat": 1.0, "incoh": 1.0, "bars": [False, False, False]}
    m = sum(rs) / len(rs)
    sd = (sum((v - m) ** 2 for v in rs) / len(rs)) ** 0.5
    mad = sum(adj) / len(adj) if adj else 0.0
    incoh = mad / sd if sd > 0 else 1.0
    fl = flat / len(rs)
    return {"sd": sd, "flat": fl, "incoh": incoh,
            "bars": [sd >= MIN_SD, fl <= MAX_FLAT, incoh <= MAX_INCOH]}
