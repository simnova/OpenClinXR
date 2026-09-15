# Public-surface additive admission overlay handoff

Date: 2026-09-15  
Planning base: `4d5a93194071d34bbaa7c4930212452b1a4af2a3`  
Preserved motion candidate: `preserve/c1-land-a8ceb88c` (`a8ceb88c`)  
Programme: OpenClinXR humanoid motion / package public-surface reduction  
Claude manager: `sc-04-worker` (`agt_22e0234bfce08ecc`)  
Standing mailbox: `tsk_3f01d5bd55a00505`

Round-2 contract (Grok 4.6): overlay direction kept; injection, hash preimage, plant split, Vitest `--root`/`include`, and Model B activation are now binding.

## Outcome

Build the missing, additive review mechanism that can legally readmit a public symbol previously classified `remove`, or admit a genuinely new symbol, without rewriting a closed approval or regenerating the frozen global inventory. This is the acyclic prerequisite for replacing blocked cards MSC-C1 (`tsk_8d3e55209b513362`) and MSC-A3 (`tsk_216a587551a42e2e`).

The mechanism is an **admission overlay**, not a second full inventory snapshot. The global `raw-inventory.json` remains the covering snapshot for the closed PSR programme. A future explicitly allowlisted admission group carries only reviewed deltas tied to that frozen snapshot. Existing groups and files remain byte-identical.

## Why this is needed

C1 is behaviorally complete on the preserved ref, but its three required motion-compiler exports are already rows in the frozen inventory and are classified `remove` by `psr-01c`. Republishing them makes `requireApplied(psr-01c)` report extras. A3 cannot repair this by regenerating `raw-inventory.json`: all four closed approvals pin the same global `rawInventoryHash`, so regeneration invalidates all four. C1 and A3 also depend on each other.

Grok 4.6’s first adversarial pass rejected the initial per-group full-snapshot proposal. It found that a full snapshot would implicitly keep unclassified rows, would not alter the closed group’s extra detection, and would create a mix-and-match omission route. The accepted direction keeps the frozen global table and adds a narrow overlay with explicit conflict rules.

## Required design

### 1. Two registries, both allowlists (Model B)

- `REVIEW_GROUPS` remains exactly the four closed groups.
- Add `ADMISSION_GROUPS` in `apply-map.ts`, initially `[] as const` in the integrated tree.
- Admission ids are a **side table**, not apply ids. `resolveApplyId` does **not** gain admission ids. `resolveApplyId("psr-01f")` and `resolveApplyId("psr-99z")` stay undefined after this card.
- Unknown IDs remain unknown. Remove `requireApplied`’s file-existence fallback (`gates.ts:384-387`) that accepts an arbitrary `approvals/<id>.json` merely because the file exists.
- Production extra-subtraction, if any, iterates `ADMISSION_GROUPS` only. Never `readdir` the admissions directory. An overlay file whose id is not in `ADMISSION_GROUPS` is ignored.

### 1b. Fixture injection without a bypass

`requireApplied(root: string, id: string, report?: SurfaceReport)` **keeps that signature**. The third argument is already the compiler surface (`acceptance-criteria.ts:211`). Do not overload it as an options bag.

Fixtures call a new **same-module** helper, not published from any package `index`:

```ts
requireAppliedWith(root, id, { report?, admissionGroups: readonly string[] })
```

Production `requireApplied` is exactly `requireAppliedWith(..., { report, admissionGroups: ADMISSION_GROUPS })`. Tests import it the way `surface-meter.test.ts:6-12` imports `requireApplied` from `../../checks/public-surface/gates.js`.

Anti-bypass (live `it` after implementation): a well-formed `admissions/psr-ghost.json` in the fixture tree does not change production `requireApplied` extras, and `requireApplied("psr-ghost")` remains `unknown apply id`. `requireAppliedWith` with `admissionGroups: ["psr-ghost"]` is what makes the named extra disappear.

### 2. Overlay schema

A future overlay lives only under `docs/openclinxr/package-public-surface-reduction/admissions/<id>.json` (not created on this card) and contains:

