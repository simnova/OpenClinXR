/**
 * Supine control station byte-level freeze record.
 *
 * Records SHA256 hashes of every asset file the inpatient supine control station loads,
 * plus the staged posture/support/clearance values, so "the control did not move"
 * claims can cite this record rather than literals that could drift because an asset changed.
 *
 * Contracted export surface (see the RED test header):
 * - SupineControlFreeze type
 * - readSupineControlFreeze()
 * - computeSupineControlFreeze(repoRoot)
 * - supineControlFreezeIsStillValid(recorded, current)
 *
 * ## FIXED (SC-06) — the control was green by construction on every clean clone
 *
 * MEASURED on baseline 27efa3d2, in a fresh worktree: the record was ABSENT, the gate reported
 * `Test Files 1 passed / Tests 4 passed`, and the record appeared on disk at the same second.
 * `git check-ignore -v` names `.gitignore:9:.openclinxr/` as the reason it was absent, so that was
 * the state of every clean checkout — and this module's own last two lines wrote today's bytes at
 * MODULE IMPORT whenever it found none. Clause (2) therefore compared today's bytes against
 * today's bytes and could not fail.
 *
 * The invalidation direction did work: it fired for real at HEAD 40090435 when SC-04 republished
 * `mpfb-clinical-physician-adult.glb`. That red was cleared by REGENERATING the record, which is
 * what SC-06's required_behavior 3 forbids — "Repair requires fresh observation/revalidation, not
 * overwriting sidecars."
 *
 * THREE CHANGES, and each closes one half of that:
 *  1. THE IMPORT SIDE EFFECT IS GONE. Producing a control is now an explicit call.
 *  2. THE RECORD IS TRACKED, at `supine-control-freeze.record.json` beside this file. A clean clone
 *     now carries the control it is being compared against, so the comparison is real. The
 *     gitignored `.openclinxr/` path is NOT read as a fallback: a fallback would restore "repair by
 *     deleting one untracked file" under a different name.
 *  3. PRODUCTION REQUIRES A FRESH OBSERVATION. `produceSupineControlFreeze` demands an observer and
 *     a timestamp and stamps them into `producedFrom`, so re-baselining after an invalidation is a
 *     recorded act with someone's name on it rather than an anonymous overwrite. It also REFUSES to
 *     record an empty digest, which would have compared equal to every future tree that also could
 *     not read the file.
 */

import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Repo root resolved from this file's location (tools/openclinxr/evidence/supine-control-freeze/). */
function repoRoot(): string {
  // import.meta.dirname is tools/openclinxr/evidence/supine-control-freeze; four levels up is the
  // workspace root. `__dirname` stood here and is undefined in ES module scope, so the module threw
  // `ReferenceError: __dirname is not defined` under tsx while working under Vitest's CJS interop —
  // a module that only loads in one of the two runners this repo uses. `import.meta.dirname` is what
  // the sibling gates already use (see the-client-entry-does-not-reach-node-builtins.test.ts).
  return resolve(import.meta.dirname, "../../../../");
}

/**
 * Path to the persisted freeze record (repo-relative), and it is TRACKED.
 *
 * The previous location, `.openclinxr/evidence/supine-control-freeze.json`, is covered by
 * `.gitignore:9`, which is why every clean clone had no control and the gate compared today's bytes
 * against themselves. A freeze record that is not in the repository is not a freeze.
 */
export const FREEZE_RECORD_REL =
  "tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.record.json";

/**
 * Absolute path to the freeze record.
 *
 * Exported because `a-corrupt-artifact-is-refused.test.ts` records, in its own comment, that a first
 * draft GUESSED this path, corrupted a file nothing reads, and watched every clause return `ok`. A
 * test that has to guess where its subject lives is one edit away from measuring nothing.
 */
export function freezeRecordPath(root: string = repoRoot()): string {
  return join(root, FREEZE_RECORD_REL);
}

/**
 * Asset paths loaded by the inpatient supine control station.
 * Derived from resolveScenarioActorCast for the three declared inpatient scenarios
 * and the Infinigen environment assets they reference.
 */
const CONTROL_ASSET_PATHS: readonly string[] = [
  // Environments
  "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb",
  "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb",
  "apps/ui-xr/public/xr-assets/environment/infinigen-surgical-ward.glb",
  // Humanoid actors (shared across scenarios)
  "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
] as const;

