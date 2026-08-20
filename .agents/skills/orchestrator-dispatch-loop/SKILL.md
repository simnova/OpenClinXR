---
name: orchestrator-dispatch-loop
description: The CEO-side board loop — plant a RED, probe it, commit, dispatch, verify, integrate, close. Exact signatures and the traps that cost real time. Read before dispatching or harvesting a slice; the worker-side contract is delegated-worker-contract.
when-to-use: dispatch a slice, harvest a worktree, contract-verify-cli, integrate, merge-kill, briefFromIssue, factory_step, done_when, plant a RED, destructive probe, close an issue
---

# Orchestrator dispatch loop

The worker's obligations live in `delegated-worker-contract`. This is the parent's side.

## Order, every tick

**HARVEST first** — a returned dispatch blocks the write root. Then killed/maxTurns recovery. Then start a slice only if its write root is free.

## Signatures — get these wrong and you lose a tick

```ts
dispatch(repoRoot, options)                  // TWO args; not dispatch(options)
briefFromIssue(issue)                        // a BoardIssue OBJECT from `gh issue view --json number,title,body`
integrate({ repoRoot, base, head, slice, contract })
contractForSlice(repoRoot, slice, head)      // MUST be passed to integrate
```

`dispatch()` composes the role's charter via `buildRepoAgentSpawnPrompt` (`dispatch-worker.ts:561`) and **fails closed** on an empty appendix. `role` also resolves the model from `role-harness-policy` — passing a lower model without `modelDowngradeReason` throws (#461). **Never hand-pick a model.**

## Traps, each paid for

| trap | symptom | fix |
|---|---|---|
| runner script outside the repo | `Top-level await is not supported with the "cjs" output format` | wrap in `async function main(){…} main().catch(…)` |
| `integrate` without `contract` | `merge-kill: contract-not-verified`, refuses | pass `contractForSlice(root, slice, head)` |
| `## factory_step` wrong enum | brief refused: *"no valid factory_step line"* | one of `body_param clothing_consume clothing_generate motion_retarget lip_sync room_generate equipment_generate staging dialogue_runtime instrument`; `instrument` also needs `unblocks: <step>` |
| colon on `done_when` | brief refused | `## factory_step:` HAS a colon, `## done_when` has NONE |
| brief delta posted as a COMMENT | worker never sees it | the dispatcher reads `body` only — edit the body with `--body-file` |
| `exists:` under `.openclinxr/evidence/**` | passes in the worktree, never lands | gitignored; use a tracked path (`tools/openclinxr/evidence/…`) |
| plant not committed before dispatch | merge fails on *untracked working tree files would be overwritten* | commit the RED to main first |

## Planting a RED — clause hygiene the probe will otherwise teach you

- **A vacuity guard cannot live inside the `it.fails` it guards.** An `it.fails` is satisfied by ANY failure including the guard's own throw. Put length/population guards in a plain `it`.
- **A guard must not forbid the fix.** A clause asserting "the collision still exists" fails on every genuine repair.
- **Substring checks are prefix-matchable.** `includes("function requireRows")` still matched after a rename to `requireRowsDISABLED`. Assert the declaration with a regex AND that it is invoked.
- **`new Set([null, a, b]).size` counts the null.** Reject nulls before testing distinctness.
- **Floating point defeats a boundary.** `1.6669 - 1.6269 > 0.04` is TRUE. Derive bounds with headroom, from a constant already in the file.
- **Declare REDs vs NETS (#227).** When the deliverable is one artifact, every clause reading it is red on a clean tree — only a clause reading the TREE can be a true net. A clause that fails today is a RED even if you meant it as a net.

## Destructive probe — mandatory, and confirm two things

Run the honest treatment AND each cheap fix. For every treatment confirm **(a) the substitution matched** and **(b) the file still parses** — `Tests no tests` means it did not, and a grep for the inserted string will still succeed while the file is broken. Restore from a `.bak` and assert `git diff --stat` is 0 lines.

If the honest treatment does not flip the RED, **do not dispatch** — that is a brief whose proof cannot pass.

## Harvest

```bash
pnpm exec tsx tools/openclinxr/openclaw/contract-verify-cli.ts --slice issue-N --tree <worktree>
```

Then read the diff yourself. Check specifically that the worker **flipped `it.fails` → `it`** and did not weaken an assertion, and that any `## FIXED` block was appended rather than the planted header rewritten. Land ONE at a time. Grade pixels yourself for any appearance claim. Close with a CLAIM and a NOT TESTED line.

## Never clear the evidence directory of a slice with `exists:` proofs

`git clean -fdx .openclinxr/evidence` destroys the worker's deliverables and the pre-fix artifact, which cannot be honestly regenerated. Clear only the module's cache subdirectory, and run `contract-verify-cli` BEFORE any cache-cleared re-run.
