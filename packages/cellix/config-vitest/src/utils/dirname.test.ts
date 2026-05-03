import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { getDirnameFromImportMetaUrl } from "./dirname.js";

describe("getDirnameFromImportMetaUrl", () => {
  it("returns the directory name for a file URL", () => {
    const absolutePath = path.resolve("packages/cellix/config-vitest/src/utils/dirname.ts");
    const fileUrl = pathToFileURL(absolutePath).href;

    expect(getDirnameFromImportMetaUrl(fileUrl)).toBe(path.dirname(absolutePath));
  });
});
