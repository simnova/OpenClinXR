# Core Plan

## Evidence Now Proven

- `pnpm verify` is the full local gate for agent artifacts, TypeScript, tests, audit, and license policy.
- Quest 3 USB-C development loop is real: ADB sees the headset, port reverse works, Quest Browser loads the local XR shell, WebXR is visible, the canvas is nonblank, and trace controls advance.
- App-side frame telemetry exists through `window.__openClinXrFrameStats`.
- The Quest automated frame blocker is now precise: CDP reports the page as hidden/inactive, so the render loop records only the initial frame during the automated sample.
- Local hardware probing is repeatable and separates USB readiness from local model, local voice, and asset-pipeline readiness.
- The GLB conversion path is executable through pinned `gltf-pipeline@4.3.1` without introducing the `sharp`/LGPL dependency path that blocked `@gltf-transform/cli`.
- Mock model and mock voice benchmarks are recorded with zero-cost provenance.
- Manual Quest performance evidence has a template and validator.

## Remaining Blockers

- Foreground in-headset Quest performance is not proven. A manual report must confirm a foreground page, screencasting disabled, a 10-minute run, readable text, trace interaction, no console errors, average FPS at or above 72, p95 frame time at or below 25 ms, minimum FPS at or above 60, comfortable motion, and no heat concern.
- Local model execution is not configured. No Ollama, llama.cpp, or MLX LM runtime is detected, and local model environment variables are unset.
- Local voice execution is not configured. No VibeVoice runtime is detected, and local voice environment variables are unset.
- Blender is not installed, so the asset generation/bake path is not ready even though GLB conversion is.
- Clinical and psychometric production readiness still require expert review and validation studies outside the prototype.

## Next Sprint Recommendations

1. Keep the deterministic ED station and mock providers as the default demonstration path.
2. Capture the foreground Quest manual performance report before making headset comfort or frame-pacing claims.
3. Install Blender only when the asset-bake spike is intentionally scheduled; then add a small generated/optimized GLB bake report.
4. Install and benchmark one local model runtime on the target Apple Silicon machine only after model license and disk/runtime requirements are recorded.
5. Install and benchmark VibeVoice or an alternate local voice runtime only after voice safety and misuse review is recorded.
6. Keep `@gltf-transform/cli` out of the pinned dependency set until its transitive license posture is acceptable or an explicit exception is approved.

## Commands That Carry The Evidence

- `pnpm verify`
- `pnpm agent:benchmarks`
- `pnpm xr:quest:smoke`
- `pnpm xr:quest:manual:check`
- `pnpm local:runtime:probe`
- `pnpm local:provider:benchmark`
- `pnpm asset:gltf:smoke`
- `pnpm security:audit`
- `pnpm security:licenses`
