import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";

// Non-claims line, verbatim from PLAN-draft.md section 1 (NON-CLAIMS FOOTER).
const NON_CLAIMS =
  "not exam-equivalent; no clinical validity; no validity claimed for faculty marks or learner readiness; no Quest readiness claim; history-taking and communication only, no physical examination or touch assessed; formative practice and case authoring.";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  ".github",
  "ISSUE_TEMPLATE",
  "pilot-evaluation-interest.yml",
);
const FIXTURE_PATH = path.join(
  process.cwd(),
  "tools",
  "openclinxr",
  "evidence",
  "site",
  "fixtures",
  "issue-template",
  "no-required.yml",
);

type YamlScalar = string | boolean | null;
type YamlValue = YamlScalar | YamlMap | YamlValue[];
interface YamlMap {
  [key: string]: YamlValue;
}

function asMap(value: unknown): YamlMap | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as YamlMap;
  }
  return null;
}

function bodyFields(form: YamlMap): YamlMap[] {
  const body = form["body"];
  if (!Array.isArray(body)) {
    return [];
  }
  return body.filter((entry): entry is YamlMap => asMap(entry) !== null);
}

export function checkIssueTemplate(text: string): string[] {
  let document: unknown;
  try {
    document = parse(text);
  } catch (error) {
    return [`issue_template_yaml_error:${(error as Error).message}`];
  }
  const form = asMap(document);
  if (form === null) {
    return ["issue_template_yaml_error:document root is not a mapping"];
  }
  const blockers: string[] = [];
  for (const key of ["name", "description", "body"]) {
    const value = form[key];
    if (value === undefined || value === null || value === "") {
      blockers.push(`issue_template_missing:${key}`);
    }
  }
  const labels = form["labels"];
  const labelList = Array.isArray(labels) ? labels : typeof labels === "string" ? [labels] : [];
  if (!labelList.includes("pilot-interest")) {
    blockers.push("issue_template_labels_missing:pilot-interest");
  }
  const fields = bodyFields(form);
  const hasRequired = fields.some((field) => asMap(field["validations"])?.["required"] === true);
  if (!hasRequired) {
    blockers.push("issue_template_no_required_field");
  }
  const hasNonClaims = fields.some(
    (field) =>
      field["type"] === "markdown" &&
      typeof asMap(field["attributes"])?.["value"] === "string" &&
      (asMap(field["attributes"])?.["value"] as string).includes(NON_CLAIMS),
  );
  if (!hasNonClaims) {
    blockers.push("issue_template_non_claims_missing");
  }
  return blockers;
}

it("known-good: the pilot template parses with name, description, body, title prefix and the pilot-interest label", () => {
  const text = readFileSync(TEMPLATE_PATH, "utf8");
  const blockers = checkIssueTemplate(text);
  if (blockers.length !== 0) {
    throw new Error(`expected no blockers, got ${JSON.stringify(blockers)}`);
  }
  const form = asMap(parse(text));
  if (form === null) {
    throw new Error("expected the template root to be a mapping");
  }
  const title = form["title"];
  if (typeof title !== "string" || !title.startsWith("[pilot] ")) {
    throw new Error(`expected title prefix "[pilot] ", got ${JSON.stringify(title)}`);
  }
  const labels = form["labels"];
  const labelList = Array.isArray(labels) ? labels : [];
  if (!labelList.includes("pilot-interest")) {
    throw new Error(`expected labels to include pilot-interest, got ${JSON.stringify(labels)}`);
  }
  const fields = bodyFields(form);
  const ids = fields.map((field) =>
    typeof field["id"] === "string" ? field["id"] : "(markdown)",
  );
  expect(ids).toEqual(["(markdown)", "role", "organisation-type", "evaluate", "environment"]);
  const role = fields[1];
  if (role === undefined || role["type"] !== "dropdown") {
    throw new Error(`expected the second body field to be the role dropdown, got ${JSON.stringify(role)}`);
  }
  const attributes = asMap(role["attributes"]);
  if (attributes === null) {
    throw new Error("expected the role dropdown to carry attributes");
  }
  expect(attributes["options"]).toEqual([
    "clinical educator",
    "standardized-patient program",
    "assessment / psychometrics",
    "IT / deployment",
    "other",
  ]);
});

it("counterweight: the pilot template carries a required field and a markdown block with the non-claims line", () => {
  const form = asMap(parse(readFileSync(TEMPLATE_PATH, "utf8")));
  if (form === null) {
    throw new Error("expected the template root to be a mapping");
  }
  const fields = bodyFields(form);
  const requiredIds = fields
    .filter((field) => asMap(field["validations"])?.["required"] === true)
    .map((field) => field["id"]);
  if (requiredIds.length === 0) {
    throw new Error("expected at least one body field with validations.required true");
  }
  const markdownValues = fields
    .filter((field) => field["type"] === "markdown")
    .map((field) => {
      const value = asMap(field["attributes"])?.["value"];
      return typeof value === "string" ? value : "";
    });
  if (!markdownValues.some((value) => value.includes(NON_CLAIMS))) {
    throw new Error("expected a markdown block to hold the non-claims line");
  }
});

it("negative: a fixture form with no required field is refused with issue_template_no_required_field", () => {
  const blockers = checkIssueTemplate(readFileSync(FIXTURE_PATH, "utf8"));
  expect(blockers).toEqual(["issue_template_no_required_field"]);
});
