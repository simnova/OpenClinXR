import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveSharedCoordinationPath } from "./coordination-root.js";

/** On-disk multi-slot registry. v1 single-lease files are migrated on read. */
export const OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION = "openclinxr.openclaw-automation-lease.v2" as const;
const OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION_V1 = "openclinxr.openclaw-automation-lease.v1" as const;
export const DEFAULT_OPENCLAW_AUTOMATION_LEASE_PATH = ".openclinxr/openclaw/automation-lease.json";
export const DEFAULT_OPENCLAW_AUTOMATION_LEASE_TTL_MINUTES = 45;

/**
 * One held automation slot. Contention is per **slice** (and optionally overlapping
 * `writeRoots`). Disjoint slices may be held concurrently under the shared coordination root.
 *
 * DANGER: this must stay shared via coordination-root — per-worktree private leases defeat
 * mutual exclusion. Multi-slot is NOT "anyone acquires anything"; same-slice still blocks.
 */
export type OpenClawAutomationLease = {
  schemaVersion: typeof OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION;
  owner: string;
  slice: string;
  cwd: string;
  acquiredAt: string;
  updatedAt: string;
  expiresAt: string;
  /** Optional path prefixes; overlapping roots conflict even under different slice names. */
  writeRoots?: string[];
};

export type OpenClawLeaseDecision = {
  status: "acquired" | "refreshed" | "held" | "released" | "none";
  acquired: boolean;
  leasePath: string;
  /** Relevant slot for this operation (acquired/refreshed/held target, or sole status hit). */
  lease: OpenClawAutomationLease | null;
  /** All active (non-expired) slots after the operation when useful for multi-slot status. */
  leases?: OpenClawAutomationLease[];
  staleRecovered?: boolean;
  message: string;
};

type LeaseOperationOptions = {
  leasePath?: string;
  owner?: string;
  slice?: string;
  ttlMinutes?: number;
  cwd?: string;
  now?: Date;
  /** Optional write-root path prefixes for cross-slice path contention. */
  writeRoots?: string[];
};

type LeaseRegistry = {
  schemaVersion: typeof OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION;
  slots: OpenClawAutomationLease[];
};

export async function acquireOpenClawAutomationLease(options: LeaseOperationOptions = {}): Promise<OpenClawLeaseDecision> {
  const leasePath = resolveLeasePath(options.leasePath, options.cwd);
  const owner = normalizeRequiredValue(options.owner, "owner");
  const slice = normalizeRequiredValue(options.slice, "slice");
  const cwd = options.cwd ?? process.cwd();
  const ttlMinutes = normalizeTtlMinutes(options.ttlMinutes);
  const now = options.now ?? new Date();
  const writeRoots = normalizeWriteRoots(options.writeRoots);

  const registry = await readRegistry(leasePath);
  const { active, expired } = partitionSlots(registry.slots, now);
  const staleForSlice = expired.filter((slot) => slot.slice === slice);
  const staleRecovered = staleForSlice.length > 0;

  const sameSlice = active.find((slot) => slot.slice === slice);
  if (sameSlice && sameSlice.owner !== owner) {
    return {
      status: "held",
      acquired: false,
      leasePath,
      lease: sameSlice,
      leases: active,
      message: `OpenClaw automation lease for slice ${slice} is held by ${sameSlice.owner} until ${sameSlice.expiresAt}`,
    };
  }

  const pathConflict = findWriteRootConflict(active, slice, writeRoots);
  if (pathConflict) {
    return {
      status: "held",
      acquired: false,
      leasePath,
      lease: pathConflict,
      leases: active,
      message: `OpenClaw automation lease writeRoots overlap with slice ${pathConflict.slice} held by ${pathConflict.owner} until ${pathConflict.expiresAt}`,
    };
  }

  const refreshing = sameSlice?.owner === owner ? sameSlice : undefined;
  const lease: OpenClawAutomationLease = {
    schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
    owner,
    slice,
    cwd,
    acquiredAt: refreshing ? refreshing.acquiredAt : now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    ...(writeRoots.length > 0 ? { writeRoots } : refreshing?.writeRoots ? { writeRoots: refreshing.writeRoots } : {}),
  };

  // Keep other active slots; replace same-slice slot (refresh or stale recovery); drop expired.
  const nextSlots = [...active.filter((slot) => slot.slice !== slice), lease];
  await writeRegistry(leasePath, { schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION, slots: nextSlots });

  return {
    status: refreshing ? "refreshed" : "acquired",
    acquired: true,
    leasePath,
    lease,
    leases: nextSlots,
    staleRecovered,
    message: staleRecovered
      ? `Recovered stale OpenClaw automation lease and acquired ${slice} for ${owner}`
      : `OpenClaw automation lease ${refreshing ? "refreshed" : "acquired"} for ${owner} on slice ${slice}`,
  };
}

