import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";
import { syncGithubPagesEvidenceLinks } from "../../../../../../tools/openclinxr/evidence/sync-github-pages-evidence-links.js";

process.chdir(repoRoot());

const staleSnapshotPath = "docs/openclinxr/asset-production-readiness-benchmark-2098-01-01.json";
const latestSnapshotPath = "docs/openclinxr/asset-production-readiness-benchmark-2099-01-01.json";
const staleSnapshotUrl = `https://github.com/simnova/OpenClinXR/blob/main/${staleSnapshotPath}`;
const latestSnapshotUrl = `https://github.com/simnova/OpenClinXR/blob/main/${latestSnapshotPath}`;
// The page fixture is owned here, not read from the live docs/index.html: the live page dropped
// its readiness-benchmark link in website W3 (1040ed3c1), which made the stale-link swap a no-op.
const staleIndex = `<!doctype html>
<html><body>
  <a
    data-pages-snapshot="asset-production-readiness-benchmark"
    href="${staleSnapshotUrl}"
  >
    Local launch selection (peds)
  </a>
</body></html>
`;

async function withTemporarySnapshotFixtures(run: () => Promise<void>): Promise<void> {
  await writeFile(staleSnapshotPath, "{}\n", "utf8");
  await writeFile(latestSnapshotPath, "{}\n", "utf8");
  try {
    await run();
  } finally {
    await Promise.all([unlink(staleSnapshotPath).catch(() => undefined), unlink(latestSnapshotPath).catch(() => undefined)]);
  }
}

describe("GitHub Pages snapshot link syncing", () => {
  it("updates stale snapshot links to the latest available files", async () => {
    const tempIndexPath = `docs/index.${randomUUID()}.html`;

    try {
      await writeFile(tempIndexPath, staleIndex, "utf8");
      await withTemporarySnapshotFixtures(async () => {
        const result = await syncGithubPagesEvidenceLinks(tempIndexPath);

        expect(result.changed).toBe(true);
        expect(result.updates).toEqual([
          {
            key: "asset-production-readiness-benchmark",
            previousFile: staleSnapshotPath,
            nextFile: latestSnapshotPath,
          },
        ]);
      });

      const updatedIndex = await readFile(tempIndexPath, "utf8");
      expect(updatedIndex.includes(`href="${latestSnapshotUrl}"`)).toBe(true);
      expect(updatedIndex.includes(`href="${staleSnapshotUrl}"`)).toBe(false);
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

    try {
      await writeFile(tempIndexPath, staleIndex, "utf8");
      await withTemporarySnapshotFixtures(async () => {
        const result = await syncGithubPagesEvidenceLinks(tempIndexPath, { write: false });

        expect(result.changed).toBe(true);
        expect(result.updates).toEqual([
          {
            key: "asset-production-readiness-benchmark",
            previousFile: staleSnapshotPath,
            nextFile: latestSnapshotPath,
          },
        ]);
      });

      const rewrittenIndex = await readFile(tempIndexPath, "utf8");
      expect(rewrittenIndex.includes(`href="${latestSnapshotUrl}"`)).toBe(false);
      expect(rewrittenIndex.includes(`href="${staleSnapshotUrl}"`)).toBe(true);
    } finally {
      try {
        await unlink(tempIndexPath);
      } catch {
        // ignore cleanup failures in case temp file was never created.
      }
    }
  });
});
