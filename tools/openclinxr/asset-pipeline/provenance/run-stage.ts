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
 *     [--role <flag>=<role>[:in|:out|:inout]]... [--role '#<argvIndex>=<role>[:in|:out|:inout]']...
 *     [--observe <path>=<role>[:in|:out|:inout]]...
 *     [--tool <path>] -- <argv...>
 *
 * Role mapping: each --role names either one argv flag carrying a stage file
 * (--flag=<role>[:mode]) or one positional post-"--" argv element
 * (#<argvIndex>=<role>[:mode]), where 0 is the first token after "--" (so
 * #0 is usually the tool itself and #1 its first argument). The positional
 * form exists for shipped nurse S9 tools that take the GLB positionally
 * (teeth-rest-clearance.ts "$2" --delta; tongue-forward-place.ts "$2";
 * couple-fitted-teeth-to-lip-viseme.ts <glb>; decimate_teeth.mts <glb>
 * --in-place) and therefore carry no flag the flag form could map.
 * Both forms share the access mode suffix (default in) and semantics:
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
 * Observed files: --observe <path>=<role>[:mode] (default in) binds a file
 * the executed argv does NOT name -- the shipped nurse S1 materialize
 * output GLB (not in argv; argparse forbids extra tokens), the S4
 * bake-humanoid-albedo outdir file (no file flag), the S6 licence notice
 * scan (hardcoded HUMANOIDS dir, ignores argv). The executed argv is
 * exactly the post-"--" argv: --observe never adds, removes or substitutes
 * an argv token (no copy for inout: the tool writes the path in place).
 *   in    hashed BEFORE exec; the path must exist pre-run.
 *   out   hashed AFTER exec; a pre-existing file with identical bytes
 *         post-run is refused ("observed output unchanged"); absence after
 *         a 0 exit is refused.
 *   inout hashed BEFORE and AFTER, recorded as sha256 + postSha256; equal
 *         pre/post bytes are recorded, not refused.
 * An observed path resolving (path.resolve) to a file bound by --flag or
 * #argvIndex in the same stage is refused, as is an absent :in/:inout path
 * or one observed path named twice. Receipt entries carry
 * {path, sha256, role, mode, observed: true} (+ postSha256 for inout) with
 * exactly one binding tag (flag, argvIndex, or observed). Argv-bound
 * bindings keep precedence for inputSha256/outputSha256; observed files
 * fill them only when no argv-bound file of that kind exists (outputs:
 * observed :out first, then observed :inout postSha256).
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
  flag?: string;
  argvIndex?: number;
  role: string;
  mode: RoleMode;
}