- `schema: "openclinxr.psr-admission.v1"`
- `id`, equal to the allowlist id and filename stem
- `reviewedBy`, one document-level independent reviewer; every row’s `reviewedBy` must equal it
- `baseRawInventoryHash`, exactly equal to the frozen `raw-inventory.json` inventory hash
- `admissionHash`, recomputed at every gate from the canonical sorted overlay rows
- `packages`, unique `row.package` values; must equal `unique(rows.map(r => r.package))`
- `rows`, each with package, entrypoint, symbol, kind, disposition, owner, rationale, and `reviewedBy`

Hash preimage (sorted row keys, then sha256), **not** the four-tuple plus disposition alone:

`(package, entrypoint, symbol, kind, disposition, owner, reviewedBy)`

Do not add a sibling `*.review.json`. A second file written by the same worker is self-attestation (`completionFlag`, `gates.ts:284-296`).

The verifier refuses absolute paths, `..`, NUL, backslashes, paths outside the admissions directory, filename/id disagreement, malformed rows, stored-hash mismatch, reviewer equal to owner, row `reviewedBy` ≠ document `reviewedBy`, and `packages` that differ from the rows. A stored hash is never accepted without recomputation.

### 3. Conflict matrix

For the same `(package, entrypoint, symbol, kind)` key:

| Frozen disposition | Overlay disposition | Result |
|---|---|---|
| keep | any | refuse; no silent re-review |
| remove | keep | permit reviewed readmission when current tree publishes it |
| remove | remove/migrate | refuse |
| absent | keep | permit reviewed new-symbol admission when current tree publishes it |
| absent | remove/migrate | refuse |
| migrate | any | refuse |

An overlay may subtract only its approved keep/readmission keys from the closed group’s `extra:` failures. That subtraction lives **inside production `requireApplied`**, keyed by live `ADMISSION_GROUPS` (empty ⇒ identity). It may not replace the expected surface, classify an omitted symbol, or turn every row in a package into an implicit keep. With two extras and one admitted key, the other extra must still fail.

### 4. Legacy strength remains

- Closed approvals resolve only against the frozen global inventory.
- Their `rawInventoryHash` and `groupHash` checks stay intact.
- `requireAllReviewed` still verifies every closed group and does not iterate admission ids.
- Completion/self-attestation refusal remains.
- `resolveApplyId("psr-01f")` and `resolveApplyId("psr-99z")` remain undefined.
- No closed approval, raw inventory, baseline, ceiling, exception, or public package export changes in this prerequisite.

## Honest RED and proof design

Commit the plant **before** source edits. The plant may import only today’s exports: `requireApplied`, `resolveApplyId`, `REVIEW_GROUPS`. Do not import `requireAppliedWith` or pass a third-argument options bag (that argument is `SurfaceReport`; extra args fail `tsgo` because `src/**/*.ts` is typechecked).

Plant commit (only these `it.fails` / live `it` clauses):

1. `it.fails`: a well-formed fixture `approvals/psr-99z.json` currently makes `requireApplied("psr-99z")` enter the apply path; target detail is `unknown apply id`.
2. live `it`: a closed group classifies a published fixture symbol `remove`; without an overlay it remains an `extra:` failure (H4d shape).
3. live `it`: `resolveApplyId("psr-01f")` and `resolveApplyId("psr-99z")` are undefined; the five frozen byte pins match. Do not import or assert `ADMISSION_GROUPS` in the plant because it does not exist until the implementation commit.

Implementation commit adds `requireAppliedWith` and live `it(` clauses (never `it.fails`):

4. Independently reviewed overlay keep/readmission, via `requireAppliedWith` and a fixture admission id, removes only that named extra.
5. Two extras and one overlay row: the omitted extra still fails.
6. Overlay keep over a closed keep, owner=reviewer, wrong base hash, wrong overlay hash, id/filename mismatch, traversal/absolute paths, and the ghost-overlay anti-bypass all fail.
7. The four closed approval JSON files and global raw inventory retain their pinned byte hashes.

After implementation every clause is a live `it`. The Board `live:` proof requires zero `it.fails` clauses.

Place the behavioral test in `src/archunit-tests/public-surface/` so `pnpm architecture` executes it. The existing checks-tree test `a-new-reviewed-group-is-admitted-without-forging-a-closed-one.test.ts` remains a counterweight and must pass unchanged in meaning.

