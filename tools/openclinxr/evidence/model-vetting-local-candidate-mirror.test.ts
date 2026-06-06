import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCagematchOutputHome } from "./generated-output-home.js";
import { buildLocalCandidateModelVettingMirror } from "./model-vetting-local-candidate-mirror.js";

describe("model-vetting local candidate mirror", () => {
  it("exposes a script for browser-serving ignored local candidates", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:model-vetting:local-candidate-mirror"]).toBe("tsx tools/openclinxr/evidence/model-vetting-local-candidate-mirror.ts");
  });

  it("rewrites local candidate GLB paths to the ignored public cagematch mirror", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-local-candidate-mirror-"));
    const cwd = process.cwd();
    try {
      process.chdir(tempDir);
      await writeFile("candidate.glb", "fixture-glb", "utf8");
      const preflight = {
        schemaVersion: "openclinxr.anny-candidate-preflight.v1",
        generatedAt: "2026-06-06T00:00:00.000Z",
        candidates: [
          {
            candidateId: "peds_patient_child_anny_compatible_candidate",
            scenarioId: "peds_asthma_parent_anxiety_v1",
            actorMapping: {
              actorId: "patient_maya_johnson_v1",
              actorRole: "patient",
              actorDisplayRole: "school-age pediatric asthma patient",
              reuseKey: "reuse:patient",
            },
            paths: {
              sourceGlbPath: "candidate.glb",
              provenancePath: "candidate.provenance.json",
            },
            source: {
              sourceKind: "real_anny_candidate_unverified",
              usesRealAnnyForwardPass: true,
            },
            provenance: {
              documentSha256: "a".repeat(64),
              sourceOriginChainPresent: true,
              licenseChainPresent: true,
              derivativeLineagePresent: true,
              toolVersionPresent: true,
              promptOrCaseParameterHashPresent: true,
              notEvidenceFor: ["b_plus_visual_realism_gate", "production_asset_readiness", "quest_readiness"],
            },
            glb: {
              byteLength: 11,
              sha256: "b".repeat(64),
              sceneCount: 1,
              nodeCount: 1,
              meshCount: 1,
              materialCount: 1,
              skinCount: 1,
              animationCount: 1,
              morphTargetPrimitiveCount: 1,
              vertexCount: 42,
            },
            rigControlEvidence: {
              canonicalSkeletonNodesPresent: true,
              faceRigNodesPresent: true,
              gazeEyeNodesPresent: true,
              blinkControlPresent: true,
              locomotionPostureClipPresent: true,
              requiredMorphTargetsPresent: true,
              requiredMorphTargets: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"],
              missingMorphTargets: [],
              observedMorphTargets: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"],
              observedControlNodes: ["head", "neck"],
            },
            status: "ready_for_webxr_visual_evidence",
            blockers: [],
            nextEvidenceRequired: ["webxr_only_actor_closeup_screenshot"],
          },
        ],
      };
      const manifest = await buildLocalCandidateModelVettingMirror({
        sourcePreflightPath: "preflight.json",
        sourcePreflight: preflight,
        outputHome: buildCagematchOutputHome("mirror-test", "run"),
      });

      expect(manifest.mirroredCandidates[0]).toMatchObject({
        sourceGlbPath: "candidate.glb",
        publicMirrorUrlPath: "/cagematch/mirror-test/run/candidate.glb",
      });
      const report = JSON.parse(await readFile(manifest.localModelVettingReportPath, "utf8")) as { candidates: Array<{ sourceGlbPath: string }> };
      expect(report.candidates[0]?.sourceGlbPath).toBe("/cagematch/mirror-test/run/candidate.glb");
    } finally {
      process.chdir(cwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
