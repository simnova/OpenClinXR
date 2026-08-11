/**
 * #278 — cast the two proven hm08 library bodies (body_param rail) into matching adult slots.
 *
 * Route 2 from #276: the hm08 body_param library GLBs under candidates/ differ by a measured
 * 8.76 cm girth spread (#151) and are fully dressed (per-class fitted scrub shirt + cargo pants,
 * #277 coverage gate), carry a bounds-derived scalp region (#279) and embedded footwear.
 * This module MEASURES, never asserts product decisions:
 *
 *   --pre-fix    resolve every adult slot across shipped scenarios, read the resolved GLB's body
 *                signature, and write .openclinxr/evidence/issue-278/pre-fix.json. MUST run before
 *                any product edit (§7p — the before-column).
 *
 *   --cast-report  after the cast change, for each re-cast actor record: body signature before
 *                (from pre-fix.json) vs after (from the current cast), garment coverage of the
 *                library body (the shared predicate from #272/#277), scalp region presence (#279)
 *                and embedded footwear. Writes .openclinxr/evidence/issue-278/cast-report.json.
 *
 * claimScope: per-adult-slot body signature of the resolved cast on 2026-08-10; per re-cast actor
 *             the body-signature delta and survival of garment/scalp/footwear on the library body.
 * notEvidenceFor: clinical realism, garment aesthetics, clinical wardrobe suitability, Quest
 *             readiness, sex from names (actor records carry NO structured sex/gender field — only
 *             displayName, per the #102 finding); the uniform-scale check here is a proxy (height
 *             preserved + vertex/triangle counts differ), not a full anti-scale proof.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
  type ScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { inspectGarmentCoversItsRegion } from "./garment-covers-its-region.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-278");
export const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");
export const CAST_REPORT_PATH = path.join(EVIDENCE_DIR, "cast-report.json");

const RE_CAST_ACTOR_IDS = new Set(["parent_tara_johnson_v1", "nurse_kevin_lee_v1"]);

/**
 * Actor id → sex cue, name-derived only (#102: no structured sex field exists on actor records).
 * These are the ONLY adult roles considered for re-casting; the cue is documentation for why a
 * slot was chosen, never a machine claim.
 */
const SEX_CUE_BY_ACTOR_ID: Record<string, "female" | "male"> = {
  patient_robert_hayes_v1: "male",
  nurse_maria_alvarez_v1: "female",
  spouse_anna_hayes_v1: "female",
  parent_tara_johnson_v1: "female",
  nurse_kevin_lee_v1: "male",
  patient_aisha_khan_v1: "female",
  ob_nurse_williams_v1: "female",
  partner_omar_khan_v1: "male",
};

export type BodySignature = {
  largestMeshName: string;
  triangles: number;
  vertices: number;
  heightMeters: number;
  /** Order-invariant sha256 of the largest mesh's positions (5dp, sorted) — same key as #276. */
  bodySha256: string;
  /** topology|stature class key — deliberately includes height, so a uniform scale yields a new class. */
  bodyClassKey: string;
};

