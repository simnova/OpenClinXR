/**
 * Resolve a repo-relative (or studio-public) GLB path to a browser-loadable URL.
 * Used by candidate capture and dual capture so arbitrary shipped humanoids can load
 * without hard-coded basename special cases (those silently substituted the wrong mesh).
 */
export function glbUrlForPath(sourceGlbPath: string): string {
  const normalized = sourceGlbPath.replaceAll("\\", "/");
  const publicPathMarker = "apps/arena/model-vetting-studio/public/";
  if (normalized.includes(publicPathMarker)) {
    return `/${normalized.slice(normalized.indexOf(publicPathMarker) + publicPathMarker.length)}`;
  }
  if (normalized.startsWith("/cagematch/") || normalized.startsWith("/glb-grade-staging/")) {
    return normalized;
  }
  // Vite resolves this module URL from apps/arena/model-vetting-studio/src/ → repo root is ../../../../
  const repoRelative = normalized.replace(/^\.\//, "");
  return new URL(`../../../../${repoRelative}`, import.meta.url).href;
}
