# Worker session time split — 2026-09-29

Model: muse-spark-1.3-contributor. Method: `events.jsonl` phase
timeline (ms) for the model/tool split; `tool_completed`
`duration_ms` summed per tool over distinct `tool_call_id`;
terminal commands joined to `updates.jsonl` `tool_call`
`rawInput.command` for the class split; `retry_state` +
`turn_completed(stop_reason=rate_limit)` for rate-limit waits.

## Per session

| session | wall | model phase | model API | tool wall | tool resource | idle/other | tools | 429 retries | 429 turns | 429 lost |
|---|---|---|---|---|---|---|---|---|---|---|
| stage1-albedo-calibration/a | 1.7h | 56.3m | 1.1h | 47.5m | 53.9m | 3s | 221 | 0 | 0 | 0s |
| stage1-albedo-calibration/b | 2.7h | 2.2h | 2.1h | 28.8m | 21.1m | 3s | 363 | 20 | 2 | 12.3m |
| finish-floor-skirting | 1.9h | 1.5h | 1.4h | 27.8m | 22.9m | 4s | 288 | 2 | 1 | 4.5m |
| finish-door | 4.5h | 4.1h | 2.2h | 20.2m | 13.2m | 3s | 508 | 1 | 1 | 4.7m |
| ao-metal-measure | 2.1h | 22.4m | 16.8m | 1.7h | 1.7h | 3s | 125 | 2 | 1 | 4s |

## Aggregate (5 sessions)

Wall 12.9h; model phase 9.1h;
model API 7.1h; tool wall 3.8h; tool resource 3.5h; idle/other 15s; 1505 tool calls; 25 rate-limit retries, 5 rate-limited turns, 21.5m lost to rate limits.

Rate-limit loss is a subset of model-phase time: in-turn retry
backoff sits inside `waiting_for_model`, and post-rate-limit
restart gaps carry the last phase across the turn boundary.
All inter-turn restart gaps total 25.8m; non-429 overload (503/504) backoff totals 18.2m over 19 retries.

## Command-class seconds (resource time)

- terminal:sleep_poll: 1.8h
- terminal:blender_chain: 1.3h
- terminal:git: 12.3m
- terminal:pnpm_test_typecheck: 8.4m
- terminal:other_shell: 4.8m
- file:search_replace: 1.0m
- file:write: 5s
- terminal:uixr_capture_playwright: 4s
- file:read_file: 3s
- file:grep: 2s
- file:monitor: 0s
- file:list_dir: 0s
- file:todo_write: 0s

## Schema witnesses (one raw event per relied type)

`events.jsonl`: `ts, type=phase_changed/tool_started/tool_completed` (`tool_name, duration_ms, outcome, tool_call_id`); `updates.jsonl`: `timestamp, params.update.sessionUpdate=tool_call (`toolCallId, title, rawInput.command`) / retry_state (`type, reason`) / turn_completed (`stop_reason, usage.apiDurationMs, elapsed_ms`)`; `/tmp/dispatch-*.json`: first object (`num_turns, usage, stopReason`). Full witnesses in the `.json` companion (`schema_examples`).
