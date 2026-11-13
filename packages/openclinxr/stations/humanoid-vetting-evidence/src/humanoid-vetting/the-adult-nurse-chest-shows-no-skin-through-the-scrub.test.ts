/**
 * Adult-nurse chest (E9-R1d): poking body skin through the scrub shirt.
 *
 * Defect (R0 S0, store nurse-fresh-08-03 captures, med recalibrated on this GLB):
 * front box [2230,1480,2270,1540] 71 skin-chroma px = body prim0 62 + shirt 9;
 * three_quarter box [2160,1460,2220,1530] 89 = body 75 + shirt 14.
 * S2 recall 1.0 both boxes; R0b T2 simulated hide gives 0 new see-through in
 * 24/24 frames + both capture views (SAFE 235/235).
 *
 * R1b (cap25): hiding all 235 exposed new see-through elsewhere (native grade:
 * throat sawtooth under hair, neck-V dimpled back-facing body, both sleeve-hem
 * cuts). The R0b first-hit classifier was blind: it counted only
 * hidden/background, never a BACK-FACING body first hit. Backface-aware
 * (back-facing body first hit counts as see-through, prim8 transparent)
 * reports front 3892 + three_quarter 2080 new see-through on the R1 output
 * (stride-2 full frame). Greedy responsibility-drop converges to SAFE' = 106
 * tris (round0 hide235 newsee5972 resp129; round1 hide106 newsee0).
 *
 * R1c (cap25): SAFE'=106 reopened 250 px when posed (232 walk). The same
 * greedy over bind + all 24 posed frames converges to SAFE'' = 92 tris
 * (round0 hide106 newsee250 resp14; round1 hide92 newsee0; residual bind
 * chest-box 0). The tool selects the same 92 with no id list and writes
 * them patch-in-place (trimmed prim0 index range overwritten, dead tail
 * excised): C4 pins non-index accessors + images byte-equal (no BIN-prefix
 * claim). C2 fixture = the 92 SAFE'' ids (E4/safe-ids.json).
 *
 * R1d (review findings F1-F13): the review found the tool's posed gate was
 * bypassable (default bind-only), C2 vacuous (23-min tool never executed),
 * C7 skipped in clean clones, C1/C3/C4/C5 under-asserted, and a
 * package->tools import plus lint breaks. This file is the R1d rewrite:
 *
 * C1 (F5) casts EVERY pixel of both chest boxes at stride 1 (front 40x60,
 * three_quarter 60x70): body prim-0 first hits must be 0, every other ray
 * must hit the shirt (other == box area, zero misses).
 * C2 (F2a) the tool's moved set == the 92 SAFE'' known-good ids (embedded
 * fixture + E4/safe-ids.json when present) PLUS (F2b) a provenance clause:
 * the committed nurse sidecar's byteLineage record (tool shape) names
 * rehide-poking-skin.py with --rays-dir/--poses-meta/--poses-dir plus the
 * sample-grade-poses.ts regen command in its derivationArgv, and its recorded output sha == sha256(GLB under test).
 * RED on the pre-image by design (recorded 8957543d != pre f6573124).
 * (F2c lives in tools/.../test_rehide_poking_skin.py: greedy_over_frames on
 * a synthetic scene must drop the known triangle; "return all flagged"
 * fails it.)
 * C3 (F6) moved set is the rule's poke set restricted to SAFE'': rule still
 * flags 235, moved is 92 and a subset, AND the neck-V measurement asserts:
 * dip == DIP_PRE (pre-image value) and above_dip == ABOVE_DIP_SAFE (25 for
 * the 92-set; a neck-V-contaminated moved set raises it).
 * C4 (F4) non-index accessors decode byte-equal AND every image payload
 * (each bufferView's bytes) is byte-equal, mime included.
 * C5 (F7) per-ray outside-box conservation at C7_STRIDE, pre counts derived
 * in the same run (no literals): every outside ray matches pre except rays
 * whose pre first-hit face is a moved tri (now shirt, zero new misses).
 * C7 (F3) the neck guard, NO skipIf, clean-clone safe: dirs computed in-test
 * from the committed loadScene cameras (the sample-grade-poses stride loop,
 * three imported) at C7_STRIDE = 16 — the coarsest stride still RED on the
 * R1 output 35925a3d (E6 sweep 2026-11-13: stride 16 RED front 64 /
 * three_quarter 31, GREEN 0/0; stride 8 RED 246/136, stride 4 RED 972/516,
 * stride 2 RED 3892/2080). RED proof: run this file with
 * E9_R1_GLB=<E6/r1-235.glb> (sha 35925a3d...): C7 fails 64/31.
 * CONTROL right-chest mirror boxes stay 0.
 *
 * Pre-image pin: 0ad5234d0d4883ca38346356ae3c16670e8eea1b
 * (origin/main at plant; GLB f6573124437c4f170643ad33d2f922bb66a069fcc58bcf3bbeef8b9a8da2833c, 12353924 B).
 *
 * GLB override: E9_R1_GLB points the test at a candidate output (P3 gates the
 * E/out GLB before P4 installs it to the shipped path); default is shipped.
 *
 * NOT_TESTED: rendered pixels (the orchestrator renders and grades).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { type Group, type PerspectiveCamera, Raycaster, Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { loadScene } from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/see-through-pixels.js";

const REPO_ROOT = repoRoot();
const GLB = process.env["E9_R1_GLB"] ?? join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const PROVENANCE_JSON = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.provenance.json");
/** Pre-image commit pinned at plant (full SHA for git show in clean clones). */
const PRE_IMAGE_COMMIT = "0ad5234d0d4883ca38346356ae3c16670e8eea1b";
const PRE_IMAGE_REV = `${PRE_IMAGE_COMMIT}:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb`;

