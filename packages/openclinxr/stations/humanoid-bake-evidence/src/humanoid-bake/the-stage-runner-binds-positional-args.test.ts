/**
 * P2d2 — the stage runner binds positional args (round 2: R1/C1-C4 + PROBE).
 *
 * Shipped nurse S9 tools take the GLB positionally (teeth-rest-clearance.ts
 * "$2" --delta 0.0085; tongue-forward-place.ts "$2";
 * couple-fitted-teeth-to-lip-viseme.ts <glb>; decimate_teeth.mts <glb>
 * --in-place), so no --flag form can map them. The runner under test
 * (tools/openclinxr/asset-pipeline/provenance/run-stage.ts) therefore
 * accepts `--role '#<argvIndex>=<role>[:in|:out|:inout]'` binding element
 * <argvIndex> of the post-"--" argv (0 = first token after "--"), with the
 * same hashing (inputs before exec, outputs after), tool rule, and inout
 * copy semantics as flag bindings.
 *
 * Fixture stubs are generated at runtime under ROOT/node_modules/.p2d2-tmp
 * (gitignored, removed after each test) so the repo-root tool check sees
 * them as repo files. No committed fixtures, no Blender, no Chromium.
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

/** Tmpdirs live UNDER the repo root so the tool check sees stubs as repo files. */
const P2D2_TMP_ROOT = path.join(ROOT, "node_modules", ".p2d2-tmp");

async function makeTmp(prefix: string): Promise<string> {
  await mkdir(P2D2_TMP_ROOT, { recursive: true });
  return mkdtemp(path.join(P2D2_TMP_ROOT, `${prefix}-`));
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

/** Copies argv[0] to argv[1] positionally (no flags read). */
const POS_COPY_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
writeFileSync(argv[1], readFileSync(argv[0]));
`;

/** Appends to argv[0] positionally (no flags read). */
const POS_MUTATE_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const p = argv[0];
writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from("-mut")]));
`;

/** Exits 0 without touching anything. */
const NOOP_STUB = `#!/usr/bin/env node
process.exit(0);
`;

/** Mutates process.argv.slice(1)[1] in place (argv[1] counting the script path). */
const ARGV1_MUTATE_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(1);
const p = argv[1];
writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from("-probe")]));
`;

const FLAG_COPY_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) { process.stderr.write("stub: missing " + name + "\\n"); process.exit(2); }
  return argv[i + 1];
};
writeFileSync(flag("--out"), readFileSync(flag("--in")));
`;

