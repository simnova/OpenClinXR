/**
 * P2b4 — the full-bake sidecar composes from receipts (round 3).
 *
 * Round 3 adds the in-place stage schema (G1/G3): a file the stage mutated
 * in place carries sha256 (bytes BEFORE, the pre value the chain link
 * inputSha256 still uses) plus postSha256 (bytes AFTER, what the on-disk
 * check compares) with mode "inout" (same vocabulary as the P2d runner's
 * --role <flag>=<role>[:in|:out|:inout]); the validator rejects postSha256
 * unless mode is "inout". Stages carry their exact executed argv. The S9
 * fixture stage models this: shared-b.bin has sha256 PRE 7ae1d74c... (a
 * real sha256 of documented illustrative pre bytes, overwritten in place)
 * and postSha256 POST cdf7ddb3... (the on-disk bytes), mode "inout", and
 * S9 carries argv[]; the S7.out/S8.in/S8.out/S9.in chain links are the pre
 * value. G2 re-runs CW-REAL derive after the P2c' rebase: the extracted
 * real flag list now includes --pre-image-file, and the F1 file branch
 * passes with the writer argv a subset plus exactly one pre-image flag.
 *
 * Premise (unchanged): producers take stage ARTIFACT FILES, and a full bake has all of
 * them write-once in its run dir. The writer under test
 * (tools/openclinxr/asset-pipeline/provenance/compose-full-bake-sidecar.ts)
 * resolves those files from stage-log.json by sha256 and runs each
 * producer's existing CLI on them with exactly that producer's declared
 * argv; the chained prov doc flows rebind --prov-out -> derive --sidecar
 * (a scratch copy outside the run dir, edited in place); --out is a byte
 * copy of the final prov. The writer serializes no provenance block itself.
 *
 * Fixture: 3 tiny artifact stages with REAL sha256 (no Blender, no GLB).
 * Fixture byte values are illustrative. The per-stage receipt shape copies
 * the real full-bake log at
 * ~/.grok/worktrees/p2-rebake/.openclinxr/openclaw/ceo/p2-rebake/stage-log.json
 * (keys stage/tool/toolSha256/cmd/inputSha256/outputSha256/exit/status/
 * writePaths/reason, stage ids "S7"/"S8"/"S9"), plus the machine-readable
 * fields a producer needs (files with role+sha256, params, inputPath,
 * provSeed) as the exported type + runtime validator in the writer module,
 * plus G1/G3's postSha256/mode/argv. The committed S9 receipt names a
 * preImageRevision (the revision branch the real derive_sidecar.ts declares
 * alongside --pre-image-file); p9-pre-image.bin stays on disk,
 * unreferenced by the committed log, for the F1/G2 pre-image-file branch tests.
 *
 * Real producers cannot run a full bake here (see the P2b STOP card), so
 * stub producers stand in; producer-command resolution is injectable via
 * --producer-map, and the stubs record their argv to $COMPOSE_STUB_ARGV_LOG.
 * Unlike round 1 the stubs enforce the exact declared argv: rebind-stub
 * refuses any flag outside the rebind argparse block, and derive-stub edits
 * --sidecar in place and refuses --prov-in/--prov-out (which
 * derive_sidecar.ts does not declare). CW-REAL runs the REAL rebind on the
 * fixture and checks the writer's derive argv against the flags the real
 * derive module declares.
 *
 * KNOWN_GOOD: physician shipped full-bake receipts were searched on disk and
 * in git (`git log --all --oneline -- '*physician*stage-log*'
 * '*stage-log*physician*' '*physician*receipt*'` plus find; count 0).
 * Verdict recorded in RESULT: physician receipts absent.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";
import { parseFullBakeReceiptLog } from "../../../../../../tools/openclinxr/asset-pipeline/provenance/compose-full-bake-sidecar.js";

process.chdir(repoRoot());

const execFileAsync = promisify(execFile);
const WRITER = path.resolve(
  "tools/openclinxr/asset-pipeline/provenance/compose-full-bake-sidecar.ts",
);
const REBIND_PY = path.resolve(
  "tools/openclinxr/asset-pipeline/skin/coherent-normal/rebind_baked_skin_normal.py",
);
const DERIVE_TS = path.resolve(
  "tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/derive_sidecar.ts",
);
const FIXTURE = path.resolve(
  "packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/fixtures/full-bake-receipts",
);
const STAGE_LOG = path.join(FIXTURE, "stage-log.json");
const SKIPPED_REASON = "CW3 refusal; subsumed by S1 EYELASH_RESEAT_FOLLOW";

const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

interface RunResult {
  rc: number;
  stdout: string;
  stderr: string;
}

async function runWriter(
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("pnpm", ["exec", "tsx", WRITER, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
    });
    return { rc: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      rc: typeof failure.code === "number" ? failure.code : 1,
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
    };
  }
}

interface HappyFiles {
  dir: string;
  out: string;
  argvLog: string;
}

async function writeProducerMap(dir: string): Promise<string> {
  const mapPath = path.join(dir, "producer-map.json");
  await writeFile(
    mapPath,
    `${JSON.stringify({
      rebind: [path.join(FIXTURE, "stubs", "rebind-stub")],
      repack: [path.join(FIXTURE, "stubs", "repack-stub")],
      derive: [path.join(FIXTURE, "stubs", "derive-stub")],
    }, null, 1)}\n`,
  );
  return mapPath;
}

/** Run the writer on the pristine fixture; caller owns cleanup of dir. */
async function runHappy(): Promise<RunResult & HappyFiles> {
  const dir = await mkdtemp(path.join(tmpdir(), "p2b3-compose-"));
  const out = path.join(dir, "sidecar.json");
  const argvLog = path.join(dir, "argv.log");
  const mapPath = await writeProducerMap(dir);
  const result = await runWriter(
    ["--stage-log", STAGE_LOG, "--run-dir", FIXTURE, "--out", out, "--producer-map", mapPath],
    { COMPOSE_STUB_ARGV_LOG: argvLog },
  );
  return { ...result, dir, out, argvLog };
}

