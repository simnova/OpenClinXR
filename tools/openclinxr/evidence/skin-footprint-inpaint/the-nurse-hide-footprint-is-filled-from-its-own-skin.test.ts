import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * P2e-inpaint: the nurse hide-mask footprint is filled from the shipped skin's
 * own texels (cap27 ruling P2e-A, GO 2026-11-13).
 *
 * The shipped nurse skin baseColor (image sha 1a9e179b, unchanged since
 * 86cb10ea1) holds (0,0,0) over the hide-mask UV footprint (footprintBlackFrac
 * 0.926). A fresh producer bake is a different skin (phase 1: off-footprint
 * mean delta 18/43/46, store st-teeth/p2e-probe1), so the fill must come from
 * the shipped texture's own texels: per-island cv2 Telea inpainting.
 *
 * Custody (A1.4/A1.5/A1.6): this test reads no store paths. The pre-E9
 * footprint is a committed fixture (rasterized 1024x1024 mask PNG + provenance
 * JSON); every baseline below is a pinned constant derived once from
 * c1da76fb4. The only git touch is the (lin) re-execution and the in-test
 * stage-1 derivation, which read the c1da76fb4 git object (present on a
 * clean clone) into os.tmpdir() files — no skipIf, no machine-local path.
 *
 * NOT TESTED:
 * - Whether the fill reads as natural skin to a grader (cap27 grades stills).
 * - Quest/WebXR rendering of the installed GLB.
 * - Anything outside the nurse GLB, its sidecar, and the 8 listed STALE GLBs.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const TOOL = join(HERE, "inpaint_hide_footprint.py");
const FIXTURE_MASK = join(HERE, "fixtures", "pre-e9-footprint-mask.png");
const FIXTURE_PROV = join(HERE, "fixtures", "pre-e9-footprint-mask.provenance.json");
const NURSE_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const NURSE_PROV = join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.provenance.json",
);

// --- Pinned constants, derived once from c1da76fb4 (see provenance comments) ---

// Footprint mask PNG sha256. Provenance: derive-fixture rasterization of the
// TEXCOORD_0 of the 7 openclinxr_hidden_ prims (4511 tris) of the pre-E9 nurse
// GLB (sourceRevision 0ad5234d0d4883ca38346356ae3c16670e8eea1b via
// `git rev-parse 0ad5234d0`, GLB sha f6573124...); byte-identical to the A2
// script's --out-mask output over the same bytes. Exact command pinned in
// fixtures/pre-e9-footprint-mask.provenance.json derivationCommand.
const MASK_SHA = "71f07b0508d4a90f23054dedd16d4eda007a12e5456f75ca7bd5aeb1348c5724";
// Footprint texel count. Provenance: derive-fixture stdout footprintTexels on
// the pre-E9 GLB sha f6573124437c4f170643ad33d2f922bb66a069fcc58bcf3bbeef8b9a8da2833c
// (same command as MASK_SHA above).
const FOOTPRINT_TEXELS = 200412;
// Footprint-bearing islands + island count. Provenance: tool measure subcommand
// `mise exec -- python3 -I tools/openclinxr/evidence/skin-footprint-inpaint/inpaint_hide_footprint.py measure --glb apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb --footprint-mask <fixture>`
// on the installed GLB sha 9d05524dc2d5252850a07cdc8004e9468bcff9c8c27c1eda712b2fc4c646911a.
const ISLANDS_TOUCHED = [1, 7, 8];
const ISLAND_COUNT = 9;

// A1.1 SEAM bound B_c: p95 of the SHIPPED c1da76fb4 skin texture's own
// 4-neighbour |delta| per channel, over non-footprint skin texels of the
// islands that contain footprint texels. Measured with the tool's own
// measure subcommand (`mise exec -- python3 -I <TOOL> measure --glb
// /tmp/nurse-c1da76fb4.glb --footprint-mask <fixture>`, pre-image GLB sha
// 8957543dfc9f0fcacafd942c432f12947dd00d8f370ba3c519f6cb8ff9b1be86,
// image sha 1a9e179b) on 418108 unordered right+down pairs (both endpoints
// non-footprint in islands 1/7/8):
// R p95 7.0 / G p95 7.0 / B p95 6.0.
const BC = { r: 7.0, g: 7.0, b: 6.0 } as const;
// SEAM_PAIRS: crossing-boundary unordered 4-neighbour pairs in the installed
// texture (GLB sha 9d05524dc2d5252850a07cdc8004e9468bcff9c8c27c1eda712b2fc4c646911a,
// same measure command on the installed GLB). All four orientations:
// horizontal (x,x+1) covers left->right and right->left, vertical covers
// up->down and down->up, exactly one endpoint in footprint, same non-zero
// island. Was 4393 under the 2-orientation count; 8808 after the fix.
const SEAM_PAIRS = 8808;

// A1.2 VARIANCE: luma (0.299R+0.587G+0.114B) stddev in 5x5 windows
// (cv2.blur). Shipped c1da76fb4 medians (pre-image GLB sha 8957543d...,
// image sha 1a9e179b; same measure subcommand on /tmp/nurse-c1da76fb4.glb)
// over non-footprint skin texels of the footprint-bearing islands:
// global 2.577411; island 1: 2.570385 (n 200819);
// island 7: 2.719765 (n 5771); island 8: 2.769484 (n 5761).
// min(per-island)/global = 0.997274 >= 0.25, so the bound stays 0.25 anyway.
const VARIANCE_BOUND = 0.25;

