/**
 * Aisha sweater-stage selection split (tsk_4c6a7143f7dff5e0): the SINGLE shared
 * predicate for the T3 Aisha exception in
 * the-shipped-teeth-carry-their-texture.test.ts (aishaSweaterRowOrThrow).
 * No second copy of this rule exists.
 *
 * Unlike the stage gate's sha-pinned predicate (asset-registry
 * isAishaSweaterStageSplit, which pins the r2 run's output indices), this
 * predicate is keyed to the EXACT 20-face S2 selection read from the committed
 * tools/openclinxr/asset-pipeline/makeclothes/data/aisha-sweater-selection.json
 * (sha256 12d3c9a2...; L 761..768,777,778 + R 4300..4307,4313,4314): the hidden
 * prim's face triangles must be exactly the selection faces' baseline triangles
 * and the kept prim every other baseline face — as canonical vertex triples, so
 * a reordered-but-identical split still passes while any added, dropped, or
 * altered triangle refuses. Attribute/morph accessor identity, material
 * bindings, and chain order mirror the E9 precedent.
 *
 * Pure (no `node:` or glTF imports): the caller decodes triples and reads the
 * selection file; faces are face ids into the baseline skin prim's triangle
 * list. Fits the asset-registry browser-safe pattern.
 */

/** Repo-relative path of the committed 20-face selection (faces are read from it, never hand-typed). */
export const AISHA_SWEATER_SELECTION_PATH =
  "tools/openclinxr/asset-pipeline/makeclothes/data/aisha-sweater-selection.json";
/**
 * sha256 of the committed 20-face selection file (measured with
 * `shasum -a 256`, never plain shasum). The T3 caller verifies the file it
 * read against this pin before using its faces: a swapped valid 20-face
 * selection refuses, so it cannot pass the predicate with a matching split.
 */
export const AISHA_SWEATER_SELECTION_SHA256 =
  "12d3c9a2301dd9362b20f7c531876b55cff854d26eefcad48de56a22ffb5eee3";
/** The selection pins exactly 20 faces; any other count refuses (forces review). */
export const AISHA_SWEATER_SELECTION_FACE_COUNT = 20;
/** argv fragment identifying the sweater rehide level in a byteLineage chain. */
export const AISHA_SWEATER_TOOL_MARKER = "rehide-aisha-shoulder-skin.py";
/** argv fragment identifying the teeth-swap level the rehide must be newer than. */
export const AISHA_SWAP_TOOL_MARKER = "swap_teeth.py";
/** Exact hide material the sweater stage writes. */
export const AISHA_SWEATER_HIDE_MATERIAL =
  "openclinxr_hidden_upper_mpfb_ob_patient_aisha_v1_body_mesh";
/** Material index of the exact hide material in the pre-image and the live GLB. */
export const AISHA_SWEATER_HIDE_MATERIAL_INDEX = 5;

export type AishaSweaterSelectionWitness = {
  /** Canonical (sorted-vertex) triples of the baseline skin prim, in face-id order. */
  baselineFaceTriples: ReadonlyArray<readonly [number, number, number]>;
  /** Canonical triples of the live kept prim, in prim order. */
  keptFaceTriples: ReadonlyArray<readonly [number, number, number]>;
  /** Canonical triples of the live hidden prim, in prim order. */
  hiddenFaceTriples: ReadonlyArray<readonly [number, number, number]>;
  /** Face ids hidden by this stage, read from the committed selection file. */
  selectionFaces: readonly number[];
  /** kept prim's attribute accessor indices by semantic (must equal the baseline prim's). */
  keptAttrAccessors: Record<string, number>;
  /** hidden prim's attribute accessor indices by semantic (must equal the baseline prim's). */
  hiddenAttrAccessors: Record<string, number>;
  /** pre-stage prim's attribute accessor indices by semantic. */
  baselineAttrAccessors: Record<string, number>;
  /** kept prim's morph-target accessor indices by target then semantic (must equal the baseline prim's). */
  keptTargetAccessors: ReadonlyArray<Record<string, number>>;
  /** hidden prim's morph-target accessor indices by target then semantic (must equal the baseline prim's). */
  hiddenTargetAccessors: ReadonlyArray<Record<string, number>>;
  /** pre-stage prim's morph-target accessor indices by target then semantic. */
  baselineTargetAccessors: ReadonlyArray<Record<string, number>>;
  /** material index of the kept prim (must equal the baseline prim's). */
  keptMaterialIndex: number;
  /** material index of the hidden prim (must be the exact stage hide material index). */
  hiddenMaterialIndex: number;
  /** material index of the pre-stage prim. */
  baselineMaterialIndex: number;
  /** material name of the kept prim (must equal the baseline prim's). */
  keptMaterial: string;
  /** material name of the hidden prim (must be the exact stage hide material). */
  hiddenMaterial: string;
  /** material name of the pre-stage prim. */
  baselineMaterial: string;
  /**
   * Newest-first derivationArgv chain (e.g. sidecar byteLineage walked newest
   * first). Where given, the chain must contain a sweater rehide level newer
   * than the teeth-swap level.
   */
  derivationArgvs?: readonly (readonly string[] | undefined)[] | undefined;
};

