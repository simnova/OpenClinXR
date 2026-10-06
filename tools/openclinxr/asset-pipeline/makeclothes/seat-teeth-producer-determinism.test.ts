/**
 * Producer determinism (mouth-tuning skill section 4, D1/D9): the committed
 * producer run twice from the committed pre-image GLB yields byte-identical
 * output whose hash equals the receipt's outputSha256. The pre-image comes
 * from git history (the revision whose bytes hash to the receipt's
 * preImageSha256), not from disk: disk holds the seated output.
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
const PRODUCER_REL = "tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts";

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Derive the producer argv (minus the glb path) from the receipt's latest
 * seat-teeth-on-lip-rim.ts sourceNotes entry. Only `--`-prefixed tokens
 * count, so prose words like "rigid" or "FF-contact" never become flags.
 */
export function producerArgvFromReceipt(repoRoot: string, receiptRel: string): string[] {
  const receipt = JSON.parse(
    readFileSync(path.join(repoRoot, receiptRel), "utf8"),
  ) as { sourceNotes?: string[] };
  const notes = receipt.sourceNotes ?? [];
  const producerNotes = notes.filter((note) => note.includes("seat-teeth-on-lip-rim.ts"));
  if (producerNotes.length === 0) {
    throw new Error("receipt has no seat-teeth-on-lip-rim.ts sourceNotes entry");
  }
  const latest = producerNotes[producerNotes.length - 1] ?? "";
  const flagValue = (flag: string): string | undefined => {
    const match = latest.match(new RegExp(`${flag}\\s+(-?[0-9]+(?:\\.[0-9]+)?)`));
    return match?.[1];
  };
  const targetGapMm = flagValue("--target-gap-mm");
  if (targetGapMm === undefined) {
    throw new Error("receipt sourceNotes entry has no --target-gap-mm");
  }
  const argv = ["--target-gap-mm", targetGapMm];
  const downGain = flagValue("--down-gain");
  if (downGain !== undefined && Number(downGain) !== 1) argv.push("--down-gain", downGain);
  const restDropMm = flagValue("--rest-drop-mm");
  if (restDropMm !== undefined && Number(restDropMm) !== 0) argv.push("--rest-drop-mm", restDropMm);
  if (latest.includes("--ff-lip-contact")) argv.push("--ff-lip-contact");
  if (/(?:^|\s)--rigid(?:\s|$)/.test(latest)) argv.push("--rigid");
  return argv;
}

function runProducer(glbPath: string): void {
  const args = [
    "exec", "tsx", PRODUCER_REL,
    glbPath, ...producerArgvFromReceipt(REPO, RECEIPT_REL),
  ];
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
