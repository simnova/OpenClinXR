import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, type Stats, statSync } from "node:fs";
import { join } from "node:path";
import { countPlantedItFails } from "../../../packages/openclinxr/agent-loop/src/done-when-live.js";
import { stripAnsi } from "./board-cli.js";

/**
 * The loop's ENUMERATION step (#584): build the unfinished-work inventory from the world
 * before any selector runs. The tick enumerates STATES (harvest → killed-check → collision-
 * check) and then calls a selector; nothing built the candidate list. The operator found four
 * pieces of unfinished work in one hour that the loop had not — all queries, not judgement.
 *
 * Five queries (S1/S2 required by the contract; S3-S5 best-effort):
 *
 * | # | query | a hit means |
 * |---|-------|-------------|
 * | S1 | planted REDs across apps/packages/tools test files, via countPlantedItFails | a slice started and abandoned |
 * | S2 | open cards with `lane:` but no `## factory_step:` | assigned work that cannot dispatch |
 * | S3 | test/evidence files added in 24h with no card tracking their flip | a contract landed untracked |
 * | S4 | pinned @iwsdk/* version vs live npm latest | a dependency moved unnoticed |
 * | S5 | session updates.jsonl threads active in 24h but silent for 30min | a consult thread went quiet |
 *
 * THE COUNTER MUST NOT BE A RAW GREP — measured false positive: the #570 prose file documents
 * `it.fails(` inside its header and a naive regex counts its own prose. countPlantedItFails
 * strips comments and string bodies before matching; it is WIRED here, not copied (D1).
 *
 * MEASURED TRAPS, do not re-derive (2026-08-22):
 * - `gh issue list --json` emits ANSI colour codes when FORCE_COLOR is set (the harness sets
 *   it), and JSON.parse fails on the decorated output. Run gh with NO_COLOR=1 AND strip any
 *   remaining escape sequences before parsing.
 * - File mtimes in a fresh git worktree are CHECKOUT times, not add times — mtime cannot
 *   answer "added in the last 24h". S3 uses `git log --diff-filter=A --since` instead.
 * - node_modules contains vendored test files; walking it produced 1449 junk hits. Skipped.
 * - (#586, 2026-08-23) Sessions nest ONE level deeper than this file assumed:
 *   `~/.grok/sessions/<encoded>/<sessionUuid>/updates.jsonl`. The original flat read found
 *   0 of 2301 real files and returned 0 unconditionally — quiet=0 was the bug's shape, not a
 *   measurement. Both S5 counters therefore walk the nested layout and take the sessions
 *   root as their FIRST parameter so contracts can build fixtures.
 *
 * WORKER FLOOR (#586): the standing parallelism ruling sets a floor of 3 concurrent live
 * workers; nothing computed it before this file did. countLiveWorkers counts worktree
 * sessions (decoded path ending in `/issue-<n>`) whose updates.jsonl changed within
 * LIVE_WINDOW_MS; the SWEEP line carries `workers=<n>/<floor>` and prints BREACH below the
 * floor, which exits 2 — distinct from the section-error exit 1.
 *
 * CLAIM: summariseUnfinishedInventory(root) returns reds/oldestRedId/undispatchable/uncarded/
 * quietThreads/liveWorkers/workerFloor; plantedRedCount(root, rel) is the per-file stripping
 * counter exposed for verification. The CLI prints one machine-greppable SWEEP line, exits 1 on
 * section errors and 2 on a worker-floor breach.
 * NOT TESTED HERE: whether anyone reads the line; S3's filename heuristic beyond the limits
 * stated at the function; network reachability for S4 (degrades to NOT DETERMINED).
 */

export type SweepInventory = {
  /** S1 — files still carrying unflipped `it.fails(` plants, with remaining counts. */
  reds: number;
  oldestRedId?: string;
  /** Per-file detail for `--json`, so the count is auditable rather than a bare number. */
  redFiles: Array<{ file: string; count: number }>;
  /** S2 — open lane-assigned cards missing `## factory_step:` (cannot dispatch). */
  undispatchable: number;
  undispatchableIds: number[];
  /** S3 — test/evidence files added in 24h whose name references no card. */
  uncarded: number;
  uncardedFiles: string[];
  /** S4 — `current` or a comma list of moved pins; undefined means NOT DETERMINED. */
  releaseTag?: string;
  /** S5 — threads active in the last 24h whose newest update is older than 30 minutes. */
  quietThreads: number;
  /** Live dispatched workers (worktree sessions touched within LIVE_WINDOW_MS); -1 = section error. */
  liveWorkers: number;
  /** Parallelism floor from the routine-2 ruling; below it the sweep prints BREACH and exits 2. */
  workerFloor: number;
};

