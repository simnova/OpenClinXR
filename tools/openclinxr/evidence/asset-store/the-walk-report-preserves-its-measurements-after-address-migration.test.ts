import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const REPORT = path.join(REPO, "docs/openclinxr/evidence/bound-clip-foot-plant.json");
const RECEIPT = path.join(
  REPO,
  "docs/openclinxr/evidence/asset-store-migrations/physician-walk-20261026.json",
);
const EXPECTED_DIGEST = "a1be4be8b598c22a8fcf38ec005d336990ec09a5b978b7399152926b6f07fb3c";
const EXPECTED_REF =
  "store:f22b6f95cc9bc0c860a091d3880d1859c1951df1ac339eb960b3624e3b34dfed/physician-walk.glb";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

function semanticDigest(report: Record<string, unknown>): string {
  const clone = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  delete (clone.asset as Record<string, unknown>).glbPath;
  return createHash("sha256").update(JSON.stringify(sortKeys(clone)), "utf8").digest("hex");
}

describe("walk report preserves measurements after address migration", () => {
  it("keeps every measurement, flag, and epoch through the pinned semantic digest", async () => {
    const report = JSON.parse(await readFile(REPORT, "utf8"));
    expect(report.asset.glbPath).toBe(EXPECTED_REF);
    expect(semanticDigest(report)).toBe(EXPECTED_DIGEST);
    expect(report.generatedAt).toBe("2026-09-09T13:29:10.606Z");
    expect(report.asset.sha256).toBe(
      "f22b6f95cc9bc0c860a091d3880d1859c1951df1ac339eb960b3624e3b34dfed",
    );
    expect(report.asset.bytes).toBe(11633760);
  });

  it("receipt cites the actual asset and the immutable original, with distinct epochs", async () => {
    const receipt = JSON.parse(await readFile(RECEIPT, "utf8"));
    expect(receipt.actualAssetRef).toBe(EXPECTED_REF);
    expect(receipt.actualAssetSha256).toBe(
      "f22b6f95cc9bc0c860a091d3880d1859c1951df1ac339eb960b3624e3b34dfed",
    );
    expect(receipt.actualAssetBytes).toBe(11633760);
    expect(receipt.immutableRawReportSha256).toBe(
      "ead0238fc6d048cd5f4f22ef9ba3ce019c1eb2bcfb134e57e702423e78a30a75",
    );
    expect(receipt.originalMeasurementEpoch).toBe("2026-09-09T13:29:10.606Z");
    expect(receipt.currentMigrationEpoch).not.toBe(receipt.originalMeasurementEpoch);
    expect(receipt.semanticDigestExcludingOnlyAssetGlbPath).toBe(EXPECTED_DIGEST);
  });
});
