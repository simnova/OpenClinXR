/**
 * #276 humanoid body-signature inspector — which rail produces the bodies a learner meets.
 *
 * Recomputed live from the shipped GLBs under `apps/ui-xr/public/generated-humanoids/`
 * (never copied from the issue). The test recomputes the same table and asserts the
 * `pre-fix.json` artifact still matches — a future change that makes bodies distinct
 * goes RED until the artifact is regenerated (#166/#273 staleness trap).
 *
 * diagnosis: case (c) — the Anny rail HAS a phenotype→geometry forward pass
 * (`generate_mesh.py::build_real_anny_body`, real Anny model with phenotype_kwargs),
 * but every shipped Anny GLB is a `blender_only_rebake_on_tracked_real_anny_base_obj_v1`
 * (provenance `notRun: [anny_forward_pass, orchestrate_character, ...]`) that copies one
 * of two tracked base OBJs per actor. Per-actor phenotype therefore never reaches a vertex.
 *
 * claimScope: body-signature identity + rail attribution of shipped generated-humanoids.
 * notEvidenceFor: clinical realism, garment quality, Quest readiness, Anny licence posture,
 *                 whether the Anny model would produce a delta IF re-run today.
 *
 * #331 (2026-08-11): the body is now resolved by IDENTITY — the morph-carrying mesh — via
 * `resolveHumanoidBodyMesh` (packages/openclinxr/asset-registry/src/humanoid-body-mesh.ts),
 * not by being the largest mesh. #324's fitted footwear outgrew the basemesh on the library
 * rails, so the old largest-by-vertex pick recorded a shoe as the body signature and every
 * identity-derived field (sha, height, class key) silently described a shoe. SIZE IS NOT
 * IDENTITY. The field records the resolved body; the largest-mesh fallback survives only for
 * morph-less assets.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { resolveHumanoidBodyMesh } from "../../../packages/openclinxr/asset-registry/src/humanoid-body-mesh.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const GENERATED_HUMANOIDS_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids",
);
export const ISSUE_276_EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-276");
export const PRE_FIX_PATH = path.join(ISSUE_276_EVIDENCE_DIR, "pre-fix.json");
export const RAIL_DIAGNOSIS_PATH = path.join(ISSUE_276_EVIDENCE_DIR, "rail-diagnosis.json");

export const DIAGNOSIS_CASES = ["a", "b", "c", "d"] as const;
export type DiagnosisCase = (typeof DIAGNOSIS_CASES)[number];

export type BodyAssetSignature = {
  file: string;
  /** The body mesh, resolved by identity (the morph-carrying mesh) — #331. Not "the largest mesh". */
  bodyMeshName: string;
  triangles: number;
  vertices: number;
  /** Height of the body mesh in metres (maxY - minY over POSITION). */
  heightMeters: number;
  /** Order-invariant sha256 of the body mesh's positions (5dp, sorted). */
  bodySha256: string;
  /**
   * Body-class key = topology + stature (vertices|triangles|height rounded to 1 cm).
   * This is what makes "the six adults are two bodies" true: within a class the
   * bodies differ only by sub-centimetre garment-offset noise (~7 µm mean), not by
   * phenotype. Deliberately NOT a uniform-scale escape hatch — height is in the key,
   * so scaling one mesh to two heights yields two classes.
   */
  bodyClassKey: string;
};

export type BodySignatureGroup = {
  bodyClassKey: string;
  triangles: number;
  vertices: number;
  heightMeters: number;
  /** Distinct exact body fingerprints within the class (normally 1; 2+ when offsets differ). */
  distinctSha256: string[];
  assets: string[];
};

export type PreFixArtifact = {
  schemaVersion: "openclinxr.humanoid-body-signature-pre-fix.v1";
  issue: 276;
  measuredAt: string;
  scanRoot: string;
  assets: BodyAssetSignature[];
  groups: BodySignatureGroup[];
  diagnosisCase: DiagnosisCase;
  claimScope: string;
  notEvidenceFor: string[];
};

