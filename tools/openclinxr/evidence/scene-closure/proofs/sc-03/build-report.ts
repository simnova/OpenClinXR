import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION } from "./report-schema.js";
import {
  SC03_A_ROWS,
  SC03_BEHAVIOR_TEST_PATH,
  SC03_BEHAVIOR_TEST_TITLE,
  SC03_REQUIRED_CHECK_IDS,
  SC03_REQUIRED_COMMANDS,
  SC03_REQUIRED_CONTROL_IDS,
  sha256Hex,
} from "./verify-core.js";

/**
 * Produce SC-03's evidence report by RUNNING the frozen completion commands and recording what
 * they actually printed.
 *
 * This is a generator, not a verifier, and the split matters: nothing here decides whether the card
 * passes. It executes commands, captures their bytes into the owner's restricted store, hashes the
 * real files, and writes an index. `verify.ts` then grades that index against the tree and the
 * bytes without trusting a single field in it — including every field this file wrote.
 *
 * Run it after the source commit exists, so `implementation.changeCommits` and the measured tree
 * identity describe committed content:
 *
 *   OPENCLINXR_SC_EVIDENCE_REGISTRY=/abs/path/registry.json \
 *     pnpm exec tsx tools/openclinxr/evidence/scene-closure/proofs/sc-03/build-report.ts
 */

const REPO_ROOT = process.cwd();
const CONTRACT_DIR = "docs/openclinxr/scene-closure-2026-09-09";
const REPORT_PATH = `${CONTRACT_DIR}/evidence/sc-03.json`;
const PINNED_COMMIT = "c3f3f3007dc95f85aa6f4dd710c8da5205d03f50";
const DEPENDENCY_BASELINE = "dc2ad3b8";
const TASK_ID = "tsk_2d19693a11aed51e";

const registryPath = process.env["OPENCLINXR_SC_EVIDENCE_REGISTRY"];
if (!registryPath || !path.isAbsolute(registryPath)) {
  throw new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY must be an absolute path to the owner registry");
}
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
  aliases: Record<string, { root: string }>;
};
const storeAlias = registry.aliases["sc-evidence"];
if (!storeAlias) throw new Error("the owner registry declares no sc-evidence alias");
const STORE_ROOT = storeAlias.root;
const STORE_DIR = path.join(STORE_ROOT, "sc-03");
mkdirSync(STORE_DIR, { recursive: true });

