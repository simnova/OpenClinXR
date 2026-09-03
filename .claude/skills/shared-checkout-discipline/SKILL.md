---
name: shared-checkout-discipline
description: "Load BEFORE authoring a file, editing a test, running a destructive probe, staging, committing, or arming a background monitor in this repo. /Volumes/files/src/openclinxr is a SHARED checkout with several agents in it at once — author and probe in your own git worktree and touch shared main only to commit a verified change. Also carries why a monitor must fetch and never pull, why it must not repair shared state, and the failure where a broken probe reads as progress. Every rule here is a measured incident, not a preference."
when-to-use: about to write a file, about to edit a test, destructive probe, break something to prove a contract, git add, git commit, arm a monitor, background watch, core.bare, my commit went missing, another agent's files, fresh worktree
---

# The checkout is shared. Your worktree is not.

`/Volumes/files/src/openclinxr` is one working tree with several agents in it — Claude, Grok,
Codex-driven workers, and a LaunchAgent monitor — often at the same moment. Every rule below cost a
real incident in a single session on 2026-09-03.

## Author and probe in your own worktree

```bash
git worktree add -B wt/<your-lane> /Users/patrick/.grok/worktrees/src-openclinxr/<your-lane> origin/main
cd /Users/patrick/.grok/worktrees/src-openclinxr/<your-lane> && pnpm install --frozen-lockfile --prefer-offline
```

A fresh worktree has **no `node_modules`**, and pnpm's store makes the install ~9 s. Skipping it is
how the monitor failure below happened.

It also has **no built packages**, and the pre-commit hook's `assets:reachability` step fails on
that with `Failed to resolve entry for package "@openclinxr/scenario-fixtures"` — an error that
names a `package.json` problem rather than a missing build, so it reads as a repo defect. One
`pnpm --filter @openclinxr/scenario-fixtures build` fixes it. Do this once when you create the
worktree, before your first commit, or the hook refuses work that is otherwise clean.

Touch the shared checkout only to commit and push a change you have already verified, and never
leave it dirty.

## Destructive probes are the sharpest case, and the easiest to rationalise

`contract-design` requires you to plant a violation and prove the contract catches it. Doing that in
the shared tree means deliberately breaking code other agents are reading and staging *right now*.
Measured, all four in one session, all in shared main:

| file | the break |
|---|---|
| `tools/openclinxr/openclaw/integration-lock.ts` | `flag: "wx"` -> `"w"`, removing the exclusive op marker |
| same | `installLock`'s atomic `renameSync` -> mkdir + per-file copy |
| `tools/openclinxr/openclaw/integrate.ts` | import rewritten to fake a fix |
| `apps/ui-xr/src/main.ts` | camera near plane `0.1` -> `0.001` |

Each was backed up, restored, and `git status` verified clean afterwards. That is luck, not
isolation: any agent staging during those windows picks up a knowingly broken lock. **Probe in the
worktree.**

## The shared index will hand your staged files to a peer

`git add` writes `.git/index`, which every agent in the checkout shares. Measured: a document staged
here landed inside commit `3cc21d14`, authored by another agent, alongside ten of their files. It
was not corrupted and nothing was lost — but the commit message describing it was theirs, and
`git log` cannot attribute between us because this checkout commits everything as one identity.

Stage and commit from your worktree. If you must commit in main, stage and commit in the same
breath and re-read `git show --stat HEAD` afterwards.

## `core.bare = true` recurs and blocks everyone

Some tooling writes `core.bare = true` into `.git/config`. Every work-tree operation for every agent
then fails with `fatal: this operation must be run in a work tree`. Measured twice: once on
2026-08-29 and again at 22:19 on 2026-09-02, mid-session.

```bash
git config --get core.bare        # detect
git config --unset core.bare      # a human-approved repair, from a foreground turn only
```

**A background monitor must report this, never fix it.** Unsetting it is a write to shared state
from an unattended process, which is the class of thing that caused the problem.

## Monitors: fetch, never pull; report, never repair

- **`git fetch` on the shared checkout. Never `git pull`.** A pull on a cadence can clobber a peer's
  untracked files — exactly what happened in the other direction when a peer's checkout operation
  reached files staged here. Reset *your worktree* to `origin/main` instead.
- **A monitor writes nothing to shared state.** No `git config`, no `git add`, no file repair.
- **A failing probe must not read as progress.** Measured, in a monitor written twenty minutes after
  this lesson was learned elsewhere: the watch ran `pnpm probe:reds` in a fresh worktree with no
  `node_modules`, pnpm exited non-zero, `grep -c` returned 0, and the condition `count < 5` fired
  "5 of 5 REDs flipped". Nothing had flipped. Assert the probe SUCCEEDED before reading its count:

```bash
out=$(cd "$WT/packages/openclinxr/motion-compiler" && pnpm probe:reds 2>&1)
if echo "$out" | grep -q "planted REDs fail for their own recorded reason"; then
  ...read the count...
else
  echo "PROBE ITSELF FAILED — not progress:"; echo "$out" | tail -2
fi
```

  This is the inverse of the `Monitor` tool's own "silence is not success" rule: here *noise* looked
  like success. Both come from a filter that cannot tell a broken instrument from a changed world.

## Do not reach for `timeout`

It does not exist on macOS. `PROTO_VERIFY_DELEGATION.md` has said so for weeks and it was still
reached for in this session. Use the harness tool's own timeout, or a bounded `for i in $(seq ...)`
loop with `sleep`.

## Related

`contract-design` for what a probe must prove; `measure-before-claiming` for not naming a cause you
have not measured; `agents/rules/orchestrator-only-main.md` for why the main session is a
coordinator rather than an implementer in the first place.
