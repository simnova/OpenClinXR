/**
 * Producer determinism (mouth-tuning skill section 4, D1/D9): the committed
 * producer run twice from the committed pre-image GLB yields byte-identical
 * output whose hash equals the receipt's recorded SEAT STAGE (ci-w6
 * adaptation, see readSeatStageReceipt: the receipt is now multi-stage and
 * its top-level outputSha256 is the post-albedo FINAL bytes, three deliberate
 * stages past seating). The pre-image comes from git history (the revision
 * whose bytes hash to the receipt's preImageSha256), not from disk: disk
 * holds the seated output.
 *
 * The producer argv is derived from the receipt's latest
 * seat-teeth-on-lip-rim.ts sourceNotes entry, never hand-copied here: a new
 * producer flag lands in the receipt's sourceNotes and the test follows it.
 *
 * A rim/donor ordering change must fail this test: donor tie-breaks and
 * rest-gap summation follow array order, so a shuffle changes bytes.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import {
  loadProducerPreimage,
  producerArgvFromReceipt,
  readProducerReceipt,
} from "../../../../../../tools/openclinxr/asset-pipeline/makeclothes/producer-preimage.js";
import { readSeatStageReceipt } from "../../../../../../tools/openclinxr/asset-pipeline/makeclothes/seat-stage-receipt.js";

const REPO = repoRoot();
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;
const PRODUCER_REL = "tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts";

/**
 * Seat-stage byte length, measured by running the producer (argv derived from
 * the receipt, same as this test) on the git pre-image 202ec91134a7 on
 * 2026-10-30: output 5cab6676… (40345712 B), matching the receipt's
 * seat-stage pin. The receipt records the seat sha but no seat byte length.
 */
const SEAT_STAGE_BYTES = 40345712;

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function runProducer(glbPath: string): void {
  const args = [
    "exec", "tsx", PRODUCER_REL,
    glbPath, ...producerArgvFromReceipt(REPO, RECEIPT_REL),
  ];
  execFileSync("pnpm", args, { cwd: REPO, stdio: "pipe", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
}

describe("rim-seat producer determinism", () => {
  it("two runs from the git pre-image are byte-identical and match the receipt seat stage", () => {
    const pre = readProducerReceipt(REPO, RECEIPT_REL);
    const seat = readSeatStageReceipt(REPO, RECEIPT_REL);
    const prePath = loadProducerPreimage(REPO, GLB_REL, pre.preImageSha256, pre.preImageBytes);
    const preBytes = readFileSync(prePath);
    const dir = mkdtempSync(path.join(tmpdir(), "rim-seat-determinism-"));
    const outA = path.join(dir, "a.glb");
    const outB = path.join(dir, "b.glb");
    writeFileSync(outA, preBytes);
    writeFileSync(outB, preBytes);
    runProducer(outA);
    runProducer(outB);
    const a = readFileSync(outA);
    const b = readFileSync(outB);
    expect(Buffer.compare(a, b)).toBe(0);
    expect(sha256(a)).toBe(seat.seatStageSha256);
    expect(a.length).toBe(SEAT_STAGE_BYTES);
  }, 600_000);
});
