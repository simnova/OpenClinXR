/**
 * Counterweight (MADR 0061 mouth-station pilot, ci-w6 adapted): the registry
 * run from the git pre-image reproduces the receipt's SEAT STAGE bytes. The
 * receipt is now multi-stage (Oct-21 garment stamp, Oct-22 mouth-physical via
 * seat-teeth-ff1-open08.ts, Oct-25 albedoRepair), so the top-level
 * outputSha256 is the FINAL bytes; the seat stage is pinned by
 * readSeatStageReceipt (garment stamp input == mouth-physical baseline).
 * This pins the station side of the refactor: buildProblem plus the pinned
 * solver plus apply must emit the same seated GLB the producer CLI committed
 * (the determinism test pins the CLI side to the same value). The input
 * always comes from git, never from disk (disk holds the seated output).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "@openclinxr/station-mouth-registry";
import { describe, expect, it } from "vitest";
import {
  loadProducerPreimage,
  readProducerReceipt,
} from "./producer-preimage.js";
import { readSeatStageReceipt } from "./seat-stage-receipt.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;

/**
 * Seat-stage byte length: see seat-teeth-producer-determinism.test.ts (same
 * producer run, same pre-image, measured 2026-10-30).
 */
const SEAT_STAGE_BYTES = 40345712;

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("the producer reproduces the receipt", () => {
  it("registry.run from the git pre-image hashes to the receipt seat stage", async () => {
    const pre = readProducerReceipt(REPO, RECEIPT_REL);
    const seat = readSeatStageReceipt(REPO, RECEIPT_REL);
    const prePath = loadProducerPreimage(REPO, GLB_REL, pre.preImageSha256, pre.preImageBytes);
    const preBytes = readFileSync(prePath);
    const { glbBytes, receiptNote, solution } = await run(preBytes, { targetGapMm: 3.743 });
    expect(sha256(glbBytes)).toBe(seat.seatStageSha256);
    expect(glbBytes.length).toBe(SEAT_STAGE_BYTES);
    expect(solution.solverId).toBe("mouth-closedform");
    expect(receiptNote).toContain("mouth-closedform");
  }, 600_000);
});
