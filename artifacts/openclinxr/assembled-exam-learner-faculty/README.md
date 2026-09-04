# Assembled Exam Learner → Faculty Acceptance Harness

Local end-to-end acceptance evidence for the assembled exam path: a learner completes two
assembled stations (ED chest pain, peds asthma parent anxiety) with interleaved
patient / family / nurse actor turns through the public learner API, the API process is
restarted between stations, the run resumes from the durable file-backed sink, both note
forms are completed, and the immutable faculty assembled-review-packet is opened in the
Faculty Adjudication Workspace.

## Files

| Path | Role |
|---|---|
| `tests/openclinxr/assembled-exam-learner-faculty.spec.ts` | Playwright acceptance spec (serial): cross-projection identity assertions + real-browser faculty workspace check |
| `tests/openclinxr/fixtures/assembled-exam-two-station.json` | Approved two-station exam form + timing plan + per-station learner script (no invented clinical copy; reuse sourced in `provenance`) |
| `tests/openclinxr/helpers/assembled-exam-harness.ts` | tsx child harness: `server` (API over node:http + file sink), `client` (learner driver + API restart + faculty packet), `admin-serve` (ui-admin static + API proxy) |
| `artifacts/openclinxr/assembled-exam-learner-faculty/README.md` | This record |
| `artifacts/openclinxr/assembled-exam-learner-faculty/evidence/<run>/evidence.json` | Per-run evidence (gitignored): learner/API/persistence/faculty projections |

## How to run

```bash
# 1. Build gitignored package dist outputs once (node ESM resolution needs them)
pnpm exec turbo run build --filter='./packages/openclinxr/*'

# 2. Run the acceptance spec
pnpm exec playwright test tests/openclinxr/assembled-exam-learner-faculty.spec.ts
```

Requires a Playwright chromium browser (`pnpm exec playwright install chromium` if absent).

## What the spec asserts

Composition is proven through public surfaces only; no canonical trace, actor turn, note, or
durable reference is synthesized:

- Exam identity (`examRunId`, `learnerId`, `examFormId`, `blueprintId`) and station identity
  (`stationOrder`, `scenarioId`, binding `stationRunId`, session `stationRunId`) stay identical
  across the learner driver, the API responses, the durable files, and the faculty packet.
- Actor-local authored dialogue identity (seed binding + plan/execution ids) stays identical
  between the learner's actor-response results, the runtime ledger, the durable actor-turn
  store, and the packet's actor-turn provenance.
- Ordered canonical events (`encounter.started` → `encounter.ended` → `note.started` →
  `note.submitted` → `station.advanced`) match in the learner flow, the runtime ledger, the
  persisted exam-run aggregate, and the packet phase transitions.
- Note submissions (text, `submittedAtSecond`, `stationRunId`) match across learner, ledger,
  packet, and the workspace render.
- Durable refs (`durable://station-runs/...`) match across API decisions, the durable sink,
  the immutable packet GET, and the workspace.
- API restart between stations resumes the identical run decision from durable state.
- Blockers/omissions arrays are identical across the packet POST/GET, the durable packet file,
  and the faculty workspace render.

## Claim scope

Local acceptance evidence only. `examEquivalenceGate` is false everywhere, and the assertions
make no clinical-validity, scoring, exam-equivalence, Quest-readiness, or production claim.

## Not tested

Worn-headset interaction, real speech recognition, production auth, network partition
recovery, production MongoDB, and load remain outside this local acceptance run.
