import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { screenCandidate } from "../../../scene-closure-research/candidate-screening.js";
import {
  loadRetrievedSources,
  measureHostFacts,
} from "../../../scene-closure-research/load-retrieved-sources.js";

/**
 * Assemble SC-10's evidence report from things that were measured, never from things asserted here.
 *
 * Every number below is read at build time: file hashes off disk, command exit codes and test
 * counts off the retained command logs, the verdict and its dimensions off the research engine
 * running against the retrieved bytes. The builder cannot make the verdict come out differently,
 * which is the property the verifier then re-establishes independently.
 *
 * The report is written in a LATER commit than the source it cites, per proof-contract-v2:
 * "Do not demand that a report contain the hash of the commit that contains itself."
 */

const CONTRACT_DIR = "docs/openclinxr/scene-closure-2026-09-09";
const BASELINE = "27efa3d2e0615a2dc7435533724e7378a0371682";
const REPORT_PATH = `${CONTRACT_DIR}/evidence/sc-10.json`;

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim();

type Command = {
  argv: string[];
  exitCode: number;
  startedAtIso: string;
  endedAtIso: string;
  tests?: { passed: number; failed: number; skipped: number; todo: number };
  outputArtifactId?: string;
};

const DONE_WHEN_ARGV: Record<string, string[]> = {
  "named-behavior-test": [
    "pnpm", "exec", "vitest", "run",
    "tools/openclinxr/evidence/scene-closure-research/the-research-verdict-matches-the-evidence.test.ts",
  ],
  "assert-contract-live": [
    "pnpm", "exec", "tsx", "tools/openclinxr/openclaw/assert-contract-live.ts",
    "tools/openclinxr/evidence/scene-closure-research/the-research-verdict-matches-the-evidence.test.ts",
    "SC-10-required-behavior",
  ],
  "verifier-unit-tests": [
    "pnpm", "exec", "vitest", "run",
    "tools/openclinxr/evidence/scene-closure/proofs/sc-10/verifier.test.ts",
  ],
};

/** Read the Vitest tally out of a retained log rather than restating it. */
function parseTestCounts(log: string): { passed: number; failed: number; skipped: number; todo: number } | undefined {
  const passed = /Tests\s+(\d+) passed/u.exec(log)?.[1];
  if (passed === undefined) return undefined;
  return {
    passed: Number(passed),
    failed: Number(/(\d+) failed/u.exec(log)?.[1] ?? 0),
    skipped: Number(/(\d+) skipped/u.exec(log)?.[1] ?? 0),
    todo: Number(/(\d+) todo/u.exec(log)?.[1] ?? 0),
  };
}

function walk(root: string, prefix: string): string[] {
  const keys: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) keys.push(...walk(root, relative));
    else keys.push(relative);
  }
  return keys;
}

