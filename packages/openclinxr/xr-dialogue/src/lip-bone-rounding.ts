/**
 * Runtime lip-bone rounding for O/U/CH/RR (lip-bones2 slice).
 *
 * WHY: the MPFB morphs purse the ring partway (pixel E/O/U outer
 * 569/478/528) but the 22-bone lip rig owns the visible commissure tissue
 * (oris03/oris04 dominate the oris ring; risorius02/03 own ~none of it —
 * headless screen: risorius02.L:x +5mm moves the ring p95 by 2px while
 * oris04.L:x moves it 28px). This module drives rounding on the bones at
 * runtime instead of the morphs. No GLB change.
 *
 * MECHANISM: per-viseme position offsets (bone-local millimetres) summed
 * per bone and scaled by the already-enveloped O/U/CH/RR morph weights the
 * wire computed, so bone travel inherits the envelope per-frame bound.
 * Weight 0 restores the bind pose from the cached rest position.
 * The table is injectable per call so the evidence probe can sweep bone
 * sets through this exact code path; production passes no table.
 *
 * claimScope: lip-bone position offsets for rounding only.
 * notEvidenceFor: anatomy / bind-pose / upper-teeth show.
 */

export type LipRoundingViseme = "O" | "U" | "CH" | "RR";

export type LipBoneChannel = "x" | "z";

export type LipRoundingRow = {
  viseme: LipRoundingViseme;
  bone: string;
  channel: LipBoneChannel;
  /** Offset at weight 1, millimetres in bone-local units. */
  fullMm: number;
  /** One-line probe citation for this amount. */
  source: string;
};

/**
 * Committed probe-backed table (lip-bones2). Probe rows are browser renders
 * through this exact code path, pixel-measured with the pixel lip
 * instrument (outer width vs E, aperture h/w, 3/4 silhouette forward vs E,
 * central lower-teeth counts). oris04 owns the visible commissure tissue
 * (oris03/oris04 dominate the oris ring headlessly; risorius02/03 own ~none
 * of it, and the attempt-1 risorius set showed ~0px bone-driven width delta
 * where the coordinator graded the opening the same width). Corner sign is
 * bone-local (+X on .L, -X on .R); midline is +Z forward.
 */
export const LIP_ROUNDING_TABLE: readonly LipRoundingRow[] = [
  // O: lb2-probe T9-O -> pixel outer 392 (-31.1% vs E), hw 0.181
  // (base 0.098), fwd +6px vs E, lowerTeeth 0, upperTeeth unchanged (3810).
  // Philtrum-lump round: oris05 owns the philtrum/upper-lip skin (dominant
  // verts y303-485) while oris01 owns the lower lip (y536-657); o05z3
  // pushed the philtrum silhouette 5px forward with a shadow band, o05z1
  // removed the lump but collapsed lip forward below the +4px gate, so the
  // push settles at o05z2.5 (lump silhouette -1.8px vs -5.0, band +1.1).
  { viseme: "O", bone: "oris04.L", channel: "x", fullMm: 6, source: "lb2-probe T9-O outer 392 -31.1% hw 0.181 fwd +6 lower 0" },
  { viseme: "O", bone: "oris04.R", channel: "x", fullMm: -6, source: "lb2-probe T9-O outer 392 -31.1% hw 0.181 fwd +6 lower 0" },
  { viseme: "O", bone: "oris01", channel: "z", fullMm: 3, source: "lb2-probe T9-O lower-lip forward (oris01 owns lower lip)" },
  { viseme: "O", bone: "oris05", channel: "z", fullMm: 2.5, source: "lb2-probe T9-O philX -1.8 vs -5.0 at z3, fwd +6 keeps gate" },
  // U: lb2-probe T9-U -> pixel outer 463 (-18.6% vs E), hw 0.158
  // (base 0.098), fwd +11px vs E, lowerTeeth 0, upperTeeth unchanged (3632).
  { viseme: "U", bone: "oris04.L", channel: "x", fullMm: 6, source: "lb2-probe T9-U outer 463 -18.6% hw 0.158 fwd +11 lower 0" },
  { viseme: "U", bone: "oris04.R", channel: "x", fullMm: -6, source: "lb2-probe T9-U outer 463 -18.6% hw 0.158 fwd +11 lower 0" },
  { viseme: "U", bone: "oris01", channel: "z", fullMm: 3, source: "lb2-probe T9-U lower-lip forward (oris01 owns lower lip)" },
  { viseme: "U", bone: "oris05", channel: "z", fullMm: 2.5, source: "lb2-probe T9-U philX -3.6 vs -7.0 at z3, fwd +11 keeps gate" },
];

