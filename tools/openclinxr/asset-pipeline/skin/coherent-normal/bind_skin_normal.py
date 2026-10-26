"""OWN bind: replace orphaned bad skin-normal bytes, bind normalTexture scale 1.

Fixes: stdlib-only exact original 4-step/nonblack/rowR bars validated BEFORE
ANY write (explicit raise, -O safe); top outputSha256/outputBytes updated to
the new GLB while the prior receipt is preserved inside the new stage; all
other provenance fields/byteLineage deep-identical. No numpy/PIL. No paths.
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
              "skin_sub", "prov_in", "prov_out", "recipe",
              "bake_report"]:
        ap.add_argument("--" + k.replace("_", "-"), required=True)
    ap.add_argument("--old-sidecar", required=False, default=None)
    ap.add_argument("--append-new-image", action="store_true")
    ap.add_argument("--reuse-unbound-normal-texture", action="store_true")
    ap.add_argument("--code-sha", required=False, default=None)
    ap.add_argument("--expect-old-sha", required=False, default=None)
    ap.add_argument("--trust-name-match", action="store_true")
    a = ap.parse_args()
    append = bool(a.append_new_image)
    reuse = bool(a.reuse_unbound_normal_texture)
    if reuse and (append or a.trust_name_match or a.old_sidecar is not None):
        refuse("reuse-unbound mode takes no old-sidecar/append/trust-name-match")
    if not reuse and a.expect_old_sha is not None:
        refuse("expect-old-sha is reuse-mode only")

    actual_code_sha = sha(open(os.path.abspath(__file__), "rb").read())
    if a.code_sha is not None and a.code_sha != actual_code_sha:
        refuse("code-sha mismatch")
    required_files = [a.src, a.new_normal, a.prov_in, a.bake_report]
    if a.old_sidecar is not None:
        required_files.append(a.old_sidecar)
    for p in required_files:
        if not os.path.isfile(p):
            refuse("missing input: " + p)
    if not append and not reuse and a.old_sidecar is None:
        refuse("old-sidecar required in replacement mode (or use --append-new-image)")
    outs = [os.path.realpath(a.out), os.path.realpath(a.prov_out)]
    if outs[0] == outs[1]:
        refuse("out and prov-out must be distinct")
    ins = {os.path.realpath(p) for p in required_files}
    if outs[0] in ins or outs[1] in ins:
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
        refuse("new normal PNG undecodable/unsupported (need 8-bit RGB/RGBA, non-interlaced, filters 0-4)")
    st = stats(dec)
    if not all(st["bars"]):
        refuse("normal bars fail sd=%.2f flat=%.4f incoh=%.4f bars=%s"
               % (st["sd"], st["flat"], st["incoh"], st["bars"]))

    rep = json.load(open(a.bake_report))
    if rep.get("bakeInputGlbFullSha") != sha(src):
        refuse("bake report bake-input is not this src file")
    if rep.get("inputGlbFullSha") != sha(src):
        refuse("bake report does not target this src file")
    if rep.get("outputPngSha") != sha(png):
        refuse("bake report outputPngSha != new normal bytes")
    if rep.get("recipe") != a.recipe:
        refuse("bake report recipe != requested recipe")
    for k in ["vsha", "bodyMesh"]:
        if not rep.get(k):
            refuse("bake report missing " + k)
    base = rep.get("bodyMeshBase") or rep.get("bodyMesh")
    if not base:
        refuse("bake report missing bodyMeshBase")
    reported_base = base
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
    _bufs = j.get("buffers", None)
    if _bufs is None:
        pass
    else:
        if not isinstance(_bufs, list) or len(_bufs) != 1:
            refuse("source must declare exactly one buffer")
        if _bufs[0].get("uri") is not None:
            refuse("source buffer must be self-contained GLB (no uri)")

    old = None
    oldsha = None
    arch_name = None
    if append:
        if a.trust_name_match:
            refuse("trust-name-match is replacement-mode only")
        if a.expect_old_sha is not None:
            refuse("expect-old-sha is reuse-mode only")
        pre_skin = [m for m in j["materials"] if a.skin_sub in m.get("name", "")]
        if len(pre_skin) != 1:
            refuse("skin material ambiguous: %s" % pre_skin)
        if pre_skin[0].get("normalTexture") is not None:
            refuse("already bound: skin has normalTexture; append mode refused")
        retired = [i for i, im in enumerate(j["images"])
                   if "skin-normal" in (im.get("name") or "")]
        if retired:
            refuse("retired unbound normal present; use replacement mode")
        ti = None
    elif reuse:
        if a.expect_old_sha is None:
            refuse("reuse mode requires --expect-old-sha")
        oldsha = a.expect_old_sha
        cands = [i for i, im in enumerate(j["images"])
                 if sha(img_bytes(binary, j["bufferViews"], im["bufferView"])) == oldsha]
        if len(cands) != 1:
            refuse("reuse identity ambiguous: %s" % cands)
        ti = cands[0]
        tim = j["images"][ti]
        if not isinstance(tim.get("bufferView"), int):
            refuse("reuse target must be bufferView PNG")
        if tim.get("mimeType") != "image/png":
            refuse("reuse target must be image/png")
        tvi = tim["bufferView"]
        if img_bytes(binary, j["bufferViews"], tvi)[:8] != b"\x89PNG\r\n\x1a\n":
            refuse("reuse target bytes must be PNG")
        if j.get("extensions"):
            refuse("reuse refused: opaque root extensions present")
        refs = []
        tex_by_idx = {n: t for n, t in enumerate(j.get("textures", []))}

        def _idx_walk(o):
            if isinstance(o, dict):
                if isinstance(o.get("index"), int):
                    t = tex_by_idx.get(o["index"])
                    if t is not None and t.get("source") == ti:
                        refs.append("material-texture-index:%d" % o["index"])
                for k, v in o.items():
                    if isinstance(v, (dict, list)):
                        _idx_walk(v)
            elif isinstance(o, list):
                for v in o:
                    _idx_walk(v)
        _idx_walk(j.get("materials", []))
        _idx_walk(j.get("extensions", {}))
        if refs:
            refuse("reuse target referenced: %s" % refs[:4])
        # exactly one plain root-level texture must point at ti
        roots = [t for t in j.get("textures", [])
                 if t.get("source") == ti and set(t.keys()) <= {"source", "name", "sampler"}]
        if len(roots) != 1:
            refuse("reuse requires exactly 1 plain root texture: found %d" % len(roots))
        if roots[0].get("extensions"):
            refuse("reuse root texture has extensions")
        if set(tim.keys()) - {"name", "mimeType", "bufferView"}:
            refuse("reuse target image has opaque references")
        # recursive exact source-index JSON pointer check: ti must appear only there
        ptrs = []

        def _ptr(o, path):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k == "source" and v == ti:
                        ptrs.append(path + "/source")
                    _ptr(v, path + "/" + k)
            elif isinstance(o, list):
                for n, v in enumerate(o):
                    _ptr(v, path + "/" + str(n))
        _ptr(j, "")
        if len(ptrs) != 1 or not ptrs[0].startswith("/textures/"):
            refuse("reuse target has other references: %s" % ptrs[:4])
        # no other parent of the same bufferView
        bv_ptrs = []

        def _bv(o, path):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k == "bufferView" and v == tvi:
                        bv_ptrs.append(path + "/bufferView")
                    if isinstance(v, (dict, list)):
                        _bv(v, path + "/" + k)
            elif isinstance(o, list):
                for n, v in enumerate(o):
                    _bv(v, path + "/" + str(n))
        _bv(j, "")
        if len(bv_ptrs) != 1 or bv_ptrs[0] != "/images/%d/bufferView" % ti:
            refuse("reuse bufferView shared: %s" % bv_ptrs[:4])
    else:
        old = open(a.old_sidecar, "rb").read()
        oldsha = sha(old)
        cands = [i for i, im in enumerate(j["images"])
                 if sha(img_bytes(binary, j["bufferViews"], im["bufferView"])) == oldsha]
        if not cands and a.trust_name_match:
            cands = [i for i, im in enumerate(j["images"])
                     if "skin-normal" in (im.get("name") or "")]
            if len(cands) != 1:
                refuse("name-match ambiguous: %s" % cands)
            oldsha = sha(img_bytes(binary, j["bufferViews"],
                                   j["images"][cands[0]]["bufferView"]))
            arch_name = "archived-embedded-old-normal.png"
        if len(cands) != 1:
            refuse("bad-map identity ambiguous: %s" % cands)
        ti = cands[0]
    skin = [i for i, m in enumerate(j["materials"]) if a.skin_sub in m.get("name", "")]
    if len(skin) != 1:
        refuse("skin material ambiguous: %s" % skin)
    si = skin[0]

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
    is_reuse = bool(a.reuse_unbound_normal_texture)
    if is_reuse and a.trust_name_match:
        refuse("trust-name-match forbidden in reuse mode")
    if append:
        old_spans = [(v.get("byteOffset", 0), v.get("byteLength", 0)) for v in views]
        tx = len(j.get("textures", []))
        ni = len(j.get("images", []))
        j.setdefault("images", []).append(
            {"name": "skin-normal", "mimeType": "image/png", "bufferView": len(views)})
        j.setdefault("textures", []).append({"source": ni})
        j["materials"][si]["normalTexture"] = {"index": tx, "scale": 1.0}
        pad = (-len(binary)) % 4
        newbin = bytearray(binary) + b"\x00" * pad + png
        views.append({"buffer": 0, "byteOffset": len(binary) + pad, "byteLength": len(png)})
        if [(v.get("byteOffset", 0), v.get("byteLength", 0)) for v in views[:-1]] != old_spans:
            refuse("append altered old bufferViews")
    else:
        if is_reuse:
            tx = next(ti2 for ti2, t in enumerate(j.get("textures", []))
                      if t.get("source") == ti)
            pre = dict(j["materials"][si])
            j["materials"][si]["normalTexture"] = {"index": tx, "scale": 1.0}
        else:
            raw = json.dumps(j)
            if not all(t.get("source") != ti for t in j.get("textures", [])):
                refuse("target image has texture parents")
            if '"source": %d' % ti in raw:
                refuse("target image referenced in JSON")
            tx = len(j.get("textures", []))
            j.setdefault("textures", []).append({"source": ti})
            j["materials"][si]["normalTexture"] = {"index": tx, "scale": 1.0}

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

    if arch_name is not None:
        arch = os.path.join(os.path.dirname(os.path.abspath(a.out)), arch_name)
        if os.path.exists(arch):
            refuse("no-clobber: archive slot exists")
    rep_out = {"outSha": newsha[:16], "outBytes": len(glb), "imageIdx": ti,
               "textureIdx": tx, "skinMat": si, "skinPrims": n_skin_prims,
               "srcBodyMesh": src_mesh_name, "srcBodyVerts": src_verts,
               "sdR": round(st["sd"], 3), "flat": round(st["flat"], 4),
               "incoh": round(st["incoh"], 4),
               "bars": [bool(x) for x in st["bars"]],
               "flow": "append-new-image" if append else ("reuse-unbound-normal-texture" if is_reuse else "replace-retired-normal")}
    pp = rep.get("pore") or {}
    mm = rep.get("macro") or {}
    bake_rep_sha = sha(open(a.bake_report, "rb").read())
    runtime = rep.get("runtime") or "UNKNOWN"
    for _k in ["derivationMode", "generator", "renderRecipe", "meshSurfaceBake",
               "measuredSkinPores", "photorealClaim", "bindingScope", "vshaScope"]:
        if rep.get(_k) is None:
            refuse("bake report missing truthful receipt field: " + _k)
    if rep.get("meshSurfaceBake") is not False:
        refuse("procedural binder requires meshSurfaceBake=false")
    import re as _re
    if _re.search(r"(?<!no-)blender", str(rep.get("runtime", "")).lower()):
        refuse("procedural report must not claim Blender")
    prov = json.load(open(a.prov_in))
    prior_sha = prov.get("outputSha256")
    prior_bytes = prov.get("outputBytes")
    nm_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "normal_metrics.py")
    nm_sha = sha(open(nm_path, "rb").read())
    prov.setdefault("stages", []).append(
        {"stage": "skin-normal-canonical-rebind", "recipe": a.recipe,
         "inputGlbSha": a.expect_src_sha, "bakeInputGlb": rep.get("bakeInputGlb"),
         "bakeInputGlbSha": rep.get("bakeInputGlbFullSha"),
         "bakeReportSha": bake_rep_sha, "bakeReportSha256": bake_rep_sha,
         "bakeRecipe": rep.get("recipe"), "bakePore": pp, "bakeMacro": mm,
         "bodyMesh": src_mesh_name, "reportedBodyMesh": reported_base,
         "bodyVsha": rep.get("vsha"),
         "flow": "append-new-image" if append else ("reuse-unbound-normal-texture" if is_reuse else "replace-retired-normal"),
         "oldNormalSha": oldsha, "newNormalSha": a.expect_png_sha,
         "priorOutputSha256": prior_sha, "priorOutputBytes": prior_bytes,
         "outputGlbSha": newsha, "outputGlbBytes": len(glb),
         "normalBars": {"sdR": rep_out["sdR"], "flat": rep_out["flat"],
                        "incoh": rep_out["incoh"],
                        "bars": rep_out["bars"]},
         "codeSha": actual_code_sha,
         "normalMetricsCodeSha": nm_sha,
         "runtime": runtime,
         "derivationMode": rep.get("derivationMode"),
         "generator": rep.get("generator"),
         "renderRecipe": rep.get("renderRecipe"),
         "meshSurfaceBake": False,
         "measuredSkinPores": False,
         "photorealClaim": False,
         "bindingScope": rep.get("bindingScope"),
         "derivation": "procedural stylized coherent-detail binding: analytic heightfield artistic texture (no mesh-surface bake, no measured pores, no photoreal claim); source GLB used for binding identity/UV slot only; mesh geometry normals preserved, detail carried only by the added tangent-space normal field"})
    prov["outputSha256"] = newsha
    prov["outputBytes"] = len(glb)
    if arch_name is not None:
        arch = os.path.join(os.path.dirname(os.path.abspath(a.out)), arch_name)
        open(arch, "wb").write(img_bytes(binary, j["bufferViews"],
                                         j["images"][cands[0]]["bufferView"]))
    open(a.out, "wb").write(glb)
    json.dump(prov, open(a.prov_out, "w"), indent=1)
    print("BIND " + json.dumps(rep_out))


if __name__ == "__main__":
    main()
