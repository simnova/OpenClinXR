/**
 * Producer pre-image locator (MADR 0061 mouth executor).
 *
 * Moved verbatim from tools/openclinxr/asset-pipeline/makeclothes/producer-preimage.ts.
 * The tools module re-exports this file; behavior is unchanged.
 *
 * Locate the rim-seat producer's pre-image GLB in git history.
 *
 * The receipt records the pre-image content hash (preImageSha256), not a
 * revision; this module walks the GLB's history newest-first and returns a
 * temp copy of the first revision whose bytes match. Tests import this
 * instead of reimplementing the walk: the producer's input always comes
 * from git, never from disk (disk holds the seated output).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type ProducerReceipt = {
  outputSha256: string;
  outputBytes: number;
  preImageSha256: string;
  preImageBytes: number;
};

export function readProducerReceipt(repoRoot: string, receiptRel: string): ProducerReceipt {
  return JSON.parse(readFileSync(path.join(repoRoot, receiptRel), "utf8")) as ProducerReceipt;
}

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Derive the producer argv (minus the glb path) from the receipt's latest
 * seat-teeth-on-lip-rim.ts sourceNotes entry. Only `--`-prefixed tokens
 * count, so prose words like "rigid" or "FF-contact" never become flags.
 * Shared by the determinism test and the receipt-reproduction counterweight.
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

/** Temp path holding the pre-image bytes. Throws when no revision matches.
 *
 * The walk follows renames (`git log --follow`): the rim-seat pre-image
 * predates a GLB path rename, so a plain rev-list never reaches it. Depth
 * 32 covers the rename plus the seat chain with margin.
 */
export function loadProducerPreimage(
  repoRoot: string,
  glbRel: string,
  expectedSha256: string,
  expectedBytes: number,
  searchDepth = 32,
): string {
  const revisions = execFileSync("git", ["log", "--follow", "--format=%H", "HEAD", "--", glbRel], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, searchDepth);
  for (const revision of revisions) {
    const bytes = execFileSync("git", ["show", `${revision}:${glbRel}`], {
      cwd: repoRoot,
      maxBuffer: 128 * 1024 * 1024,
    }) as Buffer;
    if (sha256(bytes) === expectedSha256) {
      if (bytes.length !== expectedBytes) {
        throw new Error(`pre-image byte count moved: ${bytes.length} vs receipt ${expectedBytes}`);
      }
      const dir = mkdtempSync(path.join(tmpdir(), "producer-preimage-"));
      const out = path.join(dir, "preimage.glb");
      writeFileSync(out, bytes);
      return out;
    }
  }
  throw new Error(`no revision in the last ${searchDepth} matches preImageSha256 ${expectedSha256}`);
}