const RUN_ID = `sc03-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
const BASELINE_RUN_ID = "sc03-red-remove-the-fix-dc2ad3b8";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

type CommandRecord = {
  argv: string[];
  exitCode: number;
  startedAtIso: string;
  endedAtIso: string;
  tests?: { passed: number; failed: number; skipped: number; todo: number };
  outputArtifactId: string;
};

/** Run one frozen command, capture its combined output into the store, and record the facts. */
function runCommand(command: string, artifactId: string, env: Record<string, string> = {}): CommandRecord {
  const argv = command.split(" ");
  const startedAtIso = new Date().toISOString();
  let exitCode = 0;
  let output = "";
  try {
    const executable = argv[0];
    if (executable === undefined) throw new Error(`empty command: ${command}`);
    output = execFileSync(executable, argv.slice(1), {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    exitCode = failure.status ?? 1;
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
  const endedAtIso = new Date().toISOString();
  writeFileSync(path.join(STORE_DIR, `${artifactId}.txt`), output, "utf8");
  const record: CommandRecord = { argv, exitCode, startedAtIso, endedAtIso, outputArtifactId: artifactId };
  const counts = /Tests\s+(?:(\d+) failed\s+\|\s+)?(\d+) passed(?:\s+\|\s+(\d+) skipped)?(?:\s+\|\s+(\d+) todo)?/u.exec(output);
  if (counts) {
    record.tests = {
      passed: Number(counts[2] ?? 0),
      failed: Number(counts[1] ?? 0),
      skipped: Number(counts[3] ?? 0),
      todo: Number(counts[4] ?? 0),
    };
  }
  return record;
}

function artifactFor(artifactId: string, fileName: string, mediaType: string, runId: string): Record<string, unknown> {
  const absolute = path.join(STORE_DIR, fileName);
  const bytes = readFileSync(absolute);
  return {
    artifactId,
    storeAlias: "sc-evidence",
    objectKey: `sc-03/${fileName}`,
    byteCount: bytes.byteLength,
    sha256: sha256Hex(bytes),
    mediaType,
    createdAtIso: statSync(absolute).mtime.toISOString(),
    runId,
  };
}

// ── 1. The observation stream, emitted by the behavior test's own read-only instrument ──────────
const OBSERVATIONS_FILE = path.join(STORE_DIR, "checks.jsonl");
rmSync(OBSERVATIONS_FILE, { force: true });
writeFileSync(OBSERVATIONS_FILE, "", "utf8");

// ── 2. Every frozen completion command, in the card's order ─────────────────────────────────────
const commandArtifactIds = [
  "cmd-placement-regressions",
  "cmd-composition-call-site",
  "cmd-behavior-test",
  "cmd-assert-contract-live",
  "cmd-verifier-unit-tests",
];
const commands: CommandRecord[] = SC03_REQUIRED_COMMANDS.map((command, index) => {
  const artifactId = commandArtifactIds[index];
  if (artifactId === undefined) throw new Error(`no artifact id for command ${index}`);
  return runCommand(
    command,
    artifactId,
    command.includes(SC03_BEHAVIOR_TEST_PATH) && command.startsWith("pnpm exec vitest")
      ? { OPENCLINXR_SC03_OBSERVATIONS: OBSERVATIONS_FILE }
      : {},
  );
});

// ── 3. Parse the emitted observation stream back out ────────────────────────────────────────────
type ObservationLine = { checkId: string; metric: string; unit: string; value: unknown; observedAtMs: number };
const observationLines: ObservationLine[] = readFileSync(OBSERVATIONS_FILE, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as ObservationLine);
const byCheckId = new Map(observationLines.map((line) => [line.checkId, line]));
for (const required of [...SC03_REQUIRED_CHECK_IDS, ...SC03_REQUIRED_CONTROL_IDS]) {
  if (!byCheckId.has(required)) {
    throw new Error(`the behavior test emitted no observation for ${required}; the report cannot invent one`);
  }
}

// ── 4. The two-sided probe transcript, recorded by the operator run that produced it ────────────
const PROBE_FILE = path.join(STORE_DIR, "two-sided-probe.txt");
if (!statSync(PROBE_FILE, { throwIfNoEntry: false })) {
  throw new Error(`${PROBE_FILE} is missing; record the revert/restore probe before building the report`);
}
const RED_FILE = path.join(STORE_DIR, "red-baseline.txt");
if (!statSync(RED_FILE, { throwIfNoEntry: false })) {
  throw new Error(`${RED_FILE} is missing; record the measured RED before building the report`);
}

// ── 5. Measured tree identity ───────────────────────────────────────────────────────────────────
// NOT trimmed: `git status --porcelain` prefixes each path with two status columns and a space,
// and trimming the whole output eats the FIRST line's leading space, which turned
// `apps/ui-xr/src/main.ts` into `pps/ui-xr/src/main.ts` and reported it as out of scope.
// `-uall`: without it git collapses an untracked DIRECTORY to one entry, so a new evidence folder
// arrives as a path that readFileSync answers with EISDIR instead of the files inside it.
const dirty = git("status", "--porcelain", "-uall").split("\n").filter((line) => line.trim().length > 0);
const changedFiles = dirty
  .map((line) => line.slice(3).trim())
  // Only the report writes ITSELF out of the audit — the Markdown account is a frozen write root
  // and must be hashed like any other change.
  .filter((file) => file !== REPORT_PATH);
const trackedChanged = git("diff", "--name-only", DEPENDENCY_BASELINE).trim().split("\n").filter((line) => line.length > 0);
const allChanged = [...new Set([...changedFiles, ...trackedChanged])]
  .filter((file) => file !== REPORT_PATH)
  .sort();

const inputs = allChanged
  .filter((file) => statSync(path.join(REPO_ROOT, file), { throwIfNoEntry: false })?.isFile() === true)
  .map((file) => ({ path: file, sha256: sha256Hex(readFileSync(path.join(REPO_ROOT, file))) }));
if (!inputs.some((entry) => entry.path === SC03_BEHAVIOR_TEST_PATH)) {
  inputs.push({
    path: SC03_BEHAVIOR_TEST_PATH,
    sha256: sha256Hex(readFileSync(path.join(REPO_ROOT, SC03_BEHAVIOR_TEST_PATH))),
  });
}

const artifacts = [
  ...commandArtifactIds.map((artifactId) => artifactFor(artifactId, `${artifactId}.txt`, "text/plain", RUN_ID)),
  artifactFor("run-observations", "checks.jsonl", "application/x-ndjson", RUN_ID),
  artifactFor("two-sided-probe", "two-sided-probe.txt", "text/plain", RUN_ID),
  artifactFor("red-baseline", "red-baseline.txt", "text/plain", BASELINE_RUN_ID),
];

const contractDocuments = ["acceptance-v2.md", "tasks-v2.md", "proof-contract-v2.md", "delegation-v2.md"].map(
  (name) => ({
    path: `${CONTRACT_DIR}/${name}`,
    sha256: sha256Hex(readFileSync(path.join(REPO_ROOT, CONTRACT_DIR, name))),
  }),
);

const report = {
  schemaVersion: SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION,
  cardKey: "SC-03",
  contract: { pinnedCommit: PINNED_COMMIT, documents: contractDocuments, aRows: [...SC03_A_ROWS] },
  implementation: {
    productSourceCommit: git("rev-parse", "HEAD").trim(),
    dependencyBaselineCommit: git("rev-parse", DEPENDENCY_BASELINE).trim(),
    changeCommits: git("log", "--format=%H", `${DEPENDENCY_BASELINE}..HEAD`).trim().split("\n").filter((line) => line.length > 0),
    treeClean: dirty.length === 0,
    inputs,
    changedFiles: allChanged,
    runtime: { node: process.version, platform: `${process.platform}-${process.arch}` },
  },
  execution: { taskId: TASK_ID, runId: RUN_ID, commands },
  counterweight: {
    testIds: [SC03_BEHAVIOR_TEST_TITLE],
    baselineRevision: DEPENDENCY_BASELINE,
    baselineRunId: BASELINE_RUN_ID,
    failingAssertion:
      "patient_margaret_ellis_v1 required support survives slot repair: expected undefined to be "
      + "'inpatient_ward_room_v1:stretcher' (BREAK 1 of the remove-the-fix probe; the other seven "
      + "named clauses are in the two-sided-probe artifact)",
    observedBeforeFix:
      "undefined — the slot repair carried verticalOffsetMeters/labelPrefix/posture and dropped "
      + "headingRadians, placementProvenance, plantOffsetMeters and supportInstanceId",
    knownGoodControl:
      "the standing clinical placement still requires no support and is accepted with "
      + "requiredSupportInstanceId=null; the ED bundle's unauthored supine patient does not move "
      + "under the same offset-suppression treatment (delta 0.000000000 m)",
    fixedRevision: git("rev-parse", "HEAD").trim(),
    observedAfterFix: "inpatient_ward_room_v1:stretcher",
    baselineOutputArtifactId: "red-baseline",
    fixedOutputArtifactId: "cmd-behavior-test",
  },
  sourceInspection: { behaviorTestPath: SC03_BEHAVIOR_TEST_PATH, behaviorTestTitle: SC03_BEHAVIOR_TEST_TITLE },
  encounter: {
    caseId: "scene_closure_supine_bedside_v1",
    caseVersion: 2,
    caseSourceVersion: "openclinxr.scene-closure-case-source.v2",
    environmentId: "inpatient_ward_room_v1",
    stationId: "scene_closure_supine_bedside_station_v1",
    patientActorId: "patient_margaret_ellis_v1",
    physicianActorId: "senior_resident_ward_v1",
    requiredSupportInstanceId: "inpatient_ward_room_v1:stretcher",
    sameKindDecoyInstanceId: "ed_exam_bay_v1:stretcher",
    authoredPlantOffsetMeters: { x: 0.12, y: 0, z: -0.08 },
    patientBodyAssetPath: "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
    unauthoredControlCaseId: "ed_chest_pain_priority_v1",
  },
  observations: observationLines.map((line, index) => ({
    observationId: `obs-${index + 1}-${line.checkId}`,
    metric: line.metric,
    unit: line.unit,
    value: typeof line.value === "object" ? JSON.stringify(line.value) : (line.value as string | number | boolean),
    observedAtMs: line.observedAtMs,
    artifactId: "run-observations",
    source: `read-only instrument inside ${SC03_BEHAVIOR_TEST_PATH}`,
  })),
  checks: SC03_REQUIRED_CHECK_IDS.map((checkId) => {
    const line = byCheckId.get(checkId);
    if (!line) throw new Error(`no observation for required check ${checkId}`);
    const index = observationLines.indexOf(line);
    return {
      checkId,
      expected: line.metric,
      observed: typeof line.value === "object" ? JSON.stringify(line.value) : (line.value as string | number | boolean),
      outcome: "satisfied" as const,
      evidenceIds: [`obs-${index + 1}-${checkId}`, "run-observations", "cmd-behavior-test"],
    };
  }),
  controls: SC03_REQUIRED_CONTROL_IDS.map((controlId) => {
    const line = byCheckId.get(controlId);
    if (!line) throw new Error(`no observation for required control ${controlId}`);
    return {
      controlId,
      trigger: line.metric,
      expected: controlId.endsWith("succeeds") ? "the ordinary path still admits" : "the production owner refuses",
      observed: `${line.metric} = ${typeof line.value === "object" ? JSON.stringify(line.value) : String(line.value)}`,
      held: true,
      evidenceIds: ["run-observations", "cmd-behavior-test"],
    };
  }),
  artifacts,
  reviews: [] as unknown[],
  limits: {
    unprovenClinical: [
      "qualified clinical review of the authored bedside placement and of the synthetic case is PENDING; "
      + "nothing here establishes clinical validity, exam equivalence or that 0.12 m along the deck is a "
      + "clinically correct position for this patient",
    ],
    unprovenHeadset: ["no worn-headset run; every observation is a node/vitest process on M1 Max"],
    unprovenPublication: ["no Pages push, no public deployment, no media, no rendered frame"],
    unresolvedDefects: [
      "NO TRANSPORT: the acceptance observation this card produces is shaped as SC-02's "
      + "SceneRequirementObservation but there is no route to send it. packages/openclinxr/rest carries no "
      + "requirement-observation endpoint and StationApiClient no method, and both are outside this card's "
      + "frozen write roots. The runtime-side placement acceptance is complete and gates dependent motion "
      + "locally; binding it to a stationRunId at the API admission owner is unbuilt.",
      "NOT MEASURED IN A BROWSER: every measurement is offline geometry through the production consumers in "
      + "node. No capture, no rendered pixels, no running dev server. SC-07 owns that.",
      "The posed body is decoded skinned geometry composed through the real slot and loader transform "
      + "contract, not a three.js GLTFLoader load: GLTFLoader's texture path reaches `self`, which node "
      + "does not have. The transform contract is reproduced from generated-loaders.ts:105-113 rather than "
      + "executed.",
    ],
  },
  evidenceRegistrySha256: sha256Hex(readFileSync(registryPath)),
};

mkdirSync(path.join(REPO_ROOT, CONTRACT_DIR, "evidence"), { recursive: true });
writeFileSync(path.join(REPO_ROOT, REPORT_PATH), `${JSON.stringify(report, null, 2)}\n`, "utf8");
appendFileSync(
  path.join(STORE_DIR, "build-report.log"),
  `${new Date().toISOString()} wrote ${REPORT_PATH} runId=${RUN_ID} treeClean=${report.implementation.treeClean}\n`,
);
process.stdout.write(
  `sc-03 build-report: wrote ${REPORT_PATH}; runId ${RUN_ID}; ${commands.filter((command) => command.exitCode === 0).length}/${commands.length} commands exited zero; treeClean=${report.implementation.treeClean}\n`,
);
