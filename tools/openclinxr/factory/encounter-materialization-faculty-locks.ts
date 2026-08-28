import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  type CompileGraphNode,
  type EncounterMaterializationEvidenceReport,
  emitCompileNodes,
  splitCharacterBakers,
  validateEncounterMaterializationEvidenceReport,
} from "./encounter-materialization-evidence.js";

/**
 * Faculty compile-lock persistence (WCG brief 2026-08-27, operationalize).
 *
 * A faculty lock is written INTO the evidence JSON's compileNodes (the same
 * optional, additive surface the compile runner emits) so the copy-prior rule
 * carries it forward on the next compile. One compile after a persist never
 * re-bakes a locked wardrobe whose body output hash is unchanged.
 *
 * nodeId mapping:
 *   actor:X            -> unsplit ActorVariant node (lock applies to both split children)
 *   equip:Y            -> EquipVariant node
 *   actor:X:wardrobe   -> the split wardrobe child; splitCharacterBakers is
 *                         applied on demand so the lock lands at baker granularity
 *
 * overridePatch is accepted ONLY for the ActorPhenotypeSchema pointers the
 * evidence validator allows; any other path is refused.
 */

/** Faculty lock override paths — must stay aligned with ACTOR_PHENOTYPE_OVERRIDE_PATHS in encounter-materialization-evidence.ts. */
export const FACULTY_LOCK_OVERRIDE_PATHS = ["/garmentLayers", "/clothing_style", "/wardrobeRole", "/fabricPalette"] as const;

export type FacultyCompileLock = {
  nodeId: string;
  locked: boolean;
  /** Optional ActorPhenotypeSchema pointer; refused when outside FACULTY_LOCK_OVERRIDE_PATHS. */
  overridePath?: string;
};

export type PersistFacultyCompileLocksOptions = {
  /** Path to a dated evidence JSON to read and (by default) overwrite. */
  priorPath?: string;
  /** In-memory evidence report. Takes precedence over priorPath. */
  prior?: EncounterMaterializationEvidenceReport;
  locks: FacultyCompileLock[];
  /** Output path; defaults to overwriting priorPath. No write when neither is given. */
  outPath?: string;
};

/**
 * Per-scenario compile-locks file written by the admin faculty lock API
 * (apps/api/src/faculty-compile-lock-store.ts) under the gitignored
 * `.openclinxr/compile-locks/` directory. The compile runner reads it when present.
 */
export function facultyCompileLocksPathForScenario(scenarioId: string): string {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  return path.join(repoRoot, ".openclinxr", "compile-locks", `${scenarioId}.json`);
}

/**
 * Read the admin-persisted compile-locks file for a scenario. Returns the lock
 * list, or null when the file is absent. Refuses entries whose overridePath is
 * outside FACULTY_LOCK_OVERRIDE_PATHS so a malformed file cannot smuggle an
 * unchecked phenotype pointer into a compile.
 */
export async function readFacultyCompileLocksFile(
  filePath: string,
  scenarioId: string,
): Promise<FacultyCompileLock[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || parsed["scenarioId"] !== scenarioId || !Array.isArray(parsed["locks"])) {
    throw new Error(`readFacultyCompileLocksFile: malformed compile-locks file at ${filePath}`);
  }
  const locks = parsed["locks"] as unknown[];
  const compiled: FacultyCompileLock[] = [];
  for (const entry of locks) {
    if (!isRecord(entry) || typeof entry["nodeId"] !== "string" || typeof entry["locked"] !== "boolean") {
      throw new Error(`readFacultyCompileLocksFile: malformed lock entry at ${filePath}`);
    }
    const lock: FacultyCompileLock = { nodeId: entry["nodeId"], locked: entry["locked"] };
    if (entry["overridePath"] !== undefined) {
      if (typeof entry["overridePath"] !== "string" || !(FACULTY_LOCK_OVERRIDE_PATHS as readonly string[]).includes(entry["overridePath"])) {
        throw new Error(
          `readFacultyCompileLocksFile: invalid overridePath ${String(entry["overridePath"])} for ${lock.nodeId}`,
        );
      }
      lock.overridePath = entry["overridePath"];
    }
    compiled.push(lock);
  }
  return compiled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Write faculty locks into a (copy of) the evidence report's compileNodes.
 * Returns the updated report; writes it to outPath or over priorPath when one
 * is given. compileVersion is intentionally NOT bumped — a lock write is not a
 * compile.
 */
