import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { hasValidProvenance, proceduralGownSourceHash } from "./garment-provenance-stamp.ts";
import { isLegacyRecordedProceduralGown } from "./recorded-garment-provenance.ts";

/**
 * After the 2026-09-20 fleet stamp, every shipped MPFB garment mesh that the
 * stamp table covers must carry provenance extras. Two families, never mixed:
 *
 *  - makeclothes: genuine library input, sourceMhclo names a real `.mhclo`.
 *  - procedural: the hospital-gown mesh has NO .mhclo input and must never
 *    invent one. It passes only with validated first-party lineage: the mesh
 *    carries the bake-written sourceRecipe, and the tree holds the actual
 *    generator (path + function + recipe) plus the GLB's own provenance
 *    sidecar naming that bake. An unattributed garment still fails.
 *
 * claimScope: extras on apps/ui-xr/public/generated-humanoids/mpfb-*.glb
 * notEvidenceFor: gown-class swap; how garments look; any GPL clearance.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../../..");
const DIR = join(REPO, "apps/ui-xr/public/generated-humanoids");
const SKIP = /eyes|hair|eyelash|eyebrow|teeth|tongue/i;
const GARMENT = /real_garment|makeclothes_library/i;

const GENERATOR_REL = "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py";
const GENERATOR_FN = "def _replace_with_clean_clinical_gown";
const GENERATOR_RECIPE = `${GENERATOR_REL}#regular-clinical-gown-cage`;
const GOWN_MESH_RE = /real_garment_hospital_gown/i;

function generatorText(): string {
  return readFileSync(join(REPO, GENERATOR_REL), "utf8");
}

/** Validated first-party procedural lineage for the hospital-gown mesh. */
function hasValidProceduralLineage(
  glbFile: string,
  meshName: string,
  extras: Record<string, unknown>,
): boolean {
  if (!GOWN_MESH_RE.test(meshName)) return false;
  if (extras["sourceRecipe"] !== GENERATOR_RECIPE) return false;
  if (extras["garmentClass"] !== "gown") return false;
  if (extras["licence"] !== "first-party OpenClinXR procedural geometry") return false;
  // Modern inline fields explicitly delegate to the UNCHANGED producer
  // hasValidProvenance(extras, repoRoot): no reimplementation here.
  if ("sourceKind" in extras || "sourceGenerator" in extras || "sourceHash" in extras) {
    return hasValidProvenance(extras, REPO);
  }
  // The producer path must exist in the tree and define the gown function.
  if (!existsSync(join(REPO, GENERATOR_REL))) return false;
  const text = generatorText();
  if (!text.includes(GENERATOR_FN)) return false;
  if (!text.includes("regular-clinical-gown-cage")) return false;
  // The hash path must be live: the station's hash of the generator file is
  // a well-formed full sha256 of the bytes on disk.
  const fileHash = createHash("sha256").update(readFileSync(join(REPO, GENERATOR_REL))).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(fileHash)) return false;
  if (proceduralGownSourceHash(REPO) !== fileHash) return false;
  // Genuine GLB provenance linkage: the asset-adjacent sidecar names the bake,
  // and the typed recorded helper authenticates it against the actual GLB bytes.
  const sidecarPath = join(DIR, glbFile.replace(/\.glb$/i, ".provenance.json"));
  if (!existsSync(sidecarPath)) return false;
  const raw = readFileSync(sidecarPath, "utf8");
  if (!raw.includes("bake_mpfb_gown_inspect")) return false;
  let sidecar: Record<string, unknown>;
  try {
    sidecar = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }
  const actualGlbSha256 = createHash("sha256").update(readFileSync(join(DIR, glbFile))).digest("hex");
  const assetPath = typeof sidecar["assetPath"] === "string" ? (sidecar["assetPath"] as string) : "";
  const verdict = isLegacyRecordedProceduralGown({
    meshName,
    extras,
    sidecar,
    sidecarAssetPath: assetPath,
    expectedAssetPath: `apps/ui-xr/public/generated-humanoids/${glbFile}`,
    actualGlbSha256,
    generatorFileExists: true,
  });
  return verdict.ok === true;
}

function hasGenuineMhclo(extras: Record<string, unknown>): boolean {
  return typeof extras["sourceMhclo"] === "string" && (extras["sourceMhclo"] as string).length > 0;
}

