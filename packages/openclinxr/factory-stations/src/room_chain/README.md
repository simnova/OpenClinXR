# room_chain stage caching

`cache.ts` caches the output of each `room_chain` stage (`room_generate`
generate+bake, `room_clinic_finish`, `lighting_design`) under
`.openclinxr/cache/room-chain/<stage>/<key>/` (gitignored). The key hashes
every input that can change a stage's output: stage params, relevant env
(`OPENCLINXR_ROOM_REALISM`), the content hash of every script/python file
the stage runs, the applied Infinigen patch set plus the Infinigen source
commit, the Blender version string, and the upstream stage's key. `--no-cache`
forces a real run without reading the cache.

## D9 finding, 2026-09-28: `room_generate`'s Infinigen GENERATE step is not bit-deterministic run to run

RED4 (cached finish GLB vs a `--no-cache` forced-fresh run, identical
inputs, same cache key) found the two finish GLBs are NOT byte-identical.
Isolated the divergence to stage 1 (`room_generate`'s post-GENERATE
output, before any bake or finish work): two fresh generates with the
SAME seed (205) and identical inputs produced different bytes at the very
first stage, and that difference propagated downstream into the finish
GLB (one mesh, `Cube.003`, 7024 vs 7028 vertices; every baked-image
bufferView was byte-identical, so the divergence is purely geometric, not
a bake/material artifact).

This means the cache is doing exactly its job: it freezes ONE result per
key rather than papering over the pipeline's own nondeterminism. It also
means a naive "the cache proves the pipeline is deterministic" claim
would be wrong — the cache proves reproducibility of the CACHED artifact
given a fixed key, not determinism of the underlying generator.

**Not chased further in this job** (out of scope, per operator direction).
The 4-vertex divergence source inside Infinigen's GENERATE step is not
isolated. A follow-up job, if this ever matters for RED4-class byte-parity
claims, should isolate whether it's floating-point order-of-operation
drift, an uninitialized-state dependency, or a real seed-application bug.

Full RED4 detail and byte-level chunk analysis:
`docs/openclinxr/room-realism/room-chain-stage-cache/timing.json`.
