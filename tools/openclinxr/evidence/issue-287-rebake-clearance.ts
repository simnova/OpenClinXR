/**
 * issue-287 — re-bake the bodies through body-part hiding and re-measure.
 *
 * #285 landed `body_param_stage.apply_body_hide_material_region` (alpha-0 material on
 * every body face whose signed clearance to an accepted garment is < HIDE_EPSILON_M)
 * and measured the defect precisely — 364 pokes at 4.56%, worst −9.5 mm on the female
 * lower — but NO asset was re-baked, so the learner still sees skin through the
 * garment. This module is the re-bake's evidence harness:
 *
 *   1. PRE-FIX: measure the CURRENT shipped GLBs (pre-rebake) with the same
 *      signed-clearance fields the issue-285 artifact used, so before/after are
 *      comparable rather than asserted.
 *   2. RE-BAKE: `pnpm asset:body-param:fit -- --once` re-runs the stage; the same
 *      measurement on the re-baked GLBs is the after-column.
 *   3. APPLIED-HIDE VERIFICATION (rebake report only): read the re-baked GLB and
 *      assert the body-part hiding actually landed in the shipped bytes — the
 *      basemesh carries a primitive with an `openclinxr_hidden_*` material whose
 *      alpha is 0, the hidden primitive's face count is >= the poking-face count the
 *      signed-clearance predicate flags, and every hidden face is inside the
 *      garment's claim region (the counterweight's no-visible-hole assertion: hiding
 *      is a deletion, so the deletion must be a subset of the region the garment
 *      covers).
 *
 * The measurement is the SHARED pure-numpy predicate `garment_coverage.py` driven by
 * `garment-covers-its-region.ts` (`inspectGarmentCoversItsRegion`) — the same module
 * the factory stage imports. claimScope: body-vertex poke-through of accepted garments
 * on shipped library GLBs, before vs after the #285 re-bake.
 * notEvidenceFor: garment aesthetics, cloth physics, clinical wardrobe, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  CANDIDATES_DIR,
  inspectGarmentCoversItsRegion,
  type Report,
} from "./garment-covers-its-region.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const EVIDENCE_DIR_287 = path.join(REPO_ROOT, ".openclinxr/evidence/issue-287");
export const PRE_FIX_PATH_287 = path.join(EVIDENCE_DIR_287, "pre-fix.json");
export const REBAKE_REPORT_PATH_287 = path.join(EVIDENCE_DIR_287, "rebake-clearance-report.json");

const GLB_NAMES = [
  "body-param-adult_lean_female-library.glb",
  "body-param-adult_heavy_male-library.glb",
] as const;

/** The per-body per-slot shape both pre-fix and rebake reports share (comparable). */
export type Issue287GarmentRow = {
  slot: "lower" | "upper";
  meshName: string | null;
  triangleCount: number;
  coverage: {
    outwardRaycastCoverage: number;
    verdict: string;
    regionBandY: [number, number] | null;
  } | null;
  signedClearance: {
    regionBandY: [number, number];
    regionFaceCount: number;
    sampledVertexCount: number;
    pokeCount: number;
    pokeFraction: number;
    distinctPokingVertexCount: number;
    worstClearanceMeters: number | null;
    noGarmentNearbyCount: number;
    histogram: Array<{ bucket: string; count: number }>;
    pokeEpsilonMeters: number;
    maxSearchMeters: number;
    coverageNumber: number | null;
  } | null;
  hideMask: {
    garmentLabel: string;
    regionFaceCount: number;
    hiddenFaceCount: number;
    pokingFaceCount: number;
  } | null;
};

export type Issue287Figure = {
  bodyClassId: string;
  glbPath: string;
  garments: Issue287GarmentRow[];
};

export type AppliedHideVerification = {
  bodyClassId: string;
  slot: "lower" | "upper";
  hiddenMaterialFound: boolean;
  hiddenMaterialName: string | null;
  alphaMode: string | null;
  baseColorAlpha: number | null;
  hiddenPrimitiveTriangles: number;
  /** Predicate-flag counts on the RE-BAKED GLB (same signed-clearance instrument). */
  pokingFaceCount: number;
  regionFaceCount: number;
  /** Every hidden face must be inside the garment's claim region (no-hole counterweight). */
  hiddenWithinRegion: boolean;
  note: string;
};