export type AdultSlotMeasurement = {
  scenarioId: string;
  actorId: string;
  role: string;
  resolvedAssetPath: string;
  sexCue: "female" | "male" | "unknown";
  signature: BodySignature;
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

export function signatureOfGlb(doc: Awaited<ReturnType<NodeIO["read"]>>): BodySignature {
  let largestName = "";
  let largestCount = 0;
  let triangles = 0;
  let vertices = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "(unnamed)";
    let v = 0;
    let t = 0;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices();
      if (pos) v += pos.getCount();
      if (idx) t += idx.getCount() / 3;
    }
    if (v > largestCount) {
      largestCount = v;
      largestName = name;
      triangles = t;
      vertices = v;
    }
  }
  let minY = Infinity;
  let maxY = -Infinity;
  let sha = "";
  for (const mesh of doc.getRoot().listMeshes()) {
    if ((mesh.getName() || "") !== largestName) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      if (arr.length > 0) sha = canonSig(arr);
      for (let i = 0; i + 2 < arr.length; i += 3) {
        const y = arr[i + 1]!;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const heightMeters = maxY > minY ? maxY - minY : 0;
  return {
    largestMeshName: largestName,
    triangles,
    vertices,
    heightMeters,
    bodySha256: sha,
    bodyClassKey: `${vertices}|${triangles}|${Math.round(heightMeters * 100) / 100}`,
  };
}

function absFromRepo(relOrAbs: string): string {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(REPO_ROOT, relOrAbs);
}

async function measureSlot(scenarioId: string, entry: ScenarioActorCast): Promise<AdultSlotMeasurement> {
  const abs = absFromRepo(entry.assetPath);
  if (!existsSync(abs)) {
    throw new Error(`issue-278-cast: missing GLB ${entry.assetPath}`);
  }
  const doc = await new NodeIO().read(abs);
  return {
    scenarioId,
    actorId: entry.actorId,
    role: entry.role,
    resolvedAssetPath: entry.assetPath,
    sexCue: SEX_CUE_BY_ACTOR_ID[entry.actorId] ?? "unknown",
    signature: signatureOfGlb(doc),
  };
}

/** Every adult slot across shipped scenarios, resolved through the current cast SSOT. */
export async function measureAllAdultSlots(): Promise<AdultSlotMeasurement[]> {
  const out: AdultSlotMeasurement[] = [];
  for (const scenarioId of listShippedCastScenarioIds()) {
    const cast = resolveScenarioActorCast(scenarioId);
    for (const entry of cast) {
      if (entry.declaredAgeBand !== "adult") continue;
      out.push(await measureSlot(scenarioId, entry));
    }
  }
  out.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId) || a.actorId.localeCompare(b.actorId));
  return out;
}

export type ReCastRow = {
  scenarioId: string;
  actorId: string;
  role: string;
  sexCue: "female" | "male" | "unknown";
  beforeAssetPath: string;
  afterAssetPath: string;
  signatureChanged: boolean;
  beforeSignature: BodySignature;
  afterSignature: BodySignature;
  /** The uniform-scale escape hatch: same body height must NOT be the only axis of change. */
  notUniformScale: {
    heightSameMeters: boolean;
    topologyCountsDiffer: boolean;
  };
  /** Garment coverage rows from the #272/#277 shared predicate, measured on the library GLB. */
  coverage: {
    lower: { garmentMeshName: string | null; triangleCount: number; verdict: string | null };
    upper: { garmentMeshName: string | null; triangleCount: number; verdict: string | null };
  };
  scalpRegion: {
    present: boolean;
    minHeightFraction: number | null;
    maxAnteriorFraction: number | null;
  };
  footwearMeshNames: string[];
};

type ScalpInfo = { present: boolean; minHeightFraction: number | null; maxAnteriorFraction: number | null };

export async function scalpRegionOfGlb(doc: Awaited<ReturnType<NodeIO["read"]>>): Promise<ScalpInfo> {
  const SCALP_HAIR_MATERIAL = /scalp_hair/i;
  const meshes = doc.getRoot().listMeshes();
  const triangleCount = (mesh: (typeof meshes)[number]): number =>
    mesh.listPrimitives().reduce((total, prim) => total + (prim.getIndices()?.getCount() ?? 0) / 3, 0);
  const body = [...meshes].sort((a, b) => triangleCount(b) - triangleCount(a))[0];
  if (!body) return { present: false, minHeightFraction: null, maxAnteriorFraction: null };

  let bodyMin = [Infinity, Infinity, Infinity];
  let bodyMax = [-Infinity, -Infinity, -Infinity];
  for (const prim of body.listPrimitives()) {
    const position = prim.getAttribute("POSITION");
    if (!position) continue;
    for (let i = 0; i < position.getCount(); i += 1) {
      const v = [0, 0, 0];
      position.getElement(i, v);
      for (let axis = 0; axis < 3; axis += 1) {
        bodyMin[axis] = Math.min(bodyMin[axis], v[axis]);
        bodyMax[axis] = Math.max(bodyMax[axis], v[axis]);
      }
    }
  }
  const height = Math.max(bodyMax[1] - bodyMin[1], 1e-6);
  const anterior = Math.max(Math.abs(bodyMax[2]), 1e-6);

  const scalpPrimitive = body
    .listPrimitives()
    .find((prim) => SCALP_HAIR_MATERIAL.test(prim.getMaterial()?.getName() ?? ""));
  if (!scalpPrimitive) return { present: false, minHeightFraction: null, maxAnteriorFraction: null };

  const position = scalpPrimitive.getAttribute("POSITION");
  if (!position) return { present: false, minHeightFraction: null, maxAnteriorFraction: null };
  let minY = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < position.getCount(); i += 1) {
    const v = [0, 0, 0];
    position.getElement(i, v);
    minY = Math.min(minY, v[1]);
    maxZ = Math.max(maxZ, v[2]);
  }
  return {
    present: true,
    minHeightFraction: (minY - bodyMin[1]) / height,
    maxAnteriorFraction: maxZ / anterior,
  };
}

