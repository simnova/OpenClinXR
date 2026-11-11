import { execSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { validateGitHubPagesSite } from "../check-github-pages-site.js";
import { checkLayout } from "./layout.js";

const snapshotKeys = [
  "asset-production-evidence-ladder",
  "asset-production-artifact-evidence",
  "asset-production-readiness-benchmark",
  "github-pages-site",
] as const;

const fixturePath = path.join(
  process.cwd(),
  "tools",
  "openclinxr",
  "evidence",
  "site",
  "fixtures",
  "engineering",
  "engineering-no-factory-stations.html",
);

function readRealEngineeringHtml(): string {
  return readFileSync(path.join(process.cwd(), "docs", "engineering.html"), "utf8");
}

it("negative: an engineering.html without id=factory-stations gives pages_index_factory_stations_section_missing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "w2-engineering-"));
  const previousCwd = process.cwd();
  try {
    mkdirSync(path.join(root, "docs", "openclinxr"), { recursive: true });
    writeFileSync(
      path.join(root, "docs", "index.html"),
      '<!doctype html><html lang="en"><head><title>t</title></head><body></body></html>',
    );
    writeFileSync(path.join(root, "docs", "styles.css"), "body { margin: 0; }\n");
    writeFileSync(path.join(root, "README.md"), "placeholder\n");
    writeFileSync(path.join(root, "docs", ".nojekyll"), "");
    writeFileSync(path.join(root, "docs", "CNAME"), "placeholder\n");
    copyFileSync(fixturePath, path.join(root, "docs", "engineering.html"));
    process.chdir(root);
    const result = await validateGitHubPagesSite();
    expect(result.blockers).toContain("pages_index_factory_stations_section_missing");
  } finally {
    process.chdir(previousCwd);
  }
});

it("known-good: factory-stations, the four snapshot links and the Evidence Docs link are read from docs/engineering.html with no index blockers", async () => {
  const engineeringHtml = readRealEngineeringHtml();
  expect(engineeringHtml).toContain('id="factory-stations"');
  for (const key of snapshotKeys) {
    expect(engineeringHtml).toContain(`data-pages-snapshot="${key}"`);
  }
  expect(engineeringHtml).toContain("Evidence Docs");
  const result = await validateGitHubPagesSite();
  expect(result.blockers.filter((blocker) => blocker.startsWith("pages_index_"))).toEqual(
    [],
  );
});

it("counterweight: the band range in docs/engineering.html is byte-identical to git show e15fd7a33:docs/index.html lines 397-1426 except one h2 line", () => {
  const refLines = execSync("git show e15fd7a33:docs/index.html", {
    encoding: "utf8",
  }).split("\n");
  const refBand = refLines.slice(396, 1426);
  expect(refBand.length).toEqual(1030);
  expect(refBand[0]?.trimStart().startsWith('<section id="factory-stations"')).toEqual(true);
  expect(refBand[refBand.length - 1]).toEqual("      </section>");

  const engLines = readRealEngineeringHtml().split("\n");
  const start = engLines.findIndex((line) =>
    line.trimStart().startsWith('<section id="factory-stations"'),
  );
  expect(start).toBeGreaterThan(-1);
  const mainClose = engLines.indexOf("    </main>");
  expect(mainClose).toBeGreaterThan(start);
  const closers: number[] = [];
  for (let i = start; i < mainClose; i++) {
    if (engLines[i] === "      </section>") {
      closers.push(i);
    }
  }
  const end = closers[closers.length - 1];
  const gotBand = engLines.slice(start, (end ?? start - 1) + 1);
  expect(gotBand.length).toEqual(refBand.length);

  const diffs = refBand
    .map((before, index) => ({ before, after: gotBand[index] as string, index }))
    .filter((pair) => pair.before !== pair.after);
  expect(diffs.length).toEqual(1);
  expect(diffs[0]).toEqual({
    index: refBand.findIndex((line) => line.includes('id="evidence-docs-title"')),
    before:
      '          <h2 id="evidence-docs-title">Deeper artifacts stay in the repository.</h2>',
    after: '          <h2 id="evidence-docs-title">Evidence snapshots <span style="white-space: nowrap">(2026-05-28)</span></h2>',
  });
});