function factLines(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function argvOf(entry: Record<string, unknown>, flag: string): string {
  const argv = entry["argv"] as string[];
  const i = argv.indexOf(flag);
  expect(i, `argv carries ${flag}: ${JSON.stringify(argv)}`).toBeGreaterThanOrEqual(0);
  return argv[i + 1] as string;
}

function argvFlags(argv: string[]): string[] {
  return argv.filter((token) => token.startsWith("--"));
}

/** Real derive flags, read from derive_sidecar.ts itself (never a copied list). */
async function declaredDeriveFlags(): Promise<Set<string>> {
  const source = await readFile(DERIVE_TS, "utf8");
  const declared = new Set<string>();
  for (const match of source.matchAll(/value\(argv,\s*"(--[^"]+)"\)/g)) {
    declared.add(match[1]!);
  }
  for (const match of source.matchAll(/optional\(argv,\s*"(--[^"]+)"\)/g)) {
    declared.add(match[1]!);
  }
  return declared;
}

async function readArgvLog(argvLog: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(argvLog, "utf8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Best-effort removal of the writer's tmp prov-chain dir (named in argv log). */
async function cleanChain(argvLog: string): Promise<void> {
  try {
    const first = (await readFile(argvLog, "utf8"))
      .split("\n")
      .find((line) => line.trim().length > 0);
    if (!first) return;
    const entry = JSON.parse(first) as Record<string, unknown>;
    await rm(path.dirname(argvOf(entry, "--prov-out")), { recursive: true, force: true });
  } catch {
    // best effort only; tmp dirs never fail the test
  }
}

async function tempStageLog(mutator: (log: {
  stages: Array<Record<string, unknown>>;
}) => void): Promise<{ dir: string; logPath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "p2b3-mutlog-"));
  const log = JSON.parse(await readFile(STAGE_LOG, "utf8")) as {
    stages: Array<Record<string, unknown>>;
  };
  mutator(log);
  const logPath = path.join(dir, "stage-log.json");
  await writeFile(logPath, `${JSON.stringify(log, null, 1)}\n`);
  return { dir, logPath };
}

async function snapshotDir(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else out.set(path.relative(dir, abs), sha256(await readFile(abs)));
    }
  }
  await walk(dir);
  return out;
}

