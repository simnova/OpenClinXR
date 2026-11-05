"""Rebind a Blender mesh-surface-baked skin normal into a shipped actor GLB.

Sibling of bind_skin_normal.py for the case that sibling refuses BY DESIGN:
a Cycles NORMAL bake through bake_skin_normal_to_texture
(materialize_mpfb_humanoid_candidate.py). That binder requires a procedural
receipt (meshSurfaceBake=false, no-Blender runtime), only retires orphaned
images, and enforces pore-bar floors a fine-stipple bake cannot meet. This
stage takes the truthful Blender receipt instead and replaces the CURRENTLY
BOUND normal image bytes, preserving geometry, skinning, morphs, animations,
and all other images/materials.

Guards (explicit raise, -O safe): required files exist; no-clobber outputs;
src sha; new PNG magic + sha; stdlib PNG decodability (metrics RECORDED, no
bar refusal — G2 lives in the slice gate, not here); bake report targets this
exact src (bakeInputGlbFullSha + inputGlbFullSha), outputPngSha match, recipe
match, meshSurfaceBake=true with a Blender runtime string; exactly one skin
material match carrying exactly one normalTexture; skin primitives carry
matching TEXCOORD_0/POSITION; single self-contained buffer; exactly one
embedded image matches the old anchor.

Provenance: appends stage skin-normal-baked-rebind (prior receipt preserved),
updates outputSha256/outputBytes. No other fields touched.
"""
import argparse
import copy
import hashlib
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normal_metrics import decode_png, stats


def sha(b):
    return hashlib.sha256(b).hexdigest()


def refuse(msg):
    raise SystemExit("REFUSE: " + msg)


def img_bytes(binary, views, idx):
    v = views[idx]
    s = v.get("byteOffset", 0)
    return bytes(binary[s:s + v["byteLength"]])


def parse_glb(path):
    d = open(path, "rb").read()
    jl, = struct.unpack("<I", d[12:16])
    j = json.loads(d[20:20 + jl])
    off = 20 + jl
    cl, = struct.unpack("<I", d[off:off + 4])
    return j, d[off + 8:off + 8 + cl]


def mesh_by_base(j, base):
    ms = [m for m in j["meshes"] if (m.get("name") or "") == base
          or (m.get("name") or "").startswith(base + ".")]
    if len(ms) != 1:
        refuse("body mesh identity ambiguous in src")
    return ms[0]


