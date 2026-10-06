/**
 * Producer determinism (mouth-tuning skill section 4, D1/D9): the committed
 * producer run twice from the committed pre-image GLB yields byte-identical
 * output whose hash equals the receipt's outputSha256. The pre-image comes
 * from git history (the revision whose bytes hash to the receipt's
 * preImageSha256), not from disk: disk holds the seated output.
 *
 * A rim/donor ordering change must fail this test: donor tie-breaks and
 * rest-gap summation follow array order, so a shuffle changes bytes.
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
  readProducerReceipt,
} from "./producer-preimage.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;
/** Operator-set rest target, same value as the producer invocation in the receipt. */
const TARGET_GAP_MM = 3.743;
/** Teeth down-gain of the producer invocation in the receipt (1 on main, 1.25 on variant-a). */
const DOWN_GAIN = 1.25;
/** Rest drop of the producer invocation in the receipt (0 on main, -1.405 on rest-a/rest-b, 4.215 on lower-arch-fix). */
const REST_DROP_MM = 4.215;

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function runProducer(glbPath: string): void {
  const args = [
    "exec", "tsx", "tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts",
    glbPath, "--target-gap-mm", String(TARGET_GAP_MM),
  ];
  if (DOWN_GAIN !== 1) args.push("--down-gain", String(DOWN_GAIN));
  if (REST_DROP_MM !== 0) args.push("--rest-drop-mm", String(REST_DROP_MM));
  execFileSync("pnpm", args, { cwd: REPO, stdio: "pipe", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
}

describe("rim-seat producer determinism", () => {
  it("two runs from the git pre-image are byte-identical and match the receipt", () => {
    const pre = readProducerReceipt(REPO, RECEIPT_REL);
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
    expect(sha256(a)).toBe(pre.outputSha256);
    expect(a.length).toBe(pre.outputBytes);
  }, 600_000);
});
