/**
 * run-stage.ts — execute one stage argv and append the measured receipt.
 *
 * A stage log written by hand is a claim without evidence. This runner is
 * the only P2 v6 path to a stage receipt: it execs the given argv array
 * (spawnSync, never a shell string), measures real bytes before and after,
 * and appends exactly one receipt to --stage-log. The receipt shape is the
 * P2b exported StageReceipt/ReceiptFileRef type plus its runtime validator,
 * imported here and never redeclared.
 *
 * CLI:
 *   run-stage.ts --stage-log <json> --stage <id>
 *     [--role <flag>=<role>[:in|:out|:inout]]... [--tool <path>]
 *     -- <argv...>
 *
 * Role mapping: each --role names one argv flag carrying a stage file and
 * the role that file plays, with the access mode suffix (default in):
 *   in    hashed BEFORE exec; the on-disk pre bytes are the evidence.
 *   out   hashed AFTER exec; the produced bytes are the evidence.
 *   inout the input is FIRST copied to a fresh stage path under the run
 *         dir (the directory holding --stage-log); the copy path, taken
 *         relative to the runner cwd, replaces the argv value and the tool
 *         runs on the copy. The pre file stays unmodified and is hashed to
 *         sha256; the copy hashes to postSha256 with mode inout. No second
 *         path field exists on the imported file type, and none is needed:
 *         the pre path is carried by inputPath AND by a leading
 *         {path: <pre path>, sha256: preSha, role, mode: "in"} files entry
 *         emitted before the inout entry for every inout role, so no pre
 *         path is lost; the copy is carried by the files entry with
 *         sha256=pre/postSha256=post/mode=inout. The imported validator
 *         accepts mode "in" entries without postSha256, so no
 *         STOP_schema_insufficient. Composer-compatible logs need the runner
 *         cwd to equal the run dir so the copy path resolves under it.
 * Flags in the executed argv that are not role-mapped become string params
 * under their dash-stripped name, folded from kebab-case to camelCase to
 * match the receipt convention the composer enforces (skin-sub becomes
 * skinSub, pre-image-revision becomes preImageRevision); boolean flags
 * record "true".
 *
 * Identity and chain fields:
 *   inputSha256  sha256 of the first in/inout pre file, BEFORE exec.
 *   outputSha256 sha256 of the first out file, else of the inout copy,
 *                else of the input itself, AFTER exec.
 *   inputPath    the pre path as passed; outputPath the out path, else the
 *                copy path, else the pre path.
 *   tool/toolSha256 the script the interpreter runs: the first argv element
 *                whose realpath is a file INSIDE the repo root (walk-up from
 *                the runner to pnpm-workspace.yaml), or --tool when given.
 *                A bare interpreter (python3, node), launcher (mise),
 *                renderer (blender), or any absolute binary outside the repo
 *                (e.g. process.execPath) never counts, so it is never recorded.
 *   exit/status  the child exit code (null on signal) with ok/failed.
 *
 * The runner appends even on a non-zero tool exit (the failure is the
 * evidence: exit plus failed status, with a missing :out entry omitted and
 * outputSha256/outputPath falling back to the input -- the imported
 * validator demands "each stage needs stage/tool/inputSha256/outputSha256
 * strings" so outputSha256 is always present). It refuses (rc 4, no append)
 * only when the tool exits 0 but leaves a named output absent.
 * It appends nothing when nothing ran (unreadable tool, missing input,
 * spawn failure) or when the combined log fails the imported validator.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReceiptFileRef, StageReceipt } from "./compose-full-bake-sidecar.js";
import { parseFullBakeReceiptLog } from "./compose-full-bake-sidecar.js";

type RoleMode = "in" | "out" | "inout";

interface RoleBinding {
  flag: string;
  role: string;
  mode: RoleMode;
}

function fail(message: string, code = 2): never {
  process.stderr.write(`run-stage: refusing: ${message}\n`);
  process.exit(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

let cachedRepoRoot: string | undefined;

/** Repo root by walking up from the runner to pnpm-workspace.yaml. */
function runnerRepoRoot(): string {
  if (cachedRepoRoot !== undefined) return cachedRepoRoot;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      cachedRepoRoot = realpathSync(dir);
      return cachedRepoRoot;
    }
    const parent = path.dirname(dir);
    if (parent === dir) fail("run-stage: cannot locate repo root (no pnpm-workspace.yaml above runner)");
    dir = parent;
  }
}

