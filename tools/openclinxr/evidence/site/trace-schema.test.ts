import { readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { expect, it } from "vitest";
import { classifyMn1Event } from "./fixtures/mn1/recompute.js";

const SCHEMA_PATH = path.join(process.cwd(), "docs", "site", "data", "trace-schema.json");
// run-15 source: docs/site/data/rr1-trace/CBB5_UB-J.conversation-trace.json (committed copy of store site-reimagine/rr1/run-15/trace/CBB5_UB-J.conversation-trace.json)
const TRACE_PATH = path.join(
  process.cwd(),
  "docs",
  "site",
  "data",
  "rr1-trace",
  "CBB5_UB-J.conversation-trace.json",
);
const MN1_PATH = path.join(process.cwd(), "docs", "site", "data", "mn1.json");
const PAGE_PATH = path.join(process.cwd(), "docs", "evidence.html");
const FIXTURE_DIR = path.join(
  process.cwd(),
  "tools",
  "openclinxr",
  "evidence",
  "site",
  "fixtures",
  "trace-schema",
);

const IN_SCOPE: { file: string; types: string[] }[] = [
  {
    file: "packages/openclinxr/xr-sync-server/src/review-packet-file.ts",
    types: ["ReviewPacketStation", "ReviewPacketFile"],
  },
  {
    file: "packages/openclinxr/xr-sync-server/src/faculty-score.ts",
    types: [
      "ReviewRubricItem",
      "FacultyScoreBinding",
      "LobbyScore",
      "FacultyScoreFile",
      "ReplayReviewState",
    ],
  },
  {
    file: "packages/openclinxr/xr-sync-server/src/review-packet.ts",
    types: ["ReplayRoomGuard"],
  },
];

type FieldSet = { names: string[]; required: string[] };

function tsInterfaceFields(sourceFile: string, typeName: string): FieldSet {
  const text = readFileSync(path.join(process.cwd(), sourceFile), "utf8");
  const sf = ts.createSourceFile(sourceFile, text, ts.ScriptTarget.Latest, true);
  for (const statement of sf.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== typeName) {
      continue;
    }
    const names: string[] = [];
    const required: string[] = [];
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member)) {
        continue;
      }
      const name = member.name;
      if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) {
        throw new Error(`computed property name in ${typeName} of ${sourceFile}`);
      }
      names.push(name.text);
      if (member.questionToken === undefined) {
        required.push(name.text);
      }
    }
    return { names: names.sort(), required: required.sort() };
  }
  throw new Error(`interface ${typeName} not found in ${sourceFile}`);
}

function schemaDefFields(schema: unknown, defName: string): FieldSet {
  if (typeof schema !== "object" || schema === null) {
    throw new Error("schema is not an object");
  }
  const defs = (schema as { $defs?: unknown }).$defs;
  if (typeof defs !== "object" || defs === null) {
    throw new Error("schema has no $defs object");
  }
  const def = (defs as Record<string, unknown>)[defName];
  if (typeof def !== "object" || def === null) {
    throw new Error(`$defs has no object entry ${defName}`);
  }
  const record = def as Record<string, unknown>;
  const properties = record["properties"];
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    throw new Error(`$defs/${defName} has no properties object`);
  }
  const requiredRaw = record["required"];
  const required = Array.isArray(requiredRaw)
    ? requiredRaw.filter((entry): entry is string => typeof entry === "string").sort()
    : [];
  return { names: Object.keys(properties).sort(), required };
}

function diffTypeFields(sourceFile: string, typeName: string, schema: unknown): string[] {
  const tsFields = tsInterfaceFields(sourceFile, typeName);
  const defFields = schemaDefFields(schema, typeName);
  const diff: string[] = [];
  for (const name of tsFields.names) {
    if (!defFields.names.includes(name)) {
      diff.push(`missing:${typeName}.${name}`);
    }
  }
  for (const name of defFields.names) {
    if (!tsFields.names.includes(name)) {
      diff.push(`extra:${typeName}.${name}`);
    }
  }
  for (const name of tsFields.required) {
    if (!defFields.required.includes(name)) {
      diff.push(`required-missing:${typeName}.${name}`);
    }
  }
  for (const name of defFields.required) {
    if (!tsFields.required.includes(name)) {
      diff.push(`required-extra:${typeName}.${name}`);
    }
  }
  return diff;
}

it("known-good: schema $defs field sets equal the exported TS interface field sets", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as unknown;
  const defs = (schema as { $defs?: unknown }).$defs;
  if (typeof defs !== "object" || defs === null) {
    throw new Error("trace-schema.json has no $defs object");
  }
  const defNames = Object.keys(defs).sort();
  const typeNames = IN_SCOPE.flatMap((entry) => entry.types).sort();
  expect(defNames).toEqual(typeNames);
  for (const entry of IN_SCOPE) {
    for (const typeName of entry.types) {
      expect(diffTypeFields(entry.file, typeName, schema)).toEqual([]);
    }
  }
});