function canon(triple: readonly [number, number, number]): string {
  return [...triple].sort((a, b) => a - b).join(",");
}

function attrAccessorsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, i) => {
    const otherKey = keysB[i];
    if (otherKey === undefined) throw new Error(`Missing attribute accessor key at index ${i}`);
    return key === otherKey && a[key] === b[otherKey];
  });
}

function targetAccessorsEqual(
  a: ReadonlyArray<Record<string, number>>,
  b: ReadonlyArray<Record<string, number>>,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((target, i) => {
    const otherTarget = b[i];
    if (otherTarget === undefined) throw new Error(`Missing morph target accessors at index ${i}`);
    return attrAccessorsEqual(target, otherTarget);
  });
}

/**
 * Null iff the kept/hidden pair is exactly the selection-keyed sweater split;
 * otherwise names the first failing check with the offending face id or triple
 * (counterweight REDs surface this string, so it must name the cause).
 */
export function aishaSweaterSelectionSplitWhyNot(w: AishaSweaterSelectionWitness): string | null {
  const n = w.baselineFaceTriples.length;
  if (w.selectionFaces.length !== AISHA_SWEATER_SELECTION_FACE_COUNT) {
    return `selection has ${w.selectionFaces.length} faces, expected ${AISHA_SWEATER_SELECTION_FACE_COUNT}`;
  }
  const seen = new Set<number>();
  for (const f of w.selectionFaces) {
    if (!Number.isInteger(f) || f < 0 || f >= n) return `selection face ${f} out of range (0..${n - 1})`;
    if (seen.has(f)) return `selection face ${f} repeats`;
    seen.add(f);
  }
  const baselineCanon = w.baselineFaceTriples.map(canon);
  const byCanon = new Map<string, number[]>();
  baselineCanon.forEach((c, f) => {
    const list = byCanon.get(c) ?? [];
    list.push(f);
    byCanon.set(c, list);
  });
  const countOf = (canons: readonly string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const c of canons) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  };
  const expectedHidden = w.selectionFaces
    .map((f) => {
      const triangle = baselineCanon[f];
      if (triangle === undefined) throw new Error(`Missing baseline triangle for selection face ${f}`);
      return triangle;
    })
    .sort();
  const actualHidden = w.hiddenFaceTriples.map(canon).sort();
  const expHiddenCount = countOf(expectedHidden);
  const actHiddenCount = countOf(actualHidden);
  for (const [c, k] of actHiddenCount) {
    if ((expHiddenCount.get(c) ?? 0) < k) {
      const face = (byCanon.get(c) ?? [])[0];
      return face === undefined
        ? `hidden triangle (${c}) matches no baseline face (geometry changed)`
        : `hidden triangle (${c}) matches baseline face ${face} which is NOT in the 20-face selection`;
    }
  }
  for (const [c, k] of expHiddenCount) {
    if ((actHiddenCount.get(c) ?? 0) < k) {
      const faces = byCanon.get(c);
      const face = faces?.find((f) => seen.has(f)) ?? faces?.[0];
      if (face === undefined) throw new Error(`Missing baseline face for expected hidden triangle (${c})`);
      return `selection face ${face} (tri ${c}) missing from the hidden prim`;
    }
  }
  if (actualHidden.length !== expectedHidden.length) {
    return `hidden prim has ${actualHidden.length} triangles, expected ${expectedHidden.length}`;
  }
  const expectedKept = baselineCanon.filter((_c, f) => !seen.has(f)).sort();
  const actualKept = w.keptFaceTriples.map(canon).sort();
  const expKeptCount = countOf(expectedKept);
  const actKeptCount = countOf(actualKept);
  for (const [c, k] of actKeptCount) {
    if ((expKeptCount.get(c) ?? 0) < k) {
      const face = (byCanon.get(c) ?? [])[0];
      return face === undefined
        ? `kept triangle (${c}) matches no baseline face (geometry changed)`
        : `kept triangle (${c}) matches baseline face ${face} which the selection hides (kept/hidden overlap)`;
    }
  }
  for (const [c, k] of expKeptCount) {
    if ((actKeptCount.get(c) ?? 0) < k) {
      const faces = byCanon.get(c);
      const face = faces?.find((f) => !seen.has(f)) ?? faces?.[0];
      if (face === undefined) throw new Error(`Missing baseline face for expected kept triangle (${c})`);
      return `baseline face ${face} (tri ${c}) missing from the kept prim (triangle lost)`;
    }
  }
  if (actualKept.length !== expectedKept.length) {
    return `kept prim has ${actualKept.length} triangles, expected ${expectedKept.length}`;
  }
  if (!attrAccessorsEqual(w.keptAttrAccessors, w.baselineAttrAccessors)) {
    return "kept prim attribute accessors != baseline prim attribute accessors";
  }
  if (!attrAccessorsEqual(w.hiddenAttrAccessors, w.baselineAttrAccessors)) {
    return "hidden prim attribute accessors != baseline prim attribute accessors";
  }
  if (!targetAccessorsEqual(w.keptTargetAccessors, w.baselineTargetAccessors)) {
    return "kept prim morph-target accessors != baseline prim morph-target accessors";
  }
  if (!targetAccessorsEqual(w.hiddenTargetAccessors, w.baselineTargetAccessors)) {
    return "hidden prim morph-target accessors != baseline prim morph-target accessors";
  }
  if (w.keptMaterialIndex !== w.baselineMaterialIndex) return "kept prim material index != baseline material index";
  if (w.keptMaterial !== w.baselineMaterial) return "kept prim material != baseline material";
  if (w.hiddenMaterialIndex !== AISHA_SWEATER_HIDE_MATERIAL_INDEX) {
    return `hidden prim material index ${w.hiddenMaterialIndex} != ${AISHA_SWEATER_HIDE_MATERIAL_INDEX}`;
  }
  if (w.hiddenMaterial !== AISHA_SWEATER_HIDE_MATERIAL) {
    return `hidden prim material ${w.hiddenMaterial} != ${AISHA_SWEATER_HIDE_MATERIAL}`;
  }
  if (w.derivationArgvs !== undefined) {
    const joined = w.derivationArgvs.map((argv) => (argv ?? []).join(" "));
    const sweater = joined.findIndex((text) => text.includes(AISHA_SWEATER_TOOL_MARKER));
    const swap = joined.findIndex((text) => text.includes(AISHA_SWAP_TOOL_MARKER));
    if (sweater < 0 || swap < 0 || !(sweater < swap)) {
      return `chain has no sweater rehide level newer than the teeth-swap level (sweater ${sweater}, swap ${swap})`;
    }
  }
  return null;
}

