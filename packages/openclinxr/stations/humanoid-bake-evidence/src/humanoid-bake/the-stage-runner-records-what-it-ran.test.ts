/**
 * P2d — the stage runner records what it ran (round 2: H1/H2/H3).
 *
 * The p2-rebake stage-log was hand-written by a worker
 * (13 python3 json.dump calls). P2 v6 may write stage-log entries only
 * through the runner under test
 * (tools/openclinxr/asset-pipeline/provenance/run-stage.ts), which execs a
 * stage argv array and appends one receipt built from measured bytes via
 * the P2b exported StageReceipt/ReceiptFileRef type plus runtime validator.
 * Receipts come only from what was executed.
 *
 * Every stub fixture is generated at runtime under a test tmpdir UNDER the
 * repo root (ROOT/node_modules/.p2d-tmp, gitignored and removed after each
 * test) so H1's repo-root tool check sees them as repo files. No committed
 * fixtures, no Blender, no Chromium, no captures. The CW4 end-to-end reuses
 * the committed P2b producer stubs only as the composer's injectable
 * command map, exactly as the P2b test does.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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

/** Tmpdirs live UNDER the repo root so H1 sees stubs as repo files. */
const P2D_TMP_ROOT = path.join(ROOT, "node_modules", ".p2d-tmp");

async function makeTmp(prefix: string): Promise<string> {
  await mkdir(P2D_TMP_ROOT, { recursive: true });
  return mkdtemp(path.join(P2D_TMP_ROOT, `${prefix}-`));
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

const COPY_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) { process.stderr.write("stub: missing " + name + "\\n"); process.exit(2); }
  return argv[i + 1];
};
writeFileSync(flag("--out"), readFileSync(flag("--in")));
`;

const FAIL_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) { process.stderr.write("stub: missing " + name + "\\n"); process.exit(2); }
  return argv[i + 1];
};
writeFileSync(flag("--out"), readFileSync(flag("--in")));
process.exit(7);
`;

const NO_OUT_FAIL_STUB = `#!/usr/bin/env node
process.exit(3);
`;

const MUTATE_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const p = argv[argv.indexOf("--data") + 1];
writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from("-mut")]));
`;

const MUTATE_TWO_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
for (const flag of ["--d1", "--d2"]) {
  const p = argv[argv.indexOf(flag) + 1];
  writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from("-mut")]));
}
`;

const DIVERT_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
writeFileSync("elsewhere.bin", readFileSync(argv[argv.indexOf("--in") + 1]));
`;

const X_PY = `#!/usr/bin/env python3
import argparse
ap = argparse.ArgumentParser()
ap.add_argument("--in", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--label", default="")
a = ap.parse_args()
with open(getattr(a, "in"), "rb") as f:
    data = f.read()
with open(a.out, "wb") as f:
    f.write(data + b":py")
`;

const REBINDISH_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
writeFileSync(flag("--out"), Buffer.concat([readFileSync(flag("--src")), Buffer.from(":S1")]));
`;

const DERIVEISH_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
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
  argv?: unknown;
}

async function readStages(dir: string, name = "stage-log.json"): Promise<ReceiptShape[]> {
  const raw = JSON.parse(await readFile(path.join(dir, name), "utf8")) as unknown;
  const log = parseFullBakeReceiptLog(raw);
  return log.stages as unknown as ReceiptShape[];
}

/** CW1 core: files[].path equals the role-mapped argv values; params equal the rest. */
function assertFilesParams(
  receipt: ReceiptShape,
  expectedPaths: string[],
  expectedParams: Record<string, string>,
): void {
  const files = receipt.files ?? [];
  expect(files.map((f) => f["path"]).sort()).toEqual([...expectedPaths].sort());
  expect(receipt.params).toEqual(expectedParams);
  const argv = receipt.argv as string[];
  for (const p of expectedPaths) {
    expect(argv, `executed argv carries file ${p}`).toContain(p);
  }
}

