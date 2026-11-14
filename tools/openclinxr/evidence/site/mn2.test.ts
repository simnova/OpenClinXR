import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  compareMn2Traces,
  extractSourceShaMatches,
  type Mn2Extract,
  readMn2Extract,
  recomputeMn2FromTraceDir,
  sha256OfFile,
} from "./fixtures/mn2/recompute.js";

const TRACE_DIR = path.join(process.cwd(), "docs", "site", "data", "rr1-trace");
const MN2_PATH = path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "fixtures", "mn2", "mn2.json");
const EXTRACT_PATH = path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "fixtures", "mn2", "mn2-dom-captions.json");
const EXTRACT_SCRIPT = path.join(process.cwd(), "tools", "openclinxr", "evidence", "site", "capture", "mn2-extract.mjs");
// run-15 source: store site-reimagine/rr1/run-15/dom-text-log.json (machine-local capture store, not committed)
const STORE_DOM_LOG = "/Volumes/files/openclinxr-assets/store/site-reimagine/rr1/run-15/dom-text-log.json";

const ATTRIBUTABLE_CAPTION =
  "Robert Hayes: It started on the stairs, a heavy pressure right in the middle of my chest.";
const PRESEEDED_CAPTION = "Robert Hayes: It feels heavy, like someone is sitting on my chest.";

type Mn2File = {
  metric?: unknown;
  run?: unknown;
  N?: unknown;
  matched?: unknown;
  notAttributable?: unknown;
  turns?: unknown;
  sources?: unknown;
  labels?: unknown;
};

function readMn2(): Mn2File {
  return JSON.parse(readFileSync(MN2_PATH, "utf8")) as Mn2File;
}

function parseCommittedTrace(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(TRACE_DIR, name), "utf8")) as Record<string, unknown>;
}

function committedTraces(): { name: string; trace: unknown }[] {
  return ["CBB5_UB-J.conversation-trace.json", "O4z72Ca-8.conversation-trace.json", "5JNYwgcSl.conversation-trace.json"].map(
    (name) => ({ name, trace: parseCommittedTrace(name) }),
  );
}

it("known-good (N=1): recomputed captions equal the extract for every attributable caption; counts equal mn2.json", () => {
  const extract = readMn2Extract(EXTRACT_PATH);
  const { N, matched, notAttributable, perTurn } = recomputeMn2FromTraceDir(TRACE_DIR, extract);
  // run-15: one attributable caption (the onset answer, first displayed at sample 32).
  expect(N).toBe(1);
  expect(matched).toBe(1);
  expect(notAttributable).toEqual({ count: 1, captions: [PRESEEDED_CAPTION] });
  const matchedTurns = perTurn.filter((entry) => entry.status === "matched");
  expect(matchedTurns.map((entry) => entry.caption)).toEqual([ATTRIBUTABLE_CAPTION]);
  const file = readMn2();
  expect(file.metric).toBe("captions the learner's client displayed match captions recomputed from the trace");
  expect(file.run).toBe("run-15");
  expect(file.N).toBe(N);
  expect(file.matched).toBe(matched);
  expect(file.notAttributable).toEqual({ count: 1, captions: [PRESEEDED_CAPTION] });
  // sources[] sha256 equals the committed file bytes (traces + extract).
  const sources = file.sources;
  if (!Array.isArray(sources) || sources.length !== 4) {
    throw new Error(`expected 4 sources, got ${JSON.stringify(sources)?.length}`);
  }
  for (const entry of sources) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`malformed sources entry: ${JSON.stringify(entry)}`);
    }
    const { path: rel, sha256, storeOrigin } = entry as Record<string, unknown>;
    if (typeof rel !== "string" || typeof sha256 !== "string" || typeof storeOrigin !== "string") {
      throw new Error(`malformed sources entry: ${JSON.stringify(entry)}`);
    }
    // run-15 source: every mn2.json sources[].storeOrigin sits under site-reimagine/rr1/run-15/
    if (!storeOrigin.startsWith("site-reimagine/rr1/run-15/")) {
      throw new Error(`sources entry missing run-15 storeOrigin: ${JSON.stringify(entry)}`);
    }
    expect(sha256OfFile(path.join(process.cwd(), rel))).toBe(sha256);
  }
});

