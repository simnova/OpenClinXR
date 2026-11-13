import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { releaseLinkBlockerFor } from "../check-github-pages-site.js";
import { checkLayout, isV2Page } from "./layout.js";

const ROOT = process.cwd();
const RELEASE_DIR = path.join(ROOT, "tools", "openclinxr", "evidence", "site", "release");
const FIXTURES_DIR = path.join(ROOT, "tools", "openclinxr", "evidence", "site", "fixtures", "release");

const BUNDLE_FILES = [
  // run-15 source: docs/site/data/rr1-trace/CBB5_UB-J.conversation-trace.json (committed copy of store site-reimagine/rr1/run-15/trace/CBB5_UB-J.conversation-trace.json)
  "docs/site/data/rr1-trace/CBB5_UB-J.conversation-trace.json",
  // run-15 source: docs/site/data/rr1-trace/O4z72Ca-8.conversation-trace.json (committed copy of store site-reimagine/rr1/run-15/trace/O4z72Ca-8.conversation-trace.json)
  "docs/site/data/rr1-trace/O4z72Ca-8.conversation-trace.json",
  // run-15 source: docs/site/data/rr1-trace/5JNYwgcSl.conversation-trace.json (committed copy of store site-reimagine/rr1/run-15/trace/5JNYwgcSl.conversation-trace.json)
  "docs/site/data/rr1-trace/5JNYwgcSl.conversation-trace.json",
  "docs/site/data/rr1-trace/exam-session.review-index.json",
  "docs/site/data/mn1.json",
  "docs/site/data/trace-schema.json",
  "tools/openclinxr/evidence/site/release/README.md",
];

type SumsEntry = {
  hash: string;
  file: string;
};

function sha256OfFile(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

function parseSums(text: string): SumsEntry[] {
  const entries: SumsEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error(`bad SHA256SUMS line: ${line}`);
    }
    entries.push({ hash: match[1], file: match[2] });
  }
  return entries;
}

function checkSums(entries: SumsEntry[]): string[] {
  const problems: string[] = [];
  const named = new Set(entries.map((entry) => entry.file));
  for (const wanted of BUNDLE_FILES) {
    if (!named.has(wanted)) {
      problems.push(`sha_missing:${wanted}`);
    }
  }
  for (const entry of entries) {
    if (!BUNDLE_FILES.includes(entry.file)) {
      problems.push(`sha_unexpected:${entry.file}`);
      continue;
    }
    const actual = sha256OfFile(path.join(ROOT, entry.file));
    if (actual !== entry.hash) {
      problems.push(`sha_mismatch:${entry.file}`);
    }
  }
  return problems;
}

function readMediaSlotTags(): (string | null)[] {
  const media = JSON.parse(
    readFileSync(path.join(ROOT, "docs", "site", "data", "media.json"), "utf8"),
  ) as { slots?: { releaseTag?: string | null }[] };
  return (media.slots ?? []).map((slot) => slot?.releaseTag ?? null);
}

function readRealPages(): { name: string; html: string }[] {
  const pages: { name: string; html: string }[] = [];
  for (const name of readdirSync(path.join(ROOT, "docs")).sort()) {
    if (!name.endsWith(".html")) {
      continue;
    }
    pages.push({ name: `docs/${name}`, html: readFileSync(path.join(ROOT, "docs", name), "utf8") });
  }
  pages.push({
    name: "docs/site/partials/footer.html",
    html: readFileSync(path.join(ROOT, "docs", "site", "partials", "footer.html"), "utf8"),
  });
  return pages;
}

function gradesEntryBlocker(
  fileBytes: Buffer,
  entry: { sha256?: string } | undefined,
): string | undefined {
  const actual = createHash("sha256").update(fileBytes).digest("hex");
  if (entry?.sha256 === actual) {
    return undefined;
  }
  return "grades_sha_mismatch";
}

function footerNonClaimsText(): string {
  const footer = readFileSync(
    path.join(ROOT, "docs", "site", "partials", "footer.html"),
    "utf8",
  );
  const match = /<p class="non-claims">([\s\S]*?)<\/p>/.exec(footer);
  if (match?.[1] === undefined) {
    throw new Error("footer.html carries no p.non-claims paragraph");
  }
  return match[1];
}

