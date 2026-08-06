import { existsSync, readFileSync } from "node:fs";
import { resolveSharedCoordinationPath } from "./coordination-root.js";

/**
 * Map a slice's worker session ids — and what they cost — onto its board item.
 *
 * The session ledger (`worker-sessions.jsonl`) and the cost rollup (`task-cost-latest.json`) both
 * exist and neither reaches the issue. So the durable record of WHICH AGENT did a piece of work, and
 * what it cost, lives only in gitignored local coordination state: not shared, not durable, and gone
 * with the machine. `EXEC_REHYDRATE.md` already says operational collaboration state belongs on the
 * board precisely because a shared file is neither.
 *
 * That mapping is what makes a retrospective possible months later. `--resume <sessionId>` reaches
 * the agent that actually did the work (proven by control/treatment, PROTO_VERIFY_DELEGATION §6c) —
 * but only if the id survives, and only if you can tell WHICH id belongs to which task.
 *
 * CLAIM: renders a deterministic markdown block tying a slice's sessions, models, turns and cost
 * estimate together, from artifacts already on disk.
 * NOT TESTED: that the estimate matches a provider invoice. It does not, by construction — see the
 * rollup's own disclaimer. Context peaks overstate billed tokens.
 */

export type WorkerSession = {
  sessionId: string;
  slice?: string;
  model?: string;
  turns?: number;
  stopReason?: string;
  worktree?: string;
  at?: string;
};

export type SubagentCost = {
  key?: string;
  model?: string;
  /**
   * The rollup writes `tokens` (`task-cost-rollup.v1`). `totalTokens` is accepted only because an
   * earlier draft of this file assumed that name and its test asserted the assumption rather than
   * the artifact — reading the real JSON is what caught it.
   */
  tokens?: number;
  totalTokens?: number;
  estimatedUsd?: number;
};

export type SessionMapInput = {
  slice: string;
  sessions: readonly WorkerSession[];
  costs?: readonly SubagentCost[];
  /** The rollup's own caveat. Carried through so the number is never quoted bare. */
  disclaimer?: string;
};

const LEDGER = ".openclinxr/openclaw/worker-sessions.jsonl";
const COST = ".openclinxr/openclaw/task-cost-latest.json";

/** Sessions for one slice, most recent last, de-duplicated by id (the ledger appends per attempt). */
export function sessionsForSlice(ledgerText: string, slice: string): WorkerSession[] {
  const bySessionId = new Map<string, WorkerSession>();
  for (const line of ledgerText.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as WorkerSession;
      if (entry.slice === slice && entry.sessionId) bySessionId.set(entry.sessionId, entry);
    } catch {
      // A malformed line must not lose the rest of the ledger.
    }
  }
  return [...bySessionId.values()];
}

function usd(value: number): string {
  // Sub-cent precision: worker slices are routinely under $0.01 and "$0.00" reads as free.
  return value < 0.01 && value > 0 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function renderSessionMap(input: SessionMapInput): string {
  if (input.sessions.length === 0) {
    return `No worker sessions recorded for \`${input.slice}\`.`;
  }

  const costBySession = new Map<string, SubagentCost>();
  for (const cost of input.costs ?? []) {
    if (cost.key) costBySession.set(cost.key, cost);
  }

  const lines: string[] = [
    `**Agent sessions for \`${input.slice}\`**`,
    ``,
    `Resume any of these to ask the agent that did the work what it was thinking:`,
    "`~/.grok/bin/grok -p \"<question>\" --resume <sessionId> --model grok-4.5 --output-format json`",
    ``,
    `| session | model | turns | stop | tokens | est. cost |`,
    `|---|---|---|---|---|---|`,
  ];

  let totalTokens = 0;
  let totalUsd = 0;
  for (const session of input.sessions) {
    const cost = costBySession.get(session.sessionId);
    const tokens = cost?.tokens ?? cost?.totalTokens ?? 0;
    const spend = cost?.estimatedUsd ?? 0;
    totalTokens += tokens;
    totalUsd += spend;
    lines.push(
      `| \`${session.sessionId}\` | ${session.model ?? "—"} | ${session.turns ?? "—"} `
      + `| ${session.stopReason ?? "—"} | ${tokens ? tokens.toLocaleString("en-US") : "—"} `
      + `| ${spend ? usd(spend) : "—"} |`,
    );
  }

  if (totalTokens > 0) {
    lines.push(`| **total** | | | | **${totalTokens.toLocaleString("en-US")}** | **${usd(totalUsd)}** |`);
  }

  lines.push(``);
  lines.push(
    input.disclaimer
      ? `_${input.disclaimer}_`
      : `_Cost is an estimate from local token accounting, not a provider invoice._`,
  );
  return lines.join("\n");
}

export function buildSessionMapForSlice(repoRoot: string, slice: string): string {
  const ledgerPath = resolveSharedCoordinationPath(LEDGER, repoRoot);
  if (!existsSync(ledgerPath)) return `No session ledger at ${LEDGER}.`;

  const sessions = sessionsForSlice(readFileSync(ledgerPath, "utf8"), slice);

  const costPath = resolveSharedCoordinationPath(COST, repoRoot);
  let costs: SubagentCost[] = [];
  let disclaimer: string | undefined;
  if (existsSync(costPath)) {
    try {
      const rollup = JSON.parse(readFileSync(costPath, "utf8")) as {
        bySubagent?: SubagentCost[];
        disclaimer?: string;
      };
      costs = rollup.bySubagent ?? [];
      disclaimer = rollup.disclaimer;
    } catch {
      // A cost rollup that will not parse must not block the session map, which is the durable half.
    }
  }

  return renderSessionMap({
    slice,
    sessions,
    costs,
    ...(disclaimer ? { disclaimer } : {}),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slice = process.argv[2];
  if (!slice) {
    console.error("usage: board-session-map.ts <slice-id>   # e.g. issue-41");
    process.exit(2);
  }
  console.log(buildSessionMapForSlice(process.cwd(), slice));
}
