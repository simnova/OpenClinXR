import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findRepoRoot } from "../browser-boot-inventory.js";
import { validateGitHubPagesSite } from "../check-github-pages-site.js";

const REPO_ROOT = findRepoRoot();

const TRACKED_DOC = "docs/openclinxr/fixture-doc-2026-05-28.json";
const TRACKED_HREF = `https://github.com/simnova/OpenClinXR/blob/main/${TRACKED_DOC}`;
const MISSING_DOC_HREF =
  "https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/fixture-missing-2026-05-28.json";

const SNAPSHOT_KEYS = [
  "asset-production-evidence-ladder",
  "asset-production-artifact-evidence",
  "asset-production-readiness-benchmark",
  "github-pages-site",
] as const;

const STALE_SNAPSHOT_KEY = "asset-production-readiness-benchmark";
const STALE_SNAPSHOT_FILE = `${STALE_SNAPSHOT_KEY}-2098-01-01.json`;
const STALE_SNAPSHOT_HREF = `https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/${STALE_SNAPSHOT_FILE}`;

const FIXTURE_WORKFLOW = `name: fixture-pages
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs
`;

function snapshotHref(key: string): string {
  return `https://github.com/simnova/OpenClinXR/blob/main/docs/openclinxr/${key}-2026-05-28.json`;
}

function fixtureIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
<head><title>OpenClinXR</title><link rel="stylesheet" href="styles.css"></head>
<body>
<figure class="capture-pending" data-slot="hero-poster"></figure>
<a href="https://github.com/simnova/OpenClinXR">OpenClinXR repo</a>
<a href="${TRACKED_HREF}">fixture doc</a>
</body>
</html>
`;
}

function fixtureEngineeringHtml(): string {
  const links = SNAPSHOT_KEYS.map(
    (key) => `          <a\n            data-pages-snapshot="${key}"\n            href="${snapshotHref(key)}"\n          >\n            ${key}\n          </a>`,
  ).join("\n");
  return `<!doctype html>