export type LipBoneLike = {
  name?: string;
  isBone?: boolean;
  type?: string;
  position?: { x: number; y: number; z: number };
  userData?: Record<string, unknown>;
};

export type LipRoundingRootLike = {
  traverse: (callback: (object: unknown) => void) => void;
};

/**
 * Read the rounding drive weights from enveloped morph weights.
 * Groups case-insensitively: O absorbs OH, U absorbs OU (dialogue spellings).
 */
export function lipRoundingScales(weights: Record<string, number>): Record<LipRoundingViseme, number> {
  const group = (tokens: readonly string[]): number => {
    let best = 0;
    for (const [key, value] of Object.entries(weights)) {
      const lower = key.toLowerCase();
      const token = lower.startsWith("viseme_") ? lower.slice("viseme_".length) : lower;
      if ((tokens as readonly string[]).includes(token)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > best) best = numeric;
      }
    }
    return Math.min(1, Math.max(0, best));
  };
  return {
    O: group(["o", "oh"]),
    U: group(["u", "ou"]),
    CH: group(["ch"]),
    RR: group(["rr"]),
  };
}

/** three.js `PropertyBinding.sanitizeNodeName` strips dots at load, so the live
 * graph carries `risorius02L` for the stored `risorius02.L` (same convention as
 * gaze-drives-eyes.ts). Match sanitised on both sides so the table works
 * on live graphs and headless scenes alike. */
function sanitisedBoneName(name: string): string {
  return name.replace(/\./g, "");
}

function findLipBones(root: LipRoundingRootLike, table: readonly LipRoundingRow[]): LipBoneLike[] {
  const seen = new Set<LipBoneLike>();
  const wanted = new Set(table.map((row) => sanitisedBoneName(row.bone)));
  const consider = (candidate: unknown): void => {
    const bone = candidate as LipBoneLike | null | undefined;
    if (!bone || typeof bone.name !== "string") return;
    if (!wanted.has(sanitisedBoneName(bone.name))) return;
    const isBone = bone.isBone === true || bone.type === "Bone";
    if (!isBone) return;
    if (!bone.position || typeof bone.position.x !== "number") return;
    seen.add(bone);
  };
  root.traverse((object) => {
    const node = object as LipBoneLike & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: LipBoneLike[] };
    };
    consider(node);
    if (node.isSkinnedMesh && Array.isArray(node.skeleton?.bones)) {
      for (const bone of node.skeleton.bones) consider(bone);
    }
  });
  return [...seen];
}

/**
 * Apply rounding offsets for the given enveloped weights. Rest local position
 * is cached on first touch so weight 0 restores the bind pose. Offsets are
 * linear in the weights, so per-frame bone travel inherits the weight
 * envelope bound. Returns bones touched. Pass `table` only from the
 * evidence probe; production uses the default.
 */
export function applyLipBoneRoundingToRoot(
  root: LipRoundingRootLike,
  weights: Record<string, number>,
  table: readonly LipRoundingRow[] = LIP_ROUNDING_TABLE,
): number {
  const bones = findLipBones(root, table);
  if (bones.length === 0) return 0;
  const scales = lipRoundingScales(weights);
  const byBone = new Map<string, { x: number; z: number }>();
  for (const row of table) {
    const scale = scales[row.viseme];
    if (!scale) continue;
    const key = sanitisedBoneName(row.bone);
    const entry = byBone.get(key) ?? { x: 0, z: 0 };
    entry[row.channel] += scale * row.fullMm;
    byBone.set(key, entry);
  }
  for (const bone of bones) {
    const ud = (bone.userData ??= {});
    if (!bone.position) continue;
    const rest = ud.openClinXrLipRest as { x: number; y: number; z: number } | undefined;
    if (!rest || typeof rest.x !== "number" || typeof rest.y !== "number" || typeof rest.z !== "number") {
      ud.openClinXrLipRest = { x: bone.position.x, y: bone.position.y, z: bone.position.z };
    }
    const cached = ud.openClinXrLipRest as { x: number; y: number; z: number };
    const offset = byBone.get(sanitisedBoneName(bone.name ?? ""));
    bone.position.x = cached.x + (offset?.x ?? 0) / 1000;
    bone.position.z = cached.z + (offset?.z ?? 0) / 1000;
  }
  return bones.length;
}
