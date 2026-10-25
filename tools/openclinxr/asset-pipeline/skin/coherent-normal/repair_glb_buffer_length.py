"""OWN repair: fix GLB container buffers[0].byteLength to actual BIN length.

Bounded stdlib-only CLI. Fixes ONLY the JSON container declaration;
BIN bytes, views, accessors, materials preserved. Validates exact single
self-contained buffer GLB. No hardcoded paths.
"""
import argparse
import copy
import datetime
import hashlib
import json
import os
import struct
import sys


def sha(b):
    return hashlib.sha256(b).hexdigest()


def refuse(msg):
    raise SystemExit("REFUSE: " + msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src_in", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--expected-input-sha", required=True)
    ap.add_argument("--prov-in", required=True)
    ap.add_argument("--prov-out", required=True)
    ap.add_argument("--code-sha", required=False, default=None)
    a = ap.parse_args()
    actual_code_sha = sha(open(os.path.abspath(__file__), "rb").read())
    if a.code_sha is not None and a.code_sha != actual_code_sha:
        refuse("code-sha mismatch")
    for p in [a.src_in, a.prov_in]:
        if not os.path.isfile(p):
            refuse("missing input: " + p)
    outs = [os.path.realpath(a.out), os.path.realpath(a.prov_out)]
    if outs[0] == outs[1]:
        refuse("out and prov-out must be distinct")
    ins = {os.path.realpath(a.src_in), os.path.realpath(a.prov_in)}
    if outs[0] in ins or outs[1] in ins:
        refuse("outputs must be distinct from inputs")
    if os.path.exists(a.out):
        refuse("no-clobber: out exists")
    if os.path.exists(a.prov_out):
        refuse("no-clobber: prov-out exists")
    src = open(a.src_in, "rb").read()
    if sha(src) != a.expected_input_sha:
        refuse("wrong-actor input: src sha mismatch")
    if len(src) < 20:
        refuse("too short for GLB header")
    magic, ver, total = struct.unpack("<III", src[:12])
    if magic != 0x46546C67 or ver != 2:
        refuse("not a GLB2 container")
    if total != len(src):
        refuse("GLB total length mismatch")
    jl, jt = struct.unpack("<II", src[12:20])
    if jt != 0x4E4F534A:
        refuse("first chunk must be JSON")
    j = json.loads(src[20:20 + jl])
    off = 20 + jl
    if len(src) < off + 8:
        refuse("missing BIN chunk header")
    cl, ct = struct.unpack("<II", src[off:off + 8])
    if ct != 0x004E4942:
        refuse("second chunk must be BIN")
    binary = src[off + 8:off + 8 + cl]
    if len(binary) != cl:
        refuse("BIN truncated")
    if off + 8 + cl != len(src):
        refuse("GLB must be exactly JSON+BIN (no extra chunks)")
    bufs = j.get("buffers")
    if not isinstance(bufs, list) or len(bufs) != 1:
        refuse("GLB must declare exactly one buffer")
    if bufs[0].get("uri") is not None:
        refuse("buffer must be self-contained (no uri)")
    for i, v in enumerate(j.get("bufferViews", [])):
        s = v.get("byteOffset", 0)
        ln = v.get("byteLength", 0)
        if s < 0 or ln < 0 or s + ln > len(binary):
            refuse("bufferView %d outside actual BIN" % i)
    old_declared = bufs[0].get("byteLength")
    j["buffers"][0]["byteLength"] = len(binary)
    doc = json.dumps(j, separators=(",", ":")).encode()
    while len(doc) % 4:
        doc += b" "
    glb = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(doc) + 8 + len(binary))
           + struct.pack("<II", len(doc), 0x4E4F534A) + doc
           + struct.pack("<II", len(binary), 0x004E4942) + binary)
    newsha = sha(glb)
    prov = json.load(open(a.prov_in))
    prior_sha = prov.get("outputSha256")
    prior_bytes = prov.get("outputBytes")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    prov.setdefault("stages", []).append(
        {"stage": "container-length-repair",
         "inputGlbSha": a.expected_input_sha,
         "priorOutputSha256": prior_sha, "priorOutputBytes": prior_bytes,
         "outputGlbSha": newsha, "outputGlbBytes": len(glb),
         "declaredByteLengthBefore": old_declared,
         "declaredByteLengthAfter": len(binary),
         "repairedAtUtc": now, "helperCodeSha": actual_code_sha})
    prov["outputSha256"] = newsha
    prov["outputBytes"] = len(glb)
    open(a.out, "wb").write(glb)
    json.dump(prov, open(a.prov_out, "w"), indent=1)
    print("REPAIR " + json.dumps({"in": old_declared, "actual": len(binary),
                                  "outSha": newsha, "outBytes": len(glb)}))


if __name__ == "__main__":
    main()