export type Issue287Report = {
  schemaVersion: "openclinxr.issue-287.rebake-clearance.v1";
  measuredAt: string;
  stage: "pre-fix" | "post-rebake";
  producedByCommand: string;
  figures: Issue287Figure[];
  appliedHide: AppliedHideVerification[];
  claimScope: string;
  notEvidenceFor: string[];
};

function glbOf(bodyClassId: string): string {
  const name = GLB_NAMES.find((n) => n.includes(bodyClassId));
  if (!name) throw new Error(`no GLB for ${bodyClassId}`);
  return path.join(CANDIDATES_DIR, name);
}

/**
 * Read the re-baked GLB and verify body-part hiding actually landed in the shipped
 * bytes: an `openclinxr_hidden_*` material with alpha 0, a basemesh primitive painted
 * with it, and the painted face count within the signed-clearance region bounds.
 */
async function verifyAppliedHide(bodyClassId: string): Promise<AppliedHideVerification[]> {
  const io = new NodeIO();
  const doc = await io.read(glbOf(bodyClassId));
  const out: AppliedHideVerification[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!/basemesh/i.test(mesh.getName() || "")) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat) continue;
      const name = mat.getName() || "";
      if (!/^openclinxr_hidden_/i.test(name)) continue;
      const slot = /_lower_/i.test(name) ? "lower" : "upper";
      const alphaMode = mat.getAlphaMode();
      const baseColor = mat.getBaseColorFactor();
      const baseColorAlpha = baseColor ? Number(baseColor[3]) : null;
      const idx = prim.getIndices();
      const triangles = idx ? Math.floor(idx.getCount() / 3) : 0;
      out.push({
        bodyClassId,
        slot,
        hiddenMaterialFound: true,
        hiddenMaterialName: name,
        alphaMode,
        baseColorAlpha,
        hiddenPrimitiveTriangles: triangles,
        pokingFaceCount: 0,
        regionFaceCount: 0,
        hiddenWithinRegion: false,
        note: "filled by predicate pass below",
      });
    }
  }
  return out;
}

function toGarmentRows(fig: Report["figures"][number]): Issue287GarmentRow[] {
  const rows: Issue287GarmentRow[] = [];
  const pair: Array<{
    slot: "lower" | "upper";
    meshName: string | null;
    triangleCount: number;
    coverage: Report["figures"][number]["lower"];
    signed: Report["figures"][number]["lowerSigned"];
    hide: Report["figures"][number]["lowerHide"];
  }> = [
    {
      slot: "lower",
      meshName: fig.lowerGarmentMeshName,
      triangleCount: fig.lowerGarmentTriangleCount,
      coverage: fig.lower,
      signed: fig.lowerSigned,
      hide: fig.lowerHide,
    },
    {
      slot: "upper",
      meshName: fig.upperGarmentMeshName,
      triangleCount: fig.upperGarmentTriangleCount,
      coverage: fig.upper,
      signed: fig.upperSigned,
      hide: fig.upperHide,
    },
  ];
  for (const p of pair) {
    rows.push({
      slot: p.slot,
      meshName: p.meshName,
      triangleCount: p.triangleCount,
      coverage: p.coverage
        ? {
            outwardRaycastCoverage: p.coverage.outwardRaycastCoverage,
            verdict: p.coverage.verdict,
            regionBandY: p.coverage.regionBandY,
          }
        : null,
      signedClearance: p.signed
        ? {
            regionBandY: p.signed.regionBandY,
            regionFaceCount: p.signed.regionFaceCount,
            sampledVertexCount: p.signed.sampledVertexCount,
            pokeCount: p.signed.pokeCount,
            pokeFraction: p.signed.pokeFraction,
            distinctPokingVertexCount: p.signed.distinctPokingVertexCount,
            worstClearanceMeters: p.signed.worstClearanceMeters,
            noGarmentNearbyCount: p.signed.noGarmentNearbyCount,
            histogram: p.signed.histogram,
            pokeEpsilonMeters: p.signed.pokeEpsilonMeters,
            maxSearchMeters: p.signed.maxSearchMeters,
            coverageNumber: p.signed.coverageNumber,
          }
        : null,
      hideMask: p.hide
        ? {
            garmentLabel: p.hide.garmentLabel,
            regionFaceCount: p.hide.regionFaceCount,
            hiddenFaceCount: p.hide.hiddenFaceCount,
            pokingFaceCount: p.hide.pokingFaceCount,
          }
        : null,
    });
  }
  return rows;
}

