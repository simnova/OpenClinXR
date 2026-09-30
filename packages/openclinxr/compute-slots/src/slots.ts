import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { appendFile, mkdir, open, readdir, readFile, stat, unlink } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import path from "node:path";

const DEFAULT_SIZES = { blender: 2, "browser-capture": 1, gpu: 1 } as const;
const activeClaims = new Map<string, ActiveClaim>();
const activeTickets = new Set<string>();
const heldPools = new AsyncLocalStorage<Map<string, ReentrantHold>>();
let signalHandlersInstalled = false;

export type ComputeSlotMeta = { label: string; cwd?: string };
export type ComputeSlotLease = { pool: string; slot: number; waitedMs: number };
type HolderFile = ComputeSlotMeta & {
  pid: number;
  hostname: string;
  startedAt: string;
  cwd: string;
  token: string;
};
type TicketFile = { pid: number; hostname: string; createdAt: string; label: string; cwd: string };
type ActiveClaim = { pool: string; label: string; cwd: string; token: string; acquiredAt: number; waitedMs: number };
type ReentrantHold = { lease: ComputeSlotLease; count: number };

export type ComputeSlotPoolStatus = {
  pool: string;
  size: number;
  holders: Array<HolderFile & { slot: number; ageMs: number; alive: boolean }>;
  waiters: Array<TicketFile & { ageMs: number; alive: boolean }>;
};
export type ComputeSlotsStatus = { root: string; pools: ComputeSlotPoolStatus[] };

function lockRoot(): string {
  return path.resolve(process.env["OPENCLINXR_LOCK_ROOT"] ?? path.join(homedir(), ".openclinxr", "locks"));
}

