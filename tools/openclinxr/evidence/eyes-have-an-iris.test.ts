import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
// Relative source import: `tools/` is outside the workspace package graph and cannot resolve
// `@openclinxr/asset-registry` by name. Same as the #353 speech contract (#308 runtime resolver).
import { resolveMorphTarget } from "../../../packages/openclinxr/asset-registry/src/morph-target-resolver.ts";

/**
 * #337 fitted CC0 MakeHuman eyes to all three MPFB bodies — 172 triangles, skinned, bound to the
 * bones `resolvePoseBone("eyeL"/"eyeR")` returns. The geometry is correct. The eyes still do not
 * look like eyes, because the MATERIAL was never wired.
 *
 * MEASURED, and the value CHANGED under me mid-investigation:
 *
 *   after #337   baseColor [1.00,1.00,1.00,1.00]  no texture  -> graded as flat WHITE ovals
 *   after #338   baseColor [0.12,0.09,0.07,1.00]  no texture  -> graded as dark SOCKETS
 *
 * Both are a uniform colour over the whole eyeball. #338's re-bake swapped white for brown and
 * neither is an eye: a sclera and an iris are different colours on the same 172 triangles.
 *
 * THE REFERENCE IS THE ASSET'S OWN DECLARED MATERIAL — nothing here is invented:
 *
 *   .openclinxr-local/provider-cache/eyes/makehuman-default/low-poly.mhclo
 *     material ../materials/brown.mhmat
 *   .../brown.mhmat
 *     name Eye_brown
 *     diffuseTexture brown_eye.png          <- the iris/sclera map
 *     shaderParam litsphereTexture skinmat_eye.png
 *
 * Two gaps, both measured:
 *   1. `brown_eye.png` is NOT in our cache. #337 staged .mhclo + .obj + .mhmat and stopped at the
 *      texture the .mhmat points to. It IS available CC0 upstream, same directory, 610,817 bytes:
 *      makehumancommunity/makehuman2 `data/eyes/hm08/materials/brown_eye.png`.
 *   2. `materialize_mpfb_humanoid_candidate.py` contains ZERO `mhmat` references — the pipeline
 *      never consumes an MakeHuman material for any channel, so a flat colour is all it can emit.
 *
 * The eye primitives already carry TEXCOORD_0 on all three bodies (measured). The geometry is ready
 * for the texture; only the material binding is missing.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                    | (1) texture | (2) not uniform | (3) geometry kept | result
 *   ---------------------------------------------|-------------|-----------------|-------------------|--------
 *   a) after #337 — flat white                   |  **FAIL**   |    **FAIL**     |       pass        | REFUSED
 *   b) after #338 — flat brown                   |  **FAIL**   |    **FAIL**     |       pass        | REFUSED
 *   c) pick a "better" flat baseColor            |  **FAIL**   |    **FAIL**     |       pass        | REFUSED
 *   d) consume brown.mhmat -> baseColorTexture   |    pass     |      pass       |       pass        | ALL PASS
 *
 * (c) is the one to worry about and it has ALREADY HAPPENED TWICE. Two slices in a row adjusted a
 * uniform baseColor and the figure got no closer to having eyes. Clause (2) is what refuses a third
 * attempt: a sclera and an iris cannot be the same colour, so a uniform material can never pass.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today on all three bodies.
 * (3) PASSES today and is the known-good column — #337's geometry and skinning are correct and must
 * survive. A fix that deletes and re-adds the eyes to get a material is not a fix.
 *
 * NOT TESTED: no pixel is graded here, and this asserts the MATERIAL BINDING only. It does not claim
 * the iris is the right size, centred on the pupil, oriented correctly, or that the eye reads as an
 * eye at viewing distance — all of that is a pixel grade the orchestrator owes. Nor does it touch
 * nurse_kevin's separate face defect: alpha-0 MASK primitives DISCARD face geometry, which is
 * absence rather than appearance and no material clause can see it.
 *
 * ## FIXED (#340)
 *
 * `materialize_mpfb_humanoid_candidate.py` now consumes the asset's OWN declared material:
 * `mhmat_for_mhclo` resolves the .mhclo's `material ../materials/brown.mhmat` line and
 * `make_material_from_mhmat` binds `diffuseTexture brown_eye.png` (CC0, same directory, 610,817
 * bytes, git blob `bda1b4b0` == upstream main, verified via gh API) as glTF `baseColorTexture`
 * with `diffuseColor` as baseColorFactor. The flat baseColor path (#337 white, #338 brown) is gone
 * for eyes. All three bodies re-baked and re-measured 2026-08-11:
 *
 *   file                        | texture | distinctColours | baseColor | tris | skinned
 *   ----------------------------|---------|-----------------|-----------|------|--------
 *   mpfb-ob-patient-aisha.glb   |  yes    |       65        | 1,1,1,1   | 172  |  yes
 *   mpfb-peds-nurse-kevin.glb   |  yes    |       65        | 1,1,1,1   | 172  |  yes
 *   mpfb-peds-patient-child.glb |  yes    |       65        | 1,1,1,1   | 172  |  yes
 *
 * The `it.fails` markers on (1) and (2) were flipped to `it`; the geometry net (3) still passes.
 * (65 is the sampler's 64-colour cap — a coarse byte sample of the embedded 610,817-byte PNG, not
 * a pixel count; the point is that the material is a texture, not a uniform fill.)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** Distinct RGB values required before a texture counts as an iris rather than a tint. */
