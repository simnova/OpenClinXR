import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION = "openclinxr.openclaw-automation-lease.v1" as const;
export const DEFAULT_OPENCLAW_AUTOMATION_LEASE_PATH = ".openclinxr/openclaw/automation-lease.json";
export const DEFAULT_OPENCLAW_AUTOMATION_LEASE_TTL_MINUTES = 45;

export type OpenClawAutomationLease = {
  schemaVersion: typeof OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION;
  owner: string;
  slice: string;
  cwd: string;
  acquiredAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type OpenClawLeaseDecision = {
  status: "acquired" | "refreshed" | "held" | "released" | "none";
  acquired: boolean;
  leasePath: string;
  lease: OpenClawAutomationLease | null;
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
};

export async function acquireOpenClawAutomationLease(options: LeaseOperationOptions = {}): Promise<OpenClawLeaseDecision> {
  const leasePath = resolveLeasePath(options.leasePath, options.cwd);
  const owner = normalizeRequiredValue(options.owner, "owner");
  const slice = normalizeRequiredValue(options.slice, "slice");
  const cwd = options.cwd ?? process.cwd();
  const ttlMinutes = normalizeTtlMinutes(options.ttlMinutes);
  const now = options.now ?? new Date();
  const existingLease = await readLease(leasePath);
  const staleRecovered = existingLease ? isLeaseExpired(existingLease, now) : false;

  if (existingLease && !staleRecovered && existingLease.owner !== owner) {
    return {
      status: "held",
      acquired: false,
      leasePath,
      lease: existingLease,
      message: `OpenClaw automation lease is held by ${existingLease.owner} until ${existingLease.expiresAt}`,
    };
  }

  const lease: OpenClawAutomationLease = {
    schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
    owner,
    slice,
    cwd,
    acquiredAt: existingLease && !staleRecovered && existingLease.owner === owner ? existingLease.acquiredAt : now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
  };

  await writeLease(leasePath, lease);

  return {
    status: existingLease && !staleRecovered && existingLease.owner === owner ? "refreshed" : "acquired",
    acquired: true,
    leasePath,
    lease,
    staleRecovered,
    message: staleRecovered
      ? `Recovered stale OpenClaw automation lease and acquired ${slice} for ${owner}`
      : `OpenClaw automation lease ${existingLease?.owner === owner ? "refreshed" : "acquired"} for ${owner}`,
  };
}

export async function heartbeatOpenClawAutomationLease(options: LeaseOperationOptions = {}): Promise<OpenClawLeaseDecision> {
  return acquireOpenClawAutomationLease(options);
}

export async function releaseOpenClawAutomationLease(options: LeaseOperationOptions = {}): Promise<OpenClawLeaseDecision> {
  const leasePath = resolveLeasePath(options.leasePath, options.cwd);
  const owner = normalizeRequiredValue(options.owner, "owner");
  const existingLease = await readLease(leasePath);

  if (!existingLease) {
    return {
      status: "none",
      acquired: false,
      leasePath,
      lease: null,
      message: "No OpenClaw automation lease exists.",
    };
  }

  if (existingLease.owner !== owner) {
    return {
      status: "held",
      acquired: false,
      leasePath,
      lease: existingLease,
      message: `OpenClaw automation lease is held by ${existingLease.owner}; ${owner} did not release it.`,
    };
  }

  await rm(leasePath, { force: true });

  return {
    status: "released",
    acquired: false,
    leasePath,
    lease: null,
    message: `OpenClaw automation lease released by ${owner}.`,
  };
}

export async function getOpenClawAutomationLeaseStatus(options: LeaseOperationOptions = {}): Promise<OpenClawLeaseDecision> {
  const now = options.now ?? new Date();
  const leasePath = resolveLeasePath(options.leasePath, options.cwd);
  const lease = await readLease(leasePath);

  if (!lease) {
    return {
      status: "none",
      acquired: false,
      leasePath,
      lease: null,
      message: "No OpenClaw automation lease exists.",
    };
  }

  const expired = isLeaseExpired(lease, now);

  return {
    status: expired ? "none" : "held",
    acquired: false,
    leasePath,
    lease,
    staleRecovered: expired,
    message: expired
      ? `OpenClaw automation lease held by ${lease.owner} expired at ${lease.expiresAt}.`
      : `OpenClaw automation lease is held by ${lease.owner} until ${lease.expiresAt}.`,
  };
}

function resolveLeasePath(leasePath = DEFAULT_OPENCLAW_AUTOMATION_LEASE_PATH, cwd = process.cwd()): string {
  return path.isAbsolute(leasePath) ? leasePath : path.join(cwd, leasePath);
}

async function readLease(leasePath: string): Promise<OpenClawAutomationLease | null> {
  try {
    const rawLease = await readFile(leasePath, "utf8");
    const parsed = JSON.parse(rawLease) as Partial<OpenClawAutomationLease>;
    if (parsed.schemaVersion !== OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION || !parsed.owner || !parsed.slice || !parsed.expiresAt) {
      return null;
    }
    return parsed as OpenClawAutomationLease;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeLease(leasePath: string, lease: OpenClawAutomationLease): Promise<void> {
  await mkdir(path.dirname(leasePath), { recursive: true });
  await writeFile(leasePath, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
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

function readCliOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
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
