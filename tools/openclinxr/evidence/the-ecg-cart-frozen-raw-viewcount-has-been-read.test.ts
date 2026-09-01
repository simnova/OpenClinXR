import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: M1 named "read bake-measure viewCount on frozen raw before G1 4-view".
 * The frozen 973,639 GLB is gitignored staging. Adjacent bake-measure.json may be absent.
 * This RED fails until a TRACKED report echoes the freeze SHA and records viewCount
 * (integer) or missingBakeMeasure=true with viewCount null. GPU-free. Do not re-score M1.
 *
 * IMMUTABLE diagnosis. Flip it.fails → it and append ## FIXED. Do not rewrite freeze hashes.
 *
 * Control freeze: tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json
 *
 * Counterweight: a report that copies midband 974864 / viewCount 4 without matching the
 * frozen SHA is refused. namedNext must mention G1 only when viewCount is null or < 4.
 *
 * claimScope: whether viewCount of the frozen raw was read or recorded missing.
 * notEvidenceFor: Quest, that a 4-view bake ran, hatch remesh, M1 pixel grade.
 *
 * ## FIXED (tsk_e65b885da7940425)
 * GPU-free scan: freeze SHA matches; no adjacent bake-measure; no evidence bake-measure
 * export SHA-matches the freeze. viewCount null, missingBakeMeasure true. G1 remains eligible.
 */

const REPO = join(import.meta.dirname, "../../..");
const CONTROL = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json");
const REPORT = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-raw-viewcount-report.json");

type Freeze = {
  stagingDir: string;
  raw: { file: string; sha256: string; triangles: number };
};

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("the ECG cart frozen raw viewCount has been read", () => {
  it("(1) tracked report echoes freeze SHA and records viewCount or missing", () => {
    const freeze = JSON.parse(readFileSync(CONTROL, "utf8")) as Freeze;
    const glb = join(REPO, freeze.stagingDir, freeze.raw.file);
    expect(existsSync(glb), `control GLB missing (gitignored staging): ${glb}`).toBe(true);
    expect(sha256File(glb), freeze.raw.file).toBe(freeze.raw.sha256);

    expect(existsSync(REPORT), `${REPORT} is the tracked land path`).toBe(true);
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      schemaVersion?: string;
      rawSha256?: string;
      viewCount?: number | null;
      missingBakeMeasure?: boolean;
      namedNext?: string;
      bakeMeasurePath?: string | null;
    };
    expect(report.schemaVersion).toBe("openclinxr.ecg-cart-raw-viewcount.v1");
    expect(report.rawSha256).toBe(freeze.raw.sha256);
    if (report.missingBakeMeasure === true) {
      expect(report.viewCount).toBeNull();
      expect(report.bakeMeasurePath ?? null).toBeNull();
    } else {
      expect(typeof report.viewCount).toBe("number");
      expect(Number(report.viewCount)).toBeGreaterThanOrEqual(1);
    }
    expect(report.namedNext?.length ?? 0).toBeGreaterThan(20);
    if (report.viewCount === null || (typeof report.viewCount === "number" && report.viewCount < 4)) {
      expect(report.namedNext, "G1 remains eligible when viewCount is unknown or < 4").toMatch(/G1/u);
    } else {
      expect(report.namedNext, "do not schedule G1 when viewCount already ≥ 4").not.toMatch(/run G1/iu);
    }
  });
});

// NOT TESTED: live factory:trellis:bake; hatch remesh; M1/C1 pixels.