function poolSize(pool: string): number {
  const envName = `OPENCLINXR_SLOTS_${pool.replaceAll("-", "_").toUpperCase()}`;
  const raw = process.env[envName];
  const fallback = DEFAULT_SIZES[pool as keyof typeof DEFAULT_SIZES] ?? 1;
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${envName} must be a positive integer (got ${raw})`);
  }
  return parsed;
}

function isAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function usageRecord(claim: ActiveClaim, waitedMs: number, exit: string): Record<string, unknown> {
  return {
    pool: claim.pool,
    label: claim.label,
    cwd: claim.cwd,
    waitedMs,
    heldMs: Date.now() - claim.acquiredAt,
    exit,
  };
}

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  const cleanup = (signal: "SIGINT" | "SIGTERM"): void => {
    const root = lockRoot();
    for (const ticket of activeTickets) {
      try { unlinkSync(ticket); } catch { /* already removed */ }
    }
    for (const [lockPath, claim] of activeClaims) {
      try {
        const holder = parseJson<HolderFile>(readFileSync(lockPath, "utf8"));
        if (holder?.token === claim.token) unlinkSync(lockPath);
        mkdirSync(root, { recursive: true });
        appendFileSync(path.join(root, "usage.jsonl"), `${JSON.stringify(usageRecord(claim, claim.waitedMs, signal))}\n`);
      } catch { /* process termination must continue */ }
    }
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", () => cleanup("SIGINT"));
  process.once("SIGTERM", () => cleanup("SIGTERM"));
}

async function removeIfDead(file: string): Promise<boolean> {
  let before: Awaited<ReturnType<typeof stat>>;
  try {
    before = await stat(file);
    const record = parseJson<{ pid?: number }>(await readFile(file, "utf8"));
    if (record?.pid !== undefined && isAlive(record.pid)) return false;
    const after = await stat(file);
    if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) return false;
    await unlink(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

async function orderedTickets(queueDir: string): Promise<string[]> {
  const names = (await readdir(queueDir)).filter((name) => name.endsWith(".json"));
  const rows: Array<{ file: string; createdAt: string }> = [];
  for (const name of names) {
    const file = path.join(queueDir, name);
    const ticket = parseJson<TicketFile>(await readFile(file, "utf8").catch(() => ""));
    if (!ticket || !isAlive(ticket.pid)) {
      await removeIfDead(file);
      continue;
    }
    rows.push({ file, createdAt: ticket.createdAt });
  }
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.file.localeCompare(b.file));
  return rows.map((row) => row.file);
}

async function tryClaim(pool: string, size: number, meta: Required<ComputeSlotMeta>): Promise<{ slot: number; file: string; token: string } | null> {
  const poolDir = path.join(lockRoot(), pool);
  for (let slot = 0; slot < size; slot += 1) {
    const file = path.join(poolDir, `slot-${slot}.json`);
    const token = randomUUID();
    const holder: HolderFile = {
      pid: process.pid,
      hostname: hostname(),
      startedAt: new Date().toISOString(),
      cwd: meta.cwd,
      label: meta.label,
      token,
    };
    try {
      const handle = await open(file, "wx");
      await handle.writeFile(`${JSON.stringify(holder)}\n`);
      await handle.close();
      return { slot, file, token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await removeIfDead(file)) {
        slot -= 1;
      }
    }
  }
  return null;
}

async function releaseClaim(file: string, token: string): Promise<void> {
  try {
    const holder = parseJson<HolderFile>(await readFile(file, "utf8"));
    if (holder?.token === token) await unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withComputeSlot<T>(
  pool: string,
  meta: ComputeSlotMeta,
  fn: (lease: ComputeSlotLease) => Promise<T> | T,
): Promise<T> {
  const inherited = heldPools.getStore()?.get(pool);
  if (inherited) {
    inherited.count += 1;
    try {
      return await fn(inherited.lease);
    } finally {
      inherited.count -= 1;
    }
  }

  const root = lockRoot();
  const poolDir = path.join(root, pool);
  const queueDir = path.join(poolDir, "queue");
  await mkdir(queueDir, { recursive: true });
  const ticketId = `${new Date().toISOString()}-${process.pid}-${randomUUID()}.json`;
  const ticketPath = path.join(queueDir, ticketId);
  const normalizedMeta = { label: meta.label, cwd: meta.cwd ?? process.cwd() };
  const ticket: TicketFile = { ...normalizedMeta, pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() };
  const ticketHandle = await open(ticketPath, "wx");
  await ticketHandle.writeFile(`${JSON.stringify(ticket)}\n`);
  await ticketHandle.close();
  activeTickets.add(ticketPath);
  installSignalHandlers();

  const startedWaitingAt = Date.now();
  let waitLogged = false;
  let attempt = 0;
  let claim: Awaited<ReturnType<typeof tryClaim>> = null;
  try {
    for (;;) {
      const tickets = await orderedTickets(queueDir);
      if (tickets[0] === ticketPath) claim = await tryClaim(pool, poolSize(pool), normalizedMeta);
      if (claim) break;
      if (!waitLogged) {
        process.stderr.write(`[compute-slots] waiting pool=${pool} label=${meta.label}\n`);
        waitLogged = true;
      }
      const ceiling = Math.min(2_000, 250 + attempt * 125);
      await delay(250 + Math.floor(Math.random() * Math.max(1, ceiling - 249)));
      attempt += 1;
    }
  } finally {
    activeTickets.delete(ticketPath);
    await unlink(ticketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  const waitedMs = Date.now() - startedWaitingAt;
  process.stderr.write(`[compute-slots] acquired pool=${pool} slot=${claim.slot} label=${meta.label} waitedMs=${waitedMs}\n`);
  const active: ActiveClaim = { ...normalizedMeta, pool, token: claim.token, acquiredAt: Date.now(), waitedMs };
  activeClaims.set(claim.file, active);
  let exit = "ok";
  try {
    const lease = { pool, slot: claim.slot, waitedMs };
    const context = new Map(heldPools.getStore());
    context.set(pool, { lease, count: 1 });
    return await heldPools.run(context, () => fn(lease));
  } catch (error) {
    exit = "throw";
    throw error;
  } finally {
    const record = usageRecord(active, waitedMs, exit);
    activeClaims.delete(claim.file);
    await releaseClaim(claim.file, claim.token);
    await mkdir(root, { recursive: true });
    await appendFile(path.join(root, "usage.jsonl"), `${JSON.stringify(record)}\n`);
  }
}

function removeIfDeadSync(file: string): boolean {
  try {
    const before = statSync(file);
    const record = readRecord<{ pid?: number }>(file);
    if (record?.pid !== undefined && isAlive(record.pid)) return false;
    const after = statSync(file);
    if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) return false;
    unlinkSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

function orderedTicketsSync(queueDir: string): string[] {
  const rows: Array<{ file: string; createdAt: string }> = [];
  for (const name of readdirSync(queueDir).filter((entry) => entry.endsWith(".json"))) {
    const file = path.join(queueDir, name);
    const ticket = readRecord<TicketFile>(file);
    if (!ticket || !isAlive(ticket.pid)) {
      removeIfDeadSync(file);
      continue;
    }
    rows.push({ file, createdAt: ticket.createdAt });
  }
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.file.localeCompare(b.file));
  return rows.map((row) => row.file);
}

function tryClaimSync(
  pool: string,
  size: number,
  meta: Required<ComputeSlotMeta>,
): { slot: number; file: string; token: string } | null {
  const poolDir = path.join(lockRoot(), pool);
  for (let slot = 0; slot < size; slot += 1) {
    const file = path.join(poolDir, `slot-${slot}.json`);
    const token = randomUUID();
    const holder: HolderFile = {
      pid: process.pid,
      hostname: hostname(),
      startedAt: new Date().toISOString(),
      cwd: meta.cwd,
      label: meta.label,
      token,
    };
    try {
      const fd = openSync(file, "wx");
      writeFileSync(fd, `${JSON.stringify(holder)}\n`);
      closeSync(fd);
      return { slot, file, token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (removeIfDeadSync(file)) slot -= 1;
    }
  }
  return null;
}

const syncSleepArray = new Int32Array(new SharedArrayBuffer(4));

/** Synchronous adapter for command-line tools that already use spawnSync/execFileSync. */
export function withComputeSlotSync<T>(pool: string, meta: ComputeSlotMeta, fn: (lease: ComputeSlotLease) => T): T {
  const inherited = heldPools.getStore()?.get(pool);
  if (inherited) {
    inherited.count += 1;
    try {
      return fn(inherited.lease);
    } finally {
      inherited.count -= 1;
    }
  }

  const root = lockRoot();
  const poolDir = path.join(root, pool);
  const queueDir = path.join(poolDir, "queue");
  mkdirSync(queueDir, { recursive: true });
  const ticketPath = path.join(queueDir, `${new Date().toISOString()}-${process.pid}-${randomUUID()}.json`);
  const normalizedMeta = { label: meta.label, cwd: meta.cwd ?? process.cwd() };
  const ticket: TicketFile = {
    ...normalizedMeta,
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
  };
  const ticketFd = openSync(ticketPath, "wx");
  writeFileSync(ticketFd, `${JSON.stringify(ticket)}\n`);
  closeSync(ticketFd);
  activeTickets.add(ticketPath);
  installSignalHandlers();
  const startedWaitingAt = Date.now();
  let waitLogged = false;
  let attempt = 0;
  let claim: ReturnType<typeof tryClaimSync> = null;
  try {
    while (!claim) {
      if (orderedTicketsSync(queueDir)[0] === ticketPath) claim = tryClaimSync(pool, poolSize(pool), normalizedMeta);
      if (claim) break;
      if (!waitLogged) {
        process.stderr.write(`[compute-slots] waiting pool=${pool} label=${meta.label}\n`);
        waitLogged = true;
      }
      const ceiling = Math.min(2_000, 250 + attempt * 125);
      Atomics.wait(syncSleepArray, 0, 0, 250 + Math.floor(Math.random() * Math.max(1, ceiling - 249)));
      attempt += 1;
    }
  } finally {
    activeTickets.delete(ticketPath);
    try {
      unlinkSync(ticketPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        process.stderr.write(`[compute-slots] failed to remove waiter ${ticketPath}: ${String(error)}\n`);
      }
    }
  }
  const waitedMs = Date.now() - startedWaitingAt;
  process.stderr.write(`[compute-slots] acquired pool=${pool} slot=${claim.slot} label=${meta.label} waitedMs=${waitedMs}\n`);
  const active: ActiveClaim = { ...normalizedMeta, pool, token: claim.token, acquiredAt: Date.now(), waitedMs };
  activeClaims.set(claim.file, active);
  let exit = "ok";
  try {
    const lease = { pool, slot: claim.slot, waitedMs };
    const context = new Map(heldPools.getStore());
    context.set(pool, { lease, count: 1 });
    return heldPools.run(context, () => fn(lease));
  } catch (error) {
    exit = "throw";
    throw error;
  } finally {
    activeClaims.delete(claim.file);
    const holder = readRecord<HolderFile>(claim.file);
    if (holder?.token === claim.token) {
      try {
        unlinkSync(claim.file);
      } catch (error) {
        process.stderr.write(`[compute-slots] failed to release ${claim.file}: ${String(error)}\n`);
      }
    }
    mkdirSync(root, { recursive: true });
    appendFileSync(path.join(root, "usage.jsonl"), `${JSON.stringify(usageRecord(active, waitedMs, exit))}\n`);
  }
}

function readRecord<T>(file: string): T | null {
  try { return parseJson<T>(readFileSync(file, "utf8")); } catch { return null; }
}

export function readComputeSlotsStatus(): ComputeSlotsStatus {
  const root = lockRoot();
  const discovered = existsSync(root)
    ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  const pools = [...new Set([...Object.keys(DEFAULT_SIZES), ...discovered])].sort().map((pool): ComputeSlotPoolStatus => {
    const poolDir = path.join(root, pool);
    const holders: ComputeSlotPoolStatus["holders"] = [];
    for (let slot = 0; slot < poolSize(pool); slot += 1) {
      const holder = readRecord<HolderFile>(path.join(poolDir, `slot-${slot}.json`));
      if (holder) holders.push({ ...holder, slot, ageMs: Date.now() - Date.parse(holder.startedAt), alive: isAlive(holder.pid) });
    }
    const queueDir = path.join(poolDir, "queue");
    const waiters = existsSync(queueDir)
      ? readdirSync(queueDir).sort().flatMap((name) => {
          const waiter = readRecord<TicketFile>(path.join(queueDir, name));
          return waiter ? [{ ...waiter, ageMs: Date.now() - Date.parse(waiter.createdAt), alive: isAlive(waiter.pid) }] : [];
        })
      : [];
    return { pool, size: poolSize(pool), holders, waiters };
  });
  return { root, pools };
}
