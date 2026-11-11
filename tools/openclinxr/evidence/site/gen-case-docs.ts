import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  edChestPainDialogueSeeds,
  edChestPainScenario,
} from "../../../../packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.js";

export const FIXTURE_REL_PATH = "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts";
export const RUBRIC_NOTE = "labels only; no definitions or anchors yet";

export type RubricItem = { id: string; label: string };
export type RubricDoc = {
  source: string;
  note: string;
  items: RubricItem[];
  fieldSources: Record<string, string>;
};
export type HistoryAnswer = { topic: string; answer: string };
export type AffectEntry = { topic: string; affect: string };
export type SpCaseDoc = {
  source: string;
  openingLine: string;
  historyAnswers: HistoryAnswer[];
  affect: AffectEntry[];
  fieldSources: Record<string, string>;
};

function patientOpeningLine(): string {
  const patient =
    edChestPainScenario.actors.find((actor) => actor.actorId === "patient_robert_hayes_v1") ??
    edChestPainScenario.actors.find((actor) => actor.role === "patient");
  const line = patient?.openingUtterance;
  if (typeof line !== "string" || line.length === 0) {
    throw new Error("gen-case-docs: patient openingUtterance missing in fixture");
  }
  return line;
}

export function buildRubricDoc(): RubricDoc {
  const items = edChestPainScenario.reviewRubric.map((entry) => ({
    id: entry.rubricId,
    label: entry.label,
  }));
  return {
    source: FIXTURE_REL_PATH,
    note: RUBRIC_NOTE,
    items,
    fieldSources: {
      source: `fixture file path ${FIXTURE_REL_PATH}`,
      note: "fixture limitation: edChestPainScenario.reviewRubric[] carries only rubricId + label (no definition/anchor fields) per B8",
      items: "edChestPainScenario.reviewRubric (in fixture order)",
      "items[].id": "edChestPainScenario.reviewRubric[].rubricId",
      "items[].label": "edChestPainScenario.reviewRubric[].label",
    },
  };
}

export function buildSpCaseDoc(): SpCaseDoc {
  const respondSeeds = edChestPainDialogueSeeds.filter(
    (seed) => seed.safetyExpectation === "responds_from_visible_facts",
  );
  const historyAnswers = respondSeeds.map((seed) => ({
    topic: seed.seedId,
    answer: seed.spokenText ?? seed.visibleFacts[0] ?? "",
  }));
  const affect = respondSeeds
    .filter((seed) => typeof seed.affect === "string")
    .map((seed) => ({
      topic: seed.seedId,
      affect: seed.affect as string,
    }));
  return {
    source: FIXTURE_REL_PATH,
    openingLine: patientOpeningLine(),
    historyAnswers,
    affect,
    fieldSources: {
      source: `fixture file path ${FIXTURE_REL_PATH}`,
      openingLine:
        "edChestPainScenario.actors[actorId=patient_robert_hayes_v1].openingUtterance",
      historyAnswers:
        "edChestPainDialogueSeeds[?safetyExpectation=responds_from_visible_facts] (in fixture order)",
      "historyAnswers[].topic": "edChestPainDialogueSeeds[].seedId",
      "historyAnswers[].answer":
        "edChestPainDialogueSeeds[].spokenText (fallback edChestPainDialogueSeeds[].visibleFacts[0])",
      affect:
        "edChestPainDialogueSeeds[?safetyExpectation=responds_from_visible_facts][].affect (authored affect, in fixture order)",
      "affect[].topic": "edChestPainDialogueSeeds[].seedId",
      "affect[].affect": "edChestPainDialogueSeeds[].affect",
    },
  };
}

export function serializeDoc(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function checkFieldSources(doc: unknown): string[] {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return ["case_docs_field_sources:not_an_object"];
  }
  const record = doc as Record<string, unknown>;
  const sources = record["fieldSources"];
  if (typeof sources !== "object" || sources === null || Array.isArray(sources)) {
    return ["case_docs_field_sources:missing"];
  }
  const sourceRecord = sources as Record<string, unknown>;
  const blockers: string[] = [];
  for (const key of Object.keys(record)) {
    if (key === "fieldSources") {
      continue;
    }
    const mapped = sourceRecord[key];
    if (typeof mapped !== "string" || mapped.trim().length === 0) {
      blockers.push(`case_docs_field_sources_missing:${key}`);
    }
  }
  return blockers;
}

export async function writeCaseDocs(rootDir: string = process.cwd()): Promise<string[]> {
  const dataDir = path.join(rootDir, "docs", "site", "data");
  await mkdir(dataDir, { recursive: true });
  const rubric = buildRubricDoc();
  const spCase = buildSpCaseDoc();
  const rubricBlockers = checkFieldSources(rubric);
  const spBlockers = checkFieldSources(spCase);
  const blockers = [...rubricBlockers, ...spBlockers];
  if (blockers.length > 0) {
    throw new Error(`gen-case-docs: fieldSources incomplete: ${blockers.join(", ")}`);
  }
  const rubricPath = path.join(dataDir, "ed-chest-pain-rubric.json");
  const spCasePath = path.join(dataDir, "ed-chest-pain-sp-case.json");
  await writeFile(rubricPath, serializeDoc(rubric));
  await writeFile(spCasePath, serializeDoc(spCase));
  return [rubricPath, spCasePath];
}

async function main(): Promise<void> {
  const written = await writeCaseDocs(process.cwd());
  for (const file of written) {
    console.log(`Wrote ${path.relative(process.cwd(), file)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
