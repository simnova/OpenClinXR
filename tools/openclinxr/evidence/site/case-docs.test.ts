import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import {
  buildRubricDoc,
  buildSpCaseDoc,
  checkFieldSources,
  writeCaseDocs,
} from "./gen-case-docs.js";
import { validateSiteData } from "./site-data-schemas.js";

it("negative: an output field with no entry in fieldSources is refused", () => {
  const rubric = buildRubricDoc() as unknown as Record<string, unknown>;
  const doctored = { ...rubric, inventedField: "hand-typed" };
  const blockers = checkFieldSources(doctored);
  if (!blockers.some((blocker) => blocker.includes("inventedField"))) {
    throw new Error(`expected inventedField blocker, got ${JSON.stringify(blockers)}`);
  }
});

it("known-good: regenerating into a temp dir gives bytes identical to the committed two files", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "w4b-case-docs-"));
  await writeCaseDocs(root);
  for (const name of ["ed-chest-pain-rubric.json", "ed-chest-pain-sp-case.json"]) {
    const regenerated = readFileSync(path.join(root, "docs", "site", "data", name), "utf8");
    const committed = readFileSync(path.join(process.cwd(), "docs", "site", "data", name), "utf8");
    expect(regenerated).toBe(committed);
  }
});

it("counterweight: rubric item count equals the fixture reviewRubric length", () => {
  const rubric = buildRubricDoc();
  const spCase = buildSpCaseDoc();
  expect(rubric.items.length).toBe(edChestPainScenario.reviewRubric.length);
  expect(rubric.items.length).toBeGreaterThan(0);
  expect(spCase.historyAnswers.length).toBeGreaterThan(0);
});

it("CL21: claims.json CL21 has probe.path that exists in this worktree, or a non-empty searchRecord.patterns", () => {
  const claims = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "site", "data", "claims.json"), "utf8")) as {
    claims: { id: string; probe?: Record<string, unknown>; searchRecord?: Record<string, unknown> }[];
  };
  const cl21 = claims.claims.find((claim) => claim.id === "CL21");
  if (!cl21) {
    throw new Error("expected CL21 in claims.json");
  }
  const probePath = cl21.probe?.["path"];
  if (typeof probePath === "string" && probePath.length > 0) {
    if (!existsSync(path.join(process.cwd(), probePath))) {
      throw new Error(`expected probe.path to exist, got ${probePath}`);
    }
    return;
  }
  const patterns = (cl21.searchRecord as { patterns?: unknown } | undefined)?.patterns;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(`expected non-empty searchRecord.patterns, got ${JSON.stringify(cl21.searchRecord)}`);
  }
});

it("known-good: validateSiteData(process.cwd()) gives []", async () => {
  const blockers = await validateSiteData(process.cwd());
  if (JSON.stringify(blockers) !== "[]") {
    throw new Error(`expected [], got ${JSON.stringify(blockers)}`);
  }
});
