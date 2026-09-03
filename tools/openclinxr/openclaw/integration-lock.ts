/**
 * integration-lock — an atomic mutex around the one thing two orchestrators cannot share: `main`.
 *
 * ## WHY
 *
 * `integrate.ts` runs `git merge --no-edit --no-ff --no-commit` directly on the shared main checkout
 * and holds nothing while doing it. Two orchestrators worked this board concurrently on 2026-08-25
 * and main moved twice inside a single supervisor iteration.
 *
 * `Factory=Dispatched` does NOT prevent this. `setFactoryField` writes the stage unconditionally with
 * no expected-stage compare-and-set, so it is lifecycle telemetry, not ownership — both orchestrators
 * can select the same Planted card and both "claim" it.
 *
 * The existing automation lease is also not a substitute: it deliberately permits disjoint slices,
 * and its acquisition is a read-modify-write ending in a plain `writeFile`, which has exactly the
 * window this is written to close.
 *
 * ## THE PRIMITIVE, AND WHY IT IS mkdir / rename
 *
 * `mkdir` and `rename` are atomic on POSIX: a create either succeeds or fails `EEXIST`, a move
 * either succeeds or fails `ENOENT`/`ENOTEMPTY`, with no read-then-write gap. `existsSync` followed
 * by a create is NOT atomic and passes every sequential test while still letting two processes
 * through — which is why clause (5) of the contract spawns real processes rather than trusting an
 * in-process check.
 *
 * ## OPERATION MARKER: EVERY MUTATION IS SERIALIZED
 *
 * The pre-fix defect was a multi-step transition (`mkdirSync(dir)` then `claim()`) with no atomic
 * gate: a racer seeing the directory before the holder write read "abandoned" and claimed it, so
 * init and takeover were both multi-winner. Every mutating transition here — acquire, stale
 * takeover, release, renewal — first claims a single well-known op marker
 * (`integration.lock.op`, created with `O_CREAT|O_EXCL`), which is the atomic serialization point.
 * Exactly one process can hold the marker; every other process sees `EEXIST` and answers the
 * lock question from the settled state without waiting. A crashed op leaves a marker that is
 * cleared once, after `INTEGRATION_LOCK_OP_TTL_MS`, so a reap cannot wedge the land path.
 *
 * ## THE LOCK DIR APPEARS FULLY INITIALIZED OR NOT AT ALL
 *
 * The lock directory itself is installed by writing a unique staging directory and `rename`-ing it
 * into place, so the holder record is never observable half-written. Takeover and release capture
 * the existing lock with an atomic `rename` to a unique tombstone, verify the captured holder, and
 * either keep the capture (takeover/release) or `rename` it back (a refreshed holder, or a
 * successor's lock — which the predecessor must never be able to release).
 *
 * ## LIVENESS, NOT FIXED-TTL THEFT
 *
 * Staleness follows the holder's last heartbeat (`lastSeen`), not the original acquisition time, so
 * a long-running integration that renews is never stolen, while a crashed integrator that stops
 * renewing becomes stealable after `INTEGRATION_LOCK_TTL_MS`.
 *
 * ## FENCED OWNERSHIP: THE TOKEN IS THE AUTHORITY, NOT THE NAME
 *
 * `acquire` hands the winner an opaque, >=128-bit random token and stores only its SHA-256 digest in
 * `holder.json` (the record is world-readable by design, so the raw token must not be). Release and
 * renewal authenticate by hashing the caller's token and comparing digests: the owner STRING written
 * into the record is diagnostic (`heldBy` for a human) and is never sufficient to release or renew.
 * A process that reads `holder.json` and learns the owner name still cannot touch the lock. A record
 * with no digest (a hand-written or pre-token holder) cannot be released or renewed by anyone — only
 * a stale takeover clears it, which is fail-closed.
 *
 * claimScope: mutual exclusion between integrators on ONE filesystem.
 * notEvidenceFor: protection against a process started before this landed (it holds no lock and will
 *   not see one), cross-machine coordination, or anything about git's own index.lock.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, statSync, readdirSync,
} from "node:fs";
import { join } from "node:path";

/** How long a held lock is honoured after its last heartbeat before a later integrator may take it over. */
export const INTEGRATION_LOCK_TTL_MS = 30 * 60 * 1000;

