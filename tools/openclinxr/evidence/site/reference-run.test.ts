import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { type ClaimsFile, checkClaimsHtml } from "./check-claims.js";
import { checkLayout } from "./layout.js";

const pageRel = "docs/reference-run.html";

function readClaims(): ClaimsFile {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "docs", "site", "data", "claims.json"), "utf8"),
  ) as ClaimsFile;
}

function knownClaimIds(claims: ClaimsFile): Set<string> {
  return new Set((claims.claims ?? []).map((claim) => claim.id));
}

function readPage(): string {
  return readFileSync(path.join(process.cwd(), pageRel), "utf8");
}

function getAttribute(openTag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`);
  const match = pattern.exec(openTag);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].slice(1, -1);
}

function hasClass(openTag: string, token: string): boolean {
  const value = getAttribute(openTag, "class");
  if (value === undefined) {
    return false;
  }
  return value.split(/\s+/).includes(token);
}

function chapterSections(html: string): { id: string; openTag: string; inner: string }[] {
  const found: { id: string; openTag: string; inner: string }[] = [];
  const pattern = /<section\b[^>]*\bid="ch[1-5]"[^>]*>[\s\S]*?<\/section>/gi;
  for (const section of html.match(pattern) ?? []) {
    const openTag = (/<section\b[^>]*>/i.exec(section) ?? [])[0] ?? "";
    const id = getAttribute(openTag, "id") ?? "";
    const inner = section
      .replace(/^<section\b[^>]*>/i, "")
      .replace(/<\/section>\s*$/i, "");
    found.push({ id, openTag, inner });
  }
  return found;
}

function paragraphClaimBlockers(html: string, known: Set<string>, page: string): string[] {
  const blockers: string[] = [];
  for (const section of chapterSections(html)) {
    const paragraphPattern = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
    for (const paragraph of section.inner.match(paragraphPattern) ?? []) {
      const openTag = (/<p\b[^>]*>/i.exec(paragraph) ?? [])[0] ?? "";
      if (hasClass(openTag, "caption")) {
        continue;
      }
      const dataClaim = getAttribute(openTag, "data-claim");
      if (dataClaim === undefined || dataClaim.trim() === "") {
        blockers.push(`${page}:paragraph_without_claim:${section.id}`);
        continue;
      }
      for (const claimId of dataClaim.split(/\s+/).filter((id) => id.length > 0)) {
        if (!known.has(claimId)) {
          blockers.push(`${page}:unknown_claim:${section.id}:${claimId}`);
        }
      }
    }
  }
  return blockers;
}

it("known-good: sections ch1..ch5 exist in order, each with a data-claim naming claims.json ids", () => {
  const html = readPage();
  const known = knownClaimIds(readClaims());
  const sections = chapterSections(html);
  expect(sections.map((section) => section.id)).toEqual(["ch1", "ch2", "ch3", "ch4", "ch5"]);
  for (const section of sections) {
    const dataClaim = getAttribute(section.openTag, "data-claim");
    if (dataClaim === undefined || dataClaim.trim() === "") {
      throw new Error(`expected data-claim on ${section.id}`);
    }
    for (const claimId of dataClaim.split(/\s+/).filter((id) => id.length > 0)) {
      if (!known.has(claimId)) {
        throw new Error(`unknown claim ${claimId} on ${section.id}`);
      }
    }
  }
});

it("counterweight: every non-caption paragraph in ch1..ch5 carries a claims.json data-claim", () => {
  const html = readPage();
  const known = knownClaimIds(readClaims());
  const blockers = paragraphClaimBlockers(html, known, pageRel);
  if (blockers.length !== 0) {
    throw new Error(`expected [], got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a fixture copy with one paragraph data-claim removed is refused", () => {
  const html = readPage();
  const known = knownClaimIds(readClaims());
  const stripped = html.replace(/(<section\b[^>]*\bid="ch1"[^>]*>[\s\S]*?<p\b[^>]*?)\sdata-claim="[^"]*"/, "$1");
  if (stripped === html) {
    throw new Error("fixture rewrite did not remove a paragraph data-claim");
  }
  const blockers = paragraphClaimBlockers(stripped, known, pageRel);
  if (!blockers.some((blocker) => blocker.includes(":paragraph_without_claim:ch1"))) {
    throw new Error(`expected paragraph_without_claim for ch1, got ${JSON.stringify(blockers)}`);
  }
});

it("known-good: layout and claims checks pass on the real tree", async () => {
  expect(await checkLayout(process.cwd())).toEqual([]);
  const claims = readClaims();
  expect(checkClaimsHtml(readPage(), claims, pageRel)).toEqual([]);
});