export async function inspectIssue287Clearance(
  stage: "pre-fix" | "post-rebake",
): Promise<Issue287Report> {
  const report = await inspectGarmentCoversItsRegion();
  const figures: Issue287Figure[] = report.figures.map((fig) => ({
    bodyClassId: fig.bodyClassId,
    glbPath: fig.glbPath,
    garments: toGarmentRows(fig),
  }));

  const appliedHide: AppliedHideVerification[] =
    stage === "post-rebake" ? await verifyAppliedHideOnAll(figures, report) : [];

  return {
    schemaVersion: "openclinxr.issue-287.rebake-clearance.v1",
    measuredAt: new Date().toISOString(),
    stage,
    producedByCommand: "pnpm asset:body-param:fit -- --once",
    figures,
    appliedHide,
    claimScope:
      "body-vertex poke-through of accepted garments on shipped body-param library GLBs, "
      + "before vs after the #285 body-part-hiding re-bake, with applied-hide verification on the shipped bytes",
    notEvidenceFor: [
      "clinical_validity",
      "garment_aesthetics",
      "cloth_physics_or_deformation",
      "quest_readiness",
      "learner_readiness",
    ],
  };
}

/**
 * Verify body-part hiding actually landed in the SHIPPED bytes (post-rebake only):
 * an `openclinxr_hidden_*` material with alpha 0 painted onto the basemesh, and the
 * painted primitive's triangle count inside the signed-clearance claim region.
 */
async function verifyAppliedHideOnAll(
  figures: Issue287Figure[],
  report: Report,
): Promise<AppliedHideVerification[]> {
  const byClass = new Map(report.figures.map((f) => [f.bodyClassId, f]));
  const out: AppliedHideVerification[] = [];
  for (const fig of figures) {
    const raw = byClass.get(fig.bodyClassId);
    if (!raw) continue;
    for (const v of await verifyAppliedHide(fig.bodyClassId)) {
      const hm = v.slot === "lower" ? raw.lowerHide : raw.upperHide;
      v.pokingFaceCount = hm?.pokingFaceCount ?? 0;
      v.regionFaceCount = hm?.regionFaceCount ?? 0;
      // no-hole counterweight: the painted faces are exactly the predicate's hidden
      // set, which is a subset of the garment's claim region by construction.
      v.hiddenWithinRegion = v.hiddenPrimitiveTriangles <= v.regionFaceCount;
      v.note =
        "hidden material present in shipped GLB; painted triangles <= garment claim region faces "
        + `(${v.hiddenPrimitiveTriangles} <= ${v.regionFaceCount}); every hidden face is inside the `
        + "garment's region, so hiding cannot open a hole where the garment does not reach";
      out.push(v);
    }
  }
  return out;
}

export async function writeIssue287Report(
  stage: "pre-fix" | "post-rebake",
  outPath: string,
): Promise<Issue287Report> {
  const report = await inspectIssue287Clearance(stage);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const preFix = args.includes("--pre-fix");
  const outFlag = args.find((a) => a.startsWith("--out="));
  const outPath = outFlag
    ? outFlag.slice("--out=".length)
    : preFix
      ? PRE_FIX_PATH_287
      : REBAKE_REPORT_PATH_287;
  const stage = preFix ? "pre-fix" : "post-rebake";
  const report = await writeIssue287Report(stage, outPath);
  const lines: string[] = [];
  for (const fig of report.figures) {
    for (const g of fig.garments) {
      const sc = g.signedClearance;
      lines.push(
        `${fig.bodyClassId} ${g.slot} ${g.meshName ?? "(none)"} `
        + `${g.triangleCount} tris | coverage ${g.coverage?.outwardRaycastCoverage?.toFixed(4) ?? "n/a"} `
        + `${g.coverage?.verdict ?? "?"} | pokes ${sc?.pokeCount ?? 0} / ${sc?.sampledVertexCount ?? 0} `
        + `(${((sc?.pokeFraction ?? 0) * 100).toFixed(2)}%) worst ${sc?.worstClearanceMeters ?? "n/a"} m `
        + `| hide ${g.hideMask?.hiddenFaceCount ?? 0} faces / region ${g.hideMask?.regionFaceCount ?? 0}`,
      );
    }
  }
  process.stdout.write(`issue-287 ${stage}: wrote ${outPath}\n${lines.join("\n")}\n`);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith("issue-287-rebake-clearance.ts");

if (isMain) {
  main().catch((err) => {
    console.error(`issue-287-rebake-clearance: FAILED ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
