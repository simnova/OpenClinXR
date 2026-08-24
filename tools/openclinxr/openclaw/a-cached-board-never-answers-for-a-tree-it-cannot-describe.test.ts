import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TTL_MS, getBoardSnapshot, readCachedSnapshot, writeSnapshot } from "./board-snapshot-cache.js";

/**
 * OBSERVABLE: every caller pays for its own full board read, and the budget cannot carry it.
 *
 * MEASURED 2026-08-24. A full read is ~7 paginated GraphQL queries over 625 items (3.3 MB) and it
 * FAILED twice in one afternoon — the second time at 15 points remaining. The dequeue, the
 * supervisor audit and a concurrently-running agent each fetch independently.
 *
 * WHY NOT READ LESS INSTEAD. Board POSITION is uncorrelated with priority: the four P0s sit at
 * positions 22, 596, 603 and 619 of 625, and only 31 of 70 prioritized items fall inside the first
 * 200. `gh project item-list` has no server-side sort or filter, so "fetch the top slice" returns an
 * arbitrary slice. Caching a COMPLETE read is the only safe way to read less often.
 *
 * The two failure modes this cache could introduce are exactly the ones already documented in
 * PROTO_VERIFY_DELEGATION — §7s, a measure-once-to-disk contract green about a tree it no longer
 * described, and §9y, a cached artifact inventing a regression that was never there. Both are
 * pinned below.
 *
 * claimScope: that a truncated read is never cached or returned, that staleness is always reported,
 *   and that a stale snapshot is served only when the caller opted in.
 * notEvidenceFor: the right TTL for any caller, whether the board content is correct, or the
 *   priority ordering itself.
 */

const root = (): string => {
  const d = mkdtempSync(join(tmpdir(), "board-cache-"));
  mkdirSync(join(d, ".openclinxr/openclaw"), { recursive: true });
  return d;
};
const CACHE = ".openclinxr/openclaw/board-snapshot-cache.json";
const page = (n: number, total = n): string =>
  JSON.stringify({ totalCount: total, items: Array.from({ length: n }, (_, i) => ({ id: `i${i}` })) });

