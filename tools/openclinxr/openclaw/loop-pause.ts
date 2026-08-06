#!/usr/bin/env tsx
/**
 * Post-merge tripwire: the pause bit that can actually halt the unattended delegation loop.
 *
 * WHY THIS FILE EXISTS: the mechanical scorecard already measures land rate, durability, and
 * ratchet debt — but a metric that cannot stop the machine it measures is decoration. This module
 * is the halt. When tripwire signals fire (debt rose, etc.), the orchestrator writes a pause
 * record; every subsequent dispatch must call `assertLoopNotPaused` and die if the bit is set.
 *
 * WHY THE PAUSE FILE LIVES IN THE SHARED COORDINATION ROOT (not worktree cwd, not PROJECT_STATUS):
 * Worktree-bound workers run under `--deny 'Write(<main>/**)'` / Edit, so they CANNOT write the
 * shared `.openclinxr` root that `resolveSharedCoordinationPath` resolves (physically in the MAIN
 * checkout). That is precisely why the pause file must live there — it is the one place a
 * delegated worker cannot clear. Resolving against cwd would give each worktree a private pause
 * file, which is the same class of bug that once made an automation lease always succeed.
 *
 * PROJECT_STATUS.md is a human/orchestrator coordination doc, protected, and is never the pause
 * mechanism. Resume must cost something (matching incidentId, real root cause, existing evidence
 * paths, and signal-clear proof) or clearing becomes a two-second habit that guts the control.
 */

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { resolveSharedCoordinationPath } from "./coordination-root.js";

const require = createRequire(import.meta.url);

export const LOOP_PAUSE_FILE = ".openclinxr/openclaw/LOOP-PAUSED.json";
export const LOOP_PAUSE_HISTORY = ".openclinxr/openclaw/loop-pause-history.jsonl";

/** Minimum root-cause length so resume is not a one-word reflex ("ok" / "fixed"). */
// ~one short clause of actual diagnosis. Shorter strings are the failure mode where ack becomes
// muscle memory and the tripwire never forces a fix.
export const MIN_ROOT_CAUSE_LENGTH = 24;

export type TripwireSignal = {
  id: "debt-rose" | "merge-without-proofs" | "isolation-leak" | "fixup-storm";
  detail: string;
  /** The measurement that tripped it, so a resume can be checked against it. */
  observed: Record<string, number | string | boolean>;
};

export type LoopPauseRecord = {
  schemaVersion: "openclinxr.loop-pause.v1";
  paused: true;
  incidentId: string;
  reason: string;
  signals: TripwireSignal[];
  setAt: string;
  setBy: "tripwire" | "human";
};

export type LoopResumeAck = {
  incidentId: string;
  rootCause: string;
  evidencePaths: string[];
  clearedBy: string;
  /**
   * Required when no `signalsStillTrue` callback is provided. Defaulting to "assume clear"
   * would gut the control — an unchecked resume is not a clear.
   */
  acknowledgeUncheckedSignals?: boolean;
};

export type LoopResumeResult = { ok: true } | { ok: false; errors: string[] };

export type ResumeLoopOptions = {
  /**
   * Injected current-signal check so this module stays testable and does not import the
   * scorecard. Returns signals that are STILL true (must not resume until empty).
   */
  signalsStillTrue?: (record: LoopPauseRecord) => TripwireSignal[];
};

/** Named error so dispatch callers can distinguish pause from other failures. */
export class LoopPausedError extends Error {
  readonly name = "LoopPausedError";
  readonly incidentId: string;
  readonly reason: string;
  readonly record: LoopPauseRecord;

  constructor(record: LoopPauseRecord) {
    // message without name prefix — Error#toString adds `${name}: ${message}`.
    super(
      `loop is paused (incidentId=${record.incidentId}): ${record.reason}`,
    );
    this.incidentId = record.incidentId;
    this.reason = record.reason;
    this.record = record;
  }
}

function pauseFilePath(repoRoot: string): string {
  // ALWAYS shared coordination root — never cwd-relative. See file header.
  return resolveSharedCoordinationPath(LOOP_PAUSE_FILE, repoRoot);
}

