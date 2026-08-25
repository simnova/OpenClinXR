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
 * ## THE PRIMITIVE, AND WHY IT IS mkdir
 *
 * `mkdir` is atomic on POSIX: it either creates the directory or fails `EEXIST`, with no
 * read-then-write gap. `existsSync` followed by a create is NOT atomic and passes every sequential
 * test while still letting two processes through — which is why clause (5) of the contract spawns
 * real processes rather than trusting an in-process check.
 *
 * ## TAKEOVER IS REQUIRED, NOT A CONVENIENCE
 *
 * Background dispatches are reaped in this environment; four kill events in one session are on
 * record. A lock with no takeover path turns one reap into a permanently wedged land path, which is
 * a worse failure than the race it prevents. A lock older than the TTL is stolen, and the theft is
 * RECORDED in the result so it appears in the caller's output instead of happening silently.
 *
 * claimScope: mutual exclusion between integrators on ONE filesystem.
 * notEvidenceFor: protection against a process started before this landed (it holds no lock and will
 *   not see one), cross-machine coordination, or anything about git's own index.lock.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

/** How long a held lock is honoured before a later integrator may take it over. */
export const INTEGRATION_LOCK_TTL_MS = 30 * 60 * 1000;

const lockDir = (repoRoot: string): string => join(repoRoot, ".openclinxr/openclaw/integration.lock");
const holderPath = (repoRoot: string): string => join(lockDir(repoRoot), "holder.json");

export type LockResult = {
  acquired: boolean;
  /** Present when refused: who currently holds it. */
  heldBy?: string;
  /** Present when a stale lock was taken over. Never silent. */
  stoleFrom?: string;
};

type Holder = { owner: string; acquiredAt: string };

function readHolder(repoRoot: string): Holder | null {
  try {
    const raw = JSON.parse(readFileSync(holderPath(repoRoot), "utf8")) as Partial<Holder>;
    if (typeof raw.owner !== "string" || typeof raw.acquiredAt !== "string") return null;
    return { owner: raw.owner, acquiredAt: raw.acquiredAt };
  } catch {
    return null;
  }
}

function claim(repoRoot: string, owner: string): void {
  writeFileSync(holderPath(repoRoot), `${JSON.stringify({ owner, acquiredAt: new Date().toISOString() }, null, 2)}\n`);
}

/**
 * Take the integration lock, or report who has it.
 *
 * A directory that exists with no readable holder file is treated as ABANDONED rather than held —
 * otherwise a crash between mkdir and the holder write wedges the repo with a lock nobody can name,
 * and the refusal message would be useless to whoever has to clear it.
 */
export function acquireIntegrationLock(repoRoot: string, owner: string): LockResult {
  const dir = lockDir(repoRoot);
  mkdirSync(dirname(dir), { recursive: true });
  try {
    mkdirSync(dir);            // atomic: creates, or throws EEXIST
    claim(repoRoot, owner);
    return { acquired: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const held = readHolder(repoRoot);
  if (held === null) {
    claim(repoRoot, owner);
    return { acquired: true, stoleFrom: "(abandoned lock with no holder record)" };
  }

  const ageMs = Date.now() - Date.parse(held.acquiredAt);
  if (Number.isFinite(ageMs) && ageMs > INTEGRATION_LOCK_TTL_MS) {
    claim(repoRoot, owner);
    return { acquired: true, stoleFrom: held.owner };
  }
  return { acquired: false, heldBy: held.owner };
}

/** Release the lock. Refuses to drop someone else's — a stolen lock is not yours to release. */
export function releaseIntegrationLock(repoRoot: string, owner: string): boolean {
  const held = readHolder(repoRoot);
  if (held !== null && held.owner !== owner) return false;
  if (!existsSync(lockDir(repoRoot))) return false;
  rmSync(lockDir(repoRoot), { recursive: true, force: true });
  return true;
}