<html lang="en">
<head><title>Engineering</title></head>
<body>
<h2>Evidence Docs</h2>
<section id="factory-stations">
<img src="assets/factory-station-cards-fixture.png">
<img src="assets/factory-station-equipment-generate-fixture.png">
</section>
<div class="evidence-list">
${links}
</div>
</body>
</html>
`;
}

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pages-site-"));
  await mkdir(path.join(root, "docs/openclinxr"), { recursive: true });
  await mkdir(path.join(root, "docs/assets"), { recursive: true });
  await mkdir(path.join(root, "docs/site/data"), { recursive: true });
  await mkdir(path.join(root, "docs/site/partials"), { recursive: true });
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  const write = (rel: string, content: string | Buffer): Promise<void> =>
    writeFile(path.join(root, rel), content);
  await write("docs/index.html", fixtureIndexHtml());
  await write("docs/engineering.html", fixtureEngineeringHtml());
  await write(
    "docs/styles.css",
    "body { margin: 0; }\n@media (max-width: 860px) { body { margin: 0; } }\n",
  );
  await write("docs/.nojekyll", "");
  await write("docs/CNAME", "developers.simnova.com\n");
  await write(
    "README.md",
    "# Fixture\nProject: https://developers.simnova.com/OpenClinXR/\nSource: main branch /docs tree.\n",
  );
  await write(".github/workflows/pages.yml", FIXTURE_WORKFLOW);
  await write(TRACKED_DOC, "{}\n");
  await write("docs/assets/factory-station-cards-fixture.png", Buffer.alloc(42_000, 7));
  await write("docs/assets/factory-station-equipment-generate-fixture.png", Buffer.alloc(1024, 7));
  await write("docs/site/partials/nav.html", "<nav></nav>\n");
  await write("docs/site/partials/footer.html", "<footer></footer>\n");
  for (const name of ["claims", "media", "grades", "roadmap"]) {
    const schema = await readFile(
      path.join(REPO_ROOT, "docs/site/data", `${name}.schema.json`),
      "utf8",
    );
    await write(`docs/site/data/${name}.schema.json`, schema);
  }
  return root;
}

async function withFixture<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await makeFixture();
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function sha256File(absPath: string): Promise<string> {
  return createHash("sha256").update(await readFile(absPath, "utf8")).digest("hex");
}

const liveGuardPaths = ["docs/index.html", ".github/workflows/pages.yml", "docs/CNAME"];
let liveHashesBefore: string[] = [];
let liveListingBefore: string[] = [];

beforeAll(async () => {
  liveHashesBefore = await Promise.all(
    liveGuardPaths.map((rel) => sha256File(path.join(REPO_ROOT, rel))),
  );
  liveListingBefore = (await readdir(path.join(REPO_ROOT, "docs/openclinxr"))).sort();
});

afterAll(async () => {
  const liveHashesAfter = await Promise.all(
    liveGuardPaths.map((rel) => sha256File(path.join(REPO_ROOT, rel))),
  );
  expect(liveHashesAfter).toEqual(liveHashesBefore);
  const liveListingAfter = (await readdir(path.join(REPO_ROOT, "docs/openclinxr"))).sort();
  expect(liveListingAfter).toEqual(liveListingBefore);
});

describe("GitHub Pages static site", () => {
  it("exposes a package validator and includes it in the unattended agent gate", async () => {
    const rootPackage = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["pages:validate"]).toBe(
      "tsx tools/openclinxr/evidence/check-github-pages-site.ts",
    );
    expect(rootPackage.scripts["pages:sync-evidence-links"]).toBe(
      "tsx tools/openclinxr/evidence/sync-github-pages-evidence-links.ts",
    );
    expect(rootPackage.scripts["pages:sync-validate"]).toBe(
      "tsx tools/openclinxr/evidence/sync-github-pages-evidence-links.ts --check && pnpm pages:validate",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm pages:validate");
  });

  it("keeps the static branch-source Pages site wired", async () => {
    await expect(validateGitHubPagesSite({ root: REPO_ROOT })).resolves.toEqual({
      passed: true,
      blockers: [],
    });
  });

  it("positive: the unmodified fixture validates clean", async () => {
    await withFixture(async (root) => {
      await expect(validateGitHubPagesSite({ root })).resolves.toEqual({
        passed: true,
        blockers: [],
      });
    });
  });

  it("negative: fixture workflow without the docs upload path fails validation", async () => {
    await withFixture(async (root) => {
      const workflowPath = path.join(root, ".github/workflows/pages.yml");
      const original = await readFile(workflowPath, "utf8");
      const mutated = original.replace("path: docs", "path: public");
      expect(mutated).not.toBe(original);
      await writeFile(workflowPath, mutated, "utf8");
      const result = await validateGitHubPagesSite({ root });
      expect(result.passed).toBe(false);
      expect(result.blockers).toContain("pages_workflow_upload_path_missing");
    });
  });

  it("negative: fixture without a workflow still validates clean", async () => {
    await withFixture(async (root) => {
      const workflowPath = path.join(root, ".github/workflows/pages.yml");
      const original = await readFile(workflowPath, "utf8");
      await rm(workflowPath);
      const mutated = await readFile(workflowPath, "utf8").catch(() => null);
      expect(mutated).not.toBe(original);
      const result = await validateGitHubPagesSite({ root });
      expect(result.passed).toBe(true);
      expect(result.blockers).not.toContain("pages_workflow_upload_path_missing");
    });
  });

  it("negative: fixture index with a broken GitHub doc link fails validation", async () => {
    await withFixture(async (root) => {
      const indexPath = path.join(root, "docs/index.html");
      const original = await readFile(indexPath, "utf8");
      const mutated = original.replace(TRACKED_HREF, MISSING_DOC_HREF);
      expect(mutated).not.toBe(original);
      await writeFile(indexPath, mutated, "utf8");
      const result = await validateGitHubPagesSite({ root });
      expect(result.passed).toBe(false);
      expect(result.blockers).toContain(
        "pages_index_github_link_missing:openclinxr/fixture-missing-2026-05-28.json",
      );
    });
  });

  it("negative: fixture engineering page with a stale snapshot href fails validation", async () => {
    await withFixture(async (root) => {
      const engineeringPath = path.join(root, "docs/engineering.html");
      const original = await readFile(engineeringPath, "utf8");
      const mutated = original.replace(
        snapshotHref(STALE_SNAPSHOT_KEY),
        STALE_SNAPSHOT_HREF,
      );
      expect(mutated).not.toBe(original);
      await writeFile(engineeringPath, mutated, "utf8");
      await writeFile(
        path.join(root, "docs/openclinxr", STALE_SNAPSHOT_FILE),
        "{}\n",
        "utf8",
      );
      const result = await validateGitHubPagesSite({ root });
      expect(result.passed).toBe(false);
      expect(result.blockers).toContain(
        `pages_index_snapshot_not_latest:${STALE_SNAPSHOT_KEY}:found:${STALE_SNAPSHOT_FILE}:expected:${STALE_SNAPSHOT_KEY}-2026-05-28.json`,
      );
    });
  });

  it("negative: fixture without CNAME fails validation", async () => {
    await withFixture(async (root) => {
      const cnamePath = path.join(root, "docs/CNAME");
      const original = await readFile(cnamePath, "utf8");
      expect(original.trim()).toBe("developers.simnova.com");
      await rm(cnamePath);
      const mutated = await readFile(cnamePath, "utf8").catch(() => null);
      expect(mutated).not.toBe(original);
      const result = await validateGitHubPagesSite({ root });
      expect(result.passed).toBe(false);
      expect(result.blockers).toContain("missing_required_pages_file:docs/CNAME");
    });
  });
});