def main():
    ap = argparse.ArgumentParser()
    for k in ["src", "new_normal", "out", "expect_src_sha", "expect_png_sha",
              "skin_sub", "old_anchor", "prov_in", "prov_out", "recipe",
              "bake_report"]:
        ap.add_argument("--" + k.replace("_", "-"), required=True)
    ap.add_argument("--code-sha", required=False, default=None)
    a = ap.parse_args()

    actual_code_sha = sha(open(os.path.abspath(__file__), "rb").read())
    if a.code_sha is not None and a.code_sha != actual_code_sha:
        refuse("code-sha mismatch")
    for p in [a.src, a.new_normal, a.old_anchor, a.prov_in, a.bake_report]:
        if not os.path.isfile(p):
            refuse("missing input: " + p)
    if os.path.realpath(a.out) == os.path.realpath(a.prov_out):
        refuse("out and prov-out must be distinct")
    ins = {os.path.realpath(p) for p in
           [a.src, a.new_normal, a.old_anchor, a.prov_in, a.bake_report]}
    if os.path.realpath(a.out) in ins or os.path.realpath(a.prov_out) in ins:
        refuse("outputs must be distinct from inputs")
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
        refuse("new normal PNG undecodable/unsupported")
    st = stats(dec)
    if st["sd"] == 0.0:
        refuse("new normal map carries no detail (flat substitution refused)")

    rep = json.load(open(a.bake_report))
    if rep.get("bakeInputGlbFullSha") != sha(src):
        refuse("bake report bake-input is not this src file")
    if rep.get("inputGlbFullSha") != sha(src):
        refuse("bake report does not target this src file")
    if rep.get("outputPngSha") != sha(png):
        refuse("bake report outputPngSha != new normal bytes")
    if rep.get("recipe") != a.recipe:
        refuse("bake report recipe != requested recipe")
    if rep.get("meshSurfaceBake") is not True:
        refuse("baked binder requires meshSurfaceBake=true")
    if not rep.get("blenderRuntime"):
        refuse("bake report missing blenderRuntime")
    for k in ["generator", "bakeCode", "dermal", "macro", "vsha", "bodyMesh"]:
        if rep.get(k) is None:
            refuse("bake report missing truthful receipt field: " + k)
    base = rep.get("bodyMeshBase") or rep.get("bodyMesh")
    if not base:
        refuse("bake report missing bodyMeshBase")

    sj, _ = parse_glb(a.src)
    try:
        sm = mesh_by_base(sj, base)
    except SystemExit:
        m = re.match(r"^(.*)\.\d{3}$", base)
        if not m:
            raise
        base = m.group(1)
        sm = mesh_by_base(sj, base)
    src_mesh_name = sm.get("name")
    src_verts = 0
    for p in sm.get("primitives", []):
        ats = p.get("attributes") or {}
        if "POSITION" in ats:
            src_verts += sj["accessors"][ats["POSITION"]].get("count", 0)

    jl, = struct.unpack("<I", src[12:16])
    j = json.loads(src[20:20 + jl])
    off = 20 + jl
    cl, = struct.unpack("<I", src[off:off + 4])
    binary = src[off + 8:off + 8 + cl]
    if not isinstance(j.get("buffers"), list) or len(j.get("buffers")) != 1:
        refuse("source must declare exactly one buffer")
    if j["buffers"][0].get("uri") is not None:
        refuse("source buffer must be self-contained GLB (no uri)")

    anchor = open(a.old_anchor, "rb").read()
    oldsha = sha(anchor)
    cands = [i for i, im in enumerate(j["images"])
             if sha(img_bytes(binary, j["bufferViews"], im["bufferView"])) == oldsha]
    if len(cands) != 1:
        refuse("old-map identity ambiguous: %s" % cands)
    ti = cands[0]

    skin = [i for i, m in enumerate(j["materials"]) if a.skin_sub in m.get("name", "")]
    if len(skin) != 1:
        refuse("skin material ambiguous: %s" % skin)
    si = skin[0]
    nt = j["materials"][si].get("normalTexture")
    if nt is None:
        refuse("skin has no normalTexture to rebind")
    if j["textures"][nt["index"]]["source"] != ti:
        refuse("skin normalTexture does not source the anchored image")

    n_skin_prims = 0
    for m in j["meshes"]:
        for p in m.get("primitives", []):
            if p.get("material") != si:
                continue
            n_skin_prims += 1
            ats = p.get("attributes") or {}
            if "TEXCOORD_0" not in ats or "POSITION" not in ats:
                refuse("skin primitive missing TEXCOORD_0/POSITION")
            auv = j["accessors"][ats["TEXCOORD_0"]]
            apos = j["accessors"][ats["POSITION"]]
            if auv.get("count") != apos.get("count"):
                refuse("skin UV/POSITION count mismatch")
    if n_skin_prims == 0:
        refuse("no skin primitives found")

    views = j["bufferViews"]
    blobs = []
    for vi, v in enumerate(views):
        s = v.get("byteOffset", 0)
        blobs.append(png if vi == j["images"][ti]["bufferView"]
                     else binary[s:s + v["byteLength"]])
    newbin = bytearray()
    for vi, v in enumerate(views):
        while len(newbin) % 4:
            newbin += b"\x00"
        v["byteOffset"] = len(newbin)
        v["byteLength"] = len(blobs[vi])
        newbin += blobs[vi]
    while len(newbin) % 4:
        newbin += b"\x00"
    if "buffers" not in j or not isinstance(j.get("buffers"), list) or len(j["buffers"]) != 1:
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

    rep_out = {"outSha": newsha[:16], "outBytes": len(glb), "imageIdx": ti,
               "textureIdx": nt["index"], "skinMat": si, "skinPrims": n_skin_prims,
               "srcBodyMesh": src_mesh_name, "srcBodyVerts": src_verts,
               "sdR": round(st["sd"], 3), "flat": round(st["flat"], 4),
               "incoh": round(st["incoh"], 4),
               "bars": [bool(x) for x in st["bars"]]}

    bake_rep_sha = sha(open(a.bake_report, "rb").read())
    nm_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "normal_metrics.py")
    nm_sha = sha(open(nm_path, "rb").read())
    prov = json.load(open(a.prov_in))
    prior_sha = prov.get("outputSha256")
    prior_bytes = prov.get("outputBytes")
    prov.setdefault("stages", []).append(
        {"stage": "skin-normal-baked-rebind", "recipe": a.recipe,
         "inputGlbSha": a.expect_src_sha, "bakeInputGlb": rep.get("bakeInputGlb"),
         "bakeInputGlbSha": rep.get("bakeInputGlbFullSha"),
         "bakeReportSha": bake_rep_sha, "bakeReportSha256": bake_rep_sha,
         "bakeRecipe": rep.get("recipe"), "bakeDermal": rep.get("dermal"),
         "bakeMacro": rep.get("macro"), "bakeStatureMeters": rep.get("statureMeters"),
         "bodyMesh": src_mesh_name, "reportedBodyMesh": base,
         "bodyVsha": rep.get("vsha"),
         "oldNormalSha": oldsha, "newNormalSha": a.expect_png_sha,
         "priorOutputSha256": prior_sha, "priorOutputBytes": prior_bytes,
         "outputGlbSha": newsha, "outputGlbBytes": len(glb),
         "rebindCodeSha": actual_code_sha, "normalMetricsCodeSha": nm_sha,
         "blenderRuntime": rep.get("blenderRuntime"),
         "meshSurfaceBake": True,
         "generator": rep.get("generator"), "bakeCode": rep.get("bakeCode"),
         "derivation": ("mesh-surface re-bake rebind: Cycles TANGENT normal bake "
                        "of the actor body through bake_skin_normal_to_texture; "
                        "only the skin normal image bytes change, geometry and "
                        "all other bytes preserved")})
    prov["outputSha256"] = newsha
    prov["outputBytes"] = len(glb)
    open(a.out, "wb").write(glb)
    json.dump(prov, open(a.prov_out, "w"), indent=1)
    print("BAKED_REBIND " + json.dumps(rep_out))


if __name__ == "__main__":
    main()
