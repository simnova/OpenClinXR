/**
 * Publication-root isolation (#ph634 output isolation).
 *
 * A cheap regression that mocks the heavy chain at the runChain dependency seam
 * and asserts promotion writes land only under the disposable publication tree.
 *
 * claimScope: room promotion writes resolve under publicationTargetRoot; the
 * repository source tree (GLB, rig, PROVENANCE) stays byte-identical.
 * notEvidenceFor: geometry fidelity, clinical validity, Quest readiness.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promoteRoom } from "../../asset-pipeline/environment/room-promote-cli.js";

const REPO = path.resolve(import.meta.dirname, "../../../..");
const GLB_REL = "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb";
const RIG_REL = "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json";
const PROV_REL = "apps/ui-xr/public/xr-assets/environment/PROVENANCE.md";

const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("room promotion publication-root isolation", () => {
  it("writes only to the disposable publication tree, source stays byte-identical", async () => {
    const glbBefore = digest(path.join(REPO, GLB_REL));
    const rigBefore = digest(path.join(REPO, RIG_REL));
    const provBefore = digest(path.join(REPO, PROV_REL));

    // Disposable source GLB with altered bytes: forces a real publish (not the
    // preserved-shipped-content path) and keeps the provenance child quiet.
    const fixture = mkdtempSync(path.join(tmpdir(), "ward-isolation-"));
    const publicationRoot = mkdtempSync(path.join(tmpdir(), "ward-publication-"));
    try {
      const fixtureGlb = path.join(fixture, "chain.glb");
      copyFileSync(path.join(REPO, GLB_REL), fixtureGlb);
      const bytes = readFileSync(fixtureGlb);
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
      const { writeFileSync } = await import("node:fs");
      writeFileSync(fixtureGlb, bytes);
      const fixtureRig = path.join(fixture, "rig.json");
      const rigBody = JSON.stringify({ isolation: "fixture", seed: 7 });
      writeFileSync(fixtureRig, rigBody);
      const outDir = path.join(fixture, "chain-out");

      await promoteRoom(
        ["--environment", "ed_exam_bay_v1", "--seed", "7", "--out-dir", outDir],
        {
          repositoryRoot: REPO,
          publicationTargetRoot: publicationRoot,
          runChain: (async () => {
            mkdirSync(outDir, { recursive: true });
            return {
              environmentId: "ed_exam_bay_v1",
              seed: 7,
              cache: { hit: true },
              chainOutDir: outDir,
              workGlb: fixtureGlb,
              finalGlb: fixtureGlb,
              rigJson: fixtureRig,
              reportPath: path.join(outDir, "report.json"),
              glbSha256: digest(fixtureGlb),
              rigSha256: createHash("sha256").update(rigBody).digest("hex"),
            };
          }) as never,
        },
      );

      const publishedGlb = path.join(publicationRoot, "apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb");
      const publishedRig = path.join(publicationRoot, "apps/ui-xr/public/xr-assets/lighting/ed_exam_bay_v1.rig.json");
      expect(existsSync(publishedGlb), "published GLB landed in the disposable tree").toBe(true);
      expect(existsSync(publishedRig), "published rig landed in the disposable tree").toBe(true);
      expect(readFileSync(publishedGlb)).toEqual(readFileSync(fixtureGlb));
      expect(readFileSync(publishedRig, "utf8")).toBe(rigBody);

      expect(digest(path.join(REPO, GLB_REL)), "source ward GLB mutated").toBe(glbBefore);
      expect(digest(path.join(REPO, RIG_REL)), "source ward rig mutated").toBe(rigBefore);
      expect(digest(path.join(REPO, PROV_REL)), "source PROVENANCE.md mutated").toBe(provBefore);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(publicationRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
