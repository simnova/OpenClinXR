/**
 * recorded-garment-provenance.ts — typed recorded-provenance consumer for the
 * two first-party procedural gowns. RECORDED attribution only: no legal
 * clearance, no visual/rig/readiness claim, no historical-executed-bytes claim.
 *
 * LEGACY_RECORDED_PROCEDURAL applies only when C1-C7 all authenticate:
 * C1 garmentClass == "gown" on bake-written extras.
 * C2 licence == "first-party OpenClinXR procedural geometry".
 * C3 sourceRecipe == bake_mpfb_gown_inspect.py#regular-clinical-gown-cage.
 * C4 sidecar outputSha256 == actual GLB bytes SHA256, sidecar assetPath matches.
 * C5 concrete structured lineage: adult recorded gown producer operation
 * (operations[] holds kind replace_corrupt_gown_shell_with_first_party_clinical_gown_cage
 * with exact tool bake path + splice, 64-hex input/output pins) plus
 * reconstructed chain (derivationCommits non-empty + derivationNote), or
 * ED case-bound producer (operations[] holds exact bake tool + exit 0,
 * byteLineage.derivationArgv pins --python exact producer + --input-glb
 * + 64-hex inputSha256, caseInputs present).
 * C6 tracked generator file exists.
 * C7 legacy gown carries no fake sourceMhclo; unknown rows fail; malformed
 * modern inline fields never fall back to legacy.
 */
export const RECORDED_GOWN_RECIPE =
  "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py#regular-clinical-gown-cage";
export const RECORDED_GOWN_CLASS = "gown";
export const RECORDED_GOWN_LICENCE = "first-party OpenClinXR procedural geometry";
export const RECORDED_GOWN_GENERATOR_TOOL = "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py";
export const RECORDED_ADULT_PRODUCER_TOOL =
  "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py + tools/openclinxr/evidence/gown-746-splice.ts";
export const RECORDED_ADULT_PRODUCER_KIND = "replace_corrupt_gown_shell_with_first_party_clinical_gown_cage";
export const RECORDED_ED_INPUT_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb";
export const RECORDED_TYPE = "LEGACY_RECORDED_PROCEDURAL";
export const GOWN_MESH_RE = /real_garment_hospital_gown/i;

const HEX64 = /^[0-9a-f]{64}$/i;

export type RecordedProvenanceResult =
  | { ok: true; legacyType: typeof RECORDED_TYPE }
  | { ok: false; failed: string };

export function isLegacyRecordedProceduralGown(args: {
  meshName: string;
  extras: Record<string, unknown>;
  sidecar: Record<string, unknown>;
  sidecarAssetPath: string;
  expectedAssetPath: string;
  actualGlbSha256: string;
  generatorFileExists: boolean;
}): RecordedProvenanceResult {
  if (!GOWN_MESH_RE.test(args.meshName)) return { ok: false, failed: "C7" };
  const e = args.extras;
  // C7: legacy gown must not carry a fake Mhclo tag.
  if (typeof e["sourceMhclo"] === "string" && (e["sourceMhclo"] as string).length > 0)
    return { ok: false, failed: "C7" };
  // Modern inline fields present but invalid must never launder into legacy.
  const modernKeys = ["sourceKind", "sourceGenerator", "sourceHash"];
  if (modernKeys.some((k) => k in e)) return { ok: false, failed: "C7" };
  if (e["garmentClass"] !== RECORDED_GOWN_CLASS) return { ok: false, failed: "C1" };
  if (e["licence"] !== RECORDED_GOWN_LICENCE) return { ok: false, failed: "C2" };
  if (e["sourceRecipe"] !== RECORDED_GOWN_RECIPE) return { ok: false, failed: "C3" };
  const s = args.sidecar;
  if (args.sidecarAssetPath !== args.expectedAssetPath) return { ok: false, failed: "C4" };
  if (typeof s["assetPath"] === "string" && (s["assetPath"] as string).length > 0 && (s["assetPath"] as string) !== args.expectedAssetPath) return { ok: false, failed: "C4" };
  if (typeof s["outputSha256"] !== "string") return { ok: false, failed: "C4" };
  if (!HEX64.test(s["outputSha256"] as string)) return { ok: false, failed: "C4" };
  if (!HEX64.test(args.actualGlbSha256)) return { ok: false, failed: "C4" };
  if ((s["outputSha256"] as string).toLowerCase() !== args.actualGlbSha256.toLowerCase())
    return { ok: false, failed: "C4" };
  if (!hasConcreteLineage(s)) return { ok: false, failed: "C5" };
  if (!args.generatorFileExists) return { ok: false, failed: "C6" };
  return { ok: true, legacyType: RECORDED_TYPE };
}

