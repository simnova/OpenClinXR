---
name: loop-continuation
description: Keep the autonomous loop alive with zero operator intervention. Re-arm the next wake at the END of every turn including notification-driven ones, publish a durable status BLUF every wake, audit your own background tasks, and land visible wins on the public surface in the same cycle. Read at the START of any turn you did not schedule yourself.
when-to-use: end of turn, task-notification, loop lapsed, keep going, why did you stop, ScheduleWakeup, re-arm, progress update, what is running, check your shells, orphan process, machine slept, website update, publish wins
---

# Keeping the loop alive

Found by auditing 318 operator messages for corrections. **This was the most repeated one, and no
existing skill covered it** - my skills all taught me to distrust workers and artifacts; the
corrections were about trusting my own loop to keep running.

## 1. Re-arm at the END of EVERY turn - no exceptions

Verbatim: *"keep going without my intervention - seems like you keep stopping"*, *"Why stop keep
going"*, *"are you still running - been a long time with no progress"*.

**The mechanism.** A turn driven by a task-notification - a worker finishing, a background command
completing - FEELS like an ending. It is not. If that turn ends without scheduling the next wake, the
loop is dead and the operator finds out before I do. I diagnosed this once and had to bake the fix
into my own standing prompt four separate times.

- The LAST action of every turn is the next wake.
- **Notification-driven turns re-arm too. Especially those.**
- "Nothing dispatchable right now" is not a stop condition - it is the cue to operationalize.
  Stopping is only for a genuinely empty or fully-blocked board, said in one line.

**Self-check at turn end:** *if the operator read nothing but the scheduler, would work resume without
them?* If no, the turn is not finished.

## 2. Status is a durable surface, not chat

The operator asked *"what is running"* / *"progress update"* **ten times in one session**. Every one of
those asks is a wake that failed to publish.

- Every wake writes a dated BLUF to the SSOT **before** doing anything else: in flight / landed since
  last wake / blocked and why / next.
- **If the operator has to ask what is in progress, the previous wake failed.** Treat the ask itself
  as a defect report against this skill, not as a request for information.

## 3. Audit your own background tasks every wake

*"check status of shells you have running - are some of them things that should be killed?"* - the
operator saw orphans I was not tracking.

- List live background tasks and long shells each wake; kill what is stale.
- **Kill means kill AND prevent re-spawn**: *"did you kill it and prevent it from spawning again?"*
  Verify the spawner is gone, not just the child. A job a loop relaunches next wake was not killed.
- Judge liveness by durable artifacts - log lines, file mtimes, CPU over a window. Never by `pgrep -f`,
  which matches its own command line and once reported RUNNING through a 9.5-hour stall. Mechanics:
  `grok-worker-monitoring` sections 1 and 5.

## 4. Recover after a sleep or an unexplained gap

On any wake following a gap, verify workers, dev servers and long jobs are still alive and still
writing **before** dispatching on top of them. Assume nothing survived.

## 5. Close the loop on visible wins - same cycle

The operator asked for website updates **five times**, including *"need to count wins to show
progress"*.

- A slice that lands something visible - asset, room, humanoid, rig - is **not closed** until the
  public surface reflects it. Part of the landing checklist, not a follow-up.
- Only graded, skeptic-passable images go public. A 26 KB error screenshot shipped as "evidence" once
  already. Grade first, publish second.