it("known-good: layout check gives no blockers naming engineering.html", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "w2-engineering-layout-"));
  mkdirSync(path.join(root, "docs", "site", "partials"), { recursive: true });
  cpSync(
    path.join(process.cwd(), "docs", "site", "partials", "nav.html"),
    path.join(root, "docs", "site", "partials", "nav.html"),
  );
  cpSync(
    path.join(process.cwd(), "docs", "site", "partials", "footer.html"),
    path.join(root, "docs", "site", "partials", "footer.html"),
  );
  copyFileSync(
    path.join(process.cwd(), "docs", "engineering.html"),
    path.join(root, "docs", "engineering.html"),
  );
  // Stub every relative target the page references so the link half of the
  // contract is checked against the page's own link set; sibling pages owned
  // by later cards (W4a blueprints, W5 reference-run, W6a evidence) are
  // non-v2 stubs here, and the real-tree residual is recorded in RESULT NOTES.
  const html = readRealEngineeringHtml();
  const refPattern = /(?:href|src)\s*=\s*"([^"]*)"|(?:href|src)\s*=\s*'([^']*)'/gi;
  let match: RegExpExecArray | null = refPattern.exec(html);
  while (match !== null) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    const skipped =
      raw === "" ||
      raw.startsWith("#") ||
      raw.startsWith("//") ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw);
    if (!skipped) {
      const cleaned = raw.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "";
      const relative = cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
      const target = path.join(root, "docs", relative);
      mkdirSync(path.dirname(target), { recursive: true });
      try {
        writeFileSync(target, "", { flag: "wx" });
      } catch {
        // Target already stubbed by an earlier identical ref.
      }
    }
    match = refPattern.exec(html);
  }
  const blockers = await checkLayout(root);
  expect(blockers.filter((blocker) => blocker.includes("engineering.html"))).toEqual([]);
});

async function factoryStationBlockers(engineeringHtml: string, indexHtml: string): Promise<string[]> {
  const root = mkdtempSync(path.join(tmpdir(), "w2-direction-"));
  const previousCwd = process.cwd();
  try {
    mkdirSync(path.join(root, "docs", "openclinxr"), { recursive: true });
    writeFileSync(path.join(root, "docs", "index.html"), indexHtml);
    writeFileSync(path.join(root, "docs", "engineering.html"), engineeringHtml);
    writeFileSync(path.join(root, "docs", "styles.css"), "body { margin: 0; }\n");
    writeFileSync(path.join(root, "README.md"), "placeholder\n");
    writeFileSync(path.join(root, "docs", ".nojekyll"), "");
    writeFileSync(path.join(root, "docs", "CNAME"), "placeholder\n");
    process.chdir(root);
    const result = await validateGitHubPagesSite();
    return result.blockers.filter((blocker) => blocker === "pages_index_factory_stations_section_missing");
  } finally {
    process.chdir(previousCwd);
  }
}

const bareIndex = '<!doctype html><html lang="en"><head><title>t</title></head><body></body></html>';
const indexWithFactoryStations = '<!doctype html><html lang="en"><head><title>t</title></head><body><section id="factory-stations"></section></body></html>';

it("direction: engineering.html without factory-stations and index.html with it gives the factory-stations blocker", async () => {
  expect(await factoryStationBlockers(readFileSync(fixturePath, "utf8"), indexWithFactoryStations)).toEqual([
    "pages_index_factory_stations_section_missing",
  ]);
});

it("direction: engineering.html with factory-stations and index.html without it gives no factory-stations blocker", async () => {
  expect(await factoryStationBlockers(readRealEngineeringHtml(), bareIndex)).toEqual([]);
});
