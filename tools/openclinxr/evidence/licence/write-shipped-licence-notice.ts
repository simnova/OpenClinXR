/**
 * Write each shipped humanoid's derived `asset.copyright` into its own bytes.
 *
 * The notice is DERIVED, never typed: `deriveCopyrightNotice` reads the mesh names actually present
 * in the file and returns the credits its CC-BY components oblige, or `undefined` when a body owes
 * nothing. This CLI only persists that answer, so the string in the file and the string the test
 * expects come from one function and cannot drift apart.
 *
 * WHY IT EDITS THE GLB IN PLACE RATHER THAN RE-BAKING. Re-baking thirteen humanoids to add a
 * metadata field would change every output hash and invalidate provenance records that pin them,
 * for a change that touches no geometry. This rewrites the JSON chunk's `asset` block and nothing
 * else; the binary chunk is copied byte-for-byte.
 *
 * RUN IT LAST. Whatever runs after this — an optimise, a weld, a quantise — may drop the field
 * again. The gate that proves it survived reads the file on disk, so a pass here is not the proof;
 * `the-shipped-bytes-carry-their-attribution.test.ts` clause (5) is.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bodyIdFromAssetPath, deriveCopyrightNotice } from "./shipped-licence-notice.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const HUMANOIDS = path.join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

type Glb = { json: Record<string, unknown>; jsonStart: number; jsonLength: number; bytes: Buffer };

function readGlb(file: string): Glb {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Record<string, unknown>;
  return { json, jsonStart: 20, jsonLength, bytes };
}

/** Re-emit the container with a new JSON chunk, padded to the 4-byte alignment glTF requires. */
function writeGlb(file: string, glb: Glb, json: Record<string, unknown>): void {
  const encoded = Buffer.from(JSON.stringify(json), "utf8");
  const padding = (4 - (encoded.length % 4)) % 4;
  const chunk = Buffer.concat([encoded, Buffer.alloc(padding, 0x20)]);
  const tail = glb.bytes.subarray(glb.jsonStart + glb.jsonLength);
  const header = Buffer.alloc(20);
  glb.bytes.copy(header, 0, 0, 20);
  header.writeUInt32LE(chunk.length, 12);
  const total = header.length + chunk.length + tail.length;
  header.writeUInt32LE(total, 8);
  writeFileSync(file, Buffer.concat([header, chunk, tail]));
}


/**
 * Re-record the sidecar's byte identity, because this tool just changed the bytes.
 *
 * `the-shipped-humanoids-hash-to-their-provenance.test.ts` is a shrink-only ratchet, and its header
 * forbids "fixing" a mismatch by stamping whatever is on disk today. This is the other branch that
 * header names: re-recording the hash in the same change that explains why the bytes moved. What
 * moved is the glTF `asset` block and nothing else — the binary chunk is copied byte-for-byte — so
 * leaving the sidecar stale would be the silent option, not the safe one.
 */
function rerecordProvenance(glbPath: string): void {
  const sidecar = glbPath.replace(/\.glb$/u, ".provenance.json");
  if (!existsSync(sidecar)) return;
  const bytes = readFileSync(glbPath);
  const record = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
  record["outputSha256"] = createHash("sha256").update(bytes).digest("hex");
  record["outputBytes"] = bytes.byteLength;
  record["licenceNoticeWrittenAt"] = new Date().toISOString();
  record["licenceNoticeNote"] =
    "asset.copyright written by tools/openclinxr/evidence/licence/write-shipped-licence-notice.ts from the "
    + "components actually present in this file. Geometry, materials and animations are unchanged; only the "
    + "glTF asset block moved, which is why outputSha256 and outputBytes are re-recorded here.";
  writeFileSync(sidecar, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function main(): void {
  const check = process.argv.includes("--check");
  const wrong: string[] = [];
  let written = 0;
  let owedNothing = 0;

  for (const file of readdirSync(HUMANOIDS).filter((name) => name.endsWith(".glb")).sort()) {
    const full = path.join(HUMANOIDS, file);
    const glb = readGlb(full);
    const meshNames = ((glb.json["meshes"] as { name?: string }[] | undefined) ?? []).map(
      (mesh) => mesh.name ?? "",
    );
    const expected = deriveCopyrightNotice({ meshNames, bodyId: bodyIdFromAssetPath(file) });
    const asset = { ...((glb.json["asset"] as Record<string, unknown> | undefined) ?? {}) };
    const actual = asset["copyright"];

    if (expected === undefined) {
      owedNothing += 1;
      // A body that owes nothing must carry nothing: a stale notice is a claim about a component
      // that is no longer in the file.
      if (actual === undefined) continue;
      if (check) { wrong.push(`${file}: owes no attribution but carries "${String(actual)}"`); continue; }
      delete asset["copyright"];
    } else {
      if (actual === expected) continue;
      if (check) { wrong.push(`${file}: expected "${expected}", found ${JSON.stringify(actual)}`); continue; }
      asset["copyright"] = expected;
    }
    writeGlb(full, glb, { ...glb.json, asset });
    rerecordProvenance(full);
    written += 1;
    process.stdout.write(`  wrote ${file}\n`);
  }

  if (check && wrong.length > 0) {
    process.stdout.write(`shipped licence notice: ${wrong.length} file(s) wrong\n`);
    for (const line of wrong) process.stdout.write(`  - ${line}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    check
      ? "shipped licence notice: every shipped humanoid carries the notice its components oblige.\n"
      : `shipped licence notice: ${written} written, ${owedNothing} owe nothing.\n`,
  );
}

if (process.argv[1]?.endsWith("write-shipped-licence-notice.ts")) main();
