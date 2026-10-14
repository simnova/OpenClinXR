/**
 * The second body cites the chain and not the parent sheet.
 *
 * Reads the tracked second-body-report.json (adult_male_street_casual) and
 * asserts the contract: the report parses, names the second-body subject,
 * cites the CURRENT sha256 of chain-manifest.json and
 * reference-set/manifest.json (so a stale report fails), and its final
 * albedo sha differs from the read-off-disk peds_anxious_parent sheet
 * albedo sha while no report INPUT source mentions peds_anxious_parent.
 *
 * Counterweights, each its own tiny fixture in fixtures/second-body/:
 * a report citing a wrong manifest sha fails validation, a report
 * aliasing the parent sheet (final albedo == parent albedo, input source
 * naming peds_anxious_parent) fails validation, and a report whose
 * compose crown_step exceeds its bound while compose is not listed in
 * stages_needing_tracked_code_change fails validation.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPORT = path.join(DIR, "second-body-report.json");
const CHAIN_MANIFEST = path.join(DIR, "chain-manifest.json");
const REF_MANIFEST = path.join(
  DIR, "..", "..", "reference-set", "manifest.json");
const PARENT_SHEET = path.join(
  DIR, "..", "sheets", "peds_anxious_parent", "albedo.png");
const FIX = path.join(DIR, "fixtures", "second-body");

function shaOf(file: string): string {
  return execFileSync("shasum", ["-a", "256", file], { encoding: "utf8" })
    .split(" ")[0]!;
}

type SecondBodyReport = {
  subject?: unknown;
  chain_manifest_sha256?: unknown;
  reference_set_manifest_sha256?: unknown;
  final_albedo_sha256?: unknown;
  inputs?: unknown;
};

function inputSources(report: SecondBodyReport): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "source" && typeof v === "string") out.push(v);
        else walk(v);
      }
    }
  };
  walk(report.inputs);
  return out;
}

/** Throws on any contract breach; returns silently on a valid report. */
function validateReport(report: SecondBodyReport): void {
  if (!report || typeof report !== "object") {
    throw new Error("report does not parse to an object");
  }
  if (report.subject !== "adult_male_street_casual") {
    throw new Error(`subject is ${String(report.subject)}`);
  }
  const chainSha = shaOf(CHAIN_MANIFEST);
  if (report.chain_manifest_sha256 !== chainSha) {
    throw new Error("chain_manifest_sha256 is stale");
  }
  const refSha = shaOf(REF_MANIFEST);
  if (report.reference_set_manifest_sha256 !== refSha) {
    throw new Error("reference_set_manifest_sha256 is stale");
  }
  const parentSha = shaOf(PARENT_SHEET);
  if (typeof report.final_albedo_sha256 !== "string" ||
    report.final_albedo_sha256.length !== 64) {
    throw new Error("final_albedo_sha256 missing");
  }
  if (report.final_albedo_sha256 === parentSha) {
    throw new Error("final albedo aliases the parent sheet albedo");
  }
  for (const src of inputSources(report)) {
    if (src.includes("peds_anxious_parent")) {
      throw new Error(`input source cites the parent sheet: ${src}`);
    }
  }
  const crown = (report as {
    boundary_flags?: { compose_crown_step?: { max?: unknown; bound?: unknown } };
    stages_needing_tracked_code_change?: unknown;
  }).boundary_flags?.compose_crown_step;
  if (crown && typeof crown.max === "number" &&
    typeof crown.bound === "number" && crown.max > crown.bound) {
    const need = (report as {
      stages_needing_tracked_code_change?: unknown;
    }).stages_needing_tracked_code_change;
    const listed = Array.isArray(need) && need.some((s: unknown) =>
      typeof s === "string" && s.toLowerCase().includes("compose"));
    if (!listed) {
      throw new Error("compose crown_step exceeds its bound but compose " +
        "is not listed as needing a tracked code change");
    }
  }
}

function loadReport(file: string): SecondBodyReport {
  return JSON.parse(fs.readFileSync(file, "utf8")) as SecondBodyReport;
}

describe("second body cites the chain and not the parent sheet", () => {
  it("the tracked report exists, parses, and validates", () => {
    validateReport(loadReport(REPORT));
  });

  it("a report citing a wrong manifest sha fails validation", () => {
    expect(() => validateReport(loadReport(path.join(
      FIX, "report-wrong-manifest-sha.json")))).toThrow();
  });

  it("a report aliasing the parent sheet fails validation", () => {
    expect(() => validateReport(loadReport(path.join(
      FIX, "report-alias-parent-sheet.json")))).toThrow();
  });

  it("a report whose crown_step exceeds its bound without listing " +
    "compose as needing change fails validation", () => {
      expect(() => validateReport(loadReport(path.join(
        FIX, "report-crown-step-unlisted.json")))).toThrow();
    });
});