/** Declared inpatient recumbent scenario IDs (from actor-posture.ts). */
const DECLARED_INPATIENT_SCENARIOS = [
  "ward_delirium_med_rec_v1",
  "stepdown_sepsis_nurse_escalation_v1",
  "postop_fever_consult_pressure_v1",
] as const;

/** The default control scenario — the first declared inpatient. */
const CONTROL_SCENARIO_ID = DECLARED_INPATIENT_SCENARIOS[0];

/** Staged values pinned by this freeze (from inspectInpatientSupineStaging). */
const STAGED_VALUES = {
  posture: "supine" as const,
  supportSurfaceCount: 1,
  clearanceAboveDeckMeters: 0.25,
} as const;

export type SupineControlFreeze = {
  schemaVersion: "openclinxr.supine-control-freeze.v1";
  scenarioId: string;
  assetSha256ByPath: Record<string, string>;
  staged: {
    posture: "supine";
    supportSurfaceCount: 1;
    clearanceAboveDeckMeters: number;
  };
  /**
   * Who produced this control, and when they looked.
   *
   * Optional on the TYPE so `requireSupineControlFreeze` keeps its four-outcome read contract for
   * any v1 record; REQUIRED by `supineControlFreezeProvenanceProblems`, which the gate calls. The
   * split matters: a record with no provenance is not malformed, it is unattributed, and those are
   * different failures with different repairs.
   */
  producedFrom?: SupineControlObservation | undefined;
};

/** A fresh observation of the control assets. The thing a repair cannot fake by editing a sidecar. */
export type SupineControlObservation = {
  observedBy: string;
  observedAtIso: string;
  /** Why this control was produced or re-produced. A re-baseline must say what invalidated it. */
  reason: string;
  /** Byte counts seen at production time, so the digests are not the only witness. */
  byteCountByPath: Record<string, number>;
};

/** Validation result for freeze integrity check. */
export type ValidationResult = { valid: boolean; changedPaths: string[] };

/** Compute SHA256 of a file. */
function sha256File(filePath: string): string {
  const buffer = readFileSync(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

/** Compute SHA256 for all control asset paths. Overrides pin published bytes by rel path. */
function computeAssetHashes(root: string, overrides: Record<string, Buffer> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const relPath of CONTROL_ASSET_PATHS) {
    if (overrides[relPath] !== undefined) {
      out[relPath] = createHash("sha256").update(overrides[relPath]).digest("hex");
      continue;
    }
    const absPath = join(root, relPath);
    if (existsSync(absPath)) {
      out[relPath] = sha256File(absPath);
    } else {
      // Missing asset — record as empty so `supineControlFreezeIsStillValid` reports it against a
      // recorded real digest. `produceSupineControlFreeze` refuses to PERSIST one of these: an empty
      // digest on both sides compares equal, so a control produced while an asset was missing would
      // keep validating every tree in which it is still missing.
      out[relPath] = "";
    }
  }
  return out;
}

/** Byte count per control asset, or -1 where the file is absent. Overrides pin published sizes. */
function computeAssetByteCounts(root: string, overrides: Record<string, Buffer> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const relPath of CONTROL_ASSET_PATHS) {
    if (overrides[relPath] !== undefined) {
      out[relPath] = overrides[relPath].length;
      continue;
    }
    const absPath = join(root, relPath);
    out[relPath] = existsSync(absPath) ? statSync(absPath).size : -1;
  }
  return out;
}

/**
 * Read the persisted freeze record, or null if missing.
 */
export function readSupineControlFreeze(root?: string): SupineControlFreeze | null {
  const path = freezeRecordPath(root ?? repoRoot());
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as SupineControlFreeze;
  } catch {
    return null;
  }
}

/**
 * Compute a fresh freeze record from current asset bytes on disk.
 */
export function computeSupineControlFreeze(repoRootPath: string, overrides: Record<string, Buffer> = {}): SupineControlFreeze {
  const assetSha256ByPath = computeAssetHashes(repoRootPath, overrides);
  return {
    schemaVersion: "openclinxr.supine-control-freeze.v1",
    scenarioId: CONTROL_SCENARIO_ID,
    assetSha256ByPath,
    staged: {
      posture: STAGED_VALUES.posture,
      supportSurfaceCount: STAGED_VALUES.supportSurfaceCount,
      clearanceAboveDeckMeters: STAGED_VALUES.clearanceAboveDeckMeters,
    },
  };
}

