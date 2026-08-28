/**
 * Faculty compile-lock REST DTOs (World Compile Graph). Review metadata only:
 * a lock never promotes or publishes a packet. Split out of api-client-types.ts
 * so the frozen admin DTO surface stays within its shrink-only ceiling; the
 * REST route is `save-faculty-compile-lock` under /internal/faculty-compile-locks.
 */

export type PersistFacultyCompileLockInput = {
  scenarioId: string;
  nodeId: string;
  locked: boolean;
  /** ActorPhenotypeSchema pointer; only the four constant paths are accepted (400 otherwise). */
  overridePath?: string;
};

export type AdminFacultyCompileLockRecord = {
  scenarioId: string;
  updatedAt: string;
  claimBoundary: "faculty_compile_lock_review_metadata_only";
  notEvidenceFor: readonly string[];
  locks: Array<{
    nodeId: string;
    locked: boolean;
    overridePath?: string;
  }>;
};

/**
 * The compile-lock slice of the admin control-plane client. Declared here (not on
 * `AdminControlPlaneClient` in api-client-types.ts) because that file is frozen at
 * its shrink-only ceiling; the concrete client type is the intersection
 * `AdminControlPlaneClient & FacultyCompileLockClient`.
 */
export type FacultyCompileLockClient = {
  persistFacultyCompileLock(input: PersistFacultyCompileLockInput): Promise<AdminFacultyCompileLockRecord>;
};
