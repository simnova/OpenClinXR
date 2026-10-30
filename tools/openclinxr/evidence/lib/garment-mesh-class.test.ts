import { describe, expect, it } from "vitest";
import {
	classifyGarmentMeshName,
	classifyLowerGarmentKind,
	isGownMeshName,
	isTrouserMeshName,
	isUpperMeshName,
} from "./garment-mesh-class.js";

/** Shipped mesh names from mpfb-clinical-nurse-adult.glb (GLB JSON chunk). */
const NURSE_MESHES: Array<[string, ReturnType<typeof classifyGarmentMeshName>]> = [
	[
		"makeclothes_library_footwear_toigo_mj_cloth_shoes_mpfb_ed_chest_pain_nurse_adult_mesh",
		"footwear",
	],
	[
		"makeclothes_library_hair_toigo_blunt_bob_mpfb_ed_chest_pain_nurse_adult_mesh",
		"hair",
	],
	["makeclothes_library_scrub_pants_mpfb_ed_chest_pain_nurse_adult_mesh", "lower"],
	["makeclothes_library_scrub_shirt_mpfb_ed_chest_pain_nurse_adult_mesh", "upper"],
	["mpfb_ed_chest_pain_nurse_adult_body", "body"],
	["makeclothes_library_eyes_low_poly_mpfb_ed_chest_pain_nurse_adult_mesh", "eyes"],
	[
		"openclinxr_fitted_eyebrow_mindfront_eyebrows_06_mpfb_ed_chest_pain_nurse_adult_mesh",
		"brow",
	],
	[
		"openclinxr_fitted_eyelash_mindfront_eyelashes_01_mpfb_ed_chest_pain_nurse_adult_mesh",
		"lash",
	],
	["openclinxr_hm08_teeth_mpfb_ed_chest_pain_nurse_adult_mesh", "teeth"],
	["openclinxr_hm08_tongue_mpfb_ed_chest_pain_nurse_adult_mesh", "tongue"],
];

describe("garment-mesh-class", () => {
	it("classifies every shipped nurse mesh", () => {
		for (const [name, cls] of NURSE_MESHES) {
			expect(classifyGarmentMeshName(name), name).toBe(cls);
		}
	});

	it("knows legacy openclinxr names", () => {
		expect(classifyGarmentMeshName("openclinxr_real_garment_peds_upper_v1_mesh")).toBe("upper");
		expect(
			classifyGarmentMeshName("openclinxr_real_garment_peds_upper_v1_mesh__under_casual_top"),
		).toBe("upper");
		expect(classifyGarmentMeshName("openclinxr_real_garment_peds_tshirt_v1_mesh")).toBe(
			"upper",
		);
		expect(
			classifyGarmentMeshName("openclinxr_declared_upper_layers__scrub_top+scrub_pocket_mesh"),
		).toBe("upper");
		expect(classifyGarmentMeshName("adult_male_street_casual.anny_base")).toBe("body");
		expect(classifyGarmentMeshName("openclinxr_footwear_casual_shoe_L_mesh")).toBe("footwear");
		expect(classifyGarmentMeshName("openclinxr_fitted_teeth_mpfb_parent_tara_johnson_v1_mesh")).toBe(
			"teeth",
		);
		expect(
			classifyGarmentMeshName("openclinxr_fitted_tongue_mpfb_parent_tara_johnson_v1_mesh"),
		).toBe("tongue");
	});

	it("distinguishes trousers from gown", () => {
		expect(
			isTrouserMeshName("makeclothes_library_cargo_pants_mpfb_peds_patient_child_mesh.001"),
		).toBe(true);
		expect(
			isTrouserMeshName("makeclothes_library_scrub_pants_mpfb_ed_chest_pain_nurse_adult_mesh"),
		).toBe(true);
		expect(
			isTrouserMeshName(
				"makeclothes_library_female_tight_jeans_pants_mpfb_ob_patient_aisha_v1_mesh",
			),
		).toBe(true);
		expect(isTrouserMeshName("openclinxr_real_garment_hospital_gown_mesh")).toBe(false);
		expect(isGownMeshName("openclinxr_real_garment_hospital_gown_mesh")).toBe(true);
		expect(
			isGownMeshName("makeclothes_library_scrub_pants_mpfb_ed_chest_pain_nurse_adult_mesh"),
		).toBe(false);
		expect(classifyLowerGarmentKind("openclinxr_real_garment_hospital_gown_mesh")).toBe("gown");
		expect(
			classifyLowerGarmentKind(
				"makeclothes_library_straight_leg_jeans_pants_mpfb_adult_male_street_casual_mesh",
			),
		).toBe("trouser");
	});

	it("upper helper covers legacy and makeclothes uppers", () => {
		expect(isUpperMeshName("openclinxr_real_garment_peds_upper_v1_mesh")).toBe(true);
		expect(
			isUpperMeshName("makeclothes_library_toigo_t_shirt_mpfb_ed_chest_pain_spouse_adult_mesh"),
		).toBe(true);
		expect(
			isUpperMeshName(
				"makeclothes_library_lab_coat_mpfb_ward_delirium_senior_resident_adult_mesh",
			),
		).toBe(true);
		expect(
			isUpperMeshName("makeclothes_library_scrub_pants_mpfb_ed_chest_pain_nurse_adult_mesh"),
		).toBe(false);
	});

	it("counterweight: a name list with no garments yields no upper/lower, unknowns stay unknown", () => {
		const nonGarments = [
			"mpfb_ed_chest_pain_nurse_adult_body",
			"makeclothes_library_eyes_low_poly_mpfb_ed_chest_pain_nurse_adult_mesh",
			"makeclothes_library_hair_toigo_blunt_bob_mpfb_ed_chest_pain_nurse_adult_mesh",
			"openclinxr_hm08_teeth_mpfb_ed_chest_pain_nurse_adult_mesh",
			"openclinxr_footwear_clinical_shoe_L_mesh",
		];
		expect(nonGarments.some((n) => classifyGarmentMeshName(n) === "upper")).toBe(false);
		expect(nonGarments.some((n) => classifyGarmentMeshName(n) === "lower")).toBe(false);
		expect(classifyGarmentMeshName("some_random_prop_mesh")).toBe("unknown");
		expect(classifyGarmentMeshName("")).toBe("unknown");
		expect(classifyGarmentMeshName(undefined)).toBe("unknown");
		expect(classifyLowerGarmentKind("some_random_prop_mesh")).toBe("unknown");
	});
});
