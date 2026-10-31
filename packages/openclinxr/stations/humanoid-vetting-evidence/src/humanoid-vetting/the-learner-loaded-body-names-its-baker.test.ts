import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeHumanoidVariantAssetPath } from "@openclinxr/xr-asset-loading";
import { resolveHumanoidVariantOrCastPath } from "@openclinxr/xr-scene";
import {
  MATERIALIZER_PATH,
  materializerBakedWithShas,
  sha256Hex,
} from "../../../../../../tools/openclinxr/evidence/materializer-baked-with.js";

/**
 * The learner-loaded body names its baker (ci-w9 P1 ADAPTED).
 *
 * The sidecar recipe records the materializer the body was BAKED WITH, not
 * the live script: recipe sha 120b56cb… is the materializer content at
 * c441312ec (2026-09-21), stamped by 287edc35c (2026-09-22). The live script
 * has since moved on (childlid 0815d99eb, eye-finish work) and must not
 * rewrite this record. The clause therefore asserts (a) the recorded sha is
 * the file's content sha at some commit in git history, and (b) the recorded
 * GLB sha equals the shipped bytes — never that the record equals the live
 * script. Counterweights: a fabricated sha and mutated GLB bytes each red.
 */

const ROOT = repoRoot();
const MATERIALIZER = MATERIALIZER_PATH;
const PATIENT_ACTOR_ID = "patient_maya_johnson_v1";

type Sidecar = {
  recipe?: { inputs?: Array<{ path?: string; sha256?: string }> };
  outputSha256?: string;
};

function resolveBakedBody(): { glbBytes: Buffer; doc: Sidecar } {
  const runtimeGlb = runtimeHumanoidVariantAssetPath(
    {
      scenarioId: () => "peds_asthma_parent_anxiety_v1",
      selectedHumanoidSourceComparator: () => null,
      runtimeActorRole: () => "patient",
      runtimePatientActorId: () => PATIENT_ACTOR_ID,
      runtimeFamilyActorId: () => "parent_tara_johnson_v1",
      runtimeClinicalTeamActorId: () => "nurse_kevin_lee_v1",
      encounterBundle: () => ({}),
      resolveCastPath: (input: {
        scenarioId: string;
        actorId: string;
        role: string;
        fallbackPath: string;
        comparatorOverridePath?: string | null;
      }) => resolveHumanoidVariantOrCastPath(input),
    } as unknown as Parameters<typeof runtimeHumanoidVariantAssetPath>[0],
    PATIENT_ACTOR_ID,
    "/not-the-cast-fallback.glb",
  );
  const publicRel = runtimeGlb.replace(/^\//, "");
  const glbOnDisk = path.join(ROOT, "apps", "ui-xr", "public", publicRel);
  const sidecar = `${glbOnDisk.slice(0, -".glb".length)}.provenance.json`;
  return {
    glbBytes: readFileSync(glbOnDisk),
    doc: JSON.parse(readFileSync(sidecar, "utf8")) as Sidecar,
  };
}

/** Fail-closed validator shared by the live clause and the known-bad fixtures. */
function validateBakedWith(doc: Sidecar, glbBytes: Buffer, history: Set<string>): void {
  expect(history.size, "baked-with history must be non-empty").toBeGreaterThan(0);
  const row = doc.recipe?.inputs?.find((input) => input.path === MATERIALIZER);
  expect(row?.path, "sidecar must name the materializer path it baked with").toBe(MATERIALIZER);
  expect(
    history.has(String(row?.sha256)),
    `recorded materializer ${row?.sha256} is not the baked-with bytes at any commit in history`,
  ).toBe(true);
  expect(
    sha256Hex(glbBytes),
    "recorded GLB sha must equal the shipped bytes",
  ).toBe(doc.outputSha256);
}

describe("the learner-loaded body names its baker", () => {
  it("records the baked-with materializer (a history blob) and the shipped GLB bytes", () => {
    const history = materializerBakedWithShas(ROOT);
    const { glbBytes, doc } = resolveBakedBody();
    validateBakedWith(doc, glbBytes, history);
  }, 120_000);

  it("known-bad: a fabricated materializer sha is rejected", () => {
    const history = materializerBakedWithShas(ROOT);
    const fabricated = "f".repeat(64);
    expect(history.has(fabricated), "fabricated sha must not be in history").toBe(false);
    const { glbBytes, doc } = resolveBakedBody();
    const bad: Sidecar = {
      ...doc,
      recipe: { inputs: [{ path: MATERIALIZER, sha256: fabricated }] },
    };
    expect(() => validateBakedWith(bad, glbBytes, history)).toThrow();
  }, 120_000);

  it("known-bad: mutated GLB bytes are rejected", () => {
    const history = materializerBakedWithShas(ROOT);
    const { glbBytes, doc } = resolveBakedBody();
    const mutated = Buffer.from(glbBytes);
    mutated[mutated.length - 1] = (mutated[mutated.length - 1]! + 1) % 256;
    expect(() => validateBakedWith(doc, mutated, history)).toThrow();
  }, 120_000);
});
