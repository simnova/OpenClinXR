import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveInputBytes } from "./resolve-store-ref.js";

export interface MigrationEntry {
  path: string;
  sha256: string;
  bytes: number;
  storeRef: string;
  producer: string;
  sourceCommit: string;
}

export interface MigrationManifest {
  schemaVersion: number;
  migration: string;
  sourceHead: string;
  storeRoot: string;
  files: MigrationEntry[];
  aliases: Record<string, string[]>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const SAFE_PATH = /^\.openclinxr\/evidence\/[A-Za-z0-9._\-/]+\.glb$/;
const MIGRATION_NAME = /^[a-z0-9][a-z0-9-]{0,79}$/;

function fail(why: string): never {
  throw new Error(`historical-glb-migration: refused — ${why}.`);
}

function hasDotSegment(p: string): boolean {
  return p.split("/").some((s) => s === "." || s === "..");
}

export function validateMigrationManifest(raw: unknown): MigrationManifest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("manifest is not an object");
  const m = raw as Record<string, unknown>;
  if (m.schemaVersion !== 1) fail("want schemaVersion 1");
  if (typeof m.migration !== "string" || !MIGRATION_NAME.test(m.migration))
    fail("malformed migration name");
  if (typeof m.sourceHead !== "string" || !HEX40.test(m.sourceHead))
    fail("sourceHead is not a 40-hex commit");
  if (typeof m.storeRoot !== "string" || !m.storeRoot.startsWith("/"))
    fail("storeRoot is not absolute");
  if (!Array.isArray(m.files) || m.files.length !== 10) fail("want exactly ten file entries");
  const seen = new Map<string, MigrationEntry>();
  const files: MigrationEntry[] = (m.files as unknown[]).map((e) => {
    if (e === null || typeof e !== "object" || Array.isArray(e)) fail("null entry");
    const r = e as Record<string, unknown>;
    if (typeof r.path !== "string" || !SAFE_PATH.test(r.path) || hasDotSegment(r.path))
      fail(`unsafe logical path ${String((r as Record<string, unknown>).path)}`);
    if (typeof r.sha256 !== "string" || !HEX64.test(r.sha256)) fail(`bad sha256 for ${r.path}`);
    if (typeof r.bytes !== "number" || !Number.isInteger(r.bytes) || r.bytes <= 0)
      fail(`bad bytes for ${r.path}`);
    if (typeof r.producer !== "string" || r.producer.trim().length === 0)
      fail(`empty producer for ${r.path}`);
    if (typeof r.storeRef !== "string" || !r.storeRef.startsWith("store:"))
      fail(`bad storeRef for ${r.path}`);
    const rest = (r.storeRef as string).slice("store:".length);
    const parts = rest.split("/");
    const sha = parts[0];
    const base = parts.slice(1).join("/");
    if (sha !== r.sha256) fail(`storeRef sha mismatch for ${r.path}`);
    if (!base || /[/\\]/.test(base) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(base))
      fail(`unsafe storeRef basename for ${r.path}`);
    if (seen.has(r.path as string)) fail(`duplicate logical path ${r.path}`);
    const entry: MigrationEntry = {
      path: r.path as string,
      sha256: r.sha256 as string,
      bytes: r.bytes as number,
      storeRef: r.storeRef as string,
      producer: r.producer as string,
      sourceCommit: String(r.sourceCommit ?? ""),
    };
    if (!HEX40.test(entry.sourceCommit)) fail(`bad sourceCommit for ${r.path}`);
    seen.set(entry.path, entry);
    return entry;
  });
  const aliases = (m.aliases ?? {}) as Record<string, string[]>;
  if (aliases === null || typeof aliases !== "object" || Array.isArray(aliases))
    fail("aliases is not a map");
  let aliasTotal = 0;
  for (const [canonical, list] of Object.entries(aliases)) {
    if (!seen.get(canonical)) fail(`alias canonical ${canonical} is not a migrated path`);
    if (!Array.isArray(list) || list.length === 0) fail(`alias list empty for ${canonical}`);
    for (const a of list) {
      if (typeof a !== "string" || !SAFE_PATH.test(a) || hasDotSegment(a))
        fail(`unsafe alias path ${String(a)}`);
      if (seen.has(a)) fail(`alias ${a} conflicts with a canonical entry`);
      aliasTotal += 1;
    }
  }
  // This migration declares exactly one alias and eleven total resolvable paths.
  if (Object.keys(aliases).length !== 1 || aliasTotal !== 1)
    fail("this migration allows exactly one alias");
  const aliasTargets = Object.values(aliases).flat();
  if (new Set(aliasTargets).size !== aliasTargets.length) fail("alias targets collide");
  return {
    schemaVersion: 1,
    migration: m.migration as string,
    sourceHead: m.sourceHead as string,
    storeRoot: m.storeRoot as string,
    files,
    aliases,
  };
}

export function resolveHistoricalRef(logicalPath: string, manifest: MigrationManifest): string | null {
  const direct = manifest.files.find((f) => f.path === logicalPath);
  if (direct) return direct.storeRef;
  for (const [canonical, list] of Object.entries(manifest.aliases)) {
    if (list.includes(logicalPath)) {
      const target = manifest.files.find((f) => f.path === canonical);
      return target ? target.storeRef : null;
    }
  }
  return null;
}

export function resolveHistoricalEntry(
  logicalPath: string,
  manifest: MigrationManifest,
): MigrationEntry | null {
  const direct = manifest.files.find((f) => f.path === logicalPath);
  if (direct) return direct;
  for (const [canonical, list] of Object.entries(manifest.aliases)) {
    if (list.includes(logicalPath)) {
      return manifest.files.find((f) => f.path === canonical) ?? null;
    }
  }
  return null;
}

export function resolveStoreRoot(
  manifest: MigrationManifest,
  options?: { storeRoot?: string },
): string {
  // Precedence: explicit option, environment, manifest default.
  // Local fallback is explicit: callers pass a temp fixture root in unit tests.
  if (options?.storeRoot) return options.storeRoot;
  const env = process.env.OPENCLINXR_ASSET_STORE;
  if (env && env.trim().length > 0) return env;
  return manifest.storeRoot;
}

export async function readHistoricalBytes(
  logicalPath: string,
  manifest: MigrationManifest,
  options?: { storeRoot?: string },
): Promise<{ bytes: Buffer; filesystemPath: string; sha256: string; expectedBytes: number }> {
  const entry = resolveHistoricalEntry(logicalPath, manifest);
  if (!entry)
    fail(`no migration mapping for ${logicalPath}; unrelated missing citations stay RED`);
  const root = resolveStoreRoot(manifest, options);
  // Committed migration declaration resolves the external reference; actual bytes verified below.
  const stored = await resolveInputBytes(entry.storeRef, { storeRoot: root });
  const actual = createHash("sha256").update(stored.bytes).digest("hex");
  if (actual !== entry.sha256)
    fail(`${logicalPath} hashed ${actual}, not the migrated sha256`);
  if (stored.bytes.length !== entry.bytes)
    fail(`${logicalPath} is ${stored.bytes.length} bytes, manifest says ${entry.bytes}`);
  return {
    bytes: stored.bytes,
    filesystemPath: stored.filesystemPath,
    sha256: entry.sha256,
    expectedBytes: entry.bytes,
  };
}

export async function loadMigrationManifest(manifestPath: string): Promise<MigrationManifest> {
  const raw = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
  return validateMigrationManifest(raw);
}