/**
 * Write a freeze record to disk (used to initialize/update the control).
 */
export function writeSupineControlFreeze(freeze: SupineControlFreeze, root: string = repoRoot()): void {
  const path = freezeRecordPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(freeze, null, 2)}\n`, "utf8");
}

/**
 * Validate that a recorded freeze still matches current asset bytes.
 * Returns { valid: true, changedPaths: [] } when all hashes match.
 * Returns { valid: false, changedPaths: [...] } listing paths whose sha256 differs.
 */
export function supineControlFreezeIsStillValid(
  recorded: SupineControlFreeze,
  current: SupineControlFreeze,
): ValidationResult {
  const changedPaths: string[] = [];

  // Check schema version match
  if (recorded.schemaVersion !== current.schemaVersion) {
    changedPaths.push("__schemaVersion__");
  }

  // Check scenarioId match
  if (recorded.scenarioId !== current.scenarioId) {
    changedPaths.push("__scenarioId__");
  }

  // Check staged values match
  if (recorded.staged.posture !== current.staged.posture) {
    changedPaths.push("__staged.posture__");
  }
  if (recorded.staged.supportSurfaceCount !== current.staged.supportSurfaceCount) {
    changedPaths.push("__staged.supportSurfaceCount__");
  }
  if (recorded.staged.clearanceAboveDeckMeters !== current.staged.clearanceAboveDeckMeters) {
    changedPaths.push("__staged.clearanceAboveDeckMeters__");
  }

  // Check asset hashes
  const allPaths = new Set([
    ...Object.keys(recorded.assetSha256ByPath),
    ...Object.keys(current.assetSha256ByPath),
  ]);

  for (const path of allPaths) {
    const recordedHash = recorded.assetSha256ByPath[path];
    const currentHash = current.assetSha256ByPath[path];
    if (recordedHash !== currentHash) {
      changedPaths.push(path);
    }
  }

  return {
    valid: changedPaths.length === 0,
    changedPaths,
  };
}

export type SupineRepinResult =
  | { repinned: true; freeze: SupineControlFreeze; previous: { assetSha256: string; byteCount: number } }
  | { repinned: false; reason: string };

/** Publish text atomically: O_EXCL temp in the same dir + rename, temp unlinked on any failure. */
function writeFileAtomic(target: string, text: string): void {
  const tmp = join(dirname(target), `.${target.split("/").at(-1)}.repin-${process.pid}.tmp`);
  const fd = openSync(tmp, "wx", 0o644);
  try {
    writeFileSync(fd, text, "utf8");
    closeSync(fd);
  } catch (e) {
    try { closeSync(fd); } catch { /* close itself failed; unlink below */ }
    rmSync(tmp, { force: true });
    throw e;
  }
  try { renameSync(tmp, target); } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

/** Strict ISO-8601 instant: Date.parse alone accepts "1/2/2020", so the shape is checked first. */
const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
function isoEpoch(s: unknown): number | undefined {
  if (typeof s !== "string") return undefined;
  const m = ISO_INSTANT_RE.exec(s);
  if (!m) return undefined;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return undefined;
  // Round-trip: the components Date parsed must equal the components written,
  // so normalized impossibilities (2020-02-30 -> Mar 1) refuse. Compare in the
  // string's own offset: UTC instant + offset = the local wall clock written.
  const tz = m[8] as string;
  let offMin = 0;
  if (tz !== "Z") {
    const dig = tz.slice(1).replace(":", "");
    offMin = (tz[0] === "-" ? -1 : 1) * (Number(dig.slice(0, 2)) * 60 + Number(dig.slice(2, 4)));
  }
  const local = new Date(ms + offMin * 60000);
  const wantMs = m[7] === undefined ? 0 : Math.round(Number(`0${m[7]}`) * 1000);
  if (
    local.getUTCFullYear() !== Number(m[1]) || local.getUTCMonth() + 1 !== Number(m[2]) ||
    local.getUTCDate() !== Number(m[3]) || local.getUTCHours() !== Number(m[4]) ||
    local.getUTCMinutes() !== Number(m[5]) || local.getUTCSeconds() !== Number(m[6]) ||
    local.getUTCMilliseconds() !== wantMs
  ) return undefined;
  return ms;
}

/** Refuse lossy/non-finite numeric tokens (same rule as the sidecar writer): scan raw outside strings. */
function assertLosslessNumbers(raw: string): void {
  const toks = raw.replace(/"(?:\\.|[^"\\])*"/g, "").match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  for (const t of toks) {
    const n = Number(t);
    if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) throw new Error(`refusing — non-finite or unsafe numeric token ${t}`);
    if (String(n) !== t) throw new Error(`refusing — non-canonical numeric token ${t} (re-serializes to ${String(n)}; lossy or rounded)`);
    if (n === 0 && !/^-?0*(\.0*)?([eE][+-]?\d+)?$/.test(t)) throw new Error(`refusing — lossy numeric token ${t} (underflows to 0)`);
  }
}

const VALUE_TOKEN_RE = `("(?:\\\\.|[^"\\\\])*"|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|true|false|null)`;