const SCAN_ROOTS = ["apps", "packages", "tools"] as const;

function* walkTestFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // unreadable subtree — skip it rather than fail the whole sweep on one directory
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat: Stats;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      // Vendored copies duplicate repo tests and poisoned the first S3 run (1449 junk hits).
      if (entry === "node_modules" || entry === ".git") continue;
      yield* walkTestFiles(full);
    } else if ((entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}

/** S1 per-file counter, exported so the contract can verify the stripping behaviour directly. */
export function plantedRedCount(root: string, rel: string): number {
  try {
    return countPlantedItFails(readFileSync(join(root, rel), "utf8"));
  } catch {
    return -1; // unreadable file is not "zero reds" — callers treat negatives as section errors
  }
}

type OpenCard = { number: number; body: string };

/**
 * `gh` is the sanctioned CLI-first surface (docs/TOOLING.md); the github MCP is disabled.
 * NO_COLOR plus an explicit escape-strip because FORCE_COLOR from the calling harness makes gh
 * decorate its JSON regardless (measured above).
 */
function fetchOpenCards(): OpenCard[] {
  const out = execFileSync(
    "gh",
    ["issue", "list", "--state", "open", "--limit", "200", "--json", "number,body"],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, NO_COLOR: "1" } },
  );
  return JSON.parse(stripAnsi(out)) as OpenCard[];
}

const LANE_RE = /^lane:\s*\S+/mu;
const FACTORY_STEP_RE = /^##\s+factory_step:/mu;

/**
 * S2. A card carrying an assignment but no dispatchable step is work the loop can never pick
 * up — exactly the class the operator found by hand (a Rhubarb lane assigned, never dispatched).
 */
export async function countUndispatchableCards(
  fetchCards: () => Promise<OpenCard[]> | OpenCard[] = fetchOpenCards,
): Promise<{ count: number; ids: number[] }> {
  let cards: OpenCard[];
  try {
    cards = await fetchCards();
  } catch {
    return { count: -1, ids: [] }; // negative signals a section error, not "all clear"
  }
  const ids = cards
    .filter((card) => typeof card.body === "string")
    .filter((card) => LANE_RE.test(card.body) && !FACTORY_STEP_RE.test(card.body))
    .map((card) => card.number);
  return { count: ids.length, ids };
}

/**
 * S3. Files ADDED (git diff-filter=A) in the last 24h whose filename carries no `#N` card
 * reference, plus untracked new test files. Heuristic, stated plainly: it reads filenames only,
 * so a contract tracked from a card whose number never reached the filename is misreported as
 * uncarded. Git history supplies the add time because worktree-checkout mtimes are useless here
 * (measured trap above).
 */
export function countUncardedRecentFiles(root: string, now = Date.now()): { count: number; files: string[] } {
  const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const added = new Set<string>();
  try {
    const log = execFileSync(
      "git",
      ["log", "--all", "--since", cutoff, "--diff-filter=A", "--name-only", "--format=", "--", ...SCAN_ROOTS],
      { encoding: "utf8", cwd: root, timeout: 15000 },
    );
    for (const path of log.split("\n")) {
      if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) added.add(path.trim());
    }
    const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", cwd: root, timeout: 15000 });
    for (const line of status.split("\n")) {
      const path = line.slice(3).trim();
      if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) added.add(path);
    }
  } catch {
    return { count: -1, files: [] }; // no git, no honest answer — error rather than zero
  }
  /**
   * A plant is CARDED if it cites a card — in its PATH or in its BODY.
   *
   * MEASURED 2026-08-24: of 24 recently-added plants this check flagged as uncarded, **22 cite an
   * issue number in their content** and often several — `a-declared-body-shape-reaches-the-baked-body`
   * names #329 #479 #576, `the-gauge-sees-what-the-resolver-resolves` names #601 #603 #605. Only 2
   * genuinely have no card, and both trace to commits instead.
   *
   * Reading the path alone was called "structurally incompatible with the prose-observable naming
   * convention" and treated as unfixable noise. It is neither. This repo names plants for the
   * OBSERVABLE they assert, deliberately, and records the card in the header where the reasoning
   * lives. The instrument was looking in the wrong place, so it reported 24 where the honest answer
   * is 2 and the metric was saturated into uselessness.
   *
   * A deleted file cannot be read; treat an unreadable path as uncarded rather than silently carded,
   * so the failure direction stays conservative.
   */
  const CARD = /#\d+/u;
  const files = [...added]
    .filter((rel) => {
      if (CARD.test(rel)) return false;
      try {
        return !CARD.test(readFileSync(join(root, rel), "utf8"));
      } catch {
        return true;
      }
    })
    .sort();
  return { count: files.length, files };
}