// (a2) baseline: sha256 of the before image's off-footprint texels with the
// footprint zeroed, raw RGBA row-major (alpha 255). Derived from the decoded
// c1da76fb4 skin PNG (image idx 2 of pre-image GLB sha 8957543d...) via the
// tool's own measure subcommand (`measure --glb /tmp/nurse-c1da76fb4.glb
// --footprint-mask <fixture>` -> offFootprintHash).
const OFFFP_HASH = "f627007e719a1e4f8ad824a3eed014ac369eb3f7305aad586bc083c091b9c8b5";
// Skin image identity (unchanged by the tool): 1024x1024 RGB PNG, tex 1, sampler 0.
// Provenance: tool measure subcommand skin{} on the c1da76fb4 GLB sha 8957543d...
// (identical in the installed GLB sha 9d05524d... per the (a2) clause).
const SKIN = { W: 1024, H: 1024, mime: "image/png", sampler: 0, texIdx: 1, imgIdx: 2, matIdx: 4 } as const;
// (a3) baselines: raw bytes sha256 of every non-skin image (by index), the
// accessor-data hash (dense bytes per accessor in index order, NOVIEW marker
// for morph-target accessors without a bufferView, plus sparse indices/values
// bytes), and the JSON-shape hash (buffers/bufferViews byte offsets/lengths
// redacted to 0, sort_keys). All derived from c1da76fb4 GLB bytes (sha
// 8957543dfc9f0fcacafd942c432f12947dd00d8f370ba3c519f6cb8ff9b1be86) via the
// tool's own measure subcommand (`measure --glb /tmp/nurse-c1da76fb4.glb
// --footprint-mask <fixture>` -> images[] / accessorDataHash / jsonShapeHash).
const IMAGE_SHAS: Record<number, string> = {
  0: "fa20149c846d9cb9d4837363f82dac87892efed7a152bbf966566f623062da4b",
  1: "ce591124e61168847d4235ce59c23fc3b7618190eb90559b492633e0b4c64c1a",
  3: "572ddc93ab3e177100619ec7c00b2574540cfb382805afc2e450788117f6140c",
  4: "ee4e93829033f9393c441171738fa0d119d3ad58ffaeb5a708ffd7f134e2bf40",
  5: "0d7f18ff1c6d8129b1f919e9ee0832fcf15e2d7b2a77df803e67c449d99faa5d",
  6: "d0afb57869c6fbb56b98f5efc4aec629ee7593e70d8dd2bfb9de923acfb65f43",
  7: "3150be398e48e8ba1feac164c3143c16c0b2e959d9ffb6155f0171f59cfb4ea9",
};
// p2e-c-prod M5: pins re-measured on the installed ce10321833f92c GLB (6-tri
// set: hidden prim7 trimmed + ONE skin prim9 appended, moved==6; values from
// the tool measure subcommand on the installed GLB). Supersedes the 77-face
// 63e79aa3 pins (afb88b28/a9d361b2, prims 9,10,11 appended).
const ACCESSOR_HASH = "ef2c9cbcc7b473700bde085042543f3fe2bd97aa931fc189591bb5fe72b4a3cd"; // index accessors: hidden prim7 trimmed + 1 appended skin prim9 (moved==6).
const JSONSHAPE_HASH = "80fd1eff251ba0ec77f9330e13b12a421d005a1506f623fe3b7e75116dc778cd"; // JSON shape changed by the trimmed prim7 + appended prim9 accessors/bufferViews.
// (d) baselines: the 8 other STALE GLBs at c1da76fb4 (WT files, unmodified).
// Provenance: `git show c1da76fb4:<path> | sha256sum` per file (commit
// c1da76fb45ea04b3875e4a748211b679b447355c).
const GLB_SHAS: Record<string, string> = {
  "mpfb-clinical-physician-adult.glb":
    "8c3ab05cf2da84c5af223bc16219bc6ac14c2701acc3e50eb674b9a4e26c878f",
  "mpfb-family-partner-adult.glb":
    "1fd58873ddba9519d442396635bd2d91a08c8b4b63606b186ecc56a9c0f5cb8b",
  "mpfb-gown-adult-patient.glb":
    "107d7ec951744032298b5e4fafd1d14b33f4860538fe1480968db02678014864",
  "mpfb-gown-ed-robert-hayes.glb":
    "4707db8662d8de790370efaf3356b41780f5ee0b880470ef496d70b82f79a27e",
  "mpfb-gown-inspect.glb":
    "ba8f7ad538510baa9fdd328f1afbbda9eb243ba224c72fca324dd7c771451d91",
  "mpfb-peds-nurse-kevin.glb":
    "0e610fe7fda86626526513d146f0fe87a6d718248f1f98be1855069100de3444",
  "mpfb-peds-patient-child.glb":
    "1e90c396b7eeba779fa33be9ebfffef3a76f4b15c28b1f63b7e85656be4f980b",
  "mpfb-viseme-inspect.glb":
    "b517b416dca5f0921d4be8224560ed07bdab9e7cc2e4009d9b0b654e3007ece0",
};
// (lin) baseline: the pre-image the derivation runs on. Provenance:
// `git show c1da76fb4:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb | sha256sum`
// (commit c1da76fb45ea04b3875e4a748211b679b447355c).
// p2e-unhide5b M5: pre-image moved 8957543d -> 9d05524d (new lineage level: the un-hide derivation ran on 9d05524d).
const PREIMAGE_SHA = "9d05524dc2d5252850a07cdc8004e9468bcff9c8c27c1eda712b2fc4c646911a";
// Cap27 bounds: installed footprint black fraction <= 0.05; shipped STALE
// 0.9259675069357124 (tool measure on the c1da76fb4 GLB sha 8957543d...;
// agrees with the A2 script UNCHANGED on the same bytes modulo the 8-prim vs
// 7-prim footprint, see (a-A2)); known-good planted 0.0; A2 threshold T 0.463
// (midpoint, store st-teeth/skin-audit-2/control.md).
const BLACK_MAX = 0.05;
const SHIPPED_BLACKFRAC = 0.9259675069357124;
// P4 plant colour: median RGB of the body skin region (non-footprint texels
// with max(R,G,B)>8) of the shipped skin texture (image sha 1a9e179b, c1da76fb4
// GLB sha 8957543d...). Provenance: store st-teeth/skin-audit-2/control.md
// "Known-CURRENT control" plant.
const MEDIAN_SKIN = [186, 163, 150] as const;
// Fixture provenance pins (A1.4 custody): the pre-E9 revision the mask was
// rasterized from, and the exact executable derivation command (no
// placeholders). Provenance: `git rev-parse 0ad5234d0` -> sourceRevision;
// the command re-run from the repo root reproduces mask sha 71f07b05...
// byte-identical (verified p2e-r1).
const FIXTURE_SOURCE_REVISION = "0ad5234d0d4883ca38346356ae3c16670e8eea1b";
const FIXTURE_DERIVATION_COMMAND =
  "sh -c 'git show 0ad5234d0d4883ca38346356ae3c16670e8eea1b:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb > /tmp/p2e-pre-e9-0ad5234d0.glb && mise exec -- python3 -I tools/openclinxr/evidence/skin-footprint-inpaint/inpaint_hide_footprint.py derive-fixture --footprint-glb /tmp/p2e-pre-e9-0ad5234d0.glb --out-mask tools/openclinxr/evidence/skin-footprint-inpaint/fixtures/pre-e9-footprint-mask.png'";

type Measure = {
  footprintTexels: number;
  footprintBlackFrac: number;
  islandsTouched: number[];
  islandCount: number;
  offFootprintHash: string;
  seam: Record<string, number>;
  ownDeltaP95: Record<string, number>;
  variance: {
    filledMedian: number;
    nonFootprintMedian: number;
    ratio: number;
    perIslandNonFootprintMedian: Record<string, { median: number; texels: number }>;
  };
  skin: { W: number; H: number; mimeType: string; sampler: number; texIdx: number; imgIdx: number };
  images: { idx: number; name: string; mimeType: string; sha256: string }[];
  accessorDataHash: string;
  jsonShapeHash: string;
  cv2: { version: string; licence: string };
};