describe("the shipped MPFB garments record source-family provenance", () => {
  it("(1) every stamp-table garment mesh on mpfb-*.glb has source-family provenance", async () => {
    const glbs = readdirSync(DIR).filter((n) => n.startsWith("mpfb-") && n.endsWith(".glb"));
    expect(glbs.length, "shipped MPFB fleet").toBeGreaterThan(5);
    const missing: string[] = [];
    for (const f of glbs) {
      const doc = await new NodeIO().read(join(DIR, f));
      for (const mesh of doc.getRoot().listMeshes()) {
        const name = mesh.getName();
        if (!GARMENT.test(name) || SKIP.test(name)) continue;
        const extras = (mesh.getExtras() ?? {}) as Record<string, unknown>;
        // Known procedural gown branch BEFORE generic nonempty-Mhclo
        // compatibility: a known gown with a fake Mhclo must fail, never
        // continue on the legacy tag.
        if (GOWN_MESH_RE.test(name)) {
          if (hasValidProceduralLineage(f, name, extras)) continue;
          missing.push(`${f}:${name}`);
          continue;
        }
        if (hasGenuineMhclo(extras)) continue;
        missing.push(`${f}:${name}`);
      }
    }
    expect(missing, `garments missing provenance: ${missing.join(", ")}`).toEqual([]);
  });

  it("(2) the procedural excuse is narrow: unattributed garments still fail", () => {
    const genuine = { sourceMhclo: "toigo_t_shirt.mhclo" };
    expect(hasGenuineMhclo(genuine)).toBe(true);
    // An unattributed garment mesh: no .mhclo, no bake lineage.
    expect(hasValidProceduralLineage("mpfb-gown-adult-patient.glb", "makeclothes_library_zzz_unknown_mesh", {})).toBe(
      false,
    );
    // A mesh that merely names the gown without the bake-written lineage fails.
    expect(
      hasValidProceduralLineage("mpfb-gown-adult-patient.glb", "openclinxr_real_garment_hospital_gown_mesh", {}),
    ).toBe(false);
    // A wrong producer path fails even with the right mesh name.
    expect(
      hasValidProceduralLineage(
        "mpfb-gown-adult-patient.glb",
        "openclinxr_real_garment_hospital_gown_mesh",
        { sourceRecipe: "tools/somewhere-else/fake.py#fake", garmentClass: "gown", licence: "first-party OpenClinXR procedural geometry" },
      ),
    ).toBe(false);
  });

  it("(3) recorded helper verdict is wired: tampered bytes and stripped lineage fail", () => {
    const extras = {
      garmentClass: "gown",
      licence: "first-party OpenClinXR procedural geometry",
      sourceRecipe: GENERATOR_RECIPE,
    };
    const good = {
      outputSha256: "88f094703dfc96811af56c6bb6070933f654a6a58c8ded3e5feac296e5561406",
      assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
      operations: [
        {
          kind: "replace_corrupt_gown_shell_with_first_party_clinical_gown_cage",
          tool: "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py + tools/openclinxr/evidence/gown-746-splice.ts",
          inputSha256: "d99e55ff594247af91d53ec5d0f4192a39bc898174f5d11b40da7a7c7d709276",
          outputSha256: "0614cf0ece42b917683b26120bce07a7de813bbd6858195007dc78aa7bdb54b4",
        },
      ],
      sourceOriginChain: { derivationCommits: [{ commit: "af1fed4e" }], derivationNote: "reconstructed chain" },
    };
    const okArgs = {
      meshName: "openclinxr_real_garment_hospital_gown_mesh",
      extras,
      sidecar: good,
      sidecarAssetPath: good.assetPath,
      expectedAssetPath: good.assetPath,
      actualGlbSha256: good.outputSha256,
      generatorFileExists: true,
    };
    expect(isLegacyRecordedProceduralGown(okArgs)).toEqual({ ok: true, legacyType: "LEGACY_RECORDED_PROCEDURAL" });
    // Tampered GLB bytes: helper return is used, so mismatch fails.
    expect(isLegacyRecordedProceduralGown({ ...okArgs, actualGlbSha256: "0".repeat(64) }).ok).toBe(false);
    // Stripped producer operation: commits plus a note alone no longer pass.
    expect(
      isLegacyRecordedProceduralGown({
        ...okArgs,
        sidecar: { ...good, operations: [{ kind: "other", tool: "other", inputSha256: "0".repeat(64), outputSha256: "1".repeat(64) }] },
      }).ok,
    ).toBe(false);
  });
});
