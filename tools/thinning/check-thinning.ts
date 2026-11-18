// tools/thinning/check-thinning.ts — deterministic thinning gate (node builtins only).
// Non-product surface may only shrink. Pure core `evaluateThinning` is unit-tested
// in check-thinning.test.ts; the CLI below is a thin wrapper around it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface FileRow { path: string; bytes: number }
export interface AddedLine { path: string; line: string }
export interface ThinningViolation { rule: string; message: string }
export interface BucketTotals {
  bucket: string; bytes: number; files: number;
  ceiling: number | null; target: number | null;
  delta: number; added: number; removed: number;
}
export interface ThinningEvaluation { ok: boolean; violations: ThinningViolation[]; totals: BucketTotals[] }

interface BucketPolicy { globs: string[]; ceilingBytes: number | null; ceilingFiles: number | null; targetBytes: number | null }
interface PolicyException { id?: string; scope?: string[]; rule?: string; approvedBy?: string; quote?: string; date?: string; expires?: string; evidence?: string }
interface ThinningPolicy {
  order: string[]; buckets: Record<string, BucketPolicy>;
  rules: { offsetRatio: number }; pinBan: { pathGlobs: string[]; buckets: string[] };
  exceptions: PolicyException[];
}

export class NoBaseError extends Error {}
export type GitRunner = (args: string[]) => string;
const defaultRun: GitRunner = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 300 * 1024 * 1024 });

// ONE base sha for both the base tree and the added-line diff. Throws NoBaseError
// (the CLI exits 2): a missing base must never silently become HEAD, which yields
// a zero diff that always PASSes.
export function resolveBaseSha(explicit: string | undefined, run: GitRunner): string {
  if (explicit !== undefined && explicit === "") throw new NoBaseError("bare --base with no value");
  const args =
    explicit === undefined ? ["merge-base", "HEAD", "origin/main"] : ["merge-base", "HEAD", explicit];
  let sha = "";
  try {
    sha = run(args).trim();
  } catch {
    sha = "";
  }
  if (sha) return sha;
  if (explicit === undefined) throw new NoBaseError("merge-base HEAD origin/main failed");
  throw new NoBaseError(`ref ${explicit} does not resolve`);
}

const DAY_MS = 86_400_000;
const HEX64 = /[0-9a-f]{64}/i;
const BINREF = /[\w\-./]*\.(glb|png|py|npz)\b/;
const LINEREF = /[\w\-.]+(?:\.py:\d+|\.ts:\d+)/;

function escapeRegExp(s: string): string { return s.replace(/[.+^$()|\\[\]]/g, "\\$&"); }

export function globToRegExp(glob: string): RegExp {
  let re = glob.includes("/") ? "^" : "^(?:.*/)?";
  for (let i = 0; i < glob.length;) {
    const c = glob[i] ?? "";
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 3; } else { re += ".*"; i += 2; }
      } else { re += "[^/]*"; i += 1; }
    } else if (c === "?") { re += "[^/]"; i += 1; }
    else if (c === "{") {
      const j = glob.indexOf("}", i);
      re += `(?:${(j < 0 ? "" : glob.slice(i + 1, j)).split(",").map(escapeRegExp).join("|")})`;
      i = j < 0 ? glob.length : j + 1;
    } else { re += escapeRegExp(c); i += 1; }
  }
  return new RegExp(`${re}$`);
}

