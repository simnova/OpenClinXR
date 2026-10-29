/** source247: shared self-contained body-garment mesh-name recognizer. Bounded known prefix only. */
export function isBodyGarmentMeshName(name: unknown): boolean {
	const KNOWN_BODY_GARMENT_TOKENS = [
		"scrub_shirt",
		"scrub_pants",
		"bootcut_jeans_pants",
		"straight_leg_jeans_pants",
		"female_tight_jeans_pants",
		"cargo_pants",
		"toigo_t_shirt",
		"lab_coat",
	];
	if (typeof name !== "string" || name.length === 0) return false;
	const n = name.toLowerCase();
	if (
		/(^|_)hair(_|\.|$)|footwear|_shoes?(_|\.|$)|_boots?(_|\.|$)|(^|_)eyes?(_|\.|$)|(^|_)skin(_|\.|$)/.test(
			n,
		)
	)
		return false;
	if (n.indexOf("openclinxr_real_garment_") >= 0) return true;
	const prefix = "makeclothes_library_";
	const at = n.indexOf(prefix);
	if (at < 0) return false;
	const rest = n.slice(at + prefix.length);
	return KNOWN_BODY_GARMENT_TOKENS.some(
		(t) =>
			rest === t || rest.indexOf(t + "_") === 0 || rest.indexOf(t + ".") === 0,
	);
}
