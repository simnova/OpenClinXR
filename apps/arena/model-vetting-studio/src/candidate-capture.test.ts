import { describe, expect, it } from "vitest";
import { glbUrlForPath } from "./candidate-capture.js";

describe("candidate capture GLB selection", () => {
  it("maps sidecar-produced local candidate paths to the matching browser-served GLB", () => {
    expect(glbUrlForPath(".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1/peds_patient_child.glb")).toContain("peds_patient_child.glb");
    expect(glbUrlForPath(".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1/peds_anxious_parent.glb")).toContain("peds_anxious_parent.glb");
    expect(glbUrlForPath(".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1/peds_nurse_kevin.glb")).toContain("peds_nurse_kevin.glb");
  });

  it("serves copied cagematch assets from the model-vetting studio public folder", () => {
    expect(glbUrlForPath("apps/arena/model-vetting-studio/public/cagematch/anny-skin-track-a-mit-pbr/peds_patient_child_track_a_mit_pbr.glb"))
      .toBe("/cagematch/anny-skin-track-a-mit-pbr/peds_patient_child_track_a_mit_pbr.glb");
  });
});
