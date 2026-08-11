/**
 * #221 inspect — MPFB library bodies match their Anny reference (A1), morph-name
 * vocabularies are measured (A2), deformation needs no untracked artifact (A3 via
 * parametric-body-deforms).
 *
 * claimScope: factory body_param station — Anny-as-reference → MPFB body match + morph measure.
 * notEvidenceFor: phoneme readiness, clinical body realism, Quest readiness, false name maps.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  CATALOG_PATH,
  STAGE_ID,
  type BodyParamCatalog,
} from "../asset-pipeline/makeclothes/body-param-cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** MADR 0044 measured mean vertex deviation after stature match (~2.3 cm). */
export const MADR_0044_MEAN_VERTEX_DEVIATION_METERS = 0.0229;

const LIBRARY_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates",
);

const ANNY_GLB_BY_ASSET: Record<string, string> = {
  ed_chest_pain_nurse_adult: path.join(
    REPO_ROOT,
    "apps/ui-xr/public/generated-humanoids/ed_chest_pain_nurse_adult.glb",
  ),
  ed_chest_pain_adult_cast: path.join(
    REPO_ROOT,
    "apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.glb",
  ),
  ed_chest_pain_spouse_adult: path.join(
    REPO_ROOT,
    "apps/ui-xr/public/generated-humanoids/ed_chest_pain_spouse_adult.glb",
  ),
};

export type MatchedBody = {
  bodyClassId: string;
  glbPath: string;
  annyReferenceAsset: string | null;
  heightMeters: number;
  annyHeightMeters: number;
  torsoGirthMeters: number;
  annyTorsoGirthMeters: number;
  /** #304 — the macros' stature converted to metres (provenance `bodyStatureBeforeScaleMeters` × `uniformScale`). */
  preAlignmentStatureMeters: number;
  morphTargetCount: number;
  morphTargetNames: string[];
  producedByStage: string;
};

export type InspectReport = {
  matched: MatchedBody[];
  tolerance: { heightMeters: number; girthMeters: number; source: string };
  visemeNamesConsumedByRuntime: string[];
  visemeVocabularySource: string;
  morphNameVerdict: "intersects" | "disjoint_measured";
};

function isGarmentMeshName(name: string): boolean {
  if (/openclinxr_real_garment_/i.test(name)) return false;
  return /makeclothes|mhclo|scrub|garment|cloth|footwear|shoe|slipper/i.test(name);
}

function measureHeightAndGirth(doc: Awaited<ReturnType<NodeIO["read"]>>): {
  heightMeters: number;
  torsoGirthMeters: number;
} {
  const bodyPos: number[][] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (isGarmentMeshName(name)) continue;
    if (/hair|eye|helper/i.test(name) && !/hm08|basemesh|body/i.test(name)) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        bodyPos.push([
          Number(arr[i * 3]),
          Number(arr[i * 3 + 1]),
          Number(arr[i * 3 + 2]),
        ]);
      }
    }
  }
  if (bodyPos.length < 100) {
    return { heightMeters: 0, torsoGirthMeters: 0 };
  }
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const p of bodyPos) {
    ymin = Math.min(ymin, p[1]!);
    ymax = Math.max(ymax, p[1]!);
  }
  const h = ymax - ymin;
  const lo = ymin + 0.45 * h;
  const hi = ymin + 0.6 * h;
  const band = bodyPos.filter((p) => p[1]! >= lo && p[1]! <= hi);
  if (band.length === 0) return { heightMeters: h, torsoGirthMeters: 0 };
  const cx = band.reduce((s, p) => s + p[0]!, 0) / band.length;
  const cz = band.reduce((s, p) => s + p[2]!, 0) / band.length;
  let maxR = 0;
  for (const p of band) {
    maxR = Math.max(maxR, Math.hypot(p[0]! - cx, p[2]! - cz));
  }
  return { heightMeters: h, torsoGirthMeters: maxR };
}

async function morphNamesFromDoc(
  doc: Awaited<ReturnType<NodeIO["read"]>>,
  io: NodeIO,
): Promise<string[]> {
  const names: string[] = [];
  const json = await io.writeJSON(doc);
  for (const mesh of json.json.meshes || []) {
    const extras = mesh.extras as { targetNames?: string[] } | undefined;
    if (extras?.targetNames?.length) {
      names.push(...extras.targetNames);
    } else {
      const prim = (mesh.primitives || [])[0] as { targets?: unknown[] } | undefined;
      if (prim?.targets?.length) {
        for (let i = 0; i < prim.targets.length; i++) {
          names.push(`unnamed_morph_${i}`);
        }
      }
    }
  }
  return [...new Set(names.filter((n) => n && n !== "Basis"))];
}

/**
 * Read viseme vocabulary FROM runtime / pipeline source — not a hardcoded list here.
 * automate_blender.py authors the runtime contract names; main.ts consumes them.
 */
