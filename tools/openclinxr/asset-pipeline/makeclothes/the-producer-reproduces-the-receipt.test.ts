/**
 * Counterweight (MADR 0061 mouth-station pilot): the CURRENT producer CLI run
 * from the git pre-image reproduces the receipt bytes. This pins the producer
 * side before the station refactor, so the new executor package must apply
 * the same solution. Reuses the determinism test's machinery (pre-image walk
 * plus receipt-derived argv now shared from producer-preimage.ts).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadProducerPreimage,
  producerArgvFromReceipt,
  readProducerReceipt,
} from "./producer-preimage.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;
const PRODUCER_REL = "tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts";

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("the producer reproduces the receipt", () => {
  it("one run from the git pre-image hashes to the receipt outputSha256", () => {
    const pre = readProducerReceipt(REPO, RECEIPT_REL);
    const prePath = loadProducerPreimage(REPO, GLB_REL, pre.preImageSha256, pre.preImageBytes);
    const dir = mkdtempSync(path.join(tmpdir(), "producer-receipt-"));
    const out = path.join(dir, "repro.glb");
    writeFileSync(out, readFileSync(prePath));
    execFileSync(
      "pnpm",
      ["exec", "tsx", PRODUCER_REL, out, ...producerArgvFromReceipt(REPO, RECEIPT_REL)],
      { cwd: REPO, stdio: "pipe", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const bytes = readFileSync(out);
    expect(sha256(bytes)).toBe(pre.outputSha256);
    expect(bytes.length).toBe(pre.outputBytes);
  }, 600_000);
});
