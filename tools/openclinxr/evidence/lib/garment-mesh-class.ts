/**
 * Shared garment-mesh classifier — the one contract every evidence test uses
 * to select garment meshes by name. Knows legacy `openclinxr_*` names and
 * shipped `makeclothes_library_*` / `openclinxr_fitted_*` names measured
 * from the GLB JSON chunks under `apps/ui-xr/public/generated-humanoids/`.
 * Anything unrecognized is `unknown`, never a guess.
 *
 * NOTE on `actor-integrity/body-garment-mesh-name.ts`: that module's
 * `isBodyGarmentMeshName` is serialized verbatim into a browser probe, so it
 * must stay self-contained (its test executes `fn.toString()` in a VM) and
 * cannot share this module's tables. The makeclothes membership tokens here
 * intentionally mirror its `KNOWN_BODY_GARMENT_TOKENS`; this classifier only
 * adds the upper/lower class split and the non-makeclothes schemes
 * (declared layers, fitted parts, body, footwear/hair/eyes) that the boolean
 * does not cover. Keep the two membership lists in sync by hand until the
 * probe no longer needs a self-contained function.
 */

export type GarmentMeshClass =
	| "upper"
	| "lower"
	| "footwear"
	| "hair"
	| "eyes"
	| "brow"
	| "lash"
	| "teeth"
	| "tongue"
	| "body"
	| "unknown";

export type LowerGarmentKind = "trouser" | "gown" | "skirt" | "unknown";

/**
 * Makeclothes membership tokens. Mirrors `KNOWN_BODY_GARMENT_TOKENS` in
 * `actor-integrity/body-garment-mesh-name.ts` (see module note above).
 */
const MAKECLOTHES_GARMENT_TOKENS = [
	"scrub_shirt",
	"scrub_pants",
	"bootcut_jeans_pants",
	"straight_leg_jeans_pants",
	"female_tight_jeans_pants",
	"cargo_pants",
	"toigo_t_shirt",
	"lab_coat",
];

const UPPER_MAKECLOTHES_TOKENS = new Set(["scrub_shirt", "toigo_t_shirt", "lab_coat"]);

/** Generic trouser indicators beyond the makeclothes token table. Deliberately
 * NOT bare "lower": body-region hide materials (`openclinxr_hidden_lower_*`)
 * carry that segment and must stay out of every garment population. */
const TROUSER_GENERIC_TOKENS = new Set(["trouser", "trousers", "jeans", "pants", "shorts", "legging", "leggings"]);

/**
 * Generic upper indicators for `makeclothes_library_*` names outside the
 * known-token table: cover shells (`civilian_shirt`), sweaters
 * (`toigo_fisherman_sweater`, the #199 pick consumers still reference), and the
 * bare `scrub` slot. Checked only after the known tokens, after
 * hair/footwear/eyes/body, and after gown/skirt — never a guess for
 * non-garment names.
 */
const UPPER_GENERIC_TOKENS = new Set([
	"shirt",
	"shirts",
	"scrub",
	"scrubs",
	"sweater",
	"sweaters",
]);

const NON_GARMENT_EXCLUSION_RE =
	/(^|_)hair(_|\.|$)|footwear|_shoes?(_|\.|$)|_boots?(_|\.|$)|_slipper(_|\.|$)|(^|_)eyes?(_|\.|$)|(^|_)skin(_|\.|$)/;

function matchKnownToken(rest: string, token: string): boolean {
	return rest === token || rest.indexOf(token + "_") === 0 || rest.indexOf(token + ".") === 0;
}

function segmentsOf(name: string): string[] {
	return name.split(/[^a-z0-9]+/);
}

function hasGenericTrouserToken(text: string): boolean {
	return segmentsOf(text).some((seg) => TROUSER_GENERIC_TOKENS.has(seg));
}

function hasGenericUpperToken(text: string): boolean {
	return segmentsOf(text).some((seg) => UPPER_GENERIC_TOKENS.has(seg));
}

/** Classify one mesh name. Non-strings and unrecognized names → `unknown`. */
export function classifyGarmentMeshName(name: unknown): GarmentMeshClass {
	if (typeof name !== "string" || name.length === 0) return "unknown";
	const n = name.toLowerCase();
	if (/(^|_)hair(_|\.|$)/.test(n)) return "hair";
	if (/footwear|_shoes?(_|\.|$)|_boots?(_|\.|$)|_slipper(_|\.|$)/.test(n)) return "footwear";
	if (/eyebrow/.test(n)) return "brow";
	if (/eyelash/.test(n)) return "lash";
	if (/(^|_)eyes?(_|\.|$)/.test(n)) return "eyes";
	if (/teeth/.test(n)) return "teeth";
	if (/tongue/.test(n)) return "tongue";
	if (/(^|\.)anny_base(\.|$)|_body(\.|$)|(^|_)skin(_|\.|$)/.test(n)) return "body";
	if (/gown/.test(n)) return "lower";
	if (/skirt/.test(n)) return "lower";
	if (n.indexOf("openclinxr_real_garment_") >= 0) {
		return hasGenericTrouserToken(n) ? "lower" : "upper";
	}
	if (n.indexOf("openclinxr_declared_upper_layers_") >= 0) return "upper";
	const prefix = "makeclothes_library_";
	const at = n.indexOf(prefix);
	if (at >= 0) {
		const rest = n.slice(at + prefix.length);
		for (const token of MAKECLOTHES_GARMENT_TOKENS) {
			if (matchKnownToken(rest, token)) {
				return UPPER_MAKECLOTHES_TOKENS.has(token) ? "upper" : "lower";
			}
		}
		if (hasGenericTrouserToken(rest)) return "lower";
		if (hasGenericUpperToken(rest)) return "upper";
	}
	if (!NON_GARMENT_EXCLUSION_RE.test(n)) {
		if (hasGenericTrouserToken(n)) return "lower";
	}
	return "unknown";
}