it("counterweight (N=1): one extract caption altered in memory -> matched == N-1, substitution printed", () => {
  const extract = readMn2Extract(EXTRACT_PATH) as unknown as {
    captions: { speaker: string; text: string; attributable: boolean }[];
  };
  const target = extract.captions.find((caption) => caption.attributable === true);
  if (target === undefined) {
    throw new Error("extract has no attributable caption to alter");
  }
  const before = target.text;
  target.text = `${before} (altered)`;
  console.log(`mn2 counterweight substitution: extract caption ${JSON.stringify(before)} -> ${JSON.stringify(target.text)}; traces untouched`);
  // run-15 source: store site-reimagine/rr1/run-15/dom-text-log.json altered only in memory; the committed extract file is untouched
  const { N, matched, perTurn } = compareMn2Traces(committedTraces(), extract as unknown as Mn2Extract);
  expect(N).toBe(1);
  expect(matched).toBe(0);
  expect(perTurn.filter((entry) => entry.status === "matched")).toEqual([]);
  expect(perTurn.find((entry) => entry.replyId === "patient_robert_hayes_v1:seed:patient_onset_history")?.status).toBe("unmatched");
});

it("counterweight store sha (N=1): extract source sha256 refused on mismatch, skipped with reason when the store path is absent", () => {
  const extract = readMn2Extract(EXTRACT_PATH);
  if (!existsSync(STORE_DOM_LOG)) {
    console.log(`mn2 store skip: ${STORE_DOM_LOG} absent on this machine; the committed extract source sha256 is unverified here`);
    return;
  }
  const storeBytes = readFileSync(STORE_DOM_LOG);
  expect(extractSourceShaMatches(extract, storeBytes)).toBe(true);
  // A flipped byte is refused: the recorded source sha no longer matches.
  const tampered = Buffer.concat([storeBytes.subarray(0, storeBytes.length - 1), Buffer.from([storeBytes[storeBytes.length - 1]! ^ 0x01])]);
  expect(extractSourceShaMatches(extract, tampered)).toBe(false);
});

it("counterweight unknown event kind (N=1): not-replayable, counted", () => {
  // run-15 source: store site-reimagine/rr1/run-15/trace/CBB5_UB-J.conversation-trace.json (station-1 trace, the only committed file with turns)
  const trace = parseCommittedTrace("CBB5_UB-J.conversation-trace.json");
  const events = trace["events"];
  if (!Array.isArray(events)) {
    throw new Error("fixture has no events");
  }
  events.push({ seq: null, kind: "frobnicate", actorId: "", turnId: null });
  const extract = readMn2Extract(EXTRACT_PATH);
  const clean = parseCommittedTrace("O4z72Ca-8.conversation-trace.json");
  const { N, matched, perTurn } = compareMn2Traces(
    [
      { name: "tampered.conversation-trace.json", trace },
      { name: "O4z72Ca-8.conversation-trace.json", trace: clean },
    ],
    extract,
  );
  expect(N).toBe(1);
  expect(matched).toBe(0);
  // Not silently skipped: the refused trace is reported per trace and excluded from matched.
  const refused = perTurn.filter((entry) => entry.status === "not-replayable");
  expect(refused).toHaveLength(1);
  expect(refused[0]?.trace).toBe("tampered.conversation-trace.json");
  expect(refused[0]?.detail ?? "").toMatch(/unknown conversation trace event kind/);
});

it("extract derivation (N=1): mn2-extract on a synthetic 3-sample log flags the pre-seeded line false and the later line true", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mn2-extract-"));
  const domPath = path.join(dir, "dom-text-log.json");
  const outPath = path.join(dir, "mn2-dom-captions.json");
  writeFileSync(
    domPath,
    JSON.stringify([
      { atMs: 1, innerText: "Mock Dialogue\n\nRobert Hayes: It feels heavy, like someone is sitting on my chest." },
      { atMs: 2, innerText: "Encounter\n10 s left" },
      { atMs: 3, innerText: "Robert Hayes: It started on the stairs, a heavy pressure right in the middle of my chest." },
    ]),
    "utf8",
  );
  execFileSync(process.execPath, [EXTRACT_SCRIPT, "--dom", domPath, "--out", outPath], { stdio: "pipe" });
  const doc = JSON.parse(readFileSync(outPath, "utf8")) as {
    sampleCount: unknown;
    captions: { speaker: string; text: string; firstSample: number; firstAtMs: number; attributable: boolean }[];
  };
  expect(doc.sampleCount).toBe(3);
  expect(doc.captions).toEqual([
    {
      speaker: "Robert Hayes",
      text: "It feels heavy, like someone is sitting on my chest.",
      firstSample: 0,
      firstAtMs: 1,
      attributable: false,
    },
    {
      speaker: "Robert Hayes",
      text: "It started on the stairs, a heavy pressure right in the middle of my chest.",
      firstSample: 2,
      firstAtMs: 3,
      attributable: true,
    },
  ]);
});