it("known-good: every SHA256SUMS line equals the hash of the committed file it names", () => {
  const entries = parseSums(readFileSync(path.join(RELEASE_DIR, "SHA256SUMS"), "utf8"));
  expect(entries.map((entry) => entry.file).sort()).toEqual([...BUNDLE_FILES].sort());
  expect(checkSums(entries)).toEqual([]);
});

it("known-good: the 4 SUMS trace paths equal the mn1.json sources[].path set", () => {
  const entries = parseSums(readFileSync(path.join(RELEASE_DIR, "SHA256SUMS"), "utf8"));
  const tracePaths = entries
    .map((entry) => entry.file)
    .filter((file) => file.startsWith("docs/site/data/rr1-trace/"))
    .sort();
  const mn1 = JSON.parse(
    readFileSync(path.join(ROOT, "docs", "site", "data", "mn1.json"), "utf8"),
  ) as { sources?: { path?: string }[] };
  const sourcePaths = (mn1.sources ?? []).map((source) => source?.path ?? "").sort();
  expect(tracePaths).toEqual(sourcePaths);
  expect(tracePaths.length).toBe(4);
});

it("negative: a fixture SHA256SUMS with one hash flipped fails", () => {
  // run-15 source: SHA256SUMS.flipped.fixture is rebuilt from release/SHA256SUMS (run-15 bytes) with line-1 first nibble flipped; parseSums rejects comment lines so the source is named here
  const entries = parseSums(
    readFileSync(path.join(FIXTURES_DIR, "SHA256SUMS.flipped.fixture"), "utf8"),
  );
  expect(entries.map((entry) => entry.file).sort()).toEqual([...BUNDLE_FILES].sort());
  const problems = checkSums(entries);
  expect(problems.length).toBeGreaterThan(0);
  expect(problems.some((problem) => problem.startsWith("sha_mismatch:"))).toBe(true);
});

it("negative: a fixture SHA256SUMS missing one line fails", () => {
  // run-15 source: SHA256SUMS.missing-line.fixture is rebuilt from release/SHA256SUMS (run-15 bytes) with the mn1.json line omitted; parseSums rejects comment lines so the source is named here
  const entries = parseSums(
    readFileSync(path.join(FIXTURES_DIR, "SHA256SUMS.missing-line.fixture"), "utf8"),
  );
  const problems = checkSums(entries);
  expect(problems.length).toBeGreaterThan(0);
  expect(problems.some((problem) => problem.startsWith("sha_missing:"))).toBe(true);
});

const REAL_GRADES = (
  JSON.parse(readFileSync(path.join(ROOT, "docs", "site", "data", "grades.json"), "utf8")) as {
    entries?: { path?: string; sha256?: string }[];
  }
).entries ?? [];
const REAL_GRADED_FILES = REAL_GRADES.filter(
  (entry) => typeof entry.path === "string" && existsSync(path.join(ROOT, "docs", entry.path)),
);

it(`grades: every real-tree grades.json entry whose file exists matches its sha256 (${REAL_GRADED_FILES.length} items)`, () => {
  console.log(`grades real-tree items: ${REAL_GRADED_FILES.length}`);
  for (const entry of REAL_GRADED_FILES) {
    const bytes = readFileSync(path.join(ROOT, "docs", entry.path as string));
    expect(gradesEntryBlocker(bytes, entry), entry.path).toBeUndefined();
  }
});

it("grades: a fixture visual file with one matching entry passes, a mismatched entry fails", () => {
  const bytes = readFileSync(path.join(FIXTURES_DIR, "frame.still.bin"));
  const actual = sha256OfFile(path.join(FIXTURES_DIR, "frame.still.bin"));
  expect(gradesEntryBlocker(bytes, { sha256: actual })).toBeUndefined();
  const flipped = actual.startsWith("0") ? `1${actual.slice(1)}` : `0${actual.slice(1)}`;
  expect(flipped).not.toBe(actual);
  expect(gradesEntryBlocker(bytes, { sha256: flipped })).toBe("grades_sha_mismatch");
  expect(gradesEntryBlocker(bytes, undefined)).toBe("grades_sha_mismatch");
});

