/**
 * Garment-texture inspection (#360) — the first-measurement instrument for "every garment is flat
 * colour while its own declared texture map sits unconsumed".
 *
 * factory_step: instrument. Measures, per shipped MPFB cast actor, per garment slot (upper /
 * lower / footwear):
 *
 *   - the GLB material name, baseColorFactor, and texture bytes (0 pre-fix — no baseColorTexture);
 *   - the slot's .mhclo (the same asset-selection logic materialize_mpfb_humanoid_candidate.py
 *     uses: patients -> toigo t-shirt, nurse -> Scrub_Shirt, lower -> cortu cargo pants,
 *     footwear -> SHOE_BY_REFERENCE);
 *   - the .mhclo's declared `material <rel>` -> .mhmat path, and whether it is staged in the
 *     provider cache;
 *   - the .mhmat's declared `diffuseTexture` -> file, and whether it resolves on disk;
 *   - the UV story, which decides wire-vs-fitting-pipeline: MakeHuman .mhclo files do not carry a
 *     `uvs` section (UVs ship in the paired .obj as `vt` lines), so the tool counts vt lines in
 *     the OBJ and reads the SHIPPED fitted mesh's TEXCOORD_0 presence + distinct UV pairs from
 *     the GLB. A texture without UVs renders as garbage, and that is the fact that decides scope.
 *
 * claimScope: deterministic file-side material/texture/UV census of the shipped bytes + provider
 * cache. notEvidenceFor: how cloth renders (pixel grade), clinical garment realism, whether a
 * texture "looks right" on the fitted mesh.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";

export const GARMENT_TEXTURE_EVIDENCE_ROOT = ".openclinxr/evidence/garment-textures";
export const GARMENTS_CACHE_ROOT = ".openclinxr-local/provider-cache/garments/sources";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** The same slot->asset selection the materializer uses (D1: read the code, do not invent a table). */
export const CAST = [
  {
    id: "child",
    role: "patient_maya_johnson_v1",
    glb: `${GENERATED}/mpfb-peds-patient-child.glb`,
    clinician: false,
    reference: "peds_patient_child",
  },
  {
    id: "aisha",
    role: "parent_tara_johnson_v1",
    glb: `${GENERATED}/mpfb-ob-patient-aisha.glb`,
    clinician: false,
    reference: null,
  },
  {
    id: "kevin",
    role: "nurse_kevin_lee_v1",
    glb: `${GENERATED}/mpfb-peds-nurse-kevin.glb`,
    clinician: true,
    reference: "peds_nurse_kevin",
  },
] as const;

/** SHOE_BY_REFERENCE in materialize_mpfb_humanoid_candidate.py:26-31. */
const SHOE_BY_REFERENCE: Record<string, string> = {
  // #598 moved the default + clinician rows off the leopard toigo_flats; the materializer's
  // None row now maps to toigo_mj_cloth_shoes (#0 re-measurement 2026-08-29: zero shipped GLBs
  // carry toigo_flats geometry or material).
  None: "toigo_mj_cloth_shoes",
  peds_nurse_kevin: "culturalibre_male_boots",
  peds_patient_child: "toigo_mj_cloth_shoes",
};

type MhmatReport = {
  declaredMhmatRel: string | null;
  mhmatStaged: boolean;
  mhmatPath: string | null;
  diffuseTexture: string | null;
  textureResolvesOnDisk: boolean;
  texturePath: string | null;
  textureBytes: number | null;
};

function parseMhcloMaterial(mhcloAbs: string): string | null {
  for (const line of readFileSync(mhcloAbs, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("material ")) return t.slice("material ".length).trim();
  }
  return null;
}

function parseMhmatDiffuseTexture(mhmatAbs: string): string | null {
  for (const line of readFileSync(mhmatAbs, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("diffuseTexture ")) return t.slice("diffuseTexture ".length).trim();
  }
  return null;
}

function inspectMhmat(mhcloAbs: string): MhmatReport {
  const declared = parseMhcloMaterial(mhcloAbs);
  const report: MhmatReport = {
    declaredMhmatRel: declared,
    mhmatStaged: false,
    mhmatPath: null,
    diffuseTexture: null,
    textureResolvesOnDisk: false,
    texturePath: null,
    textureBytes: null,
  };
  if (!declared) return report;
  const declaredAbs = pathResolve(join(dirname(mhcloAbs), declared));
  if (!fileExists(declaredAbs)) {
    // The provider cache stages garment files FLAT in one directory (#337): the declared path is
    // tried first, the flat-cache layout is the measured fallback (same rule as mhmat_for_mhclo).
    const flat = join(dirname(mhcloAbs), basenameSafe(declared));
    report.mhmatPath = fileExists(flat) ? flat : null;
  } else {
    report.mhmatPath = declaredAbs;
  }
  if (!report.mhmatPath) return report;
  report.mhmatStaged = true;
  const tex = parseMhmatDiffuseTexture(report.mhmatPath);
  if (!tex) return report;
  report.diffuseTexture = tex;
  const texAbs = pathResolve(join(dirname(report.mhmatPath), tex));
  report.texturePath = texAbs;
  report.textureResolvesOnDisk = fileExists(texAbs);
  if (report.textureResolvesOnDisk) report.textureBytes = fileBytes(texAbs);
  return report;
}