/** True when abs realpaths to a location inside the repo root. */
function isInsideRepo(abs: string, root: string): boolean {
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return false;
  }
  const rel = path.relative(root, real);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function parseRole(spec: string, stage: string): RoleBinding {
  const eq = spec.indexOf("=");
  if (eq < 0) fail(`stage ${stage}: role "${spec}" needs <flag>=<role>[:mode]`);
  const flag = spec.slice(0, eq);
  const rest = spec.slice(eq + 1);
  if (!flag.startsWith("--") || flag.length <= 2 || rest.length === 0) {
    fail(`stage ${stage}: role "${spec}" needs <flag>=<role>[:mode]`);
  }
  const colon = rest.lastIndexOf(":");
  let role = rest;
  let mode: RoleMode = "in";
  if (colon >= 0) {
    role = rest.slice(0, colon);
    const rawMode = rest.slice(colon + 1);
    if (rawMode !== "in" && rawMode !== "out" && rawMode !== "inout") {
      fail(`stage ${stage}: role "${spec}" mode must be one of in, out, inout`);
    }
    mode = rawMode;
    if (role.length === 0) fail(`stage ${stage}: role "${spec}" names no role`);
  }
  return { flag, role, mode };
}

/** Locate a role flag value in argv; supports "--flag value" form. */
function flagValue(argv: string[], flag: string, stage: string): { index: number; value: string } {
  const index = argv.indexOf(flag);
  if (index < 0) fail(`stage ${stage}: argv carries no ${flag}`);
  const value = argv[index + 1];
  if (value === undefined) fail(`stage ${stage}: ${flag} names no value`);
  return { index, value };
}

function freshStagePath(runDir: string, stage: string, base: string): string {
  const leaf = path.basename(base);
  for (let n = 0; n < 1000; n += 1) {
    const name = n === 0 ? `${stage}-${leaf}` : `${stage}-${leaf}-${n}`;
    const abs = path.join(runDir, name);
    if (!existsSync(abs)) return abs;
  }
  fail(`stage ${stage}: no fresh stage path under the run dir for ${leaf}`);
}

/** Fold a dashed flag body to the camelCase receipt param key. */
function toParamKey(flagBody: string): string {
  const parts = flagBody.split("-").filter((part) => part.length > 0);
  return parts
    .map((part, index) =>
      index === 0 ? part : part.slice(0, 1).toUpperCase() + part.slice(1),
    )
    .join("");
}