const MIN_DISTINCT_COLOURS = 2;

type Row = {
  file: string;
  hasTexture: boolean;
  baseColor: number[];
  distinctColours: number;
  tris: number;
  skinned: boolean;
};

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!/eye/i.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture() ?? null;

      // Distinct colours: sample the texture's raw bytes if present, else a flat factor is 1 colour.
      let distinct = 1;
      const img = tex?.getImage();
      if (img && img.byteLength > 0) {
        const seen = new Set<string>();
        // Coarse sample — enough to separate a real iris map from a single-colour fill.
        const stride = Math.max(1, Math.floor(img.byteLength / 4096));
        for (let i = 0; i + 2 < img.byteLength; i += stride * 3) {
          seen.add(`${img[i]! >> 4},${img[i + 1]! >> 4},${img[i + 2]! >> 4}`);
          if (seen.size > 64) break;
        }
        distinct = seen.size;
      }

      let tris = 0;
      let skinned = false;
      for (const p of mesh.listPrimitives()) {
        tris += (p.getIndices()?.getCount() ?? 0) / 3;
        if (p.getAttribute("JOINTS_0")) skinned = true;
      }
      return {
        file: rel.split("/").pop()!,
        hasTexture: tex !== null,
        baseColor: mat?.getBaseColorFactor() ?? [],
        distinctColours: distinct,
        tris,
        skinned,
      };
    }
  }
  return null;
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies carrying an eye mesh (scanned ${files.length})`)
    .toBeGreaterThanOrEqual(3);
}

const show = (r: Row): string =>
  `${r.file}: texture=${r.hasTexture} distinctColours=${r.distinctColours} baseColor=[${r.baseColor.map((x) => x.toFixed(2)).join(",")}]`;

describe("an eye has an iris, not a single colour", () => {
  it("(1) RED: every eye material carries a base-colour texture", () => {
    requireRows();
    expect(rows.filter((r) => !r.hasTexture).map(show), "eye materials with no texture").toEqual([]);
  });

  it("(2) RED COUNTERWEIGHT: the eye is not a uniform colour — a flat baseColor is refused", () => {
    requireRows();
    // Twice now a slice has adjusted a uniform baseColor (white -> brown) and produced no eye.
    // A sclera and an iris differ, so any uniform material fails this by construction.
    expect(
      rows.filter((r) => r.distinctColours < MIN_DISTINCT_COLOURS).map(show),
      "eyes rendering as a single flat colour",
    ).toEqual([]);
  });

  it("(3) NET known-good: #337's eye geometry and skinning survive", () => {
    requireRows();
    const broken = rows
      .filter((r) => r.tris < 100 || !r.skinned)
      .map((r) => `${r.file}: tris=${r.tris} skinned=${r.skinned}`);
    expect(broken, "eye meshes that lost geometry or skinning").toEqual([]);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#354) — appended, planted header above is immutable
 *
 * #354 built the eye-INSPECTION STATION: the file-side properties above are green AND blind —
 * every one of them is satisfiable by an eye that renders wrong (symmetry 0.00 mm, IPD 61.6 /
 * 60.7 / 52.1 mm scaling with stature, 597 KB iris bound, 2 eye bones, texture bound). The crops
 * (aisha-eye-front.png / aisha-eye-side.png / kevin-eye-front.png / child-eye-front.png) bring the
 * eye box from 5.4-7.7 px (measured full-body framing, `.openclinxr/evidence/mpfb-eyes/pre-fix.json`)
 * to hundreds of pixels so a defect can be SEEN and bounded. The deterministic contracts below pin
 * the rest of what "properly configured" means at the file level; how the eyes LOOK remains the
 * orchestrator's pixel grade (#227) and is deliberately NOT asserted here.
 *
 * NOT TESTED (the honest ceiling of a file-side contract):
 *   - whether the iris SHOWS, the cornea clears the lid, both eyes aim the same way, sclera size,
 *     or skin poking through the eyeball — pixel grade only
 *   - gaze correctness under drive (#311 / #296)
 *   - whether the L/R bone naming convention (MPFB places `.L` joints at world +x) matches runtime
 *     side expectations — recorded in pre-fix.json, not adjudicated here
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import {
  MPFB_EYE_ACTORS,
  MPFB_EYES_EVIDENCE_ROOT,
  pngDimensionsFromFile,
  pngLuminanceSd,
  readMpfbEyesPreFix,
} from "./mpfb-eyes-inspection.js";

/** Adults (measured 61.6 / 60.7 mm) — the age-plausible absolute band. */
const ADULT_IPD_BAND = { minMeters: 0.055, maxMeters: 0.07 } as const;
/** Child (measured 52.1 mm) — age-plausible for a school-age child. */
const CHILD_IPD_BAND = { minMeters: 0.045, maxMeters: 0.058 } as const;
/** Mirror symmetry floor: measured 0.0000 m; 0.5 mm is 5000x the OBJ import noise. */
const MAX_MIRROR_ERR_METERS = 0.0005;
/** Iris texture: measured 610,817 bytes — floor at ~8% refuses stubs/1x1 PNGs. */
const MIN_IRIS_BYTES = 50_000;
/** Iris texture: measured 1024x1024. */
const MIN_IRIS_DIMENSION_PX = 256;
/** Luminance sd floor: measured 39.96; a flat fill measures ~0.00. */
const MIN_IRIS_LUMINANCE_SD = 15;
/** Eye-bone coincidence: the dominant bone of a cluster must sit inside the eye AABB + this margin. */
const BONE_COINCIDENCE_MARGIN_METERS = 0.005;
/** Crop minimum dimension — the station must resolve an eye to hundreds of pixels, not eight. */
const MIN_CROP_DIMENSION_PX = 512;

const EYE_MESH_RE = /eyes|iris|cornea|sclera/i;
const EYE_BONE_RE = /^eye\.(L|R)$/i;
const EYE_FACS_NAMES = [
  "eye-left-closure",
  "eye-left-slit",
  "eye-left-opened-up",
  "eye-right-closure",
  "eye-right-slit",
  "eye-right-opened-up",
] as const;
const EYE_CANONICAL_NAMES = [
  "openclinxr_eye_left_closure",
  "openclinxr_eye_left_slit",
  "openclinxr_eye_left_opened_up",
  "openclinxr_eye_right_closure",
  "openclinxr_eye_right_slit",
  "openclinxr_eye_right_opened_up",
] as const;

type Vec3 = { x: number; y: number; z: number };

function meshPositions(mesh: import("@gltf-transform/core").Mesh): Vec3[] {
  const out: Vec3[] = [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION")?.getArray();
    if (!pos) continue;
    for (let i = 0; i + 2 < pos.length; i += 3) {
      out.push({ x: Number(pos[i]), y: Number(pos[i + 1]), z: Number(pos[i + 2]) });
    }
  }
  return out;
}

function centroid(verts: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of verts) {
    x += v.x;
    y += v.y;
    z += v.z;
  }
  return { x: x / verts.length, y: y / verts.length, z: z / verts.length };
}

function mirrorSymmetryMaxErr(left: Vec3[], right: Vec3[]): number {
  let maxErr = 0;
  for (const lv of left) {
    let best = Infinity;
    for (const rv of right) {
      const e = Math.abs(lv.x + rv.x) + Math.abs(lv.y - rv.y) + Math.abs(lv.z - rv.z);
      if (e < best) best = e;
    }
    if (best > maxErr) maxErr = best;
  }
  return maxErr;
}

function dominantJointPerSide(
  mesh: import("@gltf-transform/core").Mesh,
  doc: import("@gltf-transform/core").Document,
): { L: string; R: string } {
  const sk = doc.getRoot().listSkins()[0];
  if (!sk) return { L: "", R: "" };
  const jointNames = sk.listJoints().map((j) => j.getName() ?? "");
  const counts: { L: Record<string, number>; R: Record<string, number> } = { L: {}, R: {} };
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION")?.getArray();
    const jl = prim.getAttribute("JOINTS_0")?.getArray();
    const wl = prim.getAttribute("WEIGHTS_0")?.getArray();
    if (!pos || !jl || !wl) continue;
    const count = jl.length / 4;
    for (let i = 0; i < count; i += 1) {
      const x = Number(pos[i * 3]);
      let bestJ = -1;
      let bestW = -1;
      for (let k = 0; k < 4; k += 1) {
        const w = Number(wl[i * 4 + k]);
        if (w > bestW) {
          bestW = w;
          bestJ = jl[i * 4 + k]!;
        }
      }
      const side = x < 0 ? "L" : "R";
      const name = jointNames[bestJ] ?? `#${bestJ}`;
      counts[side][name] = (counts[side][name] ?? 0) + 1;
    }
  }
  const top = (side: "L" | "R"): string => {
    const entries = Object.entries(counts[side]).sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] ?? "";
  };
  return { L: top("L"), R: top("R") };
}

