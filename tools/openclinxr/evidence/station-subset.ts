/**
 * Seeded 2-station sample for the per-push station sweep (C1).
 *
 * CI serial-browser context hit its step bound sweeping all 15 stations every push;
 * per push we sweep a seeded sample, nightly we sweep everything. `full: true`
 * means "measure the whole input list" (env unset, or n >= list length).
 */

export type StationSubset = {
  ids: string[];
  seed: string | null;
  full: boolean;
};

/** The selection a measured report records (R6; null when the run measured everything). */
export type SampleRecord = {
  seed: string;
  ids: string[];
};

export const STATION_SAMPLE_ENV = "OPENCLINXR_STATION_SAMPLE";
export const STATION_SAMPLE_SEED_ENV = "OPENCLINXR_STATION_SAMPLE_SEED";

/**
 * FNV-1a 32-bit string hash. Stable across processes (unlike object key order
 * tricks or Math.random), so the same seed picks the same stations on every
 * runner. Named here because the brief requires the hash to have a name.
 */
export function hashSeedFNV1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Fisher-Yates with an injected deterministic stream (shared by both selectors). */
function shuffled<T>(ids: T[], rand: () => number): T[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
/** Mulberry32 — tiny deterministic PRNG driven by the seed hash. */
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseSampleSize(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `station-subset: ${STATION_SAMPLE_ENV} must be a positive integer, got ${JSON.stringify(raw)} `
        + `(set ${STATION_SAMPLE_ENV} and ${STATION_SAMPLE_SEED_ENV} together, or unset both for a full sweep)`,
    );
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(
      `station-subset: ${STATION_SAMPLE_ENV} must be a positive integer, got ${JSON.stringify(raw)} `
        + `(set ${STATION_SAMPLE_ENV} and ${STATION_SAMPLE_SEED_ENV} together, or unset both for a full sweep)`,
    );
  }
  return n;
}

export function selectStationSubset(
  allIds: string[],
  env: NodeJS.ProcessEnv = process.env,
): StationSubset {
  const raw = env[STATION_SAMPLE_ENV];
  if (raw === undefined || raw === "") {
    return { ids: [...allIds], seed: null, full: true };
  }
  const n = parseSampleSize(raw);
  const seed = env[STATION_SAMPLE_SEED_ENV];
  if (seed === undefined || seed === "") {
    throw new Error(
      `station-subset: ${STATION_SAMPLE_ENV}=${JSON.stringify(raw)} requires a non-empty `
        + `${STATION_SAMPLE_SEED_ENV} (set ${STATION_SAMPLE_ENV} and ${STATION_SAMPLE_SEED_ENV} together, `
        + `or unset both for a full sweep)`,
    );
  }
  if (n >= allIds.length) {
    return { ids: [...allIds], seed: null, full: true };
  }
  const rand = mulberry32(hashSeedFNV1a(seed));
  const ids = shuffled([...allIds].sort(), rand).slice(0, n);
  process.stdout.write(`station-subset: seed=${seed} n=${n} ids=${ids.join(",")}\n`);
  return { ids, seed, full: false };
}