export async function persistFacultyCompileLocks(opts: PersistFacultyCompileLocksOptions): Promise<EncounterMaterializationEvidenceReport> {
  const base = await resolveLockBaseReport(opts);
  const priorPath = base.priorPath;
  const report = base.report;

  const nodes = emitCompileNodes(report, report.compileNodes ?? []);
  for (const lock of opts.locks) {
    applyFacultyLock(nodes, lock);
  }

  const compiled: EncounterMaterializationEvidenceReport = {
    ...report,
    compileNodes: nodes,
  };

  const targetPath = opts.outPath ?? priorPath;
  if (targetPath) {
    await writeFile(targetPath, `${JSON.stringify(compiled, null, 2)}\n`, "utf8");
  }
  return compiled;
}

async function resolveLockBaseReport(opts: PersistFacultyCompileLocksOptions): Promise<{ report: EncounterMaterializationEvidenceReport; priorPath: string | null }> {
  let report = opts.prior ?? null;
  const priorPath = opts.priorPath ?? null;
  if (!report && priorPath) {
    const raw = JSON.parse(await readFile(priorPath, "utf8")) as unknown;
    const validation = validateEncounterMaterializationEvidenceReport(raw);
    if (!validation.ok) {
      throw new Error(`prior evidence JSON failed validation: ${validation.errors.join("; ")}`);
    }
    report = raw as EncounterMaterializationEvidenceReport;
  }
  if (!report) {
    throw new Error("persistFacultyCompileLocks requires opts.prior or opts.priorPath");
  }
  return { report, priorPath };
}

/** Apply one faculty lock onto the (mutable) compile node list, splitting on demand for wardrobe nodeIds. */
function applyFacultyLock(nodes: CompileGraphNode[], lock: FacultyCompileLock): void {
  const existing = nodes.find((n) => n.nodeId === lock.nodeId);
  if (existing) {
    nodes[nodes.indexOf(existing)] = withFacultyLock(existing, lock);
    return;
  }
  if (lock.nodeId.endsWith(":wardrobe")) {
    const actorNodeId = lock.nodeId.replace(/:wardrobe$/, "");
    const actorNode = nodes.find((n) => n.nodeId === actorNodeId);
    if (!actorNode) {
      throw new Error(
        `persistFacultyCompileLocks: cannot lock ${lock.nodeId} — no compile node for actor ${actorNodeId} exists in the evidence report`,
      );
    }
    const [body, wardrobe] = splitCharacterBakers(actorNode);
    // The lock lands on the wardrobe child only; the body child keeps whatever
    // lock the unsplit node carried (splitCharacterBakers spreads it).
    const index = nodes.indexOf(actorNode);
    nodes.splice(index, 1, body, withFacultyLock(wardrobe, lock));
    return;
  }
  throw new Error(
    `persistFacultyCompileLocks: unknown compile node ${lock.nodeId} — expected actor:X, equip:Y, or actor:X:wardrobe`,
  );
}

function withFacultyLock(node: CompileGraphNode, lock: FacultyCompileLock): CompileGraphNode {
  let overridePatch = node.overridePatch;
  if (lock.overridePath !== undefined) {
    if (!(FACULTY_LOCK_OVERRIDE_PATHS as readonly string[]).includes(lock.overridePath)) {
      throw new Error(
        `persistFacultyCompileLocks: invalid overridePath ${lock.overridePath} for ${lock.nodeId} — must be one of ${FACULTY_LOCK_OVERRIDE_PATHS.join(", ")}`,
      );
    }
    overridePatch = { op: "replace", path: lock.overridePath };
  }
  if (!lock.locked) {
    // An unlock releases the phenotype override too — a compile no longer carries it.
    overridePatch = undefined;
  }
  return {
    ...node,
    lock: { ...(node.lock ?? {}), locked: lock.locked, lockKind: "faculty_compile_lock" },
    ...(overridePatch === undefined ? {} : { overridePatch }),
  };
}