function main(rawArgs: string[]): void {
  let logPath: string | undefined;
  let stage: string | undefined;
  let toolOverride: string | undefined;
  const roles: RoleBinding[] = [];
  let toolArgv: string[] | undefined;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const token = rawArgs[i];
    if (token === "--") {
      toolArgv = rawArgs.slice(i + 1);
      break;
    }
    if (token === "--stage-log" || token === "--stage" || token === "--role" || token === "--tool") {
      const value = rawArgs[i + 1];
      if (value === undefined) fail(`option ${token} names no value`);
      if (token === "--stage-log") logPath = value;
      else if (token === "--stage") stage = value;
      else if (token === "--tool") toolOverride = value;
      else roles.push(parseRole(value, stage ?? "<unknown>"));
      i += 1;
      continue;
    }
    fail(`unexpected argument "${token ?? ""}"; usage ends with -- <argv...>`);
  }
  if (logPath === undefined || stage === undefined || toolArgv === undefined) {
    fail("usage: run-stage.ts --stage-log <json> --stage <id> [--role ...] [--tool <path>] -- <argv...>");
  }
  if (toolArgv.length === 0) fail(`stage ${stage}: no argv to execute`);
  const seen = new Set<string>();
  for (const binding of roles) {
    if (seen.has(binding.flag)) fail(`stage ${stage}: duplicate role for ${binding.flag}`);
    seen.add(binding.flag);
    if (toolArgv.indexOf(binding.flag) < 0) {
      fail(`stage ${stage}: argv carries no ${binding.flag}`);
    }
  }

  const runDir = path.dirname(path.resolve(logPath));

  const repoRoot = runnerRepoRoot();
  let tool = toolOverride;
  if (tool === undefined) {
    for (const token of toolArgv) {
      const abs = path.resolve(token);
      if (!isFile(abs)) continue;
      if (!isInsideRepo(abs, repoRoot)) continue;
      tool = token;
      break;
    }
  }
  if (tool === undefined) {
    fail(`stage ${stage}: no argv element resolves to a tool file (${toolArgv.join(" ")})`);
  }
  const toolAbs = path.resolve(tool);
  if (!isFile(toolAbs)) fail(`stage ${stage}: tool file absent: ${tool}`);
  const toolSha256 = sha256File(toolAbs);

  const executed = [...toolArgv];
  const inFiles: Array<{ binding: RoleBinding; given: string; sha: string }> = [];
  const outFiles: Array<{ binding: RoleBinding; given: string }> = [];
  const inoutFiles: Array<{
    binding: RoleBinding;
    preGiven: string;
    preSha: string;
    copyGiven: string;
    copyAbs: string;
  }> = [];

  for (const binding of roles) {
    const found = flagValue(executed, binding.flag, stage);
    if (binding.mode === "in") {
      const abs = path.resolve(found.value);
      if (!isFile(abs)) fail(`stage ${stage}: input file absent: ${found.value}`);
      inFiles.push({ binding, given: found.value, sha: sha256File(abs) });
    } else if (binding.mode === "out") {
      outFiles.push({ binding, given: found.value });
    } else {
      const preAbs = path.resolve(found.value);
      if (!isFile(preAbs)) fail(`stage ${stage}: input file absent: ${found.value}`);
      const preSha = sha256File(preAbs);
      const copyAbs = freshStagePath(runDir, stage, found.value);
      copyFileSync(preAbs, copyAbs);
      const copyGiven = path.relative(process.cwd(), copyAbs);
      executed[found.index + 1] = copyGiven;
      inoutFiles.push({ binding, preGiven: found.value, preSha, copyGiven, copyAbs });
    }
  }

  const primaryIn = inFiles[0] ?? inoutFiles[0];
  if (primaryIn === undefined) {
    fail(`stage ${stage}: no in or inout role file; inputSha256 is undefined; refusing`);
  }
  const inputPath = primaryIn && "given" in primaryIn ? primaryIn.given : (primaryIn as { preGiven: string }).preGiven;
  const inputSha256 = primaryIn && "sha" in primaryIn ? primaryIn.sha : (primaryIn as { preSha: string }).preSha;

  const first = executed[0];
  if (first === undefined) fail(`stage ${stage}: no argv to execute`);
  const child = spawnSync(first, executed.slice(1), { stdio: "inherit" });
  if (child.error !== undefined) {
    fail(`stage ${stage}: spawn failed: ${String(child.error.message ?? child.error)}`, 4);
  }
  const exitCode = child.status;
  const exitField: number | null = exitCode;
  const statusField = exitCode === 0 ? "ok" : "failed";

  const files: ReceiptFileRef[] = [];
  for (const entry of inFiles) {
    files.push({ path: entry.given, sha256: entry.sha, role: entry.binding.role, mode: "in" });
  }
  const recordedOuts: Array<{ binding: RoleBinding; given: string }> = [];
  for (const entry of outFiles) {
    const abs = path.resolve(entry.given);
    if (!isFile(abs)) {
      if (exitCode !== 0) continue;
      fail(`stage ${stage}: output file absent after exec: ${entry.given}`, 4);
    }
    recordedOuts.push(entry);
    files.push({ path: entry.given, sha256: sha256File(abs), role: entry.binding.role, mode: "out" });
  }
  for (const entry of inoutFiles) {
    files.push({ path: entry.preGiven, sha256: entry.preSha, role: entry.binding.role, mode: "in" });
    if (!isFile(entry.copyAbs)) {
      if (exitCode !== 0) continue;
      fail(`stage ${stage}: stage copy absent after exec: ${entry.copyGiven}`, 4);
    }
    files.push({
      path: entry.copyGiven,
      sha256: entry.preSha,
      postSha256: sha256File(entry.copyAbs),
      role: entry.binding.role,
      mode: "inout",
    });
  }

  let outputPath: string;
  let outputSha256: string;
  const primaryOut = recordedOuts[0];
  const primaryCopy = inoutFiles.find((entry) => isFile(entry.copyAbs));
  if (primaryOut !== undefined) {
    outputPath = primaryOut.given;
    outputSha256 = sha256File(path.resolve(primaryOut.given));
  } else if (primaryCopy !== undefined && isFile(primaryCopy.copyAbs)) {
    outputPath = primaryCopy.copyGiven;
    outputSha256 = sha256File(primaryCopy.copyAbs);
  } else {
    outputPath = inputPath;
    outputSha256 = inputSha256;
  }

  const roleFlags = new Set(roles.map((binding) => binding.flag));
  const params: Record<string, string> = {};
  for (let i = 1; i < executed.length; i += 1) {
    const token = executed[i];
    if (token === undefined || !token.startsWith("--") || token.length <= 2) continue;
    const eq = token.indexOf("=");
    let rawName: string;
    let value: string;
    if (eq >= 0) {
      rawName = token.slice(2, eq);
      value = token.slice(eq + 1);
    } else {
      rawName = token.slice(2);
      const next = executed[i + 1];
      value = next !== undefined && !next.startsWith("--") ? next : "true";
    }
    if (rawName.length === 0 || roleFlags.has(`--${rawName}`)) continue;
    const key = toParamKey(rawName);
    if (key.length === 0) continue;
    params[key] = value;
  }

  const receipt: StageReceipt = {
    stage,
    tool,
    toolSha256,
    cmd: executed.join(" "),
    inputSha256,
    outputSha256,
    inputPath,
    outputPath,
    exit: exitField,
    status: statusField,
    writePaths: [outputPath],
    files,
    params,
    argv: [...executed],
  };

  let combined: Record<string, unknown>;
  if (!existsSync(logPath)) {
    combined = { format: "full-bake-receipts/v2", stages: [receipt] };
  } else {
    let previous: unknown;
    try {
      previous = JSON.parse(readFileSync(logPath, "utf8")) as unknown;
    } catch {
      fail(`stage ${stage}: existing stage log is not JSON: ${logPath}`, 3);
    }
    if (!isRecord(previous)) fail(`stage ${stage}: existing stage log is not an object`, 3);
    const oldStages = Array.isArray(previous["stages"]) ? previous["stages"] : [];
    combined = { ...previous, stages: [...oldStages, receipt] };
  }
  try {
    parseFullBakeReceiptLog(combined);
  } catch (error) {
    fail(`stage ${stage}: combined log fails validation: ${error instanceof Error ? error.message : String(error)}`, 3);
  }
  writeFileSync(logPath, `${JSON.stringify(combined, null, 1)}\n`);
  process.stderr.write(
    `run-stage: stage ${stage} exit ${String(exitField)} status ${statusField} ` +
      `files ${String(files.length)} params ${String(Object.keys(params).length)} -> ${logPath}\n`,
  );
  process.exit(exitCode ?? 1);
}

main(process.argv.slice(2));
