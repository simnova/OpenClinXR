/**
 * Pins geometry digests into the sternal-T classify record (FINALIZE-2 C3a h9 AM1).
 *
 * For each subject (adult, pedsKevin) reads the subject's GLB — the same paths
 * the sternal-T test gates on — and writes ONLY subjects.<key>.geometrySha256
 * = glbGeometryDigest(GLB). Every other record field is history and is left
 * exactly as found (old sha256/bytes kept); the record gains geometryPinWriter
 * naming this file. A material-only post-export stage keeps the digest, so the
 * A2 identity gate stops churning this row while a rebake still moves it.
 *
 * Run from the repo root:
 * `pnpm exec tsx tools/openclinxr/evidence/humanoid-vetting/pin-sternal-t-geometry.ts
 * [--record <path> --adult-glb <path> --peds-glb <path>]` (defaults = tracked paths).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glbGeometryDigest } from "@openclinxr/factory-station-core/runner";

export const GEOMETRY_PIN_WRITER = "tools/openclinxr/evidence/humanoid-vetting/pin-sternal-t-geometry.ts";

type SternalTRecord = {
  subjects: { adult: { geometrySha256?: string }; pedsKevin: { geometrySha256?: string } };
  geometryPinWriter?: string;
  [key: string]: unknown;
};

export function pinSternalTGeometry(o: {
  recordPath: string;
  adultGlbPath: string;
  pedsGlbPath: string;
}): { adult: string; pedsKevin: string } {
  const raw = readFileSync(o.recordPath, "utf8");
  const record = JSON.parse(raw) as SternalTRecord;
  if (typeof record.subjects?.adult !== "object" || typeof record.subjects?.pedsKevin !== "object") {
    throw new Error(`pin-sternal-t-geometry: ${o.recordPath} has no subjects.adult/pedsKevin`);
  }
  const adult = glbGeometryDigest(new Uint8Array(readFileSync(o.adultGlbPath)));
  const pedsKevin = glbGeometryDigest(new Uint8Array(readFileSync(o.pedsGlbPath)));
  record.subjects.adult.geometrySha256 = adult;
  record.subjects.pedsKevin.geometrySha256 = pedsKevin;
  record.geometryPinWriter = GEOMETRY_PIN_WRITER;
  const gap = raw.match(/\n( +)"/)?.[1] ?? "  ";
  const ascii = JSON.stringify(record, null, gap).replace(/[^ -~\n]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  writeFileSync(o.recordPath, `${ascii}\n`);
  return { adult, pedsKevin };
}

const KNOWN_FLAGS = ["--record", "--adult-glb", "--peds-glb"] as const;

function usage(detail: string): Error {
  return new Error(
    `usage: pin-sternal-t-geometry.ts [--record <path> --adult-glb <path> --peds-glb <path>] (${detail}; nothing written)`,
  );
}

/** Validate all argv BEFORE the writer runs: unknown/duplicate/valueless flags exit 2 with usage, zero writes. */
function parseArgs(argv: string[]): { record: string; adultGlb: string; pedsGlb: string } {
  const root = join(import.meta.dirname, "..", "..", "..", "..");
  const seen = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag: string = argv[i] ?? "";
    if (!(KNOWN_FLAGS as readonly string[]).includes(flag)) throw usage(`unknown flag ${flag}`);
    if (seen.has(flag)) throw usage(`duplicate flag ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw usage(`flag ${flag} needs a value`);
    seen.set(flag, value);
    i++;
  }
  return {
    record: seen.get("--record") ?? join(root, "tools/openclinxr/evidence/humanoid-vetting/mpfb-nurse-sternal-t-classify.json"),
    adultGlb: seen.get("--adult-glb") ?? join(root, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb"),
    pedsGlb: seen.get("--peds-glb") ?? join(root, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb"),
  };
}

function main(argv: string[]): void {
  let parsed: { record: string; adultGlb: string; pedsGlb: string };
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
  const out = pinSternalTGeometry({ recordPath: parsed.record, adultGlbPath: parsed.adultGlb, pedsGlbPath: parsed.pedsGlb });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (process.argv[1]?.endsWith("pin-sternal-t-geometry.ts")) main(process.argv.slice(2));
