import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The body/face gets the post-export 60-deg auto-smooth (diagnosis): the native
 * face crop still shows large polygonal shading facets at 428k tris after the
 * Catmull-Clark subdiv, and in-Blender shade_smooth() does not change the
 * exported GLB bytes (the exporter reads mesh.corner_normals; measured on
 * Blender 5.1.1, no in-Blender API lands on the shipped bytes — the #371
 * docstring's table). The proven #371 path, apply_garment_auto_smooth_normals(),
 * SKIPS every primitive whose material name does not match makeclothes_library,
 * so the body/skin primitives never got the post-export 60-deg weld.
 *
 * MEASURED 2026-09-18: native face crop of the adult-nurse scratch bake showed
 * crumpled polygonal facets on forehead/cheeks/neck at 428k tris with
 * BODY_SHADE_SMOOTH True in the bake log.
 *
 * claimScope: apply_body_auto_smooth_normals() shares the #371 weld math
 *   (same weld keys, same face-normal math, same threshold rule) and smooths
 *   only mpfb_skin_ primitives on the EXPORTED bytes; it is called from the
 *   existing post-export site next to apply_garment_auto_smooth_normals.
 *   Scalp (openclinxr_mesh_native_scalp_hair_surface), hide-mask
 *   (openclinxr_hidden_upper) and eye (mat_makeclothes_library_eyes)
 *   primitives stay excluded by construction.
 * notEvidenceFor: whether the subdivided nurse LOOKS smooth (pixel grade is
 *   the orchestrator's); Quest triangle budget; other actors' albedo.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const MAT = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

function extractFunction(src: string, name: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`def ${name}(`));
  expect(start, `${name} defined`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.length > 0 && !l.startsWith(" ") && !l.startsWith("\t"));
  return [lines[start]!, ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

/** Run the two smoothing functions against a synthetic GLB without Blender. */
function runSmoothingAgainstFixture(matchBody: boolean): { log: string; normals: number[][] } {
  const dir = mkdtempSync(join(tmpdir(), `body-smooth-${matchBody ? "body" : "garment"}-`));
  const matName = matchBody ? "mpfb_skin_probe" : "mat_makeclothes_library_probe";
  const glbPath = join(dir, "probe.glb");
  const py = [
    "import json, struct, sys",
    // Two triangles forming a shallow 20-deg ridge sharing one weld position.
    "P = [(0.0,0.0,0.0),(1.0,0.0,0.0),(0.0,1.0,0.0),(0.0,0.0,0.0),(1.0,0.0,0.0),(0.0,0.9396926207859084,0.3420201433256687)]",
    "N = [(0.0,0.0,1.0)]*3 + [(0.0,-0.3420201433256687,0.9396926207859084)]*3",
    "IDX = [0,1,2,3,4,5]",
    "pos = b''.join(struct.pack('<fff', *p) for p in P)",
    "nor = b''.join(struct.pack('<fff', *n) for n in N)",
    "idx = b''.join(struct.pack('<H', i) for i in IDX)",
    "bin_data = pos + nor + idx",
    "gltf = {'asset': {'version': '2.0'}, 'materials': [{'name': " + JSON.stringify(matName) + "}],",
    " 'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 72}, {'buffer': 0, 'byteOffset': 72, 'byteLength': 72}, {'buffer': 0, 'byteOffset': 144, 'byteLength': 12}],",
    " 'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 6, 'type': 'VEC3'}, {'bufferView': 1, 'componentType': 5126, 'count': 6, 'type': 'VEC3'}, {'bufferView': 2, 'componentType': 5123, 'count': 6, 'type': 'SCALAR'}],",
    " 'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1}, 'indices': 2, 'material': 0}]}],",
    " 'buffers': [{'byteLength': 156}]}",
    "j = json.dumps(gltf).encode()",
    "jp = (len(j) + 3) // 4 * 4",
    "j = j + b' ' * (jp - len(j))",
    "bp = (len(bin_data) + 3) // 4 * 4",
    "bin_data = bin_data + b'\\x00' * (bp - len(bin_data))",
    "glb = b'glTF' + struct.pack('<II', 2, 12 + 8 + jp + 8 + bp) + struct.pack('<I', jp) + b'JSON' + j + struct.pack('<I', bp) + b'BIN\\x00' + bin_data",
    `open(${JSON.stringify(glbPath)}, 'wb').write(glb)`,
    `sys.path.insert(0, ${JSON.stringify(dir)})`,
    "import body_smooth_probe as probe",
    matchBody
      ? "probe.apply_body_auto_smooth_normals(" + JSON.stringify(glbPath) + ", angle_deg=60.0)"
      : "probe.apply_garment_auto_smooth_normals(" + JSON.stringify(glbPath) + ", angle_deg=60.0)",
    "d = open(" + JSON.stringify(glbPath) + ", 'rb').read()",
    "jl = struct.unpack('<I', d[12:16])[0]",
    "g = json.loads(d[20:20+jl])",
    "bv = g['bufferViews'][1]",
    "acc = g['accessors'][1]",
    "off = 20 + jl + 8 + bv.get('byteOffset', 0) + acc.get('byteOffset', 0)",
    "out = [struct.unpack_from('<fff', d, off + i * 12) for i in range(6)]",
    "print(json.dumps({'normals': out}))",
  ].join("\n");
  const probePath = join(dir, "body_smooth_probe.py");
  const src = readFileSync(MAT, "utf8");
  const needed = ["_weld_key_5", "_auto_smooth_matching_prims", "_is_garment_prim", "apply_garment_auto_smooth_normals", "apply_body_auto_smooth_normals"]
    .map((n) => extractFunction(src, n))
    .join("\n\n");
  writeFileSync(probePath, `import json, math, re, struct\n\n${needed}\n`);
  const out = execFileSync("/usr/bin/python3", ["-c", py], { encoding: "utf8" });
  const parsed = JSON.parse(out.trim().split("\n").pop()!) as { normals: number[][] };
  return { log: out, normals: parsed.normals };
}

describe("the body auto-smooth runs on the exported bytes", () => {
  it("(1) the body pass exists and matches mpfb_skin_ primitives only", () => {
    const src = readFileSync(MAT, "utf8");
    expect(src, "body pass defined").toMatch(/def apply_body_auto_smooth_normals\(/);
    expect(src, "body matcher is mpfb_skin_ anchored").toMatch(/re\.search\(r"\^mpfb_skin_"/);
    expect(src, "shared weld engine").toMatch(/def _auto_smooth_matching_prims\(/);
  });

  it("(2) the body pass is called from the post-export site next to the garment pass", () => {
    const src = readFileSync(MAT, "utf8");
    expect(src, "garment pass call").toContain("apply_garment_auto_smooth_normals(str(output)");
    expect(src, "body pass call").toContain("apply_body_auto_smooth_normals(str(output)");
    const garmentAt = src.indexOf("apply_garment_auto_smooth_normals(str(output)");
    const bodyAt = src.indexOf("apply_body_auto_smooth_normals(str(output)");
    const texAt = src.indexOf("verify_garment_textures_in_glb(str(output)");
    expect(bodyAt, "body call after garment call").toBeGreaterThan(garmentAt);
    expect(texAt, "texture check after both smoothing passes").toBeGreaterThan(bodyAt);
  });

  it("(3) COUNTERWEIGHT: the garment-only filter is unchanged (collars/hems/soles stay split)", () => {
    const src = readFileSync(MAT, "utf8");
    expect(src, "garment filter still makeclothes_library").toMatch(
      /def _is_garment_prim\(mat_name\):[\s\S]{0,200}makeclothes_library/,
    );
    expect(src, "eyes still excluded from garments").toMatch(/not re\.search\(\s*r"eyes", mat_name/);
    expect(src, "garment pass keeps the GLB_AUTO_SMOOTH log line").toContain('"GLB_AUTO_SMOOTH"');
  });

  it("(4) the shared weld merges a shallow ridge on an mpfb_skin_ primitive", () => {
    const { normals } = runSmoothingAgainstFixture(true);
    // The two triangles meet at ~20 deg < 60, so the two shared edge corners
    // weld to one normal; the four unshared corners keep their face normals.
    const edgeKeys = new Set(
      [normals[0]!, normals[1]!, normals[3]!, normals[4]!].map((n) =>
        n.map((x) => x.toFixed(3)).join(","),
      ),
    );
    expect(edgeKeys.size, `shared edge welded to one normal`).toBe(1);
    // And the weld actually moved something: the edge normal is neither face normal.
    expect(edgeKeys.has("0.000,0.000,1.000"), "edge normal is not the flat face normal").toBe(false);
  });

  it("(5) the garment pass still ignores an mpfb_skin_ primitive", () => {
    const src = readFileSync(MAT, "utf8");
    const fn = extractFunction(src, "apply_garment_auto_smooth_normals");
    expect(fn, "garment pass routes through the shared engine").toContain("_auto_smooth_matching_prims(");
    expect(fn, "garment pass keeps the garment filter").toContain("_is_garment_prim");
    expect(fn, "garment pass does not take the body filter").not.toContain("mpfb_skin_");
  });
});
