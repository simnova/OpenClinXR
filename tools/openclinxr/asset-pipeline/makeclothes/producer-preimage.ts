/**
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

/** Temp path holding the pre-image bytes. Throws when no revision matches. */
export function loadProducerPreimage(
  repoRoot: string,
  glbRel: string,
  expectedSha256: string,
  expectedBytes: number,
  searchDepth = 10,
): string {
  const revisions = execFileSync("git", ["rev-list", "HEAD", "--", glbRel], {
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