function historyFilePath(repoRoot: string): string {
  return resolveSharedCoordinationPath(LOOP_PAUSE_HISTORY, repoRoot);
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function deriveIncidentId(signals: TripwireSignal[], setAt: string, reason: string): string {
  const payload = JSON.stringify({
    ids: signals.map((s) => s.id),
    setAt,
    reason,
  });
  return `lp-${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

type HistoryAction = "pause" | "resume-ok" | "resume-refused";

function appendHistory(
  repoRoot: string,
  entry: {
    action: HistoryAction;
    at: string;
    incidentId?: string;
    reason?: string;
    setBy?: string;
    clearedBy?: string;
    errors?: string[];
    signals?: TripwireSignal[];
  },
): void {
  const path = historyFilePath(repoRoot);
  ensureParentDir(path);
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

/** THE guard. Called at the top of any dispatch. Throws if the loop is paused. */
export function assertLoopNotPaused(repoRoot: string): void {
  const record = readLoopPause(repoRoot);
  if (record) {
    throw new LoopPausedError(record);
  }
}

export function readLoopPause(repoRoot: string): LoopPauseRecord | null {
  const path = pauseFilePath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as LoopPauseRecord;
    if (raw?.schemaVersion !== "openclinxr.loop-pause.v1" || raw.paused !== true) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function pauseLoop(
  repoRoot: string,
  input: { reason: string; signals: TripwireSignal[]; setBy: "tripwire" | "human" },
): LoopPauseRecord {
  const setAt = new Date().toISOString();
  const record: LoopPauseRecord = {
    schemaVersion: "openclinxr.loop-pause.v1",
    paused: true,
    incidentId: deriveIncidentId(input.signals, setAt, input.reason),
    reason: input.reason,
    signals: input.signals,
    setAt,
    setBy: input.setBy,
  };
  const path = pauseFilePath(repoRoot);
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  appendHistory(repoRoot, {
    action: "pause",
    at: setAt,
    incidentId: record.incidentId,
    reason: record.reason,
    setBy: record.setBy,
    signals: record.signals,
  });
  return record;
}

/**
 * Resume only when the ack proves a fix, not a reflex.
 * Collects EVERY refusal reason (not just the first) so operators fix them in one pass.
 */
export function resumeLoop(
  repoRoot: string,
  ack: LoopResumeAck,
  opts?: ResumeLoopOptions,
): LoopResumeResult {
  const at = new Date().toISOString();
  const errors: string[] = [];
  const active = readLoopPause(repoRoot);

  if (!active) {
    errors.push("no active pause — nothing to resume");
  } else if (ack.incidentId !== active.incidentId) {
    errors.push(
      `incidentId mismatch: ack=${ack.incidentId} active=${active.incidentId} `
        + `(no reusing an old ack)`,
    );
  }

  const rootCause = (ack.rootCause ?? "").trim();
  if (rootCause.length === 0) {
    errors.push("rootCause is empty");
  } else if (rootCause.length < MIN_ROOT_CAUSE_LENGTH) {
    errors.push(
      `rootCause too short (${rootCause.length} < ${MIN_ROOT_CAUSE_LENGTH}); `
        + `resume must state a real diagnosis, not a one-word reflex`,
    );
  }

  const evidencePaths = ack.evidencePaths ?? [];
  if (evidencePaths.length === 0) {
    errors.push("evidencePaths is empty — resume requires on-disk evidence of the fix");
  } else {
    for (const p of evidencePaths) {
      if (!existsSync(p)) {
        errors.push(`evidence path does not exist: ${p}`);
      }
    }
  }

  if (active) {
    if (opts?.signalsStillTrue) {
      const still = opts.signalsStillTrue(active);
      for (const sig of still) {
        errors.push(
          `signal still true: ${sig.id} — ${sig.detail} `
            + `(cannot clear a tripwire by acknowledging it; fix what tripped it)`,
        );
      }
    } else if (!ack.acknowledgeUncheckedSignals) {
      errors.push(
        "no signalsStillTrue callback provided and acknowledgeUncheckedSignals is not set — "
          + "refusing to assume signals are clear (that default would gut the control)",
      );
    }
  }

  if (errors.length > 0) {
    appendHistory(repoRoot, {
      action: "resume-refused",
      at,
      incidentId: ack.incidentId,
      clearedBy: ack.clearedBy,
      errors,
    });
    return { ok: false, errors };
  }

  // Active pause matched; clear the bit.
  const path = pauseFilePath(repoRoot);
  if (existsSync(path)) {
    unlinkSync(path);
  }
  appendHistory(repoRoot, {
    action: "resume-ok",
    at,
    incidentId: ack.incidentId,
    clearedBy: ack.clearedBy,
    reason: rootCause,
  });
  return { ok: true };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/**
 * CLI-only signal re-check. debt-rose uses the scorecard snapshot (lazy require so unit
 * tests of this module never load git/scorecard). Other signal ids have no detectors here —
 * returning them as still-true refuses resume unless the operator uses --ack-unchecked-signals.
 */
function cliSignalsStillTrue(repoRoot: string, record: LoopPauseRecord): TripwireSignal[] {
  const still: TripwireSignal[] = [];
  for (const sig of record.signals) {
    if (sig.id === "debt-rose") {
      try {
        // .ts path works under tsx; compiled consumers resolve .js equivalently via createRequire.
        const { debtDelta, buildScorecard } = require("./delegation-scorecard.ts") as {
          debtDelta: (
            root: string,
            card: { debt: { brokenReferenceCeilings: number; sizeFreezeEntries: number } },
          ) => { rose: boolean };
          buildScorecard: (root: string) => {
            debt: { brokenReferenceCeilings: number; sizeFreezeEntries: number };
          };
        };
        const card = buildScorecard(repoRoot);
        const delta = debtDelta(repoRoot, card);
        if (delta.rose) {
          still.push(sig);
        }
      } catch {
        // Scorecard unavailable → cannot prove clear → hold the signal.
        still.push(sig);
      }
    } else {
      still.push({
        ...sig,
        detail:
          `${sig.detail} (no CLI detector for ${sig.id}; `
          + `use programmatic signalsStillTrue or --ack-unchecked-signals)`,
      });
    }
  }
  return still;
}

function printUsage(): void {
  console.error(
    "Usage:\n"
      + "  loop-pause status\n"
      + "  loop-pause pause --reason <text>\n"
      + "  loop-pause resume --incident <id> --root-cause <text> --evidence <p1,p2> "
      + "--cleared-by <who> [--ack-unchecked-signals]\n",
  );
}

function parseArgs(argv: string[]): {
  cmd: string;
  flags: Record<string, string | boolean>;
} {
  const [cmd = "", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i] ?? "";
    if (tok === "--ack-unchecked-signals") {
      flags["ack-unchecked-signals"] = true;
      continue;
    }
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const val = rest[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        flags[key] = val;
        i += 1;
      } else {
        flags[key] = true;
      }
    }
  }
  return { cmd, flags };
}

function runCli(argv: string[]): number {
  const repoRoot = process.cwd();
  const { cmd, flags } = parseArgs(argv);

  if (cmd === "status") {
    const record = readLoopPause(repoRoot);
    if (!record) {
      console.log("loop: running (not paused)");
      return 0;
    }
    console.log(
      `loop: PAUSED incidentId=${record.incidentId} setBy=${record.setBy} `
        + `setAt=${record.setAt}\nreason: ${record.reason}\nsignals: `
        + JSON.stringify(record.signals, null, 2),
    );
    // Exit 3 = paused (distinct from 1 = crash, 2 = failed check elsewhere).
    return 3;
  }

  if (cmd === "pause") {
    const reason = String(flags["reason"] ?? "").trim();
    if (!reason) {
      console.error("pause requires --reason <text>");
      printUsage();
      return 1;
    }
    const record = pauseLoop(repoRoot, {
      reason,
      signals: [],
      setBy: "human",
    });
    console.log(`paused incidentId=${record.incidentId}`);
    return 0;
  }

  if (cmd === "resume") {
    const incidentId = String(flags["incident"] ?? "").trim();
    const rootCause = String(flags["root-cause"] ?? "").trim();
    const evidenceRaw = String(flags["evidence"] ?? "").trim();
    const clearedBy = String(flags["cleared-by"] ?? "").trim();
    const ackUnchecked = flags["ack-unchecked-signals"] === true;

    if (!incidentId || !rootCause || !evidenceRaw || !clearedBy) {
      console.error(
        "resume requires --incident, --root-cause, --evidence, and --cleared-by",
      );
      printUsage();
      return 1;
    }

    const evidencePaths = evidenceRaw.split(",").map((p) => p.trim()).filter(Boolean);
    const ack: LoopResumeAck = {
      incidentId,
      rootCause,
      evidencePaths,
      clearedBy,
      ...(ackUnchecked ? { acknowledgeUncheckedSignals: true } : {}),
    };

    // Prefer an injected check so resume is not "assume clear".
    // --ack-unchecked-signals: operator accepts resume without a live signal re-check.
    // Otherwise: re-check debt-rose against scorecard snapshot; other signal ids have no
    // fabricated CLI detectors (returning them as still-true forces explicit ack).
    let result: LoopResumeResult;
    if (ackUnchecked) {
      result = resumeLoop(repoRoot, ack);
    } else {
      result = resumeLoop(repoRoot, ack, {
        signalsStillTrue: (record) => cliSignalsStillTrue(repoRoot, record),
      });
    }

    if (!result.ok) {
      console.error("resume refused:");
      for (const e of result.errors) console.error(`  - ${e}`);
      return 2;
    }
    console.log(`resumed incidentId=${incidentId}`);
    return 0;
  }

  printUsage();
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runCli(process.argv.slice(2)));
}
