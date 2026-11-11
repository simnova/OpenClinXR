import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import {
  type HeroBytesReader,
  heroImageBlocker,
  heroImageBlockerFor,
} from "../check-github-pages-site.js";
import { type ClaimsFile, checkClaimsHtml } from "./check-claims.js";
import { checkLayout } from "./layout.js";

const fixtureDir = path.join(
  process.cwd(),
  "tools",
  "openclinxr",
  "evidence",
  "site",
  "fixtures",
  "home",
);

function readFixture(name: string): string {
  return readFileSync(path.join(fixtureDir, name), "utf8");
}

function fixtureReader(): HeroBytesReader {
  return (docsRelativePath: string) => {
    const rel = docsRelativePath.startsWith("docs/")
      ? docsRelativePath.slice(5)
      : docsRelativePath;
    try {
      return readFileSync(path.join(fixtureDir, rel));
    } catch {
      return undefined;
    }
  };
}

function shaOfFixture(name: string): string {
  return createHash("sha256").update(readFileSync(path.join(fixtureDir, name))).digest("hex");
}

function gradedGrades(sha256: string): { entries: { slot: string; sha256: string }[] } {
  return { entries: [{ slot: "hero-poster", sha256 }] };
}

function compositeInner(html: string, compositeId: string): string {
  const pattern =
    /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\bdata-composite\s*=\s*("[^"]*"|'[^']*')[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(pattern)) {
    if ((match[2] ?? "").slice(1, -1) === compositeId) {
      return match[3] ?? "";
    }
  }
  throw new Error(`composite ${compositeId} not found`);
}

function segmentText(html: string, segmentId: string): string {
  const pattern = new RegExp(
    `<span\\b[^>]*\\bdata-segment\\s*=\\s*("${segmentId}"|'${segmentId}')[^>]*>([\\s\\S]*?)<\\/span>`,
    "i",
  );
  const match = pattern.exec(html);
  if (!match) {
    throw new Error(`segment ${segmentId} not found`);
  }
  return (match[2] ?? "").replace(/\s+/g, " ").trim();
}

function readClaims(): ClaimsFile {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "docs", "site", "data", "claims.json"), "utf8"),
  ) as ClaimsFile;
}

it("known-good: mission and tagline composites list segment ids in claims.json composite order with verbatim text", () => {
  const html = readFileSync(path.join(process.cwd(), "docs", "index.html"), "utf8");
  const claims = readClaims();
  const segments = new Map((claims.segments ?? []).map((segment) => [segment.id, segment.text]));
  for (const compositeId of ["mission", "tagline"]) {
    const inner = compositeInner(html, compositeId);
    const actualIds = [...inner.matchAll(/data-segment\s*=\s*("[^"]*"|'[^']*')/gi)].map(
      (match) => (match[1] ?? "").slice(1, -1),
    );
    expect(actualIds).toEqual(claims.composites?.[compositeId] ?? []);
    for (const segmentId of actualIds) {
      expect(segmentText(html, segmentId)).toEqual(
        (segments.get(segmentId) ?? "").replace(/\s+/g, " ").trim(),
      );
    }
  }
});

it("negative: PLACEHOLDER media plus a page with an img hero is a blocker", () => {
  const media = JSON.parse(readFixture("media-placeholder.json"));
  const blocker = heroImageBlockerFor(
    readFixture("placeholder-with-img.html"),
    media,
    { entries: [] },
    fixtureReader(),
  );
  expect(blocker).toBe("pages_index_hero_image_ungraded_has_img");
});

it("known-good: PLACEHOLDER media plus a capture-pending hero figure gives undefined", () => {
  const media = JSON.parse(readFixture("media-placeholder.json"));
  expect(
    heroImageBlockerFor(
      readFixture("placeholder-figure.html"),
      media,
      { entries: [] },
      fixtureReader(),
    ),
  ).toBeUndefined();
});

it("negative: GRADED media plus a page with no img is a blocker", () => {
  const media = JSON.parse(readFixture("media-graded.json"));
  expect(
    heroImageBlockerFor(
      readFixture("graded-no-img.html"),
      media,
      gradedGrades(shaOfFixture("assets/hero-good.bin")),
      fixtureReader(),
    ),
  ).toBe("pages_index_hero_image_missing");
});

it("negative: GRADED media plus an img whose sha256 differs from the grades entry is a blocker", () => {
  const media = JSON.parse(readFixture("media-graded.json"));
  expect(
    heroImageBlockerFor(
      readFixture("graded-wrong-img.html"),
      media,
      gradedGrades(shaOfFixture("assets/hero-good.bin")),
      fixtureReader(),
    ),
  ).toBe("pages_index_hero_image_sha_mismatch");
});

it("negative: unreadable media defaults to PLACEHOLDER, so a page with an img hero is a blocker", () => {
  expect(
    heroImageBlockerFor(
      readFixture("placeholder-with-img.html"),
      {},
      { entries: [] },
      fixtureReader(),
    ),
  ).toBe("pages_index_hero_image_ungraded_has_img");
});

it("known-good: GRADED media plus an img with matching sha gives undefined", () => {
  const media = JSON.parse(readFixture("media-graded.json"));
  expect(
    heroImageBlockerFor(
      readFixture("graded-good-img.html"),
      media,
      gradedGrades(shaOfFixture("assets/hero-good.bin")),
      fixtureReader(),
    ),
  ).toBeUndefined();
});

it("negative: GRADED media plus a matching-sha img outside the hero figure is a blocker", () => {
  const media = JSON.parse(readFixture("media-graded.json"));
  expect(
    heroImageBlockerFor(
      readFixture("graded-good-img-outside.html"),
      media,
      gradedGrades(shaOfFixture("assets/hero-good.bin")),
      fixtureReader(),
    ),
  ).toBe("pages_index_hero_image_missing");
});

it("known-good: the real docs/index.html passes heroImageBlocker against the real media.json and grades.json", async () => {
  const html = readFileSync(path.join(process.cwd(), "docs", "index.html"), "utf8");
  expect(await heroImageBlocker(html)).toBeUndefined();
});

it("counterweight: index.html carries no factory-stations or evidence-docs ids and no data-pages-snapshot attributes except as href links to engineering.html", () => {
  const html = readFileSync(path.join(process.cwd(), "docs", "index.html"), "utf8");
  expect(html).toContain('href="engineering.html#factory-stations"');
  expect(html).toContain('href="engineering.html#evidence-docs"');
  const withoutEngineeringLinks = html.replace(/href="engineering\.html[^"]*"/g, 'href=""');
  expect(withoutEngineeringLinks).not.toContain('id="factory-stations"');
  expect(withoutEngineeringLinks).not.toContain('id="evidence-docs"');
  expect(withoutEngineeringLinks).not.toContain("data-pages-snapshot");
  expect(withoutEngineeringLinks).not.toContain("factory-stations");
  expect(withoutEngineeringLinks).not.toContain("evidence-docs");
});

it("known-good: checkClaimsHtml(index.html) and checkLayout(repo root) both return [] for index.html", async () => {
  const html = readFileSync(path.join(process.cwd(), "docs", "index.html"), "utf8");
  expect(checkClaimsHtml(html, readClaims(), "docs/index.html")).toEqual([]);
  expect(await checkLayout(process.cwd())).toEqual([]);
});
