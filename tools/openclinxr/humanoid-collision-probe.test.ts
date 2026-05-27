import { describe, expect, it } from "vitest";
import {
  buildHumanoidCollisionProbeReport,
  validateHumanoidCollisionProbeReport,
} from "./humanoid-collision-probe.js";

describe("humanoid collision probe", () => {
  it("passes when humanoid runtime evidence exposes ragdoll collision proxy cues", async () => {
    const report = await buildHumanoidCollisionProbeReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-23T00:00:00.000Z",
      evidence: {
        sceneAssetEvidence: {
          assets: [
            {
              assetId: "openclinxr.patient.generated-humanoid-glb",
              affordanceCueIds: ["openclinxr.patient.generated-humanoid-glb:ragdoll_collision_proxy_cue"],
            },
          ],
        },
      },
    });

    expect(report.result).toEqual({
      status: "collision_probe_ready",
      humanoidProxyCount: 1,
      contactProbeCount: 1,
      blockers: [],
      passedSignals: [
        "humanoid_ragdoll_collision_proxy_cues_present",
        "rapier_contact_probe_detected_proxy_overlap",
      ],
    });
    expect(validateHumanoidCollisionProbeReport(report)).toEqual({ ok: true });
  });

  it("blocks when no humanoid collision proxy cue is present", async () => {
    const report = await buildHumanoidCollisionProbeReport({
      inputFile: "sample.json",
      generatedAt: "2026-05-23T00:00:00.000Z",
      evidence: { sceneAssetEvidence: { assets: [] } },
    });

    expect(report.result.status).toBe("collision_probe_blocked");
    expect(report.result.blockers).toContain("humanoid_ragdoll_collision_proxy_cues_missing");
  });
});
