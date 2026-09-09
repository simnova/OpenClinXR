# Scene closure preparation package

**Status: prepared for review; no implementation released.** All new BothyBoard cards will remain Idle/backlog. This package changes planning documents only. The code baseline is `bb49e9675cba1f7edfe0f0fd80f798120f5bd46d`.

- [Acceptance contract](./acceptance.md): complete encounter, counterexamples, evidence/video, website and release boundaries.
- [Worker contracts](./tasks.md): eleven cohesive tasks with dependencies, roles, write scopes, existing regression entrypoints and mandatory new production-path evidence.

The board IDs and final review/verification record will be added after the package passes consultation. No task is represented as created until its MCP receipt and read-back exist.

## Why a new package

The earlier [implementation plan](../scene-layout-implementation-plan-2026-09-09.md) contains valuable component work but labels the whole prototype complete too broadly. Prior cards deliberately left readiness enforcement and startup ordering outside their tests. A new helper, an exposed readiness flag, or an injected walking capture cannot establish the end-to-end encounter. This package preserves those components and closes their actual producing/consuming paths.

Current source evidence: `initialSceneSpecPermitsPromotion` ignores non-ready runtime-owned states; its builder labels consumers by index parity; the live supported-placement caller does not pass exact mounted support observations; the approach executor is not connected to the normal learner workflow; displayed walk evidence injects a drive; the website is the existing static Pages site. These were rechecked against the current tree and prior commits during preparation. Broader clinical, headset and upstream model claims remain unverified.

## Dependency order and ownership

SC-01 establishes the persisted synthetic encounter. SC-02 integrates actual admission and scheduled effects. In parallel, SC-04 pins selected assets/rights; SC-00 then independently freezes the measurement rubric. SC-03 waits for admission plus the rubric and closes exact supported placement. SC-05 closes case-owned physician approach; SC-06 binds variation/replay to actual versions; SC-07 records and verifies the complete normal run; SC-08 builds its public-safe website presentation; SC-09 independently audits the whole outcome.

SC-10 is a separate research follow-up after SC-09. It does not block or replace the A01–A12 baseline demonstration. A research hold stays visible and is not mislabeled a measured model failure.

Most runtime integration is intentionally serial: main UI, shared schemas and package entrypoints overlap. SC-02 and the SC-04/00 branch can run concurrently only while their exact write roots remain disjoint. Lane labels never override overlap checks. Each worker gets a separate worktree, port and job-local evidence paths; integrate serially from reviewed commits.

## Release instructions (for a later explicit implementation request)

1. Confirm the acceptance/task revision and selected board project. Re-read the code baseline and recent commits; report changed assumptions rather than silently weakening a card.
2. Confirm all planning documents are reachable from the worker checkout. This preparation makes local documentation commits only; cross-host workers need the reviewed revision made reachable before release. Do not push main merely to distribute docs: qualifying pushes publish the whole docs tree.
3. Only after explicit release, the owner may plant the applicable root tasks under the board's normal protocol. Planting can make them immediately dequeuable; it is not a passive staging operation. Do not plant during preparation and do not mint worker sessions now.
4. Follow dependency and overlap gates; task tests must be extended to cover the actual outcome. Inspect before/after counterweights and producer/consumer evidence before landing. Do not land based solely on a command that already passed on baseline.
5. SC-09 keeps the parent open until all A01–A12 technical outcomes and website integration are directly verified. Public deployment, clinical usefulness and worn-headset readiness have distinct authorization/evidence boundaries.

No dormant implementation process, automatic wake, new team, worker lease or dequeue is started by these instructions. The only delegated activity during preparation is read-only plan/review consultation.

## Parent closure contract

SC-P owns A01–A12 and groups SC-00 through SC-09. It is a non-executable parent, not a substitute worker. It cannot close on child Landed statuses alone: SC-09 must independently retrieve and play source/site media, verify the full matrix against the same accepted run, repeat decisive controls and record remaining claim boundaries. SC-10 is a separate sibling research card after SC-09; a HOLD is visible and does not falsely establish a comparison or block the baseline demonstration.

The generated documentation registry registers these files but does not elevate them to protected policy. On later release, the frozen SC card explicitly incorporates the pinned acceptance and worker contracts; their authority comes from that owner-approved board contract, subordinate to repository policy. This is not a new autonomous control surface.