/** Distinguish trousers from gown/skirt for a lower-class mesh. */
export function classifyLowerGarmentKind(name: unknown): LowerGarmentKind {
	if (typeof name !== "string" || name.length === 0) return "unknown";
	const n = name.toLowerCase();
	if (/gown/.test(n)) return "gown";
	if (/skirt/.test(n)) return "skirt";
	const prefix = "makeclothes_library_";
	const at = n.indexOf(prefix);
	const rest = at >= 0 ? n.slice(at + prefix.length) : n;
	for (const token of MAKECLOTHES_GARMENT_TOKENS) {
		if (matchKnownToken(rest, token)) {
			return UPPER_MAKECLOTHES_TOKENS.has(token) ? "unknown" : "trouser";
		}
	}
	if (hasGenericTrouserToken(rest)) return "trouser";
	return "unknown";
}

/** Lower-body garment that covers the legs (not a gown or skirt). */
export function isTrouserMeshName(name: unknown): boolean {
	return classifyGarmentMeshName(name) === "lower" && classifyLowerGarmentKind(name) === "trouser";
}

/** Single lower garment that drapes from the shoulders (hospital gown). */
export function isGownMeshName(name: unknown): boolean {
	return classifyGarmentMeshName(name) === "lower" && classifyLowerGarmentKind(name) === "gown";
}

/**
 * The makeclothes garment slug embedded in a mesh name (`scrub_shirt`,
 * `lab_coat`, `cargo_pants`, …), or null. Same single vocabulary as the
 * classifier — use it instead of a private token regex when a test must
 * address one garment mesh exactly (e.g. shirt-vs-coat separation).
 */
export function makeclothesGarmentSlug(name: unknown): string | null {
	if (typeof name !== "string" || name.length === 0) return null;
	const n = name.toLowerCase();
	const prefix = "makeclothes_library_";
	const at = n.indexOf(prefix);
	if (at < 0) return null;
	const rest = n.slice(at + prefix.length);
	for (const token of MAKECLOTHES_GARMENT_TOKENS) {
		if (matchKnownToken(rest, token)) return token;
	}
	return null;
}

/** Upper-body garment (shirt, scrub top, tee, lab coat, legacy real-garment upper). */
export function isUpperMeshName(name: unknown): boolean {
	return classifyGarmentMeshName(name) === "upper";
}

/** Fitted garment geometry (legacy `openclinxr_real_garment_*`, makeclothes
 * garment tokens). Excludes `openclinxr_declared_upper_layers_*` shells:
 * those are layer declarations (open cardigans) whose front opening is
 * deliberately deep and must not join neckline populations. */
export function isFittedGarmentMeshName(name: unknown): boolean {
	if (typeof name !== "string" || name.length === 0) return false;
	if (name.toLowerCase().indexOf("openclinxr_declared_upper_layers_") >= 0) return false;
	const cls = classifyGarmentMeshName(name);
	return cls === "upper" || cls === "lower";
}

/**
 * Fitted wearables the shading/texture contracts measure: upper/lower
 * garments plus footwear. Fitted hair has its own class and is excluded here
 * BY CLASS (its material prefix renamed out of the makeclothes rail, so a rail
 * gate would admit it by accident): wearables contracts pin their populations
 * to upper/lower/footwear, and admitting hair rewrites their scope. Declared
 * layer shells stay out with the fitted set above.
 */
export function isWearableMeshName(name: unknown): boolean {
	if (typeof name !== "string" || name.length === 0) return false;
	if (name.toLowerCase().indexOf("openclinxr_declared_upper_layers_") >= 0) return false;
	const cls = classifyGarmentMeshName(name);
	return cls === "upper" || cls === "lower" || cls === "footwear";
}

/**
 * Legacy body-surface-derived shells (`openclinxr_real_garment_*`): the rail
 * the factory generated garments from the body surface before the MakeClothes
 * fit path. Provenance, not class — a fitted makeclothes garment and a derived
 * shell can share a class. Lives here so the legacy prefix has exactly one home.
 */
export function isLegacySurfaceDerivedMeshName(name: unknown): boolean {
	if (typeof name !== "string" || name.length === 0) return false;
	return name.toLowerCase().indexOf("openclinxr_real_garment_") >= 0;
}
