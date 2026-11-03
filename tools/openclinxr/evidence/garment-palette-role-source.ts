/**
 * #180a / #184 — garment colour is f(role, kind, fabricPalette), not kind alone.
 *
 * Reads the EFFECTIVE garment colour from the exported glTF (never Python
 * source or provenance-only claims): factor x per-channel baseColorTexture
 * mean when a decodable texture is present, otherwise the bare factor — the
 * shared tools/openclinxr/evidence/lib/effective-garment-colour.ts reader,
 * the same one a-declared-fabric-palette-reaches-the-shipped-garment uses.
 * Fleet convention since HB-02 (22ec335a5) folded every factor into its
 * texture, so a bare factor reads white on textured garments and would pin
 * the lock where the render no longer is. Enumerates co-present actor pairs
 * from the real casting API.
 *
 * claimScope: material identity + role-aware colour source for co-present actors.
 * notEvidenceFor: clinical costume realism, gown↔scrub encounter-distance legibility
 *   (#180b), Quest readiness, production readiness, clinical validity, scoring.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { effectiveBaseColorFactor } from "./lib/effective-garment-colour.js";
import { isFittedGarmentMeshName } from "./lib/garment-mesh-class.js";

export type GarmentMaterial = {
  materialName: string;
  garmentKind: string;
  layerIndex: number;
  /** EFFECTIVE shipped colour (factor x texture mean; bare factor when
   * untextured) — what the renderer multiplies, not the bare factor. */
  baseColorFactor: [number, number, number];
};

export type BodyRow = {
  assetPath: string;
  role: string;
  primary: GarmentMaterial | null;
  allGarmentMaterials: GarmentMaterial[];
  declaredFabricPalette: string | null;
};

export type CoPresencePair = {
  scenarioId: string;
  actorA: string;
  actorB: string;
  roleA: string;
  roleB: string;
  primaryColorsIdentical: boolean;
  colorA: [number, number, number] | null;
  colorB: [number, number, number] | null;
};

