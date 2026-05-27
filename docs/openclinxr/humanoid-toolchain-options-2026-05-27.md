# Humanoid Toolchain Options - 2026-05-27

## Decision
Anny should remain in the pipeline, but not as the whole pipeline. It is a strong open parametric human base. The evidence from OB screenshots shows it needs downstream refinement and/or alternate upstream clothing/body sources to reach higher realism.

## Local-first chain to try next
1. **Anny base mesh**
   - Keep as the controllable, all-age human seed.
   - Use for body profile, actor parameterization, repeatability, and licensing clarity.
2. **Blender post-Anny cleanup**
   - Accepted: weighted normals/smooth shading/export QA.
   - Rejected: naive sleeve/shirt scaling; screenshot evidence showed detached artifacts.
3. **MPFB / MakeHuman asset path**
   - Candidate for better clothing/hair/body presets through Blender.
   - Must pass license/provenance and generated GLB hash gates before runtime routing.
4. **MB-Lab path**
   - Candidate for more complete character generation in Blender.
   - Must be evaluated for Blender 5.x compatibility, license, export quality, rig/morph support, and WebXR runtime weight.
5. **Hunyuan3D / other 3D generative sources**
   - Candidate for props, equipment, and possibly clothing/mesh prototypes.
   - Do not promote directly as humanoid runtime source unless rig, topology, morph, animation, and license gates pass.

## Approval-required or caution paths
- Cloud 3D providers such as Meshy/Tripo/etc. remain disabled unless explicitly approved.
- Non-commercial topology/model paths must not be used for production-claim evidence.
- Auto-rigging tools are useful only if they preserve WebXR runtime constraints and produce verifiable clips/collision proxies.

## Next experiment order
1. Add a candidate-source preflight that scores any imported humanoid GLB directory against rig/morph/material/provenance/screenshot requirements.
2. Try MPFB/MakeHuman or MB-Lab locally through Blender as an alternate source generator.
3. Compare generated candidate screenshots against the current OB B+ source-variant screenshot.
4. Promote only if visual evidence improves without overlay masks or detached geometry artifacts.

## Evidence rules
- Source improvement requires WebXR-only screenshot evidence.
- Passing tests alone are not enough.
- Do not claim AAA humanoid realism, Quest readiness, production readiness, clinical validity, or scoring validity from toolchain experiments.
