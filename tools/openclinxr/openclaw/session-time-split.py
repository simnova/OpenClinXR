#!/usr/bin/env python3
"""Wall-clock split for Muse Spark worker sessions: model vs tools vs waits.

Reads grok session transcripts (events.jsonl for ms-precise phase/tool timing,
updates.jsonl for command text + retry/turn records) and /tmp/dispatch-*.json
results (num_turns, usage). Counts distinct tool-call ids, not log lines.

Usage:
  python3 tools/openclinxr/openclaw/session-time-split.py [--out-dir docs/agent-ops]
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
from collections import Counter

HOME = os.path.expanduser("~")
SESS_BASE = os.path.join(HOME, ".grok", "sessions")

# (label, url-encoded cwd leaf, session id, dispatch glob patterns)
SESSIONS = [
    ("stage1-albedo-calibration/a",
     "stage1-albedo-calibration", "01a0ed15-045b-7dd3-8d08-3fff8b0453d0",
     ["dispatch-stage1-albedo-calibration.json"]),
    ("stage1-albedo-calibration/b",
     "stage1-albedo-calibration", "01a0ed74-62fe-7903-8dfc-9f12e7d8c023",
     ["dispatch-stage1-albedo-calibration-2.json",
      "dispatch-stage1-albedo-calibration-3.json",
      "dispatch-stage1-albedo-calibration-4.json",
      "dispatch-stage1-albedo-calibration-5.json",
      "dispatch-stage1-albedo-calibration-6.json"]),
    ("finish-floor-skirting",
     "finish-floor-skirting", "01a0ee11-af30-7952-b461-2b9c7365a189",
     ["dispatch-finish-floor-skirting.json",
      "dispatch-finish-floor-skirting-2.json",
      "dispatch-finish-floor-skirting-3.json"]),
    ("finish-door",
     "finish-door", "01a0ee84-b34b-76f2-a7ba-ef977e362049",
     ["dispatch-finish-door.json", "dispatch-finish-door-2.json",
      "dispatch-finish-door-3.json", "dispatch-finish-door-4.json"]),
    ("ao-metal-measure",
     "ao-metal-measure", "01a0edf8-3931-7370-81ae-341b74a28ddf",
     ["dispatch-ao-metal-measure.json", "dispatch-ao-metal-measure-2.json"]),
]

MODEL_PHASES = {"waiting_for_model", "streaming_text", "streaming_reasoning"}


def parse_ts(s: str) -> float:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def classify(cmd: str) -> str:
    c = cmd or ""
    if re.match(r"\s*sleep\s+\d+", c):
        return "sleep_poll"
    low = c.lower()
    if ("room_chain/cli" in c or "room-albedo-ao-bake" in c
            or "room-occlusion-bake" in c or "bake_shell" in c
            or "ward-finish-ch" in c or "blender --background" in low
            or "blender=/tmp" in low or c.strip().startswith("blender ")):
        return "blender_chain"
    if ("playwright" in low or "stage2_capture" in low
            or "ward-finish-chain-capture" in c or "turntable" in low
            or "capture-views" in low or "browser:agent" in low):
        return "uixr_capture_playwright"
    if ("vitest" in low or "tsc " in c or "typecheck" in low
            or "turbo run" in c or "dlx turbo" in c or "vite build" in c
            or " tsgo" in c or "pnpm test" in c or "drift-check" in c
            or "agent:alignment" in c or " knip" in c or "eslint" in low):
        return "pnpm_test_typecheck"
    if "git " in c:
        return "git"
    return "other_shell"


def first_json_object(path: str):
    """Parse the first JSON object in a dispatch file (skips direnv lines)."""
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    start = text.find("{")
    if start < 0:
        return None
    dec = json.JSONDecoder()
    try:
        obj, _ = dec.raw_decode(text[start:])
        return obj
    except json.JSONDecodeError:
        return None


def analyze(label: str, leaf: str, sid: str, dispatches: list[str]) -> dict:
    enc = "%2FVolumes%2Ffiles%2Fsrc%2Fopenclinxr-wt%2F" + leaf
    sdir = os.path.join(SESS_BASE, enc, sid)
    events_path = os.path.join(sdir, "events.jsonl")
    updates_path = os.path.join(sdir, "updates.jsonl")

    events: list[dict] = []
    with open(events_path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    events.sort(key=lambda e: e.get("ts", ""))
    t0 = parse_ts(events[0]["ts"])
    t1 = parse_ts(events[-1]["ts"])
    wall = t1 - t0

    # Phase timeline from phase_changed events.
    phase_time: Counter = Counter()
    cur_phase = None
    cur_ts = t0
    for e in events:
        if e.get("type") == "phase_changed":
            phase_time[cur_phase or "unknown_init"] += parse_ts(e["ts"]) - cur_ts
            cur_phase = e.get("phase")
            cur_ts = parse_ts(e["ts"])
    phase_time[cur_phase or "unknown_init"] += t1 - cur_ts
    model_phase = sum(v for k, v in phase_time.items() if k in MODEL_PHASES)
    tool_wall = phase_time.get("tool_execution", 0.0)
    perm_wall = phase_time.get("permission_prompt", 0.0)

    # Tool completions: distinct ids, durations by tool.
    tool_dur: Counter = Counter()
    tool_n: Counter = Counter()
    tool_outcomes: Counter = Counter()
    seen_ids: set[str] = set()
    id_to_tool: dict[str, str] = {}
    for e in events:
        if e.get("type") == "tool_completed":
            tid = e.get("tool_call_id", "")
            seen_ids.add(tid)
            tool = e.get("tool_name", "?")
            id_to_tool[tid] = tool
            tool_n[tool] += 1
            tool_dur[tool] += (e.get("duration_ms", 0) or 0) / 1000.0
            tool_outcomes[e.get("outcome", "?")] += 1

    # updates.jsonl: tool_callId -> (tool, command); retry + turn records.
    id_to_cmd: dict[str, str] = {}
    cmd_classes: Counter = Counter()
    class_dur: Counter = Counter()
    retries: list[dict] = []
    turns: list[dict] = []
    upd_ts: list[float] = []
    with open(updates_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            upd = o.get("params", {}).get("update", {})
            su = upd.get("sessionUpdate")
            ts = o.get("timestamp")
            if isinstance(ts, (int, float)):
                upd_ts.append(float(ts))
            if su == "tool_call" and upd.get("toolCallId"):
                if upd.get("title") == "run_terminal_command":
                    id_to_cmd[upd["toolCallId"]] = (
                        upd.get("rawInput", {}).get("command", ""))
            elif su == "retry_state":
                retries.append({"ts": ts, "type": upd.get("type"),
                                "reason": upd.get("reason", "")})
            elif su == "turn_completed":
                turns.append({"ts": ts, "stop_reason": upd.get("stop_reason"),
                              "usage": upd.get("usage", {}) or {},
                              "elapsed_ms": upd.get("elapsed_ms", 0) or 0})

    for tid, tool in id_to_tool.items():
        if tool == "run_terminal_command":
            cls = classify(id_to_cmd.get(tid, ""))
            cmd_classes["terminal:" + cls] += 1
        else:
            cmd_classes["file:" + tool] += 1
    # Attribute terminal durations to classes via id join.
    dur_by_id: dict[str, float] = {}
    for e in events:
        if e.get("type") == "tool_completed":
            dur_by_id[e.get("tool_call_id", "")] = (
                e.get("duration_ms", 0) or 0) / 1000.0
    for tid, d in dur_by_id.items():
        tool = id_to_tool.get(tid, "?")
        if tool == "run_terminal_command":
            class_dur["terminal:" + classify(id_to_cmd.get(tid, ""))] += d
        else:
            class_dur["file:" + tool] += d

    # Rate-limit accounting.
    rl_retry = [r for r in retries if "rate_limit" in (r["reason"] or "")]
    overload_retry = [r for r in retries
                      if r not in rl_retry and (r["type"] == "retrying")]
    rl_turns = [t for t in turns if t["stop_reason"] == "rate_limit"]
    # In-turn backoff: retry ts -> next updates ts (1s resolution).
    upd_ts_sorted = sorted(upd_ts)
    rl_backoff = 0.0
    overload_backoff = 0.0
    for r in rl_retry + overload_retry:
        if not isinstance(r["ts"], (int, float)):
            continue
        nxt = next((t for t in upd_ts_sorted if t > r["ts"]), None)
        if nxt is not None:
            if r in rl_retry:
                rl_backoff += nxt - r["ts"]
            else:
                overload_backoff += nxt - r["ts"]
    # Post-rate-limit restart gaps: turn_ended(error after rate limit)
    # -> next turn_started, from events.
    turn_bounds: list[tuple[float, str, str | None]] = []
    for e in events:
        if e.get("type") in ("turn_started", "turn_ended"):
            turn_bounds.append((parse_ts(e["ts"]), e["type"],
                                e.get("outcome")))
    rl_gap = 0.0
    inter_turn_gap = 0.0
    for i, (ts, typ, outcome) in enumerate(turn_bounds):
        if typ == "turn_ended" and i + 1 < len(turn_bounds):
            gap = turn_bounds[i + 1][0] - ts
            inter_turn_gap += gap
            if outcome != "error":
                continue
            # Attribute to rate limit if a rate-limit retry/turn sits
            # within 5 minutes before the turn end.
            recent = [r for r in rl_retry
                      if isinstance(r["ts"], (int, float))
                      and ts - 300 <= r["ts"] <= ts]
            recent_turn = [t for t in rl_turns
                           if isinstance(t["ts"], (int, float))
                           and ts - 300 <= t["ts"] <= ts + 5]
            if recent or recent_turn:
                if i + 1 < len(turn_bounds):
                    rl_gap += turn_bounds[i + 1][0] - ts

    api_ms = sum((t["usage"].get("apiDurationMs", 0) or 0) for t in turns)
    turn_elapsed = sum((t["elapsed_ms"] or 0) for t in turns) / 1000.0

    # Dispatch results.
    disp_rows = []
    for pat in dispatches:
        for path in sorted(glob.glob(os.path.join("/tmp", pat))):
            obj = first_json_object(path)
            if obj is None:
                disp_rows.append({"file": os.path.basename(path),
                                  "parse": "empty"})
                continue
            disp_rows.append({
                "file": os.path.basename(path),
                "kind": obj.get("type", "ok"),
                "stopReason": obj.get("stopReason"),
                "message": (obj.get("message", "") or "")[:160],
                "sessionId": obj.get("sessionId"),
                "num_turns": obj.get("num_turns"),
                "usage": obj.get("usage"),
            })

    idle = wall - model_phase - tool_wall - perm_wall
    return {
        "label": label,
        "session_id": sid,
        "wall_s": round(wall, 1),
        "model_phase_s": round(model_phase, 1),
        "model_api_s": round(api_ms / 1000.0, 1),
        "tool_wall_s": round(tool_wall, 1),
        "tool_resource_s": round(sum(tool_dur.values()), 1),
        "tool_seconds_by_tool": {k: round(v, 1)
                                 for k, v in tool_dur.most_common()},
        "tool_calls_by_tool": dict(tool_n),
        "tool_outcomes": dict(tool_outcomes),
        "distinct_tool_calls": len(seen_ids),
        "command_classes_n": dict(cmd_classes),
        "command_class_seconds": {k: round(v, 1)
                                  for k, v in class_dur.most_common()},
        "permission_phase_s": round(perm_wall, 1),
        "idle_other_s": round(idle, 1),
        "turn_elapsed_s": round(turn_elapsed, 1),
        "rate_limit_retries": len(rl_retry),
        "rate_limit_turns": len(rl_turns),
        "overload_other_retries": len(overload_retry),
        "rate_limit_backoff_s": round(rl_backoff, 1),
        "overload_backoff_s": round(overload_backoff, 1),
        "rate_limit_restart_gap_s": round(rl_gap, 1),
        "inter_turn_gap_s": round(inter_turn_gap, 1),
        "dispatches": disp_rows,
    }


RAW_EXAMPLE_TYPES = ("phase_changed", "tool_started", "tool_completed",
                     "tool_call", "retry_state", "turn_completed")


def raw_examples() -> dict:
    """One raw event of each relied type (trimmed to schema fields)."""
    out: dict = {}
    enc = ("%2FVolumes%2Ffiles%2Fsrc%2Fopenclinxr-wt%2Fao-metal-measure")
    sid = "01a0edf8-3931-7370-81ae-341b74a28ddf"
    with open(os.path.join(SESS_BASE, enc, sid, "events.jsonl")) as f:
        for line in f:
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = o.get("type")
            if t in ("phase_changed", "tool_started", "tool_completed") \
                    and t not in out:
                out[t] = o
            if len([k for k in out if k in
                    ("phase_changed", "tool_started",
                     "tool_completed")]) == 3:
                break
    with open(os.path.join(SESS_BASE, enc, sid, "updates.jsonl")) as f:
        for line in f:
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            su = o.get("params", {}).get("update", {}).get("sessionUpdate")
            if su in ("tool_call", "retry_state", "turn_completed") \
                    and su not in out:
                if su == "tool_call":
                    o["params"]["update"]["rawInput"]["command"] = \
                        "<command…>"
                if su == "turn_completed":
                    o["params"]["update"]["usage"] = "<usage…>"
                out[su] = o
            if all(k in out for k in RAW_EXAMPLE_TYPES):
                break
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="docs/agent-ops")
    args = ap.parse_args()

    rows = [analyze(label, leaf, sid, pats)
            for label, leaf, sid, pats in SESSIONS]
    agg_tool: Counter = Counter()
    agg_class: Counter = Counter()
    agg = {"wall_s": 0.0, "model_phase_s": 0.0, "model_api_s": 0.0,
           "tool_wall_s": 0.0, "tool_resource_s": 0.0,
           "idle_other_s": 0.0, "distinct_tool_calls": 0,
           "rate_limit_retries": 0, "rate_limit_turns": 0,
           "overload_other_retries": 0, "rate_limit_backoff_s": 0.0,
           "overload_backoff_s": 0.0,
           "rate_limit_restart_gap_s": 0.0, "inter_turn_gap_s": 0.0}
    for r in rows:
        for k in agg:
            agg[k] += r.get(k, 0)
        for k, v in r["tool_seconds_by_tool"].items():
            agg_tool[k] += v
        for k, v in r["command_class_seconds"].items():
            agg_class[k] += v
    result = {
        "date": "2026-09-29",
        "model": "muse-spark-1.3-contributor",
        "method": ("events.jsonl phase timeline (ms) for model/tool split; "
                   "tool_completed duration_ms summed per tool over distinct "
                   "tool_call_id; run_terminal_command joined to updates.jsonl "
                   "tool_call rawInput.command for class split; retry_state + "
                   "turn_completed(stop_reason=rate_limit) for rate waits; "
                   "/tmp/dispatch-*.json first object for num_turns/usage."),
        "sessions": rows,
        "aggregate": ({k: round(v, 1) for k, v in agg.items()}
                      | {"tool_seconds_by_tool":
                         {k: round(v, 1) for k, v in agg_tool.most_common()},
                         "command_class_seconds":
                         {k: round(v, 1) for k, v in agg_class.most_common()}}),
        "schema_examples": raw_examples(),
    }

    os.makedirs(args.out_dir, exist_ok=True)
    jpath = os.path.join(args.out_dir,
                         "worker-session-time-split-2026-09-29.json")
    with open(jpath, "w") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    def fmt(s: float) -> str:
        if s >= 3600:
            return f"{s / 3600:.1f}h"
        if s >= 60:
            return f"{s / 60:.1f}m"
        return f"{s:.0f}s"

    lines = ["# Worker session time split — 2026-09-29",
             "",
             "Model: muse-spark-1.3-contributor. Method: `events.jsonl` phase",
             "timeline (ms) for the model/tool split; `tool_completed`",
             "`duration_ms` summed per tool over distinct `tool_call_id`;",
             "terminal commands joined to `updates.jsonl` `tool_call`",
             "`rawInput.command` for the class split; `retry_state` +",
             "`turn_completed(stop_reason=rate_limit)` for rate-limit waits.",
             "",
             "## Per session",
             "",
             ("| session | wall | model phase | model API | tool wall | "
              "tool resource | idle/other | tools | 429 retries | "
              "429 turns | 429 lost |"),
             ("|---|---|---|---|---|---|---|---|---|---|---|")]
    for r in rows:
        lost = r["rate_limit_backoff_s"] + r["rate_limit_restart_gap_s"]
        lines.append(
            f"| {r['label']} | {fmt(r['wall_s'])} | "
            f"{fmt(r['model_phase_s'])} | {fmt(r['model_api_s'])} | "
            f"{fmt(r['tool_wall_s'])} | {fmt(r['tool_resource_s'])} | "
            f"{fmt(r['idle_other_s'])} | {r['distinct_tool_calls']} | "
            f"{r['rate_limit_retries']} | {r['rate_limit_turns']} | "
            f"{fmt(lost)} |")
    a = result["aggregate"]
    a_lost = a["rate_limit_backoff_s"] + a["rate_limit_restart_gap_s"]
    lines += ["",
              "## Aggregate (5 sessions)",
              "",
              f"Wall {fmt(a['wall_s'])}; model phase {fmt(a['model_phase_s'])};",
              f"model API {fmt(a['model_api_s'])}; tool wall "
              f"{fmt(a['tool_wall_s'])}; tool resource "
              f"{fmt(a['tool_resource_s'])}; idle/other "
              f"{fmt(a['idle_other_s'])}; {a['distinct_tool_calls']} tool calls; "
              f"{a['rate_limit_retries']} rate-limit retries, "
              f"{a['rate_limit_turns']} rate-limited turns, "
              f"{fmt(a_lost)} lost to rate limits.",
              "",
              "Rate-limit loss is a subset of model-phase time: in-turn retry",
              "backoff sits inside `waiting_for_model`, and post-rate-limit",
              "restart gaps carry the last phase across the turn boundary.",
              f"All inter-turn restart gaps total {fmt(a['inter_turn_gap_s'])}; "
              f"non-429 overload (503/504) backoff totals "
              f"{fmt(a['overload_backoff_s'])} over "
              f"{a['overload_other_retries']} retries.",
              "",
              "## Command-class seconds (resource time)",
              ""]
    for k, v in result["aggregate"]["command_class_seconds"].items():
        lines.append(f"- {k}: {fmt(v)}")
    lines += ["",
              "## Schema witnesses (one raw event per relied type)",
              "",
              ("`events.jsonl`: `ts, type=phase_changed/tool_started/"
               "tool_completed` (`tool_name, duration_ms, outcome, "
               "tool_call_id`); `updates.jsonl`: `timestamp, "
               "params.update.sessionUpdate=tool_call "
               "(`toolCallId, title, rawInput.command`) / retry_state "
               "(`type, reason`) / turn_completed (`stop_reason, "
               "usage.apiDurationMs, elapsed_ms`)`; "
               "`/tmp/dispatch-*.json`: first object "
               "(`num_turns, usage, stopReason`). "
               "Full witnesses in the `.json` companion (`schema_examples`)."),
              ""]
    mpath = os.path.join(args.out_dir,
                         "worker-session-time-split-2026-09-29.md")
    with open(mpath, "w") as f:
        f.write("\n".join(lines))

    print("Per-session wall / model-phase / tool-resource / "
          "rate-limit retries:")
    for r in rows:
        print(f"  {r['label']}: wall={fmt(r['wall_s'])} "
              f"model={fmt(r['model_phase_s'])} "
              f"tools={fmt(r['tool_resource_s'])} "
              f"rate_retries={r['rate_limit_retries']}")
    print(f"Wrote {jpath} and {mpath}")
    print("\nRaw-event witnesses (one per relied type):")
    print(json.dumps(result["schema_examples"], indent=1)[:3000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
