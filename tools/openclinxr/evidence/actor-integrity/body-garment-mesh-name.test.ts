import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { isBodyGarmentMeshName } from "./body-garment-mesh-name.js";

const POSITIVES = [
	"makeclothes_library_bootcut_jeans_pants_mpfb_ed_chest_pain_spouse_adult_mesh",
	"makeclothes_library_straight_leg_jeans_pants_mpfb_adult_male_street_casual_mesh",
	"makeclothes_library_toigo_t_shirt_mpfb_ob_patient_aisha_v1_mesh",
	"makeclothes_library_female_tight_jeans_pants_mpfb_ob_patient_aisha_v1_mesh",
	"makeclothes_library_cargo_pants_mpfb_peds_patient_child_mesh.001",
	"makeclothes_library_lab_coat_mpfb_ward_delirium_senior_resident_adult_mesh",
	"makeclothes_library_scrub_shirt_mpfb_ed_chest_pain_nurse_adult_mesh",
	"openclinxr_real_garment_hospital_gown_mesh",
];

const NEGATIVES = [
	"makeclothes_library_hair_toigo_curled_under_bob_mpfb_ed_chest_pain_spouse_adult_mesh",
	"makeclothes_library_eyes_low_poly_mpfb_ed_chest_pain_spouse_adult_mesh",
	"makeclothes_library_footwear_toigo_mj_cloth_shoes_mpfb_ed_chest_pain_nurse_adult_mesh",
	"makeclothes_library_footwear_culturalibre_male_boots_mpfb_adult_male_street_casual_mesh",
	"mpfb_ob_patient_aisha_v1_body",
	"openclinxr_hm08_teeth_mpfb_ob_patient_aisha_v1_mesh",
	"makeclothes_library_mystery_cloth_thing",
	"makeclothes_library_jeans_clothes_thing",
	"makeclothes_library_mystery_toigo_t_shirt",
	"makeclothes_library_toigo_t_shirtless",
	"",
];

describe("body-garment mesh name recognizer", () => {
	it("actual shared helper accepts known body garments", () => {
		for (const n of POSITIVES) expect(isBodyGarmentMeshName(n)).toBe(true);
	});
	it("actual shared helper rejects hair, eyes, footwear, shoes, boots, skin, unknown", () => {
		for (const n of NEGATIVES) expect(isBodyGarmentMeshName(n)).toBe(false);
	});
	it("actual query serializes the actual shared helper via placeholder replacement", () => {
		const dir = path.dirname(fileURLToPath(import.meta.url));
		const probeSrc = readFileSync(
			path.resolve(dir, "../per-station-actor-integrity.ts"),
			"utf8",
		);
		expect(probeSrc).toContain("__SOURCE245_BODY_GARMENT_FN__");
		expect(probeSrc).toContain(
			'import { isBodyGarmentMeshName } from "./actor-integrity/body-garment-mesh-name.js"',
		);
		expect(probeSrc).toContain(
			"if (isBodyGarmentMeshName(n)) hasGarment = true;",
		);
		// Rebuild the serialized page function exactly as the producer does.
		// VM execution below proves the serialized text is self-contained (no external closure).
		const serialized = `(${isBodyGarmentMeshName.toString()})`;
		const built = probeSrc
			.split("__SOURCE245_BODY_GARMENT_FN__")
			.join(serialized);
		expect(built).not.toContain("__SOURCE245_BODY_GARMENT_FN__");
		expect(built).toContain("bootcut_jeans_pants");
		const sandbox: Record<string, unknown> = {};
		vm.createContext(sandbox);
		vm.runInContext(`this.__fn__ = ${serialized};`, sandbox);
		const fn = (sandbox as { __fn__: (n: unknown) => boolean }).__fn__;
		for (const n of POSITIVES) expect(fn(n)).toBe(true);
		for (const n of NEGATIVES) expect(fn(n)).toBe(false);
	});
});
