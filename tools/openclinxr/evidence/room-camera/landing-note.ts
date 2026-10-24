/**
 * Strict parser for the room-camera landing note (candidate mirror of
 * evidence/room-camera/landing-note.ts).
 *
 * Fail-closed vacuity guard: a missing marker, a decimal smuggled into an integer
 * count ("census=15/15/0.5"), a non-numeric witness ("garbage"), a `rejected=`
 * substring that is not the exact field, or a coordinate list whose token count
 * disagrees with census R must THROW — never silently default. A zero-length list
 * is legitimate ONLY when R is 0 (healthy rooms reject nothing).
 */

export interface ParsedLandingNote {
  readonly eye: readonly [number, number, number];
  readonly candidateTotal: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly witness: string;
}

const EYE = /roomCam\(derived\)=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/u;
const CENSUS = /(?:^|\s)census=(\d+)\/(\d+)\/(\d+)(?![\d.])/u;
const WITNESS_FIELD = /(?:^|\s)witness=([^\s]+)/u;
const WITNESS_VALUE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u;
const REJECTED_FIELD = /(?:^|\s)rejected=(.*?)(?=\s[a-zA-Z]+=|$)/u;
const COORD_TOKEN = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/u;

export function parseLandingNote(note: string, scenarioId: string): ParsedLandingNote {
  const m = EYE.exec(note);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new Error(`landing note missing derived eye for ${scenarioId}: ${note.slice(0, 160)}`);
  }
  const eye = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  if (eye.some((v) => !Number.isFinite(v))) {
    throw new Error(`landing note has non-finite eye for ${scenarioId}: ${note.slice(0, 160)}`);
  }
  const c = CENSUS.exec(note);
  if (!c || c[1] === undefined || c[2] === undefined || c[3] === undefined) {
    throw new Error(
      `landing note missing integer census=total/accepted/rejected for ${scenarioId}: ${note.slice(0, 160)}`,
    );
  }
  const candidateTotal = Number(c[1]);
  const acceptedCount = Number(c[2]);
  const rejectedCount = Number(c[3]);
  if (!Number.isInteger(candidateTotal) || candidateTotal <= 0) {
    throw new Error(`landing note has non-positive candidate total for ${scenarioId}: ${c[0]}`);
  }
  if (acceptedCount + rejectedCount !== candidateTotal) {
    throw new Error(
      `landing note census inconsistent for ${scenarioId}: accepted(${acceptedCount})+rejected(${rejectedCount})!=total(${candidateTotal})`,
    );
  }
  const w = WITNESS_FIELD.exec(note);
  if (!w || !w[1]) {
    throw new Error(
      `landing note missing witness field for ${scenarioId}: ${note.slice(0, 160)}`,
    );
  }
  const witnessText: string = w[1];
  const wv = WITNESS_VALUE.exec(witnessText);
  if (!wv || wv[1] === undefined || wv[2] === undefined) {
    throw new Error(
      `landing note missing numeric timeOrigin:now witness for ${scenarioId}: ${note.slice(0, 160)}`,
    );
  }
  const origin = Number(wv[1]);
  const at = Number(wv[2]);
  if (!(origin > 0) || !Number.isFinite(at) || at < 0) {
    throw new Error(`landing note has non-physical witness for ${scenarioId}: ${w && w[1]}`);
  }
  const r = REJECTED_FIELD.exec(note);
  if (!r || r[1] === undefined) {
    throw new Error(`landing note missing exact rejected= field for ${scenarioId}: ${note.slice(0, 160)}`);
  }
  const raw = r[1].trim();
  const tokens = raw === "" ? [] : raw.split(/\s+/u);
  for (const t of tokens) {
    const cm = COORD_TOKEN.exec(t);
    if (!cm || cm[1] === undefined || cm[2] === undefined) {
      throw new Error(`landing note has malformed rejected token for ${scenarioId}: ${t}`);
    }
    if (!Number.isFinite(Number(cm[1])) || !Number.isFinite(Number(cm[2]))) {
      throw new Error(`landing note has non-finite rejected token for ${scenarioId}: ${t}`);
    }
  }
  if (tokens.length !== rejectedCount) {
    throw new Error(
      `landing note rejected list has ${tokens.length} tokens but census R=${rejectedCount} for ${scenarioId}`,
    );
  }
  return { eye, candidateTotal, acceptedCount, rejectedCount, witness: witnessText };
}

/** Copying one computed reading repeats its witness and must fail. */
export function assertUniqueDerivationWitnesses(witnesses: readonly string[]): void {
  if (witnesses.length === 0) throw new Error("no derivation witnesses to check");
  const dupes = witnesses.filter((w, i) => witnesses.indexOf(w) !== i);
  if (dupes.length > 0) {
    throw new Error(`duplicate derivation witness (${dupes[0]}): a copied reading is not a re-derivation`);
  }
}