export type RailDiagnosisArtifact = {
  schemaVersion: "openclinxr.rail-diagnosis.v1";
  issue: 276;
  measuredAt: string;
  diagnosis: {
    case: DiagnosisCase;
    label: string;
    oneLine: string;
  };
  evidenceFor: string[];
  excludes: Record<
    Exclude<DiagnosisCase, "c">,
    { ruledOutBy: string; evidence: string[] }
  >;
  counterweight: string;
  obviousFixIfAny: string;
  notRun: string[];
  claimScope: string;
  notEvidenceFor: string[];
};

function canonSig(positions: ArrayLike<number>): string {
  const pts: string[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = Math.round(positions[i]! * 1e5) / 1e5;
    const y = Math.round(positions[i + 1]! * 1e5) / 1e5;
    const z = Math.round(positions[i + 2]! * 1e5) / 1e5;
    pts.push(`${x},${y},${z}`);
  }
  pts.sort();
  return createHash("sha256").update(pts.join("|")).digest("hex");
}

function bodyMeshOf(doc: Awaited<ReturnType<NodeIO["read"]>>): {
  name: string;
  triangles: number;
  vertices: number;
  heightMeters: number;
  sha: string;
} {
  const meshes = doc.getRoot().listMeshes();
  const candidates = meshes.map((mesh) => {
    const name = mesh.getName() || "(unnamed)";
    let v = 0;
    let t = 0;
    let morphs = 0;
    let skinned = false;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices();
      if (pos) v += pos.getCount();
      if (idx) t += idx.getCount() / 3;
      morphs = Math.max(morphs, prim.listTargets().length);
      if (prim.getAttribute("JOINTS_0")) skinned = true;
    }
    return { name, triangleCount: t, morphTargetCount: morphs, skinned, vertices: v, triangles: t, mesh };
  });

  // #331: the body is identified by what it is (the morph-carrying mesh), not
  // by being biggest. #324's fitted footwear (28,800 tris) outgrew the basemesh
  // (26,756) on the library rails, so the old largest-by-vertex pick silently
  // recorded a shoe as the body signature. The largest-mesh fallback survives
  // only for morph-less assets, where no identity signal exists.
  const resolved = resolveHumanoidBodyMesh(candidates);
  const body = resolved
    ?? [...candidates].sort((a, b) => b.vertices - a.vertices)[0]
    ?? { name: "", triangleCount: 0, morphTargetCount: 0, skinned: false, vertices: 0, triangles: 0, mesh: null };

  let minY = Infinity;
  let maxY = -Infinity;
  let sha = "";
  if (body.mesh) {
    for (const prim of body.mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      if (arr.length > 0) {
        sha = canonSig(arr);
      }
      for (let i = 0; i + 2 < arr.length; i += 3) {
        const y = arr[i + 1]!;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    name: body.name,
    triangles: body.triangles,
    vertices: body.vertices,
    heightMeters: maxY > minY ? maxY - minY : 0,
    sha,
  };
}

/** Live scan of every GLB under generated-humanoids/. No caches, no artifacts read. */
export async function scanShippedHumanoidBodies(): Promise<{
  assets: BodyAssetSignature[];
  groups: BodySignatureGroup[];
}> {
  const io = new NodeIO();
  const files = readdirSync(GENERATED_HUMANOIDS_DIR)
    .filter((f) => f.endsWith(".glb"))
    .sort();
  const assets: BodyAssetSignature[] = [];
  for (const file of files) {
    const doc = await io.read(path.join(GENERATED_HUMANOIDS_DIR, file));
    const body = bodyMeshOf(doc);
    assets.push({
      file,
      bodyMeshName: body.name,
      triangles: body.triangles,
      vertices: body.vertices,
      heightMeters: body.heightMeters,
      bodySha256: body.sha,
      bodyClassKey: `${body.vertices}|${body.triangles}|${Math.round(body.heightMeters * 100) / 100}`,
    });
  }
  const byKey = new Map<string, BodySignatureGroup>();
  for (const a of assets) {
    const group = byKey.get(a.bodyClassKey) ?? {
      bodyClassKey: a.bodyClassKey,
      triangles: a.triangles,
      vertices: a.vertices,
      heightMeters: a.heightMeters,
      distinctSha256: [] as string[],
      assets: [] as string[],
    };
    if (a.bodySha256 && !group.distinctSha256.includes(a.bodySha256)) {
      group.distinctSha256.push(a.bodySha256);
    }
    group.assets.push(a.file);
    byKey.set(a.bodyClassKey, group);
  }
  const groups: BodySignatureGroup[] = [...byKey.values()]
    .map((g) => ({ ...g, assets: [...g.assets].sort() }))
    .sort((x, y) => y.assets.length - x.assets.length || x.bodyClassKey.localeCompare(y.bodyClassKey));
  return { assets, groups };
}

/**
 * The rail diagnosis, as measured this slice. Named (c) with evidence that excludes
 * (a), (b) and (d). Kept as a separate function so the test asserts the artifact names
 * exactly one case without the artifact being able to drift from the measurement.
 */
export function railDiagnosisMeasured(): RailDiagnosisArtifact {
  return {
    schemaVersion: "openclinxr.rail-diagnosis.v1",
    issue: 276,
    measuredAt: new Date().toISOString(),
    diagnosis: {
      case: "c",
      label:
        "The Anny rail HAS a phenotype→geometry path (generate_mesh.py::build_real_anny_body runs the real Anny model with phenotype_kwargs), but casting still points THREE of six adult actors at prebuilt GLBs produced from ONE tracked base body — those provenance records remain blender-only re-bakes (generatorMode blender_only_rebake_on_tracked_real_anny_base_obj_v1, notRun includes anny_forward_pass) that copy a base OBJ per actor and never re-run the forward pass. The peds parent and peds nurse were re-orchestrated from their own phenotypes on 2026-08-11 (#303): anny 0.6.0 is installed, so that path now takes the real forward pass and produced bodies distinct from every other actor's.",
      oneLine:
        "It is case (c): the path exists and now works (proven by #303 re-orchestrating the peds parent and nurse), and the remaining three adult actors still point at prebuilt assets built from one prebuilt body — per-actor phenotype still never reaches a vertex for them.",
    },
    evidenceFor: [
      "gltf NodeIO: 3 assets share 26,692 t / 13,876 v / H=1.76m (adult_male_street_casual, ed_chest_pain_adult_cast, ed_chest_pain_nurse_adult); ed_chest_pain_spouse_adult is alone at 26,692 t / 13,872 v / H=1.66m; peds_anxious_parent is alone at 26,692 t / 13,884 v / H=1.66m and peds_nurse_kevin is alone at 26,692 t / 13,892 v / H=1.76m (both re-orchestrated #303); child 27,420 t / 14,268 v / H=1.25m; MPFB 36,972 t / 22,030 v.",
      "order-invariant body signatures: the three adult male assets (adult_male_street_casual, ed_chest_pain_adult_cast, ed_chest_pain_nurse_adult) are byte-identical geometry; the spouse/parent and nurse/ED-nurse pairs are NO LONGER identical — peds_anxious_parent.anny_base.obj sha256 29c1fe5dc379…, peds_nurse_kevin.anny_base.obj 1124ef98b6ee…, ed_chest_pain_spouse_adult.anny_base.obj f704763db502… (measured 2026-08-11 after #303).",
      "base OBJs: adult_male_street_casual / ed_chest_pain_adult_cast / ed_chest_pain_nurse_adult copies are byte-identical (sha256 fa13b6a5…); ed_chest_pain_spouse_adult.anny_base.obj is f704763db502…; peds_anxious_parent.anny_base.obj is 29c1fe5dc379… and peds_nurse_kevin.anny_base.obj is 1124ef98b6ee… (each its own forward pass).",
      "provenance split after #303: peds_anxious_parent.provenance.json and peds_nurse_kevin.provenance.json derivationMode=orchestrate, generatorMode=real_anny_local_forward_pass_plus_blender_procedural; the other four Anny GLBs still record generatorMode blender_only_rebake_on_tracked_real_anny_base_obj_v1 and licenseChain.notRun = [anny_forward_pass, orchestrate_character, licence_text_reenumeration, mesh_regeneration_from_anny_package].",
      "tools/openclinxr/asset-pipeline/anny/rebake_role_wardrobe_blender_only.py hardcodes the role→base map: ED patient/ED nurse/male street → peds_nurse_kevin.anny_base.obj; ED spouse → peds_anxious_parent.anny_base.obj; child → peds_patient_child.anny_base.obj. Header: 'Does NOT call generate_mesh / anny'.",
      "runtime casting (apps/ui-xr/src/humanoid-runtime-asset-url.ts + packages/openclinxr/asset-registry/src/actor-casting.ts) maps the six adult actors to those six prebuilt GLB files; within-scenario distinctness is by filename only — three of the six files are one body (class 13876v/1.76m).",
    ],
    excludes: {
      a: {
        ruledOutBy:
          "The Anny rail has a phenotype→geometry path in code: generate_mesh.py::build_real_anny_body (line ~303) calls anny.create_fullbody_model(...) and passes phenotype_kwargs (gender/age/height/weight/muscle/proportions) into the model. It is not a stub-only rail.",
        evidence: [
          "tools/openclinxr/asset-pipeline/anny/generate_mesh.py:303 build_real_anny_body → normalized_anny_phenotype(params, model.phenotype_labels, ...) → model(pose_parameters, phenotype_kwargs, local_changes_kwargs).",
          "The two distinct adult base OBJs (source_height 1.6728 vs 1.7000 in the anny_forward_pass manifest block) prove a forward pass with different phenotype inputs DID produce different geometry when it ran.",
        ],
      },
      b: {
        ruledOutBy:
          "The forward pass is NOT invoked in the production of the remaining shared assets — their provenance records notRun: [anny_forward_pass, orchestrate_character, mesh_regeneration_from_anny_package], and the rebake script explicitly does not call generate_mesh/anny. (b) requires 'invoked and produces no delta'; neither half holds for them. When the forward pass IS invoked the model produces a delta: #303 re-orchestrated the peds parent and nurse on 2026-08-11 (anny 0.6.0 installed) and got bodies distinct from every other actor's (parent waist 0.6683 vs spouse 0.7167 m; nurse OBJ sha 1124ef98b6ee… vs the shared ED-nurse body fa13b6a5…).",
        evidence: [
          "apps/ui-xr/public/generated-humanoids/{adult_male_street_casual,ed_chest_pain_adult_cast,ed_chest_pain_nurse_adult,ed_chest_pain_spouse_adult}.provenance.json generatorMode=blender_only_rebake_on_tracked_real_anny_base_obj_v1, licenseChain.notRun lists anny_forward_pass.",
          "tools/openclinxr/asset-pipeline/anny/rebake_role_wardrobe_blender_only.py: 'Does NOT call generate_mesh / anny (absent → silent ~0.8 MB stubs).'",
          "#303: peds_anxious_parent + peds_nurse_kevin re-orchestrated via orchestrate_character.py --case-actor-preset peds_asthma_parent_anxiety_v1:parent_tara_johnson_v1 / :nurse_kevin_lee_v1 (real forward pass, provenance derivationMode=orchestrate) — bodies no longer byte-identical to the spouse's / ED nurse's (OBJ sha 29c1fe5d… and 1124ef98b6ee…).",
        ],
      },
      d: {
        ruledOutBy:
          "hm08 bodies ARE castable into a station today: the ED spouse resolves to the hm08 body-param MakeClothes library GLB (LIBRARY_ADULT_LEAN_FEMALE_RUNTIME_PATH = /xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb) in both the runtime table and the actor-casting SSOT (#272 consumption). It is under-consumed (one actor), not unable to be cast.",
        evidence: [
          "apps/ui-xr/src/humanoid-runtime-asset-url.ts ED_RUNTIME_CAST_BY_ACTOR.spouse_anna_hayes_v1 = LIBRARY_ADULT_LEAN_FEMALE_RUNTIME_PATH.",
          "packages/openclinxr/asset-registry/src/actor-casting.ts:349 'stage ONE library body via ordinary cast resolution (spouse only)'.",
        ],
      },
    },
    counterweight:
      "Do not make bodies differ by uniform scaling of one mesh — a uniform scale changes every dimension and passes a naive vertex-signature check while producing the same person at two sizes. Independent variation (e.g. girth spread at fixed height, the way #151's body_param stage measured 8.76 cm) is required, and garments must be re-fitted per body class since they are fitted to a specific basemesh state.",
    obviousFixIfAny:
      "Path (1) is now PROVEN: run orchestrate_character.py's real Anny forward pass per-actor phenotype to produce per-actor base OBJs, then rebake wardrobes — #303 executed it for the peds parent and nurse on 2026-08-11 (anny 0.6.0 installed) and both bodies came out distinct and matching their own phenotypes. It remains blocked for the other three shared adults (adult_male_street_casual, ed_chest_pain_adult_cast, ed_chest_pain_nurse_adult) only because they have no authored preset — that is #293's authoring gap, not a pipeline blocker. Path (2) — extend the cast to the proven hm08 body_param bodies (body-param-adult_lean_female-library.glb / adult_heavy_male, which differ by a measured 8.76 cm girth spread) — remains available for any adult role, the way #272 staged one library body on the ED spouse.",
    notRun: ["anny_forward_pass", "orchestrate_character", "mesh_regeneration_from_anny_package"],
    claimScope: "rail attribution of shipped generated-humanoids body signatures, measured 2026-08-10 and re-measured 2026-08-11 after the #303 parent+nurse re-orchestrations.",
    notEvidenceFor: [
      "whether the remaining three Anny assets would produce a vertex delta if re-run today (no preset exists for them; #293)",
      "clinical realism or garment quality",
      "Quest readiness",
      "anny licence posture",
    ],
  };
}

/** Write both artifacts from a live scan. Caller (CLI/test) never hand-writes them. */
export async function writeIssue276Artifacts(): Promise<void> {
  mkdirSync(ISSUE_276_EVIDENCE_DIR, { recursive: true });
  const { assets, groups } = await scanShippedHumanoidBodies();
  const diagnosis = railDiagnosisMeasured();
  const preFix: PreFixArtifact = {
    schemaVersion: "openclinxr.humanoid-body-signature-pre-fix.v1",
    issue: 276,
    measuredAt: new Date().toISOString(),
    scanRoot: "apps/ui-xr/public/generated-humanoids",
    assets,
    groups,
    diagnosisCase: diagnosis.diagnosis.case,
    claimScope: "per-asset body signature of shipped generated-humanoids, recomputed live",
    notEvidenceFor: [
      "clinical realism",
      "garment quality",
      "quest readiness",
      "whether a future re-run of the Anny model would differ",
    ],
  };
  writeFileSync(PRE_FIX_PATH, JSON.stringify(preFix, null, 2) + "\n", "utf8");
  writeFileSync(RAIL_DIAGNOSIS_PATH, JSON.stringify(diagnosis, null, 2) + "\n", "utf8");
}

export function readPreFixArtifact(): PreFixArtifact | null {
  if (!existsSync(PRE_FIX_PATH)) return null;
  return JSON.parse(readFileSync(PRE_FIX_PATH, "utf8")) as PreFixArtifact;
}

export function readRailDiagnosisArtifact(): RailDiagnosisArtifact | null {
  if (!existsSync(RAIL_DIAGNOSIS_PATH)) return null;
  return JSON.parse(readFileSync(RAIL_DIAGNOSIS_PATH, "utf8")) as RailDiagnosisArtifact;
}

const argv1 = process.argv[1];
if (argv1 && import.meta.url === pathToFileURL(argv1).href) {
  await writeIssue276Artifacts();
  const pre = readPreFixArtifact();
  console.log(
    `[humanoid-body-signature] wrote pre-fix.json (${pre?.assets.length ?? 0} assets, ` +
      `${pre?.groups.length ?? 0} body groups) and rail-diagnosis.json (case ${pre?.diagnosisCase ?? "?"})`,
  );
}