it("counterweight: a fixture copy with one field removed fails the same comparison", () => {
  const schema = JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, "faculty-score-file-missing-field.schema.json"), "utf8"),
  ) as unknown;
  const diff = diffTypeFields(
    "packages/openclinxr/xr-sync-server/src/faculty-score.ts",
    "FacultyScoreFile",
    schema,
  );
  expect(diff).toContain("missing:FacultyScoreFile.rubricSize");
  if (diff.length === 0) {
    throw new Error("removed-field fixture passed the comparison; the check is vacuous");
  }
});

it("counterweight: a fixture copy with one field required/optional flipped fails the same comparison", () => {
  const schema = JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, "faculty-score-file-optional-flip.schema.json"), "utf8"),
  ) as unknown;
  const diff = diffTypeFields(
    "packages/openclinxr/xr-sync-server/src/faculty-score.ts",
    "FacultyScoreFile",
    schema,
  );
  expect(diff).toContain("required-extra:FacultyScoreFile.scenarioId");
  if (diff.length === 0) {
    throw new Error("optional-flip fixture passed the comparison; the check is vacuous");
  }
});

const EXPECTED_HEADERS = ["turn", "addressed actor", "tag", "match", "modality"];

function textContent(html: string): string {
  return html
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function traceTable(html: string): { headers: string[]; rows: string[][] } {
  const tables = [
    ...html.matchAll(/<table\b[^>]*class="measure-table"[^>]*>([\s\S]*?)<\/table>/giu),
  ];
  for (const table of tables) {
    const inner = table[1] ?? "";
    const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/iu.exec(inner)?.[1] ?? "";
    const headers = [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/giu)].map((cell) =>
      textContent(cell[1] ?? "").toLowerCase(),
    );
    if (headers.join("|") !== EXPECTED_HEADERS.join("|")) {
      continue;
    }
    const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/iu.exec(inner)?.[1] ?? "";
    const rows: string[][] = [];
    for (const row of tbody.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/giu) ?? []) {
      rows.push(
        [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/giu)].map((cell) =>
          textContent(cell[1] ?? ""),
        ),
      );
    }
    return { headers, rows };
  }
  throw new Error(`trace table with headers ${EXPECTED_HEADERS.join(",")} not found`);
}

type TraceFile = { events?: unknown };

function expectedTraceRows(): string[][] {
  const trace = JSON.parse(readFileSync(TRACE_PATH, "utf8")) as TraceFile;
  const events = Array.isArray(trace.events) ? trace.events : [];
  const rows: string[][] = [];
  for (const event of events) {
    if (typeof event !== "object" || event === null) {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record["kind"] !== "utterance-end") {
      continue;
    }
    const outcome = classifyMn1Event(event);
    if (outcome === null) {
      throw new Error("utterance-end event classified as a non-turn");
    }
    const turnId = record["turnId"];
    const actorId = record["actorId"];
    const tag = record["tag"];
    const modality = record["modality"];
    if (
      typeof turnId !== "number" ||
      typeof actorId !== "string" ||
      typeof tag !== "string" ||
      typeof modality !== "string"
    ) {
      throw new Error(
        `utterance-end event has non-string cells: ${JSON.stringify(event).slice(0, 160)}`,
      );
    }
    rows.push([String(turnId), actorId, tag, outcome, modality]);
  }
  return rows;
}

function compareTableToTrace(html: string, expected: string[][]): string[] {
  const mismatches: string[] = [];
  let table: { headers: string[]; rows: string[][] };
  try {
    table = traceTable(html);
  } catch {
    return ["trace_table_missing"];
  }
  if (table.rows.length !== expected.length) {
    mismatches.push(`row_count:${String(table.rows.length)}:${String(expected.length)}`);
  }
  const count = Math.min(table.rows.length, expected.length);
  for (let index = 0; index < count; index += 1) {
    const actual = table.rows[index] ?? [];
    const want = expected[index] ?? [];
    for (let column = 0; column < EXPECTED_HEADERS.length; column += 1) {
      const header = EXPECTED_HEADERS[column] ?? `col${String(column)}`;
      if ((actual[column] ?? "") !== (want[column] ?? "")) {
        mismatches.push(
          `cell:row${String(index)}:${header}:${actual[column] ?? ""}:${want[column] ?? ""}`,
        );
      }
    }
  }
  return mismatches;
}

function readMn1N(): number {
  const mn1 = JSON.parse(readFileSync(MN1_PATH, "utf8")) as { counts?: { N?: unknown } };
  const n = mn1.counts?.N;
  if (typeof n !== "number") {
    throw new Error("mn1.json counts.N is not a number");
  }
  return n;
}

it("known-good: the evidence.html trace table rows equal the utterance events recomputed from the committed trace", () => {
  const expected = expectedTraceRows();
  expect(expected.length).toBe(2);
  expect(expected.length).toBe(readMn1N());
  expect(compareTableToTrace(readFileSync(PAGE_PATH, "utf8"), expected)).toEqual([]);
});