export function evaluateThinning(args: {
  policy: ThinningPolicy; base: FileRow[]; head: FileRow[]; addedLines: AddedLine[]; today?: string;
}): ThinningEvaluation {
  const { policy, base, head, addedLines } = args;
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const violations: ThinningViolation[] = [];
  const ratio = policy.rules.offsetRatio;
  const matchers = new Map(policy.order.map((id) => [id, (policy.buckets[id]?.globs ?? []).map(globToRegExp)]));
  const bucketOf = (path: string): string => {
    for (const id of policy.order) if ((matchers.get(id) ?? []).some((re) => re.test(path))) return id;
    return policy.order[policy.order.length - 1] ?? "";
  };
  // Validate exceptions; expired/invalid ones do not apply and are violations.
  const active: Required<PolicyException>[] = [];
  for (const e of policy.exceptions) {
    const id = e.id ?? "(missing id)";
    let bad = false;
    for (const f of ["id", "scope", "rule", "approvedBy", "quote", "date", "expires", "evidence"] as const) {
      const v = e[f];
      if (v === undefined || v === null || (f === "scope" && (v as string[]).length === 0)) {
        violations.push({ rule: "exception", message: `exception ${id} missing field ${f}` }); bad = true;
      }
    }
    if (typeof e.quote === "string" && e.quote.length < 10) {
      violations.push({ rule: "exception", message: `exception ${id} quote < 10 chars` }); bad = true;
    }
    const start = Date.parse(`${e.date}T00:00:00Z`);
    const end = Date.parse(`${e.expires}T00:00:00Z`);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start + 30 * DAY_MS) {
      violations.push({ rule: "exception", message: `exception ${id} expires > date+30d` }); bad = true;
    }
    if (typeof e.expires === "string" && today > e.expires) {
      violations.push({ rule: "exception", message: `exception ${id} expired ${e.expires}` }); bad = true;
    }
    if (!bad) active.push(e as Required<PolicyException>);
  }
  const exempt = (path: string, rule: string): boolean =>
    active.some((e) => e.rule === rule && e.scope.some((g) => globToRegExp(g).test(path)));
  // Single pass over the union of base/head paths.
  interface Agg { bytes: number; files: number; effBytes: number; effFiles: number; added: number; removed: number }
  const agg = new Map<string, Agg>();
  const cell = (b: string): Agg => {
    let a = agg.get(b);
    if (!a) { a = { bytes: 0, files: 0, effBytes: 0, effFiles: 0, added: 0, removed: 0 }; agg.set(b, a); }
    return a;
  };
  const baseBy = new Map(base.map((r) => [r.path, r.bytes]));
  const headBy = new Map(head.map((r) => [r.path, r.bytes]));
  for (const p of new Set([...baseBy.keys(), ...headBy.keys()])) {
    const before = baseBy.get(p) ?? 0;
    const after = headBy.get(p) ?? 0;
    const b = bucketOf(p);
    const a = cell(b);
    if (headBy.has(p)) { a.bytes += after; a.files += 1; if (!exempt(p, "ceiling")) { a.effBytes += after; a.effFiles += 1; } }
    const d = after - before;
    if (d > 0 && !exempt(p, "offset")) a.added += d;
    if (d < 0 && !exempt(p, "offset")) a.removed -= d;
    // A path present in head but absent in base is a D addition even at 0 bytes:
    // byte-delta alone would let an empty file through.
    if (b === "D" && (d > 0 || !baseBy.has(p)) && headBy.has(p) && !exempt(p, "d-growth")) {
      violations.push({ rule: "d-growth", message: `D grew: ${p} (+${d} bytes)` });
    }
  }
  const totals: BucketTotals[] = policy.order.map((id) => {
    const bp = policy.buckets[id];
    if (bp === undefined) throw new Error(`thinning policy: order lists unknown bucket ${id}`);
    const a = agg.get(id) ?? { bytes: 0, files: 0, effBytes: 0, effFiles: 0, added: 0, removed: 0 };
    if (bp.ceilingBytes !== null && bp.ceilingBytes !== undefined && a.effBytes > bp.ceilingBytes) {
      violations.push({ rule: "ceiling", message: `${id} bytes ${a.effBytes} > ceiling ${bp.ceilingBytes}` });
    }
    if (bp.ceilingFiles !== null && bp.ceilingFiles !== undefined && a.effFiles > bp.ceilingFiles) {
      violations.push({ rule: "ceiling", message: `${id} files ${a.effFiles} > ceiling ${bp.ceilingFiles}` });
    }
    if (bp.targetBytes !== null && bp.targetBytes !== undefined && a.bytes > bp.targetBytes && a.added > 0 && a.removed < ratio * a.added) {
      violations.push({ rule: "offset", message: `${id} above target ${bp.targetBytes}: added ${a.added} but removed only ${a.removed} (< ${ratio}x)` });
    }
    return { bucket: id, bytes: a.bytes, files: a.files, ceiling: bp.ceilingBytes ?? null, target: bp.targetBytes ?? null, delta: a.bytes - [...baseBy].reduce((s, [p, n]) => s + (bucketOf(p) === id ? n : 0), 0), added: a.added, removed: a.removed };
  });
  const pinPaths = policy.pinBan.pathGlobs.map(globToRegExp);
  for (const { path, line } of addedLines) {
    if (!policy.pinBan.buckets.includes(bucketOf(path))) continue;
    if (!pinPaths.some((re) => re.test(path))) continue;
    if (exempt(path, "pin")) continue;
    if ((HEX64.test(line) && BINREF.test(line)) || LINEREF.test(line)) {
      violations.push({ rule: "pin", message: `pin added in ${path}: ${line.slice(0, 120)}` });
    }
  }
  return { ok: violations.length === 0, violations, totals };
}

