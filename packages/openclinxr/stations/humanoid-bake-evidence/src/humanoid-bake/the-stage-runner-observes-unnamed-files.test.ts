/**
 * P2d3 — the stage runner observes files the argv does not name.
 *
 * Shipped nurse tools touch files the argv never names: S1 materialize
 * writes its output GLB with no argv flag for it (argparse forbids extra
 * tokens), S4 bake-humanoid-albedo writes into an outdir (no file flag),
 * S6 licence notice scans a hardcoded HUMANOIDS dir (ignores argv).
 * Appending dummy "witness" argv tokens to bind them was refused: it
 * records an input/output the tool did not have and changes the argv away
 * from the shipped command. The runner under test
 * (tools/openclinxr/asset-pipeline/provenance/run-stage.ts) therefore
 * accepts `--observe <path>=<role>[:in|:out|:inout]` (default in) for such
 * side-effect files. The executed argv is exactly the post-"--" argv;
 * --observe never adds, removes or substitutes an argv token.
 *
 * Fixture stubs are generated at runtime under ROOT/node_modules/.p2d3-tmp
 * (gitignored, removed after each test) so the repo-root tool check sees
 * them as repo files. No committed fixtures, no Blender, no Chromium.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";
import { parseFullBakeReceiptLog } from "../../../../../../tools/openclinxr/asset-pipeline/provenance/compose-full-bake-sidecar.js";

const ROOT = repoRoot();
process.chdir(ROOT);

const execFileAsync = promisify(execFile);
const RUNNER = path.join(
  ROOT,
  "tools/openclinxr/asset-pipeline/provenance/run-stage.ts",
);
const COMPOSER = path.join(
  ROOT,
  "tools/openclinxr/asset-pipeline/provenance/compose-full-bake-sidecar.ts",
);
const TSX_CLI = path.join(ROOT, "node_modules/tsx/dist/cli.mjs");
const P2B_FIXTURE = path.join(
  ROOT,
  "packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/fixtures/full-bake-receipts",
);

/** Tmpdirs live UNDER the repo root so the tool check sees stubs as repo files. */
const P2D3_TMP_ROOT = path.join(ROOT, "node_modules", ".p2d3-tmp");

async function makeTmp(prefix: string): Promise<string> {
  await mkdir(P2D3_TMP_ROOT, { recursive: true });
  return mkdtemp(path.join(P2D3_TMP_ROOT, `${prefix}-`));
}

const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

interface RunResult {
  rc: number;
  stdout: string;
  stderr: string;
}

async function runNode(args: string[], cwd: string, extraEnv: Record<string, string> = {}): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd,
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

const runRunner = (args: string[], cwd: string): Promise<RunResult> =>
  runNode([TSX_CLI, RUNNER, ...args], cwd);

const runComposer = (
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<RunResult> =>
  runNode([TSX_CLI, COMPOSER, ...args], cwd, extraEnv);

async function writeStub(dir: string, name: string, body: string): Promise<string> {
  const abs = path.join(dir, name);
  await writeFile(abs, body);
  await chmod(abs, 0o755);
  return abs;
}

/** Writes fixed bytes to a fixed path; reads nothing from argv. */
function writeFixedStub(target: string, content: string): string {
  return `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(target)}, Buffer.from(${JSON.stringify(content)}));
`;
}

/** Appends fixed bytes to a fixed path in place; reads nothing from argv. */
function appendFixedStub(target: string, suffix: string): string {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const p = ${JSON.stringify(target)};
writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from(${JSON.stringify(suffix)})]));
`;
}

/** Exits 0 without touching anything. */
const NOOP_STUB = `#!/usr/bin/env node
process.exit(0);
`;

/** Copies --in to --out and also writes fixed bytes to a fixed side path. */
function copyPlusSideStub(sideTarget: string, sideContent: string): string {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) { process.stderr.write("stub: missing " + name + "\\n"); process.exit(2); }
  return argv[i + 1];
};
writeFileSync(flag("--out"), readFileSync(flag("--in")));
writeFileSync(${JSON.stringify(sideTarget)}, Buffer.from(${JSON.stringify(sideContent)}));
`;
}