/** Match the bracket opened at raw[open] ({ or [), skipping string literals; return its closer. */
function matchBracket(raw: string, open: number): number | undefined {
  let depth = 0;
  let str = false;
  let esc = false;
  for (let j = open; j < raw.length; j++) {
    const c = raw[j];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return j;
  }
  return undefined;
}

/** [open, close] of the outermost JSON object in raw; the scanner skips string literals. */
function topSpan(raw: string): [number, number] | undefined {
  let str = false;
  let esc = false;
  for (let j = 0; j < raw.length; j++) {
    const c = raw[j];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === "{") {
      const close = matchBracket(raw, j);
      return close === undefined ? undefined : [j, close];
    }
  }
  return undefined;
}

/**
 * [start, end] of the VALUE of a DIRECT child `key` of the object in
 * objSpan (inclusive). Keys nested deeper (e.g. producedFrom.previous.observedBy
 * when looking for producedFrom.observedBy) never match: only depth-0 entries
 * are considered, so a pin is located by its exact record path.
 */
function childValueSpan(raw: string, objSpan: [number, number], key: string): [number, number] | undefined {
  const want = JSON.stringify(key);
  let depth = 0;
  let str = false;
  let esc = false;
  let i = objSpan[0] + 1;
  while (i < objSpan[1]) {
    const c = raw[i];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let e = false;
      while (j < raw.length) {
        const d = raw[j];
        if (e) e = false;
        else if (d === "\\") e = true;
        else if (d === '"') break;
        j++;
      }
      if (j >= raw.length) return undefined;
      const lit = raw.slice(i, j + 1);
      if (depth === 0 && lit === want) {
        let k = j + 1;
        while (k < raw.length && /\s/.test(raw[k] as string)) k++;
        if (raw[k] !== ":") return undefined;
        k++;
        while (k < raw.length && /\s/.test(raw[k] as string)) k++;
        const vc = raw[k];
        if (vc === '"') {
          let m = k + 1;
          let f = false;
          while (m < raw.length) {
            const d = raw[m];
            if (f) f = false;
            else if (d === "\\") f = true;
            else if (d === '"') break;
            m++;
          }
          if (m >= raw.length) return undefined;
          return [k, m];
        }
        if (vc === "{" || vc === "[") {
          const close = matchBracket(raw, k);
          return close === undefined ? undefined : [k, close];
        }
        const tok = new RegExp(`^${VALUE_TOKEN_RE}`).exec(raw.slice(k));
        if (!tok || tok[1] === undefined) return undefined;
        return [k, k + tok[1].length - 1];
      }
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    i++;
  }
  return undefined;
}

/**
 * Replace the raw value token at an exact object path (e.g.
 * ["producedFrom", "byteCountByPath", key]); undefined when any segment is
 * absent or the leaf is not a plain value token. Never a first-token match:
 * each segment must be a DIRECT child of the previous one.
 */
function replacePathToken(raw: string, path: string[], replacement: string): string | undefined {
  if (path.length === 0) return undefined;
  const top = topSpan(raw);
  if (top === undefined) return undefined;
  let span = top;
  for (const seg of path.slice(0, -1)) {
    const child = childValueSpan(raw, span, seg);
    if (child === undefined || raw[child[0]] !== "{") return undefined;
    span = child;
  }
  const leaf = childValueSpan(raw, span, path[path.length - 1] as string);
  if (leaf === undefined) return undefined;
  if (!new RegExp(`^${VALUE_TOKEN_RE}$`).test(raw.slice(leaf[0], leaf[1] + 1))) return undefined;
  return `${raw.slice(0, leaf[0])}${replacement}${raw.slice(leaf[1] + 1)}`;
}

