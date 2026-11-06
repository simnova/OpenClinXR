# xr-sync learnings (C1-C25)

Each line cites the slice or file that measured it. Ledger: .openclinxr/handoffs/xr-sync-colyseus.md.

## Quest transport
- The headset reaches the host through `adb reverse tcp:<http>` and `tcp:<sync>`, never the LAN. The harness removes both reverses and `adb forward tcp:9222` in a finally block (C2, harness-lib.mjs runQuestProbe); a connect failure once leaked tcp:54054/54055 (2026-10-30).
- Launch with a VIEW intent to com.oculus.browser, wait for the devtools socket, forward `tcp:9222` to `localabstract:chrome_devtools_remote`, attach by exact URL. Oculus Browser refuses Target.createTarget, so `newPage()` fails (C2).
- Detach over CDP, never `browser.close()`: it kills the on-device browser. Close only the target the run opened (C2).
- Pass criterion for transport: `adb reverse --list` and `adb forward --list` are empty after the run (C2-C25 harnesses).

## Bind and URL
- `createEncounterServer` binds 127.0.0.1, not the wildcard. A wildcard bind let another lane's HTTP server take 127.0.0.1:<port> and the join failed with MatchMakeError "Method Not Allowed" (xr-sync-loopback-bind.test.ts, 2026-10-30).
- The sync URL is `ws://127.0.0.1:<port>`. Portless allocates the port; the proxy drops plain ws:// and carries no UDP, so clients dial the port directly (portless-dev-run.mjs).

## Scripted input
- Host and Quest run the same IWER script. Host refuses a native XR runtime; Quest passes `forceIwer=1` to install the emulator over the native one. This is emulation, not a native Quest XR claim (C2, sync-probe.ts).
- Every wait in a script keys on observed server state (snapshot fields), never on a timer, so a slow headset does not change the order of intents (C3).
- The production shell (C25) takes intents from `window.__openClinXrEncounterSync.sendIntent`, driven over CDP. Its page main thread renders the scene, so an ack can miss the client's 5 s intent timeout under load; the harness treats a client-side error as non-reject and reads the turn from state.
- Server `turnId` restarts in each station room, so a client keys turn de-duplication on (station, actor, turnId) (C25 grade-01).
- The SDK replays a snapshot before the first patch fills `actors`; consumers must tolerate `actors` undefined (C25).

## Bundle sentry
- The thin client must not carry the server package, `@colyseus/core`, or reply text. `collectBundleSentry` greps the built chunks reachable from the page entry (C3, C23 T5). The shell (C25) checks every built chunk for `@openclinxr/xr-sync-server`, `@colyseus/core`, and a server-only authored line; it cannot grep seed lines because scenario-fixtures is bundled for its own use.
- Load the client through the `./headset` subpath; `.` is the package-consumer entry and mixing them trips the consumer-contracts gate (headset.ts).

## Review-safe trace
- A persisted trace holds no learner sessionId, no utterance text, no reply text, no timestamps. It records actor-agnostic intent events and replay ids (C4, conversation-trace.ts).
- Affect is a 4-value enum, not text (C24). Captions and topic answers live in the live room only and never enter the trace or the review index (C23 T4).
- The trace is a pure reduction (`reduceConversationEvents`); the room and replay share it, so a persisted file replays to itself (C4).

## Dev stack speech (C34)
- `pnpm --filter @openclinxr/xr-sync-server dev:portless` boots the faster-whisper sidecar (venv /Volumes/files/openclinxr-assets/stt/venv, tools/openclinxr/evidence/xr-sync/stt/transcribe.py) and prints `xr-sync speech ready model=<m>` or `xr-sync speech unavailable: <reason>` before the listening line. Env: XR_SYNC_STT=off, XR_SYNC_STT_PYTHON, XR_SYNC_STT_SCRIPT, XR_SYNC_STT_MODEL. A missing recognizer never stops the server; room state `speechAvailable` tells the shell to hide push-to-talk.

## Push
- Push to main only through jobs/push-main.sh: it takes `/private/tmp/openclinxr-push.lock` (mkdir), waits for 5-min load < 45, and removes the lock only if it created it. Exit 3 means main moved on lane paths: rebase, re-run suites and the host harness (ledger, push-lock rule 2026-10-31).
- Never `--no-verify`, never commit in the shared checkout. In a fresh worktree build `@openclinxr/model-vetting` before committing or typecheck:stations reports 4 false errors (C24).
- pre-push runs the architecture gate and affected package tests; a failing sha check in another lane's package blocks the push until that lane re-pins (C24).
