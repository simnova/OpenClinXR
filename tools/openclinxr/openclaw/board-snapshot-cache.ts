/**
 * One shared, TTL-bounded snapshot of the project board.
 *
 * WHY. The board read is the most expensive recurring call in this repo and every caller pays for
 * its own. MEASURED 2026-08-24: a full read is ~7 paginated GraphQL queries over 625 items (3.3 MB),
 * and it FAILED twice in one afternoon at 15 points remaining. The dequeue, the supervisor audit and
 * a concurrently-running agent each fetch independently, so the budget drains N times faster than
 * the work requires.
 *
 * WHY NOT JUST READ LESS. Because a partial board cannot be ranked. Board POSITION is uncorrelated
 * with priority — measured, the four P0s sit at positions 22, 596, 603 and 619 of 625, and only 31
 * of 70 prioritized items fall inside the first 200. `gh project item-list` offers no server-side
 * sort or filter, so "fetch the top slice" is not available: the top slice is arbitrary. Caching a
 * COMPLETE read is the only safe way to read less often.
 *
 * TWO RULES THAT MAKE THIS SAFE, both learned from failures already in this repo:
 *
 *   1. A TRUNCATED READ IS NEVER CACHED. `fetched !== totalCount` is refused at write time, so a
 *      partial fetch cannot be replayed as authoritative for the rest of the TTL. This is the same
 *      refusal `board-next-selector.ts` makes, moved one layer earlier.
 *
 *   2. STALENESS IS A RETURNED VALUE, NEVER A DEFAULT. Every read reports `fromCache` and `ageMs`.
 *      §7s of PROTO_VERIFY_DELEGATION records a measure-once-to-disk contract that stayed green
 *      about a tree it no longer described, and §9y its mirror — a cached artifact inventing a
 *      regression that was not there. A cache that cannot say how old it is repeats both.
 *
 * TTL IS THE CALLER'S CHOICE and the two callers genuinely differ. The dequeue must not hand out a
 * card another agent already took, so it wants seconds. The hourly audit tolerates minutes. Defaults
 * are deliberately conservative; a caller that wants a long TTL must say so.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type BoardSnapshot = {
  items: Array<Record<string, unknown>>;
  totalCount: number;
  fetchedAtIso: string;
};

export type SnapshotRead = BoardSnapshot & {
  fromCache: boolean;
  ageMs: number;
  /** Set when the live fetch failed and a stale snapshot was served instead. Never silent. */
  staleReason?: string;
};

export const DEFAULT_TTL_MS = 60_000;
const CACHE_REL = ".openclinxr/openclaw/board-snapshot-cache.json";

export type BoardFetcher = () => string;

const defaultFetcher = (owner: string, projectNumber: number): BoardFetcher => () =>
  execFileSync("gh", ["project", "item-list", String(projectNumber), "--owner", owner,
    "--limit", "5000", "--format", "json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

export function readCachedSnapshot(root: string): BoardSnapshot | null {
  const p = join(root, CACHE_REL);
  if (!existsSync(p)) return null;
  try {
    const d = JSON.parse(readFileSync(p, "utf8")) as BoardSnapshot;
    if (!Array.isArray(d.items) || typeof d.totalCount !== "number") return null;
    // Defence in depth: even if a truncated snapshot reached disk somehow, never serve it.
    if (d.items.length !== d.totalCount) return null;
    return d;
  } catch { return null; }
}

export function writeSnapshot(root: string, snap: BoardSnapshot): boolean {
  if (snap.items.length !== snap.totalCount) return false;
  const p = join(root, CACHE_REL);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snap)}\n`, "utf8");
  // Atomic rename so a concurrent reader never sees a half-written snapshot.
  execFileSync("mv", [tmp, p], { stdio: "ignore" });
  return true;
}

/**
 * Returns a COMPLETE board snapshot, from cache when fresh enough, otherwise live.
 *
 * `allowStaleOnFailure` decides what happens when the live fetch fails — which today means the
 * GraphQL budget is spent. The audit prefers a labelled stale answer to no answer; the dequeue must
 * not, because acting on a stale board can hand out a card another agent already took.
 */
export function getBoardSnapshot(
  root: string,
  opts: { ttlMs?: number; nowMs?: number; owner?: string; projectNumber?: number;
          fetcher?: BoardFetcher; allowStaleOnFailure?: boolean } = {},
): SnapshotRead {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const nowMs = opts.nowMs ?? Date.now();
  const cached = readCachedSnapshot(root);
  const ageOf = (s: BoardSnapshot): number => nowMs - Date.parse(s.fetchedAtIso);

  if (cached) {
    const age = ageOf(cached);
    // A future-dated snapshot (clock skew, or a peer with a fast clock) is not "fresh" — treat it
    // as unusable rather than letting it pin the cache open forever.
    if (age >= 0 && age < ttlMs) return { ...cached, fromCache: true, ageMs: age };
  }

  const fetcher = opts.fetcher ?? defaultFetcher(opts.owner ?? "simnova", opts.projectNumber ?? 7);
  try {
    const parsed = JSON.parse(fetcher()) as { totalCount?: number; items?: Array<Record<string, unknown>> };
    const items = parsed.items ?? [];
    const totalCount = parsed.totalCount ?? -1;
    if (totalCount < 0 || items.length !== totalCount) {
      throw new Error(`truncated board read: ${items.length} of ${totalCount} — refusing to cache or return it`);
    }
    const snap: BoardSnapshot = { items, totalCount, fetchedAtIso: new Date(nowMs).toISOString() };
    writeSnapshot(root, snap);
    return { ...snap, fromCache: false, ageMs: 0 };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    if (opts.allowStaleOnFailure && cached) {
      return { ...cached, fromCache: true, ageMs: ageOf(cached),
        staleReason: `live board read failed (${why.slice(0, 120)}); served a snapshot ${Math.round(ageOf(cached) / 1000)}s old` };
    }
    throw error;
  }
}