/** How long a half-initialized lock (directory with no readable holder record) is held before it may be taken over as abandoned. */
export const INTEGRATION_LOCK_INIT_GRACE_MS = 5_000;

/** How long an interrupted acquire/release/renew operation may hold the op marker before a successor clears it. */
export const INTEGRATION_LOCK_OP_TTL_MS = 15_000;

/**
 * Token entropy in bytes. The card requires >=128-bit opaque handles; 32 bytes (256 bits, 64 hex
 * chars) leaves margin above the floor and is still cheap to generate.
 */
const INTEGRATION_LOCK_TOKEN_BYTES = 32;

/** heldBy reported while a lock's holder metadata is missing inside the init grace. */
export const INTEGRATION_LOCK_INITIALIZING_HELD_BY = "(initializing; holder metadata missing)";

const ABANDONED_STEAL_FROM = "(abandoned lock with no holder record)";
const OP_IN_PROGRESS_HELD_BY = "(lock operation in progress)";

const openclawDir = (repoRoot: string): string => join(repoRoot, ".openclinxr/openclaw");
const lockDir = (repoRoot: string): string => join(openclawDir(repoRoot), "integration.lock");
const holderPath = (repoRoot: string): string => join(lockDir(repoRoot), "holder.json");
const opMarkerPath = (repoRoot: string): string => join(openclawDir(repoRoot), "integration.lock.op");

export type LockResult = {
  acquired: boolean;
  /** Present when refused: who currently holds it (diagnostic — NOT sufficient to release or renew). */
  heldBy?: string;
  /** Present when a stale lock was taken over. Never silent. */
  stoleFrom?: string;
  /** Present when acquired: opaque >=128-bit handle. The sole authority for release and renewal. */
  token?: string;
};

type Holder = { owner: string; acquiredAt: string; lastSeen?: string; tokenHash?: string };

/** SHA-256 digest of a token. The digest is what travels in the world-readable holder record. */
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A fresh opaque handle: 256 bits of entropy, hex-encoded. */
function newToken(): string {
  return randomBytes(INTEGRATION_LOCK_TOKEN_BYTES).toString("hex");
}

/**
 * Whether a holder record authenticates a presented token. A record with no digest (hand-written or
 * pre-token) authenticates nothing: only a stale takeover can clear it.
 */
function tokenMatches(holder: Holder | null, token: string): boolean {
  return holder !== null && holder.tokenHash !== undefined && holder.tokenHash === hashToken(token);
}

function holderJson(holder: Holder): string {
  return `${JSON.stringify(holder, null, 2)}\n`;
}

function readHolderAt(holderFile: string): Holder | null {
  try {
    const raw = JSON.parse(readFileSync(holderFile, "utf8")) as Partial<Holder>;
    if (typeof raw.owner !== "string" || typeof raw.acquiredAt !== "string") return null;
    const holder: Holder = { owner: raw.owner, acquiredAt: raw.acquiredAt };
    if (typeof raw.lastSeen === "string") holder.lastSeen = raw.lastSeen;
    if (typeof raw.tokenHash === "string") holder.tokenHash = raw.tokenHash;
    return holder;
  } catch {
    return null;
  }
}

function readHolder(repoRoot: string): Holder | null {
  return readHolderAt(holderPath(repoRoot));
}

/** Staleness follows the last heartbeat; a holder with no heartbeat falls back to its acquisition time. */
function isStale(holder: Holder, now: number): boolean {
  const ref = holder.lastSeen ?? holder.acquiredAt;
  const t = Date.parse(ref);
  return !Number.isFinite(t) || now - t > INTEGRATION_LOCK_TTL_MS;
}

type LockState =
  | { present: false }
  | { present: true; holder: Holder | null; dirMtimeMs: number };

function readLockState(repoRoot: string): LockState {
  const dir = lockDir(repoRoot);
  let st;
  try {
    st = statSync(dir);
  } catch {
    return { present: false };
  }
  return { present: true, holder: readHolder(repoRoot), dirMtimeMs: st.mtimeMs };
}