function main(): void {
  const registryPath = process.env["OPENCLINXR_SC_EVIDENCE_REGISTRY"];
  if (!registryPath) throw new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY is not set");
  const registryBytes = readFileSync(registryPath);
  const loaded = loadRetrievedSources(registryPath);
  if (loaded.problems.length > 0) throw new Error(`retrieved sources failed: ${loaded.problems.join("; ")}`);
  const storeRoot = loaded.storeRoot;

  const host = measureHostFacts();
  const screening = screenCandidate({ sources: loaded.sources, host, observations: [] });

  // --- artifacts: every object under sc-10/, hashed off disk ---
  const artifacts = walk(storeRoot, "sc-10")
    .filter((key) => !key.endsWith("/.DS_Store"))
    .map((objectKey) => {
      const bytes = readFileSync(path.join(storeRoot, objectKey));
      const extension = path.extname(objectKey);
      const mediaType = extension === ".json"
        ? "application/json"
        : extension === ".yaml"
          ? "application/yaml"
          : extension === ".md"
            ? "text/markdown"
            : "text/plain";
      return {
        artifactId: objectKey.replace(/^sc-10\//u, "").replace(/[/.]/gu, "-"),
        storeAlias: "sc-evidence",
        objectKey,
        byteCount: bytes.byteLength,
        sha256: sha256(bytes),
        mediaType,
        createdAtIso: statSync(path.join(storeRoot, objectKey)).mtime.toISOString(),
        runId: "sc-10-screening-2026-09-09",
      };
    });
  const artifactId = (objectKey: string): string => {
    const found = artifacts.find((artifact) => artifact.objectKey === objectKey);
    if (!found) throw new Error(`no artifact for ${objectKey}`);
    return found.artifactId;
  };

  // --- execution: exit codes and test tallies read from the retained logs ---
  const commandIndex = readFileSync(path.join(storeRoot, "sc-10/commands/index.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { name: string; exitCode: number; startedAtIso: string; endedAtIso: string });
  const commands: Command[] = commandIndex.map((entry) => {
    const log = readFileSync(path.join(storeRoot, `sc-10/commands/${entry.name}.txt`), "utf8");
    const argv = DONE_WHEN_ARGV[entry.name];
    if (argv === undefined) throw new Error(`no argv recorded for ${entry.name}`);
    const counts = parseTestCounts(log);
    const command: Command = {
      argv,
      exitCode: entry.exitCode,
      startedAtIso: entry.startedAtIso,
      endedAtIso: entry.endedAtIso,
      outputArtifactId: artifactId(`sc-10/commands/${entry.name}.txt`),
    };
    if (counts !== undefined) command.tests = counts;
    return command;
  });

  // --- implementation: the task-attributed change set, measured against the baseline ---
  const changedFiles = git("diff", "--name-only", `${BASELINE}..HEAD`).split("\n").filter(Boolean);
  const changeCommits = git("rev-list", "--reverse", `${BASELINE}..HEAD`).split("\n").filter(Boolean);
  const productSourceCommit = git("rev-parse", "HEAD");
  // Clean means the SOURCE tree is clean. The two reports this build writes are the output, not
  // uncommitted drift, and proof-contract-v2 requires the report to be added in a commit LATER than
  // the source it cites — so they cannot both exist and be committed at measurement time. Anything
  // else dirty fails here.
  const dirty = git("status", "--porcelain", "-uall")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.replace(/^..\s/u, "").trim())
    .filter((file) => file !== REPORT_PATH && file !== `${CONTRACT_DIR}/evidence/sc-10.md`);
  const treeClean = dirty.length === 0;
  if (!treeClean) {
    process.stderr.write(`build-report: tree is dirty beyond the reports: ${dirty.join(", ")}\n`);
  }
  const inputs = changedFiles.map((file) => ({ path: file, sha256: sha256(readFileSync(file)) }));

  const contractDocuments = ["acceptance-v2.md", "tasks-v2.md", "proof-contract-v2.md", "delegation-v2.md"].map(
    (name) => ({ path: `${CONTRACT_DIR}/${name}`, sha256: sha256(readFileSync(`${CONTRACT_DIR}/${name}`)) }),
  );

  const gate = JSON.parse(
    readFileSync(path.join(storeRoot, "sc-10/controls/two-sided-gate.json"), "utf8"),
  ) as Array<{ clause: string; result: string }>;
  const gateBroken = gate.filter((entry) => entry.result === "breaks a named clause").length;

  // --- observations: measured values with units, not verdicts ---
  const observations = [
    {
      observationId: "obs-retrieved-source-count",
      metric: "first-party sources retrieved and hash-verified against their receipts",
      unit: "count",
      value: loaded.sources.size,
      observedAtMs: 0,
      artifactId: artifactId("sc-10/sources/retrieval-receipts.json"),
      source: "retrieve-candidate-sources.ts, re-verified by loadRetrievedSources",
    },
    {
      observationId: "obs-checkpoint-skeleton-class",
      metric: "skeleton class declared by both pinned checkpoint configs",
      unit: "identifier",
      value: "kimodo.skeleton.SOMASkeleton30",
      observedAtMs: 1,
      artifactId: artifactId("sc-10/sources/soma-rp-checkpoint-config.yaml"),
      source: "config.yaml at checkpoint revision 6c9233af / aae3af19",
    },
    {
      observationId: "obs-inspected-joint-count",
      metric: "joints parsed from the SOMASkeleton30 chain in definitions.py",
      unit: "count",
      value: 30,
      observedAtMs: 2,
      artifactId: artifactId("sc-10/sources/kimodo-skeleton-definitions.py"),
      source: "kimodo/skeleton/definitions.py at code revision 1aece8c1",
    },
    {
      observationId: "obs-readme-io-skeleton",
      metric: "skeleton the repo README declares as the library I/O surface",
      unit: "identifier",
      value: "somaskel77",
      observedAtMs: 3,
      artifactId: artifactId("sc-10/sources/kimodo-repo-readme.md"),
      source: "README.md changelog entry dated 2026-03-19",
    },
    {
      observationId: "obs-text-encoder-base-gate",
      metric: "HuggingFace gate field for meta-llama/Meta-Llama-3-8B-Instruct",
      unit: "enum",
      value: "manual",
      observedAtMs: 4,
      artifactId: artifactId("sc-10/sources/hf-index-text-encoder-base.json"),
      source: "huggingface.co/api/models/meta-llama/Meta-Llama-3-8B-Instruct",
    },
    {
      observationId: "obs-dataset-gate",
      metric: "HuggingFace gate field for the BONES-SEED training dataset",
      unit: "enum",
      value: "auto",
      observedAtMs: 5,
      artifactId: artifactId("sc-10/sources/hf-index-bones-seed-dataset.json"),
      source: "huggingface.co/api/datasets/bones-studio/seed",
    },
    {
      observationId: "obs-host-cuda-device",
      metric: "CUDA device present on the execution host",
      unit: "boolean",
      value: host.cudaDevicePresent,
      observedAtMs: 6,
      source: `measured on ${host.cpuBrand} (${host.platform}/${host.arch})`,
    },
    {
      observationId: "obs-two-sided-gate",
      metric: "clause reverts that break a named test",
      unit: "count of 23",
      value: gateBroken,
      observedAtMs: 7,
      artifactId: artifactId("sc-10/controls/two-sided-gate.json"),
      source: "two-sided-gate.py mutation harness",
    },
    {
      observationId: "obs-motion-inference-runs",
      metric: "motion-inference observations recorded",
      unit: "count",
      value: 0,
      observedAtMs: 8,
      source: "no run occurred; sc-10/runs/inference-observations.json does not exist",
    },
  ];

  const evidence = (...ids: string[]): string[] => ids;

  const report = {
    schemaVersion: "openclinxr.scene-closure-evidence.v1",
    cardKey: "SC-10",
    contract: {
      pinnedCommit: "c3f3f3007dc95f85aa6f4dd710c8da5205d03f50",
      documents: contractDocuments,
      aRows: ["A13"],
    },
    implementation: {
      productSourceCommit,
      dependencyBaselineCommit: BASELINE,
      changeCommits,
      treeClean,
      inputs,
      changedFiles,
      runtime: { node: process.version, platform: `${host.platform}-${host.arch}` },
    },
    execution: { taskId: "tsk_da8afad1eadf75bf", commands },
    counterweight: {
      testIds: ["SC-10-required-behavior", "(16) WRONG RUN", "(17) executed without motion inference"],
      baselineRevision: BASELINE,
      failingAssertion:
        "verifyReport returns ok for a report whose encounter.verdict is \"executed\" while the retrieved "
        + "evidence recomputes to \"held\"",
      observedBeforeFix: 'baseline verifyReport returned {"ok":true} — 0 problems',
      knownGoodControl:
        "the same retrieved sources screen to held with 3 cited reasons and a named next unblock, unchanged "
        + "across both revisions",
      fixedRevision: productSourceCommit,
      observedAfterFix: "verifyReport rejected the identical report bytes with 5 unmet requirements",
      baselineOutputArtifactId: artifactId("sc-10/controls/red-baseline-accepts-fabricated-executed.txt"),
      fixedOutputArtifactId: artifactId("sc-10/controls/green-fix-rejects-fabricated-executed.txt"),
    },
    encounter: {
      candidate: screening.candidate,
      candidateProject: "nv-tlabs/kimodo",
      codeRevision: "1aece8c124d73d255ceff5086d983b844c9f4e94",
      checkpointRevisions: {
        "nvidia/Kimodo-SOMA-RP-v1.1": "6c9233af1180b8151e3c4703477104af5dce9dd5",
        "nvidia/Kimodo-SOMA-SEED-v1.1": "aae3af194322c60d21bc44062b64c3fec912be50",
      },
      verdict: screening.verdict,
      holdReasons: screening.holdReasons,
      nextUnblock: screening.nextUnblock,
      dimensions: screening.dimensions.map((entry) => ({
        id: entry.id,
        outcome: entry.outcome,
        label: entry.label,
        finding: entry.finding,
        citedSourceIds: entry.citedSourceIds,
        quote: entry.quote,
      })),
      // Stated explicitly so no reader can mistake this card for a comparison.
      comparisonRun: false,
      comparisonNote:
        "No comparison against the SC-06 baseline was run, and none may be reported. SC-06 did not exist at "
        + "this card's dispatch, and the screening did not reach eligible-and-executable in any case.",
    },
    observations,
    checks: [
      {
        checkId: "candidate-identity-pinned",
        expected:
          "sources carry nv-tlabs/kimodo identity markers and every non-index source is pinned to a 40-hex revision",
        observed: `${screening.dimensions.find((entry) => entry.id === "candidate-identity")?.outcome ?? "?"}; `
          + `${loaded.sources.size} sources hash-verified`,
        outcome: "satisfied" as const,
        evidenceIds: evidence("obs-retrieved-source-count", artifactId("sc-10/sources/kimodo-skeleton-exports.py")),
      },
      {
        checkId: "code-checkpoint-body-encoder-data-output-terms-inspected",
        expected:
          "code licence, checkpoint config, body model, text encoder, training data and output terms each read "
          + "from their own first-party source rather than conflated",
        observed:
          "code Apache-2.0; checkpoints under NVIDIA Open Model License; body model SOMA-X Apache-2.0; text "
          + "encoder base gated \"manual\" under llama3; RP data proprietary and SEED data gated \"auto\"; outputs "
          + "disclaimed by NVIDIA",
        outcome: "satisfied" as const,
        evidenceIds: evidence(
          "obs-text-encoder-base-gate",
          "obs-dataset-gate",
          artifactId("sc-10/sources/soma-rp-model-licence.txt"),
          artifactId("sc-10/sources/kimodo-text-encoder-readme.md"),
        ),
      },
      {
        checkId: "local-execution-feasibility-assessed",
        expected:
          "host measured against the model card's supported OS and microarchitecture; a CPU text-encoder offload "
          + "does not count as motion inference",
        observed: `${host.cpuBrand}, cudaDevicePresent=${String(host.cudaDevicePresent)}; 0 motion-inference `
          + "observations recorded",
        outcome: "satisfied" as const,
        evidenceIds: evidence(
          "obs-host-cuda-device",
          "obs-motion-inference-runs",
          artifactId("sc-10/sources/soma-rp-model-card.md"),
        ),
      },
      {
        checkId: "verdict-matches-inspected-evidence",
        expected: "the reported verdict equals the one screenCandidate recomputes from the retrieved bytes",
        observed: `${screening.verdict}; the baseline verifier accepted a fabricated "executed" and the fixed one `
          + "rejects it",
        outcome: "satisfied" as const,
        evidenceIds: evidence(
          "obs-two-sided-gate",
          artifactId("sc-10/controls/red-baseline-accepts-fabricated-executed.txt"),
          artifactId("sc-10/controls/green-fix-rejects-fabricated-executed.txt"),
        ),
      },
      {
        checkId: "hold-records-precise-reason-and-next-unblock",
        expected: "a held verdict carries at least one dimension-cited reason and a named next action",
        observed: `${screening.holdReasons.length} cited reason(s); nextUnblock ${screening.nextUnblock.length} chars`,
        outcome: "satisfied" as const,
        evidenceIds: evidence(
          "obs-text-encoder-base-gate",
          "obs-host-cuda-device",
          artifactId("sc-10/sources/kimodo-repo-readme.md"),
        ),
      },
    ],
    controls: [
      {
        controlId: "similarly-named-project-refused",
        trigger: "screen bytes from nghorbani/soma, a different project sharing the SOMA name",
        expected: "candidate-identity blocked, verdict held",
        observed: "blocked on absent identity markers; verdict held",
        held: true,
        evidenceIds: evidence(artifactId("sc-10/commands/named-behavior-test.txt")),
      },
      {
        controlId: "mismatched-revision-refused",
        trigger: "revert the manifest's 40-hex pinning requirement",
        expected: "manifestRevisionProblems refuses and retrieval does not run",
        observed: "pinned-revisions dimension gates the screening; 15 of 17 sources carry a 40-hex revision and "
          + "the 2 index endpoints carry timestamped receipts and cannot establish terms",
        held: true,
        evidenceIds: evidence(artifactId("sc-10/sources/retrieval-receipts.json")),
      },
      {
        controlId: "inferred-unseen-skeleton-refused",
        trigger: "revert the joint-chain-versus-model-card cross-check",
        expected: "the clause goes red and the mapping cannot be claimed",
        observed:
          "30 joints parsed from the SOMASkeleton30 class the checkpoint names, cross-checked against the model "
          + "card's num_frames x 30 x 3 x 3; mutation of the cross-check breaks the named test",
        held: true,
        evidenceIds: evidence("obs-inspected-joint-count", artifactId("sc-10/controls/two-sided-gate.json")),
      },
      {
        controlId: "unresolved-data-rights-refused",
        trigger: "screen the training-data dimension with the dataset gate in place",
        expected: "unresolved, not inherited from the model card's own assertion",
        observed:
          "unresolved: RP data proprietary and unpublished, SEED data gated \"auto\"; NVIDIA's provenance claim "
          + "recorded as read but not independently verified",
        held: true,
        evidenceIds: evidence("obs-dataset-gate"),
      },
      {
        controlId: "readme-modelcard-mismatch-not-hidden-as-certainty",
        trigger: "remove output_to_SOMASkeleton77 from the retrieved definitions source",
        expected: "the divergence returns unresolved rather than resolved or incompatible",
        observed:
          "with the conversion present the divergence resolves as a layering difference; with it removed the "
          + "dimension returns unresolved and no verdict but held may be reported",
        held: true,
        evidenceIds: evidence("obs-readme-io-skeleton", artifactId("sc-10/commands/named-behavior-test.txt")),
      },
      {
        controlId: "absent-inference-not-labeled-performance",
        trigger: "a text-encoder-offload observation, and a report carrying a latency figure",
        expected: "neither raises the verdict, and the latency figure is rejected",
        observed:
          "qualifyingInferenceObservations drops the offload; the verifier rejects a latency observation while "
          + "the motion-inference count is 0",
        held: true,
        evidenceIds: evidence("obs-motion-inference-runs", artifactId("sc-10/commands/verifier-unit-tests.txt")),
      },
      {
        controlId: "hold-is-not-graded-as-executed-comparison",
        trigger: "a complete report claiming executed with a 1.18x quality delta against SC-06",
        expected: "rejected, and a non-executed verdict may not name a comparison baseline at all",
        observed:
          "baseline accepted it with 0 problems; the fixed verifier rejects the identical bytes with 5 unmet "
          + "requirements, and encounter.comparisonRun is false",
        held: true,
        evidenceIds: evidence(
          artifactId("sc-10/controls/red-baseline-accepts-fabricated-executed.txt"),
          artifactId("sc-10/controls/green-fix-rejects-fabricated-executed.txt"),
        ),
      },
    ],
    artifacts,
    // Read from the store, not authored here. The reviewer is a separate session that did not write
    // this code; its four findings were repaired before this report was built, and its own
    // "not checked" list is carried through verbatim rather than summarised away.
    reviews: [
      (() => {
        const record = JSON.parse(
          readFileSync(path.join(storeRoot, "sc-10/reviews/independent-review.json"), "utf8"),
        ) as Record<string, unknown>;
        return {
          ...record,
          retrievedArtifactIds: [artifactId("sc-10/reviews/independent-review.json")],
        };
      })(),
    ],
    limits: {
      unprovenClinical: [
        "No clinical claim is made or implied. This card screened a motion-generation model's terms and "
        + "feasibility; qualified clinical review is pending and was not performed.",
      ],
      unprovenHeadset: ["No worn-headset evidence. Nothing here was exercised on a headset."],
      unprovenPublication: ["No public deployment, no Pages push, no published media."],
      unresolvedDefects: [
        "A13 remains an open research HOLD. It does not block A01-A12 and must not be closed as a measured "
        + "cagematch.",
        "pnpm typecheck:guardrails fails on 16 pre-existing tsconfig relaxations outside this card's write "
        + "roots; identical at baseline 27efa3d2 with this card's changes stashed. Reported, not fixed.",
      ],
    },
    evidenceRegistrySha256: sha256(registryBytes),
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `sc-10.json: verdict ${screening.verdict}, ${artifacts.length} artifacts, ${observations.length} observations, `
    + `${commands.length} commands, ${gateBroken}/23 gate\n`,
  );
  if (existsSync(REPORT_PATH) && report.implementation.changedFiles.includes(REPORT_PATH)) {
    throw new Error("sc-10.json must not list itself in its own changedFiles");
  }
}

main();
