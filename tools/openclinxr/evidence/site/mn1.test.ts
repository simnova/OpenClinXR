import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import {
  recomputeMn1FromTraceDir,
  recomputeMn1FromTraces,
  sha256OfFile,
} from "./fixtures/mn1/recompute.js";

const TRACE_DIR = path.join(process.cwd(), "docs", "site", "data", "rr1-trace");
const MN1_PATH = path.join(process.cwd(), "docs", "site", "data", "mn1.json");

type Mn1File = {
  metric?: unknown;
  counts?: unknown;
  sources?: unknown;
  labels?: unknown;
};

function readMn1(): Mn1File {
  return JSON.parse(readFileSync(MN1_PATH, "utf8")) as Mn1File;
}

function readCounts(): Record<string, unknown> {
  const file = readMn1();
  if (typeof file.counts !== "object" || file.counts === null) {
    throw new Error("mn1.json counts must be an object");
  }
  return file.counts as Record<string, unknown>;
}

function readSources(): Record<string, unknown>[] {
  const file = readMn1();
  if (!Array.isArray(file.sources)) {
    throw new Error("mn1.json sources must be an array");
  }
  const out: Record<string, unknown>[] = [];
  for (const entry of file.sources) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("mn1.json sources entries must be objects");
    }
    out.push(entry as Record<string, unknown>);
  }
  return out;
}

function readLabels(): Record<string, unknown> {
  const file = readMn1();
  if (typeof file.labels !== "object" || file.labels === null) {
    throw new Error("mn1.json labels must be an object");
  }
  return file.labels as Record<string, unknown>;
}

it("known-good: counts recomputed from docs/site/data/rr1-trace/* equal mn1.json", () => {
  const { counts, perFile } = recomputeMn1FromTraceDir(TRACE_DIR);
  // run-15 source: store site-reimagine/rr1/run-15/trace/CBB5_UB-J.conversation-trace.json (station-1 trace, 2 utterance-end exact/history_opqrst)
  expect(perFile["CBB5_UB-J.conversation-trace.json"]).toEqual({
    matched: 2,
    unmatched: 0,
    "please-repeat": 0,
    N: 2,
  });
  // run-15 source: store site-reimagine/rr1/run-15/trace/O4z72Ca-8.conversation-trace.json (station-2 trace, 0 utterance-end)
  expect(perFile["O4z72Ca-8.conversation-trace.json"]).toEqual({
    matched: 0,
    unmatched: 0,
    "please-repeat": 0,
    N: 0,
  });
  // run-15 source: store site-reimagine/rr1/run-15/trace/5JNYwgcSl.conversation-trace.json (station-3 trace, 0 utterance-end)
  expect(perFile["5JNYwgcSl.conversation-trace.json"]).toEqual({
    matched: 0,
    unmatched: 0,
    "please-repeat": 0,
    N: 0,
  });
  expect(counts).toEqual({ matched: 2, unmatched: 0, "please-repeat": 0, N: 2 });
  expect(readCounts()).toEqual({ matched: 2, unmatched: 0, "please-repeat": 0, N: 2 });
});

it("counterweight: mn1.json carries single speaker, single run, scripted, voice labels and no count absent from the recompute", () => {
  const labels = readLabels();
  const scope = typeof labels["scope"] === "string" ? labels["scope"] : "";
  const voice = typeof labels["voice"] === "string" ? labels["voice"] : "";
  for (const required of ["single speaker", "single run", "scripted", "not a rate"]) {
    if (!scope.includes(required)) {
      throw new Error(`mn1.json labels.scope is missing ${required}: ${scope}`);
    }
  }
  if (!voice.includes("Learner voice: synthetic (injected)")) {
    throw new Error(`mn1.json labels.voice is missing the PLAN section 1 voice label: ${voice}`);
  }
  const counts = readCounts();
  for (const key of Object.keys(counts)) {
    if (key !== "matched" && key !== "unmatched" && key !== "please-repeat" && key !== "N") {
      throw new Error(`mn1.json holds a count absent from the recompute: ${key}`);
    }
  }
});

it("negative: a fixture copy with one actor turn removed reports a count mismatch", () => {
  const trace = JSON.parse(
  // run-15 source: store site-reimagine/rr1/run-15/trace/CBB5_UB-J.conversation-trace.json (station-1 trace, chosen because it holds the utterance-end events)
    readFileSync(path.join(TRACE_DIR, "CBB5_UB-J.conversation-trace.json"), "utf8"),
  ) as { events?: unknown };
  const events = Array.isArray(trace.events) ? [...trace.events] : [];
  const endIndex = events.findIndex(
    (event) => typeof event === "object" && event !== null && (event as { kind?: unknown }).kind === "utterance-end",
  );
  if (endIndex < 0) {
    throw new Error("fixture has no utterance-end to remove");
  }
  events.splice(endIndex, 1);
  const reduced = recomputeMn1FromTraces([{ events }]);
  expect(reduced.N).toBe(1);
  expect(reduced).not.toEqual(readCounts());
});

it("sources integrity: each sources[] sha256 equals the committed file bytes", () => {
  const sources = readSources();
  if (sources.length !== 4) {
    throw new Error(`expected 4 sources, got ${sources.length}`);
  }
  for (const entry of sources) {
    const rel = entry["path"];
    const sha = entry["sha256"];
    const origin = entry["storeOrigin"];
    if (typeof rel !== "string" || typeof sha !== "string" || typeof origin !== "string") {
      throw new Error(`malformed sources entry: ${JSON.stringify(entry)}`);
    }
    // run-15 source: docs/site/data/mn1.json sources[].storeOrigin prefix site-reimagine/rr1/run-15/trace/ (4 committed run-15 trace files)
    if (!origin.startsWith("site-reimagine/rr1/run-15/trace/")) {
      throw new Error(`sources entry missing storeOrigin: ${JSON.stringify(entry)}`);
    }
    const actual = sha256OfFile(path.join(process.cwd(), rel));
    expect(actual).toBe(sha);
  }
});
