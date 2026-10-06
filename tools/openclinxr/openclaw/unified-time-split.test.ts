import { describe, expect, it } from "vitest";
import { sessionTimeSplit } from "./unified-time-split.js";

/**
 * Synthetic unified.jsonl excerpt: two model turns for session S1, one
 * unrelated session S9 interleaved, one malformed line. inference_done
 * carries model_elapsed_ms; tool time is the wall gap from each
 * inference_done to the next exec_done for the same sid.
 */
const SID = "01a10f26-b387-71c1-a615-c126bf30f225";

function line(ev: Record<string, unknown>): string {
  return JSON.stringify(ev);
}

const LOG = [
  line({ ts: "2026-10-06T10:00:00.000Z", sid: SID, msg: "shell.turn.inference_start", ctx: {} }),
  line({ ts: "2026-10-06T10:00:10.000Z", sid: SID, msg: "shell.turn.inference_done", ctx: { model_elapsed_ms: 9500 } }),
  line({ ts: "2026-10-06T10:00:10.200Z", sid: "s9-other", msg: "shell.turn.inference_done", ctx: { model_elapsed_ms: 99999 } }),
  line({ ts: "2026-10-06T10:00:13.000Z", sid: SID, msg: "shell.tool.exec_done", ctx: { tool_name: "run_terminal_command", elapsed_ms: 2800 } }),
  line({ ts: "2026-10-06T10:00:40.000Z", sid: SID, msg: "shell.turn.inference_done", ctx: { model_elapsed_ms: 20500 } }),
  line({ ts: "2026-10-06T10:01:00.000Z", sid: SID, msg: "shell.tool.exec_done", ctx: { tool_name: "run_terminal_command", elapsed_ms: 19000 } }),
  "this is not json",
  line({ ts: "2026-10-06T10:01:05.000Z", sid: SID, msg: "shell.turn.inference_done", ctx: {} }),
].join("\n");

describe("unified-time-split", () => {
  it("sums model_elapsed_ms and inference-to-exec gaps for one sid", () => {
    // model: 9.5 + 20.5 = 30.0s (third inference_done has no model_elapsed_ms).
    // tool: (13.0 - 10.0) + (60.0 - 40.0) = 3.0 + 20.0 = 23.0s.
    expect(sessionTimeSplit(LOG, SID)).toEqual({ modelSeconds: 30, toolSeconds: 23 });
  });

  it("ignores other sessions, malformed lines, and unknown sids", () => {
    expect(sessionTimeSplit(LOG, "s9-other")).toEqual({ modelSeconds: 100, toolSeconds: 0 });
    expect(sessionTimeSplit(LOG, "no-such-session")).toEqual({ modelSeconds: 0, toolSeconds: 0 });
    expect(sessionTimeSplit("not json\n", SID)).toEqual({ modelSeconds: 0, toolSeconds: 0 });
  });
});