function isHex64(v: unknown): v is string {
  return typeof v === "string" && HEX64.test(v);
}

function hasConcreteLineage(s: Record<string, unknown>): boolean {
  const ops = s["operations"];
  const opsArr = Array.isArray(ops) ? (ops as Array<Record<string, unknown>>) : [];
  // Adult branch: recorded producer operation with exact kind + exact tool
  // plus 64-hex input/output pins, alongside the reconstructed commit chain.
  const adultOp = opsArr.some(
    (o) =>
      typeof o === "object" &&
      o !== null &&
      o["kind"] === RECORDED_ADULT_PRODUCER_KIND &&
      o["tool"] === RECORDED_ADULT_PRODUCER_TOOL &&
      isHex64(o["inputSha256"]) &&
      isHex64(o["outputSha256"]),
  );
  if (adultOp) {
    const chain = s["sourceOriginChain"] as Record<string, unknown> | undefined;
    const commits = chain?.["derivationCommits"];
    const note = chain?.["derivationNote"];
    if (Array.isArray(commits) && commits.length > 0 && typeof note === "string" && note.length > 0)
      return true;
    return false;
  }
  // ED branch: case-bound producer with exact bake tool + exit 0, exact
  // argv pins, 64-hex input pin, and caseInputs present.
  const edOp = opsArr.some(
    (o) => typeof o === "object" && o !== null && o["tool"] === RECORDED_GOWN_GENERATOR_TOOL && o["exit"] === 0,
  );
  if (!edOp) return false;
  const lineage = s["byteLineage"] as Record<string, unknown> | undefined;
  const argv = lineage?.["derivationArgv"];
  const inputSha = lineage?.["inputSha256"];
  if (!Array.isArray(argv)) return false;
  if (!argv.every((a) => typeof a === "string")) return false;
  const strs = argv as string[];
  const pyIdx = strs.indexOf("--python");
  if (pyIdx < 0 || strs[pyIdx + 1] !== RECORDED_GOWN_GENERATOR_TOOL) return false;
  // --input-glb requires an actual following input value: the recorded ED
  // input GLB constant. A dangling flag with no value never passes.
  const inIdx = strs.indexOf("--input-glb");
  if (inIdx < 0 || strs[inIdx + 1] !== RECORDED_ED_INPUT_GLB) return false;
  // --output-glb, when present, must carry a nonempty value matching the
  // current asset basename; a dangling flag never passes.
  const outIdx = strs.indexOf("--output-glb");
  if (outIdx < 0) return false;
  {
    const outVal = strs[outIdx + 1];
    if (typeof outVal !== "string" || outVal.length === 0) return false;
    const base = (() => {
      const asset = s["assetPath"];
      if (typeof asset !== "string") return "";
      const parts = asset.split("/");
      return parts[parts.length - 1];
    })();
    if (base.length === 0 || !outVal.endsWith(base)) return false;
  }
  if (!isHex64(inputSha)) return false;
  const caseInputs = s["caseInputs"] as Record<string, unknown> | unknown;
  if (typeof caseInputs !== "object" || caseInputs === null || Array.isArray(caseInputs)) return false;
  const ci = caseInputs as Record<string, unknown>;
  if (typeof ci["caseModule"] !== "string" || (ci["caseModule"] as string).length === 0) return false;
  if (!isHex64(ci["caseModuleSha256"])) return false;
  if (!Array.isArray(ci["fieldsReachingBuilderAtThisRun"])) return false;
  if (!(ci["fieldsReachingBuilderAtThisRun"] as unknown[]).every((f) => typeof f === "string")) return false;
  if (Object.keys(ci).length === 0) return false;
  return true;
}
