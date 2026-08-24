import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AssetGenerationCapabilityFacade,
  createDeterministicAssetGenerationAdapter,
} from "../../../packages/openclinxr/capability-gateway/src/asset-generation-jobs.js";

/**
 * OBSERVABLE: the asset-generation API reports a job SUCCEEDED and hands back paths to files that
 * were never written.
 *
 * MEASURED live 2026-08-24 through the real facade and the real default adapter — no mocks, no
 * invented keys:
 *
 *   status:    "succeeded"
 *   artifacts: [{ kind: "manifest", path: ".openclinxr/asset-generation/asset-job-mt7kswix-.../
 *                 character-generation-manifest.json", mediaType: "application/json" },
 *               { kind: "source",   path: ".../character-generation-source.asset.json" }]
 *
 *   ls -d .openclinxr/asset-generation   ->   ABSENT
 *
 * The paths come from `defaultSandboxWorkdir` (`asset-generation-jobs.ts:599`) and the default
 * provider is `deterministic-mock` (`:603`). Nothing creates that directory, and the native runner
 * defaults to `noNativeWorkerCommandRunner` (`:643`), whose `run()` throws
 * "No command runner configured for native asset generation worker" (`:2102-2104`).
 *
 * AND THE REAL WORKER IS NEVER REACHED. `tools/openclinxr/factory/encounter-asset-generation-worker.ts`
 * exists and works. A tree-wide search for a production caller returns only its own CLI
 * self-reference at :169 and :172, plus its own test — no API route, no factory producer.
 *
 * WHY THIS IS THE ASSERTION AND NOT "wire the worker". A status endpoint that INVENTS paths is worse
 * than one reporting pending: a caller cannot tell a finished job from a fabricated one, and every
 * downstream consumer inherits a path that resolves to nothing. #610's own words: "Do not synthesize
 * artifact paths before the worker has produced them — that is the current defect."
 *
 * So this pins the OBSERVABLE CONTRACT (succeeded implies the artifacts exist) rather than an
 * implementation. Enqueueing the real worker is one way to satisfy it; reporting `queued` until the
 * worker has written something is another. Both are legitimate and the choice is the implementer's.
 *
 * claimScope: that a job reported `succeeded` references only artifacts that exist on disk.
 * notEvidenceFor: whether the worker is wired (a separate, stronger claim), the queue contract,
 *   provenance, publication, or whether the artifact CONTENTS are correct — only that they exist.
 */

const REPO = join(import.meta.dirname, "../../..");

const submitOnce = async (): Promise<{ status: string; artifacts: Array<{ kind: string; path: string }> }> => {
  const facade = new AssetGenerationCapabilityFacade({
    adapters: [createDeterministicAssetGenerationAdapter("character-generation")],
  });
  const record = await facade.submit({ capabilityId: "character-generation", payload: {} });
  return record as unknown as { status: string; artifacts: Array<{ kind: string; path: string }> };
};

describe("a succeeded job does not reference artifacts nobody wrote", () => {
  it.fails("(1) every artifact on a SUCCEEDED job resolves to a file that exists", async () => {
    const rec = await submitOnce();
    expect(rec.status, "the default path reports success today").toBe("succeeded");
    const missing = rec.artifacts
      .filter((a) => !existsSync(join(REPO, a.path)))
      .map((a) => `${a.kind}: ${a.path}`);
    expect(
      missing,
      `a job reported "succeeded" while referencing files nobody wrote:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: producing NO artifacts is legitimate, not a failure", () => {
    // Refuses the over-correction of demanding artifacts exist by demanding artifacts. A capability
    // that genuinely emits nothing must stay green — the defect is CLAIMING files, not omitting them.
    //
    // This exercises the PREDICATE rather than constructing a fake adapter: an earlier version built
    // one inline and the facade marked the job "failed" because the stub did not satisfy the adapter
    // contract, so the clause was testing my stub rather than the rule.
    const missingOf = (artifacts: Array<{ kind: string; path: string }>): string[] =>
      artifacts.filter((a) => !existsSync(join(REPO, a.path))).map((a) => `${a.kind}: ${a.path}`);
    expect(missingOf([]), "an empty artifact list violates nothing").toEqual([]);
    expect(
      missingOf([{ kind: "manifest", path: "package.json" }]),
      "an artifact that DOES exist is not a violation either",
    ).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: only SUCCEEDED is bound — a pending job owes nothing", async () => {
    // A job still queued or running has no obligation to have written anything, and a fix that
    // satisfied clause (1) by never reporting success would be gaming it. This keeps the honest
    // alternative — report pending until the worker delivers — explicitly available.
    const rec = await submitOnce();
    expect(["queued", "running", "succeeded", "failed", "canceled"]).toContain(rec.status);
    if (rec.status !== "succeeded") expect(rec.artifacts).toEqual([]);
  });
});