export async function heartbeatOpenClawAutomationLease(options: LeaseOperationOptions = {}): Promise<OpenClawLeaseDecision> {
  return acquireOpenClawAutomationLease(options);
}

export async function releaseOpenClawAutomationLease(options: LeaseOperationOptions = {}): Promise<OpenClawLeaseDecision> {
  const leasePath = resolveLeasePath(options.leasePath, options.cwd);
  const owner = normalizeRequiredValue(options.owner, "owner");
  const slice = options.slice?.trim() || undefined;
  const now = options.now ?? new Date();

  const registry = await readRegistry(leasePath);
  const { active } = partitionSlots(registry.slots, now);

  if (active.length === 0) {
    await clearRegistryIfEmpty(leasePath, []);
    return {
      status: "none",
      acquired: false,
      leasePath,
      lease: null,
      leases: [],
      message: "No OpenClaw automation lease exists.",
    };
  }

  const owned = active.filter((slot) => slot.owner === owner && (slice === undefined || slot.slice === slice));
  if (owned.length === 0) {
    const blocker = slice ? active.find((slot) => slot.slice === slice) : active[0];
    return {
      status: "held",
      acquired: false,
      leasePath,
      lease: blocker ?? null,
      leases: active,
      message: blocker
        ? `OpenClaw automation lease is held by ${blocker.owner}; ${owner} did not release it.`
        : `OpenClaw automation lease is not held by ${owner}.`,
    };
  }

  const remaining = active.filter((slot) => !owned.includes(slot));
  await clearRegistryIfEmpty(leasePath, remaining);

  return {
    status: "released",
    acquired: false,
    leasePath,
    lease: null,
    leases: remaining,
    message:
      owned.length === 1
        ? `OpenClaw automation lease released by ${owner}${slice ? ` for slice ${slice}` : ""}.`
        : `OpenClaw automation leases (${owned.length}) released by ${owner}.`,
  };
}

export async function getOpenClawAutomationLeaseStatus(options: LeaseOperationOptions = {}): Promise<OpenClawLeaseDecision> {
  const now = options.now ?? new Date();
  const leasePath = resolveLeasePath(options.leasePath, options.cwd);
  const slice = options.slice?.trim() || undefined;
  const registry = await readRegistry(leasePath);
  const { active } = partitionSlots(registry.slots, now);

  if (active.length === 0) {
    return {
      status: "none",
      acquired: false,
      leasePath,
      lease: null,
      leases: [],
      message: "No OpenClaw automation lease exists.",
    };
  }

  if (slice) {
    const hit = active.find((slot) => slot.slice === slice);
    if (!hit) {
      return {
        status: "none",
        acquired: false,
        leasePath,
        lease: null,
        leases: active,
        message: `No OpenClaw automation lease exists for slice ${slice}.`,
      };
    }
    return {
      status: "held",
      acquired: false,
      leasePath,
      lease: hit,
      leases: active,
      message: `OpenClaw automation lease for slice ${slice} is held by ${hit.owner} until ${hit.expiresAt}.`,
    };
  }

  const summary = active.map((slot) => `${slot.owner}@${slot.slice}`).join(", ");
  return {
    status: "held",
    acquired: false,
    leasePath,
    lease: active.length === 1 ? active[0]! : null,
    leases: active,
    message: `OpenClaw automation lease(s) held: ${summary}.`,
  };
}

function resolveLeasePath(leasePath = DEFAULT_OPENCLAW_AUTOMATION_LEASE_PATH, cwd = process.cwd()): string {
  // Shared across worktrees on purpose: a lease resolved per-worktree grants every agent its own
  // private lease, so acquisition ALWAYS succeeds and the mutual exclusion is imaginary.
  // See coordination-root.ts.
  return resolveSharedCoordinationPath(leasePath, cwd);
}

async function readRegistry(leasePath: string): Promise<LeaseRegistry> {
  try {
    const raw = await readFile(leasePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parseRegistry(parsed);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION, slots: [] };
    }
    throw error;
  }
}

function parseRegistry(parsed: Record<string, unknown>): LeaseRegistry {
  // v2 multi-slot registry
  if (parsed.schemaVersion === OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION && Array.isArray(parsed.slots)) {
    const slots = parsed.slots
      .map((entry) => normalizeSlot(entry))
      .filter((slot): slot is OpenClawAutomationLease => slot !== null);
    return { schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION, slots };
  }

  // v1 single-lease file → one slot
  if (parsed.schemaVersion === OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION_V1) {
    const slot = normalizeSlot({
      ...parsed,
      schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
    });
    return {
      schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
      slots: slot ? [slot] : [],
    };
  }

  // Unknown / corrupt → empty (fail open for recovery, same spirit as invalid v1)
  return { schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION, slots: [] };
}