function py(args: string[]): string {
  return execFileSync("mise", ["exec", "--", "python3", "-I", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function measure(glb: string, mask = FIXTURE_MASK): Measure {
  return JSON.parse(py([TOOL, "measure", "--glb", glb, "--footprint-mask", mask]));
}

function measureImage(glb: string, png: string, mask = FIXTURE_MASK): Measure {
  return JSON.parse(py([TOOL, "measure-image", "--glb", glb, "--in-png", png, "--footprint-mask", mask]));
}

function shaFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Python helper that imports the tool module (no subprocess per call) to
// build plant PNGs. Prints the output path.
const PLANT_PRELUDE = `
import importlib.util, sys
_spec = importlib.util.spec_from_file_location("inpaint_tool", ${JSON.stringify(TOOL)});
_tool = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_tool)
import numpy as np
from PIL import Image
`;

let M: Measure;

describe("the nurse hide-mask footprint is filled from its own skin", () => {
  it("fixture: the committed footprint mask pins the pre-E9 hide set", () => {
    expect(existsSync(FIXTURE_MASK)).toBe(true);
    expect(existsSync(FIXTURE_PROV)).toBe(true);
    expect(shaFile(FIXTURE_MASK)).toBe(MASK_SHA);
    const prov = JSON.parse(readFileSync(FIXTURE_PROV, "utf8"));
    expect(prov.maskSha256).toBe(MASK_SHA);
    expect(prov.sourceGlbSha256).toBe("f6573124437c4f170643ad33d2f922bb66a069fcc58bcf3bbeef8b9a8da2833c");
    expect(prov.sourceRevision).toBe(FIXTURE_SOURCE_REVISION);
    expect(prov.derivationCommand).toBe(FIXTURE_DERIVATION_COMMAND);
    expect(prov.hiddenPrimCount).toBe(7);
    expect(prov.hiddenTriCount).toBe(4511);
    expect(prov.footprintTexels).toBe(FOOTPRINT_TEXELS);
  });

  it("measures the installed GLB with the tool", () => {
    M = measure(NURSE_GLB);
    expect(M.footprintTexels).toBe(FOOTPRINT_TEXELS);
    expect(M.islandsTouched).toEqual(ISLANDS_TOUCHED);
    expect(M.islandCount).toBe(ISLAND_COUNT);
    expect(M.cv2.version).toBe("5.0.0");
    expect(M.cv2.licence).toContain("Apache");
    console.log(`blackfrac=${M.footprintBlackFrac} texels=${M.footprintTexels} islands=${M.islandsTouched}`);
  }, 300_000);

  it("(a) footprint black fraction <= 0.05 (shipped STALE 0.926, T 0.463, known-good 0.0)", () => {
    console.log(`(a) before=${SHIPPED_BLACKFRAC} after=${M.footprintBlackFrac}`);
    expect(M.footprintBlackFrac).toBeLessThanOrEqual(BLACK_MAX);
  });

  it("(a2) off-footprint texels byte-identical; image size, mime and sampler unchanged", () => {
    expect(M.offFootprintHash).toBe(OFFFP_HASH);
    expect(M.skin.W).toBe(SKIN.W);
    expect(M.skin.H).toBe(SKIN.H);
    expect(M.skin.mimeType).toBe(SKIN.mime);
    expect(M.skin.sampler).toBe(SKIN.sampler);
    expect(M.skin.texIdx).toBe(SKIN.texIdx);
    expect(M.skin.imgIdx).toBe(SKIN.imgIdx);
  });

  it("(a3) other images, accessor bytes and JSON shape unchanged", () => {
    for (const img of M.images) {
      if (img.idx === SKIN.imgIdx) continue;
      expect(img.sha256).toBe(IMAGE_SHAS[img.idx]);
    }
    expect(M.accessorDataHash).toBe(ACCESSOR_HASH);
    expect(M.jsonShapeHash).toBe(JSONSHAPE_HASH);
  });

  // P2e-C M5 T4: the inpaint check — footprint texels afterBlackFrac == 0
  // (the P2e-A fill; inpaint-report.json afterBlackFrac 0.0). (a) allows
  // <= 0.05; T4 pins the exact zero the chain reproduces.
  it("T4: footprint black fraction is exactly 0 (P2e-A fill, not a threshold pass)", () => {
    const t4 = measure(NURSE_GLB);
    console.log(`T4 footprintBlackFrac=${t4.footprintBlackFrac} texels=${t4.footprintTexels}`);
    expect(t4.footprintTexels).toBe(FOOTPRINT_TEXELS);
    expect(t4.footprintBlackFrac).toBe(0);
  }, 300_000);

  // P2e-C M5 T2/T3 shared helper: position-key map of the live body mesh.
  // The tool's poskey (nurse-vneck-6tri-unhide.py): row-lexsort float32
  // vertex bytes, hex. Index-only stages keep POSITION byte-equal
  // pre<->live, so keys match across stages exactly.
  const GLB_KEYMAP_PY = `
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
    ncomp = {"SCALAR":1,"VEC2":2,"VEC3":3}[a["type"]]
    size = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a["componentType"]]
    dt = {1:np.int8,2:np.int16,4:np.float32,8:np.float64}[size] if a["componentType"] not in (5123,5125) else (np.uint16 if a["componentType"]==5123 else np.uint32)
    stride = v.get("byteStride")
    if stride is None or stride == ncomp*size:
        return np.frombuffer(binary, dtype=np.dtype(dt), count=n*ncomp, offset=base).reshape(n,ncomp)
    raw2 = np.frombuffer(binary, dtype=np.uint8, count=n*stride, offset=base).reshape(n,stride)
    out = np.empty((n,ncomp), dtype=np.float64)
    for c in range(ncomp):
        out[:,c] = raw2[:,c*size:(c+1)*size].copy().view(np.dtype(dt)).reshape(n)
    return out
def poskey(verts):
    a = np.ascontiguousarray(np.asarray(verts, dtype="<f4"))
    return a[np.lexsort((a[:, 2], a[:, 1], a[:, 0]))].tobytes().hex()
`;
  const SIXTRI_FIXTURE = join(HERE, "fixtures", "nurse-vneck-6tri.json");
  const POKE_FIXTURE = join(HERE, "fixtures", "nurse-former-poke-faces.json");
  const UNHIDE_TOOL = join(HERE, "scripts", "nurse-vneck-6tri-unhide.py");

  // P2e-C M5 T2: the shipped un-hide set has size == 6 and equals the
  // recorded keys (refuses a widened un-hide; known failure: the 77-face
  // set of 43e4423e1 and the 198-tri selector both made slivers).
  it("T2: shipped un-hide set is exactly the 6 recorded keys in a skin prim", () => {
    const fix = JSON.parse(readFileSync(SIXTRI_FIXTURE, "utf8")) as {
      faces: { prim: number; tri: number; key: string }[];
    };
    expect(fix.faces.map((f) => f.tri).sort((a, b) => a - b), "fixture wanted tris").toEqual([2, 3, 4, 5, 6, 53]);
    expect(fix.faces, "fixture has exactly 6 faces").toHaveLength(6);
    const wanted = fix.faces.map((f) => f.key);
    expect(new Set(wanted).size, "6 distinct keys").toBe(6);
    const out = JSON.parse(
      py([
        "-c",
        `${GLB_KEYMAP_PY}
_doc, _bin = read_glb(${JSON.stringify(NURSE_GLB)})
_mats = [m.get("name","") for m in _doc.get("materials",[])]
_body = next(m for m in _doc.get("meshes",[]) if str(m.get("name","")).endswith("_body"))
_loc = {}
for _pi, _p in enumerate(_body["primitives"]):
    _pos = dec(_doc, _bin, _p["attributes"]["POSITION"]).astype(float)
    _idx = np.asarray(dec(_doc, _bin, _p["indices"]).reshape(-1), dtype=np.int64).reshape(-1,3)
    _mat = _mats[_p["material"]]
    for _t in _idx.tolist():
        _loc[poskey(_pos[np.asarray(_t)].tolist())] = {"prim": _pi, "mat": _mat}
_wanted = json.load(open(${JSON.stringify(SIXTRI_FIXTURE)}))["faces"]
_got = [{"tri": _e["tri"], "loc": _loc.get(_e["key"])} for _e in _wanted]
print(json.dumps({"got": _got, "prims": len(_body["primitives"])}))`,
      ]),
    ) as { got: { tri: number; loc: { prim: number; mat: string } | undefined }[]; prims: number };
    for (const g of out.got) {
      expect(g.loc, `tri ${g.tri} present in shipped GLB`).toBeTruthy();
      expect(g.loc!.mat.includes("mpfb_skin"), `tri ${g.tri} in skin material (got ${g.loc!.mat})`).toBe(true);
      expect(g.loc!.mat.startsWith("openclinxr_hidden_"), `tri ${g.tri} not hidden`).toBe(false);
      expect(g.loc!.prim, `tri ${g.tri} in appended skin prim9`).toBe(9);
    }
    console.log(`T2 6/6 keys in skin prim9, body prims=${out.prims}`);
  }, 300_000);

  // P2e-C M5 T3: the 19 fixture faces (former pokes/slivers) remain hidden
  // in the shipped GLB.
  it("T3: the 19 former-poke faces stay hidden in the shipped GLB", () => {
    const out = JSON.parse(
      py([
        "-c",
        `${GLB_KEYMAP_PY}
_doc, _bin = read_glb(${JSON.stringify(NURSE_GLB)})
_mats = [m.get("name","") for m in _doc.get("materials",[])]
_body = next(m for m in _doc.get("meshes",[]) if str(m.get("name","")).endswith("_body"))
_loc = {}
for _pi, _p in enumerate(_body["primitives"]):
    _pos = dec(_doc, _bin, _p["attributes"]["POSITION"]).astype(float)
    _idx = np.asarray(dec(_doc, _bin, _p["indices"]).reshape(-1), dtype=np.int64).reshape(-1,3)
    _mat = _mats[_p["material"]]
    for _t in _idx.tolist():
        _loc[poskey(_pos[np.asarray(_t)].tolist())] = {"prim": _pi, "mat": _mat}
_poke = json.load(open(${JSON.stringify(POKE_FIXTURE)}))["faces"]
_res = []
for _e in _poke:
    _k = poskey(_e["positions"])
    _l = _loc.get(_k)
    _res.append({"prim": _e["prim"], "tri": _e["tri"], "found": _l is not None, "hidden": bool(_l) and str(_l["mat"]).startswith("openclinxr_hidden_"), "livePrim": _l["prim"] if _l else None})
print(json.dumps({"faces": _res, "n": len(_res)}))`,
      ]),
    ) as { faces: { prim: number; tri: number; found: boolean; hidden: boolean; livePrim: number | null }[]; n: number };
    expect(out.n, "poke fixture has 19 faces").toBe(19);
    for (const f of out.faces) {
      expect(f.found, `poke prim${f.prim} tri ${f.tri} present in shipped GLB`).toBe(true);
      expect(f.hidden, `poke prim${f.prim} tri ${f.tri} still hidden (live prim${f.livePrim})`).toBe(true);
    }
    console.log(`T3 19/19 poke faces hidden in shipped GLB`);
  }, 300_000);

  // P2e-C M5 destructive probe per T2/T3 (clean-clone safe, no skipIf, F5):
  // the 9d05524d stage-1 output is DERIVED in-test from the c1da76fb4 git
  // revision via the tracked inpaint stage (sha-verified against the pin),
  // written only under os.tmpdir(), so the widened-set probe runs on a
  // clean clone. Widen the un-hide list by one poke face -> the tool
  // refuses (red); revert to the recorded 6 -> exit 0, moved==6, output
  // sha == installed (green). Prints the substitution.
  const PRE_C1DA_REV = "c1da76fb4:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb";
  const PREIMAGE_C1DA_SHA = "8957543dfc9f0fcacafd942c432f12947dd00d8f370ba3c519f6cb8ff9b1be86";
  let cachedPre9: string | null = null;
  function pre9d05524d(): string {
    if (cachedPre9 !== null) return cachedPre9;
    const dir = mkdtempSync(join(tmpdir(), "p2e-pre9-"));
    const preC1 = join(dir, "pre-c1da.glb");
    writeFileSync(
      preC1,
      execFileSync("git", ["show", PRE_C1DA_REV], { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 }),
    );
    expect(shaFile(preC1), "c1da76fb4 bytes pin the 8957543d pre-image").toBe(PREIMAGE_C1DA_SHA);
    const pre = join(dir, "pre.glb");
    execFileSync(
      "mise",
      ["exec", "--", "python3", "-I", TOOL, "--in", preC1, "--out", pre, "--footprint-mask", FIXTURE_MASK, "--report", join(dir, "stage1.json")],
      { cwd: REPO_ROOT, stdio: "pipe" },
    );
    expect(shaFile(pre), "derived stage-1 output pins the 9d05524d pre-image").toBe(PREIMAGE_SHA);
    cachedPre9 = pre;
    return pre;
  }
  it("T2/T3 probe: widened un-hide list refused, recorded 6 re-executes", () => {
    const prov = JSON.parse(readFileSync(NURSE_PROV, "utf8")) as {
      outputSha256: string;
    };
    const pre = pre9d05524d();
    const poke = JSON.parse(readFileSync(POKE_FIXTURE, "utf8")) as {
      faces: { prim: number; tri: number; positions: number[][]; material: string }[];
    };
    const added = poke.faces[0]!;
    const six = JSON.parse(readFileSync(SIXTRI_FIXTURE, "utf8")) as {
      faces: { prim: number; tri: number; key: string }[];
    };
    const widened = {
      ...JSON.parse(readFileSync(SIXTRI_FIXTURE, "utf8")),
      faces: [
        ...six.faces,
        { prim: added.prim, tri: added.tri, material: added.material, positions: added.positions, key: "probe-added" },
      ],
    };
    const work = mkdtempSync(join(tmpdir(), "p2e-probe-"));
    const widePath = join(work, "wide.json");
    writeFileSync(widePath, JSON.stringify(widened));
    console.log(
      `probe substitution: before=[${six.faces.map((f) => `prim7:${f.tri}`).join(",")}] after=before+[prim${added.prim}:${added.tri}]`,
    );
    const red = spawnSync(
      "mise",
      ["exec", "--", "python3", "-I", UNHIDE_TOOL, "--in", pre, "--out", join(work, "wide.glb"), "--faces-from", widePath, "--report", join(work, "wide.json.report")],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    console.log(`probe red exit=${red.status} out=${((red.stdout as string) ?? "").trim().slice(0, 160)}`);
    expect(red.status, "widened (7-face) un-hide list refused").not.toBe(0);
    expect(`${red.stdout ?? ""}${red.stderr ?? ""}`).toContain("fixture is not exactly the 6 T tris");
    // Revert -> green: the recorded 6 re-executes byte-identical.
    const outGlb = join(work, "out.glb");
    const repPath = join(work, "report.json");
    execFileSync("mise", ["exec", "--", "python3", "-I", UNHIDE_TOOL, "--in", pre, "--out", outGlb, "--faces-from", SIXTRI_FIXTURE, "--report", repPath], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    const rep = JSON.parse(readFileSync(repPath, "utf8")) as { movedCount: number; outputSha256: string };
    expect(rep.movedCount, "reverted un-hide moves exactly 6").toBe(6);
    expect(rep.outputSha256, "reverted un-hide reproduces installed sha").toBe(prov.outputSha256);
    expect(shaFile(outGlb), "reverted un-hide output == installed GLB").toBe(shaFile(NURSE_GLB));
    console.log(`probe green: moved==6 sha=${rep.outputSha256.slice(0, 12)} == installed`);
  }, 300_000);

  it("T2b (F2): a coordinate-permuted tri refuses with position-key mismatch", () => {
    // The old per-column key was blind to coordinate permutations across
    // vertices; the row-lexsort key is not. Tamper the derived 9d05524d
    // pre-image by rotating y/z across tri 2's vertices (column multisets
    // unchanged, rows changed): the old key still matches, the new key
    // differs, and the tool refuses the tampered input. Prints all three.
    const pre = pre9d05524d();
    const work = mkdtempSync(join(tmpdir(), "p2e-t2b-"));
    const tampered = join(work, "tampered.glb");
    const keys = JSON.parse(
      py([
        "-c",
        `import json, struct, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes"))})
from pathlib import Path
import numpy as np
from glb_index_io import read_glb, decode, write_glb
def oldkey(verts):
    return np.sort(np.ascontiguousarray(np.asarray(verts, dtype="<f4")), axis=0).tobytes().hex()
def newkey(verts):
    a = np.ascontiguousarray(np.asarray(verts, dtype="<f4"))
    return a[np.lexsort((a[:, 2], a[:, 1], a[:, 0]))].tobytes().hex()
_doc, _bin = read_glb(${JSON.stringify(pre)})
_body = next(m for m in _doc.get("meshes", []) if str(m.get("name", "")).endswith("_body"))
_prim = _body["primitives"][7]
_acc = _doc["accessors"][_prim["attributes"]["POSITION"]]
_view = _doc["bufferViews"][_acc["bufferView"]]
assert _acc["componentType"] == 5126 and _acc["type"] == "VEC3", "POSITION must be float VEC3"
_stride = _view.get("byteStride", 12)
_base = _view.get("byteOffset", 0) + _acc.get("byteOffset", 0)
_idx = np.asarray(decode(_doc, _bin, _prim["indices"]).reshape(-1), dtype=np.int64).reshape(-1, 3)
_vids = _idx[2].tolist()
_rows = [struct.unpack_from("<3f", _bin, _base + vi * _stride) for vi in _vids]
_perm = [(_rows[0][0], _rows[1][1], _rows[2][2]), (_rows[1][0], _rows[2][1], _rows[0][2]), (_rows[2][0], _rows[0][1], _rows[1][2])]
_buf = bytearray(_bin)
for _vi, _pr in zip(_vids, _perm):
    struct.pack_into("<3f", _buf, _base + _vi * _stride, *_pr)
write_glb(${JSON.stringify(tampered)}, _doc, bytes(_buf))
print(json.dumps({"oldEqual": oldkey(_rows) == oldkey(_perm), "newDiffer": newkey(_rows) != newkey(_perm),
  "oldKey": oldkey(_rows)[:16], "newKey": newkey(_rows)[:16], "permKey": newkey(_perm)[:16]}))`,
      ]),
    ) as { oldEqual: boolean; newDiffer: boolean; oldKey: string; newKey: string; permKey: string };
    console.log(`T2b permuted tri2: oldEqual=${keys.oldEqual} newDiffer=${keys.newDiffer} old=${keys.oldKey} new=${keys.newKey} perm=${keys.permKey}`);
    expect(keys.oldEqual, "old per-column key is blind to the permutation").toBe(true);
    expect(keys.newDiffer, "new row-lexsort key distinguishes the permutation").toBe(true);
    const red = spawnSync(
      "mise",
      ["exec", "--", "python3", "-I", UNHIDE_TOOL, "--in", tampered, "--out", join(work, "t2b.glb"), "--faces-from", SIXTRI_FIXTURE, "--report", join(work, "t2b.json")],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    console.log(`T2b tool red exit=${red.status} out=${((red.stdout as string) ?? "").trim().slice(0, 160)}`);
    expect(red.status, "permuted-coordinate tri refused").not.toBe(0);
    expect(`${red.stdout ?? ""}${red.stderr ?? ""}`).toContain("position-key mismatch");
  }, 300_000);

  // P2e-C T-delta (F4): the COMPLETE hidden->skin delta between the c1da76fb4
  // pre-image (git object, os.tmpdir() only) and the live GLB is exactly the
  // 6 recorded keys. An output that un-hides the required six plus a seventh
  // hidden tri outside the 19-face counterweight passes T2+T3 but fails here.
  function hiddenSkinDelta(preGlb: string, liveGlb: string): { delta: string[]; preKeys: number; liveKeys: number } {
    return JSON.parse(
      py([
        "-c",
        `${GLB_KEYMAP_PY}
def _keymap(_glb):
    _doc, _bin = read_glb(_glb)
    _mats = [m.get("name", "") for m in _doc.get("materials", [])]
    _body = next(m for m in _doc.get("meshes", []) if str(m.get("name", "")).endswith("_body"))
    _loc = {}
    for _pi, _p in enumerate(_body["primitives"]):
        _pos = dec(_doc, _bin, _p["attributes"]["POSITION"]).astype(float)
        _idx = np.asarray(dec(_doc, _bin, _p["indices"]).reshape(-1), dtype=np.int64).reshape(-1, 3)
        _mat = _mats[_p["material"]]
        for _t in _idx.tolist():
            _loc[poskey(_pos[np.asarray(_t)].tolist())] = {"prim": _pi, "mat": _mat}
    return _loc
_pre = _keymap(${JSON.stringify(preGlb)})
_live = _keymap(${JSON.stringify(liveGlb)})
_delta = sorted(k for k, v in _pre.items()
  if v["mat"].startswith("openclinxr_hidden_") and k in _live
  and "mpfb_skin" in _live[k]["mat"] and not _live[k]["mat"].startswith("openclinxr_hidden_"))
print(json.dumps({"delta": _delta, "preKeys": len(_pre), "liveKeys": len(_live)}))`,
      ]),
    ) as { delta: string[]; preKeys: number; liveKeys: number };
  }
  function preC1da(): string {
    const dir = mkdtempSync(join(tmpdir(), "p2e-prec1-"));
    const p = join(dir, "pre-c1da.glb");
    writeFileSync(p, execFileSync("git", ["show", PRE_C1DA_REV], { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 }));
    expect(shaFile(p), "c1da76fb4 bytes pin the 8957543d pre-image").toBe(PREIMAGE_C1DA_SHA);
    return p;
  }
  it("T-delta: hidden->skin delta from the c1da76fb4 pre-image is exactly the 6 keys", () => {
    const pre = preC1da();
    const six = (JSON.parse(readFileSync(SIXTRI_FIXTURE, "utf8")) as { faces: { key: string }[] }).faces.map((f) => f.key).sort();
    const { delta, preKeys, liveKeys } = hiddenSkinDelta(pre, NURSE_GLB);
    console.log(`T-delta pre=${preKeys} live=${liveKeys} delta=${delta.length} keys=${delta.map((k) => k.slice(0, 8)).join(",")}`);
    expect(delta, "complete hidden->skin delta is exactly the 6 recorded keys").toEqual(six);
  }, 300_000);

  it("T-delta probe: a 7th un-hidden tri outside the 19 goes red", () => {
    // Build a probe GLB from the live bytes with one extra hidden tri
    // (live prim7 tri 0) appended to skin, then show the delta is 7 keys.
    const six = (JSON.parse(readFileSync(SIXTRI_FIXTURE, "utf8")) as { faces: { key: string }[] }).faces.map((f) => f.key);
    const sixSet = new Set(six);
    const poke = JSON.parse(readFileSync(POKE_FIXTURE, "utf8")) as { faces: { positions: number[][] }[] };
    const work = mkdtempSync(join(tmpdir(), "p2e-tdelta-"));
    const probeGlb = join(work, "probe-7th.glb");
    const info = JSON.parse(
      py([
        "-c",
        `import json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes"))})
from pathlib import Path
import numpy as np, copy
from glb_index_io import read_glb, write_glb, decode, append_index_arrays, HIDDEN_PREFIX
_live = ${JSON.stringify(NURSE_GLB)}
doc, binary = read_glb(_live)
mats = [m.get("name", "") for m in doc.get("materials", [])]
body = next(m for m in doc.get("meshes", []) if str(m.get("name", "")).endswith("_body"))
prims = body["primitives"]
prim7 = prims[7]
assert mats[prim7["material"]].startswith(HIDDEN_PREFIX), "prim7 must be hidden"
skin_idx = next(i for i, p in enumerate(prims) if "mpfb_skin" in mats[p["material"]] and not mats[p["material"]].startswith(HIDDEN_PREFIX))
v = decode(doc, binary, prim7["attributes"]["POSITION"]).astype(float)
idx = np.asarray(decode(doc, binary, prim7["indices"]).reshape(-1), dtype=np.int64).reshape(-1, 3)
extra = idx[0]
rest = idx[1:]
def newkey(verts):
    a = np.ascontiguousarray(np.asarray(verts, dtype="<f4"))
    return a[np.lexsort((a[:, 2], a[:, 1], a[:, 0]))].tobytes().hex()
extra_key = newkey(v[extra].tolist())
poke_keys = set()
for f in ${JSON.stringify(poke)}.get("faces", []):
    a = np.ascontiguousarray(np.asarray(f["positions"], dtype="<f4"))
    poke_keys.add(a[np.lexsort((a[:, 2], a[:, 1], a[:, 0]))].tobytes().hex())
out_doc = copy.deepcopy(doc)
out_bin = bytearray(binary)
out_body = next(m for m in out_doc["meshes"] if m.get("name") == body.get("name"))
src_ctype = doc["accessors"][prim7["indices"]]["componentType"]
new_acc = append_index_arrays(out_doc, out_bin, {"kept": rest.reshape(-1).astype(np.int64), "moved": extra.reshape(-1).astype(np.int64)}, src_ctype)
out_body["primitives"][7]["indices"] = new_acc["kept"]
fresh = {"attributes": dict(prim7["attributes"]), "indices": new_acc["moved"], "material": prims[skin_idx]["material"]}
if prim7.get("targets"):
    fresh["targets"] = copy.deepcopy(prim7["targets"])
out_body["primitives"].append(fresh)
out_doc["buffers"][0]["byteLength"] = len(out_bin)
write_glb(${JSON.stringify(probeGlb)}, out_doc, bytes(out_bin))
print(json.dumps({"extraKey": extra_key, "extraInSix": extra_key in ${JSON.stringify(six)}, "extraInPoke19": extra_key in sorted(poke_keys)}))`,
      ]),
    ) as { extraKey: string; extraInSix: boolean; extraInPoke19: boolean };
    console.log(`T-delta probe 7th key=${info.extraKey.slice(0, 16)} inSix=${info.extraInSix} inPoke19=${info.extraInPoke19}`);
    expect(info.extraInSix, "7th tri is not one of the 6").toBe(false);
    expect(info.extraInPoke19, "7th tri is outside the 19-face counterweight").toBe(false);
    const pre = preC1da();
    const { delta } = hiddenSkinDelta(pre, probeGlb);
    const extra = delta.filter((k) => !sixSet.has(k));
    console.log(`T-delta probe red: delta=${delta.length} extra=${extra.map((k) => k.slice(0, 16)).join(",")}`);
    expect(delta.length, "probe delta is 7 keys (red: not exactly the 6)").toBe(7);
    expect(extra, "the 7th delta key is the probe tri").toEqual([info.extraKey]);
  }, 300_000);

  it("(d) the 8 other STALE GLBs are untouched", () => {
    for (const [file, sha] of Object.entries(GLB_SHAS)) {
      const got = shaFile(join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids", file));
      expect(got).toBe(sha);
    }
  });

  it("A1.1 SEAM: crossing-boundary 4-neighbour |delta| p95 <= B_c per channel", () => {
    // B_c pinned: shipped own-4-neighbour p95 R 7.0 / G 7.0 / B 6.0 (418108
    // pairs over non-footprint skin of islands 1/7/8 of image sha 1a9e179b,
    // pre-image GLB sha 8957543d...). Filled pairs count all four orientations
    // (8808 = 4393 x2 under the fixed 4-orientation count).
    console.log(`SEAM filled=${M.seam.p95_r},${M.seam.p95_g},${M.seam.p95_b} Bc=7,7,6 pairs=${M.seam.pairs}`);
    expect(M.seam.pairs).toBe(SEAM_PAIRS);
    expect(M.seam.p95_r).toBeLessThanOrEqual(BC.r);
    expect(M.seam.p95_g).toBeLessThanOrEqual(BC.g);
    expect(M.seam.p95_b).toBeLessThanOrEqual(BC.b);
  });

  it("A1.2 VARIANCE: filled median luma-5x5-std >= 0.25 x non-footprint median", () => {
    // Shipped (image sha 1a9e179b): global 2.577411; islands 2.570385 /
    // 2.719765 / 2.769484; min/global 0.997274 -> bound stays 0.25 anyway.
    const v = M.variance;
    console.log(`VARIANCE filled=${v.filledMedian} nonfp=${v.nonFootprintMedian} ratio=${v.ratio}`);
    expect(v.filledMedian).toBeGreaterThanOrEqual(VARIANCE_BOUND * v.nonFootprintMedian);
  });

  it("(iso) perturbing outside each footprint-bearing island leaves its fill identical", () => {
    // iso-probe defaults to the GLB's own skin pixels (A1.6 custody: no
    // before-image bytes outside the committed GLB) and probes EVERY
    // footprint-bearing island (1, 7, 8).
    const out = JSON.parse(
      py([TOOL, "iso-probe", "--glb", NURSE_GLB, "--footprint-mask", FIXTURE_MASK]),
    );
    console.log(`(iso) islands=${out.islands} allIdentical=${out.allIdentical} probes=${JSON.stringify(out.probes)}`);
    expect(out.islands).toEqual(ISLANDS_TOUCHED);
    expect(out.probes).toHaveLength(ISLANDS_TOUCHED.length);
    for (const p of out.probes) {
      expect(p.identicalInsideIsland).toBe(true);
    }
    expect(out.allIdentical).toBe(true);
  }, 300_000);

  // (lin) re-execution (clean-clone safe, no skipIf, F5): the c1da76fb4
  // pre-image is a git object (present on a clean clone), the chain runs
  // from the sidecar's own derivationArgv with {pre}/{out}/{report}
  // rewritten into os.tmpdir() files, and the output must equal installed.
  it("(lin) sidecar byteLineage pins the chain derivation and re-executes byte-identical", () => {
    const prov = JSON.parse(readFileSync(NURSE_PROV, "utf8"));
    const bl = prov.byteLineage;
    const installed = shaFile(NURSE_GLB);
    expect(bl.preImageRevision).toBe(PRE_C1DA_REV);
    expect(bl.preImageSha256).toBe(PREIMAGE_C1DA_SHA);
    expect(prov.outputSha256).toBe(installed);
    const work = mkdtempSync(join(tmpdir(), "p2e-lin-"));
    const pre = join(work, "pre.glb");
    const out = join(work, "out.glb");
    const rep = join(work, "report.json");
    writeFileSync(pre, execFileSync("git", ["show", bl.preImageRevision], { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 }));
    expect(shaFile(pre), "git pre-image bytes hash to the pinned preImage").toBe(PREIMAGE_C1DA_SHA);
    const argv = (bl.derivationArgv as string[]).map((t) =>
      t.replace("{pre}", pre).replace("{out}", out).replace("{report}", rep),
    );
    execFileSync(argv[0] as string, (argv as string[]).slice(1), { cwd: REPO_ROOT, stdio: "pipe" });
    expect(shaFile(out)).toBe(installed);
    console.log(`(lin) chain re-execution reproduces ${installed}`);
  }, 300_000);

  describe("plants (each expects the named failure)", () => {
    it("P1: re-blackening the footprint breaks (a)", () => {
      const work = mkdtempSync(join(tmpdir(), "p2e-p1-"));
      const png = join(work, "p1.png");
      py([
        "-c",
        `${PLANT_PRELUDE}
_js, _bin, _v = _tool.load_glb(${JSON.stringify(NURSE_GLB)})
_buf = _tool.get_buffer_bytes(_js, _bin)
_si, _ = _tool.skin_info(_js, _buf)
_raw = _tool.image_raw_bytes(_js, _buf, _si[3])
_arr = np.array(Image.open(__import__("io").BytesIO(_raw)).convert("RGB"))
_fp = _tool.load_mask(${JSON.stringify(FIXTURE_MASK)}, _arr.shape[1], _arr.shape[0])
_arr[_fp] = 0
Image.fromarray(_arr, "RGB").save(${JSON.stringify(png)}, format="PNG", optimize=False, compress_level=6)
print("wrote")`,
      ]);
      const m1 = measureImage(NURSE_GLB, png);
      console.log(`P1 before=${M.footprintBlackFrac} after=${m1.footprintBlackFrac}`);
      expect(m1.footprintBlackFrac).toBeGreaterThan(BLACK_MAX);
    }, 300_000);

    it("P2: shifting the mask by 1 texel breaks (a2)", () => {
      const work = mkdtempSync(join(tmpdir(), "p2e-p2-"));
      const mask = join(work, "shifted.png");
      py([
        "-c",
        `${PLANT_PRELUDE}
_fp = np.array(Image.open(${JSON.stringify(FIXTURE_MASK)}).convert("L")) > 127
_sh = np.roll(np.roll(_fp, 1, axis=1), 0, axis=0)
Image.fromarray((_sh.astype(np.uint8)) * 255, "L").save(${JSON.stringify(mask)}, format="PNG", optimize=False, compress_level=6)
print("wrote")`,
      ]);
      // A 1-texel roll pushes 654 texels outside every island, so the tool's
      // (a2)/measure path must refuse (FOOTPRINT_OUTSIDE_ISLANDS) before
      // hashing: assert the refusal and its status explicitly.
      const probe = spawnSync(
        "mise",
        ["exec", "--", "python3", "-I", TOOL, "measure", "--glb", NURSE_GLB, "--footprint-mask", mask],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      console.log(`P2 tool exit=${probe.status} stderr=${(probe.stderr as string).trim().split("\n").pop()}`);
      expect(probe.status).not.toBe(0);
      expect(probe.stderr as string).toContain("INPAINT_REFUSED:FOOTPRINT_OUTSIDE_ISLANDS");
      // The (a2) predicate itself — the tool's own measure_pixels code that
      // the green (a2) clause reads offFootprintHash from — fails on the
      // shifted mask (hash differs from the pinned baseline).
      const shiftedHash = py([
        "-c",
        `${PLANT_PRELUDE}
import io as _io
_js, _bin, _v = _tool.load_glb(${JSON.stringify(NURSE_GLB)})
_buf = _tool.get_buffer_bytes(_js, _bin)
_si, _ = _tool.skin_info(_js, _buf)
_raw = _tool.image_raw_bytes(_js, _buf, _si[3])
_arr = np.array(Image.open(_io.BytesIO(_raw)).convert("RGB"))
_W, _H = _arr.shape[1], _arr.shape[0]
_found = _tool.find_body_mesh(_js); _mesh = _found[1]
_union, _labels, _n = _tool.compute_islands(_js, _buf, _mesh, _si[1], _W, _H)
_sh = np.array(Image.open(${JSON.stringify(mask)}).convert("L")) > 127
_t = sorted(int(v) for v in set(np.unique(_labels[_sh])) - {0})
_pix = _tool.measure_pixels("", _arr, _sh, _labels, _t, _W, _H)
print(_pix["offFootprintHash"])`,
      ]).trim();
      console.log(`P2 before=${M.offFootprintHash} after=${shiftedHash}`);
      expect(shiftedHash).not.toBe(OFFFP_HASH);
    }, 300_000);

    it("P3: a footprint component spanning 2 islands is refused", () => {
      const work = mkdtempSync(join(tmpdir(), "p2e-p3-"));
      const mask = join(work, "spanning.png");
      const out = join(work, "out.glb");
      const rep = join(work, "report.json");
      py([
        "-c",
        `${PLANT_PRELUDE}
_js, _bin, _v = _tool.load_glb(${JSON.stringify(NURSE_GLB)})
_buf = _tool.get_buffer_bytes(_js, _bin)
_si, _ = _tool.skin_info(_js, _buf)
_found = _tool.find_body_mesh(_js); _mesh = _found[1]
_union, _labels, _n = _tool.compute_islands(_js, _buf, _mesh, _si[1], 1024, 1024)
_fp = _tool.load_mask(${JSON.stringify(FIXTURE_MASK)}, 1024, 1024)
_t = sorted(int(v) for v in set(np.unique(_labels[_fp])) - {0})
_ys1, _xs1 = np.nonzero(_fp & (_labels == _t[0])); _ys2, _xs2 = np.nonzero(_fp & (_labels == _t[1]))
_y1, _x1 = int(_ys1[0]), int(_xs1[0]); _y2, _x2 = int(_ys2[0]), int(_xs2[0])
_bar = _fp.copy()
for _x in range(min(_x1, _x2), max(_x1, _x2) + 1): _bar[_y1, _x] = True
for _y in range(min(_y1, _y2), max(_y1, _y2) + 1): _bar[_y, _x2] = True
Image.fromarray((_bar.astype(np.uint8)) * 255, "L").save(${JSON.stringify(mask)}, format="PNG", optimize=False, compress_level=6)
print("wrote", _t)`,
      ]);
      const r = spawnSync(
        "mise",
        ["exec", "--", "python3", "-I", TOOL, "--in", NURSE_GLB, "--out", out, "--footprint-mask", mask, "--report", rep],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      console.log(`P3 exit=${r.status} stderr=${(r.stderr as string).trim().split("\n").pop()}`);
      expect(r.status).not.toBe(0);
      expect(r.stderr as string).toContain("INPAINT_REFUSED:FOOTPRINT_SPANS_ISLANDS");
      expect(existsSync(out)).toBe(false);
    }, 300_000);

    it("P4: a constant median fill fails SEAM or VARIANCE", () => {
      const work = mkdtempSync(join(tmpdir(), "p2e-p4-"));
      const png = join(work, "p4.png");
      py([
        "-c",
        `${PLANT_PRELUDE}
_js, _bin, _v = _tool.load_glb(${JSON.stringify(NURSE_GLB)})
_buf = _tool.get_buffer_bytes(_js, _bin)
_si, _ = _tool.skin_info(_js, _buf)
_raw = _tool.image_raw_bytes(_js, _buf, _si[3])
_arr = np.array(Image.open(__import__("io").BytesIO(_raw)).convert("RGB"))
_fp = _tool.load_mask(${JSON.stringify(FIXTURE_MASK)}, _arr.shape[1], _arr.shape[0])
_arr[_fp] = np.array([${MEDIAN_SKIN.join(",")}], dtype=np.uint8)
Image.fromarray(_arr, "RGB").save(${JSON.stringify(png)}, format="PNG", optimize=False, compress_level=6)
print("wrote")`,
      ]);
      const m4 = measureImage(NURSE_GLB, png);
      const seamFail =
        m4.seam.p95_r > BC.r || m4.seam.p95_g > BC.g || m4.seam.p95_b > BC.b;
      const varFail = m4.variance.filledMedian < VARIANCE_BOUND * m4.variance.nonFootprintMedian;
      console.log(
        `P4 seam=${m4.seam.p95_r},${m4.seam.p95_g},${m4.seam.p95_b} (Bc=7,7,6) var=${m4.variance.filledMedian} vs ${VARIANCE_BOUND * m4.variance.nonFootprintMedian} seamFail=${seamFail} varFail=${varFail}`,
      );
      expect(seamFail || varFail).toBe(true);
    }, 300_000);
  });
});