it("readme carries the non-claims text verbatim, the voice label, and the unpublished status", () => {
  const readme = readFileSync(path.join(RELEASE_DIR, "README.md"), "utf8");
  expect(readme).toContain(footerNonClaimsText());
  expect(readme).toContain("Learner voice: synthetic (injected)");
  expect(readme).toContain("release not yet published");
});

it("wv1c: the real tree carries one Release link per v2 page plus the partial, all valid", () => {
  const entries = readRealPages();
  const footer = entries.find((entry) => entry.name === "docs/site/partials/footer.html");
  if (footer === undefined) {
    throw new Error("footer partial missing from the real-page read");
  }
  const v2Pages = entries.filter(
    (entry) => entry.name !== footer.name && isV2Page(entry.html),
  );
  const anchors = [footer.html, ...v2Pages.map((page) => page.html)].flatMap(
    (text) => text.match(/<a\b[^>]*\bdata-release\s*=/gi) ?? [],
  );
  expect(anchors.length).toBe(1 + v2Pages.length);
  expect(releaseLinkBlockerFor([footer, ...v2Pages], readMediaSlotTags())).toBeUndefined();
});

// The card that publishes the Release flips this assertion: once the tag
// resolves to a live Release, the footer anchor text drops "(not yet published)".
it("release anchor text admits the Release is not yet published", () => {
  const footer = readFileSync(
    path.join(ROOT, "docs", "site", "partials", "footer.html"),
    "utf8",
  );
  const match = /<a\b[^>]*\bdata-release\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(footer);
  if (match?.[2] === undefined) {
    throw new Error("footer.html carries no data-release anchor");
  }
  expect(match[2]).toContain("not yet published");
});

it("wv1c: a fixture page with a good tag passes", () => {
  const tags = readMediaSlotTags();
  const want = [...new Set(tags.filter((tag) => typeof tag === "string"))].sort()[0];
  if (want === undefined) {
    throw new Error("media.json carries no releaseTag for the good-tag fixture");
  }
  const html =
    `<footer><a href="https://github.com/simnova/OpenClinXR/releases/tag/${want}" ` +
    `data-release="${want}">Release</a></footer>`;
  expect(releaseLinkBlockerFor([{ name: "fixture", html }], tags)).toBeUndefined();
});

it("wv1c: a fixture page with a bad tag format fails", () => {
  const html =
    '<footer><a href="https://github.com/simnova/OpenClinXR/releases" ' +
    'data-release="run7">Release</a></footer>';
  expect(releaseLinkBlockerFor([{ name: "fixture", html }], readMediaSlotTags())).toBe(
    "pages_release_link_tag_format_invalid:run7",
  );
});

it("wv1c: a fixture tag unequal to media.json fails", () => {
  const tags = readMediaSlotTags();
  const want = [...new Set(tags.filter((tag) => typeof tag === "string"))].sort()[0];
  if (want === undefined) {
    throw new Error("media.json carries no releaseTag for the mismatch fixture");
  }
  const other = want.startsWith("rr1-") ? want.replace(/^rr1-/, "rr1-min-") : `${want}-x`;
  expect(other).not.toBe(want);
  const html =
    '<footer><a href="https://github.com/simnova/OpenClinXR/releases" ' +
    `data-release="${other}">Release</a></footer>`;
  expect(releaseLinkBlockerFor([{ name: "fixture", html }], tags)).toBe(
    `pages_release_link_tag_mismatch:${other}:expected:${want}`,
  );
});

it("wv1c: a fixture page with no link passes", () => {
  const html = "<footer><p>No release link yet.</p></footer>";
  expect(releaseLinkBlockerFor([{ name: "fixture", html }], readMediaSlotTags())).toBeUndefined();
});

it("layout counterweight: a fixture v2 page whose footer copy lacks the Release anchor fails the footer check", async () => {
  const blockers = await checkLayout(path.join(FIXTURES_DIR, "layout-missing-release"));
  expect(blockers).toContain("layout_footer_missing:index.html");
});