Vitest 4.1.5: `arch.config.ts` `include` is `src/archunit-tests/**/*.test.ts` relative to the **package** `--root`. Repo-root `--config …/vitest.arch.config.ts` with a `packages/…` filter collects **zero** files (measured). Use `--filter @openclinxr/architecture-rules exec` and package-relative paths.

## Frozen byte pins at planning base

- `raw-inventory.json`: `c37bea4199168cb11094db343e449e9da887e43d5c01e2c85fc24c16265446b6`
- `psr-01b.json`: `74e4fb9a76a42899212b79988668ba396e07314b31d0620518430200af37e335`
- `psr-01c.json`: `dfa31d1b9f37d5b54d34c3d2ecdd22abd97e6ddec808e48c4d307c2ee9afe1b1`
- `psr-01d.json`: `bd4d89908a9e5f64d7a29d3b13b2ba2b285de0ece210d41482cb9eee5073019a`
- `psr-01e.json`: `59b530c7490e2e6b095e42e47af160176964cb2594fa5952746d7477c542a228`

## Owner readiness sequence

The old A3 card `tsk_216a587551a42e2e` is Planted+blocked and owns `checks/public-surface`; its immutable root overlaps this replacement. It must become terminal before this card can be ready. The owner sequence is binding:

1. Commit this packet, create the replacement card Idle, and read back its immutable fields.
2. Only after the replacement task ID exists, cancel superseded A3 and comment it with the replacement ID. Never try to narrow A3's immutable root.
3. Leave C1 `tsk_8d3e55209b513362` Planted+blocked on its preserved candidate. It must not dequeue alone.
4. Message Claude on standing mailbox `tsk_3f01d5bd55a00505`, wait for its explicit ACK, then recheck reservations and immutable fields before Plant/exact claim.

## Worker execution sequence

1. Read this handoff and the live Board card.
2. Reconfirm main/base, reservations, and the five frozen byte pins.
3. Add the plant (clauses 1–3 only) in the archunit test tree; run it before source edits and record the semantic failure of clause 1.
4. Implement the empty allowlist, delete the file-existence fallback, add `requireAppliedWith`, overlay loader/validator, conflict matrix, and exact-extra subtraction inside production `requireApplied`.
5. Add live overlay clauses 4–7; flip only clause 1 from `it.fails` to `it`; preserve all counterweights.
6. Run the focused new suite, the existing admission suite, `pnpm architecture`, and the frozen-byte check.
7. Stop at Board `review`.

## Write roots

- `packages/openclinxr-verification/architecture-rules/src/checks/public-surface`
- `packages/openclinxr-verification/architecture-rules/src/archunit-tests/public-surface`

Inline the overlay loader in `gates.ts` (or `apply-map.ts` for the allowlist only). Do not add a third module unless the card `changed:` line names it. These roots are disjoint from Claude’s current SC-05 pose-source packet (`tools/openclinxr/evidence/scene-closure/proofs/sc-05`), its scenario-runtime scheduler planning, and its direct `docs/progress.html` cadence.

## Stop conditions

Stop and report instead of widening scope if the implementation requires:

- editing `raw-inventory.json` or `approvals/psr-01b.json` through `psr-01e.json`;
- adding `psr-01f` to either live registry, or teaching `resolveApplyId` to resolve admission ids;
- touching C1 product files, the preserved ref, package entrypoints, baselines, ceilings, criterion 6, exception records, or `docs/progress.html`;
- weakening extra detection, group hashes, independent review, self-attestation refusal, or unknown-ID refusal;
- listing the admissions directory as the production registry;
- overloading `requireApplied`’s third argument;
- exposing a verifier helper through an architecture-rules package `index`;
- relying on a missing file/import failure as the RED.

## Later work, not this card

After this prerequisite lands, a separately reviewed combined card activates `psr-01f` by **one allowlist append** plus `admissions/psr-01f.json`. No second resolver rewrite. That card consumes `preserve/c1-land-a8ceb88c`, routes motion-compiler tests through the supported entrypoint without raising the ceiling, regenerates capability-gateway’s architecture index, and lands the admitted product/API change together. Criterion 6 remains a separate fresh review.