function basenameSafe(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function fileExists(p: string): boolean {
  try {
    return readFileSync(p).length >= 0;
  } catch {
    return false;
  }
}

function fileBytes(p: string): number {
  return readFileSync(p).length;
}

function countObjVt(objAbs: string): number {
  let n = 0;
  for (const line of readFileSync(objAbs, "utf8").split(/\r?\n/)) {
    if (line.startsWith("vt ")) n++;
  }
  return n;
}

function firstObjInDir(absDir: string): string | null {
  // The pipeline resolves the shoe OBJ via `_shoes_dir.glob("*.obj")` — the OBJ stem differs
  // from the .mhclo stem (flats.obj vs toigo_flats.mhclo, male_boots.obj, mj_shoes.obj).
  for (const entry of readdirSafe(absDir)) {
    if (entry.endsWith(".obj")) return join(absDir, entry);
  }
  return null;
}

async function glbMaterialAndUvStats(glbAbs: string, slotRe: RegExp) {
  const io = new NodeIO();
  const doc = await io.read(glbAbs);
  const out: {
    materialName: string | null;
    baseColorFactor: [number, number, number] | null;
    textureBytes: number;
    meshName: string | null;
    texcoord0: boolean;
    distinctUvs: number;
    uvMinMax: { u: [number, number]; v: [number, number] } | null;
  } = {
    materialName: null,
    baseColorFactor: null,
    textureBytes: 0,
    meshName: null,
    texcoord0: false,
    distinctUvs: 0,
    uvMinMax: null,
  };
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName();
    if (!slotRe.test(name)) continue;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat) continue;
      out.materialName = mat.getName();
      const f = mat.getBaseColorFactor();
      out.baseColorFactor = f ? [f[0]!, f[1]!, f[2]!] : null;
      const tex = mat.getBaseColorTexture();
      out.textureBytes = tex?.getImage()?.byteLength ?? 0;
      out.meshName = name;
      const uv = prim.getAttribute("TEXCOORD_0");
      if (uv) {
        out.texcoord0 = true;
        const seen = new Set<string>();
        let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
        for (let i = 0; i < uv.getCount(); i++) {
          const [u, v] = uv.getElement(i, [0, 0]) as number[];
          umin = Math.min(umin, u); umax = Math.max(umax, u);
          vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
          seen.add(`${u.toFixed(4)},${v.toFixed(4)}`);
        }
        out.distinctUvs = seen.size;
        out.uvMinMax = { u: [umin, umax], v: [vmin, vmax] };
      }
    }
  }
  return out;
}

