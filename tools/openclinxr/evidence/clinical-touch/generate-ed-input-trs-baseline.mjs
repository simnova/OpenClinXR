#!/usr/bin/env node
// Generates portable ed-input-trs-baseline.json from the immutable ORIGINAL
// frozen ED input GLB. Verifies full input SHA, byte length, GLB magic
// before extraction. Deterministic output, no claim dates.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const EXPECTED_SHA = "bc840005fe94f90712b77521283d1ba2c6636df523ec932c346ee37e14a3d120";
const EXPECTED_LEN = 8096468;

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) {
    console.error(`missing required ${name} <path>`);
    process.exit(2);
  }
  return process.argv[i + 1];
}

const inputPath = arg("--input");
const outPath = arg("--out");

const bytes = readFileSync(inputPath);
if (bytes.readUInt32LE(0) !== 0x46546c67) {
  console.error("refusing: not a GLB (bad magic)");
  process.exit(1);
}
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== EXPECTED_SHA) {
  console.error(`refusing: input SHA ${sha} != authentic ${EXPECTED_SHA}`);
  process.exit(1);
}
if (bytes.length !== EXPECTED_LEN) {
  console.error(`refusing: input length ${bytes.length} != ${EXPECTED_LEN}`);
  process.exit(1);
}
const jsonSize = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());

const nodes = gltf.nodes.map((n) => {
  const e = {};
  if (n.name !== undefined) e.name = n.name;
  if (n.translation !== undefined) e.translation = n.translation;
  if (n.rotation !== undefined) e.rotation = n.rotation;
  if (n.scale !== undefined) e.scale = n.scale;
  if (n.extras !== undefined) e.extras = n.extras;
  return e;
});

const canonical = JSON.stringify(nodes);
const canonicalSha = createHash("sha256").update(canonical).digest("hex");

const fixture = {
  authenticInputSha256: EXPECTED_SHA,
  authenticInputLength: EXPECTED_LEN,
  nodeCount: nodes.length,
  canonicalNodeTrsSha256: canonicalSha,
  nodes,
};
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n");

// Self-verify: generator SHA of this file for provenance.
const genSha = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");
console.log(JSON.stringify({ nodes: nodes.length, canonicalNodeTrsSha256: canonicalSha, generatorSha256: genSha }));
