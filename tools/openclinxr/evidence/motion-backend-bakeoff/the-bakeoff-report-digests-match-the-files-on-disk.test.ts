import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: report.json records actorAssetSha256 and harnessSha256, capture.mts computes both
 * (sha256File of the actor GLB and harness.html), and nothing compared either field to the files
 * on disk. The report can therefore describe a tree that no longer exists.
 *
 * MEASURED 2026-09-12 in this worktree:
 *
 *   report.json  actorAssetSha256      2e111a0da68f18f1...
 *                harnessSha256         baa04f6f04d05d54...
 *   disk         actor                 b744d3d5295e2d48...   STALE
 *                harness               18bffc2e664c6c36...   STALE
 *
 * The same class as runtime-goal-eval.json (guarded) and the planted root RED
 * tools/openclinxr/evidence/the-bakeoff-report-names-the-tree-it-captured.test.ts (it.fails).
 * This file is the freeze-compliant plant in the card write-root.
 *
 * Recapture is out of scope. Hand-editing both digests flips both REDs without a new capture.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not
 * rewrite the measured digests.
 *
 * claimScope: whether report.json's actorAssetSha256 and harnessSha256 equal sha256 of the files
 *   capture.mts hashed (mpfb-clinical-nurse-adult.glb, harness.html).
 * notEvidenceFor: what the stills SHOW; which backend wins; still-file digest agreement (out of
 *   scope / not-tested on this card).
 *
 * ## FIXED (tsk_c1cc229c4a12a3b5)
 * Recapture completed via the bake-off's own command, foreground:
 *   pnpm exec tsx tools/openclinxr/evidence/motion-backend-bakeoff/capture.mts
 * /usr/bin/time -p: real 3.48 user 4.11 sys 0.66; wall-clock 3 s; exit 0.
 * capture.mts wrote report.json; verdict/schemaVersion restored to the pre-capture values
 * (`other` / openclinxr.motion-backend-bakeoff.v1); verdictDetail restored (no regrade).
 * Digests were not hand-edited. After capture:
 *   actorAssetSha256      b744d3d5295e2d4840ceae586924727725667cb0260a5b1f3ee68dd2e72e136f
 *   harnessSha256         18bffc2e664c6c361fab3aa5f61d289653e91a4c16b6221e9029d3bd4f821e99
 *   measuredAgainstCommit 6c9892fe403fb51e76a593cde90527f047894106
 * Both match the files on disk. The next drift fails these cases.
 */

const REPO = join(import.meta.dirname, "../../../..");
const DIR = join(REPO, "tools/openclinxr/evidence/motion-backend-bakeoff");
const REPORT = join(DIR, "report.json");
/** Same paths capture.mts hashes into report.json (capture.mts:11-12, 69-70). */
const HARNESS = join(DIR, "harness.html");
const ACTOR = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");

type Report = {
  actorAssetSha256?: string;
  harnessSha256?: string;
};

/** Same construction as capture.mts sha256File (capture.mts:24-26). */
const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

const report = (): Report => JSON.parse(readFileSync(REPORT, "utf8")) as Report;

describe("the bake-off report digests match the files on disk", () => {
  it("(0) VACUITY GUARD: the report, actor and harness exist and the report names both digests", () => {
    expect(existsSync(REPORT), `${REPORT} missing — no report to compare`).toBe(true);
    expect(existsSync(ACTOR), `${ACTOR} missing — no actor bytes to hash`).toBe(true);
    expect(existsSync(HARNESS), `${HARNESS} missing — no harness bytes to hash`).toBe(true);
    const r = report();
    expect(r.actorAssetSha256, "the report records no actorAssetSha256; staleness is undetectable").toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(r.harnessSha256, "the report records no harnessSha256; staleness is undetectable").toMatch(/^[0-9a-f]{64}$/u);
  });

  it("(1) RED: the report's actor digest is the actor on disk", () => {
    const recorded = String(report().actorAssetSha256 ?? "");
    const onDisk = sha256File(ACTOR);
    expect(
      recorded,
      `report actorAssetSha256 ${recorded.slice(0, 16)} but disk is ${onDisk.slice(0, 16)} — re-run capture.mts`,
    ).toBe(onDisk);
  });

  it("(2) RED: the report's harness digest is the harness on disk", () => {
    const recorded = String(report().harnessSha256 ?? "");
    const onDisk = sha256File(HARNESS);
    expect(
      recorded,
      `report harnessSha256 ${recorded.slice(0, 16)} but disk is ${onDisk.slice(0, 16)} — re-run capture.mts`,
    ).toBe(onDisk);
  });
});
