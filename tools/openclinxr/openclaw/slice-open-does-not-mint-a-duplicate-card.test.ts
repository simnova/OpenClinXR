import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cmdSliceOpen } from "./board-cli.js";

/**
 * **OBSERVABLE: `slice-open` on an `issue-N` id refuses instead of minting a duplicate.**
 *
 * MEASURED 2026-08-24. A direct dispatch left no local board record, so `board close` refused. The
 * operator reached for `slice-open` to reconstruct lifecycle state — and it plans `gh issue create`
 * unconditionally. It minted **#617** as a duplicate of the existing **#26**: only the generated
 * coordination skeleton, alive 36 seconds, closed without grading. The dry-run had already printed
 * `issue=n/a` and it was run anyway.
 *
 * `resolveIssueNumberForSlice` (board-cli.ts:447) already treats `issue-<n>` as naming GitHub issue
 * n. This makes that convention binding rather than advisory.
 *
 * claimScope: the slice-id-to-issue convention at the creation boundary.
 * notEvidenceFor: whether a local board record exists, or whether the referenced issue is suitable.
 */
const args = (sliceId: string, extra: Record<string, unknown> = {}) => ({
  sliceId, title: "reconstructed lifecycle", roles: ["asset-pipeline-lead"],
  repo: "simnova/OpenClinXR", dryRun: true, ...extra,
});

describe("slice-open does not mint a duplicate card", () => {
  it("(1) refuses an issue-N slice id — the #617 shape", () => {
    const root = mkdtempSync(join(tmpdir(), "slice-"));
    expect(() => cmdSliceOpen(root, args("issue-26") as never)).toThrow(/already names GitHub issue #26/u);
    // The refusal must name the recovery, or the operator reaches for the same tool again.
    expect(() => cmdSliceOpen(root, args("issue-26") as never)).toThrow(/write the record for #26/u);
  });

  it("(2) COUNTERWEIGHT: a genuine new-slice id still opens", () => {
    // Without this, a guard refusing every slice-open satisfies clause (1) and breaks real slice
    // creation, which is the command's actual job.
    const root = mkdtempSync(join(tmpdir(), "slice-"));
    const r = cmdSliceOpen(root, args("mpfb-eye-colour-sweep") as never);
    expect(r.record.sliceId).toBe("mpfb-eye-colour-sweep");
    expect(r.plan.argv.join(" "), "a new slice really does create an issue").toMatch(/issue create/u);
  });

  it("(3) an explicit opt-in still allows creation on an issue-N id", () => {
    const root = mkdtempSync(join(tmpdir(), "slice-"));
    const r = cmdSliceOpen(root, args("issue-999", { allowDuplicateIssue: true }) as never);
    expect(r.record.sliceId).toBe("issue-999");
  });

  it("(4) the guard is on the ID SHAPE, not on whether a record happens to exist", () => {
    // A missing local record is exactly the situation that produced #617, so absence of a record
    // must not be what unlocks creation.
    const root = mkdtempSync(join(tmpdir(), "slice-"));
    expect(() => cmdSliceOpen(root, args("issue-1") as never)).toThrow(/REFUSED/u);
  });
});
