"""OWN rebind of an already-BOUND skin normal map (ph21-normal-region).

Replaces ONLY the bound normal-image bytes in place: same image/texture/
material graph, same JSON topology, bufferViews rebuilt with correct offsets.
Appends a provenance stage (history preserved), updates outputSha256/Bytes.
Refuses unless: src sha matches, new PNG sha matches, old-sidecar sha equals
the currently-bound image bytes, bake report targets this src, new map passes
whole-map bars (sd/flat/incoh), outputs do not exist. No numpy. No Blender.
"""
import argparse
import copy
import hashlib
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normal_metrics import decode_png, stats


def sha(b):
    return hashlib.sha256(b).hexdigest()


def refuse(msg):
    raise SystemExit("REFUSE: " + msg)


def main():
    ap = argparse.ArgumentParser()
    for k in ["src", "new-normal", "out", "expect-src-sha", "expect-png-sha",
              "expect-old-sha", "skin-sub", "prov-in", "prov-out", "recipe",
              "bake-report"]:
        ap.add_argument("--" + k.replace("_", "-"), required=True)
    ap.add_argument("--code-sha", required=False, default=None)
    a = ap.parse_args()

    actual_code_sha = sha(open(os.path.abspath(__file__), "rb").read())
    if a.code_sha is not None and a.code_sha != actual_code_sha:
        refuse("code-sha mismatch")
    for p in (a.src, a.new_normal, a.prov_in, a.bake_report):
        if not os.path.isfile(p):
            refuse("missing input: " + p)
    if os.path.exists(a.out):
        refuse("no-clobber: out exists")
    if os.path.exists(a.prov_out):
        refuse("no-clobber: prov-out exists")

    src = open(a.src, "rb").read()
    if sha(src) != a.expect_src_sha:
        refuse("wrong-actor input: src sha mismatch")
    png = open(a.new_normal, "rb").read()
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        refuse("new normal must be PNG")
    if sha(png) != a.expect_png_sha:
        refuse("mismatched map hash")

    dec = decode_png(png)
    if dec is None:
        refuse("new normal PNG undecodable")
    st = stats(dec)
    if not all(st["bars"]):
        refuse("normal bars fail sd=%.2f flat=%.4f incoh=%.4f" % (st["sd"], st["flat"], st["incoh"]))

    rep = json.load(open(a.bake_report))
    if rep.get("bakeInputGlbFullSha") != sha(src):
        refuse("bake report bake-input is not this src file")
    if rep.get("outputPngSha") != sha(png):
        refuse("bake report outputPngSha != new normal bytes")
    if rep.get("recipe") != a.recipe:
        refuse("bake report recipe != requested recipe")
    if rep.get("regionBalance") is None or not rep["regionBalance"].get("enabled"):
        refuse("rebind requires regionBalance.enabled receipt")
    if rep.get("meshSurfaceBake") is not False:
        refuse("procedural binder requires meshSurfaceBake=false")

    jl, = struct.unpack("<I", src[12:16])
    j = json.loads(src[20:20 + jl])
    off = 20 + jl
    cl, = struct.unpack("<I", src[off:off + 4])
    binary = src[off + 8:off + 8 + cl]
    views = j["bufferViews"]
    old_spans = [(v.get("byteOffset", 0), v.get("byteLength", 0)) for v in views]

    def img_bytes(idx):
        v = views[idx]
        s = v.get("byteOffset", 0)
        return bytes(binary[s:s + v["byteLength"]])

    skin = [i for i, m in enumerate(j["materials"]) if a.skin_sub in (m.get("name") or "")]
    if len(skin) != 1:
        refuse("skin material ambiguous: %s" % skin)
    si = skin[0]
    nt = j["materials"][si].get("normalTexture")
    if not nt:
        refuse("skin has no normalTexture (use append mode instead)")
    img_idx = j["textures"][nt["index"]]["source"]
    cur = img_bytes(j["images"][img_idx]["bufferView"])
    if sha(cur) != a.expect_old_sha:
        refuse("bound image sha != expect-old-sha")
    ti = img_idx

    blobs = []
    for vi, v in enumerate(views):
        s = v.get("byteOffset", 0)
        blobs.append(png if vi == j["images"][ti]["bufferView"] else binary[s:s + v["byteLength"]])
    newbin = bytearray()
    for vi, v in enumerate(views):
        while len(newbin) % 4:
            newbin += b"\x00"
        v["byteOffset"] = len(newbin)
        v["byteLength"] = len(blobs[vi])
        newbin += blobs[vi]
    while len(newbin) % 4:
        newbin += b"\x00"
    if "buffers" not in j or not isinstance(j["buffers"], list) or len(j["buffers"]) != 1:
        j["buffers"] = [{"byteLength": len(newbin)}]
    else:
        if j["buffers"][0].get("uri") is not None:
            refuse("output buffer must remain self-contained (no uri)")
        j["buffers"][0]["byteLength"] = len(newbin)
    doc = json.dumps(j, separators=(",", ":")).encode()
    while len(doc) % 4:
        doc += b" "
    glb = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(doc) + 8 + len(newbin))
           + struct.pack("<II", len(doc), 0x4E4F534A) + doc
           + struct.pack("<II", len(newbin), 0x004E4942) + bytes(newbin))
    newsha = sha(glb)

    pp = rep.get("pore") or {}
    bake_rep_sha = sha(open(a.bake_report, "rb").read())
    nm_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "normal_metrics.py")
    nm_sha = sha(open(nm_path, "rb").read())
    prov = json.load(open(a.prov_in))
    prior_sha = prov.get("outputSha256")
    prior_bytes = prov.get("outputBytes")
    prov.setdefault("stages", []).append(
        {"stage": "skin-normal-region-rebind",
         "recipe": a.recipe,
         "inputGlbSha": a.expect_src_sha,
         "bakeInputGlb": rep.get("bakeInputGlb"),
         "bakeInputGlbSha": rep.get("bakeInputGlbFullSha"),
         "bakeReportSha": bake_rep_sha, "bakeReportSha256": bake_rep_sha,
         "bakeRecipe": rep.get("recipe"), "bakePore": pp,
         "regionBalance": rep.get("regionBalance"),
         "bodyMesh": rep.get("bodyMesh"), "bodyVsha": rep.get("vsha"),
         "flow": "rebind-bound-image-in-place",
         "oldNormalSha": a.expect_old_sha, "newNormalSha": a.expect_png_sha,
         "priorOutputSha256": prior_sha, "priorOutputBytes": prior_bytes,
         "outputGlbSha": newsha, "outputGlbBytes": len(glb),
         "normalBars": {"sdR": round(st["sd"], 3), "flat": round(st["flat"], 4),
                        "incoh": round(st["incoh"], 4),
                        "bars": [bool(x) for x in st["bars"]]},
         "codeSha": actual_code_sha,
         "normalMetricsCodeSha": nm_sha,
         "runtime": rep.get("runtime"),
         "derivationMode": rep.get("derivationMode"),
         "generator": rep.get("generator"),
         "renderRecipe": rep.get("renderRecipe"),
         "meshSurfaceBake": False,
         "measuredSkinPores": False,
         "photorealClaim": False,
         "bindingScope": rep.get("bindingScope"),
         "derivation": "procedural stylized region-balanced coherent-detail rebind: bound normal-image bytes only; JSON topology, geometry, rig, albedo, animations untouched"})
    prov["outputSha256"] = newsha
    prov["outputBytes"] = len(glb)
    open(a.out, "wb").write(glb)
    json.dump(prov, open(a.prov_out, "w"), indent=1)
    print("REBIND " + json.dumps({"outSha": newsha[:16], "outBytes": len(glb),
                                   "sdR": round(st["sd"], 3), "bars": [bool(x) for x in st["bars"]]}))


if __name__ == "__main__":
    main()
