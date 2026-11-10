import { describe, expect, it } from "vitest";
import {
  cameraWithinTolerance,
  greybodyManifestFields,
  isSkinMaterialName,
  parseCli,
} from "./vitruvian-compare.js";

const BASE = [
  "--actor",
  "mpfb-ob-patient-aisha",
  "--new",
  "fixtures",
  "--out",
  "out",
];

// Exact material-name fixture from the I1a app-room dump. The old diagnostic
// row filter matched meshName `*_body*` too broadly; the capture control must
// select only the actual MPFB skin material and leave eyes/hidden partitions
// and fitted assets untouched.
const I1A_MATERIAL_NAMES = [
  "mat_makeclothes_library_female_tight_jeans_pants",
  "mat_makeclothes_library_footwear_toigo_mj_cloth_shoes",
  "openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_mpfb_ob_patient_aisha_v1_mat",
  "mat_makeclothes_library_toigo_t_shirt",
  "mpfb_skin_ob_patient_aisha_v1",
  "openclinxr_hidden_upper_mpfb_ob_patient_aisha_v1_body_mesh",
  "openclinxr_hidden_lower_mpfb_ob_patient_aisha_v1_body_mesh",
  "openclinxr_hidden_foot_mpfb_ob_patient_aisha_v1_body_mesh",
  "openclinxr_hidden_orphan_mpfb_ob_patient_aisha_v1_body_mesh",
  "mat_makeclothes_library_eyes_ob_patient_aisha_v1",
  "openclinxr_fitted_eyebrow_mindfront_eyebrows_05_mpfb_ob_patient_aisha_v1_mat",
  "openclinxr_fitted_eyelash_mindfront_eyelashes_01_mpfb_ob_patient_aisha_v1_mat",
  "mat_openclinxr_hm08_teeth_mpfb_ob_patient_aisha_v1_mesh",
];

describe("vitruvian grey-body controls", () => {
  it("parses the two controls and records their manifest fields", () => {
    const lambert = parseCli([...BASE, "--skin-override", "lambert:0.18"]);
    expect(lambert.skinOverride).toEqual({ kind: "lambert", albedo: 0.18 });
    expect(greybodyManifestFields(lambert)).toEqual({
      skinOverride: "lambert:0.18",
      skinSpecular: null,
    });

    const specular = parseCli([...BASE, "--skin-specular", "off"]);
    expect(specular.skinSpecular).toBe("off");
    expect(greybodyManifestFields(specular)).toEqual({
      skinOverride: null,
      skinSpecular: "off",
    });
  });

  it("refuses mutually exclusive controls", () => {
    expect(() =>
      parseCli([
        ...BASE,
        "--skin-override",
        "lambert:0.18",
        "--skin-specular",
        "off",
      ]),
    ).toThrow(/mutually exclusive/i);
  });

  it.each(["lambert:0", "lambert:-0.1", "lambert:1.0001", "lambert:nan", "phong:0.18"])(
    "refuses bad albedo %s",
    (value) => {
      expect(() => parseCli([...BASE, "--skin-override", value])).toThrow(
        /--skin-override/,
      );
    },
  );

  it("selects only the actual skin material from the I1a dump fixture", () => {
    expect(I1A_MATERIAL_NAMES.filter(isSkinMaterialName)).toEqual([
      "mpfb_skin_ob_patient_aisha_v1",
    ]);
  });

  it("records explicit nulls on the default path", () => {
    expect(greybodyManifestFields(parseCli(BASE))).toEqual({
      skinOverride: null,
      skinSpecular: null,
    });
  });
});

describe("cameraWithinTolerance (ORIGINAL vs NEW portrait framing)", () => {
  // Measured pair: greybody lambert-018 warm_light neck-close card, gb-cap-5.log 2026-11-10.
  const ORIGINAL = { fovDeg: 24, fillTarget: 0.78, distanceM: 0.606212, headHeightPx: 3194.937878, headBoxPx: { x0: 162.616578, y0: 450.531061, x1: 3933.383422, y1: 3645.468939 }, yawDegrees: 0 };
  const NEW = { fovDeg: 24, fillTarget: 0.78, distanceM: 0.60621, headHeightPx: 3194.93788, headBoxPx: { x0: 162.608495, y0: 450.53106, x1: 3933.391505, y1: 3645.46894 }, yawDegrees: 0 };
  it("accepts the measured float-noise pair", () => {
    expect(cameraWithinTolerance(ORIGINAL, NEW)).toBe(true);
  });
  it("refuses a 1 px head-box shift", () => {
    expect(cameraWithinTolerance(ORIGINAL, { ...NEW, headBoxPx: { ...NEW.headBoxPx, x0: NEW.headBoxPx.x0 + 1 } })).toBe(false);
  });
  it("refuses a 1 mm camera distance change", () => {
    expect(cameraWithinTolerance(ORIGINAL, { ...NEW, distanceM: NEW.distanceM + 1e-3 })).toBe(false);
  });
  it("keeps non-metric fields exact (fov, yaw)", () => {
    expect(cameraWithinTolerance(ORIGINAL, { ...NEW, fovDeg: 24.01 })).toBe(false);
    expect(cameraWithinTolerance(ORIGINAL, { ...NEW, yawDegrees: 0.01 })).toBe(false);
  });
  it("refuses a missing key", () => {
    const { yawDegrees: _y, ...rest } = NEW;
    expect(cameraWithinTolerance(ORIGINAL, rest)).toBe(false);
  });
});

describe("cameraWithinTolerance (grey-card placement)", () => {
  // Measured pair: greybody specular-off warm_light neck-close card, gb-cap-7.log 2026-11-10; all other fields equal.
  const ORIGINAL = { projectedBoxPx: { x0: 1801, y0: 1791, x1: 2295, y1: 2305 }, sizeMeters: 0.131754, focusTargetDistanceMeters: 0.606212, cameraDistanceRatio: 4.437713, linearReflectance: 0.18 };
  const NEW = { ...ORIGINAL, focusTargetDistanceMeters: 0.60621, cameraDistanceRatio: 4.437729 };
  it("accepts the measured float-noise pair", () => {
    expect(cameraWithinTolerance(ORIGINAL, NEW)).toBe(true);
  });
  it("refuses a 1 mm card size change", () => {
    expect(cameraWithinTolerance(ORIGINAL, { ...NEW, sizeMeters: NEW.sizeMeters + 1e-3 })).toBe(false);
  });
  it("refuses a 1% camera distance ratio change", () => {
    expect(cameraWithinTolerance(ORIGINAL, { ...NEW, cameraDistanceRatio: NEW.cameraDistanceRatio * 1.01 })).toBe(false);
  });
  it("keeps reflectance exact", () => {
    expect(cameraWithinTolerance(ORIGINAL, { ...NEW, linearReflectance: 0.181 })).toBe(false);
  });
});
