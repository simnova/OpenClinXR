/**
 * compose-full-bake-sidecar.ts — re-compose a full-bake sidecar from receipts.
 *
 * A full bake leaves every producer's stage artifact files write-once in its
 * run dir, plus a stage log of per-stage receipts (see the fixture
 * stage-log.json for the shape, and the real stage keys it copies from
 * p2-rebake stage-log.json: stage/tool/toolSha256/cmd/inputSha256/
 * outputSha256/exit/status/writePaths/reason). The machine-readable fields a
 * producer invocation needs (files with role+sha256, params, inputPath,
 * provSeed) are an exported TypeScript type validated at startup; P2 v5's
 * bake will emit this schema. A file the stage mutated in place carries
 * postSha256 (bytes AFTER the stage; sha256 is the bytes BEFORE) with mode
 * "inout", plus the stage's exact executed argv. This writer, per stage in order:
 *
 *   1. resolves the stage input (and role) artifact files under --run-dir by
 *      receipt path, refusing when a file is absent or its bytes do not hash
 *      to the receipt sha256 (postSha256 for a file the stage mutated in
 *      place; the chain link still uses the pre value inputSha256);
 *   2. refuses when a stage inputSha256 does not equal the previous stage
 *      outputSha256 (chain break);
 *   3. records a skipped stage as a stage-log fact on stdout and invokes
 *      nothing for it (the S8 repack case);
 *   4. otherwise invokes the stage producer's existing CLI on the resolved
 *      files and advances the chain to that invocation's prov output;
 *   5. copies the final prov output verbatim to --out.
 *
 * The writer serializes no provenance block itself: every provenance byte in
 * --out is written by a producer, and --out is produced by a byte copy of
 * the final prov output only.
 *
 * Producer command resolution is injectable so tests can use stubs:
 * --producer-map <json file>, else $COMPOSE_PRODUCER_MAP (same JSON), else
 * bare producer command names resolved via PATH. Map shape:
 * {"rebind": ["cmd", ...prefix], "repack": [...], "derive": [...]}.
 *
 * Per-producer argv is exactly each producer's declared CLI:
 * rebind_baked_skin_normal.py takes its argparse block (src, new-normal,
 * out, expect-src-sha, expect-png-sha, skin-sub, old-anchor, prov-in,
 * prov-out, recipe, bake-report); repack_lash_follow.py main() declares only
 * --directory/--actor/--source-ref/--repair-sidecars-from-ref, so a
 * non-skipped repack stage is refused with STOP_producer_not_callable
 * (never invent flags); derive_sidecar.ts takes its value()-declared flags
 * (--input/--scratch/--output/--sidecar/--report/--working-directory plus
 * exactly one pre-image flag), and because derive edits --sidecar in place
 * the writer passes a scratch copy of the chained prov (outside --run-dir),
 * which becomes the new chain head.
 *
 * Stdout carries one JSON fact per line (per-stage invoke/skip records plus a
 * final out record); human diagnostics go to stderr. The per-stage prov
 * chain lives in a fresh tmp dir whose path appears in the invoke facts; the
 * writer keeps it so callers can audit the chain (callers remove it). Exit 0
 * on success, non-zero on any refusal, with --out left absent.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface ReceiptFileRef {
  path: string;
  sha256: string;
  role?: string;
  /**
   * Bytes AFTER the stage for a file the stage mutated in place (e.g.
   * teeth-rest-clearance --in-place-bytes); sha256 is the bytes BEFORE.
   * Only meaningful with mode "inout".
   */
  postSha256?: string;
  /** Same vocabulary as the P2d runner's --role <flag>=<role>[:in|:out|:inout]. */
  mode?: "in" | "out" | "inout";
  /**
   * How the runner bound this file: exactly one of flag (a "--flag" argv
   * entry) or argvIndex (a positional post-"--" argv element, 0 = first
   * token after "--") is set per files entry by the P2d2 stage runner.
   */
  flag?: string;
  argvIndex?: number;
}

export interface StageReceipt {
  stage: string;
  tool: string;
  toolSha256?: string;
  cmd?: string;
  inputSha256: string;
  outputSha256: string;
  inputPath?: string;
  outputPath?: string;
  exit?: number | null;
  status?: string;
  reason?: string;
  writePaths?: string[];
  files?: ReceiptFileRef[];
  params?: Record<string, string>;
  /** The exact executed argv array, as recorded by the P2d stage runner. */
  argv?: string[];
}

