"""Git-bound actual producer: resolves canonical blob, verifies, transforms.

CLI: --source-repo DIR --input-ref REF --glb ORIGINAL_INPUT --out DERIVED_GLB --report REPORT_JSON
- Resolve REF via git rev-parse --verify REF^{commit}; cat-file RESOLVED_COMMIT:PATH.
- Require sha256(blob)==APPROVED and sha256(--glb file)==APPROVED and ==blob sha.
- Pure-wrapper transform of original bytes; write new GLB to --out.
- Report actual transform time/toolSHA/inputcommit/canonicalpath/sourcehash/outputhash.
No --input-sha256/--output-sha override. No assert. Fail-closed SystemExit/return 2.
"""
from __future__ import annotations
import argparse, datetime, hashlib, json, struct, subprocess, sys
from pathlib import Path

APPROVED_INPUT_SHA = "a66a8fff1e2ff4a4662ba90554ca59eae6b375ab09263fe2e6ae862a6fd3f335"
CANONICAL_INPUT_PATH = "apps/ui-xr/public/xr-assets/medical-equipment/exam-table-sketchfab-ccby.glb"
WRAPPER_NAME = "frame_pure_wrapper_longZ_to_longX"
WRAPPER_ROTATION = [0.0, 0.7071067811865475, 0.0, 0.7071067811865476]

def fail(msg):
    print(f"FAIL: {msg}", flush=True)
    raise SystemExit(2)

def run_git(repo, args):
    p = subprocess.run(["git", "-C", repo] + args, capture_output=True)
    if p.returncode != 0:
        fail(f"git {' '.join(args)} rc={p.returncode}: {(p.stderr or b'')[:200]!r}")
    return p.stdout

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-repo", required=True)
    ap.add_argument("--input-ref", required=True)
    ap.add_argument("--glb", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    a = ap.parse_args()
    t0 = datetime.datetime.now(datetime.timezone.utc)
    commit = run_git(a.source_repo, ["rev-parse", "--verify", a.input_ref + "^{commit}"]).decode().strip()
    if not commit or len(commit) != 40:
        fail("bad resolved commit")
    blob = run_git(a.source_repo, ["cat-file", "-p", f"{commit}:{CANONICAL_INPUT_PATH}"])
    blob_sha = hashlib.sha256(blob).hexdigest()
    if blob_sha != APPROVED_INPUT_SHA:
        fail(f"canonical blob sha {blob_sha} != approved")
    orig = Path(a.glb).read_bytes()
    orig_sha = hashlib.sha256(orig).hexdigest()
    if orig_sha != APPROVED_INPUT_SHA or orig_sha != blob_sha:
        fail(f"original --glb sha {orig_sha} != approved/blob {blob_sha}")
    if len(orig) < 20 or orig[:4] != b"glTF":
        fail("bad magic")
    if struct.unpack("<I", orig[4:8])[0] != 2:
        fail("unsupported version")
    if struct.unpack("<I", orig[8:12])[0] != len(orig):
        fail("header length mismatch")
    jlen = struct.unpack("<I", orig[12:16])[0]
    if orig[16:20] != b"JSON" or jlen % 4 != 0 or 20 + jlen > len(orig):
        fail("bad JSON chunk")
    js = json.loads(orig[20:20 + jlen].decode("utf-8"))
    rest = orig[20 + jlen:]
    if not rest:
        fail("missing BIN stream")
    if not isinstance(js.get("scenes"), list) or len(js["scenes"]) != 1:
        fail("expected one scene")
    if not isinstance(js.get("nodes"), list) or not js["nodes"]:
        fail("expected nodes")
    old_roots = list(js["scenes"][0].get("nodes", []))
    if not old_roots:
        fail("no roots")
    js["nodes"].append({"name": WRAPPER_NAME, "rotation": list(WRAPPER_ROTATION), "children": old_roots})
    js["scenes"][0]["nodes"] = [len(js["nodes"]) - 1]
    new_json = json.dumps(js, separators=(",", ":")).encode()
    new_json += b" " * ((4 - len(new_json) % 4) % 4)
    hdr = bytearray(orig[:12])
    struct.pack_into("<I", hdr, 8, 12 + 8 + len(new_json) + len(rest))
    out = bytes(hdr) + struct.pack("<I", len(new_json)) + b"JSON" + new_json + rest
    if out[:4] != b"glTF":
        fail("output magic")
    out_sha = hashlib.sha256(out).hexdigest()
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_bytes(out)
    t1 = datetime.datetime.now(datetime.timezone.utc)
    tool_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    rep = {"inputSha256": blob_sha, "approvedInputSha": APPROVED_INPUT_SHA,
        "canonicalInputPath": CANONICAL_INPUT_PATH, "inputCommit": commit,
        "inputRef": a.input_ref, "sourceRepo": a.source_repo,
        "outputSha256": out_sha, "transformStartUtc": t0.isoformat(),
        "generationTimeUtc": t1.isoformat(), "toolSha256": tool_sha,
        "toolPath": str(Path(__file__).resolve()),
        "attribution": "Exam Table by orphic_oasis8 (Sketchfab, CC BY 4.0)",
        "transform": "pure wrapper: append one named +90deg Y node, reparent original scene roots; original objects/post-JSON stream exact",
        "status": "candidate_not_promoted", "stage": "DERIVED pure-frame stage; not provider/Blender rerun"}
    Path(a.report).parent.mkdir(parents=True, exist_ok=True)
    Path(a.report).write_text(json.dumps(rep, indent=2) + "\n")
    print(json.dumps({"ok": True, "inputCommit": commit, "inputSha": blob_sha, "outputSha": out_sha}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
