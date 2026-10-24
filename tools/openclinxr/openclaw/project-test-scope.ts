import { matchesGlob } from "node:path";

/**
 * Authoritative project archive excludes. Repo-root archival snapshots and
 * provider caches are not live source. Root-relative so live files in managed
 * worktrees under a ".openclinxr" ancestor stay collected. Owned here because
 * the generic Cellix package must carry no OpenClinXR product semantics.
 */
export const PROJECT_ARCHIVE_EXCLUDES: readonly string[] = [
  ".openclinxr/**",
  ".openclinxr-local/**",
];

/** True when a repo-relative path is a preserved archive copy, never live. */
export function isProjectArchivedRepoRel(repoRel: string): boolean {
  return PROJECT_ARCHIVE_EXCLUDES.some((pattern) => matchesGlob(repoRel, pattern));
}
