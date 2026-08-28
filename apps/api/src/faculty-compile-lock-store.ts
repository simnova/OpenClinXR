import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repoRoot } from "./scenario-promotion-io.js";

/**
 * Faculty compile-lock store (WCG persist hole: admin Switch was React state only).
 *
 * The admin UI POSTs each lock/override change; this module writes a per-scenario
 * JSON under the gitignored `.openclinxr/compile-locks/` directory. The World
 * Compile Graph compile runner (tools/openclinxr/factory) reads the same file
 * when present and applies the locks before planning wardrobe bakes.
 *
 * The file is review metadata, not a compile: it never promotes or publishes a
 * compile/materialization packet. compileVersion stays untouched.
 */

/**
 * ActorPhenotypeSchema pointer paths a faculty compile lock may override.
 * Must stay aligned with FACULTY_LOCK_OVERRIDE_PATHS in
 * tools/openclinxr/factory/encounter-materialization-faculty-locks.ts and
 * FACULTY_COMPILE_OVERRIDE_PATHS in apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx.
 */
export const FACULTY_COMPILE_LOCK_OVERRIDE_PATHS = [
  "/garmentLayers",
  "/clothing_style",
  "/wardrobeRole",
  "/fabricPalette",
] as const;

export type FacultyCompileLockOverridePath = (typeof FACULTY_COMPILE_LOCK_OVERRIDE_PATHS)[number];

export type FacultyCompileLockFileLock = {
  nodeId: string;
  locked: boolean;
  /** Optional ActorPhenotypeSchema pointer; only the four constant paths are allowed. */
  overridePath?: string;
  /** ActorPhenotypeSchema value the override applies (the value half of the overridePatch). Opaque review metadata. */
  overrideValue?: unknown;
};

export type FacultyCompileLockFile = {
  scenarioId: string;
  updatedAt: string;
  claimBoundary: "faculty_compile_lock_review_metadata_only";
  notEvidenceFor: readonly string[];
  locks: FacultyCompileLockFileLock[];
};

/** Gitignored per-scenario lock store (compile runner reads this same path). */
export const FACULTY_COMPILE_LOCKS_DIR = ".openclinxr/compile-locks";

export const FACULTY_COMPILE_LOCK_CLAIM_BOUNDARY = "faculty_compile_lock_review_metadata_only" as const;

export const FACULTY_COMPILE_LOCK_NOT_EVIDENCE_FOR = [
  "review_packet_promotion",
  "production_asset_readiness",
  "quest_readiness",
] as const;

/** Scenario ids are slug-like; refuse anything that could escape the store directory. */
const SCENARIO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** Absolute path of the compile-locks file for a scenario. Throws for unsafe ids. */
export function compileLocksPathFor(scenarioId: string): string {
  if (!SCENARIO_ID_PATTERN.test(scenarioId)) {
    throw new Error(`faculty compile-lock store: invalid scenarioId ${JSON.stringify(scenarioId)}`);
  }
  return join(repoRoot(), FACULTY_COMPILE_LOCKS_DIR, `${scenarioId}.json`);
}

/** Read the current lock record for a scenario; a missing file yields an empty record. */
export async function readFacultyCompileLocksRecord(scenarioId: string): Promise<FacultyCompileLockFile> {
  const filePath = compileLocksPathFor(scenarioId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyFacultyCompileLockFile(scenarioId);
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as ParsedCompileLockFile;
  if (!isObject(parsed) || parsed.scenarioId !== scenarioId || !Array.isArray(parsed.locks)) {
    throw new Error(`faculty compile-lock store: malformed lock file at ${filePath}`);
  }
  const locks = parsed.locks as unknown[];
  for (const entry of locks) {
    if (!isObject(entry) || typeof entry.nodeId !== "string" || typeof entry.locked !== "boolean") {
      throw new Error(`faculty compile-lock store: malformed lock entry at ${filePath}`);
    }
    if (entry.overridePath !== undefined && (typeof entry.overridePath !== "string" || !(FACULTY_COMPILE_LOCK_OVERRIDE_PATHS as readonly string[]).includes(entry.overridePath))) {
      throw new Error(`faculty compile-lock store: invalid overridePath ${String(entry.overridePath)} for ${entry.nodeId}`);
    }
  }
  return {
    scenarioId,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    claimBoundary: FACULTY_COMPILE_LOCK_CLAIM_BOUNDARY,
    notEvidenceFor: FACULTY_COMPILE_LOCK_NOT_EVIDENCE_FOR,
    locks: (locks as ParsedCompileLockEntry[]).map((entry) => ({
      nodeId: entry.nodeId as string,
      locked: entry.locked as boolean,
      ...(typeof entry.overridePath === "string" ? { overridePath: entry.overridePath } : {}),
      ...(entry.overrideValue === undefined ? {} : { overrideValue: entry.overrideValue }),
    })),
  };
}

/** Upsert one lock by nodeId and persist the file. Returns the updated record. */
export async function writeFacultyCompileLock(
  scenarioId: string,
  lock: FacultyCompileLockFileLock,
): Promise<FacultyCompileLockFile> {
  if (lock.overridePath !== undefined && !(FACULTY_COMPILE_LOCK_OVERRIDE_PATHS as readonly string[]).includes(lock.overridePath)) {
    throw new Error(`faculty compile-lock store: invalid overridePath ${lock.overridePath} for ${lock.nodeId}`);
  }
  const existing = await readFacultyCompileLocksRecord(scenarioId);
  const withoutNode = existing.locks.filter((entry) => entry.nodeId !== lock.nodeId);
  const next: FacultyCompileLockFile = {
    scenarioId,
    updatedAt: new Date().toISOString(),
    claimBoundary: FACULTY_COMPILE_LOCK_CLAIM_BOUNDARY,
    notEvidenceFor: FACULTY_COMPILE_LOCK_NOT_EVIDENCE_FOR,
    locks: [
      ...withoutNode,
      {
        nodeId: lock.nodeId,
        locked: lock.locked,
        ...(lock.overridePath === undefined ? {} : { overridePath: lock.overridePath }),
        ...(lock.overrideValue === undefined ? {} : { overrideValue: lock.overrideValue }),
      },
    ],
  };
  const filePath = compileLocksPathFor(scenarioId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function emptyFacultyCompileLockFile(scenarioId: string): FacultyCompileLockFile {
  return {
    scenarioId,
    updatedAt: "",
    claimBoundary: FACULTY_COMPILE_LOCK_CLAIM_BOUNDARY,
    notEvidenceFor: FACULTY_COMPILE_LOCK_NOT_EVIDENCE_FOR,
    locks: [],
  };
}

type ParsedCompileLockFile = {
  scenarioId?: unknown;
  updatedAt?: unknown;
  locks?: unknown;
};

type ParsedCompileLockEntry = {
  nodeId?: unknown;
  locked?: unknown;
  overridePath?: unknown;
  overrideValue?: unknown;
};

function isObject(value: unknown): value is ParsedCompileLockFile & ParsedCompileLockEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