/** E9 chest boxes: front 40x60, three_quarter 60x70 (F5: every pixel cast). */
const FRONT_BOX: readonly [number, number, number, number] = [2230, 1480, 2270, 1540];
const TQ_BOX: readonly [number, number, number, number] = [2160, 1460, 2220, 1530];

/** Right-chest CONTROL mirrors (same sizes, opposite side; 0 body hits pre/post). */
const CONTROL_FRONT: readonly [number, number, number, number] = [1826, 1480, 1866, 1540];
const CONTROL_TQ: readonly [number, number, number, number] = [1876, 1460, 1936, 1530];

/** C7 stride (F3/cap25): coarsest stride still RED on 35925a3d (64/31). */
const C7_STRIDE = 16;

/** C5 stride (I4/cap25): coarsest stride at which C5 still fails on 35925a3d.
 * E7 probe 2026-11-13: stride 32 RED on r1-235.glb (counts in RESULT); the
 * stride-16 full-file C5 cost 64.6 s, over the 60 s budget, with no
 * slow/heavy suite in this package (package.json scripts: lint/typecheck/test
 * only), so C5 runs at 32. */
const C5_STRIDE = 32;

/**
 * C3 neck-V measurement pins (F6): dip is the shirt-neckline boundary floor
 * measured on the pre-image bytes; ABOVE_DIP_SAFE is the moved-centroid
 * count above the dip for the known-good 92-set (both committed from the
 * E6 probe on f6573124; dip recomputed in-run and asserted equal).
 */
const DIP_PRE = 1.4340695142745972;
const ABOVE_DIP_SAFE = 25;

/** SAFE'' known-good: the 92 ids the posed-converged greedy keeps
 * (R1c C1: round0 hide106 newsee250 resp14; round1 hide92 newsee0;
 * 14 posed-only drops: 247,282,778,4332,4343,4352,4803,4807,4809,4825,
 * 4858,4859,4865,4866).
 * Mirrors .openclinxr/openclaw/ceo/e9-r1c/safe-ids.json; C2 requires both. */
const SAFE_IDS: number[] = [291,292,301,302,309,310,317,500,507,543,747,761,766,769,770,779,1973,1990,2277,4361,4362,4370,4371,4376,4559,4565,4609,4771,4772,4773,4774,4775,4776,4777,4778,4779,4780,4781,4782,4784,4785,4786,4787,4795,4796,4818,4823,4831,4835,4860,4868,4869,4870,4876,4882,4885,4886,4897,4905,4906,4907,4908,4909,4910,4911,4912,4913,4914,4915,4916,4917,4918,4919,4920,4925,4928,4929,4931,4932,4940,4941,4944,4945,4962,4971,4972,4973,4974,6325,6326,6462,6619];
/** E4 evidence dir (git-ignored scratch): R1c SAFE'' + regen inputs. */
const E4_DIR = join(REPO_ROOT, ".openclinxr/openclaw/ceo/e9-r1c");
const E4_SAFE_IDS = join(E4_DIR, "safe-ids.json");

const BODY0 = "mpfb_ed_chest_pain_nurse_adult_body#0";

function isBodySkin(name: string, matName: string): boolean {
  return name.startsWith("mpfb_ed_chest_pain_nurse_adult_body#") && matName.includes("mpfb_skin");
}

type CastHit = { body: boolean; bodyPrim0: boolean; name: string; faceIndex: number } | null;

function makeCaster(scene: { camera: PerspectiveCamera; model: Group }): (x: number, y: number) => CastHit {
  const { camera, model } = scene;
  const rc = new Raycaster();
  rc.far = 100;
  rc.near = 0.01;
  const ndc = new Vector2();
  return (x: number, y: number): CastHit => {
    ndc.set(((x + 0.5) / 4096) * 2 - 1, -((y + 0.5) / 4096) * 2 + 1);
    rc.setFromCamera(ndc, camera);
    const hits = rc.intersectObject(model, true);
    if (hits.length === 0) return null;
    const first = hits[0];
    if (first === undefined) return null;
    const mo = first.object as { name: string; userData: Record<string, unknown> };
    const faceIndex = (first as { faceIndex?: number }).faceIndex ?? -1;
    const body = isBodySkin(mo.name, String(mo.userData["matName"] ?? ""));
    return { body, bodyPrim0: mo.name === BODY0 && body, name: mo.name, faceIndex };
  };
}

