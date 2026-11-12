import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { type ClaimsFile, checkClaimsHtml } from "./check-claims.js";
import { checkLayout } from "./layout.js";
import { validateSiteData } from "./site-data-schemas.js";

const pageRel = "docs/evidence.html";
const PLAN_ROW1_EVIDENCE_NOW =
  "partial: rubric recorded and replayable (instrument exists; no reliability data)";
const KNOWN_LIMIT =
  "claim states are re-derived only at each landing; between landings the site reads as of the sha in the footer";
const NAV_LINK = '<a href="evidence.html">Evidence</a>';

function readPage(): string {
  return readFileSync(path.join(process.cwd(), pageRel), "utf8");
}

function readClaims(): ClaimsFile {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "docs", "site", "data", "claims.json"), "utf8"),
  ) as ClaimsFile;
}

function readRoadmap(): unknown {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "docs", "site", "data", "roadmap.json"), "utf8"),
  );
}

function sectionIdsInOrder(html: string): string[] {
  const found: string[] = [];
  const pattern = /<section\b[^>]*\bid="([^"]+)"[^>]*>/gi;
  let match: RegExpExecArray | null = pattern.exec(html);
  while (match !== null) {
    found.push(match[1] ?? "");
    match = pattern.exec(html);
  }
  return found;
}

function textContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function marksRowEvidenceNow(html: string): string {
  const table = validityTable(html);
  const index = evidenceNowColumnIndex(table);
  const row = marksRowCells(table);
  if (index >= row.length) {
    throw new Error(`evidence-now index ${index} out of range for Marks row of ${row.length} cells`);
  }
  return row[index] ?? "";
}

function validityTable(html: string): string {
  const match = /<table\b[^>]*class="measure-table"[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!match) {
    throw new Error("validity table not found");
  }
  return match[1] ?? "";
}

function evidenceNowColumnIndex(tableInner: string): number {
  const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(tableInner)?.[1] ?? "";
  const headers = [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((cell) =>
    textContent(cell[1] ?? "").toLowerCase(),
  );
  const index = headers.indexOf("evidence now");
  if (index < 0) {
    throw new Error(`no evidence-now header, got ${JSON.stringify(headers)}`);
  }
  return index;
}

function marksRowCells(tableInner: string): string[] {
  const rowPattern = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
  for (const row of tableInner.match(rowPattern) ?? []) {
    if (!/<th\b[^>]*>\s*Marks\s*<\/th>/i.test(row)) {
      continue;
    }
    return [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((cell) =>
      textContent(cell[1] ?? ""),
    );
  }
  throw new Error("Marks row not found in the validity table");
}

function tableAlignmentBlockers(html: string, page: string): string[] {
  const blockers: string[] = [];
  const tableInner = validityTable(html);
  const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(tableInner)?.[1] ?? "";
  const headerCount = [...thead.matchAll(/<th\b[^>]*>/gi)].length;
  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableInner)?.[1] ?? "";
  for (const row of tbody.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const rowHeader =
      textContent(/<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(row)?.[1] ?? "") || "<unknown>";
    const cellCount = [...row.matchAll(/<(?:th|td)\b[^>]*>/gi)].length;
    if (cellCount !== headerCount) {
      blockers.push(`evidence_table_column_mismatch:${page}:${rowHeader}`);
    }
  }
  return blockers;
}

function tableWrapBlockers(html: string, page: string): string[] {
  const pattern =
    /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*class="([^"]*)"[^>]*>\s*<table\b[^>]*class="measure-table"/i;
  const match = pattern.exec(html);
  if (!match || !(match[2] ?? "").split(/\s+/).includes("measure-table-wrap")) {
    return [`evidence_table_wrap_missing:${page}`];
  }
  return [];
}

function readFixture(name: string): string {
  return readFileSync(
    path.join(
      process.cwd(),
      "tools",
      "openclinxr",
      "evidence",
      "site",
      "fixtures",
      "evidence-page",
      name,
    ),
    "utf8",
  );
}

type RoadmapRow = {
  id?: unknown;
  source?: unknown;
};

function roadmapRows(roadmap: unknown): Record<string, unknown>[] {
  const items = (roadmap as { items?: unknown })?.items;
  if (!Array.isArray(items)) {
    throw new Error("roadmap items missing");
  }
  return items as Record<string, unknown>[];
}

function isHexSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{9,40}$/.test(value);
}

function isAncestor(older: string, newer: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", older, newer], { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function asOfBlockers(roadmap: unknown): string[] {
  const blockers: string[] = [];
  for (const row of roadmapRows(roadmap)) {
    const id = typeof row["id"] === "string" ? (row["id"] as string) : "<unknown>";
    if (!isHexSha(row["asOf"])) {
      blockers.push(`roadmap_asof_format:${id}`);
    } else if (!isAncestor(row["asOf"] as string, "HEAD")) {
      blockers.push(`roadmap_asof_not_ancestor:${id}`);
    }
  }
  return blockers;
}

