/**
 * Model-vs-tool wall-clock split for one worker session, read from the grok
 * unified log (`~/.grok/logs/unified.jsonl`).
 *
 * MEASURED 2026-10-06: two mouth slices spent roughly half their wall time in
 * tools, mostly re-running full package suites after each edit (model 628s vs
 * tool 652s; model 668s vs tool 162s). That measurement was hand-derived; this
 * module makes it a ledger field so the next one is read, not re-derived.
 *
 * Semantics, per event stream for one `sid`:
 * - model = sum of `ctx.model_elapsed_ms` on `shell.turn.inference_done`
 * - tool  = sum over each `inference_done` of the wall gap to the NEXT
 *   `shell.tool.exec_done` for the same sid (the tool phase the model waited on)
 */

export type SessionTimeSplit = {
  modelSeconds: number;
  toolSeconds: number;
};

type LogEvent = {
  ts?: unknown;
  sid?: unknown;
  msg?: unknown;
  ctx?: { model_elapsed_ms?: unknown };
};

function tsMs(ts: unknown): number | null {
  if (typeof ts !== "string") return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

/** Pure parse over unified.jsonl text for one session id. */
export function sessionTimeSplit(logText: string, sessionId: string): SessionTimeSplit {
  let modelMs = 0;
  let toolMs = 0;
  let pendingInferenceAt: number | null = null;

  for (const line of logText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev: LogEvent;
    try {
      ev = JSON.parse(trimmed) as LogEvent;
    } catch {
      continue;
    }
    if (ev.sid !== sessionId) continue;
    if (ev.msg === "shell.turn.inference_done") {
      const m = ev.ctx?.model_elapsed_ms;
      if (typeof m === "number" && Number.isFinite(m)) modelMs += m;
      const at = tsMs(ev.ts);
      pendingInferenceAt = at;
    } else if (ev.msg === "shell.tool.exec_done") {
      if (pendingInferenceAt !== null) {
        const at = tsMs(ev.ts);
        if (at !== null && at >= pendingInferenceAt) toolMs += at - pendingInferenceAt;
        pendingInferenceAt = null;
      }
    }
  }

  const round = (ms: number): number => Math.round(ms / 100) / 10;
  return { modelSeconds: round(modelMs), toolSeconds: round(toolMs) };
}