/** True iff the kept/hidden pair is exactly the selection-keyed sweater split. */
export function isAishaSweaterSelectionSplit(w: AishaSweaterSelectionWitness): boolean {
  return aishaSweaterSelectionSplitWhyNot(w) === null;
}

/**
 * Parse the selection faces the caller read from disk, refusing unless the
 * file bytes match the pinned sha. The caller hashes what it read and passes
 * both here (this module stays pure: no fs or crypto imports); a mismatch
 * throws naming the actual and pinned digests before any face is used.
 */
export function aishaSweaterSelectionFacesOrThrow(fileText: string, fileSha256: string): readonly number[] {
  if (fileSha256 !== AISHA_SWEATER_SELECTION_SHA256) {
    throw new Error(
      `aisha sweater selection: refusing — file sha256 ${fileSha256} != pinned ${AISHA_SWEATER_SELECTION_SHA256} (${AISHA_SWEATER_SELECTION_PATH}); the 20-face selection changed without review.`,
    );
  }
  let faces: unknown;
  try {
    faces = (JSON.parse(fileText) as { faces?: unknown }).faces;
  } catch {
    throw new Error(
      `aisha sweater selection: refusing — ${AISHA_SWEATER_SELECTION_PATH} is not JSON (pinned sha ${AISHA_SWEATER_SELECTION_SHA256}).`,
    );
  }
  if (
    !Array.isArray(faces) ||
    faces.length !== AISHA_SWEATER_SELECTION_FACE_COUNT ||
    !faces.every((face) => Number.isInteger(face))
  ) {
    const got = Array.isArray(faces) ? faces.length : typeof faces;
    throw new Error(
      `aisha sweater selection: refusing — ${AISHA_SWEATER_SELECTION_PATH} carries ${String(got)} faces, expected ${AISHA_SWEATER_SELECTION_FACE_COUNT} integer faces (pinned sha ${AISHA_SWEATER_SELECTION_SHA256}).`,
    );
  }
  return faces as number[];
}