/**
 * Re-pin one control asset row to the bytes on disk NOW (FINALIZE-2 C2b writer (b)).
 * The new record is produced through produceSupineControlFreeze with a FRESH
 * observation of the TARGET asset only; sibling rows are kept from the prior
 * record's RAW text (never recomputed, never re-serialized). Refusals leave
 * the record byte-identical: blank observer; non-ISO or not-strictly-later
 * timestamps; a target digest equal to the prior digest while the bytes
 * changed; unknown/equals-form argv; lossy or non-finite numeric tokens in
 * the prior record; a symlinked or hard-linked record; a failed publish.
 */
export function repinSupineControlFreeze(input: {
  asset: string;
  observedBy: string;
  observedAtIso?: string;
  reason?: string;
  assetDigest?: string;
  recordPath?: string;
  repoRootPath?: string;
}): SupineRepinResult {
  const refuse = (why: string): SupineRepinResult => ({ repinned: false, reason: why });
  const tag = "supine-control-freeze --repin: refusing —";
  if (input.observedBy.trim() === "") return refuse(`${tag} --observed-by must name the observer; a blank observer is not fresh.`);
  const root = input.repoRootPath ?? repoRoot();
  const recordPath = input.recordPath ?? freezeRecordPath(root);
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(recordPath);
  } catch {
    return refuse(`${tag} cannot lstat the record at ${recordPath}; refusing before any write.`);
  }
  if (st.isSymbolicLink() || st.nlink > 1) return refuse(`${tag} the record is a symlink or hard-linked; refusing before any write.`);
  const raw = readFileSync(recordPath, "utf8");
  try {
    assertLosslessNumbers(raw);
  } catch {
    return refuse(`${tag} the prior record carries a non-finite or lossy numeric token; refusing before any write.`);
  }
  let prior: SupineControlFreeze;
  try {
    prior = JSON.parse(raw) as SupineControlFreeze;
  } catch {
    return refuse(`${tag} the record at ${recordPath} is not parseable JSON.`);
  }
  if (prior?.schemaVersion !== "openclinxr.supine-control-freeze.v1" || typeof prior.assetSha256ByPath !== "object" || prior.assetSha256ByPath === null) {
    return refuse(`${tag} the record at ${recordPath} is not a v1 supine freeze.`);
  }
  const at = input.observedAtIso ?? new Date().toISOString();
  const atMs = isoEpoch(at);
  const priorMs = isoEpoch(prior.producedFrom?.observedAtIso);
  if (atMs === undefined || priorMs === undefined || !(atMs > priorMs)) {
    return refuse(`${tag} observedAtIso ${at} is not a strictly-later ISO instant than the prior observation; a copied observation is not fresh.`);
  }
  let key: string | undefined;
  let assetFile: string | undefined;
  if (Object.hasOwn(prior.assetSha256ByPath, input.asset)) {
    key = input.asset;
    const underRoot = join(root, input.asset);
    if (!existsSync(underRoot)) return refuse(`${tag} ${underRoot} cannot be read.`);
    assetFile = underRoot;
  } else {
    // A file path, not a record key: only the exact root-relative key is honored.
    // A same-basename file elsewhere (e.g. an archive copy) never resolves to a
    // live pin; finalize passes the prevalidated exact key for machine runs.
    const direct = existsSync(input.asset) ? input.asset : join(root, input.asset);
    if (!existsSync(direct)) return refuse(`${tag} asset ${input.asset} matches no record key and cannot be read as a file.`);
    const rel = relative(root, resolve(direct)).split(sep).join("/");
    if (!Object.hasOwn(prior.assetSha256ByPath, rel)) return refuse(`${tag} asset ${input.asset} is not the exact record key ${rel}; refusing instead of guessing by basename.`);
    key = rel;
    assetFile = direct;
  }
  const fresh = readFileSync(assetFile);
  const digest = createHash("sha256").update(fresh).digest("hex");
  if (input.assetDigest !== undefined && input.assetDigest !== digest) return refuse(`${tag} the claimed digest differs from the asset bytes read now.`);
  const priorDigest = prior.assetSha256ByPath[key];
  const priorCount = prior.producedFrom?.byteCountByPath?.[key];
  if (typeof priorDigest !== "string") return refuse(`${tag} the prior record holds no digest for the staged asset.`);
  if (digest === priorDigest && typeof priorCount === "number" && fresh.byteLength !== priorCount) {
    return refuse(`${tag} the digest copies the prior record while the byte count changed; the observation is not fresh.`);
  }
  const reason = input.reason ?? "finalize_post_export_stage.py re-pin after a material-only post-export stage";
  const produced = produceSupineControlFreeze({ observedBy: input.observedBy, observedAtIso: at, reason, repoRootPath: root });
  if (!produced.produced) return refuse(`${tag} ${produced.reason}`);
  if (produced.freeze.assetSha256ByPath[key] !== digest || produced.freeze.producedFrom?.byteCountByPath[key] !== fresh.byteLength) {
    return refuse(`${tag} the fresh observation does not match the asset bytes read now; refusing before any write.`);
  }
  let next = replacePathToken(raw, ["assetSha256ByPath", key], JSON.stringify(digest));
  next = next === undefined ? undefined : replacePathToken(next, ["producedFrom", "byteCountByPath", key], String(fresh.byteLength));
  next = next === undefined ? undefined : replacePathToken(next, ["producedFrom", "observedBy"], JSON.stringify(input.observedBy));
  next = next === undefined ? undefined : replacePathToken(next, ["producedFrom", "observedAtIso"], JSON.stringify(at));
  next = next === undefined ? undefined : replacePathToken(next, ["producedFrom", "reason"], JSON.stringify(reason));
  if (next === undefined) return refuse(`${tag} the prior record is missing a token this re-pin rewrites; refusing before any write.`);
  let freeze: SupineControlFreeze;
  try {
    freeze = JSON.parse(next) as SupineControlFreeze;
  } catch {
    return refuse(`${tag} the rewritten record does not parse; refusing before any write.`);
  }
  if (freeze.assetSha256ByPath[key] !== digest || freeze.producedFrom?.byteCountByPath[key] !== fresh.byteLength) {
    return refuse(`${tag} the rewritten record does not carry the fresh observation; refusing before any write.`);
  }
  try {
    mkdirSync(dirname(recordPath), { recursive: true });
    writeFileAtomic(recordPath, next);
  } catch {
    return refuse(`${tag} publish failed; the record is byte-identical and no temp file is left behind.`);
  }
  return { repinned: true, freeze, previous: { assetSha256: priorDigest, byteCount: typeof priorCount === "number" ? priorCount : -1 } };
}

