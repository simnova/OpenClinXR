#!/usr/bin/env -S pnpm exec tsx
/**
 * print-materialize-invocation.ts — print the recorded Blender bake command
 * for a chain manifest: first line `TOOL <tool>`, then one argv element per
 * line. materialize-proof.sh builds its blender command ONLY from this
 * output; the runner itself never executes materialize during chain replay.
 */
import { readFileSync } from "node:fs";
import { materializeInvocation, validateManifest } from "./run-chain.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const manifestPath = flag(argv, "--manifest");
  const out = flag(argv, "--out");
  if (manifestPath === undefined || out === undefined) {
    throw new Error("usage: print-materialize-invocation.ts --manifest <file> --out <path>");
  }
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const inv = materializeInvocation(manifest, out);
  process.stdout.write(`TOOL ${inv.tool}\n`);
  for (const a of inv.argv) process.stdout.write(`${a}\n`);
}

main();
