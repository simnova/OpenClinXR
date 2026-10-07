/**
 * Mouth executor entry tests (MADR 0061 mouth executor).
 *
 * Fast clauses pin the problem/solution handshake; the slow clause proves the
 * moved seat reproduces the committed receipt bytes through the new entry.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Solution } from "@openclinxr/station-mouth-objective";
import { apply } from "./apply.js";
import { buildProblem } from "./problem.js";
import { loadProducerPreimage, readProducerReceipt } from "./producer-preimage.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..", "..");
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;

// Transitional direct-apply identity: the registry card replaces it with the
// pinned solver id/version. The verifier re-run catches unpinned output (d7).
const DIRECT_SOLVER_ID = "mouth-direct-apply";
const DIRECT_SOLVER_VERSION = "0.0.0";

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function directSolution(inputHash: string): Solution {
  return { solverId: DIRECT_SOLVER_ID, solverVersion: DIRECT_SOLVER_VERSION, inputHash, frames: [] };
}

describe("mouth executor", () => {
  it("buildProblem hashes the input bytes and pins the step3 clock", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const problem = buildProblem(bytes, { targetGapMm: 3.743 });
    expect(problem.inputHash).toBe(sha256(bytes));
    expect(problem.trackId).toBe("step3-fixed-capture");
    expect(problem.frameRate).toBe(30);
    expect(problem.frameCount).toBe(124);
  });

  it("buildProblem refuses a non-positive target", () => {
    expect(() => buildProblem(new Uint8Array([1]), { targetGapMm: 0 })).toThrow();
    expect(() => buildProblem(new Uint8Array([1]), { targetGapMm: Number.NaN })).toThrow();
  });

  it("apply refuses a solution hash that does not match the input bytes", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    await expect(
      apply(bytes, directSolution("nope"), {
        targetGapMm: 3.743,
        solverId: DIRECT_SOLVER_ID,
        solverVersion: DIRECT_SOLVER_VERSION,
      }),
    ).rejects.toThrow(/inputHash/);
  });

  it("apply refuses provenance that does not name the solution solver", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const problem = buildProblem(bytes, { targetGapMm: 3.743 });
    await expect(
      apply(bytes, directSolution(problem.inputHash), {
        targetGapMm: 3.743,
        solverId: "other",
        solverVersion: DIRECT_SOLVER_VERSION,
      }),
    ).rejects.toThrow(/provenance/);
  });

  it("apply through the new entry reproduces the receipt bytes", async () => {
    const pre = readProducerReceipt(REPO, RECEIPT_REL);
    const prePath = loadProducerPreimage(REPO, GLB_REL, pre.preImageSha256, pre.preImageBytes);
    const preBytes = readFileSync(prePath);
    const problem = buildProblem(preBytes, { targetGapMm: 3.743 });
    expect(problem.inputHash).toBe(pre.preImageSha256);
    const { glbBytes, receiptNote } = await apply(
      preBytes,
      directSolution(problem.inputHash),
      { targetGapMm: 3.743, solverId: DIRECT_SOLVER_ID, solverVersion: DIRECT_SOLVER_VERSION },
    );
    expect(sha256(glbBytes)).toBe(pre.outputSha256);
    expect(glbBytes.length).toBe(pre.outputBytes);
    expect(receiptNote).toContain("mouth-executor apply");
  }, 600_000);
});