const uniqueSuffix = (): string =>
  `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Claim the exclusive operation marker. Exactly one process wins the atomic create; a stale marker
 * (crashed op, older than `INTEGRATION_LOCK_OP_TTL_MS`) is cleared exactly once and reclaimed. A
 * fresh marker means another op is in flight and the caller must not mutate.
 */
function claimOpMarker(repoRoot: string, op: string, owner: string): boolean {
  const path = opMarkerPath(repoRoot);
  const write = (): void => {
    writeFileSync(path, `${JSON.stringify({ op, owner, startedAt: new Date().toISOString() })}\n`, { flag: "wx" });
  };
  try {
    write();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  let startedAtMs = Number.NaN;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { startedAt?: unknown };
    if (typeof raw.startedAt === "string") startedAtMs = Date.parse(raw.startedAt);
  } catch {
    // Unreadable marker is treated as live: it may be mid-write by a running op.
    return false;
  }
  if (!Number.isFinite(startedAtMs) || Date.now() - startedAtMs <= INTEGRATION_LOCK_OP_TTL_MS) return false;
  try {
    rmSync(path, { force: true });
  } catch {
    return false;
  }
  try {
    write();
    return true;
  } catch {
    return false;
  }
}

function clearOpMarker(repoRoot: string): void {
  rmSync(opMarkerPath(repoRoot), { force: true });
}

/** Remove staging and tombstone remnants left by crashed ops. Only safe while holding the op marker. */
function sweepOrphans(repoRoot: string): void {
  let names: string[];
  try {
    names = readdirSync(openclawDir(repoRoot));
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith("integration.lock.tomb.") || name.startsWith("integration.lock.staging.")) {
      rmSync(join(openclawDir(repoRoot), name), { recursive: true, force: true });
    }
  }
}

/** Install a fully-initialized lock dir via unique staging + atomic rename. Returns the fresh opaque token, or null if another install won the rename. */
function installLock(repoRoot: string, owner: string): string | null {
  const token = newToken();
  const staging = join(openclawDir(repoRoot), `integration.lock.staging.${uniqueSuffix()}`);
  mkdirSync(staging);
  const now = new Date().toISOString();
  writeFileSync(
    join(staging, "holder.json"),
    holderJson({ owner, acquiredAt: now, lastSeen: now, tokenHash: hashToken(token) }),
  );
  try {
    renameSync(staging, lockDir(repoRoot));
    return token;
  } catch {
    rmSync(staging, { recursive: true, force: true });
    return null;
  }
}

/** Atomically capture the lock dir to a unique tombstone; returns the tombstone path and its holder. */
function captureLockDir(repoRoot: string): { tomb: string | null; holder: Holder | null } {
  const tomb = join(openclawDir(repoRoot), `integration.lock.tomb.${uniqueSuffix()}`);
  try {
    renameSync(lockDir(repoRoot), tomb);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tomb: null, holder: null };
    throw error;
  }
  return { tomb, holder: readHolderAt(join(tomb, "holder.json")) };
}

/** Whether a present lock is refused as held: fresh holder, or missing metadata inside the init grace. */
function isHeld(state: LockState, now: number): boolean {
  if (!state.present) return false;
  if (state.holder === null) return now - state.dirMtimeMs <= INTEGRATION_LOCK_INIT_GRACE_MS;
  return !isStale(state.holder, now);
}

function heldByOf(state: LockState): string {
  if (state.present && state.holder !== null) return state.holder.owner;
  return INTEGRATION_LOCK_INITIALIZING_HELD_BY;
}

/**
 * Take the integration lock, or report who has it.
 *
 * A directory that exists with no readable holder file is treated as HELD for a bounded init grace
 * (it may be mid-initialization) and as ABANDONED afterwards — so a crash between a lock's creation
 * and its holder write never wedges the repo, and a live initialization is never stolen.
 *
 * On success the result carries the opaque token that fences release and renewal (see the header).
 */
export function acquireIntegrationLock(repoRoot: string, owner: string): LockResult {
  mkdirSync(openclawDir(repoRoot), { recursive: true });

  const pre = readLockState(repoRoot);
  if (isHeld(pre, Date.now())) {
    return { acquired: false, heldBy: heldByOf(pre) };
  }

  // Absent, stale, or abandoned: every mutation goes through the exclusive op marker.
  if (!claimOpMarker(repoRoot, "acquire", owner)) {
    const cur = readLockState(repoRoot);
    if (isHeld(cur, Date.now())) return { acquired: false, heldBy: heldByOf(cur) };
    return { acquired: false, heldBy: OP_IN_PROGRESS_HELD_BY };
  }
  try {
    sweepOrphans(repoRoot);
    const settled = readLockState(repoRoot);
    if (isHeld(settled, Date.now())) {
      return { acquired: false, heldBy: heldByOf(settled) };
    }
    if (settled.present) {
      const { tomb, holder: captured } = captureLockDir(repoRoot);
      if (tomb !== null) {
        if (captured !== null && !isStale(captured, Date.now())) {
          // Refreshed between the pre-read and the capture — not stealable.
          renameSync(tomb, lockDir(repoRoot));
          return { acquired: false, heldBy: captured.owner };
        }
        rmSync(tomb, { recursive: true, force: true });
        const token = installLock(repoRoot, owner);
        if (token === null) {
          const cur = readLockState(repoRoot);
          return { acquired: false, heldBy: isHeld(cur, Date.now()) ? heldByOf(cur) : OP_IN_PROGRESS_HELD_BY };
        }
        return { acquired: true, token, stoleFrom: captured ? captured.owner : ABANDONED_STEAL_FROM };
      }
      // The dir vanished between the read and the capture (external removal) — fall through to a fresh install.
    }
    const token = installLock(repoRoot, owner);
    if (token === null) {
      const cur = readLockState(repoRoot);
      return { acquired: false, heldBy: isHeld(cur, Date.now()) ? heldByOf(cur) : OP_IN_PROGRESS_HELD_BY };
    }
    return { acquired: true, token };
  } finally {
    clearOpMarker(repoRoot);
  }
}

/**
 * Release the lock. Refuses to drop someone else's — a stolen lock is not yours to release. The
 * caller authenticates with the opaque token from `acquire`; the capture is verified and, if it
 * turned out to be a successor's lock, put back.
 */
export function releaseIntegrationLock(repoRoot: string, token: string): boolean {
  mkdirSync(openclawDir(repoRoot), { recursive: true });

  const pre = readLockState(repoRoot);
  if (!pre.present || !tokenMatches(pre.holder, token)) return false;

  // Token-authenticated ops do not name a caller, so the marker record carries a fixed label rather
  // than the raw token (the marker can linger after a crash and the token must never be on disk).
  if (!claimOpMarker(repoRoot, "release", "token")) return false;
  try {
    sweepOrphans(repoRoot);
    const settled = readLockState(repoRoot);
    if (!settled.present || !tokenMatches(settled.holder, token)) return false;

    const { tomb, holder: captured } = captureLockDir(repoRoot);
    if (tomb === null) return false;
    if (tokenMatches(captured, token)) {
      rmSync(tomb, { recursive: true, force: true });
      return true;
    }
    // Captured a successor's lock: put it back untouched.
    renameSync(tomb, lockDir(repoRoot));
    return false;
  } finally {
    clearOpMarker(repoRoot);
  }
}

/**
 * Refresh the holder's heartbeat so a long-running integration is never stolen at a fixed TTL.
 * Refuses to renew a lock the token no longer authenticates.
 */
export function renewIntegrationLock(repoRoot: string, token: string): boolean {
  mkdirSync(openclawDir(repoRoot), { recursive: true });

  if (!claimOpMarker(repoRoot, "renew", "token")) {
    // Another op is in flight; a live lock cannot be stolen in the meantime, so ownership is the answer.
    const cur = readLockState(repoRoot);
    return cur.present && tokenMatches(cur.holder, token);
  }
  try {
    const settled = readLockState(repoRoot);
    if (!settled.present || settled.holder === null || !tokenMatches(settled.holder, token)) return false;
    // Atomic in-place replace: a reader sees either the old or the new holder, never a torn write.
    const tmp = join(lockDir(repoRoot), `holder.json.tmp.${uniqueSuffix()}`);
    writeFileSync(tmp, holderJson({ ...settled.holder, lastSeen: new Date().toISOString() }));
    renameSync(tmp, holderPath(repoRoot));
    return true;
  } finally {
    clearOpMarker(repoRoot);
  }
}