it("negative: a fixture copy of the TT table with one cell changed fails the same comparison", () => {
  const expected = expectedTraceRows();
  const fixture = readFileSync(path.join(FIXTURE_DIR, "tt-one-cell-changed.html"), "utf8");
  const mismatches = compareTableToTrace(fixture, expected);
  expect(mismatches.length).toBeGreaterThan(0);
  if (!mismatches.some((mismatch) => mismatch.startsWith("cell:row1:modality:"))) {
    throw new Error(`expected the changed modality cell to mismatch, got ${JSON.stringify(mismatches)}`);
  }
});

// run-15 source: docs/site/data/rr1-trace/CBB5_UB-J.conversation-trace.json (station-1 trace, caption key for the shipped TT table in docs/evidence.html)
const TRACE_FILE_NAME = "CBB5_UB-J.conversation-trace.json";
const TT_HEADERS = ["turn", "addressed actor", "tag", "match", "modality"];

function ttTableByCaption(html: string): { headers: string[]; rows: string[][] } {
  const blocks = [
    ...html.matchAll(/<div\b[^>]*class="measure-table-wrap"[^>]*>([\s\S]*?)<\/div>/giu),
  ];
  for (const block of blocks) {
    const inner = block[1] ?? "";
    const caption = /<caption\b[^>]*>([\s\S]*?)<\/caption>/iu.exec(inner)?.[1] ?? "";
    if (!textContent(caption).includes(TRACE_FILE_NAME)) {
      continue;
    }
    const table = /<table\b[^>]*>([\s\S]*?)<\/table>/iu.exec(inner)?.[1] ?? "";
    const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/iu.exec(table)?.[1] ?? "";
    const headers = [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/giu)].map((cell) =>
      textContent(cell[1] ?? "").toLowerCase(),
    );
    const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/iu.exec(table)?.[1] ?? "";
    const rows: string[][] = [];
    for (const row of tbody.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/giu) ?? []) {
      rows.push(
        [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/giu)].map((cell) =>
          textContent(cell[1] ?? ""),
        ),
      );
    }
    return { headers, rows };
  }
  throw new Error(`TT table caption naming ${TRACE_FILE_NAME} not found`);
}

type UtteranceRow = {
  turn: string;
  addressedActor: string;
  tag: string;
  match: string;
  modality: string;
};

function recomputedUtteranceRows(): UtteranceRow[] {
  const trace = JSON.parse(readFileSync(TRACE_PATH, "utf8")) as TraceFile;
  const events = Array.isArray(trace.events) ? trace.events : [];
  const rows: UtteranceRow[] = [];
  let ordinal = 0;
  for (const event of events) {
    if (typeof event !== "object" || event === null) {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record["kind"] !== "utterance-end") {
      continue;
    }
    ordinal += 1;
    const outcome = classifyMn1Event(event);
    if (outcome === null) {
      throw new Error("utterance-end event classified as a non-turn");
    }
    const actorId = record["actorId"];
    const tag = record["tag"];
    const modality = record["modality"];
    if (typeof actorId !== "string" || typeof tag !== "string" || typeof modality !== "string") {
      throw new Error(
        `utterance-end event has non-string cells: ${JSON.stringify(event).slice(0, 160)}`,
      );
    }
    rows.push({ turn: String(ordinal), addressedActor: actorId, tag, match: outcome, modality });
  }
  return rows;
}

it("headers: the TT table headers are exactly [turn, addressed actor, tag, match, modality] in order", () => {
  expect(ttTableByCaption(readFileSync(PAGE_PATH, "utf8")).headers).toEqual(TT_HEADERS);
});

it("columns: every TT cell equals the trace field at its header index", () => {
  const table = ttTableByCaption(readFileSync(PAGE_PATH, "utf8"));
  const indexOf = (header: string): number => {
    const index = table.headers.indexOf(header);
    if (index < 0) {
      throw new Error(`TT header missing: ${header}`);
    }
    return index;
  };
  const expected = recomputedUtteranceRows();
  expect(table.rows.length).toBe(expected.length);
  expect(expected.length).toBe(readMn1N());
  for (let row = 0; row < expected.length; row += 1) {
    const cells = table.rows[row] ?? [];
    const want = expected[row];
    if (want === undefined) {
      throw new Error(`missing recomputed row ${String(row)}`);
    }
    expect(cells[indexOf("turn")] ?? "").toBe(want.turn);
    expect(cells[indexOf("addressed actor")] ?? "").toBe(want.addressedActor);
    expect(cells[indexOf("tag")] ?? "").toBe(want.tag);
    expect(cells[indexOf("match")] ?? "").toBe(want.match);
    expect(cells[indexOf("modality")] ?? "").toBe(want.modality);
  }
});

it("negative: the speaker-header fixture fails the TT header check", () => {
  const fixture = readFileSync(path.join(FIXTURE_DIR, "tt-speaker-header.html"), "utf8");
  expect(() => {
    expect(ttTableByCaption(fixture).headers).toEqual(TT_HEADERS);
  }).toThrow();
});