function sourceShaBlockers(roadmap: unknown): string[] {
  const blockers: string[] = [];
  for (const row of roadmapRows(roadmap)) {
    const id = typeof row["id"] === "string" ? (row["id"] as string) : "<unknown>";
    for (const field of ["source", "statusNote"]) {
      const text = row[field];
      if (typeof text !== "string") {
        continue;
      }
      for (const match of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
        if (!isAncestor(match[0], "HEAD")) {
          blockers.push(`roadmap_sha_not_ancestor:${id}:${match[0]}`);
        }
      }
    }
  }
  return blockers;
}

function rr1Blockers(roadmap: unknown): string[] {
  const blockers: string[] = [];
  for (const row of roadmapRows(roadmap)) {
    const id = typeof row["id"] === "string" ? (row["id"] as string) : "<unknown>";
    const namesRR1 = ["item", "exitCriteria", "source"].some(
      (field) => typeof row[field] === "string" && (row[field] as string).includes("RR1"),
    );
    if (!namesRR1) {
      continue;
    }
    const asOf = row["asOf"];
    if (!isHexSha(asOf) || !isAncestor("a0bd592f4", asOf as string)) {
      blockers.push(`roadmap_rr1_asof:${id}`);
    }
    for (const field of ["source", "statusNote"]) {
      const text = row[field];
      if (typeof text === "string" && text.toLowerCase().includes("grade pending")) {
        blockers.push(`roadmap_rr1_grade_pending:${id}:${field}`);
      }
    }
  }
  return blockers;
}
function roadmapSourceBlockers(roadmap: unknown): string[] {
  const blockers: string[] = [];
  const items = (roadmap as { items?: unknown })?.items;
  if (!Array.isArray(items)) {
    return ["roadmap_items_missing"];
  }
  for (const item of items) {
    const row = item as RoadmapRow;
    const id = typeof row.id === "string" && row.id !== "" ? row.id : "<unknown>";
    if (typeof row.source !== "string" || row.source.trim() === "") {
      blockers.push(`roadmap_row_missing_source:${id}`);
    }
  }
  return blockers;
}

function isV2Page(html: string): boolean {
  return /<body\b[^>]*\bdata-site\s*=\s*("v2"|'v2'|v2)[\s>]/i.test(html);
}

function v2PageFiles(): string[] {
  const docsDir = path.join(process.cwd(), "docs");
  return readdirSync(docsDir)
    .filter((entry) => entry.endsWith(".html"))
    .filter((entry) => {
      const html = readFileSync(path.join(docsDir, entry), "utf8");
      return isV2Page(html);
    })
    .sort();
}

function navBlockersFor(html: string, page: string): string[] {
  if (!html.includes(NAV_LINK)) {
    return [`evidence_nav_missing:${page}`];
  }
  return [];
}

function deploymentParagraphBlockers(
  html: string,
  known: Set<string>,
  page: string,
): string[] {
  const blockers: string[] = [];
  const sectionPattern = /<section\b[^>]*\bid="deployment"[^>]*>([\s\S]*?)<\/section>/i;
  const section = sectionPattern.exec(html)?.[1] ?? "";
  if (section === "") {
    return [`${page}:deployment_section_missing`];
  }
  const paragraphPattern = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
  for (const paragraph of section.match(paragraphPattern) ?? []) {
    const openTag = (/<p\b[^>]*>/i.exec(paragraph) ?? [])[0] ?? "";
    const dataClaim = (/\sdata-claim\s*=\s*("[^"]*"|'[^']*')/.exec(openTag) ?? [])[1]
      ?.slice(1, -1)
      .trim();
    if (dataClaim === undefined || dataClaim === "") {
      blockers.push(`${page}:deployment_paragraph_without_claim`);
      continue;
    }
    for (const claimId of dataClaim.split(/\s+/).filter((id) => id.length > 0)) {
      if (!known.has(claimId)) {
        blockers.push(`${page}:deployment_unknown_claim:${claimId}`);
      }
    }
  }
  return blockers;
}

it("known-good: panels measurement, roadmap and deployment exist in that order", () => {
  const ids = sectionIdsInOrder(readPage()).filter((id) =>
    ["measurement", "roadmap", "deployment"].includes(id),
  );
  expect(ids).toEqual(["measurement", "roadmap", "deployment"]);
});

it("known-good: the P4.2 Marks row evidence-now cell equals the PLAN text", () => {
  expect(marksRowEvidenceNow(readPage())).toEqual(PLAN_ROW1_EVIDENCE_NOW);
});

it("known-good (a): the validity thead column count equals every tbody row cell count", () => {
  expect(tableAlignmentBlockers(readPage(), pageRel)).toEqual([]);
});

it("known-good (b): the Marks cell under the evidence-now header equals the PLAN text", () => {
  const table = validityTable(readPage());
  expect(marksRowCells(table)[evidenceNowColumnIndex(table)]).toEqual(PLAN_ROW1_EVIDENCE_NOW);
});

it("known-good (c): the validity table is wrapped in measure-table-wrap", () => {
  expect(tableWrapBlockers(readPage(), pageRel)).toEqual([]);
});

it("negative: a fixture copy without the inference th fails the column-count and header-index checks", () => {
  const fixture = readFixture("evidence-no-inference-th.html");
  const alignment = tableAlignmentBlockers(fixture, "evidence-no-inference-th.html");
  if (
    !alignment.some((blocker) => blocker === "evidence_table_column_mismatch:evidence-no-inference-th.html:Marks")
  ) {
    throw new Error(`expected column mismatch for Marks, got ${JSON.stringify(alignment)}`);
  }
  const table = validityTable(fixture);
  const atHeaderIndex = marksRowCells(table)[evidenceNowColumnIndex(table)];
  if (atHeaderIndex === PLAN_ROW1_EVIDENCE_NOW) {
    throw new Error("expected the header-index cell to miss the PLAN text on the misaligned fixture");
  }
});

it("negative: a roadmap.json fixture row without source is refused by the same check", () => {
  expect(roadmapSourceBlockers(readRoadmap())).toEqual([]);
  const fixture = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        "tools",
        "openclinxr",
        "evidence",
        "site",
        "fixtures",
        "evidence-page",
        "roadmap-no-source.json",
      ),
      "utf8",
    ),
  ) as unknown;
  const blockers = roadmapSourceBlockers(fixture);
  if (!blockers.some((blocker) => blocker === "roadmap_row_missing_source:RMX")) {
    throw new Error(`expected roadmap_row_missing_source:RMX, got ${JSON.stringify(blockers)}`);
  }
});