/** Copies --in to a fixed path (the argv names no output flag). */
function copyToFixedStub(fixedTarget: string): string {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
writeFileSync(${JSON.stringify(fixedTarget)}, readFileSync(argv[argv.indexOf("--in") + 1]));
`;
}

const REBINDISH_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) { process.stderr.write("stub: missing " + name + "\\n"); process.exit(2); }
  return argv[i + 1];
};
writeFileSync("s1out.bin", Buffer.concat([readFileSync(flag("--src")), Buffer.from(":S1")]));
`;

const DERIVEISH_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) { process.stderr.write("stub: missing " + name + "\\n"); process.exit(2); }
  return argv[i + 1];
};
writeFileSync(flag("--out"), Buffer.concat([readFileSync(flag("--input")), Buffer.from(":S2")]));
`;

interface ReceiptShape {
  stage?: unknown;
  tool?: unknown;
  toolSha256?: unknown;
  exit?: unknown;
  status?: unknown;
  inputSha256?: unknown;
  outputSha256?: unknown;
  inputPath?: unknown;
  outputPath?: unknown;
  files?: Array<Record<string, unknown>>;
  params?: unknown;
  cmd?: unknown;
  argv?: unknown;
}

async function readStages(dir: string, name = "stage-log.json"): Promise<ReceiptShape[]> {
  const raw = JSON.parse(await readFile(path.join(dir, name), "utf8")) as unknown;
  const log = parseFullBakeReceiptLog(raw);
  return log.stages as unknown as ReceiptShape[];
}

describe("the stage runner observes files the argv does not name", () => {
  it("R1: `--observe x.bin=foo:out` is accepted and records the side-effect output", async () => {
    const dir = await makeTmp("p2d3-r1");
    try {
      const stub = await writeStub(dir, "stub-write", writeFixedStub("x.bin", "r1-observed"));
      await writeFile(path.join(dir, "seed.bin"), "r1-seed");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "R1",
          "--role", "--in=seed:in",
          "--observe", "x.bin=foo:out",
          "--",
          stub, "--in", "seed.bin",
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      expect(stages.length).toBe(1);
      const entry = (stages[0]!.files ?? []).find((f) => f["path"] === "x.bin")!;
      expect(entry["sha256"]).toBe(sha256("r1-observed"));
      expect(entry["role"]).toBe("foo");
      expect(entry["mode"]).toBe("out");
      expect(entry["observed"]).toBe(true);
      // eslint-disable-next-line no-console
      console.log(
        `R1 pre-edit rc=2 stderr='run-stage: refusing: unexpected argument "--observe"; usage ends with -- <argv...>'; ` +
          `post-edit rc=${run.rc} observed-sha=${String(entry["sha256"]).slice(0, 12)}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C1: in hashes before exec, out hashes after, inout hashes both with no copy", async () => {
    const dir = await makeTmp("p2d3-c1");
    try {
      const noop = await writeStub(dir, "stub-noop", NOOP_STUB);
      void noop;
      const writer = await writeStub(dir, "stub-write", writeFixedStub("o.bin", "c1-out"));
      await writeFile(path.join(dir, "a.bin"), "c1-in-bytes");
      await writeFile(path.join(dir, "m.bin"), "c1-mut");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C1",
          "--observe", "a.bin=payload:in",
          "--observe", "o.bin=result:out",
          "--observe", "m.bin=data:inout",
          "--",
          writer,
        ],
        dir,
      );
      const c1Stages = await readStages(dir);
      const mEntry = (c1Stages[0]!.files ?? []).find((f) => f["path"] === "m.bin")!;
      expect(mEntry["sha256"]).toBe(sha256("c1-mut"));
      expect(mEntry["postSha256"]).toBe(sha256("c1-mut"));
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      const files = stages[0]!.files ?? [];
      expect(files.length).toBe(3);
      const inEntry = files.find((f) => f["path"] === "a.bin")!;
      expect(inEntry["sha256"]).toBe(sha256("c1-in-bytes"));
      expect(inEntry["mode"]).toBe("in");
      expect(inEntry["observed"]).toBe(true);
      expect(inEntry["postSha256"]).toBeUndefined();
      const outEntry = files.find((f) => f["path"] === "o.bin")!;
      expect(outEntry["sha256"]).toBe(sha256(await readFile(path.join(dir, "o.bin"))));
      expect(outEntry["mode"]).toBe("out");
      expect(outEntry["observed"]).toBe(true);
      // eslint-disable-next-line no-console
      console.log(
        `C1 in-sha=${String(inEntry["sha256"]).slice(0, 12)} out-sha=${String(outEntry["sha256"]).slice(0, 12)}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C1b: observed inout is one entry with pre sha plus postSha256 and the tool edits in place", async () => {
    const dir = await makeTmp("p2d3-c1b");
    try {
      const appender = await writeStub(dir, "stub-append", appendFixedStub("m.bin", "-c1b"));
      await writeFile(path.join(dir, "m.bin"), "c1b-mut");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C1b",
          "--observe", "m.bin=data:inout",
          "--",
          appender,
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      const files = stages[0]!.files ?? [];
      expect(files.length).toBe(1);
      const entry = files[0]!;
      expect(entry["path"]).toBe("m.bin");
      expect(entry["sha256"]).toBe(sha256("c1b-mut"));
      expect(entry["postSha256"]).toBe(sha256("c1b-mut-c1b"));
      expect(entry["mode"]).toBe("inout");
      expect(entry["observed"]).toBe(true);
      expect(entry["flag"]).toBeUndefined();
      expect(entry["argvIndex"]).toBeUndefined();
      expect(stages[0]!.argv).toEqual([appender]);
      expect(sha256(await readFile(path.join(dir, "m.bin")))).toBe(entry["postSha256"]);
      // eslint-disable-next-line no-console
      console.log(
        `C1b pre=${String(entry["sha256"]).slice(0, 12)} post=${String(entry["postSha256"]).slice(0, 12)} entries=1 argv-untouched=true`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C2: observed entries carry exactly one tag and the validator enforces observed === true", async () => {
    const dir = await makeTmp("p2d3-c2");
    try {
      const appender = await writeStub(dir, "stub-append", appendFixedStub("m.bin", "-c2"));
      await writeFile(path.join(dir, "m.bin"), "c2-mut");
      const run = await runRunner(
        ["--stage-log", "stage-log.json", "--stage", "C2", "--observe", "m.bin=data:inout", "--", appender],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      const entry = (stages[0]!.files ?? [])[0]!;
      expect(entry).toMatchObject({ path: "m.bin", role: "data", mode: "inout", observed: true });
      expect(entry["flag"]).toBeUndefined();
      expect(entry["argvIndex"]).toBeUndefined();
      const base: unknown = {
        format: "full-bake-receipts/v2",
        stages: [{ stage: "S", tool: "t", inputSha256: "i", outputSha256: "o" }],
      };
      const withFalse: unknown = structuredClone(base);
      (withFalse as { stages: Array<{ files: unknown[] }> }).stages[0]!.files = [
        { path: "a", sha256: "b", observed: false },
      ];
      expect(() => parseFullBakeReceiptLog(withFalse)).toThrow(/observed without the value true/);
      const withFlag: unknown = structuredClone(base);
      (withFlag as { stages: Array<{ files: unknown[] }> }).stages[0]!.files = [
        { path: "a", sha256: "b", flag: "--in", observed: true },
      ];
      expect(() => parseFullBakeReceiptLog(withFlag)).toThrow(/more than one of flag\/argvIndex\/observed/);
      const withIndex: unknown = structuredClone(base);
      (withIndex as { stages: Array<{ files: unknown[] }> }).stages[0]!.files = [
        { path: "a", sha256: "b", argvIndex: 1, observed: true },
      ];
      expect(() => parseFullBakeReceiptLog(withIndex)).toThrow(/more than one of flag\/argvIndex\/observed/);
      const okObserved: unknown = structuredClone(base);
      (okObserved as { stages: Array<{ files: unknown[] }> }).stages[0]!.files = [
        { path: "a", sha256: "b", role: "r", mode: "out", observed: true },
      ];
      expect(() => parseFullBakeReceiptLog(okObserved)).not.toThrow();
      // eslint-disable-next-line no-console
      console.log(`C2 rc=${run.rc} entry=${JSON.stringify(entry)} validator-negatives-rejected=3`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C3: overlaps, absent inputs and double observes are refused with the log untouched", async () => {
    const dir = await makeTmp("p2d3-c3");
    try {
      const noop = await writeStub(dir, "stub-noop", NOOP_STUB);
      await writeFile(path.join(dir, "seed.bin"), "c3-seed");
      await writeFile(path.join(dir, "p.bin"), "c3-pos");
      await writeFile(path.join(dir, "d.bin"), "c3-dup");
      expect(
        (await runRunner(
          ["--stage-log", "stage-log.json", "--stage", "SEED", "--observe", "seed.bin=s:in", "--", noop],
          dir,
        )).rc,
      ).toBe(0);
      const shaBefore = sha256(await readFile(path.join(dir, "stage-log.json")));
      const flagOverlap = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C3a-flag",
          "--role", "--in=seed:in",
          "--observe", "seed.bin=dup:in",
          "--",
          noop, "--in", "seed.bin",
        ],
        dir,
      );
      expect(flagOverlap.rc).not.toBe(0);
      expect(flagOverlap.stderr).toMatch(/already bound/);
      const posOverlap = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C3a-pos",
          "--role", "#1=payload:in",
          "--observe", "p.bin=dup:in",
          "--",
          noop, "p.bin",
        ],
        dir,
      );
      expect(posOverlap.rc).not.toBe(0);
      expect(posOverlap.stderr).toMatch(/already bound/);
      const absentIn = await runRunner(
        ["--stage-log", "stage-log.json", "--stage", "C3b-in", "--observe", "missing.bin=m:in", "--", noop],
        dir,
      );
      expect(absentIn.rc).not.toBe(0);
      expect(absentIn.stderr).toMatch(/observed input file absent/);
      const absentInout = await runRunner(
        ["--stage-log", "stage-log.json", "--stage", "C3b-inout", "--observe", "missing2.bin=m:inout", "--", noop],
        dir,
      );
      expect(absentInout.rc).not.toBe(0);
      expect(absentInout.stderr).toMatch(/observed input file absent/);
      const dup = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C3c",
          "--observe", "d.bin=first:in",
          "--observe", "d.bin=second:in",
          "--",
          noop,
        ],
        dir,
      );
      expect(dup.rc).not.toBe(0);
      expect(dup.stderr).toMatch(/duplicate observe/);
      const shaAfter = sha256(await readFile(path.join(dir, "stage-log.json")));
      expect(shaAfter).toBe(shaBefore);
      expect((await readStages(dir)).length).toBe(1);
      // eslint-disable-next-line no-console
      console.log(
        `C3 flag-rc=${flagOverlap.rc} pos-rc=${posOverlap.rc} absent-in-rc=${absentIn.rc} ` +
          `absent-inout-rc=${absentInout.rc} dup-rc=${dup.rc} log-unchanged=${shaAfter.slice(0, 12)}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C4: an unchanged or absent observed out is refused; equal inout bytes are recorded", async () => {
    const dir = await makeTmp("p2d3-c4");
    try {
      const noop = await writeStub(dir, "stub-noop", NOOP_STUB);
      await writeFile(path.join(dir, "seed.bin"), "c4-seed");
      await writeFile(path.join(dir, "u.bin"), "c4-same");
      await writeFile(path.join(dir, "w.bin"), "c4-steady");
      const unchanged = await runRunner(
        [
          "--stage-log", "unchanged.json",
          "--stage", "C4u",
          "--observe", "seed.bin=s:in",
          "--observe", "u.bin=o:out",
          "--",
          noop,
        ],
        dir,
      );
      expect(unchanged.rc).not.toBe(0);
      expect(unchanged.stderr).toMatch(/observed output unchanged/);
      expect(existsSync(path.join(dir, "unchanged.json"))).toBe(false);
      const absent = await runRunner(
        [
          "--stage-log", "absent.json",
          "--stage", "C4a",
          "--observe", "seed.bin=s:in",
          "--observe", "never.bin=o:out",
          "--",
          noop,
        ],
        dir,
      );
      expect(absent.rc).not.toBe(0);
      expect(absent.stderr).toMatch(/observed output file absent after exec/);
      expect(existsSync(path.join(dir, "absent.json"))).toBe(false);
      const steady = await runRunner(
        [
          "--stage-log", "steady.json",
          "--stage", "C4s",
          "--observe", "w.bin=d:inout",
          "--",
          noop,
        ],
        dir,
      );
      expect(steady.rc).toBe(0);
      const stages = await readStages(dir, "steady.json");
      const entry = (stages[0]!.files ?? [])[0]!;
      expect(entry["sha256"]).toBe(sha256("c4-steady"));
      expect(entry["postSha256"]).toBe(sha256("c4-steady"));
      // eslint-disable-next-line no-console
      console.log(
        `C4 unchanged-rc=${unchanged.rc} stderr='${unchanged.stderr.trim().split("\n").pop() ?? ""}' ` +
          `absent-rc=${absent.rc} steady-rc=${steady.rc} steady-sha=${String(entry["sha256"]).slice(0, 12)}==post`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C5: observed outputs fill outputSha256 only with no argv-bound output", async () => {
    const dir = await makeTmp("p2d3-c5");
    try {
      const fixed = await writeStub(dir, "stub-copy-fixed", copyToFixedStub("o.bin"));
      const both = await writeStub(dir, "stub-copy-side", copyPlusSideStub("extra.bin", "c5-side"));
      await writeFile(path.join(dir, "seed.bin"), "c5-seed");
      const onlyObserved = await runRunner(
        [
          "--stage-log", "only.json",
          "--stage", "C5a",
          "--role", "--in=seed:in",
          "--observe", "o.bin=result:out",
          "--",
          fixed, "--in", "seed.bin",
        ],
        dir,
      );
      expect(onlyObserved.rc).toBe(0);
      const onlyStages = await readStages(dir, "only.json");
      expect(onlyStages[0]!.outputPath).toBe("o.bin");
      expect(onlyStages[0]!.outputSha256).toBe(sha256(await readFile(path.join(dir, "o.bin"))));
      const argvOut = await runRunner(
        [
          "--stage-log", "argv.json",
          "--stage", "C5b",
          "--role", "--in=seed:in",
          "--role", "--out=main:out",
          "--observe", "extra.bin=side:out",
          "--",
          both, "--in", "seed.bin", "--out", "main.bin",
        ],
        dir,
      );
      expect(argvOut.rc).toBe(0);
      const argvStages = await readStages(dir, "argv.json");
      expect(argvStages[0]!.outputPath).toBe("main.bin");
      expect(argvStages[0]!.outputSha256).toBe(sha256(await readFile(path.join(dir, "main.bin"))));
      // eslint-disable-next-line no-console
      console.log(
        `C5 observed-only-out=${String(onlyStages[0]!.outputSha256).slice(0, 12)} ` +
          `argv-wins-out=${String(argvStages[0]!.outputSha256).slice(0, 12)}==main`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C6: cmd is the post-`--` argv byte for byte and params ignore --observe", async () => {
    const dir = await makeTmp("p2d3-c6");
    try {
      const stub = await writeStub(dir, "stub-copy-fixed", copyToFixedStub("q.bin"));
      await writeFile(path.join(dir, "a.bin"), "c6-in");
      await writeFile(path.join(dir, "p.bin"), "c6-pos");
      const argv = [stub, "--in", "a.bin", "--tag", "red", "p.bin"];
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C6",
          "--role", "--in=i:in",
          "--role", "#5=p:in",
          "--observe", "q.bin=r:out",
          "--",
          ...argv,
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      const receipt = stages[0]!;
      expect(receipt.cmd).toBe(argv.join(" "));
      expect(receipt.params).toEqual({ tag: "red" });
      const tags = (receipt.files ?? []).map((f) =>
        f["flag"] !== undefined ? "flag" : f["argvIndex"] !== undefined ? "argvIndex" : "observed",
      );
      expect(tags).toEqual(["flag", "argvIndex", "observed"]);
      // eslint-disable-next-line no-console
      console.log(`C6 cmd='${String(receipt.cmd)}' params=${JSON.stringify(receipt.params)} tags=${tags.join(",")}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW: the composer accepts a 2-stage log with an observed-only stage-1 output", async () => {
    const dir = await makeTmp("p2d3-cw");
    try {
      const rebindish = await writeStub(dir, "rebind_baked_skin_normal_obs", REBINDISH_STUB);
      const deriveish = await writeStub(dir, "derive_sidecar_obs", DERIVEISH_STUB);
      await writeFile(path.join(dir, "a.bin"), "cw-src");
      await writeFile(path.join(dir, "n.bin"), "cw-png");
      await writeFile(path.join(dir, "o.bin"), "cw-anchor");
      await writeFile(path.join(dir, "r.json"), '{"bake":"cw"}');
      await writeFile(path.join(dir, "rep.json"), '{"report":"cw"}');
      await writeFile(path.join(dir, "prov-seed.json"), '{"seed":"cw"}');
      const seedSha = sha256(await readFile(path.join(dir, "prov-seed.json")));
      await writeFile(
        path.join(dir, "stage-log.json"),
        `${JSON.stringify(
          {
            format: "full-bake-receipts/v2",
            provSeed: { path: "prov-seed.json", sha256: seedSha },
            stages: [],
          },
          null,
          1,
        )}\n`,
      );
      const s1 = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "S1",
          "--role", "--src=src:in",
          "--role", "--new-normal=new-normal:in",
          "--role", "--old-anchor=old-anchor:in",
          "--role", "--bake-report=bake-report:in",
          "--observe", "s1out.bin=output:out",
          "--",
          rebindish,
          "--src", "a.bin",
          "--new-normal", "n.bin",
          "--old-anchor", "o.bin",
          "--bake-report", "r.json",
          "--skin-sub", "mpfb_x",
          "--recipe", "rec1",
        ],
        dir,
      );
      expect(s1.rc).toBe(0);
      const s2 = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "S2",
          "--role", "--input=input:in",
          "--role", "--report=report:in",
          "--role", "--out=output:out",
          "--",
          deriveish,
          "--input", "s1out.bin",
          "--report", "rep.json",
          "--out", "final.bin",
          "--pre-image-revision",
          "0000000000000000000000000000000000000000",
        ],
        dir,
      );
      expect(s2.rc).toBe(0);
      const stages = await readStages(dir);
      expect(stages.length).toBe(2);
      const s1Observed = (stages[0]!.files ?? []).find((f) => f["path"] === "s1out.bin")!;
      expect(s1Observed["observed"]).toBe(true);
      expect(stages[0]!.files ?? []).toHaveLength(5);
      expect(stages[1]!.inputSha256).toBe(stages[0]!.outputSha256);
      const mapPath = path.join(dir, "producer-map.json");
      await writeFile(
        mapPath,
        `${JSON.stringify(
          {
            rebind: [path.join(P2B_FIXTURE, "stubs", "rebind-stub")],
            repack: [path.join(P2B_FIXTURE, "stubs", "repack-stub")],
            derive: [path.join(P2B_FIXTURE, "stubs", "derive-stub")],
          },
          null,
          1,
        )}\n`,
      );
      const out = path.join(dir, "sidecar.json");
      const composed = await runComposer(
        ["--stage-log", path.join(dir, "stage-log.json"), "--run-dir", dir, "--out", out, "--producer-map", mapPath],
        ROOT,
        {},
      );
      expect(composed.rc).toBe(0);
      const emitted = JSON.parse(await readFile(out, "utf8")) as Record<string, unknown>;
      expect(emitted["rebindSkinB7"]).toBeDefined();
      expect(emitted["teethSwapB1"]).toBeDefined();
      // eslint-disable-next-line no-console
      console.log(
        `CW s1rc=${s1.rc} s2rc=${s2.rc} composer-rc=${composed.rc} ` +
          `chain=${String(stages[1]!.inputSha256).slice(0, 12)}==${String(stages[0]!.outputSha256).slice(0, 12)} ` +
          `keys=${Object.keys(emitted).sort().join(",")}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("PROBE: observe passes when the stub writes X and refuses name the cause otherwise", async () => {
    const dir = await makeTmp("p2d3-probe");
    try {
      const writer = await writeStub(dir, "stub-write", writeFixedStub("x.bin", "probe-bytes"));
      const noop = await writeStub(dir, "stub-noop", NOOP_STUB);
      await writeFile(path.join(dir, "seed.bin"), "probe-seed");
      const pass = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "PROBE",
          "--role", "--in=seed:in",
          "--observe", "x.bin=result:out",
          "--",
          writer, "--in", "seed.bin",
        ],
        dir,
      );
      expect(pass.rc).toBe(0);
      const stages = await readStages(dir);
      const entry = (stages[0]!.files ?? []).find((f) => f["path"] === "x.bin")!;
      expect(entry["sha256"]).toBe(sha256("probe-bytes"));
      // eslint-disable-next-line no-console
      console.log(`PROBE pass rc=${pass.rc} sha=${String(entry["sha256"]).slice(0, 12)}`);
      const stale = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "PROBE2",
          "--role", "--in=seed:in",
          "--observe", "x.bin=result:out",
          "--",
          noop, "--in", "seed.bin",
        ],
        dir,
      );
      // eslint-disable-next-line no-console
      console.log(
        `PROBE stale rc=${stale.rc} stderr=${stale.stderr.trim().split("\n").pop() ?? ""} refused=${String(stale.rc !== 0)}`,
      );
      expect(stale.rc).not.toBe(0);
      expect(stale.stderr).toMatch(/observed output unchanged/);
      const overlap = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "PROBE3",
          "--role", "--in=seed:in",
          "--observe", "seed.bin=dup:in",
          "--",
          noop, "--in", "seed.bin",
        ],
        dir,
      );
      // eslint-disable-next-line no-console
      console.log(
        `PROBE overlap rc=${overlap.rc} stderr=${overlap.stderr.trim().split("\n").pop() ?? ""} refused=${String(overlap.rc !== 0)}`,
      );
      expect(overlap.rc).not.toBe(0);
      expect(overlap.stderr).toMatch(/already bound/);
      expect((await readStages(dir)).length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