describe("the stage runner records what it ran", () => {
  it("R1: a stub run appends one receipt with measured shas", async () => {
    const dir = await makeTmp("p2d-r1");
    try {
      const stub = await writeStub(dir, "stub-copy", COPY_STUB);
      await writeFile(path.join(dir, "a.bin"), "alpha-bytes");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "R1",
          "--role", "--in=input:in",
          "--role", "--out=output:out",
          "--",
          stub, "--in", "a.bin", "--out", "b.bin", "--label", "hello",
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      expect(stages.length).toBe(1);
      const r = stages[0]!;
      expect(r.stage).toBe("R1");
      expect(r.tool).toBe(stub);
      expect(r.exit).toBe(0);
      expect(r.inputSha256).toBe(sha256("alpha-bytes"));
      expect(r.outputSha256).toBe(sha256(await readFile(path.join(dir, "b.bin"))));
      // eslint-disable-next-line no-console
      console.log(
        `R1 rc=${run.rc} stages=1 toolSha=${String(r.toolSha256).slice(0, 12)} ` +
          `in=${String(r.inputSha256).slice(0, 12)} out=${String(r.outputSha256).slice(0, 12)}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW1: files carry the role-mapped argv values and params carry the rest", async () => {
    const dir = await makeTmp("p2d-cw1");
    try {
      const stub = await writeStub(dir, "stub-copy", COPY_STUB);
      await writeFile(path.join(dir, "a.bin"), "alpha-bytes");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "CW1",
          "--role", "--in=input:in",
          "--role", "--out=output:out",
          "--",
          stub, "--in", "a.bin", "--out", "b.bin", "--label", "hello",
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      assertFilesParams(stages[0]!, ["a.bin", "b.bin"], { label: "hello" });
      // eslint-disable-next-line no-console
      console.log(
        `CW1 rc=${run.rc} files=${JSON.stringify((stages[0]!.files ?? []).map((f) => f["path"]))} ` +
          `params=${JSON.stringify(stages[0]!.params)}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW2: a non-zero exit is recorded as exit plus failed status and the log still validates", async () => {
    const dir = await makeTmp("p2d-cw2");
    try {
      const stub = await writeStub(dir, "stub-fail", FAIL_STUB);
      await writeFile(path.join(dir, "a.bin"), "alpha-bytes");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "CW2",
          "--role", "--in=input:in",
          "--role", "--out=output:out",
          "--",
          stub, "--in", "a.bin", "--out", "b.bin",
        ],
        dir,
      );
      expect(run.rc).toBe(7);
      const stages = await readStages(dir);
      expect(stages.length).toBe(1);
      expect(stages[0]!.exit).toBe(7);
      expect(stages[0]!.status).toBe("failed");
      // eslint-disable-next-line no-console
      console.log(`CW2 rc=${run.rc} exit=${String(stages[0]!.exit)} status=${String(stages[0]!.status)} validates=true`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW2b: exit 3 without writing its out appends a failed receipt with no fabricated out sha", async () => {
    const dir = await makeTmp("p2d-cw2b");
    try {
      const stub = await writeStub(dir, "stub-no-out-fail", NO_OUT_FAIL_STUB);
      await writeFile(path.join(dir, "a.bin"), "cw2b-src");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "CW2b",
          "--role", "--in=input:in",
          "--role", "--out=output:out",
          "--",
          stub, "--in", "a.bin", "--out", "b.bin",
        ],
        dir,
      );
      expect(run.rc).toBe(3);
      const stages = await readStages(dir);
      expect(stages.length).toBe(1);
      const r = stages[0]!;
      expect(r.exit).toBe(3);
      expect(r.status).toBe("failed");
      const files = r.files ?? [];
      expect(files.some((f) => f["mode"] === "out")).toBe(false);
      expect(files.map((f) => f["path"])).toEqual(["a.bin"]);
      expect(r.outputSha256).toBe(r.inputSha256);
      expect(r.outputPath).toBe(r.inputPath);
      expect(r.inputSha256).toBe(sha256("cw2b-src"));
      // eslint-disable-next-line no-console
      console.log(
        `CW2b rc=${run.rc} exit=${String(r.exit)} status=${String(r.status)} ` +
          `files=${JSON.stringify(files.map((f) => f["path"]))} out=fallback-to-input validates=true`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW3: the runner takes no hand-written receipt flags", async () => {
    const source = await readFile(RUNNER, "utf8");
    for (const banned of ["--files", "--params", "--receipt"]) {
      const count = source.split(banned).length - 1;
      // eslint-disable-next-line no-console
      console.log(`CW3 ${banned} count=${count}`);
      expect(count).toBe(0);
    }
  }, 60_000);

  it("CW4: the composer accepts the runner output on a 2-stage stub run end to end", async () => {
    const dir = await makeTmp("p2d-cw4");
    try {
      const rebindish = await writeStub(dir, "rebind_baked_skin_normal_s1", REBINDISH_STUB);
      const deriveish = await writeStub(dir, "derive_sidecar_s2", DERIVEISH_STUB);
      await writeFile(path.join(dir, "a.bin"), "cw4-src");
      await writeFile(path.join(dir, "n.bin"), "cw4-png");
      await writeFile(path.join(dir, "o.bin"), "cw4-anchor");
      await writeFile(path.join(dir, "r.json"), '{"bake":"cw4"}');
      await writeFile(path.join(dir, "rep.json"), '{"report":"cw4"}');
      await writeFile(path.join(dir, "prov-seed.json"), '{"seed":"cw4"}');
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
          "--role", "--out=output:out",
          "--",
          rebindish,
          "--src", "a.bin",
          "--new-normal", "n.bin",
          "--old-anchor", "o.bin",
          "--bake-report", "r.json",
          "--out", "shared.bin",
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
          "--input", "shared.bin",
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
      expect(stages[0]!.params).toMatchObject({ skinSub: "mpfb_x", recipe: "rec1" });
      expect(stages[1]!.params).toMatchObject({
        preImageRevision: "0000000000000000000000000000000000000000",
      });
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
        `CW4 s1rc=${s1.rc} s2rc=${s2.rc} composer-rc=${composed.rc} ` +
          `chain=${String(stages[1]!.inputSha256).slice(0, 12)}==${String(stages[0]!.outputSha256).slice(0, 12)} ` +
          `keys=${Object.keys(emitted).sort().join(",")}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("CW5: an in-place stub records pre != post and the chain links to the previous output", async () => {
    const dir = await makeTmp("p2d-cw5");
    try {
      const copy = await writeStub(dir, "stub-copy", COPY_STUB);
      const mutate = await writeStub(dir, "stub-mutate", MUTATE_STUB);
      await writeFile(path.join(dir, "a.bin"), "cw5-src");
      const s1 = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "S1",
          "--role", "--in=input:in",
          "--role", "--out=mid:out",
          "--",
          copy, "--in", "a.bin", "--out", "mid.bin",
        ],
        dir,
      );
      expect(s1.rc).toBe(0);
      const s2 = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "S2",
          "--role", "--data=file:inout",
          "--",
          mutate, "--data", "mid.bin",
        ],
        dir,
      );
      expect(s2.rc).toBe(0);
      const stages = await readStages(dir);
      const r1 = stages[0]!;
      const r2 = stages[1]!;
      expect(r2.inputSha256).toBe(r1.outputSha256);
      const files = r2.files ?? [];
      const preEntry = files.find((f) => f["mode"] === "in");
      const inoutEntry = files.find((f) => f["mode"] === "inout");
      expect(preEntry).toBeDefined();
      expect(inoutEntry).toBeDefined();
      expect(preEntry!["path"]).toBe("mid.bin");
      expect(preEntry!["sha256"]).toBe(r1.outputSha256);
      expect(inoutEntry!["sha256"]).toBe(r1.outputSha256);
      expect(inoutEntry!["postSha256"]).not.toBe(inoutEntry!["sha256"]);
      // eslint-disable-next-line no-console
      console.log(
        `CW5 s1out=${String(r1.outputSha256).slice(0, 12)} s2in=${String(r2.inputSha256).slice(0, 12)} ` +
          `pre=${String(inoutEntry!["sha256"]).slice(0, 12)} post=${String(inoutEntry!["postSha256"]).slice(0, 12)}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW6: mise exec python records the script as the tool with the script sha", async () => {
    const dir = await makeTmp("p2d-cw6");
    try {
      await writeFile(path.join(dir, "x.py"), X_PY);
      await writeFile(path.join(dir, "a.bin"), "cw6-src");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "CW6",
          "--role", "--in=input:in",
          "--role", "--out=output:out",
          "--",
          "mise", "exec", "--", "python3", "x.py", "--in", "a.bin", "--out", "b.bin", "--label", "L",
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      const r = stages[0]!;
      expect(r.tool).toBe("x.py");
      expect(r.toolSha256).toBe(sha256(await readFile(path.join(dir, "x.py"))));
      // eslint-disable-next-line no-console
      console.log(`CW6 rc=${run.rc} tool=${String(r.tool)} toolSha=${String(r.toolSha256).slice(0, 12)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("CW6b: an absolute interpreter path never wins over a repo script", async () => {
    const dir = await makeTmp("p2d-cw6b");
    try {
      const stub = await writeStub(dir, "stub-copy", COPY_STUB);
      await writeFile(path.join(dir, "a.bin"), "cw6b-src");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "CW6b",
          "--role", "--in=input:in",
          "--role", "--out=output:out",
          "--",
          process.execPath, stub, "--in", "a.bin", "--out", "b.bin",
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      const r = stages[0]!;
      expect(r.tool).toBe(stub);
      expect(r.tool).not.toBe(process.execPath);
      expect(r.toolSha256).toBe(sha256(await readFile(stub)));
      // eslint-disable-next-line no-console
      console.log(`CW6b rc=${run.rc} tool-is-stub=${String(r.tool === stub)} toolSha=${String(r.toolSha256).slice(0, 12)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW7: after an inout run both files exist with pre bytes untouched and copy at post", async () => {
    const dir = await makeTmp("p2d-cw7");
    try {
      const copy = await writeStub(dir, "stub-copy", COPY_STUB);
      const mutate = await writeStub(dir, "stub-mutate", MUTATE_STUB);
      await writeFile(path.join(dir, "a.bin"), "cw7-src");
      expect(
        (await runRunner(
          [
            "--stage-log", "stage-log.json",
            "--stage", "S1",
            "--role", "--in=input:in",
            "--role", "--out=mid:out",
            "--",
            copy, "--in", "a.bin", "--out", "mid.bin",
          ],
          dir,
        )).rc,
      ).toBe(0);
      const stages1 = await readStages(dir);
      const preBytes = await readFile(path.join(dir, "mid.bin"));
      expect(sha256(preBytes)).toBe(stages1[0]!.outputSha256);
      expect(
        (await runRunner(
          ["--stage-log", "stage-log.json", "--stage", "S2", "--role", "--data=file:inout", "--", mutate, "--data", "mid.bin"],
          dir,
        )).rc,
      ).toBe(0);
      const stages = await readStages(dir);
      const r1 = stages[0]!;
      const r2 = stages[1]!;
      const inoutEntry = (r2.files ?? []).find((f) => f["mode"] === "inout")!;
      const preEntry = (r2.files ?? []).find((f) => f["mode"] === "in")!;
      expect(preEntry["path"]).toBe("mid.bin");
      expect(preEntry["sha256"]).toBe(r1.outputSha256);
      const copyRel = String(inoutEntry["path"]);
      const midDisk = await readFile(path.join(dir, "mid.bin"));
      const copyDisk = await readFile(path.join(dir, copyRel));
      expect(sha256(midDisk)).toBe(r1.outputSha256);
      expect(midDisk.equals(preBytes)).toBe(true);
      expect(sha256(copyDisk)).toBe(inoutEntry["postSha256"]);
      // eslint-disable-next-line no-console
      console.log(
        `CW7 pre-disk=${sha256(midDisk).slice(0, 12)}==s1out=${String(r1.outputSha256).slice(0, 12)} ` +
          `copy-disk=${sha256(copyDisk).slice(0, 12)}==post=${String(inoutEntry["postSha256"]).slice(0, 12)} ` +
          `pre-untouched=${String(midDisk.equals(preBytes))}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("CW7b: two inout roles keep both pre paths with their on-disk sha", async () => {
    const dir = await makeTmp("p2d-cw7b");
    try {
      const mutateTwo = await writeStub(dir, "stub-mutate-two", MUTATE_TWO_STUB);
      await writeFile(path.join(dir, "f1.bin"), "cw7b-one");
      await writeFile(path.join(dir, "f2.bin"), "cw7b-two");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "CW7b",
          "--role", "--d1=first:inout",
          "--role", "--d2=second:inout",
          "--",
          mutateTwo, "--d1", "f1.bin", "--d2", "f2.bin",
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      const r = stages[0]!;
      const files = r.files ?? [];
      const pres = files.filter((f) => f["mode"] === "in");
      const inouts = files.filter((f) => f["mode"] === "inout");
      expect(pres.length).toBe(2);
      expect(inouts.length).toBe(2);
      for (const pre of pres) {
        const disk = await readFile(path.join(dir, String(pre["path"])));
        expect(pre["sha256"]).toBe(sha256(disk));
      }
      const paths = pres.map((f) => String(f["path"])).sort();
      expect(paths).toEqual(["f1.bin", "f2.bin"]);
      // eslint-disable-next-line no-console
      console.log(
        `CW7b rc=${run.rc} pres=${JSON.stringify(paths)} ` +
          `shas=${pres.map((f) => String(f["sha256"]).slice(0, 12)).sort().join(",")}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("PROBE: a stub that writes elsewhere fails the file check; reverting passes", async () => {
    const dir = await makeTmp("p2d-probe");
    try {
      const divert = await writeStub(dir, "stub-divert", DIVERT_STUB);
      await writeFile(path.join(dir, "a.bin"), "probe-src");
      const bad = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "PROBE",
          "--role", "--in=input:in",
          "--role", "--out=output:out",
          "--",
          divert, "--in", "a.bin", "--out", "b.bin", "--label", "hello",
        ],
        dir,
      );
      let failed = false;
      let why = "";
      try {
        assertFilesParams((await readStages(dir))[0]!, ["a.bin", "b.bin"], { label: "hello" });
      } catch (error) {
        failed = true;
        why = String(error).split("\n")[0] ?? "";
      }
      // eslint-disable-next-line no-console
      console.log(`PROBE before rc=${bad.rc} CW1-fails=${String(failed)} why=${why.slice(0, 160)}`);
      expect(failed).toBe(true);
      await rm(path.join(dir, "stage-log.json"), { force: true });
      const good = await writeStub(dir, "stub-copy", COPY_STUB);
      const rerun = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "PROBE",
          "--role", "--in=input:in",
          "--role", "--out=output:out",
          "--",
          good, "--in", "a.bin", "--out", "b.bin", "--label", "hello",
        ],
        dir,
      );
      expect(rerun.rc).toBe(0);
      assertFilesParams((await readStages(dir))[0]!, ["a.bin", "b.bin"], { label: "hello" });
      // eslint-disable-next-line no-console
      console.log(`PROBE after rc=${rerun.rc} CW1-passes=true`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