const REBINDISH_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
writeFileSync(flag("--out"), Buffer.concat([readFileSync(flag("--src")), Buffer.from(":S1")]));
`;

/** Derive-shaped stub with positional operands: [input, report, out]. */
const POS_DERIVEISH_STUB = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
writeFileSync(argv[2], Buffer.concat([readFileSync(argv[0]), Buffer.from(":S2")]));
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

describe("the stage runner binds positional args", () => {
  it("R1: a '#1=glb:inout' positional binding is accepted and records measured shas", async () => {
    const dir = await makeTmp("p2d2-r1");
    try {
      const stub = await writeStub(dir, "stub-pos-copy", POS_COPY_STUB);
      await writeFile(path.join(dir, "a.bin"), "r1-pos-bytes");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "R1",
          "--role", "#1=glb:in",
          "--role", "#2=out:out",
          "--",
          stub, "a.bin", "b.bin",
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      expect(stages.length).toBe(1);
      const r = stages[0]!;
      expect(r.inputSha256).toBe(sha256("r1-pos-bytes"));
      expect(r.outputSha256).toBe(sha256(await readFile(path.join(dir, "b.bin"))));
      // eslint-disable-next-line no-console
      console.log(
        `R1 pre-edit rc=2 stderr='run-stage: refusing: stage R1: role "#1=glb:inout" needs <flag>=<role>[:mode]'; ` +
          `post-edit rc=${run.rc} stages=1 in=${String(r.inputSha256).slice(0, 12)} out=${String(r.outputSha256).slice(0, 12)}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C1: 0 is the first token after `--`; #0 vs #1 land different paths in the receipt", async () => {
    const source = await readFile(RUNNER, "utf8");
    expect(source).toContain("0 = first token after");
    expect(source).toContain("0 is the first token after");
    const dir = await makeTmp("p2d2-c1");
    try {
      const stub = await writeStub(dir, "stub-noop", NOOP_STUB);
      await writeFile(path.join(dir, "a.bin"), "c1-bytes");
      const first = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C1a",
          "--role", "#1=payload:in",
          "--",
          stub, "a.bin",
        ],
        dir,
      );
      expect(first.rc).toBe(0);
      const second = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C1b",
          "--role", "#0=toolfile:in",
          "--",
          stub, "a.bin",
        ],
        dir,
      );
      expect(second.rc).toBe(0);
      const stages = await readStages(dir);
      expect(stages.length).toBe(2);
      expect((stages[0]!.files ?? [])[0]!["path"]).toBe("a.bin");
      expect((stages[0]!.files ?? [])[0]!["argvIndex"]).toBe(1);
      expect((stages[1]!.files ?? [])[0]!["path"]).toBe(stub);
      expect((stages[1]!.files ?? [])[0]!["argvIndex"]).toBe(0);
      // eslint-disable-next-line no-console
      console.log(
        `C1 #1-path=${String((stages[0]!.files ?? [])[0]!["path"])} ` +
          `#0-path=${String((stages[1]!.files ?? [])[0]!["path"])}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C2a: refusal when the index is >= argv length, with no receipt appended", async () => {
    const dir = await makeTmp("p2d2-c2a");
    try {
      const stub = await writeStub(dir, "stub-noop", NOOP_STUB);
      await writeFile(path.join(dir, "a.bin"), "c2a-bytes");
      expect(
        (await runRunner(
          ["--stage-log", "stage-log.json", "--stage", "SEED", "--role", "#1=payload:in", "--", stub, "a.bin"],
          dir,
        )).rc,
      ).toBe(0);
      const before = sha256(await readFile(path.join(dir, "stage-log.json")));
      const bad = await runRunner(
        ["--stage-log", "stage-log.json", "--stage", "C2a", "--role", "#9=oob:in", "--", stub, "a.bin"],
        dir,
      );
      expect(bad.rc).not.toBe(0);
      expect(bad.stderr).toMatch(/out of range/);
      const after = sha256(await readFile(path.join(dir, "stage-log.json")));
      expect(after).toBe(before);
      expect((await readStages(dir)).length).toBe(1);
      // eslint-disable-next-line no-console
      console.log(`C2a rc=${bad.rc} stderr=${bad.stderr.trim().split("\n").pop()} log-sha-unchanged=${String(after).slice(0, 12)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C2b: refusal when the index points at a token starting with `-`, with no receipt appended", async () => {
    const dir = await makeTmp("p2d2-c2b");
    try {
      const stub = await writeStub(dir, "stub-noop", NOOP_STUB);
      await writeFile(path.join(dir, "a.bin"), "c2b-bytes");
      expect(
        (await runRunner(
          ["--stage-log", "stage-log.json", "--stage", "SEED", "--role", "#1=payload:in", "--", stub, "a.bin"],
          dir,
        )).rc,
      ).toBe(0);
      const before = sha256(await readFile(path.join(dir, "stage-log.json")));
      const bad = await runRunner(
        ["--stage-log", "stage-log.json", "--stage", "C2b", "--role", "#1=x:in", "--", stub, "--in", "a.bin"],
        dir,
      );
      expect(bad.rc).not.toBe(0);
      expect(bad.stderr).toMatch(/points at flag token/);
      const after = sha256(await readFile(path.join(dir, "stage-log.json")));
      expect(after).toBe(before);
      expect((await readStages(dir)).length).toBe(1);
      // eslint-disable-next-line no-console
      console.log(`C2b rc=${bad.rc} stderr=${bad.stderr.trim().split("\n").pop()} log-sha-unchanged=${String(after).slice(0, 12)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C2c: refusal when the same index is bound twice, with no receipt appended", async () => {
    const dir = await makeTmp("p2d2-c2c");
    try {
      const stub = await writeStub(dir, "stub-noop", NOOP_STUB);
      await writeFile(path.join(dir, "a.bin"), "c2c-bytes");
      expect(
        (await runRunner(
          ["--stage-log", "stage-log.json", "--stage", "SEED", "--role", "#1=payload:in", "--", stub, "a.bin"],
          dir,
        )).rc,
      ).toBe(0);
      const before = sha256(await readFile(path.join(dir, "stage-log.json")));
      const bad = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C2c",
          "--role", "#1=first:in",
          "--role", "#1=second:in",
          "--",
          stub, "a.bin",
        ],
        dir,
      );
      expect(bad.rc).not.toBe(0);
      expect(bad.stderr).toMatch(/duplicate role for #1/);
      const after = sha256(await readFile(path.join(dir, "stage-log.json")));
      expect(after).toBe(before);
      expect((await readStages(dir)).length).toBe(1);
      // eslint-disable-next-line no-console
      console.log(`C2c rc=${bad.rc} stderr=${bad.stderr.trim().split("\n").pop()} log-sha-unchanged=${String(after).slice(0, 12)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C2d: refusal when one file is bound both positionally and by flag, with no receipt appended", async () => {
    const dir = await makeTmp("p2d2-c2d");
    try {
      const stub = await writeStub(dir, "stub-noop", NOOP_STUB);
      await writeFile(path.join(dir, "a.bin"), "c2d-bytes");
      expect(
        (await runRunner(
          ["--stage-log", "stage-log.json", "--stage", "SEED", "--role", "#1=payload:in", "--", stub, "a.bin"],
          dir,
        )).rc,
      ).toBe(0);
      const before = sha256(await readFile(path.join(dir, "stage-log.json")));
      const bad = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C2d",
          "--role", "--in=input:in",
          "--role", "#2=other:in",
          "--",
          stub, "--in", "a.bin",
        ],
        dir,
      );
      expect(bad.rc).not.toBe(0);
      expect(bad.stderr).toMatch(/bound both by flag and positionally/);
      const after = sha256(await readFile(path.join(dir, "stage-log.json")));
      expect(after).toBe(before);
      expect((await readStages(dir)).length).toBe(1);
      // eslint-disable-next-line no-console
      console.log(`C2d rc=${bad.rc} stderr=${bad.stderr.trim().split("\n").pop()} log-sha-unchanged=${String(after).slice(0, 12)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C3a: every files entry carries exactly one of flag/argvIndex and the validator enforces both", async () => {
    const dir = await makeTmp("p2d2-c3a");
    try {
      const stub = await writeStub(dir, "stub-pos-copy", POS_COPY_STUB);
      await writeFile(path.join(dir, "a.bin"), "c3a-one");
      await writeFile(path.join(dir, "b.bin"), "c3a-two");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C3a",
          "--role", "#2=extra:in",
          "--",
          stub, "a.bin", "b.bin",
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      const files = stages[0]!.files ?? [];
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const hasFlag = f["flag"] !== undefined;
        const hasIndex = f["argvIndex"] !== undefined;
        expect(hasFlag !== hasIndex).toBe(true);
      }
      const posEntry = files.find((f) => f["path"] === "b.bin")!;
      expect(posEntry["argvIndex"]).toBe(2);
      expect(posEntry["flag"]).toBeUndefined();
      type LogShape = { format: string; stages: Array<Record<string, unknown> & { files?: Array<Record<string, unknown>> }> };
      const log: LogShape = { format: "full-bake-receipts/v2", stages: [{ stage: "S", tool: "t", inputSha256: "i", outputSha256: "o" }] };
      const withNeg = structuredClone(log);
      withNeg.stages[0]!.files = [{ path: "a", sha256: "b", argvIndex: -1 }];
      expect(() => parseFullBakeReceiptLog(withNeg)).toThrow(/argvIndex must be a non-negative integer/);
      const withFrac = structuredClone(log);
      withFrac.stages[0]!.files = [{ path: "a", sha256: "b", argvIndex: 1.5 }];
      expect(() => parseFullBakeReceiptLog(withFrac)).toThrow(/argvIndex must be a non-negative integer/);
      const withBadFlag = structuredClone(log);
      withBadFlag.stages[0]!.files = [{ path: "a", sha256: "b", flag: 42 }];
      expect(() => parseFullBakeReceiptLog(withBadFlag)).toThrow(/files need path\/sha256 strings/);
      // eslint-disable-next-line no-console
      console.log(
        `C3a rc=${run.rc} entries=${files.length} pos-entry=${JSON.stringify(posEntry)} validator-negatives-rejected=3`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C3-CW: the composer accepts a 2-stage log whose stage 2 is positional-bound", async () => {
    const dir = await makeTmp("p2d2-c3cw");
    try {
      const rebindish = await writeStub(dir, "rebind_baked_skin_normal_s1", REBINDISH_STUB);
      const deriveish = await writeStub(dir, "derive_sidecar_s2", POS_DERIVEISH_STUB);
      await writeFile(path.join(dir, "a.bin"), "c3cw-src");
      await writeFile(path.join(dir, "n.bin"), "c3cw-png");
      await writeFile(path.join(dir, "o.bin"), "c3cw-anchor");
      await writeFile(path.join(dir, "r.json"), '{"bake":"c3cw"}');
      await writeFile(path.join(dir, "rep.json"), '{"report":"c3cw"}');
      await writeFile(path.join(dir, "prov-seed.json"), '{"seed":"c3cw"}');
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
          "--role", "#1=input:in",
          "--role", "#2=report:in",
          "--role", "#3=output:out",
          "--",
          deriveish,
          "shared.bin",
          "rep.json",
          "final.bin",
          "--pre-image-revision",
          "0000000000000000000000000000000000000000",
        ],
        dir,
      );
      expect(s2.rc).toBe(0);
      const stages = await readStages(dir);
      expect(stages.length).toBe(2);
      expect(stages[1]!.inputSha256).toBe(stages[0]!.outputSha256);
      for (const f of stages[1]!.files ?? []) {
        expect(f["argvIndex"]).toBeDefined();
        expect(f["flag"]).toBeUndefined();
      }
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
        `C3-CW s1rc=${s1.rc} s2rc=${s2.rc} composer-rc=${composed.rc} ` +
          `chain=${String(stages[1]!.inputSha256).slice(0, 12)}==${String(stages[0]!.outputSha256).slice(0, 12)} ` +
          `keys=${Object.keys(emitted).sort().join(",")}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("C4: positional inout substitutes the copy at that index; pre bytes stay untouched", async () => {
    const dir = await makeTmp("p2d2-c4");
    try {
      const copy = await writeStub(dir, "stub-copy", FLAG_COPY_STUB);
      const mutate = await writeStub(dir, "stub-pos-mutate", POS_MUTATE_STUB);
      await writeFile(path.join(dir, "a.bin"), "c4-src");
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
      const s2 = await runRunner(
        ["--stage-log", "stage-log.json", "--stage", "S2", "--role", "#1=file:inout", "--", mutate, "mid.bin"],
        dir,
      );
      expect(s2.rc).toBe(0);
      const stages = await readStages(dir);
      const r2 = stages[1]!;
      expect(r2.inputSha256).toBe(stages[0]!.outputSha256);
      const argv = r2.argv as string[];
      expect(argv[1]).not.toBe("mid.bin");
      const entries = r2.files ?? [];
      const preEntry = entries.find((f) => f["mode"] === "in")!;
      const inoutEntry = entries.find((f) => f["mode"] === "inout")!;
      expect(preEntry["path"]).toBe("mid.bin");
      expect(preEntry["argvIndex"]).toBe(1);
      expect(inoutEntry["argvIndex"]).toBe(1);
      expect(argv[1]).toBe(String(inoutEntry["path"]));
      const midDisk = await readFile(path.join(dir, "mid.bin"));
      const copyDisk = await readFile(path.join(dir, String(inoutEntry["path"])));
      expect(sha256(midDisk)).toBe(stages[0]!.outputSha256);
      expect(midDisk.equals(preBytes)).toBe(true);
      expect(sha256(copyDisk)).toBe(inoutEntry["postSha256"]);
      expect(inoutEntry["postSha256"]).not.toBe(inoutEntry["sha256"]);
      // eslint-disable-next-line no-console
      console.log(
        `C4 s2rc=${s2.rc} argv1=${String(argv[1])} ` +
          `pre-disk=${sha256(midDisk).slice(0, 12)}==s1out=${String(stages[0]!.outputSha256).slice(0, 12)} ` +
          `copy-disk=${sha256(copyDisk).slice(0, 12)}==post=${String(inoutEntry["postSha256"]).slice(0, 12)}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("C5: a role-bound positional index is never consumed as a preceding flag's value", async () => {
    const dir = await makeTmp("p2d2-c5");
    try {
      const stub = await writeStub(dir, "stub-noop", NOOP_STUB);
      await writeFile(path.join(dir, "a.glb"), "c5-bytes");
      const run = await runRunner(
        [
          "--stage-log", "stage-log.json",
          "--stage", "C5",
          "--role", "#2=glb:in",
          "--",
          stub, "--in-place", "a.glb",
        ],
        dir,
      );
      expect(run.rc).toBe(0);
      const stages = await readStages(dir);
      expect(stages.length).toBe(1);
      const r = stages[0]!;
      expect(r.params).toEqual({ inPlace: "true" });
      const refs = (r.files ?? []).filter((f) => f["path"] === "a.glb");
      expect(refs.length).toBe(1);
      expect(refs[0]!["argvIndex"]).toBe(2);
      expect(refs[0]!["flag"]).toBeUndefined();
      expect(JSON.stringify(r.params)).not.toContain("a.glb");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("PROBE: binding the wrong positional index refuses; rebinding to #1 passes", async () => {
    const dir = await makeTmp("p2d2-probe");
    try {
      const mutate = await writeStub(dir, "stub-argv1-mutate", ARGV1_MUTATE_STUB);
      await writeFile(path.join(dir, "t.bin"), "probe-src");
      const wrong = await runRunner(
        ["--stage-log", "stage-log.json", "--stage", "PROBE", "--role", "#2=file:inout", "--", mutate, "t.bin"],
        dir,
      );
      // eslint-disable-next-line no-console
      console.log(
        `PROBE before rc=${wrong.rc} stderr=${wrong.stderr.trim().split("\n").pop() ?? ""} ` +
          `refused=${String(wrong.rc !== 0)}`,
      );
      expect(wrong.rc).not.toBe(0);
      expect(wrong.stderr).toMatch(/out of range/);
      await rm(path.join(dir, "stage-log.json"), { force: true });
      const right = await runRunner(
        ["--stage-log", "stage-log.json", "--stage", "PROBE", "--role", "#1=file:inout", "--", mutate, "t.bin"],
        dir,
      );
      expect(right.rc).toBe(0);
      const stages = await readStages(dir);
      const inoutEntry = (stages[0]!.files ?? []).find((f) => f["mode"] === "inout")!;
      expect(inoutEntry["postSha256"]).not.toBe(inoutEntry["sha256"]);
      // eslint-disable-next-line no-console
      console.log(
        `PROBE after rc=${right.rc} pre=${String(inoutEntry["sha256"]).slice(0, 12)} ` +
          `post=${String(inoutEntry["postSha256"]).slice(0, 12)} passes=true`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