const IWSDK_PIN_PACKAGES = [
  "@iwsdk/core",
  "@iwsdk/xr-input",
  "@iwsdk/scene-composition",
  "@iwsdk/locomotor",
] as const;

/**
 * S4. Compare the repo's pinned @iwsdk/* versions against live npm latest, mirroring the pin
 * source used by iwsdk-npm-currentness-check.ts. Offline / registry failure degrades to
 * NOT DETERMINED — a wrong release number is worse than no number (the brief says so).
 */
export async function checkReleaseDrift(
  root: string,
): Promise<{ tag?: string; moved: string[]; error?: string }> {
  let pins: Record<string, string> = {};
  try {
    pins = JSON.parse(readFileSync(join(root, "apps/arena/ui-xr-iwsdk-spike/package.json"), "utf8"))
      .dependencies as Record<string, string>;
  } catch {
    return { moved: [], error: "cannot read ui-xr-iwsdk-spike package.json" };
  }
  const moved: string[] = [];
  for (const name of IWSDK_PIN_PACKAGES) {
    const pinned = pins[name];
    if (!pinned || !/^\d/u.test(pinned)) continue; // workspace:/catalog: refs are not registry pins
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`registry ${response.status}`);
      const latest = ((await response.json()) as { version?: string }).version ?? "unknown";
      if (latest !== pinned.trim()) moved.push(`${name}:pin_${pinned}_live_${latest}`);
    } catch (error) {
      return { moved: [], error: `npm registry unreachable (${String(error)})` };
    }
  }
  return { tag: moved.length > 0 ? moved.join(",") : "current", moved };
}

