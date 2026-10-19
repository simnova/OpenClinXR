Source: operator (Patrick) drafts, 2026-10-19; installed by card hx-rules.
scope: every lane session, every dispatched worker, and Grok Bot as babysitter

# Standing approval for reversible moves

Don't stop and wait for Patrick when a move is reversible, local, and inside your own lane.
Do the move, log it (see §3), and keep going. Any move not listed in §1 still needs a live answer.
Single fast-forward owner is named in `agents/rules/GUARD_WORKTREE_PER_LANE.md`; this policy grants no lane a second one.

## 1. Pre-approved moves (do them, then log)

- **Back up before you change anything.** Copy the file into `.openclinxr/backups/<lane>/` before any edit, apply, merge or conflict resolution you didn't author yourself.
- **Keep stash entries.** Use `git stash apply`, never `pop` or `drop`. Leave the entry in place after it applies.
- **Apply by path.** `git checkout stash@{n} -- <paths>` is fine for existing entries over files you can prove are clean (no conflict, no uncommitted change in the target). Do not create new entries by path. Report the files you skipped.
- **Resolve conflicts by keeping the newer side** only when a stated check shows each of the other side's hunks found in the kept file; otherwise the case goes to the needs-Patrick list. Back it up first, and never use `git checkout -- <file>` or `git restore` on a file with uncommitted work.
- **Take the safe option after a timeout.** If you've asked Patrick an A/B question and he hasn't answered in **30 min**, choose the option that is most reversible and touches the fewest files. That is usually "show the diff", "apply the clean subset" or "do nothing yet". Don't pick an option on this policy's "still needs Patrick" list. Log the choice, then carry on with other work.
- **Commit your own files** on your own branch or in your own worktree (`/Volumes/files/...`, off `origin/main`). Stage by explicit path, never `git add -A` in a shared tree.
- **Push your own branch** (`wt/<lane>`) when every hook passes with no bypass. Only the single fast-forward owner named in `agents/rules/GUARD_WORKTREE_PER_LANE.md` fast-forwards main. A rejected or failing push is the end of that attempt. Report it and don't push again until something has changed.
- **Retry a timed-out hook with lower concurrency.** Use `TURBO_CONCURRENCY=2`, then `1`, and vitest `--maxWorkers=1`. Remember: until a heavy-job queue exists, one heavy job at a time. Allow at most 2 retries, and don't skip or shrink the test set.
- **Create worktrees and branches** for your lane, and park WIP as a commit on your own branch instead of a stash.
- **Re-run, queue or defer your own heavy jobs**, such as renders, bakes and benchmarks. Lower your own job's priority whenever you like.
- **Babysitter (Grok Bot):** may ask idle sessions questions, pass along a decision Patrick has already made, send the timeout default above to an idle lane, and write status or summaries. It must never type into a session that is mid-turn.

## 2. Still needs Patrick live (no timeout default, ever)

- `--no-verify`, `OPENCLAW_SKIP_HOOKS=1`, or any other way of skipping or editing a hook to get a push through.
- Deletes: files, branches, tags, worktrees, `.npz`/asset data, remote refs. Archiving or unarchiving sessions.
- Force-push, `reset --hard`, rebasing or amending pushed commits, `filter-repo` or other history rewrites, `stash drop/pop/clear`.
- Promoting a groom, or any asset or card to "golden" or shipped status.
- Spending money: paid models beyond the agreed tiers, cloud GPU, purchases or bookings.
- Killing or pausing a process that another lane owns.
- Any commit in the shared main checkout `/Volumes/files/src/openclinxr`. Path-limited applies there are allowed (see §1), but commits are not.
- Printing, copying or logging secrets or keys, and any change to credentials or `.env*`.
- Anything that goes out to people (issues, PR comments, posts, email), and anything §1 doesn't clearly cover. **If in doubt, it isn't covered.**

## 3. Log every policy move

- Append one JSON line to `$(git rev-parse --git-common-dir)/openclinxr-decisions.jsonl`. This file is shared by all worktrees and is untracked, so it's never committed.
  `{"ts":"<ISO-8601 with offset>","lane":"loco","actor":"locomotion-lite","rule":"timeout-default","question":"stash restore A/B","chose":"B: show diffs","alternatives":["A"],"backups":[".openclinxr/backups/loco/<file>"],"undo":"git checkout stash@{0} -- <paths>","refs":["<sha|stash@{n}>"]}`
- `undo` is required. If you can't write an exact undo command, the move isn't reversible, so stop and ask.
- Mention the move in one line in your next status report as well.
- The babysitter collects the last 24 h of entries into the morning summary under **"Decided under standing approval"**. Patrick may reverse any of them, and lanes carry out his reversal before starting new work.