function supineRepinCliMain(): void {
  const argv = process.argv.slice(2);
  if (!argv.includes("--repin")) return;
  for (const tok of argv) {
    if (tok.startsWith("--") && tok.includes("=")) {
      process.stderr.write(`supine-control-freeze --repin refuses ${JSON.stringify(tok)} (space form only, no equals form).\n`);
      process.exitCode = 2;
      return;
    }
  }
  const known = new Set(["--record", "--asset", "--observed-by", "--root", "--reason"]);
  const seen = new Map<string, string>();
  const rest = argv.filter((t) => t !== "--repin");
  let bad: string | undefined;
  for (let i = 0; i < rest.length && bad === undefined; i++) {
    const tok = rest[i] as string;
    if (!tok.startsWith("--") || !known.has(tok) || seen.has(tok)) bad = tok;
    else {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--") || v.trim() === "") bad = tok;
      else {
        seen.set(tok, v);
        i++;
      }
    }
  }
  const asset = seen.get("--asset");
  const observedBy = seen.get("--observed-by");
  const record = seen.get("--record");
  if (bad !== undefined || asset === undefined || observedBy === undefined || record === undefined) {
    process.stderr.write(
      `supine-control-freeze --repin refuses ${bad === undefined ? "missing --record <json> --asset <glb> --observed-by <name>" : JSON.stringify(bad)} (space form only, no unknown flags).\n`,
    );
    process.exitCode = 2;
    return;
  }
  const repinReason = seen.get("--reason");
  const repinRoot = seen.get("--root");
  const result = repinSupineControlFreeze({
    asset,
    observedBy,
    recordPath: record,
    ...(repinReason === undefined ? {} : { reason: repinReason }),
    ...(repinRoot === undefined ? {} : { repoRootPath: repinRoot }),
  });
  if (!result.repinned) {
    process.stderr.write(`${result.reason}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ repinned: result.freeze.assetSha256ByPath, observedAtIso: result.freeze.producedFrom?.observedAtIso })}\n`);
}

if (process.argv[1]?.endsWith("supine-control-freeze.ts")) {
  // Refusals thrown under tsx exit via exitCode (same H1 shape as the licence writer).
  try {
    supineRepinCliMain();
  } catch (error) {
    process.exitCode = 1;
    try {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    } catch {
      /* exit code already set; diagnostic write is best effort */
    }
  }
}
// wrote today's bytes — so on a tree with no control the byte-freeze gate compared today's bytes
// against today's bytes and reported four passes. Measured on baseline 27efa3d2; see the ## FIXED
// block in this file's header. Producing a control is `produceSupineControlFreeze`, and it needs a
// fresh observation with a name on it.
// NO AUTO-INITIALIZATION. The two lines that used to stand here read the record and, finding none,
// wrote today's bytes — so on a tree with no control the byte-freeze gate compared today's bytes
// against today's bytes and reported four passes. Measured on baseline 27efa3d2; see the ## FIXED
// block in this file's header. Producing a control is `produceSupineControlFreeze`, and it needs a
// fresh observation with a name on it.
/**
 * The consumer-facing read: REFUSE a missing or corrupt artifact rather than returning null.
 *
 * Brief §7 step 5: "Corrupt or remove a produced artifact and require the consumer to refuse it."
 *
 * `readSupineControlFreeze` returns `null` for a missing file AND for an unparseable one, which are
 * different situations with the same shape. Worse, `null` is exactly what a caller reads as
 * "no freeze recorded yet, carry on" — so a corrupted control silently becomes no control, and the
 * evidence that depended on it keeps being trusted. That is the failure this refusal closes.
 *
 * The four outcomes are distinguished because a consumer should act differently on each: `absent`
 * means produce it, `malformed` and `wrong_schema` mean something damaged it and a re-run cannot be
 * assumed to fix it, and `ok` means use it.
 *
 * `recordPath` overrides the default location and exists for ONE reason: the record became tracked
 * and therefore SHARED under SC-06, and `a-corrupt-artifact-is-refused.test.ts` corrupts its subject
 * on disk for real. With both test files reading one artifact, that corruption raced the byte-freeze
 * gate running beside it — measured, 1 failure in 3 runs of the directory, passing every time either
 * file ran alone. The refusal test now damages a file it owns; the default path stays the consumer's
 * and one clause there still asserts the reader resolves it.
 */
export type FreezeArtifactRead =
  | { status: "ok"; freeze: SupineControlFreeze }
  | { status: "absent"; path: string; reason: string }
  | { status: "malformed"; path: string; reason: string }
  | { status: "wrong_schema"; path: string; reason: string };

export function requireSupineControlFreeze(recordPath?: string): FreezeArtifactRead {
  const path = recordPath ?? freezeRecordPath();
  if (!existsSync(path)) {
    return {
      status: "absent",
      path,
      reason: "the supine control freeze has never been produced; a control that does not exist cannot invalidate anything",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      status: "malformed",
      path,
      reason: `the freeze artifact is present but not parseable JSON (${error instanceof Error ? error.message : String(error)}); a damaged control must be refused, not read as an absent one`,
    };
  }
  const candidate = parsed as Partial<SupineControlFreeze>;
  if (candidate?.schemaVersion !== "openclinxr.supine-control-freeze.v1") {
    return {
      status: "wrong_schema",
      path,
      reason: `expected schemaVersion "openclinxr.supine-control-freeze.v1", found ${JSON.stringify(candidate?.schemaVersion)}`,
    };
  }
  if (
    typeof candidate.assetSha256ByPath !== "object"
    || candidate.assetSha256ByPath === null
    || Object.keys(candidate.assetSha256ByPath).length === 0
  ) {
    return {
      status: "wrong_schema",
      path,
      reason: "the freeze carries no asset hashes; an empty hash map validates every tree and is worth less than no freeze",
    };
  }
  return { status: "ok", freeze: candidate as SupineControlFreeze };
}

/**
 * Every provenance problem with a freeze record. Empty means it was produced by a named observer.
 *
 * `requireSupineControlFreeze` answers "is this artifact readable"; this answers "did anyone
 * actually look". They are separate because the repairs differ: a malformed record needs
 * re-producing, an unattributed one needs someone to take responsibility for the observation.
 */
export function supineControlFreezeProvenanceProblems(freeze: SupineControlFreeze): string[] {
  const problems: string[] = [];
  const produced = freeze.producedFrom;
  if (produced === undefined) {
    return [
      "the freeze carries no producedFrom block, so nobody is recorded as having observed these bytes; "
      + "an unattributed control cannot distinguish a fresh observation from a sidecar overwrite",
    ];
  }
  if (typeof produced.observedBy !== "string" || produced.observedBy.trim() === "") {
    problems.push("producedFrom.observedBy is blank");
  }
  if (typeof produced.observedAtIso !== "string" || produced.observedAtIso.trim() === "") {
    problems.push("producedFrom.observedAtIso is blank");
  }
  if (typeof produced.reason !== "string" || produced.reason.trim() === "") {
    problems.push("producedFrom.reason is blank; a re-baseline must say what invalidated the old one");
  }
  const counts = produced.byteCountByPath;
  if (typeof counts !== "object" || counts === null || Object.keys(counts).length === 0) {
    problems.push("producedFrom.byteCountByPath is empty");
  } else {
    for (const path of Object.keys(freeze.assetSha256ByPath)) {
      const count = counts[path];
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
        problems.push(`producedFrom.byteCountByPath has no positive byte count for ${path}`);
      }
    }
  }
  return problems;
}