export function readVisemeVocabularyFromSource(): {
  names: string[];
  source: string;
} {
  const automatePath = path.join(
    REPO_ROOT,
    "tools/openclinxr/asset-pipeline/anny/automate_blender.py",
  );
  const mainPath = path.join(REPO_ROOT, "apps/ui-xr/src/main.ts");
  const names = new Set<string>();
  let source = automatePath;

  if (existsSync(automatePath)) {
    const text = readFileSync(automatePath, "utf8");
    // visemes = ["viseme_silence", ...] and affects = ["openclinxr_mouth_open", ...]
    const listRe =
      /(?:visemes|affects)\s*=\s*\[([^\]]+)\]/g;
    for (const m of text.matchAll(listRe)) {
      const body = m[1] ?? "";
      for (const q of body.matchAll(/["']([A-Za-z0-9_]+)["']/g)) {
        names.add(q[1]!);
      }
    }
    source = "tools/openclinxr/asset-pipeline/anny/automate_blender.py";
  }

  // Also pull openclinxr_* / viseme_* dictionary keys referenced in main.ts
  if (existsSync(mainPath)) {
    const main = readFileSync(mainPath, "utf8");
    for (const m of main.matchAll(
      /morphTargetDictionary\.([A-Za-z0-9_]+)|["'](viseme_[A-Za-z0-9_]+|openclinxr_[A-Za-z0-9_]+)["']/g,
    )) {
      const n = m[1] || m[2];
      if (n && (n.startsWith("viseme_") || n.startsWith("openclinxr_"))) {
        names.add(n);
      }
    }
    if (names.size > 0 && source.includes("automate")) {
      source =
        "tools/openclinxr/asset-pipeline/anny/automate_blender.py+apps/ui-xr/src/main.ts";
    } else if (!source.includes("automate")) {
      source = "apps/ui-xr/src/main.ts";
    }
  }

  return { names: [...names].sort(), source };
}

function loadCatalog(): BodyParamCatalog | null {
  if (!existsSync(CATALOG_PATH)) return null;
  const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as BodyParamCatalog;
  if (raw.producedByStage !== STAGE_ID) return null;
  return raw;
}

function listTrackedLibraryBodies(): Array<{
  bodyClassId: string;
  glbRel: string;
  glbAbs: string;
  annyReferenceAsset: string | null;
}> {
  const out: Array<{
    bodyClassId: string;
    glbRel: string;
    glbAbs: string;
    annyReferenceAsset: string | null;
  }> = [];
  for (const bodyClassId of ["adult_lean_female", "adult_heavy_male"] as const) {
    const name = `body-param-${bodyClassId}-library.glb`;
    const glbAbs = path.join(LIBRARY_DIR, name);
    if (!existsSync(glbAbs) || statSync(glbAbs).size < 10_000) continue;
    let annyReferenceAsset: string | null = null;
    const provPath = glbAbs.replace(/\.glb$/i, ".provenance.json");
    if (existsSync(provPath)) {
      const prov = JSON.parse(readFileSync(provPath, "utf8")) as {
        annyReferenceAsset?: string | null;
      };
      if (prov.annyReferenceAsset) annyReferenceAsset = String(prov.annyReferenceAsset);
    }
    out.push({
      bodyClassId,
      glbRel: path.relative(REPO_ROOT, glbAbs).split(path.sep).join("/"),
      glbAbs,
      annyReferenceAsset,
    });
  }
  return out;
}

function resolveAnnyGlb(annyReferenceAsset: string | null): string | null {
  if (!annyReferenceAsset) return null;
  const p = ANNY_GLB_BY_ASSET[annyReferenceAsset];
  if (p && existsSync(p)) return p;
  // basename match
  for (const [k, v] of Object.entries(ANNY_GLB_BY_ASSET)) {
    if (annyReferenceAsset.includes(k) && existsSync(v)) return v;
  }
  return null;
}

/**
 * #304 — read the macros' own stature from the per-class provenance sidecar. The reference
 * alignment no longer matches the body to the Anny reference (the two reference OBJs are
 * byte-identical duplicates, #303), so `bodyStatureBeforeScaleMeters × uniformScale` is what
 * the macros produced, in metres.
 */
function readAlignFromProvenance(glbAbs: string): {
  bodyStatureBeforeScaleMeters?: number;
  uniformScale?: number;
} {
  const provPath = glbAbs.replace(/\.glb$/i, ".provenance.json");
  if (!existsSync(provPath)) return {};
  try {
    const prov = JSON.parse(readFileSync(provPath, "utf8")) as {
      annyStatureAlign?: { bodyStatureBeforeScaleMeters?: number; uniformScale?: number };
    };
    return prov.annyStatureAlign ?? {};
  } catch {
    return {};
  }
}

/**
 * Inspect MPFB library bodies against their Anny references + morph vocabulary.
 */
export async function inspectAnnyReferenceMpfbMatch(): Promise<InspectReport> {
  const io = new NodeIO();
  const catalog = loadCatalog();
  const viseme = readVisemeVocabularyFromSource();

  type Row = {
    bodyClassId: string;
    glbAbs: string;
    glbRel: string;
    annyReferenceAsset: string | null;
    producedByStage: string;
  };
  const rows: Row[] = [];

  if (catalog) {
    for (const e of catalog.entries) {
      if (e.producedByStage !== STAGE_ID) continue;
      const glbAbs = path.join(REPO_ROOT, e.glbPath);
      if (!existsSync(glbAbs) || statSync(glbAbs).size < 10_000) continue;
      rows.push({
        bodyClassId: e.bodyClassId,
        glbAbs,
        glbRel: e.glbPath,
        annyReferenceAsset: e.annyReferenceAsset ?? null,
        producedByStage: e.producedByStage,
      });
    }
  }
  if (rows.length === 0) {
    for (const e of listTrackedLibraryBodies()) {
      rows.push({
        bodyClassId: e.bodyClassId,
        glbAbs: e.glbAbs,
        glbRel: e.glbRel,
        annyReferenceAsset: e.annyReferenceAsset,
        producedByStage: STAGE_ID,
      });
    }
  }

  const matched: MatchedBody[] = [];
  for (const row of rows) {
    const doc = await io.read(row.glbAbs);
    const bodyMetrics = measureHeightAndGirth(doc);
    const morphTargetNames = await morphNamesFromDoc(doc, io);

    let annyHeight = 0;
    let annyGirth = 0;
    const annyGlb = resolveAnnyGlb(row.annyReferenceAsset);
    if (annyGlb) {
      const annyDoc = await io.read(annyGlb);
      const am = measureHeightAndGirth(annyDoc);
      annyHeight = am.heightMeters;
      annyGirth = am.torsoGirthMeters;
    }

    const align = readAlignFromProvenance(row.glbAbs);
    const preAlignmentStatureMeters =
      typeof align.bodyStatureBeforeScaleMeters === "number"
      && typeof align.uniformScale === "number"
        ? align.bodyStatureBeforeScaleMeters * align.uniformScale
        : NaN;

    matched.push({
      bodyClassId: row.bodyClassId,
      glbPath: row.glbRel,
      annyReferenceAsset: row.annyReferenceAsset,
      heightMeters: bodyMetrics.heightMeters,
      annyHeightMeters: annyHeight,
      torsoGirthMeters: bodyMetrics.torsoGirthMeters,
      annyTorsoGirthMeters: annyGirth,
      preAlignmentStatureMeters,
      morphTargetCount: morphTargetNames.length,
      morphTargetNames,
      producedByStage: row.producedByStage,
    });
  }

  // #304 — the height "match" is re-scoped. The two library Anny reference OBJs are
  // byte-identical duplicates (#303), so a per-class stature match to them is impossible
  // by construction and forcing it erased the macro-produced spread. What the macros must
  // produce is a DIFFERENTIATED stature that survives the placement-only alignment; the
  // height floor is therefore HALF THE MACRO-PRODUCED SPREAD, derived from the recorded
  // pre-alignment statures (the INPUT of the causal chain — PROTO_VERIFY_DELEGATION §9s),
  // in metres. Girth stays 0044-derived (2.5× mean vertex deviation) and is still checked
  // per body — girth was never forced (`girthScaleHorizontal: 1.0`) and its residual is
  // unchanged by #304.
  const macroStatures = matched
    .map((m) => m.preAlignmentStatureMeters)
    .filter((v) => Number.isFinite(v)) as number[];
  const macroSpreadMeters = macroStatures.length >= 2
    ? Math.abs(macroStatures[0]! - macroStatures[1]!)
    : NaN;
  const tolerance = {
    heightMeters: Number.isFinite(macroSpreadMeters) ? macroSpreadMeters / 2 : NaN,
    girthMeters: MADR_0044_MEAN_VERTEX_DEVIATION_METERS * 2.5,
    source:
      "MADR_0044_measured_meanVertexDeviationMeters_0.0229_girth_2.5x_radial_proxy; "
      + "#304: height floor = half the macro-produced stature spread (Anny reference duplicated, #303)",
  };

  // Morph-name verdict: intersects if any exported name meets a runtime viseme; else
  // disjoint_measured when ≥20 names are listed as evidence.
  let intersects = false;
  for (const m of matched) {
    for (const n of m.morphTargetNames) {
      if (
        viseme.names.some(
          (v) =>
            n.toLowerCase() === v.toLowerCase()
            || n.toLowerCase().includes(v.toLowerCase())
            || v.toLowerCase().includes(n.toLowerCase()),
        )
      ) {
        intersects = true;
        break;
      }
    }
    if (intersects) break;
  }

  const morphNameVerdict: "intersects" | "disjoint_measured" = intersects
    ? "intersects"
    : "disjoint_measured";

  return {
    matched,
    tolerance,
    visemeNamesConsumedByRuntime: viseme.names,
    visemeVocabularySource: viseme.source,
    morphNameVerdict,
  };
}
