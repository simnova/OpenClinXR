import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveSharedCoordinationPath } from "./coordination-root.js";

/**
 * **Static GitHub project metadata, resolved once and shared by every agent on this machine.**
 *
 * ## THE MEASURED WASTE
 *
 * `board-cli.ts` makes FOUR `gh` calls for every Factory transition:
 *
 *     gh project view       -> project node id      STATIC — changes never
 *     gh project item-add   -> item id              per-issue
 *     gh project field-list -> field + option ids   STATIC — changes only if the board schema is edited
 *     the mutation itself
 *
 * Half of that is re-resolving constants. On 2026-08-23 a single board sweep performed ~70
 * transitions, so ~140 of its calls asked GitHub to repeat answers it had already given, on a
 * GraphQL budget that is **shared across every agent and tool on the account** and which that
 * session exhausted at 0/5000.
 *
 * ## WHY A CACHE IS SAFE HERE AND NOT SAFE EVERYWHERE
 *
 * This caches IDENTIFIERS, not state. A project's node id and a single-select option's id are
 * durable; item Factory/Priority VALUES are not, and are deliberately absent. Caching an id risks a
 * stale pointer, which fails loudly when GitHub rejects it. Caching a value risks acting on a
 * decision someone else already changed, which fails silently — and this repo has been bitten by the
 * silent kind repeatedly.
 *
 * ## WHY THE SHARED COORDINATION ROOT
 *
 * `resolveSharedCoordinationPath` puts this in ONE directory every worktree resolves to, so a worker
 * in `~/.grok/worktrees/...` and the orchestrator in the main checkout share one cache instead of
 * warming their own. A cache that each agent warms privately saves nothing on a shared quota — which
 * is the whole point. Measured the same night: a dispatch guard using `join(repoRoot, ...)` instead
 * of this resolver was silently inert in every worktree.
 *
 * claimScope: identifier resolution for GitHub Projects v2.
 * notEvidenceFor: item field VALUES, issue state, or anything a decision is made on.
 */

const CACHE_REL = ".openclinxr/openclaw/github-project-metadata.json";
/** Identifiers are durable; a day bounds the damage of a board schema edit nobody announced. */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ProjectMetadata = {
  schemaVersion: "openclinxr.github-project-metadata.v1";
  owner: string;
  projectNumber: number;
  projectId: string;
  /** field name -> { id, options: name -> id } */
  fields: Record<string, { id: string; options: Record<string, string> }>;
  fetchedAt: string;
  /** How the value was obtained on THIS call. Never inferred — the caller can assert on it. */
  source?: "cache" | "network";
  ageMs?: number;
};

const cachePath = (repoRoot: string): string => resolveSharedCoordinationPath(CACHE_REL, repoRoot);

/** Atomic write: a torn cache file is worse than none, and two agents may write concurrently. */
function writeAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

export function readCachedProjectMetadata(repoRoot: string, nowMs = Date.now()): ProjectMetadata | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath(repoRoot), "utf8")) as ProjectMetadata;
    if (raw.schemaVersion !== "openclinxr.github-project-metadata.v1") return null;
    if (!raw.projectId || !raw.fields) return null;
    const age = nowMs - Date.parse(raw.fetchedAt);
    if (!Number.isFinite(age) || age < 0) return null;
    return { ...raw, ageMs: age };
  } catch {
    return null; // absent or corrupt cache is a miss, never an error
  }
}

/** One GraphQL round trip for the project id, every field id, and every option id. */
export function fetchProjectMetadata(owner: string, projectNumber: number): ProjectMetadata {
  const out = execFileSync("gh", ["api", "graphql", "-f", `query=
    query { organization(login: "${owner}") { projectV2(number: ${projectNumber}) {
      id
      fields(first: 50) { nodes {
        ... on ProjectV2SingleSelectField { id name options { id name } }
        ... on ProjectV2FieldCommon { id name }
      } }
    } } }`], { encoding: "utf8", timeout: 30_000 });
  const p = (JSON.parse(out) as {
    data: { organization: { projectV2: { id: string; fields: { nodes: ({ id: string; name: string; options?: { id: string; name: string }[] } | null)[] } } } };
  }).data.organization.projectV2;
  const fields: ProjectMetadata["fields"] = {};
  for (const f of p.fields.nodes) {
    if (!f?.name) continue;
    fields[f.name] = {
      id: f.id,
      options: Object.fromEntries((f.options ?? []).map((o) => [o.name, o.id])),
    };
  }
  return {
    schemaVersion: "openclinxr.github-project-metadata.v1",
    owner, projectNumber, projectId: p.id, fields,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Cached identifiers, refreshing only past `maxAgeMs`.
 *
 * `force` exists for the one case a cache cannot serve: someone edited the board schema and the
 * cached option id no longer resolves. The caller sees the rejection and retries with force, rather
 * than this guessing.
 */
export function resolveProjectMetadata(
  repoRoot: string,
  owner: string,
  projectNumber: number,
  opts: { maxAgeMs?: number; force?: boolean; nowMs?: number } = {},
): ProjectMetadata {
  const now = opts.nowMs ?? Date.now();
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!opts.force) {
    const hit = readCachedProjectMetadata(repoRoot, now);
    if (hit && hit.owner === owner && hit.projectNumber === projectNumber && (hit.ageMs ?? 0) <= maxAge) {
      return { ...hit, source: "cache" };
    }
  }
  const fresh = fetchProjectMetadata(owner, projectNumber);
  try {
    writeAtomic(cachePath(repoRoot), `${JSON.stringify(fresh, null, 2)}\n`);
  } catch { /* a cache that cannot be written must not break the caller */ }
  return { ...fresh, source: "network", ageMs: 0 };
}

/** Convenience: the two ids a single-select write needs, from cache when possible. */
export function resolveSingleSelect(
  repoRoot: string, owner: string, projectNumber: number, field: string, option: string,
  opts: { maxAgeMs?: number; force?: boolean } = {},
): { projectId: string; fieldId: string; optionId: string; source: "cache" | "network" } {
  const md = resolveProjectMetadata(repoRoot, owner, projectNumber, opts);
  const f = md.fields[field];
  const optionId = f?.options[option];
  if (!f || !optionId) {
    if (opts.force) throw new Error(`project ${owner}/${projectNumber} has no ${field}="${option}" (checked against a FRESH fetch)`);
    // A miss on a cached schema is exactly the stale-pointer case: re-resolve once, then fail.
    return resolveSingleSelect(repoRoot, owner, projectNumber, field, option, { ...opts, force: true });
  }
  return { projectId: md.projectId, fieldId: f.id, optionId, source: md.source ?? "network" };
}