function listTree(ref: string, run: GitRunner = defaultRun): FileRow[] {
  const out = run(["ls-tree", "-r", "-l", ref]);
  const rows: FileRow[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const size = line.slice(0, tab).trim().split(/\s+/).pop() ?? "0";
    rows.push({ path: line.slice(tab + 1), bytes: size === "-" ? 0 : Number(size) });
  }
  return rows;
}

function diffAddedLines(base: string, run: GitRunner = defaultRun): AddedLine[] {
  const out = run(["diff", "-U0", `${base}...HEAD`, "--"]);
  const lines: AddedLine[] = [];
  let cur = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("+++ ")) cur = line.slice(4).replace(/^b\//, "").replace(/^"(.*)"$/, "$1");
    else if (line.startsWith("+") && cur) lines.push({ path: cur, line: line.slice(1) });
  }
  return lines;
}

function toplevel(): string {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(); }
  catch { return process.cwd(); }
}

// The CLI gathers base tree + added lines from the single resolved base sha so
// tree totals and the diff can never disagree about what "base" means.
export function gatherInputs(
  explicit: string | undefined, run: GitRunner,
): { baseSha: string; base: FileRow[]; addedLines: AddedLine[] } {
  const baseSha = resolveBaseSha(explicit, run);
  return { baseSha, base: listTree(baseSha, run), addedLines: diffAddedLines(baseSha, run) };
}

function printTotals(totals: BucketTotals[]): void {
  for (const t of totals) {
    console.log(`${t.bucket} bytes=${t.bytes} files=${t.files} ceiling=${t.ceiling ?? "-"} target=${t.target ?? "-"} delta=${t.delta} added=${t.added} removed=${t.removed}`);
  }
}

const cliArgs = process.argv.slice(2);
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const started = performance.now();
  const measureOnly = cliArgs.includes("--measure");
  const ceilingsOnly = cliArgs.includes("--ceilings-only");
  const policyFlag = cliArgs.indexOf("--policy");
  const policyPath = policyFlag >= 0 ? cliArgs[policyFlag + 1] : join(toplevel(), "thinning-policy.json");
  const policy = JSON.parse(readFileSync(policyPath ?? "", "utf8")) as ThinningPolicy;
  const head = listTree("HEAD");
  const baseFlag = cliArgs.indexOf("--base");
  const raw = baseFlag >= 0 ? cliArgs[baseFlag + 1] : undefined;
  // A bare --base (no value, or another flag in the value slot) is a caller bug:
  // fail closed before any mode branching, so --measure/--ceilings-only cannot
  // silently swallow it.
  if (baseFlag >= 0 && (raw === undefined || raw.startsWith("-"))) {
    console.log("THINNING: ERROR no base (bare --base with no value)");
    console.log(`elapsed_ms=${Math.round(performance.now() - started)}`);
    process.exit(2);
  }
  if (measureOnly || ceilingsOnly) {
    // Ceilings-only (CI schedule/dispatch): ceilings still enforced via the
    // head-only evaluation, but no diff rules fire (added/removed are zero).
    printTotals(evaluateThinning({ policy, base: head, head, addedLines: [] }).totals);
    console.log(`elapsed_ms=${Math.round(performance.now() - started)}`);
  } else {
    const explicit = baseFlag < 0 ? undefined : raw;
    try {
      const inputs = gatherInputs(explicit, defaultRun);
      const result = evaluateThinning({ policy, base: inputs.base, head, addedLines: inputs.addedLines });
      printTotals(result.totals);
      for (const v of result.violations) console.log(`VIOLATION [${v.rule}] ${v.message}`);
      console.log(`elapsed_ms=${Math.round(performance.now() - started)}`);
      console.log(`THINNING: ${result.ok ? "PASS" : "FAIL"}`);
      if (!result.ok) process.exit(1);
    } catch (err) {
      // Fail closed: no base, no PASS.
      console.log(`THINNING: ERROR no base (${err instanceof Error ? err.message : String(err)})`);
      console.log(`elapsed_ms=${Math.round(performance.now() - started)}`);
      process.exit(2);
    }
  }
}
