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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;
/** Operator-set rest target, same value as the producer invocation in the receipt. */
const TARGET_GAP_MM = 3.743;
/** Cap on history walk: the pre-image is two commits back; 10 is headroom. */
const PRE_IMAGE_SEARCH_DEPTH = 10;

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function receipt(): {
  outputSha256: string;
  outputBytes: number;
  preImageSha256: string;
  preImageBytes: number;
} {
  return JSON.parse(readFileSync(path.join(REPO, RECEIPT_REL), "utf8")) as {
    outputSha256: string;
    outputBytes: number;
    preImageSha256: string;
    preImageBytes: number;
  };
}

/** Newest-first revisions touching the GLB; the first whose bytes match the receipt pre-image wins. */
function preImageBytes(expectedSha256: string): Buffer {
  const revisions = execFileSync("git", ["rev-list", "HEAD", "--", GLB_REL], {
    cwd: REPO,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, PRE_IMAGE_SEARCH_DEPTH);
  for (const revision of revisions) {
    const bytes = execFileSync("git", ["show", `${revision}:${GLB_REL}`], {
      cwd: REPO,
      maxBuffer: 128 * 1024 * 1024,
    }) as Buffer;
    if (sha256(bytes) === expectedSha256) return bytes;
  }
  throw new Error(`no revision in the last ${PRE_IMAGE_SEARCH_DEPTH} matches preImageSha256 ${expectedSha256}`);
}

function runProducer(glbPath: string): void {
  execFileSync(
    "pnpm",
    ["exec", "tsx", "tools/openclinxr/asset-pipeline/makeclothes/seat-teeth-on-lip-rim.ts", glbPath, "--target-gap-mm", String(TARGET_GAP_MM)],
    { cwd: REPO, stdio: "pipe", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
  );
}

describe("rim-seat producer determinism", () => {
  it("two runs from the git pre-image are byte-identical and match the receipt", () => {
    const pre = receipt();
    const preBytes = preImageBytes(pre.preImageSha256);
    expect(preBytes.length).toBe(pre.preImageBytes);
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
