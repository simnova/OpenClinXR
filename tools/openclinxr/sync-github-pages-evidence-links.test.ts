import { readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { syncGithubPagesEvidenceLinks } from "./sync-github-pages-evidence-links.js";

describe("GitHub Pages snapshot link syncing", () => {
  it("updates stale snapshot links to the latest available files", async () => {
    const tempIndexPath = `docs/index.${randomUUID()}.html`;
    const originalIndex = await readFile("docs/index.html", "utf8");
    const staleIndex = originalIndex.replace(
      'href="https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json"',
      'href="https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/asset-production-readiness-benchmark-2026-05-05.json"',
    );

    try {
      await writeFile(tempIndexPath, staleIndex, "utf8");
      const result = await syncGithubPagesEvidenceLinks(tempIndexPath);

      expect(result.changed).toBe(true);
      expect(result.updates).toEqual([
        {
          key: "asset-production-readiness-benchmark",
          previousFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-05.json",
          nextFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
        },
      ]);

      const updatedIndex = await readFile(tempIndexPath, "utf8");
      expect(
        updatedIndex.includes(
          'href="https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json"',
        ),
      ).toBe(true);
      expect(
        updatedIndex.includes(
          'href="https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/asset-production-readiness-benchmark-2026-05-05.json"',
        ),
      ).toBe(false);
    } finally {
      try {
        await unlink(tempIndexPath);
      } catch {
        // ignore cleanup failures in case temp file was never created.
      }
    }
  });

  it("returns a no-op result when links are already up to date", async () => {
    const tempIndexPath = `docs/index.${randomUUID()}.html`;
    const originalIndex = await readFile("docs/index.html", "utf8");

    try {
      await writeFile(tempIndexPath, originalIndex, "utf8");
      const result = await syncGithubPagesEvidenceLinks(tempIndexPath);
      expect(result.changed).toBe(false);
      expect(result.updates).toEqual([]);
    } finally {
      try {
        await unlink(tempIndexPath);
      } catch {
        // ignore cleanup failures in case temp file was never created.
      }
    }
  });

  it("supports check-mode updates without writing when write is disabled", async () => {
    const tempIndexPath = `docs/index.${randomUUID()}.html`;
    const staleIndex = (await readFile("docs/index.html", "utf8")).replace(
      'href="https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json"',
      'href="https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/asset-production-readiness-benchmark-2026-05-05.json"',
    );

    try {
      await writeFile(tempIndexPath, staleIndex, "utf8");
      const result = await syncGithubPagesEvidenceLinks(tempIndexPath, { write: false });

      expect(result.changed).toBe(true);
      expect(result.updates).toEqual([
        {
          key: "asset-production-readiness-benchmark",
          previousFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-05.json",
          nextFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
        },
      ]);

      const rewrittenIndex = await readFile(tempIndexPath, "utf8");
      expect(
        rewrittenIndex.includes(
          'href="https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json"',
        ),
      ).toBe(false);
      expect(
        rewrittenIndex.includes(
          'href="https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/asset-production-readiness-benchmark-2026-05-05.json"',
        ),
      ).toBe(true);
    } finally {
      try {
        await unlink(tempIndexPath);
      } catch {
        // ignore cleanup failures in case temp file was never created.
      }
    }
  });
});