it("F2 (a): every roadmap row pins a hex asOf sha that is an ancestor of HEAD", () => {
  expect(asOfBlockers(readRoadmap())).toEqual([]);
});

it("F2 (b): every sha named in a row source or statusNote is an ancestor of HEAD", () => {
  expect(sourceShaBlockers(readRoadmap())).toEqual([]);
});

it("F2 (c): every row naming RR1 pins a post-ship asOf and carries no grade-pending text", () => {
  expect(rr1Blockers(readRoadmap())).toEqual([]);
});

it("F2 negative: an RM1 stuck at grade pending is refused by the RR1 check", () => {
  const fixture = JSON.parse(readFixture("roadmap-rm1-grade-pending.json")) as unknown;
  const blockers = rr1Blockers(fixture);
  if (!blockers.some((blocker) => blocker === "roadmap_rr1_grade_pending:RM1:source")) {
    throw new Error(`expected roadmap_rr1_grade_pending:RM1:source, got ${JSON.stringify(blockers)}`);
  }
});
it("counterweight: the P4.6 known-limit sentence is present verbatim", () => {
  if (!readPage().includes(KNOWN_LIMIT)) {
    throw new Error("known-limit sentence not found verbatim in docs/evidence.html");
  }
});

it("known-good: every v2 page nav carries the Evidence link", () => {
  const files = v2PageFiles();
  if (!files.includes("evidence.html")) {
    throw new Error(`expected evidence.html among v2 pages, got ${JSON.stringify(files)}`);
  }
  const blockers: string[] = [];
  for (const file of files) {
    const html = readFileSync(path.join(process.cwd(), "docs", file), "utf8");
    blockers.push(...navBlockersFor(html, file));
  }
  expect(blockers).toEqual([]);
});

it("negative: a v2 page copy with the Evidence link removed is refused", () => {
  const stripped = readPage().replace(NAV_LINK, "");
  if (stripped === readPage()) {
    throw new Error("fixture rewrite did not remove the Evidence nav link");
  }
  expect(navBlockersFor(stripped, pageRel)).toEqual([`evidence_nav_missing:${pageRel}`]);
});

it("known-good: every deployment paragraph carries a claims.json data-claim", () => {
  const known = new Set((readClaims().claims ?? []).map((claim) => claim.id));
  expect(deploymentParagraphBlockers(readPage(), known, pageRel)).toEqual([]);
});

it("negative: a deployment paragraph with data-claim removed is refused", () => {
  const known = new Set((readClaims().claims ?? []).map((claim) => claim.id));
  const html = readPage();
  const stripped = html.replace(
    /(<section\b[^>]*\bid="deployment"[^>]*>[\s\S]*?<p\b[^>]*?)\sdata-claim="[^"]*"/,
    "$1",
  );
  if (stripped === html) {
    throw new Error("fixture rewrite did not remove a deployment data-claim");
  }
  const blockers = deploymentParagraphBlockers(stripped, known, pageRel);
  if (!blockers.some((blocker) => blocker.includes("deployment_paragraph_without_claim"))) {
    throw new Error(`expected deployment_paragraph_without_claim, got ${JSON.stringify(blockers)}`);
  }
});

it("known-good: layout and claims checks pass on the real tree", async () => {
  expect(await checkLayout(process.cwd())).toEqual([]);
  expect(await validateSiteData(process.cwd())).toEqual([]);
  expect(checkClaimsHtml(readPage(), readClaims(), pageRel)).toEqual([]);
});
