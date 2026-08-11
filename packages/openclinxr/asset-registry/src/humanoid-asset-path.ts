/**
 * Single predicate for "is this a runtime humanoid asset path?" (#313).
 *
 * The capture suite used to recognise a runtime humanoid by the folder it sits
 * in (`assetPath.includes("generated-humanoids/")`), and the factory outgrew
 * that folder: the two hm08 MPFB library bodies resolve to
 * `/xr-assets/humanoids/candidates/body-param-adult_{lean_female,heavy_male}-library.glb`,
 * so every capture waiting on >= 2 humanoids timed out. That convention was
 * encoded in ~57 evidence modules (measured 2026-08-11).
 *
 * This predicate recognises the humanoid asset FAMILIES the runtime resolves,
 * not a single folder:
 *
 *   - `/generated-humanoids/`  — generated cast humanoids (the original home)
 *   - `/xr-assets/humanoids/`  — humanoid root: neutral/variants plus the
 *                                promoted library bodies under `candidates/`
 *   - `/cagematch/`            — model-vetting comparator humanoids
 *
 * Environment (`/xr-assets/environment/`) and equipment
 * (`/xr-assets/medical-equipment/`) are siblings of the humanoid root and must
 * NOT be claimed — a predicate that cannot tell a body from a bed is not a fix.
 *
 * The function is self-contained (no module-scope references) so its source can
 * be injected into a Playwright page context (`page.addScriptTag`) and still
 * work there — captures run the predicate inside the browser.
 */

export function isRuntimeHumanoidAssetPath(assetPath: string): boolean {
  if (typeof assetPath !== "string" || assetPath.length === 0) {
    return false;
  }
  const normalized = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;
  return (
    normalized.includes("/generated-humanoids/")
    || normalized.includes("/xr-assets/humanoids/")
    || normalized.includes("/cagematch/")
  );
}