describe("a cached board never answers for a tree it cannot describe", () => {
  it("(1) a fresh snapshot is served from cache without a fetch", () => {
    const r = root();
    let calls = 0;
    const fetcher = (): string => { calls++; return page(3); };
    const now = Date.parse("2026-08-24T12:00:00Z");
    getBoardSnapshot(r, { fetcher, nowMs: now });
    const second = getBoardSnapshot(r, { fetcher, nowMs: now + 1000 });
    expect(calls, "the second read inside the TTL must not hit the network").toBe(1);
    expect(second.fromCache).toBe(true);
    expect(second.ageMs).toBe(1000);
  });

  it("(2) a TRUNCATED read is never cached and never returned", () => {
    // The single most dangerous thing a cache could do here: replay a partial board as authoritative
    // for the whole TTL. board-next-selector refuses truncation at selection time; this refuses it
    // one layer earlier, at write time.
    const r = root();
    expect(() => getBoardSnapshot(r, { fetcher: () => page(200, 625) }))
      .toThrow(/truncated board read: 200 of 625/u);
    expect(existsSync(join(r, CACHE)), "nothing may reach disk").toBe(false);
  });

  it("(3) staleness is REPORTED, never silent", () => {
    const r = root();
    const now = Date.parse("2026-08-24T12:00:00Z");
    getBoardSnapshot(r, { fetcher: () => page(3), nowMs: now });
    const stale = getBoardSnapshot(r, {
      fetcher: () => { throw new Error("GraphQL: API rate limit exceeded"); },
      nowMs: now + 5 * 60_000, allowStaleOnFailure: true,
    });
    expect(stale.fromCache).toBe(true);
    expect(stale.ageMs).toBe(5 * 60_000);
    expect(stale.staleReason, "a served-stale answer must say so and why").toMatch(/rate limit/u);
  });

  it("(4) COUNTERWEIGHT: without opt-in, a failed fetch THROWS rather than serving stale", () => {
    // The dequeue must never act on a stale board — it could hand out a card another agent already
    // took. Serving stale is a choice the caller makes, not a fallback the cache makes for it.
    const r = root();
    const now = Date.parse("2026-08-24T12:00:00Z");
    getBoardSnapshot(r, { fetcher: () => page(3), nowMs: now });
    expect(() => getBoardSnapshot(r, {
      fetcher: () => { throw new Error("boom"); }, nowMs: now + DEFAULT_TTL_MS + 1,
    })).toThrow(/boom/u);
  });

  it("(5) COUNTERWEIGHT: an EXPIRED snapshot triggers a real fetch", () => {
    // Refuses the over-correction of a cache that never refreshes. §7s's defect was a measurement
    // that stayed green about a tree it no longer described.
    const r = root();
    let calls = 0;
    const fetcher = (): string => { calls++; return page(3); };
    const now = Date.parse("2026-08-24T12:00:00Z");
    getBoardSnapshot(r, { fetcher, nowMs: now });
    const fresh = getBoardSnapshot(r, { fetcher, nowMs: now + DEFAULT_TTL_MS + 1 });
    expect(calls).toBe(2);
    expect(fresh.fromCache).toBe(false);
    expect(fresh.ageMs).toBe(0);
  });

  it("(6) COUNTERWEIGHT: a FUTURE-dated snapshot is not treated as fresh", () => {
    // Clock skew between concurrent agents sharing one cache file. A future timestamp would
    // otherwise pin the cache open indefinitely — it would always look younger than the TTL.
    const r = root();
    writeSnapshot(r, { items: [{ id: "i0" }], totalCount: 1, fetchedAtIso: "2099-01-01T00:00:00Z" });
    let calls = 0;
    const out = getBoardSnapshot(r, { fetcher: () => { calls++; return page(2); }, nowMs: Date.now() });
    expect(calls, "a snapshot from the future is unusable, not fresh").toBe(1);
    expect(out.fromCache).toBe(false);
  });

  it("(7) VACUITY GUARD: a truncated snapshot already on disk is refused on read", () => {
    // Defence in depth — if one ever reached disk by another path, it must still not be served.
    const r = root();
    writeFileSync(join(r, CACHE),
      `${JSON.stringify({ items: [{ id: "a" }], totalCount: 9, fetchedAtIso: new Date().toISOString() })}\n`);
    expect(readCachedSnapshot(r), "items.length !== totalCount is unusable").toBeNull();
  });

  it("(8) a zero TTL always refetches, and STILL serves stale when the live read fails", () => {
    // The supervisor audit uses ttlMs 0. FOUND BY THE LOOP AGAINST ITSELF on iteration 5: a 30-minute
    // TTL made the audit report ready=6 immediately after a correction that made it 7, because the
    // snapshot predated the change by 7.5 minutes. Duty 2 under-reported exactly when the loop was
    // working, and an iteration could not see its own correction.
    //
    // Both halves matter: fresh by default, but a failed live read must still fall back rather than
    // losing the whole audit — that is the case the cache is genuinely for here.
    const r = root();
    let calls = 0;
    const fetcher = (): string => { calls++; return page(3); };
    const now = Date.parse("2026-08-24T12:00:00Z");
    getBoardSnapshot(r, { fetcher, nowMs: now, ttlMs: 0 });
    getBoardSnapshot(r, { fetcher, nowMs: now + 1, ttlMs: 0 });
    expect(calls, "a zero TTL never serves from cache on a healthy read").toBe(2);

    const stale = getBoardSnapshot(r, {
      fetcher: () => { throw new Error("GraphQL: API rate limit exceeded"); },
      nowMs: now + 60_000, ttlMs: 0, allowStaleOnFailure: true,
    });
    expect(stale.fromCache, "a failed read still falls back").toBe(true);
    expect(stale.staleReason).toMatch(/rate limit/u);
  });
});
