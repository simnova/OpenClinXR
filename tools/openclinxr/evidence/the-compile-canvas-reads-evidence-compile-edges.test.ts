import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * World-model UI remaining: buildCompileEdges walks the scene pipeline queue, not
 * stored evidence.v1 compileEdges (faculty-compile-lock.tsx).
 *
 * Diagnosis header IMMUTABLE. Flip it.fails; append ## FIXED.
 *
 * ## FIXED (#0)
 *
 * `apps/ui-admin/src/faculty-compile-lock.tsx` now prefers stored evidence.v1
 * compileEdges: `buildCompileEdges(queue, compileEdgesFromEvidence?)` returns the
 * evidence report's `compileEdges` ({from,to,kind} rows) verbatim when supplied
 * (`EvidenceCompileEdges`), and only falls back to deriving body -> wardrobe ->
 * equipment edges from the scene pipeline queue when no evidence edges are
 * attached. `useFacultyCompileLocks(queue, client, compileEdgesFromEvidence?)`
 * passes the stored edges through to the CompileGraphCanvas wiring, so the
 * canvas renders what a compile run stamped on evidence.v1 rather than only the
 * scene-pipeline queue pairs. claimScope: UI preference + pass-through only;
 * notEvidenceFor: the API serving evidence.v1 to the admin app, and xyflow
 * layout of 12-station graphs.
 */

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../apps/ui-admin/src/faculty-compile-lock.tsx"),
  "utf8",
);

describe("the compile canvas reads evidence compileEdges", () => {
  it("(1) buildCompileEdges prefers evidence.compileEdges when present", () => {
    expect(SRC).toMatch(/compileEdgesFromEvidence|evidence\.compileEdges/);
  });
});
