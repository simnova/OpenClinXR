/**
 * Source204 — actor asset attribution (pure, producer-side).
 *
 * Prefers the actual directly-tagged asset path tied to an actor id over
 * inherited mesh/object names or positional order. Missing or ambiguous
 * direct evidence stays UNKNOWN (fail-closed); callers must not promote a
 * name/order guess into a successful identity.
 *
 * Only normalization: the known public filesystem prefix
 * `apps/ui-xr/public` equals the served-URL namespace `/`. No
 * basename-contains matching is used for the identity predicate.
 */

export type TaggedAssetRow = {
	actorId: string;
	assetPath: string;
};

export type ActorAssetVerdict =
	| { status: "matched"; path: string; raw: string }
	| { status: "ambiguous"; raw: string[] }
	| { status: "missing" };

const PUBLIC_FS_PREFIX = "apps/ui-xr/public/";

/** Map a cast-table filesystem path into the served-URL namespace. */
export function normalizePublicAssetPath(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith(PUBLIC_FS_PREFIX)) {
		return `/${trimmed.slice(PUBLIC_FS_PREFIX.length)}`;
	}
	return trimmed;
}

/**
 * Resolve the loaded asset path for one actor id from directly-tagged rows.
 * Exact actor-id equality only. Zero rows → missing. More than one distinct
 * normalized path → ambiguous. Raw inputs are retained on the verdict.
 */
export function resolveActorLoadedPath(
	rows: readonly TaggedAssetRow[],
	targetActorId: string,
): ActorAssetVerdict {
	const raws = rows
		.filter((row) => row.actorId === targetActorId)
		.map((row) => row.assetPath)
		.filter((p): p is string => typeof p === "string" && p.length > 0);
	if (raws.length === 0) return { status: "missing" };
	const distinct = [...new Set(raws.map(normalizePublicAssetPath))];
	if (distinct.length > 1) return { status: "ambiguous", raw: raws };
	return { status: "matched", path: distinct[0]!, raw: raws[0]! };
}
