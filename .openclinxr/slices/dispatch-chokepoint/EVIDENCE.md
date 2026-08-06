# dispatch-chokepoint evidence

Generated: 2026-08-06T02:48:25.567929+00:00
Worktree: `/Users/patrick/.grok/worktrees/src-openclinxr/dispatch-chokepoint`

## What was built (minimum)

- PreToolUse shell hook `.grok/hooks/dispatch-chokepoint.json` → `tools/openclinxr/openclaw/dispatch-chokepoint.ts`
- Mechanical refuse of raw headless `grok -p` / `--single` / `--prompt` on Bash|run_terminal_command
- Named logged escape: `OPENCLINXR_RAW_GROK_SANCTIONED=1` + non-empty `OPENCLINXR_RAW_GROK_REASON`
- Workers (`OPENCLINXR_WORKER=1`) never receive the escape
- `dispatch()` remains the spawn path (`spawn(binary, argv)` — never enters PreToolUse)
- Architecture invariant `checkDispatchChokepointWired` so deleting the wiring fails `pnpm architecture`

**Mechanism class (honest):** string matcher over shell-tool command text. Not an OS sandbox; not a process boundary against same-uid hostiles.

## CONTROL arm — bypass attempt refused

### A. Orchestrator session, no sanction

```bash
env -u OPENCLINXR_WORKER -u OPENCLINXR_RAW_GROK_SANCTIONED \
  pnpm exec tsx tools/openclinxr/openclaw/dispatch-chokepoint.ts --probe \
  --command '~/.grok/bin/grok -p "isolation control"'
```

- exit code: **2** (expect 2)
- output:

```
{
  "decision": "deny",
  "matched": true,
  "reason": "REFUSING raw headless `grok -p` / `--single` that bypasses dispatch(). Layers 3–6 (task contract, diff-class, merge-kill, loop-pause) hang off tools/openclinxr/openclaw/dispatch-worker.ts `dispatch()`. Use dispatch() (or pnpm openclaw:dispatch when wired). Orchestrator isolation-probe escape: OPENCLINXR_RAW_GROK_SANCTIONED=1 and non-empty OPENCLINXR_RAW_GROK_REASON=<why> (named + logged). CLAIM: string matcher over shell-tool command text — not an FS sandbox."
}
(node:64654) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `pnpm --trace-warnings ...` to show where the warning was created)
(node:64655) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:64661) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
```

### B. Worker session cannot self-sanction

```bash
OPENCLINXR_WORKER=1 OPENCLINXR_RAW_GROK_SANCTIONED=1 OPENCLINXR_RAW_GROK_REASON=worker-self-sanction \
  pnpm exec tsx tools/openclinxr/openclaw/dispatch-chokepoint.ts --probe --command 'grok -p hi'
```

- exit code: **2** (expect 2)
- output:

```
{
  "decision": "deny",
  "matched": true,
  "reason": "REFUSING raw `grok -p` from OPENCLINXR_WORKER=1. Workers must not re-spawn headless grok outside dispatch() — contract, baseline, proofs, and loop-pause would all be skipped. Use the parent orchestrator's dispatch() path instead."
}
(node:64662) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `pnpm --trace-warnings ...` to show where the warning was created)
(node:64663) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:64670) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
```

### C. PreToolUse stdin shape (hook harness contract)

```bash
echo '{"toolName":"run_terminal_command","toolInput":{"command":"grok -p hi"}}' \
  | pnpm exec tsx tools/openclinxr/openclaw/dispatch-chokepoint.ts
```

- exit code: **2** (expect 2)
- output: `{"decision":"deny","reason":"REFUSING raw headless `grok -p` / `--single` that bypasses dispatch(). Layers 3–6 (task contract, diff-class, merge-kill, loop-pause) hang off tools/openclinxr/openclaw/dispatch-worker.ts `dispatch()`. Use dispatch() (or pnpm openclaw:dispatch when wired). Orchestrator isolation-probe escape: OPENCLINXR_RAW_GROK_SANCTIONED=1 and non-empty OPENCLINXR_RAW_GROK_REASON=<why> (named + logged). CLAIM: string matcher over shell-tool command text — not an FS sandbox."}
(node:64697) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `pnpm --trace-warnings ...` to show where the warning was created)
(node:64708) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:64718) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)`

## TREATMENT arm — sanctioned path still works

### 1. Named orchestrator escape (isolation probes need path denies OFF)

```bash
env -u OPENCLINXR_WORKER \
  OPENCLINXR_RAW_GROK_SANCTIONED=1 OPENCLINXR_RAW_GROK_REASON=isolation-probe-treatment-arm \
  pnpm exec tsx tools/openclinxr/openclaw/dispatch-chokepoint.ts --probe \
  --command '~/.grok/bin/grok -p "isolation treatment"'
```

- exit code: **0** (expect 0)
- output:

```
{
  "decision": "allow",
  "matched": true,
  "sanctioned": true,
  "sanctionReason": "isolation-probe-treatment-arm",
  "reason": "Sanctioned raw grok escape (OPENCLINXR_RAW_GROK_SANCTIONED=1, reason=\"isolation-probe-treatment-arm\"). Logged when repoRoot is provided. Isolation probes and explicit orchestrator escapes only."
}
(node:64671) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `pnpm --trace-warnings ...` to show where the warning was created)
(node:64672) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:64678) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
```

Hook stdin with sanction:

- exit code: **0** (expect 0)
- output: `{"decision":"allow","reason":"Sanctioned raw grok escape (OPENCLINXR_RAW_GROK_SANCTIONED=1, reason=\"isolation-probe-treatment-arm\"). Logged when repoRoot is provided. Isolation probes and explicit orchestrator escapes only."}
(node:64791) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `pnpm --trace-warnings ...` to show where the warning was created)
(node:64806) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:64812) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)`

### 2. Existing non-raw callers still allow

```bash
echo '{"toolName":"run_terminal_command","toolInput":{"command":"pnpm openclaw:run-next"}}' \
  | pnpm exec tsx tools/openclinxr/openclaw/dispatch-chokepoint.ts
```

- exit code: **0** (expect 0)
- output: `{"decision":"allow","reason":"not a raw headless grok (-p/--single) invocation"}
(node:64746) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `pnpm --trace-warnings ...` to show where the warning was created)
(node:64753) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:64790) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)`

### 3. `dispatch()` API path

`dispatch()` uses `spawn(~/.grok/bin/grok, buildArgv(...))` and never passes through the shell PreToolUse matcher. Unit test suite (includes control/treatment + buildArgv still `-p` first):

```
(node:64840) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  22:48:25
   Duration  176ms (transform 62ms, setup 0ms, import 42ms, tests 44ms, environment 0ms)
```

CLAIM: A PreToolUse string matcher over shell-tool command text refuses raw headless `grok -p`/`--single`/`--prompt` (exit 2 + deny JSON) unless `OPENCLINXR_RAW_GROK_SANCTIONED=1` and a non-empty `OPENCLINXR_RAW_GROK_REASON` are set on an orchestrator session, never when `OPENCLINXR_WORKER=1`; existing non-raw `pnpm openclaw:*` shell lines still allow; architecture fails if the hook/source/tests are removed.
NOT TESTED: A determined same-uid process that never puts those tokens in a shell-tool command string — `node -e`/`child_process.spawn` of the grok binary, a helper script whose contents are not the shell line, renamed binaries, or any path outside Grok PreToolUse — is not stopped; there is no in-process detector that holds against a hostile peer sharing your uid.
