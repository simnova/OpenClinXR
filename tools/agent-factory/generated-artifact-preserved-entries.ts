import type { PreservedRegistryEntry } from "./registry-shrink-guard.ts";

/**
 * Paths the scan cannot reproduce. Each reason is path-specific; a single
 * sentence covering all of them is the failure mode this list exists to avoid.
 *
 * Not a scan-root widen: `public/generated-humanoids` would add 81 files (measured
 * 2026-09-13); `.webm` would add 4 videos under `docs/openclinxr/videos`; `tools/`
 * would sweep source; `.md` collides with the doc-authority registry.
 */
export const GENERATED_ARTIFACT_PRESERVED_ENTRIES: readonly PreservedRegistryEntry[] = [
  {
    path: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    reason:
      "Promoted MPFB2 runtime cast under public/generated-humanoids, which scannedRoots does not walk (only public/xr-assets).",
  },
  {
    path: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.provenance.json",
    reason:
      "Lineage sidecar for the same promoted cast; same directory miss as the GLB, not a generic JSON keep.",
  },
  {
    path: "docs/openclinxr/model-vetting-captures/mpfb-peds-parent-aisha_motion-bind_body_motion_probe_2026-08-22.webm",
    reason:
      "Motion-bind body_motion probe already under scannedRoot docs/openclinxr; generatedExtensions omits .webm and must not gain it (other docs videos would batch-enter).",
  },
  {
    path: "tools/openclinxr/evidence/blender/render_seated_clip_frames.py",
    reason:
      "Hand-authored Blender producer for seated-clip frames, not generated output; tools/ is not a scan root.",
  },
  {
    path: "tools/openclinxr/evidence/humanoid-vetting/render-tex-candidates.py",
    reason:
      "EEVEE isolated texture-candidate renderer with a black-frame extrema guard — a different producer than the seated-clip script.",
  },
  {
    path: "tools/openclinxr/evidence/humanoid-vetting/tightjeans-2048-q85.jpg",
    reason:
      "Texture-resize candidate (JPEG q85 2048²) used as the visual comparison; .jpg is a generated extension but the file lives under tools/.",
  },
  {
    path: "tools/openclinxr/evidence/humanoid-vetting/tightjeans-rebake-2026-09-12.md",
    reason:
      "Dated tightjeans rebake evidence note; .md must not join generatedExtensions (doc-authority collision).",
  },
  {
    path: "apps/ui-xr/public/generated-humanoids/mpfb-gown-ed-robert-hayes.glb",
    reason:
      "Local runtime candidate ED gown cast under public/generated-humanoids, which scannedRoots does not walk (only public/xr-assets); kept as a pre-commit candidate, not a promotion claim.",
  },
  {
    path: "apps/ui-xr/public/generated-humanoids/mpfb-gown-ed-robert-hayes.provenance.json",
    reason:
      "Lineage sidecar for the same local ED candidate; same directory miss as the GLB, not a generic JSON keep.",
  },
];