export type SupineControlProduction =
  | { produced: true; freeze: SupineControlFreeze }
  | { produced: false; reason: string };

/**
 * Produce (or re-produce) the control freeze FROM A FRESH OBSERVATION, or refuse.
 *
 * This is the only sanctioned way a control comes into existence. It refuses three things, and each
 * one is a way the "production" would have been an overwrite in disguise:
 *
 *  - no observer or no timestamp: nobody is accountable for having looked;
 *  - no reason: a re-baseline that does not say what invalidated the previous control is
 *    indistinguishable from one taken to make a red go away, which is what happened at HEAD
 *    40090435 and is what required_behavior 3 forbids;
 *  - an asset that could not be read: recording an empty digest would make the control compare equal
 *    to every future tree in which that asset is also unreadable.
 *
 * It does NOT write. The caller decides where the record goes, so a producer cannot quietly replace
 * a record it was only asked to compute — the separation the deleted import side effect did not have.
 */
export function produceSupineControlFreeze(input: {
  observedBy: string;
  observedAtIso: string;
  reason: string;
  repoRootPath?: string;
  /** Additive published-bytes override keyed by control-asset rel path. */
  publishedControlAssets?: Record<string, Buffer>;
}): SupineControlProduction {
  if (input.observedBy.trim() === "") {
    return { produced: false, reason: "a control freeze must name the observer who produced it" };
  }
  if (input.observedAtIso.trim() === "") {
    return { produced: false, reason: "a control freeze must record when the observation was taken" };
  }
  if (input.reason.trim() === "") {
    return {
      produced: false,
      reason:
        "a control freeze must record WHY it was produced; a re-baseline with no stated cause cannot be "
        + "told apart from one taken to clear a red",
    };
  }
  const root = input.repoRootPath ?? repoRoot();
  const overrides = input.publishedControlAssets ?? {};
  const assetSha256ByPath = computeAssetHashes(root, overrides);
  const unreadable = Object.entries(assetSha256ByPath)
    .filter(([, digest]) => digest === "")
    .map(([path]) => path);
  if (unreadable.length > 0) {
    return {
      produced: false,
      reason:
        `these control assets could not be read: ${unreadable.join(", ")}. Recording an empty digest for `
        + "them would make the control compare equal to every tree that also cannot read them.",
    };
  }
  const byteCountByPath = computeAssetByteCounts(root, overrides);
  return {
    produced: true,
    freeze: {
      schemaVersion: "openclinxr.supine-control-freeze.v1",
      scenarioId: CONTROL_SCENARIO_ID,
      assetSha256ByPath,
      staged: {
        posture: STAGED_VALUES.posture,
        supportSurfaceCount: STAGED_VALUES.supportSurfaceCount,
        clearanceAboveDeckMeters: STAGED_VALUES.clearanceAboveDeckMeters,
      },
      producedFrom: {
        observedBy: input.observedBy,
        observedAtIso: input.observedAtIso,
        reason: input.reason,
        byteCountByPath,
      },
    },
  };
}
