import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";

/**
 * Kevin provenance sidecar consistency (FINALIZE-2 C3a h10 F4).
 * The live check removed with h9's pedsExpected() — the shipped Kevin GLB's
 * whole sha/bytes equal the provenance sidecar's recorded outputSha256/
 * outputBytes — lives here, in a provenance-specific test. It is a keep-sha
 * check by nature: a material-only post-export stage moves the sidecar, and
 * any rebake must re-record it.
 */

const REPO_ROOT = repoRoot();
const KEVIN_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb");
const KEVIN_SIDECAR = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.provenance.json");

/** The shared sidecar gate: the shipped bytes, not a transcribed pin. */
export function assertKevinSidecarMatchesShipped(glbBytes: Buffer, sidecar: unknown): void {
  const doc = sidecar as { outputSha256?: unknown; outputBytes?: unknown };
  if (typeof doc.outputSha256 !== "string" || !/^[0-9a-f]{64}$/.test(doc.outputSha256)) {
    throw new Error("kevin sidecar carries no outputSha256");
  }
  if (typeof doc.outputBytes !== "number") {
    throw new Error("kevin sidecar carries no outputBytes");
  }
  expect(doc.outputSha256, "kevin sidecar outputSha256 equals the shipped GLB whole sha").toBe(
    createHash("sha256").update(glbBytes).digest("hex"),
  );
  expect(doc.outputBytes, "kevin sidecar outputBytes equals the shipped GLB bytes").toBe(glbBytes.length);
}

describe("the kevin provenance sidecar matches the shipped GLB (keep-sha)", () => {
  it("shipped kevin GLB whole sha/bytes equal the sidecar output", () => {
    assertKevinSidecarMatchesShipped(readFileSync(KEVIN_GLB), JSON.parse(readFileSync(KEVIN_SIDECAR, "utf8")));
  });

  it("a one-hex-digit outputSha256 mutation fails the gate", () => {
    const dir = mkdtempSync(join(tmpdir(), "h10-f4-sidecar-"));
    try {
      const doc = JSON.parse(readFileSync(KEVIN_SIDECAR, "utf8")) as { outputSha256: string };
      const head = doc.outputSha256[0] === "0" ? "1" : "0";
      const mutated = { ...doc, outputSha256: `${head}${doc.outputSha256.slice(1)}` };
      const tmpSidecar = join(dir, "mpfb-peds-nurse-kevin.provenance.json");
      writeFileSync(tmpSidecar, `${JSON.stringify(mutated, null, 2)}\n`);
      console.log("F4", { before: doc.outputSha256.slice(0, 8), after: mutated.outputSha256.slice(0, 8) });
      expect(() => assertKevinSidecarMatchesShipped(readFileSync(KEVIN_GLB), JSON.parse(readFileSync(tmpSidecar, "utf8")))).toThrow(
        /outputSha256 equals the shipped GLB whole sha/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