/** A file the executed argv does not name, bound by --observe <path>=.... */
interface ObservedBinding {
  observed: true;
  path: string;
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

function splitRoleTail(rest: string, spec: string, stage: string): { role: string; mode: RoleMode } {
  const colon = rest.lastIndexOf(":");
  if (colon < 0) return { role: rest, mode: "in" };
  const role = rest.slice(0, colon);
  const rawMode = rest.slice(colon + 1);
  if (rawMode !== "in" && rawMode !== "out" && rawMode !== "inout") {
    fail(`stage ${stage}: role "${spec}" mode must be one of in, out, inout`);
  }
  if (role.length === 0) fail(`stage ${stage}: role "${spec}" names no role`);
  return { role, mode: rawMode };
}

function parseRole(spec: string, stage: string): RoleBinding {
  const eq = spec.indexOf("=");
  if (eq < 0) fail(`stage ${stage}: role "${spec}" needs <flag>=<role>[:mode]`);
  const head = spec.slice(0, eq);
  const { role, mode } = splitRoleTail(spec.slice(eq + 1), spec, stage);
  if (head.startsWith("#")) {
    const digits = head.slice(1);
    if (!/^\d+$/.test(digits) || role.length === 0) {
      fail(`stage ${stage}: role "${spec}" needs #<argvIndex>=<role>[:mode] with 0 = first token after "--"`);
    }
    return { argvIndex: Number(digits), role, mode };
  }
  if (!head.startsWith("--") || head.length <= 2 || role.length === 0) {
    fail(`stage ${stage}: role "${spec}" needs <flag>=<role>[:mode]`);
  }
  return { flag: head, role, mode };
}

function parseObserve(spec: string, stage: string): ObservedBinding {
  const eq = spec.indexOf("=");
  if (eq < 0) fail(`stage ${stage}: observe "${spec}" needs <path>=<role>[:mode]`);
  const given = spec.slice(0, eq);
  if (given.length === 0) fail(`stage ${stage}: observe "${spec}" needs <path>=<role>[:mode]`);
  const { role, mode } = splitRoleTail(spec.slice(eq + 1), spec, stage);
  if (role.length === 0) fail(`stage ${stage}: observe "${spec}" needs <path>=<role>[:mode]`);
  return { observed: true, path: given, role, mode };
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
  const observes: ObservedBinding[] = [];
  let toolArgv: string[] | undefined;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const token = rawArgs[i];
    if (token === "--") {
      toolArgv = rawArgs.slice(i + 1);
      break;
    }
    if (token === "--stage-log" || token === "--stage" || token === "--role" || token === "--tool" || token === "--observe") {
      const value = rawArgs[i + 1];
      if (value === undefined) fail(`option ${token} names no value`);
      if (token === "--stage-log") logPath = value;
      else if (token === "--stage") stage = value;
      else if (token === "--tool") toolOverride = value;
      else if (token === "--observe") observes.push(parseObserve(value, stage ?? "<unknown>"));
      else roles.push(parseRole(value, stage ?? "<unknown>"));
      i += 1;
      continue;
    }
    fail(`unexpected argument "${token ?? ""}"; usage ends with -- <argv...>`);
  }
  if (logPath === undefined || stage === undefined || toolArgv === undefined) {
    fail("usage: run-stage.ts --stage-log <json> --stage <id> [--role ...] [--observe ...] [--tool <path>] -- <argv...>");
  }
  if (toolArgv.length === 0) fail(`stage ${stage}: no argv to execute`);
  const seenFlags = new Set<string>();
  const seenIndices = new Set<number>();
  for (const binding of roles) {
    if (binding.flag !== undefined) {
      if (seenFlags.has(binding.flag)) fail(`stage ${stage}: duplicate role for ${binding.flag}`);
      seenFlags.add(binding.flag);
      if (toolArgv.indexOf(binding.flag) < 0) {
        fail(`stage ${stage}: argv carries no ${binding.flag}`);
      }
    } else {
      const index = binding.argvIndex as number;
      if (seenIndices.has(index)) fail(`stage ${stage}: duplicate role for #${index}`);
      seenIndices.add(index);
      if (index >= toolArgv.length) {
        fail(`stage ${stage}: positional #${index} out of range: argv holds ${toolArgv.length} tokens`);
      }
      const token = toolArgv[index] as string;
      if (token.startsWith("-")) {
        fail(`stage ${stage}: positional #${index} points at flag token "${token}"; refusing`);
      }
    }
  }
  // One file bound both positionally and by flag (same resolved path) is
  // refused: the two entries would double-count one evidence file.
  // An observed path resolving to an argv-bound file is refused for the
  // same reason: the file already has a flag/argvIndex tag.
  const boundAbs = new Set<string>();
  for (const binding of roles) {
    if (binding.flag !== undefined) {
      boundAbs.add(path.resolve(flagValue(toolArgv, binding.flag, stage).value));
    } else {
      boundAbs.add(path.resolve(toolArgv[binding.argvIndex as number] as string));
    }
  }
  const observedSeen = new Set<string>();
  for (const observed of observes) {
    const abs = path.resolve(observed.path);
    if (observedSeen.has(abs)) {
      fail(`stage ${stage}: duplicate observe for "${observed.path}"; refusing`);
    }
    observedSeen.add(abs);
    if (boundAbs.has(abs)) {
      fail(`stage ${stage}: observed path "${observed.path}" is already bound by --flag or #argvIndex in the same stage; refusing`);
    }
    if ((observed.mode === "in" || observed.mode === "inout") && !isFile(abs)) {
      fail(`stage ${stage}: observed input file absent: ${observed.path}`);
    }
  }
  if (seenFlags.size > 0 && seenIndices.size > 0) {
    const flagPaths = new Set<string>();
    for (const binding of roles) {
      if (binding.flag === undefined) continue;
      const found = flagValue(toolArgv, binding.flag, stage);
      flagPaths.add(path.resolve(found.value));
    }
    for (const binding of roles) {
      if (binding.argvIndex === undefined) continue;
      const token = toolArgv[binding.argvIndex] as string;
      if (flagPaths.has(path.resolve(token))) {
        fail(`stage ${stage}: file "${token}" bound both by flag and positionally at #${binding.argvIndex}; refusing`);
      }
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
  // Observed pre bytes: :in and :inout hash before exec (both must exist
  // pre-run); :out records its pre sha (or null when absent) for the
  // unchanged-output refusal after exec.
  const observedPre = new Map<ObservedBinding, string>();
  const observedOutPre = new Map<ObservedBinding, string | null>();
  for (const observed of observes) {
    if (observed.mode === "out") {
      const abs = path.resolve(observed.path);
      observedOutPre.set(observed, isFile(abs) ? sha256File(abs) : null);
    } else {
      observedPre.set(observed, sha256File(path.resolve(observed.path)));
    }
  }

  for (const binding of roles) {
    let given: string;
    let substituteAt: number;
    if (binding.flag !== undefined) {
      const found = flagValue(executed, binding.flag, stage);
      given = found.value;
      substituteAt = found.index + 1;
    } else {
      const index = binding.argvIndex as number;
      given = executed[index] as string;
      substituteAt = index;
    }
    if (binding.mode === "in") {
      const abs = path.resolve(given);
      if (!isFile(abs)) fail(`stage ${stage}: input file absent: ${given}`);
      inFiles.push({ binding, given, sha: sha256File(abs) });
    } else if (binding.mode === "out") {
      outFiles.push({ binding, given });
    } else {
      const preAbs = path.resolve(given);
      if (!isFile(preAbs)) fail(`stage ${stage}: input file absent: ${given}`);
      const preSha = sha256File(preAbs);
      const copyAbs = freshStagePath(runDir, stage, given);
      copyFileSync(preAbs, copyAbs);
      const copyGiven = path.relative(process.cwd(), copyAbs);
      executed[substituteAt] = copyGiven;
      inoutFiles.push({ binding, preGiven: given, preSha, copyGiven, copyAbs });
    }
  }

  const primaryIn = inFiles[0] ?? inoutFiles[0] ?? observes
    .filter((observed) => observed.mode === "in" || observed.mode === "inout")
    .map((observed) => ({
      binding: observed,
      given: observed.path,
      sha: observedPre.get(observed) as string,
    }))[0];
  if (primaryIn === undefined) {
    fail(`stage ${stage}: no in or inout role or observed file; inputSha256 is undefined; refusing`);
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
  /** Exactly one binding tag per files entry: {flag}, {argvIndex}, or {observed: true}. */
  const bindingTag = (
    binding: RoleBinding | ObservedBinding,
  ): { flag: string } | { argvIndex: number } | { observed: true } => {
    if ("observed" in binding) return { observed: true };
    if (binding.flag !== undefined) return { flag: binding.flag };
    return { argvIndex: binding.argvIndex as number };
  };
  for (const entry of inFiles) {
    files.push({ path: entry.given, sha256: entry.sha, role: entry.binding.role, mode: "in", ...bindingTag(entry.binding) });
  }
  const recordedOuts: Array<{ binding: RoleBinding; given: string }> = [];
  for (const entry of outFiles) {
    const abs = path.resolve(entry.given);
    if (!isFile(abs)) {
      if (exitCode !== 0) continue;
      fail(`stage ${stage}: output file absent after exec: ${entry.given}`, 4);
    }
    recordedOuts.push(entry);
    files.push({ path: entry.given, sha256: sha256File(abs), role: entry.binding.role, mode: "out", ...bindingTag(entry.binding) });
  }
  for (const entry of inoutFiles) {
    files.push({ path: entry.preGiven, sha256: entry.preSha, role: entry.binding.role, mode: "in", ...bindingTag(entry.binding) });
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
      ...bindingTag(entry.binding),
    });
  }
  // Observed files: no copy, no argv substitution -- the tool writes the
  // path in place. :in records pre bytes; :out records post bytes (refusing
  // an unchanged pre-existing output or an absent output on a 0 exit);
  // :inout records pre + post (equal bytes are recorded, not refused).
  const recordedObserved: Array<{ binding: ObservedBinding; sha: string; post?: string }> = [];
  for (const observed of observes) {
    const abs = path.resolve(observed.path);
    if (observed.mode === "in") {
      recordedObserved.push({ binding: observed, sha: observedPre.get(observed) as string });
    } else if (observed.mode === "out") {
      if (!isFile(abs)) {
        if (exitCode !== 0) continue;
        fail(`stage ${stage}: observed output file absent after exec: ${observed.path}`, 4);
      }
      const post = sha256File(abs);
      if (exitCode === 0 && observedOutPre.get(observed) === post) {
        fail(`stage ${stage}: observed output unchanged: ${observed.path}; refusing`, 4);
      }
      recordedObserved.push({ binding: observed, sha: post });
    } else {
      if (!isFile(abs)) {
        if (exitCode !== 0) continue;
        fail(`stage ${stage}: observed file absent after exec: ${observed.path}`, 4);
      }
      recordedObserved.push({
        binding: observed,
        sha: observedPre.get(observed) as string,
        post: sha256File(abs),
      });
    }
  }
  for (const entry of recordedObserved) {
    const ref: ReceiptFileRef = {
      path: entry.binding.path,
      sha256: entry.sha,
      role: entry.binding.role,
      mode: entry.binding.mode,
      ...bindingTag(entry.binding),
    };
    if (entry.post !== undefined) ref.postSha256 = entry.post;
    files.push(ref);
  }

  let outputPath: string;
  let outputSha256: string;
  const primaryOut = recordedOuts[0];
  const primaryCopy = inoutFiles.find((entry) => isFile(entry.copyAbs));
  // Argv-bound bindings keep precedence; observed files fill the output
  // only when no argv-bound out or inout copy exists: :out first, then
  // :inout post bytes.
  const primaryObservedOut = recordedObserved.find((entry) => entry.binding.mode === "out");
  const primaryObservedInout = recordedObserved.find((entry) => entry.binding.mode === "inout");
  if (primaryOut !== undefined) {
    outputPath = primaryOut.given;
    outputSha256 = sha256File(path.resolve(primaryOut.given));
  } else if (primaryCopy !== undefined && isFile(primaryCopy.copyAbs)) {
    outputPath = primaryCopy.copyGiven;
    outputSha256 = sha256File(primaryCopy.copyAbs);
  } else if (primaryObservedOut !== undefined) {
    outputPath = primaryObservedOut.binding.path;
    outputSha256 = primaryObservedOut.sha;
  } else if (primaryObservedInout !== undefined && primaryObservedInout.post !== undefined) {
    outputPath = primaryObservedInout.binding.path;
    outputSha256 = primaryObservedInout.post;
  } else {
    outputPath = inputPath;
    outputSha256 = inputSha256;
  }

  const roleFlags = new Set(
    roles.map((binding) => binding.flag).filter((flag): flag is string => flag !== undefined),
  );
  // A role-bound positional index is evidence, never a flag's value: a flag
  // directly before one records as boolean "true".
  const boundIndices = new Set(
    roles.map((binding) => binding.argvIndex).filter((index): index is number => index !== undefined),
  );
  const params: Record<string, string> = {};
  for (let i = 1; i < executed.length; i += 1) {
    const token = executed[i];
    if (boundIndices.has(i)) continue;
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
      value = next !== undefined && !next.startsWith("--") && !boundIndices.has(i + 1) ? next : "true";
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