export interface FullBakeReceiptLog {
  format?: string;
  provSeed?: ReceiptFileRef;
  stages: StageReceipt[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runtime validator for the full-bake receipt schema (throws on violation). */
export function parseFullBakeReceiptLog(raw: unknown): FullBakeReceiptLog {
  if (!isRecord(raw)) throw new Error("full-bake receipt log: top level must be an object");
  const stages = raw["stages"];
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error("full-bake receipt log: stages must be a non-empty array");
  }
  const log: FullBakeReceiptLog = { stages: [] };
  if (raw["format"] !== undefined) {
    if (typeof raw["format"] !== "string") throw new Error("full-bake receipt log: format must be a string");
    log.format = raw["format"];
  }
  if (raw["provSeed"] !== undefined) {
    if (!isRecord(raw["provSeed"]) || typeof raw["provSeed"]["path"] !== "string" ||
        typeof raw["provSeed"]["sha256"] !== "string") {
      throw new Error("full-bake receipt log: provSeed must carry path/sha256 strings");
    }
    log.provSeed = {
      path: raw["provSeed"]["path"],
      sha256: raw["provSeed"]["sha256"],
    };
  }
  for (const entry of stages) {
    if (!isRecord(entry) || typeof entry["stage"] !== "string" ||
        typeof entry["tool"] !== "string" || typeof entry["inputSha256"] !== "string" ||
        typeof entry["outputSha256"] !== "string") {
      throw new Error(
        "full-bake receipt log: each stage needs stage/tool/inputSha256/outputSha256 strings",
      );
    }
    const receipt: StageReceipt = {
      stage: entry["stage"],
      tool: entry["tool"],
      inputSha256: entry["inputSha256"],
      outputSha256: entry["outputSha256"],
    };
    if (typeof entry["toolSha256"] === "string") receipt.toolSha256 = entry["toolSha256"];
    if (typeof entry["cmd"] === "string") receipt.cmd = entry["cmd"];
    if (typeof entry["inputPath"] === "string") receipt.inputPath = entry["inputPath"];
    if (typeof entry["outputPath"] === "string") receipt.outputPath = entry["outputPath"];
    if (typeof entry["exit"] === "number" || entry["exit"] === null) receipt.exit = entry["exit"];
    if (typeof entry["status"] === "string") receipt.status = entry["status"];
    if (typeof entry["reason"] === "string") receipt.reason = entry["reason"];
    if (Array.isArray(entry["writePaths"])) {
      receipt.writePaths = entry["writePaths"].filter(
        (p): p is string => typeof p === "string",
      );
    }
    if (entry["files"] !== undefined) {
      if (!Array.isArray(entry["files"])) {
        throw new Error(`full-bake receipt log: stage ${receipt.stage} files must be an array`);
      }
      receipt.files = entry["files"].map((file) => {
        if (!isRecord(file) || typeof file["path"] !== "string" ||
            typeof file["sha256"] !== "string" ||
            (file["role"] !== undefined && typeof file["role"] !== "string") ||
            (file["postSha256"] !== undefined && typeof file["postSha256"] !== "string") ||
            (file["mode"] !== undefined && typeof file["mode"] !== "string") ||
            (file["flag"] !== undefined && typeof file["flag"] !== "string") ||
            (file["argvIndex"] !== undefined && typeof file["argvIndex"] !== "number")) {
          throw new Error(
            `full-bake receipt log: stage ${receipt.stage} files need path/sha256 strings`,
          );
        }
        if (typeof file["argvIndex"] === "number" &&
            (!Number.isInteger(file["argvIndex"]) || file["argvIndex"] < 0)) {
          throw new Error(
            `full-bake receipt log: stage ${receipt.stage} file ${file["path"]} ` +
              `argvIndex must be a non-negative integer`,
          );
        }
        if (file["mode"] !== undefined &&
            file["mode"] !== "in" && file["mode"] !== "out" && file["mode"] !== "inout") {
          throw new Error(
            `full-bake receipt log: stage ${receipt.stage} file ${file["path"]} ` +
              `mode must be "in", "out" or "inout"`,
          );
        }
        if (file["postSha256"] !== undefined && file["mode"] !== "inout") {
          throw new Error(
            `full-bake receipt log: stage ${receipt.stage} file ${file["path"]} ` +
              `carries postSha256 without mode "inout"; refusing`,
          );
        }
        const ref: ReceiptFileRef = { path: file["path"], sha256: file["sha256"] };
        if (typeof file["role"] === "string") ref.role = file["role"];
        if (typeof file["postSha256"] === "string") ref.postSha256 = file["postSha256"];
        if (typeof file["flag"] === "string") ref.flag = file["flag"];
        if (typeof file["argvIndex"] === "number") ref.argvIndex = file["argvIndex"];
        if (file["mode"] === "in" || file["mode"] === "out" || file["mode"] === "inout") {
          ref.mode = file["mode"];
        }
        return ref;
      });
    }
    if (entry["params"] !== undefined) {
      if (!isRecord(entry["params"]) ||
          !Object.values(entry["params"]).every((v) => typeof v === "string")) {
        throw new Error(
          `full-bake receipt log: stage ${receipt.stage} params must be a string record`,
        );
      }
      receipt.params = entry["params"] as Record<string, string>;
    }
    if (entry["argv"] !== undefined) {
      if (!Array.isArray(entry["argv"]) ||
          !entry["argv"].every((a): a is string => typeof a === "string")) {
        throw new Error(
          `full-bake receipt log: stage ${receipt.stage} argv must be a string array`,
        );
      }
      receipt.argv = [...entry["argv"]];
    }
    log.stages.push(receipt);
  }
  return log;
}

type ProducerKind = "rebind" | "repack" | "derive";

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function refuse(message: string, code = 3): never {
  process.stderr.write(`compose-full-bake-sidecar: refusing: ${message}\n`);
  process.exit(code);
}

function fact(record: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  return argv[i + 1];
}

/**
 * The on-disk expectation for a receipt file: postSha256 when the stage
 * mutated the file in place, else the (pre-stage) sha256. The chain link
 * still uses the stage-level inputSha256 (the pre value).
 */
function expectedOnDiskSha(hit: ReceiptFileRef): { sha: string; post: boolean } {
  if (hit.postSha256 !== undefined) return { sha: hit.postSha256, post: true };
  return { sha: hit.sha256, post: false };
}

function mismatchMessage(entry: StageReceipt, rel: string, receiptSha: string, actual: string, post: boolean): string {
  const which = post ? "postSha256" : "sha256";
  return (
    `stage ${entry.stage}: file sha256 mismatch at ${rel}: ` +
      `receipt ${which} ${receiptSha}, actual ${actual} ` +
      `(inputSha256 ${entry.inputSha256} outputSha256 ${entry.outputSha256})`
  );
}

function rolePath(entry: StageReceipt, role: string, runDir: string): string {
  const hit = (entry.files ?? []).find((f) => f.role === role);
  if (!hit) refuse(`stage ${entry.stage}: receipt names no "${role}" file`);
  const abs = path.join(runDir, hit.path);
  if (!existsSync(abs)) {
    refuse(
      `stage ${entry.stage}: receipt artifact absent under run dir: ${hit.path} ` +
        `(inputSha256 ${entry.inputSha256} outputSha256 ${entry.outputSha256})`,
    );
  }
  const { sha, post } = expectedOnDiskSha(hit);
  const actual = sha256File(abs);
  if (actual !== sha) {
    refuse(mismatchMessage(entry, hit.path, sha, actual, post));
  }
  return abs;
}

function param(entry: StageReceipt, name: string): string {
  const value = entry.params?.[name];
  if (!value) refuse(`stage ${entry.stage}: receipt names no param "${name}"`);
  return value;
}

function classify(tool: string, stage: string): ProducerKind {
  if (tool.includes("rebind_baked_skin_normal")) return "rebind";
  if (tool.includes("repack_lash_follow")) return "repack";
  if (tool.includes("derive_sidecar")) return "derive";
  refuse(`stage ${stage}: no producer mapping for tool ${tool}`);
}

function resolveCommands(mapPath: string | undefined): Record<ProducerKind, string[]> {
  const fallback: Record<ProducerKind, string[]> = {
    rebind: ["rebind_baked_skin_normal.py"],
    repack: ["repack_lash_follow.py"],
    derive: ["derive_sidecar"],
  };
  const raw = mapPath !== undefined
    ? readFileSync(mapPath, "utf8")
    : (process.env["COMPOSE_PRODUCER_MAP"] ?? "");
  if (raw.trim().length === 0) return fallback;
  const parsed = JSON.parse(raw) as Partial<Record<ProducerKind, string[]>>;
  return {
    rebind: parsed.rebind ?? fallback.rebind,
    repack: parsed.repack ?? fallback.repack,
    derive: parsed.derive ?? fallback.derive,
  };
}

/** Declared flags of repack_lash_follow.py main(), read from its own source. */
function repackDeclaredFlags(toolRel: string, stage: string): string[] {
  let src: string;
  try {
    src = readFileSync(path.resolve(process.cwd(), toolRel), "utf8");
  } catch {
    refuse(
      `STOP_producer_not_callable repack: stage ${stage}: tool source unreadable ` +
        `at ${toolRel} (from ${process.cwd()}); refusing rather than inventing flags`,
    );
  }
  return [...new Set(
    [...src.matchAll(/add_argument\(\s*"(--[a-z0-9-]+)"/g)].map((m) => m[1] as string),
  )];
}

function invokeProducer(
  command: string[],
  argv: string[],
  stage: string,
): void {
  try {
    const childOut = execFileSync(command[0]!, [...command.slice(1), ...argv], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (childOut.length > 0) process.stderr.write(childOut);
  } catch (error) {
    const failure = error as { status?: unknown };
    const status = typeof failure.status === "number" ? failure.status : 4;
    refuse(`stage ${stage}: producer ${command[0]} exited ${String(status)}`, status === 0 ? 4 : status);
  }
}

function derivePreImageFlag(entry: StageReceipt, runDir: string): string[] {
  const file = (entry.files ?? []).find((f) => f.role === "pre-image");
  if (file) return ["--pre-image-file", rolePath(entry, "pre-image", runDir)];
  const revision = entry.params?.["preImageRevision"];
  if (revision) return ["--pre-image-revision", revision];
  refuse(
    `stage ${entry.stage}: receipt names neither a "pre-image" file nor a preImageRevision param`,
  );
}

function main(argv: string[]): void {
  const logPath = flagValue(argv, "--stage-log");
  const runDirArg = flagValue(argv, "--run-dir");
  const outPath = flagValue(argv, "--out");
  const mapPath = flagValue(argv, "--producer-map");
  if (!logPath || !runDirArg || !outPath) {
    process.stderr.write(
      "usage: compose-full-bake-sidecar.ts --stage-log <json> --run-dir <dir> --out <sidecar> [--producer-map <json>]\n",
    );
    process.exit(2);
  }
  const runDir = path.resolve(runDirArg);
  let log: FullBakeReceiptLog;
  try {
    log = parseFullBakeReceiptLog(JSON.parse(readFileSync(logPath, "utf8")));
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error));
  }
  const entries = log.stages;

  for (let i = 1; i < entries.length; i += 1) {
    const prev = entries[i - 1]!;
    const cur = entries[i]!;
    if (cur.inputSha256 !== prev.outputSha256) {
      refuse(
        `chain break at stage ${cur.stage}: inputSha256 ${cur.inputSha256} ` +
          `!= previous outputSha256 ${prev.outputSha256}`,
      );
    }
  }

  const seed = log.provSeed;
  if (!seed) refuse("log holds no prov seed binding");
  const seedAbs = path.join(runDir, seed.path);
  if (!existsSync(seedAbs)) {
    refuse(`prov seed absent under run dir: ${seed.path} (seed sha256 ${seed.sha256})`);
  }
  if (sha256File(seedAbs) !== seed.sha256) {
    refuse(
      `prov seed sha256 mismatch at ${seed.path}: receipt ${seed.sha256}, ` +
        `actual ${sha256File(seedAbs)}`,
    );
  }

  for (const entry of entries) {
    if (entry.status === "skipped") continue;
    if (!entry.inputPath) refuse(`stage ${entry.stage}: receipt names no inputPath`);
    const abs = path.join(runDir, entry.inputPath);
    if (!existsSync(abs)) {
      refuse(
        `stage ${entry.stage}: receipt artifact absent under run dir: ${entry.inputPath} ` +
          `(inputSha256 ${entry.inputSha256} outputSha256 ${entry.outputSha256})`,
      );
    }
    // An in-place stage rewrites its input: the same path is then carried in
    // files[] with postSha256, and the on-disk bytes are the post bytes even
    // though the chain link (inputSha256) is the pre value.
    const samePathPost = (entry.files ?? []).find((f) => f.path === entry.inputPath)?.postSha256;
    const wantInput = samePathPost ?? entry.inputSha256;
    const actual = sha256File(abs);
    if (actual !== wantInput) {
      refuse(
        mismatchMessage(entry, entry.inputPath, wantInput, actual, samePathPost !== undefined),
      );
    }
    for (const roleFile of entry.files ?? []) {
      const roleAbs = path.join(runDir, roleFile.path);
      if (!existsSync(roleAbs)) {
        refuse(
          `stage ${entry.stage}: receipt artifact absent under run dir: ${roleFile.path} ` +
            `(inputSha256 ${entry.inputSha256} outputSha256 ${entry.outputSha256})`,
        );
      }
      const { sha, post } = expectedOnDiskSha(roleFile);
      const roleActual = sha256File(roleAbs);
      if (roleActual !== sha) {
        refuse(mismatchMessage(entry, roleFile.path, sha, roleActual, post));
      }
    }
  }

  const commands = resolveCommands(mapPath);
  const scratch = mkdtempSync(path.join(tmpdir(), "compose-full-bake-"));
  let lastProv = seedAbs;
  for (const entry of entries) {
    if (entry.status === "skipped") {
      fact({ stage: entry.stage, status: "skipped", reason: entry.reason ?? "" });
      continue;
    }
    const kind = classify(entry.tool, entry.stage);
    if (kind === "repack") {
      const flags = repackDeclaredFlags(entry.tool, entry.stage);
      refuse(
        `STOP_producer_not_callable repack: stage ${entry.stage}: ` +
          `${entry.tool} declares [${flags.join(" ")}]; ` +
          `no receipt-callable invocation exists; refusing rather than inventing flags`,
      );
    }
    if (kind === "rebind") {
      const provOut = path.join(scratch, `prov-${entry.stage}.json`);
      const pngSha = (entry.files ?? []).find((f) => f.role === "new-normal")?.sha256;
      if (!pngSha) refuse(`stage ${entry.stage}: receipt names no "new-normal" file`);
      invokeProducer(commands.rebind, [
        "--src", rolePath(entry, "src", runDir),
        "--new-normal", rolePath(entry, "new-normal", runDir),
        "--out", path.join(scratch, `out-${entry.stage}.bin`),
        "--expect-src-sha", entry.inputSha256,
        "--expect-png-sha", pngSha,
        "--skin-sub", param(entry, "skinSub"),
        "--old-anchor", rolePath(entry, "old-anchor", runDir),
        "--prov-in", lastProv,
        "--prov-out", provOut,
        "--recipe", param(entry, "recipe"),
        "--bake-report", rolePath(entry, "bake-report", runDir),
      ], entry.stage);
      fact({ stage: entry.stage, action: "invoke", producer: kind, provIn: lastProv, provOut });
      lastProv = provOut;
    } else {
      const sidecarCopy = path.join(scratch, `prov-${entry.stage}.json`);
      copyFileSync(lastProv, sidecarCopy);
      const deriveScratch = path.join(scratch, `derive-${entry.stage}`);
      mkdirSync(deriveScratch, { recursive: true });
      invokeProducer(commands.derive, [
        "--input", path.join(runDir, entry.inputPath!),
        "--scratch", deriveScratch,
        "--output", path.join(scratch, `out-${entry.stage}.bin`),
        "--sidecar", sidecarCopy,
        "--report", rolePath(entry, "report", runDir),
        ...derivePreImageFlag(entry, runDir),
        "--working-directory", runDir,
      ], entry.stage);
      fact({ stage: entry.stage, action: "invoke", producer: kind, provIn: lastProv, provOut: sidecarCopy });
      lastProv = sidecarCopy;
    }
  }
  copyFileSync(lastProv, path.resolve(outPath));
  fact({ out: path.resolve(outPath), sha256: sha256File(path.resolve(outPath)) });
}

const invokedAsScript = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main(process.argv.slice(2));
}
