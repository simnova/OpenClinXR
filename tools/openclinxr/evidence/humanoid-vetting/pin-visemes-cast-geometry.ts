/**
 * Pins geometry digests for the visemes-cast SHIPPED_UNTOUCHED rows (sibling of
 * pin-sternal-t-geometry.ts, the writer precedent). For each listed actor writes ONLY
 * pins.<actor> = glbGeometryDigest(GLB); every other record field is left as found and the
 * record gains geometryPinWriter naming this file. All four SHIPPED_UNTOUCHED rows mint
 * here (kevin included); material-only stages keep the digest. Run from the repo root:
 * `pnpm exec tsx tools/openclinxr/evidence/humanoid-vetting/pin-visemes-cast-geometry.ts
 * [--record <path> --glb <path>]` (defaults = tracked record + all listed actors).
 * --glb mints one actor (basename minus .glb must be a key below), else exit 2, zero writes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { glbGeometryDigest } from "@openclinxr/factory-station-core/runner";

export const VC_GEOMETRY_PIN_WRITER = "tools/openclinxr/evidence/humanoid-vetting/pin-visemes-cast-geometry.ts";
export const VC_PIN_RECORD_DEFAULT =
  "packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/the-applied-visemes-cast-geometry-pins.json";

const VC_ACTORS = ["mpfb-ob-patient-aisha", "mpfb-peds-parent-aisha", "mpfb-clinical-physician-adult", "mpfb-peds-nurse-kevin"] as const;
type VcActor = (typeof VC_ACTORS)[number];

type VcRecord = { pins?: Record<string, string>; geometryPinWriter?: string; [key: string]: unknown };

export function pinVisemesCastGeometry(o: { recordPath: string; glbPath?: string | undefined }): Record<string, string> {
  const root = join(import.meta.dirname, "..", "..", "..", "..");
  let actor: VcActor | undefined;
  if (o.glbPath !== undefined) {
    const name = basename(o.glbPath, ".glb");
    if (!(VC_ACTORS as readonly string[]).includes(name)) {
      throw usage(`asset ${o.glbPath} is not one of the SHIPPED_UNTOUCHED keys (${VC_ACTORS.join(", ")})`);
    }
    actor = name as VcActor;
  }
  const actors = actor !== undefined ? [actor] : [...VC_ACTORS];
  const digests = new Map<VcActor, string>();
  for (const a of actors) {
    digests.set(a, glbGeometryDigest(new Uint8Array(readFileSync(o.glbPath ?? join(root, "apps/ui-xr/public/generated-humanoids", `${a}.glb`)))));
  }
  const raw = readFileSync(o.recordPath, "utf8");
  const record = JSON.parse(raw) as VcRecord;
  if (typeof record !== "object" || record === null || Array.isArray(record)) throw usage(`${o.recordPath} is not a JSON object`);
  if (record.pins !== undefined && (typeof record.pins !== "object" || record.pins === null || Array.isArray(record.pins))) throw usage(`${o.recordPath} pins is not an object`);
  record.pins ??= {};
  for (const [a, digest] of digests) record.pins[a] = digest;
  record.geometryPinWriter = VC_GEOMETRY_PIN_WRITER;
  const gap = raw.match(/\n( +)"/)?.[1] ?? "  ";
  const ascii = JSON.stringify(record, null, gap).replace(/[^ -~\n]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  writeFileSync(o.recordPath, `${ascii}\n`);
  return Object.fromEntries(digests);
}

const KNOWN_FLAGS = ["--record", "--glb"] as const;

function usage(detail: string): Error {
  return new Error(`usage: pin-visemes-cast-geometry.ts [--record <path> --glb <path>] (${detail}; nothing written)`);
}

/** Validate all argv BEFORE the writer runs: unknown/duplicate/valueless flags exit 2 with usage, zero writes. */
function parseArgs(argv: string[]): { record: string; glb?: string | undefined } {
  const root = join(import.meta.dirname, "..", "..", "..", "..");
  const seen = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag: string = argv[i] ?? "";
    if (!(KNOWN_FLAGS as readonly string[]).includes(flag)) throw usage(`unknown flag ${flag}`);
    if (seen.has(flag)) throw usage(`duplicate flag ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value === "" || value.startsWith("--")) throw usage(`flag ${flag} needs a value`);
    seen.set(flag, value);
    i++;
  }
  return { record: seen.get("--record") ?? join(root, VC_PIN_RECORD_DEFAULT), glb: seen.get("--glb") };
}

function main(argv: string[]): void {
  let parsed: { record: string; glb?: string | undefined };
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
  let out: Record<string, string>;
  try {
    out = pinVisemesCastGeometry({ recordPath: parsed.record, glbPath: parsed.glb });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(error instanceof Error && error.message.startsWith("usage:") ? 2 : 1);
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (process.argv[1]?.endsWith("pin-visemes-cast-geometry.ts")) main(process.argv.slice(2));