async function countBoxFull(
  glbPath: string,
  view: "front" | "three_quarter",
  box: readonly [number, number, number, number],
): Promise<{ prim0: number; other: number; miss: number }> {
  const scene = await loadScene(glbPath, view);
  const cast = makeCaster(scene);
  let prim0 = 0;
  let other = 0;
  let miss = 0;
  for (let y = box[1]; y < box[3]; y++) {
    for (let x = box[0]; x < box[2]; x++) {
      const h = cast(x, y);
      if (h === null) miss++;
      else if (h.bodyPrim0) prim0++;
      else other++;
    }
  }
  return { prim0, other, miss };
}

function inBox(x: number, y: number, b: readonly [number, number, number, number]): boolean {
  return x >= b[0] && x < b[2] && y >= b[1] && y < b[3];
}

function writePreImageGlb(): string {
  const dir = join(tmpdir(), `adult-nurse-chest-prefix-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "mpfb-clinical-nurse-adult-pre.glb");
  writeFileSync(p, execFileSync("git", ["show", PRE_IMAGE_REV], { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 }));
  return p;
}

function pyOut(py: string): string {
  return execFileSync("python3", ["-c", py], { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 }).trim();
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** C7 dirs in-test: the sample-grade-poses stride loop over committed
 * loadScene cameras (three imported). Origin is identical for every pixel
 * (perspective camera): captured once per view. */
async function writeStrideDirs(glbPath: string, stride: number, dir: string): Promise<{ gradeNorm: { scale: number[]; position: number[] }; origins: Record<string, number[]> }> {
  mkdirSync(dir, { recursive: true });
  const W = 4096;
  let gradeNorm = { scale: [1, 1, 1], position: [0, 0, 0] };
  const origins: Record<string, number[]> = {};
  for (const view of ["front", "three_quarter"] as const) {
    const scene = await loadScene(glbPath, view);
    if (view === "front") {
      gradeNorm = { scale: scene.model.scale.toArray(), position: scene.model.position.toArray() };
    }
    const rc = new Raycaster();
    const ndc = new Vector2();
    ndc.set((0.5 / W) * 2 - 1, -((0.5 / W) * 2) + 1);
    rc.setFromCamera(ndc, scene.camera);
    origins[view] = rc.ray.origin.toArray();
    const n = (W / stride) * (W / stride);
    const dirs = new Float32Array(n * 3);
    let k = 0;
    for (let y = 0; y < W; y += stride) {
      for (let x = 0; x < W; x += stride) {
        ndc.set(((x + 0.5) / W) * 2 - 1, -((y + 0.5) / W) * 2 + 1);
        rc.setFromCamera(ndc, scene.camera);
        const d = rc.ray.direction;
        dirs[k * 3] = d.x;
        dirs[k * 3 + 1] = d.y;
        dirs[k * 3 + 2] = d.z;
        k++;
      }
    }
    const fn = view === "front" ? `dirs_front_s${stride}.bin` : `dirs_tq_s${stride}.bin`;
    writeFileSync(join(dir, fn), Buffer.from(dirs.buffer));
  }
  return { gradeNorm, origins };
}

describe("the adult nurse chest shows no skin through the scrub", () => {
  it("C1: E9 chest boxes show no body skin at stride 1", async () => {
    expect(existsSync(GLB), `${GLB} exists on disk`).toBe(true);
    const front = await countBoxFull(GLB, "front", FRONT_BOX);
    const tq = await countBoxFull(GLB, "three_quarter", TQ_BOX);
    // GREEN: the pokes are hidden so the shirt is the first hit on every
    // box ray: prim0 0/0, other == box area (2400/4200), zero new misses.
    // RED on the pre-image (front prim0 62, tq 75).
    expect(
      { frontPrim0: front.prim0, frontOther: front.other, frontMiss: front.miss, tqPrim0: tq.prim0, tqOther: tq.other, tqMiss: tq.miss },
      "E9 chest boxes at stride 1 (front 40x60=2400, tq 60x70=4200)",
    ).toEqual({ frontPrim0: 0, frontOther: 2400, frontMiss: 0, tqPrim0: 0, tqOther: 4200, tqMiss: 0 });
  }, 120_000);

  it("CONTROL: right-chest mirrors stay clean", async () => {
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const front = await countBoxFull(GLB, "front", CONTROL_FRONT);
    const tq = await countBoxFull(GLB, "three_quarter", CONTROL_TQ);
    expect({ frontPrim0: front.prim0, tqPrim0: tq.prim0 }, "control mirror prim0 hits").toEqual({ frontPrim0: 0, tqPrim0: 0 });
  }, 120_000);

  it("C2: tool moved set equals the SAFE'' known-good ids + provenance names the derivation", () => {
    // The tool hides no pasted list: at build time it recomputes the rule set
    // and filters it through the shared backface-aware greedy simulator
    // (bind + 24 posed frames, R1c). This pins the artifact: the live GLB's
    // moved prim0 tris (pre prim0 tris absent from live prim0) must be
    // exactly the 92 SAFE'' ids, both against the embedded fixture and
    // against E4/safe-ids.json when present.
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const pre = writePreImageGlb();
    const py = `
import json, struct
from pathlib import Path
import numpy as np
def read_glb(path):
    raw = Path(path).read_bytes()
    assert struct.unpack("<I", raw[0:4])[0] == 0x46546C67, "not a GLB"
    jl = struct.unpack("<I", raw[12:16])[0]
    doc = json.loads(raw[20:20+jl].decode("utf8"))
    bl = struct.unpack("<I", raw[20+jl:24+jl])[0]
    return doc, raw[28+jl:28+jl+bl]
def dec(doc, binary, ai):
    a = doc["accessors"][ai]
    v = doc["bufferViews"][a["bufferView"]]
    base = v.get("byteOffset",0)+a.get("byteOffset",0)
    n = a["count"]
    dt = np.dtype("<H") if a["componentType"] == 5123 else np.dtype("<I")
    return np.frombuffer(binary, dtype=dt, count=n, offset=base)
def prim0_idx(doc, binary):
    body = next(m for m in doc.get("meshes",[]) if "mpfb_ed_chest_pain_nurse_adult_body" in str(m.get("name","")))
    return np.asarray(dec(doc, binary, body["primitives"][0]["indices"]).reshape(-1), dtype=np.int64)
pre_doc, pre_bin = read_glb(${JSON.stringify(pre)})
live_doc, live_bin = read_glb(${JSON.stringify(GLB)})
pre_tris = set(map(tuple, prim0_idx(pre_doc, pre_bin).reshape(-1,3).tolist()))
live_tris = set(map(tuple, prim0_idx(live_doc, live_bin).reshape(-1,3).tolist()))
moved = sorted([i for i,t in enumerate(prim0_idx(pre_doc, pre_bin).reshape(-1,3).tolist()) if tuple(t) not in live_tris])
safe_path = ${JSON.stringify(E4_SAFE_IDS)}
import os
safe_file = sorted(json.load(open(safe_path))["safe"]) if os.path.exists(safe_path) else None
print(json.dumps({"moved": moved, "safeFile": safe_file}))
`;
    const out = JSON.parse(pyOut(py)) as { moved: number[]; safeFile: number[] | null };
    const fixture = [...SAFE_IDS].sort((a, b) => a - b);
    expect(out.moved, "live moved set == SAFE'' embedded fixture").toEqual(fixture);
    if (out.safeFile !== null) {
      expect(out.safeFile, "E4/safe-ids.json == SAFE'' embedded fixture").toEqual(fixture);
      expect(out.moved, "live moved set == E4/safe-ids.json").toEqual(out.safeFile);
    }
    // F2b provenance clause: the committed nurse sidecar's byteLineage (as
    // written by correct-sidecar-byte-lineage.ts — the test reads the tool's
    // shape, never the reverse) names rehide-poking-skin.py with all required
    // input args plus the sample-grade-poses.ts regen command, and its
    // recorded output sha == sha256(GLB under test). RED on the
    // pre-image by design (recorded 8957543d != pre f6573124).
    const prov = JSON.parse(readFileSync(PROVENANCE_JSON, "utf8")) as {
      outputSha256: string;
      outputBytes: number;
      byteLineage: {
        derivationArgv: string[];
        preImageRevision: string;
        preImageSha256: string;
        outputSha256: string;
      };
    };
    const lineage = prov.byteLineage;
    expect(lineage, "nurse sidecar carries a byteLineage record").toBeTruthy();
    const argvJoined = (lineage.derivationArgv ?? []).join(" ");
    expect(argvJoined.includes("rehide-poking-skin.py"), "derivationArgv runs rehide-poking-skin.py").toBe(true);
    expect(argvJoined.includes("sample-grade-poses.ts"), "derivationArgv carries the poses regen command").toBe(true);
    for (const flag of ["--rays-dir", "--poses-meta", "--poses-dir"]) {
      expect(argvJoined.includes(flag), `derivationArgv names ${flag}`).toBe(true);
    }
    expect(lineage.preImageRevision, "pre-image is the pinned pre-E9 commit descriptor").toBe(
      "0ad5234d0d4883ca38346356ae3c16670e8eea1b:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
    );
    expect(lineage.preImageSha256, "recorded pre-image sha == sha256(pre-image bytes)").toBe(sha256File(pre));
    expect(prov.outputSha256, "sidecar recorded output sha == sha256(GLB under test)").toBe(sha256File(GLB));
    expect(lineage.preImageSha256 === prov.outputSha256, "RED on the pre-image by design").toBe(false);
  }, 120_000);

  it("C3: moved set is the rule's poke set restricted to SAFE'' with the neck-V measurement pinned", async () => {
    // Fidelity guard (store-free, clean-clone safe). The moved set (pre prim0
    // tris absent from live prim0) must be a subset of an independent
    // recomputation of body_hide_mask on the PRE bytes, and number exactly
    // the 92 SAFE'' ids (C2 pins the exact ids). The rule still flags the
    // R0-validated 235; the backface-aware greedy selector (shared simulator,
    // run by the tool at build time) drops the 129 whose hide opens
    // neck-V/sleeve holes. The neck-V measurement asserts: dip == the
    // pre-image value and above_dip == 25 (the 92-set value; a fixture that
    // accidentally includes neck-V tris raises above_dip).
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const pre = writePreImageGlb();
    const py = `
import json, struct, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes"))})
from pathlib import Path
import numpy as np
import garment_coverage as gc
def read_glb(path):
    raw = Path(path).read_bytes()
    assert struct.unpack("<I", raw[0:4])[0] == 0x46546C67
    jl = struct.unpack("<I", raw[12:16])[0]
    doc = json.loads(raw[20:20+jl].decode("utf8"))
    bl = struct.unpack("<I", raw[20+jl:24+jl])[0]
    binary = raw[28+jl:28+jl+bl]
    return doc, binary
def decode(doc, binary, ai):
    import numpy as np
    a = doc["accessors"][ai]
    view = doc["bufferViews"][a["bufferView"]]
    base = view.get("byteOffset",0)+a.get("byteOffset",0)
    fmt,ncomp,n = {5120:"b",5121:"B",5122:"h",5123:"H",5125:"i",5126:"f"}[a["componentType"]], {"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4}[a["type"]], a["count"]
    size = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a["componentType"]]
    stride = view.get("byteStride")
    if stride is None or stride == ncomp*size:
        arr = np.frombuffer(binary, dtype=np.dtype("<"+"".join({"b":"b","B":"B","h":"h","H":"H","i":"i","f":"f"}[ {5120:"b",5121:"B",5122:"h",5123:"H",5125:"i",5126:"f"}[a["componentType"]]])), count=n*ncomp, offset=base)
        return np.array(arr).reshape(n,ncomp)
    raw2 = np.frombuffer(binary, dtype=np.uint8, count=n*stride, offset=base).reshape(n,stride)
    out = np.empty((n,ncomp), dtype=np.float64 if fmt=="f" else np.int64)
    for c in range(ncomp):
        out[:,c] = raw2[:,c*size:(c+1)*size].copy().view(np.dtype("<"+fmt)).reshape(n)
    return out
def find_mesh(doc, token):
    ms = [m for m in doc.get("meshes",[]) if token in str(m.get("name",""))]
    assert len(ms)==1, f"mesh {token} found {len(ms)}"
    return ms[0]
import sys
pre_path = ${JSON.stringify(pre)}
live_path = ${JSON.stringify(GLB)}
pre_doc, pre_bin = read_glb(pre_path)
live_doc, live_bin = read_glb(live_path)
mats = [m.get("name","") for m in pre_doc.get("materials",[])]
def skin_prim0(doc, binary):
    body = find_mesh(doc, "mpfb_ed_chest_pain_nurse_adult_body")
    for p in body.get("primitives",[]):
        if "mpfb_skin" in mats[p["material"]]:
            v = decode(doc,binary,p["attributes"]["POSITION"]).astype(float)
            f = np.asarray(decode(doc,binary,p["indices"]).reshape(-1),dtype=np.int64).reshape(-1,3)
            return v, f
    raise AssertionError("no skin prim")
pre_v, pre_f = skin_prim0(pre_doc, pre_bin)
live_v, live_f = skin_prim0(live_doc, live_bin)
live_set = set(map(tuple, live_f.tolist()))
moved = sorted([i for i,t in enumerate(pre_f.tolist()) if tuple(t) not in live_set])
shirt = find_mesh(pre_doc, "scrub_shirt")
sp = shirt["primitives"][0]
sv = decode(pre_doc,pre_bin,sp["attributes"]["POSITION"]).astype(float)
sf = np.asarray(decode(pre_doc,pre_bin,sp["indices"]).reshape(-1),dtype=np.int64).reshape(-1,3)
band_lo, band_hi = float(sv[:,1].min()), float(sv[:,1].max())
rule = gc.body_hide_mask(pre_v, pre_f, sv, sf, band_lo, band_hi, height_axis=1, lateral_axis=0)
rule_set = sorted(int(t) for t in np.where(rule["hideMask"])[0].tolist())
half = float(np.abs(sv[:,0]).max())
lash = find_mesh(pre_doc, "eyelash")
lash_v = decode(pre_doc,pre_bin,lash["primitives"][0]["attributes"]["POSITION"]).astype(float)
shirt_top = float(sv[:,1].max())
neck_sel = (pre_v[:,1] >= shirt_top-0.10) & (pre_v[:,1] <= shirt_top)
neck_zc = float(np.median(pre_v[neck_sel,2]))
fs = 1 if float(lash_v[:,2].mean()) > neck_zc else -1
frontward = sv[:,2] > float(sv[:,2].mean()) if fs>0 else sv[:,2] < float(sv[:,2].mean())
S = sv[(np.abs(sv[:,0]) < 0.25*half) & frontward]
above = np.zeros(len(S), dtype=bool)
for i,p in enumerate(S):
    d = sv - p
    above[i] = bool((((np.abs(d[:,0]) < 0.008) & (np.abs(d[:,2]) < 0.02) & (d[:,1] > 0.0005) & (d[:,1] < 0.04))).any())
bnd = S[~above]
dip = float(bnd[:,1].min()) if len(bnd) else None
moved_cy = pre_v[pre_f[moved]].mean(axis=1)[:,1] if moved else np.array([])
print(json.dumps({"moved": len(moved), "rule": len(rule_set),
  "subset": set(moved) <= set(rule_set),
  "dip": dip,
  "above_dip": int((moved_cy > dip).sum()) if dip is not None else None}))
`;
    const out = JSON.parse(pyOut(py)) as { moved: number; rule: number; subset: boolean; dip: number | null; above_dip: number | null };
    expect(out.rule, "independent rule recomputation flags 235").toBe(235);
    expect(out.moved, `tool moved the SAFE'' ${SAFE_IDS.length} prim0 tris`).toBe(SAFE_IDS.length);
    expect(out.subset, "moved set is a subset of the rule set: the tool hides only rule-flagged tris").toBe(true);
    expect(out.dip, "neck-V dip == pre-image value").toBe(DIP_PRE);
    expect(out.above_dip, "moved tris above the dip == SAFE'' value (25)").toBe(ABOVE_DIP_SAFE);
  }, 180_000);

  it("C4: non-index accessors and image payloads are byte-equal to the pre-image", () => {
    // R1c patch-in-place output: the trimmed prim0 index range is overwritten
    // in place and the dead tail excised (no orphaned index bytes, C3), so
    // the live BIN is NOT a byte-prefix of the pre BIN by design. What C4
    // pins: every non-index accessor decodes byte-equal at the same index,
    // and every image payload (each image bufferView's bytes) is byte-equal
    // with its mimeType. Index-accessor content is pinned by C2/C3.
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const pre = writePreImageGlb();
    const py = `
import json, struct, hashlib
from pathlib import Path
import numpy as np
def read_glb(path):
    raw = Path(path).read_bytes()
    assert struct.unpack("<I", raw[0:4])[0] == 0x46546C67
    jl = struct.unpack("<I", raw[12:16])[0]
    doc = json.loads(raw[20:20+jl].decode("utf8"))
    bl = struct.unpack("<I", raw[20+jl:24+jl])[0]
    binary = raw[28+jl:28+jl+bl]
    return doc, binary, raw
def decode_bytes(doc, binary, ai):
    a = doc["accessors"][ai]
    if "bufferView" not in a:
        # sparse-only accessor (no dense bufferView): compare sparse payload bytes
        parts = []
        sp = a.get("sparse", {})
        for key in ("indices", "values"):
            s = sp.get(key, {})
            if "bufferView" in s:
                view = doc["bufferViews"][s["bufferView"]]
                base = view.get("byteOffset",0)+s.get("byteOffset",0)
                n = sp.get("count", 0)
                ncomp = {"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4,"MAT4":16}[a["type"]] if key == "values" else 1
                ct = s["componentType"] if key == "indices" else a["componentType"]
                size = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[ct]
                parts.append(binary[base:base+n*ncomp*size])
        return b"|".join(parts) + json.dumps(a.get("sparse", {}), sort_keys=True).encode()
    view = doc["bufferViews"][a["bufferView"]]
    base = view.get("byteOffset",0)+a.get("byteOffset",0)
    n = a["count"]
    ncomp = {"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4,"MAT4":16}[a["type"]]
    size = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a["componentType"]]
    stride = view.get("byteStride")
    length = n*(stride if stride else ncomp*size)
    return binary[base:base+length]
pre_path = ${JSON.stringify(pre)}
live_path = ${JSON.stringify(GLB)}
pre_doc, pre_bin, pre_raw = read_glb(pre_path)
live_doc, live_bin, live_raw = read_glb(live_path)
# the live BIN is NOT a byte-prefix of the pre BIN (patched in place +
# tail excised); every other pre accessor must decode byte-equal in live.
# images: compare mimeType + the payload bytes of each image bufferView.
index_acc = set()
for m in live_doc.get("meshes",[]):
    for p in m.get("primitives",[]):
        if "indices" in p: index_acc.add(p["indices"])
mismatch = []
skipped = []
for i in range(len(pre_doc.get("accessors",[]))):
    if i in index_acc:
        skipped.append(i)
        continue
    a = decode_bytes(pre_doc, pre_bin, i)
    b = decode_bytes(live_doc, live_bin, i)
    if a != b:
        mismatch.append(i)
def image_payloads(doc, binary):
    out = []
    for im in doc.get("images",[]):
        bv = im.get("bufferView")
        if bv is None:
            out.append({"mime": im.get("mimeType"), "bytes": None})
            continue
        v = doc["bufferViews"][bv]
        base = v.get("byteOffset",0)
        out.append({"mime": im.get("mimeType"), "bytes": binary[base:base+v["byteLength"]].hex()})
    return out
pre_imgs = image_payloads(pre_doc, pre_bin)
live_imgs = image_payloads(live_doc, live_bin)
img_mismatch = [i for i,(a,b) in enumerate(zip(pre_imgs, live_imgs)) if a != b]
print(json.dumps({"pre_bin_len": len(pre_bin), "live_bin_len": len(live_bin), "mismatch": mismatch, "skipped_index": skipped, "n_images": len(pre_imgs), "img_mismatch": img_mismatch, "pre_acc": len(pre_doc.get("accessors",[])), "live_acc": len(live_doc.get("accessors",[]))}))
`;
    const out = JSON.parse(pyOut(py)) as { pre_bin_len: number; live_bin_len: number; mismatch: number[]; skipped_index: number[]; n_images: number; img_mismatch: number[]; pre_acc: number; live_acc: number };
    expect(out.mismatch, `pre-range non-index accessor bytes unchanged (mismatches ${JSON.stringify(out.mismatch)}, skipped index ${JSON.stringify(out.skipped_index)})`).toEqual([]);
    expect(out.n_images, "image count unchanged").toBeGreaterThan(0);
    expect(out.img_mismatch, `image payload bytes + mime unchanged (${out.n_images} images, mismatches ${JSON.stringify(out.img_mismatch)})`).toEqual([]);
  }, 120_000);

  it("C5: body first hits outside the boxes are unchanged except on moved tris", async () => {
    // Per-ray conservation (store-free, clean-clone safe: pre-image via git
    // show). At C7_STRIDE, every outside-box ray must give the same
    // body/non-body answer pre vs post, EXCEPT rays whose pre first-hit face
    // is one of the 92 moved prim0 tris (grazing views of the poke just
    // outside the box edge): those must now be non-body (the shirt behind
    // the poke), with zero new misses (a miss would be new see-through).
    // Pre counts are derived in this run (no literals); preOutside > 0 is
    // the anti-vacuity anchor.
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const pre = writePreImageGlb();
    const moved = JSON.parse(
      pyOut(`
import json, struct
from pathlib import Path
import numpy as np
def read_glb(path):
    raw = Path(path).read_bytes()
    jl = struct.unpack("<I", raw[12:16])[0]
    doc = json.loads(raw[20:20+jl].decode("utf8"))
    bl = struct.unpack("<I", raw[20+jl:24+jl])[0]
    return doc, raw[28+jl:28+jl+bl]
def dec(doc, binary, ai):
    a = doc["accessors"][ai]
    v = doc["bufferViews"][a["bufferView"]]
    base = v.get("byteOffset",0)+a.get("byteOffset",0)
    n = a["count"]
    return np.frombuffer(binary, dtype=np.dtype("<H"), count=n, offset=base)
pre_doc, pre_bin = read_glb(${JSON.stringify(pre)})
live_doc, live_bin = read_glb(${JSON.stringify(GLB)})
pre_idx = dec(pre_doc, pre_bin, next(m for m in pre_doc["meshes"] if "mpfb_ed_chest_pain_nurse_adult_body" in str(m.get("name","")))["primitives"][0]["indices"])
live_idx = dec(live_doc, live_bin, next(m for m in live_doc["meshes"] if "mpfb_ed_chest_pain_nurse_adult_body" in str(m.get("name","")))["primitives"][0]["indices"])
pre_tris = set(map(tuple, pre_idx.reshape(-1,3).tolist()))
live_tris = set(map(tuple, live_idx.reshape(-1,3).tolist()))
moved_idx = sorted([i for i,t in enumerate(pre_idx.reshape(-1,3).tolist()) if tuple(t) not in live_tris])
print(json.dumps(moved_idx))
`),
    ) as number[];
    expect(moved.length, "moved set size for C5 conservation (SAFE'')").toBe(SAFE_IDS.length);
    const movedSet = new Set(moved);
    const cases = [
      { view: "front" as const, box: FRONT_BOX },
      { view: "three_quarter" as const, box: TQ_BOX },
    ];
    for (const { view, box } of cases) {
      const preS = await loadScene(pre, view);
      const liveS = await loadScene(GLB, view);
      const castPre = makeCaster(preS);
      const castLive = makeCaster(liveS);
      let preOutside = 0;
      let explained = 0;
      let explainedMiss = 0;
      for (let y = 0; y < 4096; y += C5_STRIDE) {
        for (let x = 0; x < 4096; x += C5_STRIDE) {
          if (inBox(x, y, box)) continue;
          const p = castPre(x, y);
          const l = castLive(x, y);
          const pBody = p?.body ?? false;
          const lBody = l?.body ?? false;
          if (pBody) preOutside++;
          const isExplained = pBody && p?.name === BODY0 && movedSet.has(p?.faceIndex ?? -1);
          if (isExplained) {
            explained++;
            if (l === null) explainedMiss++;
            expect(lBody, `${view} explained ray (${x},${y}) now non-body`).toBe(false);
          } else {
            expect(lBody, `${view} outside ray (${x},${y}) unchanged (pre ${p === null ? "miss" : pBody})`).toBe(pBody);
          }
        }
      }
      expect(preOutside, `${view} pre stride-${C5_STRIDE} body outside box in-run (anti-vacuity; explained ${explained})`).toBeGreaterThan(0);
      expect(explainedMiss, `${view} explained rays (${explained}) with new misses`).toBe(0);
    }
  }, 300_000);

  it("C7: full-frame backface-aware new see-through is 0", async () => {
    // The neck guard. R1 hid all 235 rule-flagged tris and passed C1-C5 +
    // CONTROL, but the native grade showed new see-through holes (throat
    // sawtooth, neck-V interior, sleeve hems): the old classifier counted
    // only hidden/background first hits, never back-facing body. This clause
    // replays the B1 simulator on the FULL frame at stride 16 (the coarsest
    // stride still RED on the R1 output 35925a3d — E6 sweep: 64 front + 31
    // three_quarter; GREEN 0/0) with prim8 transparent: pre skin-frontface
    // AND post (miss | any-hidden | backface-body) must be 0 in both capture
    // views. Dirs are computed in-test from the committed loadScene cameras
    // (sample-grade-poses stride loop); no E-dir or store file is read.
    expect(existsSync(GLB), `${GLB} exists`).toBe(true);
    const pre = writePreImageGlb();
    const dir = join(tmpdir(), `adult-nurse-chest-c7-${process.pid}`);
    const { gradeNorm, origins } = await writeStrideDirs(GLB, C7_STRIDE, dir);
    const py = `
import json, struct, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes"))})
from pathlib import Path
import numpy as np
import garment_coverage as gc
import backface_hide_select as sel
import importlib.util
_spec = importlib.util.spec_from_file_location("rehide", ${JSON.stringify(join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/rehide-poking-skin.py"))})
rehide = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(rehide)
S = np.array(${JSON.stringify(gradeNorm.scale)}, dtype=float)
OFF = np.array(${JSON.stringify(gradeNorm.position)}, dtype=float)
ORIG = {"front": np.array(${JSON.stringify(origins["front"])}, dtype=float),
        "three_quarter": np.array(${JSON.stringify(origins["three_quarter"])}, dtype=float)}
def load_all(path):
    doc, binary = rehide.read_glb(path)
    mats = [m.get("name","") for m in doc.get("materials",[])]
    out = []
    for m in doc.get("meshes",[]):
        for pi, p in enumerate(m.get("primitives",[])):
            v = np.asarray(rehide.decode(doc,binary,p["attributes"]["POSITION"]),dtype=float)*S+OFF
            f = np.asarray(rehide.decode(doc,binary,p["indices"]).reshape(-1),dtype=np.int64).reshape(-1,3)
            hid = str(mats[p["material"]]).startswith("openclinxr_hidden_")
            out.append({"mesh": str(m.get("name","")), "pi": pi, "V": v, "F": f,
                        "mat": mats[p["material"]],
                        "is_body": ("_body" in str(m.get("name",""))),
                        "is_shirt": ("scrub_shirt" in str(m.get("name",""))),
                        "is_prim8": (str(m.get("name","")).endswith("_body") and pi == 8 and hid)})
    return out
preG = load_all(${JSON.stringify(pre)})
liveG = load_all(${JSON.stringify(GLB)})
prim8 = [g for g in liveG if g["is_prim8"]]
assert len(prim8) == 1, f"live must have exactly one hidden prim8, found {len(prim8)}"
prim8 = prim8[0]
liveG_no8 = [g for g in liveG if not g["is_prim8"]]
PT = prim8["V"][prim8["F"]]
mn = PT.reshape(-1,3).min(axis=0); mx = PT.reshape(-1,3).max(axis=0)
NW = ${4096 / C7_STRIDE}; STRIDE = ${C7_STRIDE}
res = {}
import os
for view, fn in (("front", "dirs_front_s${C7_STRIDE}.bin"), ("three_quarter", "dirs_tq_s${C7_STRIDE}.bin")):
    D = np.fromfile(os.path.join(${JSON.stringify(dir)}, fn), dtype=np.float32).reshape(-1,3).astype(float)
    O = np.broadcast_to(ORIG[view], D.shape).copy()
    ent = sel.slab_enter(O, D, mn, mx)
    c0 = np.where(np.isfinite(ent))[0]
    tt, _ = gc._ray_tri_arghits(O[c0], D[c0], PT, 100.0)
    cand = c0[np.isfinite(tt)]
    Oc, Dc = O[cand], D[cand]
    pt, pc, pb, ptri, pwin, pback = sel.classify_full(preG, Oc, Dc)
    bt, bc, bb, btri, win, back = sel.classify_full(liveG_no8, Oc, Dc)
    pre_front = (pc == 1) & (~pback)
    post_hole = (bc == 0) | (bc == 4) | (bb & back)
    ns = pre_front & post_hole
    xs = ((cand[ns] % NW) * STRIDE); ys = ((cand[ns] // NW) * STRIDE)
    res[view] = {"n": int(ns.sum()), "cand": int(len(cand)),
      "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if int(ns.sum()) else None}
print(json.dumps(res))
`;
    const out = JSON.parse(pyOut(py)) as Record<
      string,
      { n: number; cand: number; bbox: [number, number, number, number] | null }
    >;
    // Anti-vacuity: the candidate set (rays touching the hidden set) must
    // be non-empty in both views, or the 0 below proves nothing.
    expect(out["front"]?.cand ?? 0, "front candidate rays touch the hidden set").toBeGreaterThan(0);
    expect(out["three_quarter"]?.cand ?? 0, "three_quarter candidate rays touch the hidden set").toBeGreaterThan(0);
    expect(
      { front: out["front"]?.n, frontBbox: out["front"]?.bbox ?? null, tq: out["three_quarter"]?.n, tqBbox: out["three_quarter"]?.bbox ?? null },
      "C7 full-frame stride-16 new see-through (front+tq) vs f6573124",
    ).toEqual({ front: 0, frontBbox: null, tq: 0, tqBbox: null });
  }, 300_000);
});
