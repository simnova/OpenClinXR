import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: runtime-goal-eval.json is a measurement CACHED TO DISK, and nothing refuses it when
 * the tree it measured has moved. Two landed contracts read it and are green about an actor that no
 * longer ships.
 *
 * MEASURED 2026-09-03 at 829de8a8:
 *
 *   runtime-goal-eval.json  actorAssetSha256      2e111a0da68f18f1...
 *                           measuredAgainstCommit 9ea15acd
 *                           breastL / breastR     BOTH (0, 1.34395, 0.01283) — the midline
 *   mpfb-clinical-nurse-adult.glb on disk         bc5b9009af577037...
 *                           breast.L / breast.R   +/-0.08500 since 1f5519d2
 *
 * So the cache describes a rig whose chest anchors were one point; the shipped rig separates them.
 * `the-solved-elbow-stays-inside-human-flexion.test.ts` and
 * `the-body-region-goal-follows-the-body.test.ts` both read this file and both pass (6 passed),
 * because neither checks the two provenance fields the eval already carries.
 *
 * THIS IS THE RULE contract-design STATES AND NOTHING HERE ENFORCED. A measure-once-to-disk contract
 * is green about NOTHING on every later run, and red about nothing just as easily: a stale artifact
 * can fabricate a regression that consumes a worker. The eval records both a commit and an asset
 * digest; the gap is that no assertion compares them to the tree.
 *
 * WHY A DIGEST AND NOT A DATE. An mtime is trivially bumped and says nothing about content. The
 * asset digest is the input the measurement depends on, so it moves exactly when the measurement
 * becomes invalid and not otherwise.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not rewrite
 * the measured values.
 *
 * claimScope: whether runtime-goal-eval.json's recorded actorAssetSha256 matches the actor GLB on
 *   disk, and whether its recorded bone positions are consistent with that GLB's rest skeleton.
 * notEvidenceFor: whether the eval's NUMBERS are correct once fresh; only staleness is asserted.
 *   Other cached artifacts in this tree. What any still SHOWS. Quest frame budget.
 */

/**
 * ## FIXED (#0) — clauses (1) and (2) flipped
 *
 * Re-run 2026-09-03 via runtime-goal-eval.mts (Playwright, headless chromium) against harness.html
 * at 2daa4c43 with the fleet-anchor-fixed actor (bc5b9009af... on disk; the 829de8a8 cache had
 * measured 2e111a0d...). The eval now records the digest and commit of the tree it ran in:
 *
 *   actorAssetSha256        bc5b9009af577037...  == sha256 of the GLB on disk at run time
 *   measuredAgainstCommit   2daa4c43
 *   frame 0 breastL         ( 0.08500, 1.34395, 0.01283)
 *   frame 0 breastR         (-0.08500, 1.34395, 0.01283)   separated, mirroring the GLB rest
 *
 * The actor's rest translations are breast.L (+0.085, ...) / breast.R (-0.085, ...), so the
 * recorded 0.170 m world separation is exactly what the shipped rig carries. Both consumers re-read
 * the fresh eval and stay green: worst elbow interior angle is now 43.8 deg (the goal moved with
 * the separated anchor, so the 31.75 deg from the 9ea15acd run was not assumed to hold), wrist
 * residual ~1e-6 m, and the target-to-breastR distance spread is 0.00 m across the 12 frames.
 */

const ROOT = join(import.meta.dirname, "../../..");
const EVAL = join(ROOT, "tools/openclinxr/evidence/motion-backend-bakeoff/runtime-goal-eval.json");
const ACTOR = join(ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");

type Vec = { x: number; y: number; z: number };
type Report = {
  actorAssetSha256?: string;
  measuredAgainstCommit?: string;
  oscillation?: Array<{ bones: Record<string, Vec> }>;
};

const report = (): Report => JSON.parse(readFileSync(EVAL, "utf8")) as Report;
const actorSha = (): string => createHash("sha256").update(readFileSync(ACTOR)).digest("hex");

describe("the runtime-goal eval names the tree it measured", () => {
  it("(0) VACUITY GUARD: the eval and the actor both exist and the eval carries its provenance", () => {
    expect(existsSync(EVAL), `${EVAL} is missing — there is no cache to check`).toBe(true);
    expect(existsSync(ACTOR), `${ACTOR} is missing — there is nothing to compare against`).toBe(true);
    const r = report();
    expect(r.actorAssetSha256, "the eval records no actorAssetSha256, so staleness is undetectable").toBeTruthy();
    expect(r.measuredAgainstCommit, "the eval records no measuredAgainstCommit").toBeTruthy();
    expect((r.oscillation ?? []).length, "the eval records no oscillation frames").toBeGreaterThanOrEqual(1);
  });

  it("(1) FIXED: the eval's recorded actor digest is the actor on disk", () => {
    const recorded = String(report().actorAssetSha256 ?? "");
    const onDisk = actorSha();
    expect(
      recorded,
      `eval was measured against actor ${recorded.slice(0, 16)} but the shipped actor is ${onDisk.slice(0, 16)}`,
    ).toBe(onDisk);
  });

  it("(2) FIXED: the eval's recorded bones agree with the actor's rest skeleton", async () => {
    // COUNTERWEIGHT to clause (1): hand-editing actorAssetSha256 to match the file would satisfy a
    // digest check while leaving the stale NUMBERS in place. This clause ties the cached content to
    // a fact readable from the asset, so only a real re-run can satisfy both.
    const doc = await new NodeIO().read(ACTOR);
    const node = (n: string) => doc.getRoot().listNodes().find((x) => x.getName() === n);
    const bl = node("breast.L");
    const br = node("breast.R");
    expect(bl && br, "the actor lacks breast.L / breast.R; this clause cannot speak").toBeTruthy();
    const assetSeparated =
      Math.abs((bl?.getTranslation()[0] as number) - (br?.getTranslation()[0] as number)) > 1e-9;

    const frame = report().oscillation?.[0]?.bones;
    const evalBl = frame?.["breastL"];
    const evalBr = frame?.["breastR"];
    expect(evalBl && evalBr, "the eval records no breastL / breastR").toBeTruthy();
    const evalSeparated = Math.abs((evalBl?.x as number) - (evalBr?.x as number)) > 1e-9;

    expect(
      evalSeparated,
      `the actor's chest anchors are ${assetSeparated ? "separated" : "collapsed"} but the eval recorded them ${evalSeparated ? "separated" : "collapsed"}`,
    ).toBe(assetSeparated);
  });
});
