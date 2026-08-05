# MADR 0032: Source-First Packages vs TypeScript Project References

Date: 2026-08-05
Status: **Accepted (status quo affirmed) — with explicit revisit triggers**
Related: MADR 0026 (mongodb-memory-server local tests), issue #18, issue #12

## Context

An investigation into why grok's LSP `findReferences` returns only a declaration (1 result where
grep finds 19 across 6 files) surfaced a deeper structural fact:

- **40 package tsconfigs set `composite: true`, and 0 of 41 declare `references`.** The composite
  setup is therefore inert — `composite` exists *to enable* project references; with no edges it
  buys nothing while still writing `.tsbuildinfo`.
- Every package typechecks in isolation: `tsgo --noEmit -p tsconfig.json`.

A generator (`tools/openclinxr/tsconfig-references-sync.ts`, #18) was built to derive the reference
graph mechanically from `workspace:*` dependencies, mirroring upstream cellixjs. It derived **84
edges across 26 packages and found no cycles** — then applied **zero**, because TypeScript rejects
them: **TS6310 "Referenced project may not disable emit."**

The blocker is `"noEmit": true` in `packages/cellix/config-typescript/tsconfig.base.json`.

## Decision Drivers

1. Project references **require** referenced projects to emit declarations. This is not negotiable.
2. Our packages are **source-first**: `exports: { ".": "./src/index.ts" }` — consumers import
   TypeScript source directly and the bundler/vitest transpiles.
3. Upstream cellixjs is **build-emitting**: `exports: { types: "./dist/index.d.ts", default:
   "./dist/index.js" }`, `files: ["dist"]`, `build: tsgo --build`. Its reference graph works
   *because* it emits.
4. Typecheck cost today is 41 independent full typechecks; this grows with package count.
5. Changing the model affects every package, the bundlers, the test runners, and CI.

## Considered Options

**A. Keep source-first; do not adopt project references.** Accept isolated typechecks. Accept that
cross-package `findReferences` needs grep.

**B. Switch to build-emitting (the cellix model).** Remove `noEmit`, add `declaration: true`, emit
`dist/`, repoint every `exports` to `dist`, activate the 84 edges, gain `tsgo --build` incremental
builds and a real `.d.ts` contract between packages.

**C. Solution-style root tsconfig only.** A root config whose `references` enumerate all projects,
purely so tsserver can discover them. Does **not** require emit, so it is compatible with A.

## Outcome

**Option A for now — source-first is affirmed — with C as the open candidate for the LSP gap.**

Rationale: source-first removes an entire build step and a whole class of staleness bugs (no
"rebuilt dist not picked up"), which matters more at our current scale than incremental typecheck
speed. Option B is a large, cross-cutting migration whose main benefit (incremental builds) is not
yet a felt pain. Adopting B to fix an LSP ergonomics problem would be tail-wagging-dog.

The generator from #18 is **kept**: it is correct, re-runnable, has a `--check` gate, and correctly
declines to emit invalid config. It becomes immediately useful the day option B is chosen.

## Consequences

**Accepted costs**
- Cross-package `findReferences` stays unreliable; grep remains necessary for "who calls this".
  (`goToDefinition` / `hover` / `documentSymbol` DO work — see agentic-eval `docs/findings/lsp-liveness.md`.)
- Typecheck does not benefit from an incremental project graph.
- `composite: true` on 40 packages is currently meaningless. **Follow-up:** either remove it, or keep
  it deliberately as a marker for a future option-B migration — but do not leave it undocumented.

**Revisit triggers — adopt option B if any of these become true**
1. Full typecheck wall-time becomes a routine bottleneck in CI or the dev loop.
2. We need published/consumable packages outside this monorepo (external consumers need `dist`).
3. Cross-package refactor safety becomes a recurring source of defects that working
   `findReferences` would have prevented.

**Next experiment (cheap, independent):** try option C — a solution-style root tsconfig listing all
projects — and measure whether cross-package `findReferences` improves. It does not require emit and
does not conflict with this decision. Explicitly **not** done here to avoid confounding two changes.

`notEvidenceFor`: this records a build/tooling decision only. No runtime, learner, Quest, clinical,
or scoring claim.