/** Quiet window for S5: active in the last day, nothing appended for half an hour. */
const QUIET_WINDOW_MS = 30 * 60 * 1000;
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Live-worker window (#586): an updates.jsonl touched this recently means the worker is running. */
const LIVE_WINDOW_MS = 3 * 60 * 1000;
/** Parallelism floor from the superagent routine-2 ruling; BREACH + exit 2 below it. */
export const WORKER_FLOOR = 3;

type UpdatesRead =
  | { kind: "error" }
  | { kind: "ok"; mtimeMs: number; newestUpdateMs: number | undefined };

/** Resolves a session's updates.jsonl at its REAL location: `<encoded>/<sessionUuid>/updates.jsonl`. */
function resolveSessionUpdatesPath(base: string, encodedDir: string): string | undefined {
  try {
    const uuids = readdirSync(join(base, encodedDir)).filter((name) => !name.startsWith("."));
    for (const uuid of uuids) {
      const candidate = join(base, encodedDir, uuid, "updates.jsonl");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Reads one updates.jsonl. Timestamps are numeric epoch SECONDS ("timestamp":1787451692);
 * mtime is the fallback when a file has no parseable stamps. Callers MUST stat and apply their
 * window filter BEFORE calling this: the sessions tree held 2301 files on head (#586), and
 * reading all of them synchronously timed out the sweep's own entry-point contract (~14s vs
 * ~850ms). Stat-then-read is sound because the last write sets mtime >= the newest stamp, so
 * a file failing an mtime window cannot pass the same window on its timestamps.
 */
function readUpdatesFile(updatesPath: string): UpdatesRead {
  let stat: Stats;
  try {
    stat = statSync(updatesPath);
  } catch {
    return { kind: "error" };
  }
  let lines: string[] = [];
  try {
    lines = readFileSync(updatesPath, "utf8").split("\n").filter(Boolean);
  } catch {
    return { kind: "error" };
  }
  const stamps = lines
    .map((line) => {
      try {
        const value = JSON.parse(line)?.timestamp;
        return typeof value === "number" ? value * 1000 : undefined;
      } catch {
        return undefined;
      }
    })
    .filter((value): value is number => value !== undefined);
  // Timestamps are authoritative; fall back to mtime only when a file carries no parseable ones.
  const newestUpdateMs =
    stamps.length > 0 ? Math.max(...stamps) : lines.length > 0 ? stat.mtimeMs : undefined;
  return { kind: "ok", mtimeMs: stat.mtimeMs, newestUpdateMs };
}

/** Stats a resolved updates.jsonl; undefined means unreadable or missing (caller skips). */
function statSessionUpdates(base: string, encodedDir: string): { path: string; mtimeMs: number } | undefined {
  const updatesPath = resolveSessionUpdatesPath(base, encodedDir);
  if (!updatesPath) return undefined;
  try {
    return { path: updatesPath, mtimeMs: statSync(updatesPath).mtimeMs };
  } catch {
    return undefined;
  }
}

/** Enumerates the sessions root's `<encoded>` directories; null signals an unreadable root. */
function listEncodedSessionDirs(base: string): string[] | null {
  try {
    return readdirSync(base).filter((name) => name.startsWith("%2F"));
  } catch {
    return null;
  }
}

/**
 * S5. A consult thread that stops producing turns between wakes has gone quiet; the pulse
 * measures throughput and never sees this. Counts sessions whose updates.jsonl was touched in
 * the last 24h but carries no update newer than QUIET_WINDOW_MS. `base` is injectable so
 * contracts can build fixtures; production passes the default `$HOME/.grok/sessions` root.
 * mtime gates the content read: mtime ages monotonically with the newest stamp, so anything
 * outside ACTIVE_WINDOW_MS is skippable without opening the file.
 */
export function countQuietThreads(base?: string, now: number = Date.now()): number {
  const root = base ?? join(process.env.HOME ?? "", ".grok/sessions");
  const dirs = listEncodedSessionDirs(root);
  if (!dirs) return -1; // unreadable sessions root is a section error, not "no quiet threads"
  let quiet = 0;
  for (const dir of dirs) {
    // mtime gates the content read (see readUpdatesFile): only files young enough to possibly
    // fall inside ACTIVE_WINDOW_MS are opened, keeping the walk O(recent sessions).
    const entry = statSessionUpdates(root, dir);
    if (!entry || now - entry.mtimeMs > ACTIVE_WINDOW_MS) continue; // long-dead sessions are history
    const read = readUpdatesFile(entry.path);
    if (read.kind === "error") continue;
    if (read.newestUpdateMs !== undefined && now - read.newestUpdateMs > QUIET_WINDOW_MS) quiet += 1;
  }
  return quiet;
}

/**
 * The worker floor's missing implementation (#586). A dispatched worker runs in a managed git
 * worktree, so its encoded sessions dir decodes to a path ending in `/issue-<n>`; the
 * orchestrator's own thread lives in the main checkout and must not satisfy the floor. Live =
 * updates.jsonl touched within LIVE_WINDOW_MS. Unreadable root stays -1 (section error).
 */
export function countLiveWorkers(base?: string, now: number = Date.now()): number {
  const root = base ?? join(process.env.HOME ?? "", ".grok/sessions");
  const dirs = listEncodedSessionDirs(root);
  if (!dirs) return -1;
  const worktreeRe = /%2Fissue-\d+$/u;
  let live = 0;
  for (const dir of dirs) {
    if (!worktreeRe.test(dir)) continue;
    // Same mtime gate as S5: hundreds of historical worktree sessions carry multi-MB logs, and
    // reading all of them cost 5s measured (#586 retro-fix). A stale mtime cannot be live.
    const entry = statSessionUpdates(root, dir);
    if (!entry || now - entry.mtimeMs > LIVE_WINDOW_MS) continue;
    const read = readUpdatesFile(entry.path);
    if (read.kind === "error") continue;
    const stampLive =
      read.newestUpdateMs !== undefined && now - read.newestUpdateMs <= LIVE_WINDOW_MS;
    const mtimeLive = now - read.mtimeMs <= LIVE_WINDOW_MS;
    if (stampLive || mtimeLive) live += 1;
  }
  return live;
}

export async function summariseUnfinishedInventory(root: string): Promise<SweepInventory> {
  // S1 — the required core: planted REDs counted with the comment/string-stripping counter.
  const redFiles: Array<{ file: string; count: number }> = [];
  let oldestRedId: string | undefined;
  let oldestMtimeMs = Number.POSITIVE_INFINITY;
  for (const scanRoot of SCAN_ROOTS) {
    for (const abs of walkTestFiles(join(root, scanRoot))) {
      const rel = abs.slice(root.length + 1);
      const count = plantedRedCount(root, rel);
      if (count <= 0) continue;
      redFiles.push({ file: rel, count });
      // Oldest carrier = lowest mtime among red files; cite its `(#N)` marker when present.
      let mtimeMs = Number.POSITIVE_INFINITY;
      try {
        mtimeMs = statSync(abs).mtimeMs;
      } catch {
        /* keep sentinel */
      }
      if (mtimeMs < oldestMtimeMs) {
        oldestMtimeMs = mtimeMs;
        oldestRedId = /\(#(\d+)\)/u.exec(readFileSync(abs, "utf8"))?.[0];
      }
    }
  }

  const [undispatchableResult, uncardedResult, releaseResult] = await Promise.all([
    countUndispatchableCards().catch(() => ({ count: -1, ids: [] as number[] })),
    Promise.resolve(countUncardedRecentFiles(root)),
    checkReleaseDrift(root),
  ]);

  return {
    reds: redFiles.reduce((sum, entry) => sum + entry.count, 0),
    oldestRedId,
    redFiles,
    undispatchable: undispatchableResult.count,
    undispatchableIds: undispatchableResult.ids,
    uncarded: uncardedResult.count,
    uncardedFiles: uncardedResult.files.slice(0, 50),
    releaseTag: releaseResult.error ? undefined : releaseResult.tag,
    quietThreads: countQuietThreads(),
    liveWorkers: countLiveWorkers(),
    workerFloor: WORKER_FLOOR,
  };
}

/**
 * One machine-greppable line:
 * `SWEEP: reds=N(oldest #id) undisp=N uncarded=N rel=<tag> quiet=N workers=n/floor[ BREACH]`.
 * `NOT DETERMINED` marks a section error; a worker-floor breach appends BREACH so the line is
 * self-reporting without parsing numbers.
 */
export function formatSweepLine(inventory: SweepInventory): string {
  const oldest = inventory.oldestRedId ? `(oldest ${inventory.oldestRedId})` : "";
  const undisp =
    inventory.undispatchable < 0 ? "NOT DETERMINED" : String(inventory.undispatchable);
  const uncarded =
    inventory.uncarded < 0 ? "NOT DETERMINED" : String(inventory.uncarded);
  const rel = inventory.releaseTag ?? "NOT DETERMINED";
  const workers =
    inventory.liveWorkers < 0
      ? `workers=NOT DETERMINED/${inventory.workerFloor}`
      : `workers=${inventory.liveWorkers}/${inventory.workerFloor}`;
  const breach = inventory.liveWorkers >= 0 && inventory.liveWorkers < inventory.workerFloor ? " BREACH" : "";
  return (
    `SWEEP: reds=${inventory.reds}${oldest} undisp=${undisp} `
      + `uncarded=${uncarded} rel=${rel} quiet=${inventory.quietThreads} ${workers}${breach}`
  );
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const root = process.cwd();
  const json = argv.includes("--json");
  let inventory: SweepInventory;
  try {
    inventory = await summariseUnfinishedInventory(root);
  } catch (error) {
    console.error(`SWEEP ERROR: ${String(error)}`);
    return 1; // nonzero exit on any section error, per the contract
  }
  if (json) console.log(JSON.stringify(inventory, null, 2));
  else console.log(formatSweepLine(inventory));
  const sectionsErrored =
    inventory.undispatchable < 0 ||
    inventory.uncarded < 0 ||
    inventory.quietThreads < 0 ||
    inventory.redFiles.some((entry) => entry.count < 0);
  // Exit 1 = section error; exit 2 = worker-floor breach, so a breach cannot be conflated with a
  // broken scan (the two need different responses from whatever consumes the sweep).
  if (sectionsErrored) return 1;
  if (inventory.liveWorkers >= 0 && inventory.liveWorkers < inventory.workerFloor) return 2;
  return 0;
}

if (process.argv[1]?.endsWith("openclaw-sweep.ts")) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
