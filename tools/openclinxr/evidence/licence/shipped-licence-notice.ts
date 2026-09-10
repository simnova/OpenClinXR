/**
 * The licence notice that travels WITH the shipped bytes.
 *
 * MEASURED 2026-09-10, and it is the reason this module exists: every shipped humanoid's glTF
 * `asset` block is exactly `{generator, version}`. No `copyright`, no `extras`, on any of thirteen —
 * and nothing in the tree ever set them. The bake is not dropping a field we wrote; we never wrote
 * one. So a `.glb` served out of Vite's public directory arrives at a stranger as a notice-free,
 * all-rights-cleared-looking object, whatever its sources actually were.
 *
 * WHY THAT MATTERS DIFFERENTLY PER LICENCE, because collapsing them is how this gets over-built:
 *   - CC0 waives notice and attribution. A notice-free CC0 mesh is what CC0 is FOR. No duty.
 *   - CC-BY carries a live obligation, and a website credits page discharges it for a learner who
 *     sees the page. It does NOT reach someone who fetches the `.glb` URL directly, and that person
 *     is a real distribution channel here because the file is publicly addressable.
 *   - Copyleft would make notice-stripping a second violation on top of the first. Nothing shipped
 *     carries it today (`strings | grep -i agpl` over all thirteen: zero hits) and the bake gate
 *     refuses it fail-closed, which is why this module never emits a copyleft label. Labelling a
 *     file with terms the policy forbids would be worse than the blank block it replaces.
 *
 * WHAT THIS IS NOT. It is not SPDX-in-every-primitive, not a per-component table in `extras`, and
 * not a credit rendered in the headset. CC-BY 4.0 3(a)(2) asks for a reasonable manner given the
 * medium; for a fetchable mesh that is author + licence + a pointer, with the enumeration living at
 * the pointer. Consulted grok-4.6 over four rounds on exactly this and it argued the enumeration-in-
 * `copyright` and structured-`extras` designs are both misuses of the field — accurate and unread.
 *
 * THE SHAPE THAT MADE THIS WORTH WRITING AS A FUNCTION. The first version in my head was
 * `if (body has the scrub kit) copyright = "…WojackOWL…"`. That reproduces the hole for the next
 * CC-BY asset anyone consumes, and the whole reason this defect existed is that nobody enumerated
 * what the bake actually eats. So the notice is DERIVED from the component table: every `cc-by`
 * entry contributes its own credit, WojackOWL is the first row rather than the function, and a body
 * with no CC-BY component gets no notice rather than a decorative one.
 */

import { SUBCOMPONENT_CLEARANCE, type SubcomponentClearance } from "./selected-scene-asset-lineage.js";

/** Where the human-readable enumeration lives. A published mesh points at this and it must resolve. */
export const NOTICES_BASE_URL = "https://developers.simnova.com/OpenClinXR/attribution.html";

/**
 * The components of `meshNames` that carry an attribution obligation, in table order.
 *
 * Table order, not mesh order, so two bodies containing the same kit produce byte-identical notices
 * regardless of how the exporter happened to sequence their meshes.
 */
export function attributableComponents(
  meshNames: readonly string[],
  table: readonly SubcomponentClearance[] = SUBCOMPONENT_CLEARANCE,
): readonly SubcomponentClearance[] {
  return table.filter(
    (entry) => entry.rights === "cc-by" && meshNames.some((name) => name.includes(entry.meshMatch)),
  );
}

/**
 * The `asset.copyright` string for a body, or `undefined` when it owes no attribution.
 *
 * `undefined` rather than a placeholder is deliberate: a CC0-only body has no obligation, and
 * stamping it with a notice anyway would assert a restriction that does not exist. The eight bodies
 * that carry no CC-BY component are the control this module is tested against.
 *
 * The word "Contains" is load-bearing and a later tidy-up must not remove it. `CC-BY-4.0 WojackOWL`
 * as a whole-file label would over-claim the CC0 base mesh, the CC0 hair and the first-party
 * geometry welded into the same file; `Contains …` scopes the claim to the part it is true of.
 */
export function deriveCopyrightNotice(input: {
  meshNames: readonly string[];
  bodyId: string;
  table?: readonly SubcomponentClearance[];
  noticesBaseUrl?: string;
}): string | undefined {
  const owed = attributableComponents(input.meshNames, input.table ?? SUBCOMPONENT_CLEARANCE);
  if (owed.length === 0) return undefined;

  // De-duplicated: a kit whose shirt and pants are separate meshes owes ONE credit, not two.
  const credits = [...new Set(owed.map((entry) => entry.attribution ?? entry.component))];
  const url = `${input.noticesBaseUrl ?? NOTICES_BASE_URL}#${input.bodyId}`;
  return `Contains ${credits.join("; ")}. Notices: ${url}`;
}

/** The body id used as the notice's URL fragment: the shipped file's basename without `.glb`. */
export function bodyIdFromAssetPath(assetPath: string): string {
  return (assetPath.split("/").pop() ?? assetPath).replace(/\.glb$/u, "");
}
