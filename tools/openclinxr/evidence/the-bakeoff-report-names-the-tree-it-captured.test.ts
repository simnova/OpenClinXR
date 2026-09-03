import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the bake-off's committed evidence describes a tree that is two fixes old. report.json
 * records an actor digest and a harness digest, both of which have moved, and nothing compares
 * either to disk. The four stills on main therefore show a pose the shipped tree no longer produces.
 *
 * MEASURED 2026-09-03 at 6e28bc87:
 *
 *   report.json  actorAssetSha256      2e111a0da68f   disk bc5b9009af57   STALE
 *                harnessSha256         baa04f6f04d0   disk 18bffc2e664c   STALE
 *                measuredAgainstCommit 6f5d05d4
 *   the four recorded still digests DO match the files, so the report is internally consistent —
 *   it faithfully describes a run against an actor and a harness that no longer exist.
 *
 * WHAT MOVED UNDER IT. The harness gained a per-link rotationMax at 1bab31eb; the actor's chest
 * anchors were separated at 1f5519d2 and the fleet followed at d807212f. A local re-capture at
 * 829de8a8 produced four NEW still digests, so the committed images are not what this tree renders.
 *
 * THIS IS THE SAME CLASS AS runtime-goal-eval.json, WHICH IS NOW FIXED. That artifact carried the
 * same fields, nothing checked them, and two contracts were green about a rig that no longer
 * shipped (tsk_9bdded66cbb1735b, landed 6e28bc87). Surveying the tree finds exactly two
 * provenance-bearing evidence artifacts; the eval is now guarded and this is the other one.
 *
 * WHAT THIS CONTRACT DOES NOT CLOSE, stated because it is a real residual rather than an oversight.
 * Hand-editing both digests to match disk WITHOUT re-capturing passes every clause here. The eval's
 * counterweight worked by tying cached numbers to a fact readable from the asset; a PNG carries no
 * readable rig fact, so no equivalent exists. Nor does the still-digest consistency in clause (0)
 * help: stale stills are consistent with a stale report. The defence is re-capturing, and the cost
 * of the evasion is that the next pixel grade contradicts the report.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not rewrite
 * the measured digests.
 *
 * claimScope: whether report.json's recorded actor and harness digests are the files on disk.
 * notEvidenceFor: what the stills SHOW — no pixel is graded here. Which backend wins. Whether a
 *   fresh capture's verdict is right. Any other cached artifact; the survey found only these two.
 */

const ROOT = join(import.meta.dirname, "../../..");
const DIR = join(ROOT, "tools/openclinxr/evidence/motion-backend-bakeoff");
const REPORT = join(DIR, "report.json");
const ACTOR = join(ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const HARNESS = join(DIR, "harness.html");

type Still = { path: string; sha256: string };
type Report = {
  actorAssetSha256?: string;
  harnessSha256?: string;
  measuredAgainstCommit?: string;
  arms?: Array<{ stills?: Still[] }>;
};

const report = (): Report => JSON.parse(readFileSync(REPORT, "utf8")) as Report;
const digest = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("the bake-off report names the tree it captured", () => {
  it("(0) VACUITY GUARD: the report, actor, harness and four stills exist and agree with each other", () => {
    for (const p of [REPORT, ACTOR, HARNESS]) {
      expect(existsSync(p), `${p} is missing — there is nothing to compare`).toBe(true);
    }
    const r = report();
    expect(r.actorAssetSha256, "the report records no actorAssetSha256; staleness is undetectable").toBeTruthy();
    expect(r.harnessSha256, "the report records no harnessSha256").toBeTruthy();
    const stills = (r.arms ?? []).flatMap((a) => a.stills ?? []);
    expect(stills.length, "the report names fewer than four stills").toBeGreaterThanOrEqual(4);
    // Internal consistency only: this does NOT prove freshness, and the header says why.
    for (const s of stills) {
      const onDisk = join(DIR, basename(s.path));
      expect(existsSync(onDisk), `still ${basename(s.path)} is named by the report but absent`).toBe(true);
      expect(digest(onDisk), `still ${basename(s.path)} does not match its recorded digest`).toBe(s.sha256);
    }
  });

  it.fails("(1) RED: the report's actor digest is the actor on disk", () => {
    const recorded = String(report().actorAssetSha256 ?? "");
    const onDisk = digest(ACTOR);
    expect(
      recorded,
      `captured against actor ${recorded.slice(0, 12)} but the shipped actor is ${onDisk.slice(0, 12)} — re-run capture.mts`,
    ).toBe(onDisk);
  });

  it.fails("(2) RED: the report's harness digest is the harness on disk", () => {
    const recorded = String(report().harnessSha256 ?? "");
    const onDisk = digest(HARNESS);
    expect(
      recorded,
      `captured against harness ${recorded.slice(0, 12)} but the harness is ${onDisk.slice(0, 12)} — re-run capture.mts`,
    ).toBe(onDisk);
  });
});
