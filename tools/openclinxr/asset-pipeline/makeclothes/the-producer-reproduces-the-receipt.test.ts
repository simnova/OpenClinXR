/**
 * Counterweight (MADR 0061 mouth-station pilot): the registry run from the
 * git pre-image reproduces the receipt bytes. This pins the station side of
 * the refactor: buildProblem plus the pinned solver plus apply must emit the
 * same seated GLB the producer CLI committed. The input always comes from
 * git, never from disk (disk holds the seated output).
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("the producer reproduces the receipt", () => {
  it("registry.run from the git pre-image hashes to the receipt outputSha256", async () => {
    const pre = readProducerReceipt(REPO, RECEIPT_REL);
    const prePath = loadProducerPreimage(REPO, GLB_REL, pre.preImageSha256, pre.preImageBytes);
    const preBytes = readFileSync(prePath);
    const { glbBytes, receiptNote, solution } = await run(preBytes, { targetGapMm: 3.743 });
    expect(sha256(glbBytes)).toBe(pre.outputSha256);
    expect(glbBytes.length).toBe(pre.outputBytes);
    expect(solution.solverId).toBe("mouth-closedform");
    expect(receiptNote).toContain("mouth-closedform");
  }, 600_000);
});