function eyeBoneWorldPositions(doc: import("@gltf-transform/core").Document): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const sk of doc.getRoot().listSkins()) {
    for (const joint of sk.listJoints()) {
      const jn = joint.getName() ?? "";
      if (!EYE_BONE_RE.test(jn)) continue;
      const wm = joint.getWorldMatrix();
      out.set(jn, { x: wm[12], y: wm[13], z: wm[14] });
    }
  }
  return out;
}

function bodyMorphNames(doc: import("@gltf-transform/core").Document): Set<string> {
  const names = new Set<string>();
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!/body$/.test(mesh.getName() ?? "")) continue;
    for (const prim of mesh.listPrimitives()) {
      for (const target of prim.listTargets()) {
        const tn = target.getName();
        if (tn) names.add(tn);
      }
    }
  }
  return names;
}

describe("the MPFB eye-inspection station (#354)", () => {
  const io = new NodeIO();

  it("ships two mirror-symmetric eye clusters with an age-scaled IPD", async () => {
    for (const actor of MPFB_EYE_ACTORS) {
      const doc = await io.read(pathResolve(REPO_ROOT, actor.glb));
      const eyeMesh = doc.getRoot().listMeshes().find((m) => EYE_MESH_RE.test(m.getName() ?? ""));
      expect(eyeMesh, `${actor.id}: no eye mesh matching ${EYE_MESH_RE}`).toBeDefined();

      const verts = meshPositions(eyeMesh!);
      const left = verts.filter((v) => v.x < 0);
      const right = verts.filter((v) => v.x >= 0);
      expect(
        left.length,
        `${actor.id}: left cluster has ${left.length} verts — the makehuman eye splits 48/48`,
      ).toBeGreaterThanOrEqual(32);
      expect(
        right.length,
        `${actor.id}: right cluster has ${right.length} verts — the makehuman eye splits 48/48`,
      ).toBeGreaterThanOrEqual(32);

      const err = mirrorSymmetryMaxErr(left, right);
      expect(
        err,
        `${actor.id}: L/R mirror symmetry max err ${(err * 1000).toFixed(3)} mm exceeds ${MAX_MIRROR_ERR_METERS * 1000} mm`,
      ).toBeLessThanOrEqual(MAX_MIRROR_ERR_METERS);

      const ipd = centroid(right).x - centroid(left).x;
      const band = actor.role === "child" ? CHILD_IPD_BAND : ADULT_IPD_BAND;
      expect(
        ipd,
        `${actor.id}: IPD ${(ipd * 1000).toFixed(1)} mm outside the ${actor.role} band ` +
          `${(band.minMeters * 1000).toFixed(0)}–${(band.maxMeters * 1000).toFixed(0)} mm`,
      ).toBeGreaterThanOrEqual(band.minMeters);
      expect(ipd).toBeLessThanOrEqual(band.maxMeters);
    }

    // Stature scaling direction: the child's IPD must be below every adult's.
    const ipdOf = async (actor: (typeof MPFB_EYE_ACTORS)[number]): Promise<number> => {
      const doc = await io.read(pathResolve(REPO_ROOT, actor.glb));
      const mesh = doc.getRoot().listMeshes().find((m) => EYE_MESH_RE.test(m.getName() ?? ""))!;
      const verts = meshPositions(mesh);
      return centroid(verts.filter((v) => v.x >= 0)).x - centroid(verts.filter((v) => v.x < 0)).x;
    };
    const child = MPFB_EYE_ACTORS.find((a) => a.role === "child")!;
    const adults = MPFB_EYE_ACTORS.filter((a) => a.role !== "child");
    const ipdChild = await ipdOf(child);
    const minAdultIpd = Math.min(...(await Promise.all(adults.map(ipdOf))));
    expect(
      ipdChild,
      `child IPD ${(ipdChild * 1000).toFixed(1)} mm must be below the adults' — the measured 52.1 mm scales with stature`,
    ).toBeLessThan(minAdultIpd);
  });

  it("binds a real iris texture — non-trivial, not a flat fill", async () => {
    for (const actor of MPFB_EYE_ACTORS) {
      const doc = await io.read(pathResolve(REPO_ROOT, actor.glb));
      const eyeMesh = doc.getRoot().listMeshes().find((m) => EYE_MESH_RE.test(m.getName() ?? ""));
      expect(eyeMesh, `${actor.id}: no eye mesh`).toBeDefined();

      let iris: { bytes: number; png: { width: number; height: number; sd: number } | null } | null = null;
      for (const material of doc.getRoot().listMaterials()) {
        const bc = material.getBaseColorTexture();
        if (!bc) continue;
        const image = bc.getImage();
        if (!image) continue;
        if (eyeMesh!.listPrimitives().some((p) => p.getMaterial() === material)) {
          iris = { bytes: image.byteLength, png: pngLuminanceSd(image) };
        }
      }
      expect(iris, `${actor.id}: the eye mesh material has no base-color texture`).not.toBeNull();
      expect(
        iris!.bytes,
        `${actor.id}: iris texture ${iris!.bytes} bytes is below the ${MIN_IRIS_BYTES} floor — a stub or a 1x1 PNG`,
      ).toBeGreaterThanOrEqual(MIN_IRIS_BYTES);
      expect(iris!.png, `${actor.id}: iris texture is not a decodable PNG`).not.toBeNull();
      expect(iris!.png!.width, `${actor.id}: iris texture too small`).toBeGreaterThanOrEqual(MIN_IRIS_DIMENSION_PX);
      expect(iris!.png!.height, `${actor.id}: iris texture too small`).toBeGreaterThanOrEqual(MIN_IRIS_DIMENSION_PX);
      expect(
        iris!.png!.sd,
        `${actor.id}: iris luminance sd ${iris!.png!.sd.toFixed(2)} below ${MIN_IRIS_LUMINANCE_SD} — a flat fill carries no iris detail`,
      ).toBeGreaterThanOrEqual(MIN_IRIS_LUMINANCE_SD);
    }
  });

  it("ships eye bones coincident with the clusters they bind", async () => {
    for (const actor of MPFB_EYE_ACTORS) {
      const doc = await io.read(pathResolve(REPO_ROOT, actor.glb));
      const eyeMesh = doc.getRoot().listMeshes().find((m) => EYE_MESH_RE.test(m.getName() ?? ""));
      expect(eyeMesh, `${actor.id}: no eye mesh`).toBeDefined();

      const bones = eyeBoneWorldPositions(doc);
      expect(
        bones.size,
        `${actor.id}: expected exactly 2 eye bones (eye.L/eye.R), found ${bones.size}`,
      ).toBe(2);

      const verts = meshPositions(eyeMesh!);
      const aabbMin = {
        x: Math.min(...verts.map((v) => v.x)),
        y: Math.min(...verts.map((v) => v.y)),
        z: Math.min(...verts.map((v) => v.z)),
      };
      const aabbMax = {
        x: Math.max(...verts.map((v) => v.x)),
        y: Math.max(...verts.map((v) => v.y)),
        z: Math.max(...verts.map((v) => v.z)),
      };

      // Coincidence is per cluster: the bone each cluster's vertices bind must sit inside the
      // eye-mesh AABB (+ margin). MPFB names `.L` joints at world +x, so name-to-side matching is
      // NOT the check — which bone binds which cluster IS.
      const dominant = dominantJointPerSide(eyeMesh!, doc);
      for (const side of ["L", "R"] as const) {
        const boneName = dominant[side];
        expect(boneName, `${actor.id}: ${side} cluster has no dominant joint`).not.toBe("");
        const pos = bones.get(boneName);
        expect(pos, `${actor.id}: dominant bone ${boneName} is not an eye bone`).toBeDefined();
        expect(
          pos!.x,
          `${actor.id}: ${side}-cluster bone ${boneName} x=${pos!.x.toFixed(4)} outside eye AABB + margin`,
        ).toBeGreaterThanOrEqual(aabbMin.x - BONE_COINCIDENCE_MARGIN_METERS);
        expect(pos!.x).toBeLessThanOrEqual(aabbMax.x + BONE_COINCIDENCE_MARGIN_METERS);
        expect(pos!.y).toBeGreaterThanOrEqual(aabbMin.y - BONE_COINCIDENCE_MARGIN_METERS);
        expect(pos!.y).toBeLessThanOrEqual(aabbMax.y + BONE_COINCIDENCE_MARGIN_METERS);
        expect(pos!.z).toBeGreaterThanOrEqual(aabbMin.z - BONE_COINCIDENCE_MARGIN_METERS);
        expect(pos!.z).toBeLessThanOrEqual(aabbMax.z + BONE_COINCIDENCE_MARGIN_METERS);
      }
    }
  });

  it("resolves the eye-touching FACS morphs through the runtime resolver", async () => {
    for (const actor of MPFB_EYE_ACTORS) {
      const doc = await io.read(pathResolve(REPO_ROOT, actor.glb));
      const available = bodyMorphNames(doc);
      for (const facs of EYE_FACS_NAMES) {
        expect(available.has(facs), `${actor.id}: the shipped body has no ${facs} morph target`).toBe(true);
      }
      for (const canonical of EYE_CANONICAL_NAMES) {
        const resolved = resolveMorphTarget(canonical, available);
        expect(
          resolved,
          `${actor.id}: ${canonical} does not resolve — the runtime cannot reach the eye morph`,
        ).not.toBeNull();
        expect(
          resolved!.includes("eye"),
          `${actor.id}: ${canonical} resolved to ${resolved}, which is not an eye-region target — the #308 wrong-region failure mode`,
        ).toBe(true);
      }
    }
  });

  it("records the pre-fix before-column with the motivating on-screen size", () => {
    const preFix = readMpfbEyesPreFix(REPO_ROOT);
    expect(preFix.schemaVersion).toBe("openclinxr.mpfb-eyes.pre-fix.v1");
    expect(preFix.actors.length).toBe(MPFB_EYE_ACTORS.length);
    for (const actor of MPFB_EYE_ACTORS) {
      const row = preFix.actors.find((a) => a.actorId === actor.id);
      expect(row, `pre-fix.json missing actor ${actor.id}`).toBeDefined();
      expect(row!.eyeMesh.vertexCount, `${actor.id}: pre-fix eye vertex count`).toBeGreaterThanOrEqual(64);
      expect(row!.irisTexture.bytes, `${actor.id}: pre-fix iris bytes`).toBeGreaterThanOrEqual(MIN_IRIS_BYTES);
      expect(
        row!.projectedFullBodyPixels.irisEstimatePx,
        `${actor.id}: pre-fix iris estimate ${row!.projectedFullBodyPixels.irisEstimatePx} px is not the single-digit motivating measurement`,
      ).toBeLessThan(10);
    }
  });

  it("produces the eye crops at >= 512x512", () => {
    const required = [
      "aisha-eye-front.png",
      "aisha-eye-side.png",
      "kevin-eye-front.png",
      "child-eye-front.png",
    ];
    for (const name of required) {
      const p = pathResolve(REPO_ROOT, MPFB_EYES_EVIDENCE_ROOT, name);
      const dims = pngDimensionsFromFile(p);
      expect(dims, `${name} missing or not a PNG — run the eye-crop runner`).not.toBeNull();
      expect(dims!.width, `${name} too narrow (${dims!.width}px)`).toBeGreaterThanOrEqual(MIN_CROP_DIMENSION_PX);
      expect(dims!.height, `${name} too short (${dims!.height}px)`).toBeGreaterThanOrEqual(MIN_CROP_DIMENSION_PX);
    }
  });
});