describe("the full bake sidecar composes from receipts", () => {
  it("happy path composes the sidecar through stub producers (R1)", async () => {
    const run = await runHappy();
    try {
      expect(run.rc).toBe(0);
      const emitted = JSON.parse(await readFile(run.out, "utf8")) as Record<string, unknown>;
      expect(emitted["rebindSkinB7"]).toBeDefined();
      expect(emitted["teethSwapB1"]).toBeDefined();
    } finally {
      await cleanChain(run.argvLog);
      await rm(run.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW1: chain break refuses naming both shas and leaves --out absent", async () => {
    const before = (
      JSON.parse(await readFile(STAGE_LOG, "utf8")) as {
        stages: Array<Record<string, unknown>>;
      }
    ).stages;
    const prevOut = before[1]!["outputSha256"] as string;
    const goodIn = before[2]!["inputSha256"] as string;
    expect(goodIn).toBe(prevOut);
    const flipped = `${goodIn[0] === "c" ? "d" : "c"}${goodIn.slice(1)}`;
    const { dir, logPath } = await tempStageLog((log) => {
      log.stages[2]!["inputSha256"] = flipped;
    });
    try {
      const out = path.join(dir, "sidecar.json");
      const argvLog = path.join(dir, "argv.log");
      const mapPath = await writeProducerMap(dir);
      const run = await runWriter(
        ["--stage-log", logPath, "--run-dir", FIXTURE, "--out", out, "--producer-map", mapPath],
        { COMPOSE_STUB_ARGV_LOG: argvLog },
      );
      expect(run.rc).not.toBe(0);
      expect(run.stderr).toContain(flipped);
      expect(run.stderr).toContain(prevOut);
      await expect(readFile(out, "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW1b-absent: missing receipt artifact refuses naming path plus both shas", async () => {
    const before = (
      JSON.parse(await readFile(STAGE_LOG, "utf8")) as {
        stages: Array<Record<string, unknown>>;
      }
    ).stages[0]!;
    const { dir, logPath } = await tempStageLog((log) => {
      log.stages[0]!["inputPath"] = "missing-dir/nope.bin";
    });
    try {
      const out = path.join(dir, "sidecar.json");
      const argvLog = path.join(dir, "argv.log");
      const mapPath = await writeProducerMap(dir);
      const run = await runWriter(
        ["--stage-log", logPath, "--run-dir", FIXTURE, "--out", out, "--producer-map", mapPath],
        { COMPOSE_STUB_ARGV_LOG: argvLog },
      );
      expect(run.rc).not.toBe(0);
      expect(run.stderr).toContain("missing-dir/nope.bin");
      expect(run.stderr).toContain(before["inputSha256"] as string);
      expect(run.stderr).toContain(before["outputSha256"] as string);
      await expect(readFile(out, "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW1b-mismatch: wrong file bytes refuse naming path plus both shas", async () => {
    const before = (
      JSON.parse(await readFile(STAGE_LOG, "utf8")) as {
        stages: Array<Record<string, unknown>>;
      }
    ).stages[0]!;
    const goodSha = before["inputSha256"] as string;
    const badSha = `${goodSha[0] === "c" ? "d" : "c"}${goodSha.slice(1)}`;
    const { dir, logPath } = await tempStageLog((log) => {
      log.stages[0]!["inputSha256"] = badSha;
    });
    try {
      const out = path.join(dir, "sidecar.json");
      const argvLog = path.join(dir, "argv.log");
      const mapPath = await writeProducerMap(dir);
      const run = await runWriter(
        ["--stage-log", logPath, "--run-dir", FIXTURE, "--out", out, "--producer-map", mapPath],
        { COMPOSE_STUB_ARGV_LOG: argvLog },
      );
      expect(run.rc).not.toBe(0);
      expect(run.stderr).toContain(before["inputPath"] as string);
      expect(run.stderr).toContain(badSha);
      expect(run.stderr).toContain(goodSha);
      await expect(readFile(out, "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW2: skipped S8 is recorded as a fact, repack never runs, no lash key", async () => {
    const run = await runHappy();
    try {
      expect(run.rc).toBe(0);
      const facts = factLines(run.stdout);
      const skip = facts.find(
        (fact) => fact["stage"] === "S8" && fact["status"] === "skipped",
      );
      expect(skip, `skip fact present: ${run.stdout}`).toBeDefined();
      expect(skip!["reason"]).toBe(SKIPPED_REASON);
      const entries = await readArgvLog(run.argvLog);
      expect(entries.map((entry) => entry["producer"])).toEqual(["rebind", "derive"]);
      const emitted = JSON.parse(await readFile(run.out, "utf8")) as Record<string, unknown>;
      expect(emitted).not.toHaveProperty("lashFollowR8");
    } finally {
      await cleanChain(run.argvLog);
      await rm(run.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW3: emitted file equals the stub chain final prov byte for byte; writer writes --out by copy only", async () => {
    const run = await runHappy();
    try {
      expect(run.rc).toBe(0);
      const entries = await readArgvLog(run.argvLog);
      const deriveEntry = entries[entries.length - 1]!;
      expect(deriveEntry["producer"]).toBe("derive");
      const finalProvOut = argvOf(deriveEntry, "--sidecar");
      const emittedBytes = await readFile(run.out);
      const chainBytes = await readFile(finalProvOut);
      const emittedSha = sha256(emittedBytes);
      const chainSha = sha256(chainBytes);
      // eslint-disable-next-line no-console
      console.log(`CW3 emitted sha256=${emittedSha} chain-final sha256=${chainSha}`);
      expect(emittedSha).toBe(chainSha);
      expect(emittedBytes.equals(chainBytes)).toBe(true);
      const writerSource = await readFile(WRITER, "utf8");
      expect(writerSource).toContain("copyFileSync");
      expect(writerSource.split("writeFileSync").length - 1).toBe(0);
      for (const banned of ["teethSwapB1", "lashFollowR8"]) {
        expect(writerSource.split(banned).length - 1, `writer source holds no ${banned}`).toBe(0);
      }
    } finally {
      await cleanChain(run.argvLog);
      await rm(run.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW4: rebind --prov-in chains from the seed and derive edits a scratch sidecar copy", async () => {
    const run = await runHappy();
    try {
      expect(run.rc).toBe(0);
      const entries = await readArgvLog(run.argvLog);
      expect(entries.length).toBe(2);
      const rebindArgv = entries[0]!["argv"] as string[];
      const deriveArgv = entries[1]!["argv"] as string[];
      expect(argvOf(entries[0]!, "--prov-in")).toBe(path.join(FIXTURE, "prov-seed.json"));
      expect(deriveArgv).not.toContain("--prov-in");
      expect(deriveArgv).not.toContain("--prov-out");
      const sidecarCopy = argvOf(entries[1]!, "--sidecar");
      expect(path.basename(sidecarCopy)).toBe("prov-S9.json");
      expect(path.dirname(sidecarCopy)).toBe(path.dirname(argvOf(entries[0]!, "--prov-out")));
      expect(path.relative(FIXTURE, sidecarCopy).startsWith("..")).toBe(true);
      expect(deriveArgv).toContain("--pre-image-revision");
      expect(deriveArgv).not.toContain("--pre-image-file");
      const sidecarDoc = JSON.parse(await readFile(sidecarCopy, "utf8")) as Record<string, unknown>;
      expect(sidecarDoc["rebindSkinB7"]).toBeDefined();
      expect(sidecarDoc["teethSwapB1"]).toBeDefined();
      expect(
        (sidecarDoc["rebindSkinB7"] as Record<string, unknown>)["srcSha"],
      ).toBe(argvOf(entries[0]!, "--expect-src-sha"));
      expect(rebindArgv).not.toContain("--pre-image-revision");
    } finally {
      await cleanChain(run.argvLog);
      await rm(run.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("F1: a receipt pre-image file selects --pre-image-file alone", async () => {
    const preImageSha = sha256(await readFile(path.join(FIXTURE, "p9-pre-image.bin")));
    const { dir, logPath } = await tempStageLog((log) => {
      const files = log.stages[2]!["files"] as Array<Record<string, unknown>>;
      files.push({ path: "p9-pre-image.bin", sha256: preImageSha, role: "pre-image" });
    });
    try {
      const out = path.join(dir, "sidecar.json");
      const argvLog = path.join(dir, "argv.log");
      const mapPath = await writeProducerMap(dir);
      const run = await runWriter(
        ["--stage-log", logPath, "--run-dir", FIXTURE, "--out", out, "--producer-map", mapPath],
        { COMPOSE_STUB_ARGV_LOG: argvLog },
      );
      expect(run.rc).toBe(0);
      const entries = await readArgvLog(argvLog);
      const deriveArgv = entries[entries.length - 1]!["argv"] as string[];
      expect(argvOf(entries[entries.length - 1]!, "--pre-image-file")).toBe(
        path.join(FIXTURE, "p9-pre-image.bin"),
      );
      expect(deriveArgv).not.toContain("--pre-image-revision");
    } finally {
      try {
        const entries = await readArgvLog(path.join(dir, "argv.log"));
        if (entries.length > 0) {
          await rm(path.dirname(argvOf(entries[0]!, "--prov-out")), {
            recursive: true,
            force: true,
          });
        }
      } catch {
        // best effort only
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("F2: a non-skipped repack stage refuses STOP_producer_not_callable quoting declared flags", async () => {
    const { dir, logPath } = await tempStageLog((log) => {
      delete log.stages[1]!["status"];
      delete log.stages[1]!["reason"];
      log.stages[1]!["exit"] = 0;
      // A live S8 would rewrite shared-b.bin in place: carry the post bytes
      // so the on-disk check passes and the writer reaches the repack refusal.
      const s9files = log.stages[2]!["files"] as Array<Record<string, unknown>>;
      const s9in = s9files.find((f) => f["path"] === "shared-b.bin")!;
      log.stages[1]!["files"] = [
        {
          path: "shared-b.bin",
          sha256: log.stages[1]!["inputSha256"],
          postSha256: s9in["postSha256"],
          role: "input",
          mode: "inout",
        },
      ];
    });
    try {
      const out = path.join(dir, "sidecar.json");
      const argvLog = path.join(dir, "argv.log");
      const mapPath = await writeProducerMap(dir);
      const run = await runWriter(
        ["--stage-log", logPath, "--run-dir", FIXTURE, "--out", out, "--producer-map", mapPath],
        { COMPOSE_STUB_ARGV_LOG: argvLog },
      );
      expect(run.rc).not.toBe(0);
      expect(run.stderr).toContain("STOP_producer_not_callable");
      expect(run.stderr).toContain("repack");
      for (const flag of ["--directory", "--actor", "--source-ref", "--repair-sidecars-from-ref"]) {
        expect(run.stderr).toContain(flag);
      }
      await expect(readFile(out, "utf8")).rejects.toThrow();
    } finally {
      try {
        const entries = await readArgvLog(path.join(dir, "argv.log"));
        if (entries.length > 0) {
          await rm(path.dirname(argvOf(entries[0]!, "--prov-out")), {
            recursive: true,
            force: true,
          });
        }
      } catch {
        // best effort only (refusal may precede any invoke)
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW-REAL rebind: the real producer parses the writer argv (expect-sha refusal, no argparse error)", async () => {
    const run = await runHappy();
    const redir = await mkdtemp(path.join(tmpdir(), "p2b3-realrebind-"));
    try {
      expect(run.rc).toBe(0);
      const entries = await readArgvLog(run.argvLog);
      const writerArgv = [...(entries[0]!["argv"] as string[])];
      for (const flag of ["--out", "--prov-out"]) {
        writerArgv[writerArgv.indexOf(flag) + 1] = path.join(
          redir,
          flag === "--out" ? "out.bin" : "prov-out.json",
        );
      }
      let rc = 0;
      let stderr = "";
      try {
        await execFileAsync("mise", ["exec", "--", "python3", REBIND_PY, ...writerArgv], {
          cwd: process.cwd(),
        });
      } catch (error) {
        const failure = error as { code?: unknown; stderr?: unknown; stdout?: unknown };
        rc = typeof failure.code === "number" ? failure.code : 1;
        stderr = typeof failure.stderr === "string" ? failure.stderr : "";
      }
      // eslint-disable-next-line no-console
      console.log(`CW-REAL rebind rc=${rc} stderr-head=${stderr.slice(0, 200)}`);
      expect(rc).not.toBe(2);
      expect(stderr).not.toContain("unrecognized arguments");
      expect(stderr).not.toContain("the following arguments are required");
    } finally {
      await cleanChain(run.argvLog);
      await rm(run.dir, { recursive: true, force: true });
      await rm(redir, { recursive: true, force: true });
    }
  }, 120_000);

  it("CW-REAL derive: the writer derive argv is a subset of the real derive flags with one pre-image flag", async () => {
    const run = await runHappy();
    try {
      expect(run.rc).toBe(0);
      const declared = await declaredDeriveFlags();
      const entries = await readArgvLog(run.argvLog);
      const deriveArgv = entries[entries.length - 1]!["argv"] as string[];
      const writerFlags = argvFlags(deriveArgv);
      // eslint-disable-next-line no-console
      console.log(
        `CW-REAL derive declared=[${[...declared].sort().join(" ")}] writer=[${writerFlags.join(" ")}]`,
      );
      for (const flag of writerFlags) {
        expect(declared.has(flag), `derive declares ${flag}`).toBe(true);
      }
      const preImageFlags = writerFlags.filter(
        (flag) => flag === "--pre-image-file" || flag === "--pre-image-revision",
      );
      expect(preImageFlags).toEqual(["--pre-image-revision"]);
    } finally {
      await cleanChain(run.argvLog);
      await rm(run.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("F4b: run-dir files are byte-unchanged after a full compose", async () => {
    const before = await snapshotDir(FIXTURE);
    const run = await runHappy();
    try {
      expect(run.rc).toBe(0);
      expect(path.relative(FIXTURE, run.out).startsWith("..")).toBe(true);
      const after = await snapshotDir(FIXTURE);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [rel, sha] of before) {
        expect(after.get(rel), `run-dir file unchanged: ${rel}`).toBe(sha);
      }
      // eslint-disable-next-line no-console
      console.log(`F4b run-dir files snapshotted before==after: ${before.size} files`);
    } finally {
      await cleanChain(run.argvLog);
      await rm(run.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("F5: the receipt schema is stages[] with stage, enforced by the writer validator", async () => {
    const raw = JSON.parse(await readFile(STAGE_LOG, "utf8")) as unknown;
    const log = parseFullBakeReceiptLog(raw);
    expect(log.stages.map((stage) => stage.stage)).toEqual(["S7", "S8", "S9"]);
    expect(log.provSeed?.path).toBe("prov-seed.json");
    expect(() => parseFullBakeReceiptLog({ phaseEntries: [] })).toThrow();
    expect(() =>
      parseFullBakeReceiptLog({
        stages: [{ tool: "x", inputSha256: "a", outputSha256: "b" }],
      }),
    ).toThrow();
  }, 60_000);

  it("PROBE: flipping one fixture outputSha256 breaks the chain; reverting passes", async () => {
    const pristine = JSON.parse(await readFile(STAGE_LOG, "utf8")) as {
      stages: Array<Record<string, unknown>>;
    };
    const goodOut = pristine.stages[0]!["outputSha256"] as string;
    const flipped = `${goodOut[0] === "c" ? "d" : "c"}${goodOut.slice(1)}`;
    const { dir, logPath } = await tempStageLog((log) => {
      log.stages[0]!["outputSha256"] = flipped;
    });
    try {
      const out = path.join(dir, "sidecar.json");
      const argvLog = path.join(dir, "argv.log");
      const mapPath = await writeProducerMap(dir);
      const broken = await runWriter(
        ["--stage-log", logPath, "--run-dir", FIXTURE, "--out", out, "--producer-map", mapPath],
        { COMPOSE_STUB_ARGV_LOG: argvLog },
      );
      expect(broken.rc).not.toBe(0);
      expect(broken.stderr).toContain(flipped);
      await expect(readFile(out, "utf8")).rejects.toThrow();
      const pristineRun = await runHappy();
      try {
        expect(pristineRun.rc).toBe(0);
      } finally {
        await cleanChain(pristineRun.argvLog);
        await rm(pristineRun.dir, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("G1: an in-place file with sha256 != postSha256 composes OK; flipping postSha256 refuses", async () => {
    const raw = JSON.parse(await readFile(STAGE_LOG, "utf8")) as {
      stages: Array<Record<string, unknown>>;
    };
    const inout = (
      raw.stages[2]!["files"] as Array<Record<string, unknown>>
    ).find((f) => f["path"] === "shared-b.bin")!;
    expect(inout["mode"]).toBe("inout");
    const pre = inout["sha256"] as string;
    const post = inout["postSha256"] as string;
    expect(pre).not.toBe(post);
    expect(post).toBe(sha256(await readFile(path.join(FIXTURE, "shared-b.bin"))));
    // The chain link still uses the pre value while the disk holds post bytes.
    expect(raw.stages[2]!["inputSha256"]).toBe(pre);
    const run = await runHappy();
    try {
      expect(run.rc).toBe(0);
    } finally {
      await cleanChain(run.argvLog);
      await rm(run.dir, { recursive: true, force: true });
    }
    const flipped = `${post[0] === "c" ? "d" : "c"}${post.slice(1)}`;
    const { dir, logPath } = await tempStageLog((log) => {
      const files = log.stages[2]!["files"] as Array<Record<string, unknown>>;
      files.find((f) => f["path"] === "shared-b.bin")!["postSha256"] = flipped;
    });
    try {
      const out = path.join(dir, "sidecar.json");
      const argvLog = path.join(dir, "argv.log");
      const mapPath = await writeProducerMap(dir);
      const broken = await runWriter(
        ["--stage-log", logPath, "--run-dir", FIXTURE, "--out", out, "--producer-map", mapPath],
        { COMPOSE_STUB_ARGV_LOG: argvLog },
      );
      // eslint-disable-next-line no-console
      console.log(`G1 flip postSha256 rc=${broken.rc} stderr-head=${broken.stderr.slice(0, 220)}`);
      expect(broken.rc).not.toBe(0);
      expect(broken.stderr).toContain("shared-b.bin");
      expect(broken.stderr).toContain(flipped);
      expect(broken.stderr).toContain(post);
      await expect(readFile(out, "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("G2: the file-branch derive argv is a subset of the real flags with one pre-image flag", async () => {
    const declared = await declaredDeriveFlags();
    expect(declared.has("--pre-image-file")).toBe(true);
    const preImageSha = sha256(await readFile(path.join(FIXTURE, "p9-pre-image.bin")));
    const { dir, logPath } = await tempStageLog((log) => {
      const files = log.stages[2]!["files"] as Array<Record<string, unknown>>;
      files.push({ path: "p9-pre-image.bin", sha256: preImageSha, role: "pre-image" });
    });
    try {
      const out = path.join(dir, "sidecar.json");
      const argvLog = path.join(dir, "argv.log");
      const mapPath = await writeProducerMap(dir);
      const run = await runWriter(
        ["--stage-log", logPath, "--run-dir", FIXTURE, "--out", out, "--producer-map", mapPath],
        { COMPOSE_STUB_ARGV_LOG: argvLog },
      );
      expect(run.rc).toBe(0);
      const entries = await readArgvLog(argvLog);
      const deriveArgv = entries[entries.length - 1]!["argv"] as string[];
      const writerFlags = argvFlags(deriveArgv);
      // eslint-disable-next-line no-console
      console.log(
        `G2 declared=[${[...declared].sort().join(" ")}] file-branch-writer=[${writerFlags.join(" ")}]`,
      );
      for (const flag of writerFlags) {
        expect(declared.has(flag), `derive declares ${flag}`).toBe(true);
      }
      expect(
        writerFlags.filter((f) => f === "--pre-image-file" || f === "--pre-image-revision"),
      ).toEqual(["--pre-image-file"]);
      expect(argvOf(entries[entries.length - 1]!, "--pre-image-file")).toBe(
        path.join(FIXTURE, "p9-pre-image.bin"),
      );
    } finally {
      try {
        const entries = await readArgvLog(path.join(dir, "argv.log"));
        if (entries.length > 0) {
          await rm(path.dirname(argvOf(entries[0]!, "--prov-out")), {
            recursive: true,
            force: true,
          });
        }
      } catch {
        // best effort only
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("G3: postSha256 requires mode inout and argv is a string array", async () => {
    const raw = JSON.parse(await readFile(STAGE_LOG, "utf8")) as {
      stages: Array<Record<string, unknown>>;
    };
    const s9 = raw.stages[2]!;
    expect(Array.isArray(s9["argv"])).toBe(true);
    const inout = (s9["files"] as Array<Record<string, unknown>>).find(
      (f) => f["path"] === "shared-b.bin",
    )!;
    expect(inout["mode"]).toBe("inout");
    expect(parseFullBakeReceiptLog(raw).stages[2]!.argv).toBeDefined();
    const logWith = (files: unknown, argv: unknown) => ({
      stages: [
        {
          stage: "S7",
          tool: "tools/openclinxr/asset-pipeline/skin/coherent-normal/rebind_baked_skin_normal.py",
          inputSha256: "a",
          outputSha256: "b",
          files,
          argv,
        },
      ],
    });
    const inoutFile = (mode: unknown, extra: Record<string, unknown> = {}) => [
      { path: "p", sha256: "a", ...extra, ...(mode === undefined ? {} : { mode }) },
    ];
    expect(() => parseFullBakeReceiptLog(logWith(inoutFile("in", { postSha256: "b" }), []))).toThrow();
    expect(() => parseFullBakeReceiptLog(logWith(inoutFile("out", { postSha256: "b" }), []))).toThrow();
    expect(() => parseFullBakeReceiptLog(logWith(inoutFile(undefined, { postSha256: "b" }), []))).toThrow();
    expect(() =>
      parseFullBakeReceiptLog(logWith(inoutFile("sideways", { postSha256: "b" }), [])),
    ).toThrow();
    expect(() =>
      parseFullBakeReceiptLog(logWith(inoutFile("inout"), "--input")),
    ).toThrow();
    expect(() =>
      parseFullBakeReceiptLog(logWith(inoutFile("inout"), ["--input", 7])),
    ).toThrow();
    expect(() =>
      parseFullBakeReceiptLog(logWith([{ path: "p", sha256: "a", postSha256: 7, mode: "inout" }], [])),
    ).toThrow();
  }, 60_000);
});
