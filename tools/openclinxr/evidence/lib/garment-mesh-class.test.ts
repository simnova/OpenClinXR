import { describe, expect, it } from "vitest";
import {
	classifyGarmentMeshName,
	classifyLowerGarmentKind,
	isFittedGarmentMeshName,
	isGownMeshName,
	isLegacySurfaceDerivedMeshName,
	isTrouserMeshName,
	isUpperMeshName,
	isWearableMeshName,
	makeclothesGarmentSlug,
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

	it("generic upper tokens cover shells outside the known table", () => {
		// The hm08 cover shell (garment-selection-by-role.ts): named so it reads
		// as an upper garment on every consumer classifier.
		expect(
			isUpperMeshName("makeclothes_library_civilian_shirt_adult_lean_female_mesh"),
		).toBe(true);
		// The #199 sweater the slot consumers were built to survive.
		expect(isUpperMeshName("makeclothes_library_toigo_fisherman_sweater_mesh")).toBe(true);
		// Lower and non-garment names still win over the generic upper rule.
		expect(isTrouserMeshName("makeclothes_library_civilian_shirt_adult_lean_female_mesh")).toBe(
			false,
		);
		expect(
			classifyGarmentMeshName("makeclothes_library_hair_toigo_blunt_bob_mesh"),
		).toBe("hair");
		expect(
			classifyGarmentMeshName("makeclothes_library_footwear_toigo_mj_cloth_shoes_mesh"),
		).toBe("footwear");
	});

	it("fitted-garment excludes declared layer shells", () => {
		expect(isFittedGarmentMeshName("openclinxr_real_garment_peds_upper_v1_mesh")).toBe(true);
		expect(
			isFittedGarmentMeshName(
				"makeclothes_library_scrub_shirt_mpfb_ed_chest_pain_nurse_adult_mesh",
			),
		).toBe(true);
		expect(
			isFittedGarmentMeshName(
				"openclinxr_declared_upper_layers__casual_top+open_cardigan_mesh",
			),
		).toBe(false);
		expect(isFittedGarmentMeshName("mpfb_ed_chest_pain_nurse_adult_body")).toBe(false);
	});

	it("slug addresses one makeclothes garment exactly", () => {
		expect(
			makeclothesGarmentSlug(
				"makeclothes_library_scrub_shirt_mpfb_ed_chest_pain_nurse_adult_mesh",
			),
		).toBe("scrub_shirt");
		expect(
			makeclothesGarmentSlug(
				"makeclothes_library_lab_coat_mpfb_ward_delirium_senior_resident_adult_mesh",
			),
		).toBe("lab_coat");
		expect(makeclothesGarmentSlug("openclinxr_real_garment_peds_upper_v1_mesh")).toBe(null);
		expect(makeclothesGarmentSlug("mpfb_ed_chest_pain_nurse_adult_body")).toBe(null);
	});

	it("wearables cover garments plus footwear, never hair or declared shells", () => {
		expect(
			isWearableMeshName("makeclothes_library_scrub_shirt_mpfb_ed_chest_pain_nurse_adult_mesh"),
		).toBe(true);
		expect(
			isWearableMeshName(
				"makeclothes_library_footwear_toigo_mj_cloth_shoes_mpfb_ed_chest_pain_nurse_adult_mesh",
			),
		).toBe(true);
		expect(isWearableMeshName("openclinxr_real_garment_hospital_gown_mesh")).toBe(true);
		// Fitted hair ships on the same rail but is not a garment contract population.
		expect(
			isWearableMeshName("openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_mpfb_ob_patient_aisha_v1_mat"),
		).toBe(false);
		expect(
			isWearableMeshName("openclinxr_declared_upper_layers__casual_top+open_cardigan_mesh"),
		).toBe(false);
		expect(isWearableMeshName("mpfb_ed_chest_pain_nurse_adult_body")).toBe(false);
	});

	it("legacy surface-derived rail is provenance, not class", () => {
		expect(isLegacySurfaceDerivedMeshName("openclinxr_real_garment_hospital_gown_mesh")).toBe(true);
		expect(
			isLegacySurfaceDerivedMeshName("openclinxr_real_garment_peds_upper_v1_mesh__under_casual_top"),
		).toBe(true);
		// A fitted makeclothes shell shares the upper class but is not derived.
		expect(
			isLegacySurfaceDerivedMeshName("makeclothes_library_scrub_shirt_mpfb_peds_nurse_kevin_mesh"),
		).toBe(false);
		expect(isLegacySurfaceDerivedMeshName("mpfb_ed_chest_pain_nurse_adult_body")).toBe(false);
		expect(isLegacySurfaceDerivedMeshName("")).toBe(false);
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
