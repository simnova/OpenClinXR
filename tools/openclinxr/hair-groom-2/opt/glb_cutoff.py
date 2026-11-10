"""glb_cutoff.py: rewrite alphaCutoff of one material in a GLB's JSON chunk (queue/06 probe). No other byte changes
except the JSON chunk's space padding.

Usage: python3 glb_cutoff.py <in.glb> <out.glb> <cutoff> [--material hair_cards]
"""
import json
import struct
import sys


def main(a):
    src, dst, cut = a[1], a[2], float(a[3])
    name = a[a.index("--material") + 1] if "--material" in a else "hair_cards"
    b = open(src, "rb").read()
    magic, ver, _ = struct.unpack_from("<III", b, 0)
    assert magic == 0x46546C67, "not a GLB"
    jlen, jtype = struct.unpack_from("<II", b, 12)
    assert jtype == 0x4E4F534A
    js = json.loads(b[20:20 + jlen])
    mats = [m for m in js["materials"] if m.get("name") == name]
    assert len(mats) == 1, "material %s: %d matches" % (name, len(mats))
    old = mats[0].get("alphaCutoff", 0.5)
    mats[0]["alphaCutoff"] = cut
    nj = json.dumps(js, separators=(",", ":")).encode()
    nj += b" " * (-len(nj) % 4)
    rest = b[20 + jlen:]
    out = struct.pack("<III", magic, ver, 12 + 8 + len(nj) + len(rest)) + struct.pack("<II", len(nj), jtype) + nj + rest
    open(dst, "wb").write(out)
    print("material %s alphaCutoff %s -> %s; %s" % (name, old, cut, dst))


if __name__ == "__main__":
    main(sys.argv)
