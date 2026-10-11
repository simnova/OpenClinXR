/**
 * Dump the assay's case-owned bedside approach route for the approach-take factory.
 *
 * Stages the same ward and resolves the same intent as the S1 headless assay
 * (`runApproach` via `stageWard` + `intentFor`), then writes the walked route
 * (plan waypoints XZ), the arrival heading, and the route hash the runtime will
 * compare against a grafted take's recorded hash.
 *
 * Route-hash canonical form (frozen; the factory station, the runtime wiring, and
 * this dump share it byte-for-byte):
 *   points rounded to mm: `${round(x*1000)},${round(z*1000)}` joined by `;`
 *   + `|` + `${round(headingRadians*10000)}`
 *   sha256 hex of the UTF-8 canonical string. The clip name embeds the first 16 hex chars.
 *
 * Usage:
 *   mise exec -- tsx tools/openclinxr/factory/kimodo-loop/dump_assay_route.ts \
 *     --out .openclinxr/evidence/approach-take/route.json
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  intentFor,
  stageWard,
} from "../../evidence/scene-closure/proofs/sc-05/runtime-approach-measurement.js";

export function canonicalRouteString(
  points: ReadonlyArray<{ x: number; z: number }>,
  arrivalHeadingRadians: number,
): string {
  const pointPart = points
    .map((p) => `${Math.round(p.x * 1000)},${Math.round(p.z * 1000)}`)
    .join(";");
  return `${pointPart}|${Math.round(arrivalHeadingRadians * 10000)}`;
}

export function routeHashHex(
  points: ReadonlyArray<{ x: number; z: number }>,
  arrivalHeadingRadians: number,
): string {
  return createHash("sha256").update(canonicalRouteString(points, arrivalHeadingRadians), "utf8").digest("hex");
}

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) out[argv[i]!.replace(/^--/, "")] = argv[i + 1] ?? "";
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const outPath = args["out"] ?? ".openclinxr/evidence/approach-take/route.json";
  const ward = stageWard();
  const intent = intentFor(ward);
  if (intent.refused) throw new Error(`approach refused: ${intent.reason}`);
  const points = intent.plan.waypoints.map((w) => ({ x: w.position.x, z: w.position.z }));
  let lengthM = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    lengthM += Math.hypot(b.x - a.x, b.z - a.z);
  }
  // Shape: max across-track deviation of waypoints from the start->end chord.
  const a0 = points[0]!;
  const a1 = points[points.length - 1]!;
  const dx = a1.x - a0.x;
  const dz = a1.z - a0.z;
  const chordLen = Math.hypot(dx, dz);
  let maxAcrossM = 0;
  for (const p of points) {
    const across = Math.abs((p.x - a0.x) * dz - (p.z - a0.z) * dx) / (chordLen || 1);
    if (across > maxAcrossM) maxAcrossM = across;
  }
  const arrivalHeadingRadians = intent.target.headingRadians;
  const canonical = canonicalRouteString(points, arrivalHeadingRadians);
  const hash = routeHashHex(points, arrivalHeadingRadians);
  const record = {
    schemaVersion: "openclinxr.approach-take-route.v1",
    waypointCount: points.length,
    lengthM,
    shape: maxAcrossM < 1e-6 ? "straight" : "polyline",
    maxAcrossTrackM: maxAcrossM,
    points,
    arrivalHeadingRadians,
    canonical,
    routeHash: hash,
    routeHashShort: hash.slice(0, 16),
  };
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record));
}

await main();
