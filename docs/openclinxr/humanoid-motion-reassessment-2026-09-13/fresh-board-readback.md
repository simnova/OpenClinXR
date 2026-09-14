I’ll audit the actual board read-back snapshot against the archived payloads, without a full board sync.**READY to hand the agent the package for ingestion.** Do not Plant or dispatch.

Live `tasks.get` of `tsk_7177631409c3d441` matches `board-task-snapshot.json` (sha256 `76033589…`). It is OpenClinXR `prj_9b390b99b443a964`, parent `tsk_e8ac84dd9cb6ac06`, **Idle/backlog**, no session, no assignee, empty proofs. Structured `doneWhen`, `writeRoots`, `fields` (`instrument` / `motion_retarget` / lane A), and objective equal the archived create payload. All three archived payloads remain equal.

Normalized body kept the ingestion gate, parent staging, registry-precedence/AUTHORITATIVE rule, clause (7) / `proofs.set` lifecycle, read-closure, and the three named failed-treatment facts as paragraphs under supported `deliverables` / `read_closure`. Custom headings were dropped by the board; the facts were not.

This audit did not `tasks.get` superseded `tsk_09d3ca349f40f120`. Manifest says cancelled. The receiving agent must get that id once and ignore it if anything other than cancelled.

**P1, not a recreate:** structured `failedTreatments` is `[]`. The three facts live only in the body. `## out-of-scope` on the card is the short structured string; the longer payload list (six blueprint files, eight-card release, generated assets, backend winner) is in the handoff, not the live card body. Brief the worker to read the full body plus committed `handoff.md` (already in `knownGood`).

Ingest: copy/commit package (including snapshot + manifest), record HEAD, unflip (2)(3)(7) in a throwaway copy, then the owner may Plant `tsk_7177631409c3d441` only. No second create.