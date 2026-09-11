# Review: package public-surface reduction program (PSR-P)

- Reviewer: Claude (Opus 5), 2026-09-10, at the operator's request.
- Addressed to: the author of the plan and the ten PSR cards (Codex planning review).
- Subject: `docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at `884cf555`, board
  parent `tsk_36cf3c2473ac953f` and its ten children.
- Tree measured at `07d21c30`.
- Status: review only. No card was changed, cancelled or recreated.

Verify each finding against the tree before acting on it. Every command used is in
[Reproduce](#reproduce). Where this review is wrong, say so on the parent card and I will correct it
here; peer review earns its place by being cheap to falsify.

## Bottom line

The plan is sound. The ten planted cards cannot deliver it as written, for three reasons that each
block the program on their own: the proof commands do not exist and no card may create them; every
implementation card's proofs pass on an empty change; and four of six implementation cards cannot
reach the consumers their objectives require them to migrate.

`done_when`, `writeRoots` and `depIds` are create-only on BothyBoard (`tasks.update` accepts them,
returns success and leaves them unchanged), so each correction is a new card plus a cancel.

## Findings, most severe first

### F1. The proof scripts do not exist, and no card may add them

`run:pnpm arch:public-surface:verify` appears in nine cards and `run:pnpm arch:public-surface:acceptance`
in PSR-09. Neither is in root `package.json`:

| script | root `package.json` |
|---|---|
| `arch:public-surface:verify` | MISSING |
| `arch:public-surface:acceptance` | MISSING |
| `packages:typecheck:agent` | exists |
| `hygiene:knip` | exists, exit 0 today |

No card lists root `package.json` in `writeRoots`. PSR-00 must create `arch:public-surface:verify` to
satisfy its own `run:` proof, and cannot without writing outside its roots. The same holds for PSR-09
and `acceptance`.

PSR-00 is Planted, `ready`, with no dependencies. It is not being dequeued at this moment only
because both of the project's in-flight slots are held by `tsk_298d0ead7dc551e4` and
`tsk_8b737c43e8e9cbc4`, both `Dispatched`/`review` since 2026-09-04 (maxInFlight measured at 2 on
2026-09-09 in a comment on the first card; not re-measured today). It is first in line when a slot
frees.

### F2. Every implementation card passes on an empty change

PSR-02 to PSR-08 carry some subset of:

- `exists:` on an evidence JSON the worker writes itself;
- `run:pnpm arch:public-surface:verify`, described in the plan as a shrink-only ratchet, which passes
  when nothing changes;
- `run:pnpm packages:typecheck:agent`, which passes when nothing changes;
- `run:git diff --check`, which passes when nothing changes.

The smallest diff that turns every proof green is one JSON file. Nothing requires a package's
exports to match the dispositions PSR-01 approved.

This is conditional on one thing: if PSR-00's verify were defined as inventory conformance, the
later cards would be red until they applied their dispositions. PSR-00's card does not require that,
so a PSR-00 worker has no reason to build it.

Proposed semantics, to be written into a recreated PSR-00:

- verify reads `contract-inventory.json` when it exists;
- for each package the inventory marks `migrated: true`, the package's compiler-resolved surface
  must equal the inventory's `keep` set exactly, and every `remove` symbol must be absent;
- packages not yet marked migrated are held only by the shrink ratchet.

Main stays green when PSR-01 lands. Each implementation card marks its packages migrated and is then
red until the tree matches. A card that marks nothing fails a second clause: its evidence JSON must
name at least one migrated package, checked by verify rather than by `exists:`.

### F3. Write roots were drawn around the package, and the migrations land on its consumers

Importing-file hits outside each card's `writeRoots`, found by module specifier (static `from`,
dynamic `import(`, `require(`). A file importing two of a card's packages counts twice. Specifier
search misses re-export chains and computed access, so these are floors.

| card | hits | inside roots | outside roots | outside, largest directories |
|---|---:|---:|---:|---|
| PSR-02 | 29 | 1 | 28 | `rest` 23, `apps/api` 5 |
| PSR-03 | 45 | 2 | 43 in 9 dirs | `scenario-runtime` 19, `rest` 6, `apps/api` 5, `ui-shared` 4 |
| PSR-04 | 34 | 31 | 3 | `ui-route-shared` 3 |
| PSR-05 | 98 | 3 | 95 in 20 dirs | `apps/ui-xr` 12, `ui-route-admin` 11, `data-mongodb` 7 |
| PSR-06 | 14 | 14 | 0 | none |
| PSR-07 | 165 | 73 | 92 in 11 dirs | `tools/openclinxr/evidence` 43, `xr-actor-dialogue` 19 |

An outside consumer matters only when the card must change it, which is whenever an import route
moves. PSR-03 ("consumer-oriented subpaths"), PSR-04 ("migrate atomically"), PSR-05 ("remove
root/subpath duplication") and PSR-07 ("facade objects over primitive cross-package imports") all
move routes. PSR-02 as written only removes unconsumed exports, so its 28 outside hits constrain
what it may remove and nothing more. PSR-06 is clean.

This failure has already happened once on this board. `tsk_8b737c43e8e9cbc4`'s worker wrote on
2026-09-04: *"no existing production caller can mount/enforce/persist it without crossing
writeRoots."* That card is one of the two holding the in-flight slots today.

### F4. Plan clause 11 did not reach the cards

Clause 11 requires affected package tests. PSR-02, PSR-03 and PSR-05 run typecheck only, while
narrowing `auth`, `telemetry`, `data-mongodb`, `graphql` and `asset-registry`. Clause 4 (zero
`unresolved`) and clause 3 (zero wildcard publication) are enforced only if verify happens to check
them, which PSR-00's card does not require.

### F5. The independent auditor can edit the meter it audits

PSR-09 shares `packages/openclinxr-verification/architecture-rules/src/checks` and
`tools/openclinxr/architecture` with PSR-00. Clause 12 asks for independent closure; independence
here is a write-root property, and it does not hold.

### F6. PSR-01 is one card for 3,020 classifications

The plan's own count is 3,020 unique per-package symbols, each needing a disposition, route,
purpose, owner and rationale. At that size a worker will fall back on bulk rules such as "has a
consumer, so keep", which the plan rejects as proof. A per-package split, or a PSR-01 that produces
the inventory mechanically and leaves only the non-trivial rows for judgment, is more likely to
land.

### F7. Scheduling

- Lanes are swapped relative to `agents/rules/PROTO_BOARD_LOOP.md` (A = learner-facing/XR, B = API/admin).
  PSR-04 (REST) and PSR-06 (Admin UI) are A; PSR-07 (XR) is B. Lanes drive concurrency pairing.
- `factory_step: staging` is on PSR-01 to PSR-08. In this schema `staging` is the scene-placement
  station.
- PSR-08's write root is all of `packages/openclinxr`. While it runs, no other package card on the
  board can be dispatched.
- PSR-02 waits on `tsk_132814927d8ec7f9` (faculty debrief) and PSR-06 on `tsk_9932065e3e226445`
  (faculty assessment), both Planted and untouched since 2026-09-04. The assessment card's upstream
  is `tsk_298d0ead7dc551e4`, one of the two slot holders. PSR-03 waits on two motion cards. Every
  card except PSR-00, PSR-01 and PSR-05 is queued behind unrelated product work.

## Suggested corrections

| card | change |
|---|---|
| PSR-00 | add root `package.json` to `writeRoots`; specify verify as in F2; add a counterweight fixture proving consumer discovery finds a known consumer (see [the trap](#a-trap-this-review-hit)) |
| PSR-01 | split per package group, or generate mechanically and review only non-trivial rows |
| PSR-02, PSR-03, PSR-05 | add the affected package test runs |
| PSR-03, PSR-04, PSR-05, PSR-07 | widen `writeRoots` to the consumer directories in F3, or restate the objective as removal-only |
| PSR-08 | narrow `writeRoots` to the packages no earlier card owns |
| PSR-09 | move acceptance to its own directory, disjoint from PSR-00's meter; add root `package.json` |
| all | fix lanes; decide whether the faculty-debrief and faculty-assessment dependencies are needed |

## How this review was done, and what that perspective adds

The plan is written from the program designer's position: what should be true at the end, and what
gaming to prevent. This review read the same material from other positions. Each is cheap, and each
surfaced something the designer's position does not.

1. **The worker at turn one.** The governing comment says *"the planted task body remains the
   execution contract."* So simulate the dispatch: a worker holding only the card body, a worktree
   and its write roots. For each `run:` proof, resolve the command in `package.json`. For each file
   the worker must touch to make that proof pass, check it lies inside `writeRoots`. F1 took one
   command.

2. **The laziest worker.** The plan's anti-gaming catalogue (namespace wrapping, facade indirection,
   package splitting, subpath relocation) describes a worker trying hard to hit a number. It does
   not cover the worker that does nothing, which is always the cheapest pass. For each card, write
   down the smallest diff that turns every proof green. If the answer is "one JSON file", the proofs
   do not measure the objective. Prose in the plan does not bind; only `done_when` lines are
   evaluated. That gave F2.

3. **The import graph.** Roots were drawn around the package being narrowed, but narrowing moves
   import routes in the packages that consume it. Compute consumers by module specifier and
   intersect them with `writeRoots`. That gave F3. The board already had one card fail this way,
   which a read of its comments would have shown.

4. **The board, not the diagram.** The plan's graph shows PSR-to-PSR edges and says the board is
   authoritative. Reading each dependency, then each dependency's dependencies, for `status` and
   `updatedAt` showed most of the program waiting on product cards untouched for six days, one of
   them holding an in-flight slot.

5. **Plan-to-card diff.** The plan has twelve completion clauses; the cards compress them into three
   to six proof lines each. For every clause, name the proof line that enforces it. Clauses with no
   line are the gap: F4.

6. **Independence is a write-root property.** An auditor is independent when it cannot write what it
   audits. Check root overlap between the producer and the auditor: F5.

7. **Schema semantics.** Board fields carry repo-defined meanings. A required field used as a free
   label misroutes concurrency pairing: F7.

## Where the author's method was stronger

- The compiler-backed baseline: 46 packages against the regex meter's 42, the four arena packages it
  misses, the 79 extra root symbols in `rest` and `ui-route-admin`, and `export type *`. This review
  did not reproduce it and relies on it.
- The anti-gaming catalogue and "counts are review signals, not success". They are right; they need
  to move from prose into proofs.
- Keeping the legacy regex series as a trend instead of erasing the 2,931-to-2,121 history.

## A trap this review hit

The first consumer count used `\s` inside `git grep -E`. That class does not match here, so only
`import("…")` and `require("…")` calls without a space were found. It reported PSR-05 at 3 outside
hits; the correct number is 95. The error was caught because PSR-02 read zero consumers for
`telemetry`, which is implausible next to the rest of the population. Confirmed on a one-line
fixture: `from\s*"@x` matches 0 lines, `from[[:space:]]*"@x` matches 1.

This bears on PSR-00 and PSR-01 directly, because both build consumer discovery. A search that
silently matches nothing reads as "no consumers", and "no consumers" converts straight into
`remove`. The plan already says identifier search is only a lead; this is a measured instance of
the failure it anticipates. A PSR-00 fixture that must find a known consumer closes it.

## NOT TESTED

- The plan's baseline counts were not re-measured.
- Consumer counts are specifier-based floors (re-export chains and computed access are missed; a file
  importing two of a card's packages counts twice).
- The existing `rootEntrypointExports` / `starExports` ceilings in
  `architecture-rules/src/archunit-tests/packages-publish-an-interface.test.ts` were located but not
  analysed against plan clause 7.
- The project's maxInFlight was not re-measured today.
- No card was dispatched.

## Reproduce

```sh
# F1: do the proof scripts exist?
for s in arch:public-surface:verify arch:public-surface:acceptance packages:typecheck:agent hygiene:knip; do
  node -e "const p=require('./package.json');console.log('$s', p.scripts['$s'] ? 'exists' : 'MISSING')"
done

# F3: consumers of one package outside a card's roots (note [[:space:]], not \s)
git grep -lE "(from|import\(|require\()[[:space:]]*['\"]@openclinxr/asset-registry(/[^'\"]*)?['\"]" \
  -- '*.ts' '*.tsx' '*.mts' '*.cts' '*.js' '*.mjs' '*.cjs' \
  | grep -v -e '^packages/openclinxr/asset-registry/' -e '^tools/openclinxr/factory/' | wc -l

# the \s trap
printf 'from "@x/y"\n' > /tmp/g.ts
git grep --no-index -cE 'from\s*"@x' /tmp/g.ts          # 0
git grep --no-index -cE 'from[[:space:]]*"@x' /tmp/g.ts # 1
```

Board state was read with `bothy-board_tasks_get` on the parent, each child, and each external
dependency.
