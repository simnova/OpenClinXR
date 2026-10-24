# Native Phase2 (held, unexecuted by worker)

Owned writer scope only: `graph.mjs`, `graph-ownership.mjs`, `test_graph.mjs`,
`run_graph.py`, `test_run_graph.py`, `verify_host.py`,
`graph-config-template.HELD.json`, plus `README-phase2.md` /
`phase2-delivery.json`. Phase1 `profile.py` / `browser-version.mjs` /
`source-manifest.json`, frozen source/actual data, and browser assets are
unchanged. No commits, no ROOT writes, no device/browser execution here.

Authority fix: `observedProfile` is the approved independent authority doc
(nested `profile`, `graphGo: false` — profile metadata never authorizes the
graph); `rawProfile` is the successful `profile-observation.json`. Preflight
joins `authority.profileObservation.sha256` / `planSha256` /
`sourceManifestSha256` to config shas, binds nested serial/model/osBuild/
product/protocol/revision/UA/jsVersion/packageUid plus exact raw package
lines (no substring logic, no causal claim). Live gates re-observe
model/build/UID/currentPID once: stable fields plus BOTH fresh HTTP Browser
and CDP product+UA must match the approved profile; currentPID is nonempty
metadata only (old 7807 never required). ROOT stays absolute
`/Volumes/files/src/openclinxr`. Playwright 1.59.1 `connectOverCDP` close
is `transport.closeAndWait` (owned connection only).

`run_graph.py` is the external 45s parent (46s rejected): `--config` host
preflight without `--execute` never consumes the control output (no
device); with `--execute` it shares the absolute wall deadline via
`QUEST_NATIVE_PARENT_DEADLINE_UNIX_MS`, spawns the exact node child in its
own process group, captures pipes bounded (selectors/nonblocking, 65536
per-pipe cap, surplus discarded while draining), kills only the owned
process group on timeout, waits just the reserve, closes pipe ends even if
a descendant holds them open, and fsyncs one-shot `graph-control-actual-01`
plus `final-clock.json`. Timeout stays unqualified, preservation UNKNOWN.
The child requires the bounded parent deadline with `--execute` and derives
all budgets from min(45s, wall remaining minus 1s); all durable artifacts
use explicit fsync with directory fsync after creates. Human freshness stays
false until the exact actual new reply after all reviews (bound release
`2026-10-17T04:34:07.757811Z`).

Parent launches the child with explicit `--import` of the canonical installed
tsx loader (`node_modules/.pnpm/tsx@4.21.0/.../dist/loader.mjs`, root-verified,
no downloads) for both preflight and execute; node/loader/argv/loader-sha256
are recorded in the source-bound launch receipt. Test budgets satisfy
0<whole<=45 (production run is fixed 45s); final-clock success is qualified by
elapsed measured after the final-clock fsync, with the root external call
clock as final authority. `verify_host.py` runs the exact host gates only and
prints one JSON receipt; full positive preflight is intentionally not run by
verify (it needs root-issued docs/lease/fresh output — no fabrication, no
false coverage).

HELD launch (root only, after fresh actual human readiness post-preparation +
independent operator release + separate root ONE graph GO + fresh independent
review of all source changes):
`python3 -B run_graph.py --config <root-issued-config> --execute`
Host verify first: `python3 -B verify_host.py` (root saves its JSON stdout).
No GO/readiness fabricated; human stays UNKNOWN until the fresh actual reply.