export type GarmentPaletteRoleSourceReport = {
  bodies: BodyRow[];
  coPresencePairs: CoPresencePair[];
  colourSourceIsRoleAware: boolean;
  claimScope: string;
  notEvidenceFor: string[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GEN = path.join(repoRoot, "apps/ui-xr/public/generated-humanoids");
const AUTOMATE_BLENDER = path.join(
  repoRoot,
  "tools/openclinxr/asset-pipeline/anny/automate_blender.py",
);
const DECLARED = /declared_upper_layers/i;
const COLOR_EPS = 0.005;

export const EVIDENCE_DIR = ".openclinxr/evidence/issue-180a";

function absFromRepo(relOrAbs: string): string {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(repoRoot, relOrAbs);
}

function kindFromMaterialName(name: string): string {
  const n = name.toLowerCase();
  if (/hospital_gown|(?<![a-z])gown/.test(n)) return "gown";
  if (/open_cardigan|cardigan|open_front/.test(n)) return "open_front";
  if (/scrub_pocket/.test(n)) return "scrub_pocket";
  if (/scrub/.test(n)) return "scrub";
  if (/casual_top/.test(n)) return "closed_casual";
  if (/tshirt|exam/.test(n)) return "tshirt";
  return "unknown";
}

function layerFromMaterialName(name: string): number {
  const m = name.match(/_L(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function colorsEqual(
  a: [number, number, number] | null,
  b: [number, number, number] | null,
): boolean {
  if (!a || !b) return false;
  return a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < COLOR_EPS);
}

function primaryOf(mats: GarmentMaterial[]): GarmentMaterial | null {
  if (mats.length === 0) return null;
  const first = mats[0];
  if (!first) return null;
  return mats.reduce((best, m) => (m.layerIndex >= best.layerIndex ? m : best), first);
}

async function readGarmentMaterials(glbAbs: string): Promise<GarmentMaterial[]> {
  if (!existsSync(glbAbs)) return [];
  const document = await new NodeIO().read(glbAbs);
  const out: GarmentMaterial[] = [];
  for (const mat of document.getRoot().listMaterials()) {
    const materialName = mat.getName() || "";
    // One shared classifier, not the legacy-only /openclinxr_real_garment_/ matcher
    // that missed every makeclothes rail material. Fitted uppers and lowers read as
    // the role-coloured garments; footwear/hair/eyes/body never do. Declared layer
    // shells stay excluded (they carry no role colour).
    if (!isFittedGarmentMeshName(materialName) || DECLARED.test(materialName)) continue;
    const c = mat.getBaseColorFactor();
    const img = mat.getBaseColorTexture()?.getImage() ?? null;
    // st-palette R2: the shipped colour is the EFFECTIVE colour (the HB-02
    // fold moved every factor into its texture). Same shared reader the
    // declared-fabric contract uses — never a second implementation.
    const eff = effectiveBaseColorFactor(c, img);
    out.push({
      materialName,
      garmentKind: kindFromMaterialName(materialName),
      layerIndex: layerFromMaterialName(materialName),
      baseColorFactor: [
        Number(eff[0].toFixed(4)),
        Number(eff[1].toFixed(4)),
        Number(eff[2].toFixed(4)),
      ],
    });
  }
  out.sort((a, b) => a.layerIndex - b.layerIndex || a.materialName.localeCompare(b.materialName));
  return out;
}

async function readDeclaredFabricPalette(assetPath: string): Promise<string | null> {
  const base = path.basename(assetPath).replace(/\.glb$/iu, "");
  const candidates = [
    path.join(GEN, `${base}_rigging_report.json`),
    path.join(GEN, `${base}.anny_manifest.json`),
    // st-palette: MPFB-bake provenance is the canonical palette record for rebaked
    // bodies (caseInputs.declaredFabricPalette); the rail sidecars above do not exist there.
    path.join(GEN, `${base}.provenance.json`),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
      const tags = raw.wardrobeTags as Record<string, unknown> | undefined;
      if (tags && typeof tags.fabricPalette === "string" && tags.fabricPalette.length > 0) {
        return tags.fabricPalette;
      }
      const walk = (o: unknown, depth: number): string | null => {
        if (!o || depth > 6 || typeof o !== "object") return null;
        const rec = o as Record<string, unknown>;
        if (typeof rec.fabricPalette === "string" && rec.fabricPalette.length > 0) {
          return rec.fabricPalette;
        }
        // st-palette: MPFB provenance records the case declaration under this key.
        const declared = rec["declaredFabricPalette"];
        if (typeof declared === "string" && declared.length > 0) {
          return declared;
        }
        for (const v of Object.values(rec)) {
          const found = walk(v, depth + 1);
          if (found) return found;
        }
        return null;
      };
      const found = walk(raw, 0);
      if (found) return found;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Source is role-aware when automate_blender defines garment_shell_color(kind, actor_role, ...)
 * that reads fabricPalette — i.e. colour is not a pure function of kind.
 *
 * Signature may include Python type annotations (`kind: str, actor_role: str, ...`).
 */
export function detectColourSourceIsRoleAwareFromPipelineSource(): boolean {
  if (!existsSync(AUTOMATE_BLENDER)) return false;
  const src = readFileSync(AUTOMATE_BLENDER, "utf8");
  // Match def through next top-level def; allow annotated params.
  const defMatch = src.match(
    /def\s+garment_shell_color\s*\([^)]*actor_role[^)]*phenotype[^)]*\)[\s\S]*?\n(?=def\s)/,
  );
  if (!defMatch) return false;
  const body = defMatch[0];
  if (!/fabricPalette|fabric_palette/u.test(body)) return false;
  if (!/actor_role/u.test(body)) return false;
  // Must not be a pure kind map: look for role or palette branching beyond locked gown/scrub.
  const hasRoleBranch = /patient|family|parent|spouse/iu.test(body);
  const hasPaletteTable = /_FABRIC_PALETTE_KIND_COLORS|fabricPalette/u.test(body);
  return hasRoleBranch && hasPaletteTable;
}

let cached: GarmentPaletteRoleSourceReport | null = null;
let inFlight: Promise<GarmentPaletteRoleSourceReport> | null = null;

/**
 * Inspect every shipped cast body + co-present pairs. Colours from exported glTF only.
 */
export async function inspectGarmentPaletteRoleSource(): Promise<GarmentPaletteRoleSourceReport> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const materialCache = new Map<string, GarmentMaterial[]>();
    const readMats = async (assetPath: string): Promise<GarmentMaterial[]> => {
      const hit = materialCache.get(assetPath);
      if (hit !== undefined) return hit;
      const mats = await readGarmentMaterials(absFromRepo(assetPath));
      materialCache.set(assetPath, mats);
      return mats;
    };

    const bodies: BodyRow[] = [];
    const seenAssets = new Set<string>();
    const scenarioIds = listShippedCastScenarioIds();
    const coPresencePairs: CoPresencePair[] = [];

    for (const scenarioId of scenarioIds) {
      const cast = resolveScenarioActorCast(scenarioId);
      for (const entry of cast) {
        if (seenAssets.has(entry.assetPath)) continue;
        seenAssets.add(entry.assetPath);
        const abs = absFromRepo(entry.assetPath);
        if (!existsSync(abs)) {
          throw new Error(`inspectGarmentPaletteRoleSource: missing GLB ${entry.assetPath}`);
        }
        const allGarmentMaterials = await readMats(entry.assetPath);
        bodies.push({
          assetPath: entry.assetPath,
          role: entry.role,
          primary: primaryOf(allGarmentMaterials),
          allGarmentMaterials,
          declaredFabricPalette: await readDeclaredFabricPalette(entry.assetPath),
        });
      }

      for (let i = 0; i < cast.length; i++) {
        for (let j = i + 1; j < cast.length; j++) {
          const a = cast[i];
          const b = cast[j];
          if (!a || !b) continue;
          const matsA = await readMats(a.assetPath);
          const matsB = await readMats(b.assetPath);
          const primA = primaryOf(matsA);
          const primB = primaryOf(matsB);
          const colorA = primA?.baseColorFactor ?? null;
          const colorB = primB?.baseColorFactor ?? null;
          coPresencePairs.push({
            scenarioId,
            actorA: a.actorId,
            actorB: b.actorId,
            roleA: a.role,
            roleB: b.role,
            primaryColorsIdentical: colorsEqual(colorA, colorB),
            colorA,
            colorB,
          });
        }
      }
    }

    const report: GarmentPaletteRoleSourceReport = {
      bodies,
      coPresencePairs,
      colourSourceIsRoleAware: detectColourSourceIsRoleAwareFromPipelineSource(),
      claimScope:
        "garment_material_identity_and_role_aware_colour_source_not_encounter_legibility",
      notEvidenceFor: [
        "clinical_validity",
        "clinical_costume_realism",
        "gown_scrub_legibility_at_encounter_distance",
        "quest_readiness",
        "production_asset_readiness",
        "scoring_validity",
        "learner_performance",
      ],
    };

    cached = report;
    return report;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Write a post-fix snapshot next to pre-fix (optional; pre-fix is the gated artifact). */
export async function writePostFixEvidence(
  report: GarmentPaletteRoleSourceReport,
): Promise<string> {
  const dir = path.join(repoRoot, EVIDENCE_DIR);
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, "post-fix.json");
  await writeFile(
    out,
    `${JSON.stringify({ measuredAt: new Date().toISOString(), ...report }, null, 2)}\n`,
    "utf8",
  );
  return out;
}