function footwearOfGlb(doc: Awaited<ReturnType<NodeIO["read"]>>): string[] {
  return doc
    .getRoot()
    .listMeshes()
    .map((m) => m.getName() || "")
    .filter((n) => /footwear/i.test(n))
    .sort();
}

/** Build cast-report.json — must run AFTER the cast change. */
export async function buildCastReport(): Promise<unknown> {
  const preFix = JSON.parse(readFileSync(PRE_FIX_PATH, "utf8")) as {
    adultSlots: AdultSlotMeasurement[];
  };
  const beforeByActor = new Map(preFix.adultSlots.map((s) => [s.actorId, s]));

  // Shared #272/#277 coverage predicate over the two shipped library GLBs.
  const coverageReport = await inspectGarmentCoversItsRegion();
  const coverageByClass = new Map(coverageReport.figures.map((f) => [f.bodyClassId, f]));

  const rows: ReCastRow[] = [];
  const io = new NodeIO();
  for (const scenarioId of listShippedCastScenarioIds()) {
    const cast = resolveScenarioActorCast(scenarioId);
    for (const entry of cast) {
      if (!RE_CAST_ACTOR_IDS.has(entry.actorId)) continue;
      const before = beforeByActor.get(entry.actorId);
      if (!before) {
        throw new Error(`cast-report: no pre-fix row for ${entry.actorId}`);
      }
      const afterDoc = await io.read(absFromRepo(entry.assetPath));
      const afterSignature = signatureOfGlb(afterDoc);
      const bodyClassId = entry.assetPath.includes("adult_lean_female")
        ? "adult_lean_female"
        : entry.assetPath.includes("adult_heavy_male")
          ? "adult_heavy_male"
          : "unknown";
      const coverage = coverageByClass.get(bodyClassId);
      const scalp = await scalpRegionOfGlb(afterDoc);
      rows.push({
        scenarioId,
        actorId: entry.actorId,
        role: entry.role,
        sexCue: before.sexCue,
        beforeAssetPath: before.resolvedAssetPath,
        afterAssetPath: entry.assetPath,
        signatureChanged:
          before.signature.bodyClassKey !== afterSignature.bodyClassKey
          || before.signature.bodySha256 !== afterSignature.bodySha256,
        beforeSignature: before.signature,
        afterSignature,
        notUniformScale: {
          heightSameMeters:
            Math.abs(before.signature.heightMeters - afterSignature.heightMeters) < 0.02,
          topologyCountsDiffer:
            before.signature.vertices !== afterSignature.vertices
            || before.signature.triangles !== afterSignature.triangles,
        },
        coverage: {
          lower: {
            garmentMeshName: coverage?.lowerGarmentMeshName ?? null,
            triangleCount: coverage?.lowerGarmentTriangleCount ?? 0,
            verdict: coverage?.lower?.verdict ?? null,
          },
          upper: {
            garmentMeshName: coverage?.upperGarmentMeshName ?? null,
            triangleCount: coverage?.upperGarmentTriangleCount ?? 0,
            verdict: coverage?.upper?.verdict ?? null,
          },
        },
        scalpRegion: scalp,
        footwearMeshNames: footwearOfGlb(afterDoc),
      });
    }
  }
  rows.sort((a, b) => a.actorId.localeCompare(b.actorId));

  const report = {
    schemaVersion: "openclinxr.issue-278.cast-report.v1",
    issue: 278,
    measuredAt: new Date().toISOString(),
    claimScope:
      "per re-cast actor: body signature changed vs pre-fix, and garment coverage / scalp region / footwear survive on the library body (all measured from shipped GLBs)",
    notEvidenceFor: [
      "clinical realism or clinical wardrobe suitability of the library garment",
      "garment aesthetics",
      "quest readiness",
      "sex from names (no structured sex field exists)",
    ],
    reCastActors: rows,
    /**
     * Anti-uniform-scale evidence (#278 Do NOT): the two library bodies differ in stature
     * (3.51 cm, #304 — macro-driven, no longer forced onto one shared reference) AND in torso
     * girth by 7.45 cm (measured #151), and each differs in topology from the Anny bodies it
     * replaces (MakeHuman basemesh 13,380 verts vs Anny 13,876/13,872). A uniform scale of one
     * mesh would move height and girth together; these move independently. Girth and height are
     * read from the body-param catalog, not invented here.
     */
    libraryBodyEvidence: [
      {
        bodyClassId: "adult_lean_female",
        heightMeters: 1.732452631,
        torsoGirthProxyMeters: 0.491029433,
      },
      {
        bodyClassId: "adult_heavy_male",
        heightMeters: 1.697401166,
        torsoGirthProxyMeters: 0.565570614,
      },
    ],
    coverageBaseline: coverageReport.figures.map((f) => ({
      bodyClassId: f.bodyClassId,
      lowerVerdict: f.lower?.verdict ?? null,
      upperVerdict: f.upper?.verdict ?? null,
    })),
  };
  return report;
}