function normalizeSlot(entry: unknown): OpenClawAutomationLease | null {
  if (!entry || typeof entry !== "object") return null;
  const parsed = entry as Partial<OpenClawAutomationLease> & { schemaVersion?: string };
  if (!parsed.owner || !parsed.slice || !parsed.expiresAt) return null;
  const writeRoots = normalizeWriteRoots(parsed.writeRoots);
  return {
    schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
    owner: String(parsed.owner),
    slice: String(parsed.slice),
    cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
    acquiredAt: typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : parsed.expiresAt,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : parsed.expiresAt,
    expiresAt: String(parsed.expiresAt),
    ...(writeRoots.length > 0 ? { writeRoots } : {}),
  };
}

async function writeRegistry(leasePath: string, registry: LeaseRegistry): Promise<void> {
  await mkdir(path.dirname(leasePath), { recursive: true });
  await writeFile(leasePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

async function clearRegistryIfEmpty(leasePath: string, remaining: OpenClawAutomationLease[]): Promise<void> {
  if (remaining.length === 0) {
    await rm(leasePath, { force: true });
    return;
  }
  await writeRegistry(leasePath, { schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION, slots: remaining });
}

function partitionSlots(
  slots: OpenClawAutomationLease[],
  now: Date,
): { active: OpenClawAutomationLease[]; expired: OpenClawAutomationLease[] } {
  const active: OpenClawAutomationLease[] = [];
  const expired: OpenClawAutomationLease[] = [];
  for (const slot of slots) {
    if (isLeaseExpired(slot, now)) expired.push(slot);
    else active.push(slot);
  }
  return { active, expired };
}

function isLeaseExpired(lease: OpenClawAutomationLease, now: Date): boolean {
  const expiresAt = Date.parse(lease.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

function normalizeRequiredValue(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required OpenClaw automation lease ${label}.`);
  }
  return normalized;
}

function normalizeTtlMinutes(value = DEFAULT_OPENCLAW_AUTOMATION_LEASE_TTL_MINUTES): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("OpenClaw automation lease ttlMinutes must be a positive number.");
  }
  return value;
}

function normalizeWriteRoots(value: string[] | undefined): string[] {
  if (!value || value.length === 0) return [];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const raw of value) {
    const normalized = normalizeRootPath(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    roots.push(normalized);
  }
  return roots;
}

function normalizeRootPath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  // Strip trailing slashes (keep root "/")
  return trimmed === "/" ? "/" : trimmed.replace(/\/+$/, "");
}

/**
 * Path-prefix overlap: `a` conflicts with `b` if equal or either is a parent prefix of the other.
 * Only applies when BOTH sides declare non-empty writeRoots (undeclared = slice-key only).
 */
function writeRootsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  for (const left of a) {
    for (const right of b) {
      if (left === right) return true;
      if (left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) return true;
    }
  }
  return false;
}

function findWriteRootConflict(
  active: OpenClawAutomationLease[],
  slice: string,
  writeRoots: string[],
): OpenClawAutomationLease | undefined {
  if (writeRoots.length === 0) return undefined;
  return active.find((slot) => slot.slice !== slice && writeRootsOverlap(writeRoots, slot.writeRoots ?? []));
}

function readCliOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function readCliMultiOption(args: string[], name: string): string[] | undefined {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1]) {
      values.push(args[i + 1]!);
      i += 1;
    }
  }
  return values.length > 0 ? values : undefined;
}

async function main(): Promise<void> {
  const cliArgs = process.argv.slice(2);
  const normalizedArgs = cliArgs[0] === "--" ? cliArgs.slice(1) : cliArgs;
  const [command = "status", ...args] = normalizedArgs;
  const commonOptions: LeaseOperationOptions = {
    leasePath: readCliOption(args, "--lease-path"),
    owner: readCliOption(args, "--owner"),
    slice: readCliOption(args, "--slice"),
    ttlMinutes: readCliOption(args, "--ttl-minutes") ? Number(readCliOption(args, "--ttl-minutes")) : undefined,
    writeRoots: readCliMultiOption(args, "--write-root"),
  };

  const decision =
    command === "acquire"
      ? await acquireOpenClawAutomationLease(commonOptions)
      : command === "heartbeat"
        ? await heartbeatOpenClawAutomationLease(commonOptions)
        : command === "release"
          ? await releaseOpenClawAutomationLease(commonOptions)
          : command === "status"
            ? await getOpenClawAutomationLeaseStatus(commonOptions)
            : null;

  if (!decision) {
    throw new Error(`Unknown OpenClaw automation lease command: ${command}`);
  }

  console.log(JSON.stringify(decision, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
