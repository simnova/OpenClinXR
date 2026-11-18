import {
  GATED_FILES,
  resolveAssetStoreRoot,
  skipIfStoreAbsent,
} from "@openclinxr/station-face-realism/runner";
import { describe, expect, it } from "vitest";

/**
 * The asset store gate ratchet: exactly the 12 machine-local test files may
 * skip, each with a sentinel path under the store root. An unlisted caller is
 * refused, never skipped.
 */
describe("the asset store gate lists twelve files", () => {
  it("GATED_FILES has 12 entries with relative sentinel paths", () => {
    const entries = Object.entries(GATED_FILES);
    expect(entries).toHaveLength(12);
    for (const [file, entry] of entries) {
      const sentinels = typeof entry === "string" ? [entry] : [...entry];
      expect(sentinels.length, `${file} lists at least one sentinel`).toBeGreaterThan(0);
      for (const sentinel of sentinels) {
        expect(typeof sentinel, `${file} sentinel is a string`).toBe("string");
        expect(sentinel.length, `${file} sentinel is non-empty`).toBeGreaterThan(0);
        expect(sentinel.startsWith("/"), `${file} sentinel is root-relative`).toBe(false);
      }
    }
  });

  it("an unlisted caller is refused instead of skipped", () => {
    expect(() => skipIfStoreAbsent("packages/unlisted/not-a-gated-file.test.ts")).toThrow(
      /not listed in GATED_FILES/,
    );
  });

  it("the default root lives under the machine-local asset store", () => {
    const previous = process.env["OPENCLINXR_ASSET_STORE"];
    try {
      delete process.env["OPENCLINXR_ASSET_STORE"];
      expect(resolveAssetStoreRoot()).toContain("openclinxr-assets/store");
    } finally {
      if (previous === undefined) delete process.env["OPENCLINXR_ASSET_STORE"];
      else process.env["OPENCLINXR_ASSET_STORE"] = previous;
    }
  });

  it("an absolute env override wins; a relative one throws", () => {
    const previous = process.env["OPENCLINXR_ASSET_STORE"];
    try {
      process.env["OPENCLINXR_ASSET_STORE"] = "/tmp/empty-store";
      expect(resolveAssetStoreRoot()).toBe("/tmp/empty-store");
      process.env["OPENCLINXR_ASSET_STORE"] = "relative/path";
      expect(() => resolveAssetStoreRoot()).toThrow(/non-absolute/);
    } finally {
      if (previous === undefined) delete process.env["OPENCLINXR_ASSET_STORE"];
      else process.env["OPENCLINXR_ASSET_STORE"] = previous;
    }
  });
});
