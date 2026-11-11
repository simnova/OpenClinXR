import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { type ClaimsFile, checkClaimsHtml } from "./check-claims.js";
import { validateSiteData } from "./site-data-schemas.js";

const fixtureDir = path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "fixtures", "claims");

function readFixture(name: string): string {
  return readFileSync(path.join(fixtureDir, name), "utf8");
}

function readClaims(): ClaimsFile {
  return JSON.parse(readFileSync(path.join(process.cwd(), "docs", "site", "data", "claims.json"), "utf8")) as ClaimsFile;
}

function hasFamily(blockers: string[], family: string): boolean {
  return blockers.some((blocker) => blocker.startsWith("claims_phrase_affirmed:") && blocker.includes(`:${family}:`));
}

it("negative F1: a claim-copy paragraph with automated scoring gives a claims_phrase_affirmed blocker naming F1", () => {
  const blockers = checkClaimsHtml(readFixture("f1-scoring.html"), readClaims(), "f1-scoring.html");
  if (!hasFamily(blockers, "F1")) {
    throw new Error(`expected F1 blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative F2: a claim-copy paragraph with validated gives a claims_phrase_affirmed blocker naming F2", () => {
  const blockers = checkClaimsHtml(readFixture("f2-validity.html"), readClaims(), "f2-validity.html");
  if (!hasFamily(blockers, "F2")) {
    throw new Error(`expected F2 blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative F3: a claim-copy paragraph with exam-equivalent gives a claims_phrase_affirmed blocker naming F3", () => {
  const blockers = checkClaimsHtml(readFixture("f3-exam.html"), readClaims(), "f3-exam.html");
  if (!hasFamily(blockers, "F3")) {
    throw new Error(`expected F3 blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative F4: a claim-copy paragraph with runs on Quest 3 gives a claims_phrase_affirmed blocker naming F4", () => {
  const blockers = checkClaimsHtml(readFixture("f4-headset.html"), readClaims(), "f4-headset.html");
  if (!hasFamily(blockers, "F4")) {
    throw new Error(`expected F4 blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative F5: a claim-copy paragraph with fully offline gives a claims_phrase_affirmed blocker naming F5", () => {
  const blockers = checkClaimsHtml(readFixture("f5-no-cloud.html"), readClaims(), "f5-no-cloud.html");
  if (!hasFamily(blockers, "F5")) {
    throw new Error(`expected F5 blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative F6: a claim-copy paragraph with physical examination gives a claims_phrase_affirmed blocker naming F6", () => {
  const blockers = checkClaimsHtml(readFixture("f6-physical.html"), readClaims(), "f6-physical.html");
  if (!hasFamily(blockers, "F6")) {
    throw new Error(`expected F6 blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a mission composite rendering M3 before M2 gives claims_composite_order", () => {
  const blockers = checkClaimsHtml(readFixture("composite-order.html"), readClaims(), "composite-order.html");
  if (!blockers.some((blocker) => blocker === "claims_composite_order:composite-order.html:mission")) {
    throw new Error(`expected composite order blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a segment whose textContent differs by one word gives claims_segment_text_mismatch", () => {
  const blockers = checkClaimsHtml(readFixture("segment-mismatch.html"), readClaims(), "segment-mismatch.html");
  if (!blockers.some((blocker) => blocker === "claims_segment_text_mismatch:segment-mismatch.html:M1")) {
    throw new Error(`expected segment mismatch blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("known-good: the negated forms not validated, no validation study and no physical examination is assessed give []", () => {
  const blockers = checkClaimsHtml(readFixture("negated.html"), readClaims(), "negated.html");
  if (JSON.stringify(blockers) !== "[]") {
    throw new Error(`expected [], got ${JSON.stringify(blockers)}`);
  }
});

it("known-good: a fixture rendering the mission, tagline and licence composites verbatim from claims.json gives []", () => {
  const blockers = checkClaimsHtml(readFixture("composites-verbatim.html"), readClaims(), "composites-verbatim.html");
  if (JSON.stringify(blockers) !== "[]") {
    throw new Error(`expected [], got ${JSON.stringify(blockers)}`);
  }
});

it("known-good: the real docs/site/data/claims.json passes validateSiteData with []", async () => {
  const blockers = await validateSiteData(process.cwd());
  if (JSON.stringify(blockers) !== "[]") {
    throw new Error(`expected [], got ${JSON.stringify(blockers)}`);
  }
});

it("counterweight: a claim-copy paragraph with no data-claim attribute gives claims_copy_without_claim", () => {
  const blockers = checkClaimsHtml(readFixture("copy-without-claim.html"), readClaims(), "copy-without-claim.html");
  if (!blockers.some((blocker) => blocker === "claims_copy_without_claim:copy-without-claim.html")) {
    throw new Error(`expected copy-without-claim blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a claim-copy paragraph with an unknown claim id gives claims_unknown_claim", () => {
  const html = '<p class="claim-copy" data-claim="CL1 CL999">Faculty enter rubric marks.</p>';
  const blockers = checkClaimsHtml(html, readClaims(), "unknown-claim");
  if (!blockers.some((blocker) => blocker === "claims_unknown_claim:unknown-claim:CL999")) {
    throw new Error(`expected unknown-claim blocker, got ${JSON.stringify(blockers)}`);
  }
  expect(blockers).toHaveLength(1);
});

it("negative: a segment inside a span composite is still text-checked", () => {
  const claims = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "site", "data", "claims.json"), "utf8"));
  const html =
    '<span data-composite="tagline"><span data-segment="T1">One case blueprint, scored.</span></span>';
  expect(checkClaimsHtml(html, claims, "span.html")).toContain("claims_segment_text_mismatch:span.html:T1");
});