async function writePreFix(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const adultSlots = await measureAllAdultSlots();
  const groups = new Map<string, { bodyClassKey: string; assets: string[]; actors: string[] }>();
  for (const slot of adultSlots) {
    const g = groups.get(slot.signature.bodyClassKey) ?? {
      bodyClassKey: slot.signature.bodyClassKey,
      assets: [] as string[],
      actors: [] as string[],
    };
    if (!g.assets.includes(slot.resolvedAssetPath)) g.assets.push(slot.resolvedAssetPath);
    if (!g.actors.includes(slot.actorId)) g.actors.push(slot.actorId);
    groups.set(slot.signature.bodyClassKey, g);
  }
  const artifact = {
    schemaVersion: "openclinxr.issue-278.pre-fix.v1",
    issue: 278,
    measuredAt: new Date().toISOString(),
    claimScope: "per-adult-slot body signature of the resolved cast, measured live from shipped GLBs, before any cast edit",
    notEvidenceFor: ["clinical realism", "garment quality", "quest readiness"],
    adultSlots,
    signatureGroups: [...groups.values()].sort((a, b) => b.actors.length - a.actors.length),
  };
  writeFileSync(PRE_FIX_PATH, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  console.log(`[issue-278] wrote pre-fix.json (${adultSlots.length} adult slots, ${groups.size} signature groups)`);
}

async function writeCastReport(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const report = await buildCastReport();
  writeFileSync(CAST_REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`[issue-278] wrote cast-report.json (${(report as { reCastActors: unknown[] }).reCastActors.length} re-cast actors)`);
}

const argv = process.argv.slice(2);
const argv1 = process.argv[1];
if (argv1 && import.meta.url === pathToFileURL(argv1).href) {
  if (argv.includes("--pre-fix")) {
    await writePreFix();
  } else if (argv.includes("--cast-report")) {
    await writeCastReport();
  } else {
    console.error("usage: tsx issue-278-cast.ts --pre-fix | --cast-report");
    process.exitCode = 2;
  }
}