export async function inspectGarmentTextures(artifactName = "pre-fix.json"): Promise<unknown> {
  const actors: unknown[] = [];
  for (const actor of CAST) {
    const slots: Record<string, unknown> = {};
    const glbAbs = join(REPO_ROOT, actor.glb);

    // Upper: the materializer's role/reference branch. #403 cleared
    // LONG_SLEEVE_UPPER_BY_REFERENCE["peds_nurse_kevin"] to None, so the long-sleeve branch is
    // dormant and every clinician's upper is the WojackOWL CC-BY Scrub_Shirt; patients -> toigo
    // t-shirt.
    const LONG_SLEEVE_BY_REFERENCE: Record<string, string | null> = {
      None: null,
      peds_nurse_kevin: null,
      peds_patient_child: null,
    };
    const longSleeve = LONG_SLEEVE_BY_REFERENCE[String(actor.reference)] ?? LONG_SLEEVE_BY_REFERENCE["None"]!;
    const upperMhclo = actor.clinician && longSleeve
      ? `${GARMENTS_CACHE_ROOT}/makehuman-shirts01/${longSleeve}/toigo_fisherman_sweater.mhclo`
      : actor.clinician
        ? `${GARMENTS_CACHE_ROOT}/makehuman-community-scrub-shirt/Scrub_Shirt.mhclo`
        : `${GARMENTS_CACHE_ROOT}/makehuman-shirts01/toigo_basic_tucked_t-shirt/toigo_basic_tucked_t-shirt.mhclo`;

    const lowerMhclo = `${GARMENTS_CACHE_ROOT}/makehuman-pants01/cortu_cargo_pants/cargo_pants.mhclo`;

    const shoeKind = SHOE_BY_REFERENCE[String(actor.reference)] ?? SHOE_BY_REFERENCE["None"]!;
    const shoeMhclo = `${GARMENTS_CACHE_ROOT}/makehuman-shoes01/${shoeKind}/${shoeKind}.mhclo`;

    const slotsSpec: Array<[string, string, RegExp]> = [
      ["upper", upperMhclo, /t_shirt|scrub|shirt|sweater/i],
      ["lower", lowerMhclo, /pants|trouser/i],
      ["footwear", shoeMhclo, /footwear|shoe|boot|flat/i],
    ];
    for (const [slot, mhcloRel, slotRe] of slotsSpec) {
      const mhcloAbs = join(REPO_ROOT, mhcloRel);
      const objAbs = firstObjInDir(dirname(mhcloAbs));
      const mhmat = inspectMhmat(mhcloAbs);
      // The worktree's staged cache is a provisioned SUBSET (machine note). The canonical
      // provider cache lives in the main checkout; record both states so "declared but not
      // staged" is distinguishable from "declared and resolvable".
      let canonical: MhmatReport | null = null;
      const canonicalRepo = process.env.GARMENT_TEXTURE_CANONICAL_REPO;
      if (canonicalRepo) {
        const canonicalMhclo = join(canonicalRepo, mhcloRel);
        if (fileExists(canonicalMhclo)) canonical = inspectMhmat(canonicalMhclo);
      }
      const glb = await glbMaterialAndUvStats(glbAbs, slotRe);
      slots[slot] = {
        mhclo: mhcloRel,
        mhcloExists: fileExists(mhcloAbs),
        mhmat,
        canonicalMhmat: canonical,
        obj: objAbs ? relative(REPO_ROOT, objAbs) : null,
        objVtLines: objAbs ? countObjVt(objAbs) : null,
        glb: {
          meshName: glb.meshName,
          materialName: glb.materialName,
          baseColorFactor: glb.baseColorFactor,
          textureBytes: glb.textureBytes,
          texcoord0: glb.texcoord0,
          distinctUvs: glb.distinctUvs,
          uvMinMax: glb.uvMinMax,
        },
      };
    }
    actors.push({ ...actor, slots });
  }

  // Provider-cache census: which garment source dirs exist and what they hold.
  const cacheRoot = join(REPO_ROOT, GARMENTS_CACHE_ROOT);
  const cache: Record<string, string[]> = {};
  for (const pack of ["makehuman-shirts01", "makehuman-community-scrub-shirt", "makehuman-pants01", "makehuman-shoes01"]) {
    const packDir = join(cacheRoot, pack);
    for (const entry of readdirSafe(packDir)) {
      const full = join(packDir, entry);
      if (!isDir(full)) continue;
      cache[`${pack}/${entry}`] = readdirSafe(full).sort();
    }
  }

  const evidenceDir = join(REPO_ROOT, GARMENT_TEXTURE_EVIDENCE_ROOT);
  mkdirSync(evidenceDir, { recursive: true });
  const artifact = {
    schemaVersion: "openclinxr.garment-textures.pre-fix.v1",
    issue: "360",
    factoryStep: "instrument",
    measuredAt: new Date().toISOString(),
    generator: {
      tool: "inspectGarmentTextures",
      file: relative(REPO_ROOT, fileURLToPath(import.meta.url)),
      deterministic: true,
      llmInvolved: false,
    },
    actors,
    providerCacheCensus: cache,
    preFixAssertions: {
      everyGarmentHasZeroTextureBytes: "expected — this is the defect under measurement",
      missingDeclaredMaterial: "scrub shirt and cargo pants declare .mhmat files that are NOT staged in the provider cache (the cargo-pants .mhmat + cargo_pants_diff.png exist in the original makehuman-pants01 pack but were never staged; the scrub declares Scrub_Shirt.mhmat which is not in the pack listing either)",
      lowerShellHasNoUvs: "the SHIPPED lower garment on all three actors is the #326 body-derived cover shell, which has no TEXCOORD_0 — a lower-garment texture would render as garbage even if the .mhmat were staged; that is a fitting-pipeline slice (its own RED), not this material slice",
      poloTexture: "namuhekam_male_polo_shirt declares Polo_Base_Color.png; resolvable in the main checkout cache, absent from this worktree's staged cache (and not consumed by the MPFB materializer — it is the hm08 rail's garment)",
    },
  };
  writeFileSync(join(evidenceDir, artifactName), JSON.stringify(artifact, null, 2));
  return artifact;
}

function readdirSafe(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return readdirSync(p).length >= 0;
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const artifactName = process.argv[2] ?? "pre-fix.json";
  inspectGarmentTextures(artifactName).then((a) => {
    console.log(`GARMENT_TEXTURES_${artifactName.replace(/-/g, "_").toUpperCase()} ${relative(REPO_ROOT, join(REPO_ROOT, GARMENT_TEXTURE_EVIDENCE_ROOT, artifactName))}`);
    console.log(JSON.stringify(a, null, 2));
  });
}
