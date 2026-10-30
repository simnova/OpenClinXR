#!/usr/bin/env node
/**
 * C2 lean-numbers reporter: attributes the built sync-probe closure to buckets.
 *
 * Usage: node bundle-split.mjs --out <file.json>
 *
 * Buckets: page (sync-probe entry), xr-sync-client (+@colyseus/sdk, own chunk),
 * iwer (dynamic vendor chunk: iwer + gl-matrix + layers polyfill),
 * three+iwsdk (shared static chunk: three.js + IWSDK engine; three lives here
 * because the repo's shared codeSplitting groups place it there).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKTREE_ROOT = resolve(HERE, "..", "..", "..", "..");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");

function bucketFor(file, code) {
  if (file.startsWith("sync-probe-")) {
    return "page";
  }
  if (file.startsWith("sync-xr-")) {
    return "xr-sync-client";
  }
  if (file.startsWith("three-vendor-")) {
    return "three";
  }
  if (file.startsWith("iwsdk-vendor-")) {
    return "iwsdk-shared";
  }
  if (code.includes("XRDevice") && code.includes("metaQuest3")) {
    return "iwer";
  }
  if (code.includes("WebGLRenderer")) {
    return "three";
  }
  return "other";
}

async function main(argv) {
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") {
      out = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (!out) {
    throw new Error("--out <file.json> is required");
  }
  const manifest = JSON.parse(await readFile(join(APP_DIST, ".vite", "manifest.json"), "utf8"));
  const entry = manifest["sync-probe.html"];
  if (!entry) {
    throw new Error("manifest missing sync-probe.html");
  }
  const files = new Set();
  const visit = (key) => {
    const node = manifest[key];
    if (!node || files.has(node.file)) {
      return;
    }
    files.add(node.file);
    for (const dep of [...(node.imports ?? []), ...(node.dynamicImports ?? [])]) {
      if (manifest[dep]) {
        visit(dep);
        continue;
      }
      const depKey = Object.keys(manifest).find((k) => manifest[k].file === dep);
      if (depKey) {
        visit(depKey);
      }
    }
  };
  visit("sync-probe.html");
  const chunks = [];
  const buckets = {};
  for (const file of [...files].sort()) {
    if (!file.endsWith(".js")) {
      continue;
    }
    const code = await readFile(join(APP_DIST, file), "utf8");
    const bucket = bucketFor(file.split("/").pop(), code);
    const record = { file: `dist/${file}`, bytes: code.length, bucket };
    chunks.push(record);
    buckets[bucket] = (buckets[bucket] ?? 0) + code.length;
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  const report = { page: "sync-probe.html", totalBytes: total, buckets, chunks };
  await writeFile(resolve(out), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  for (const chunk of chunks) {
    console.log(`${chunk.bucket} ${chunk.bytes} ${chunk.file}`);
  }
  console.log(`total ${total}`);
}

await main(process.argv.slice(2));
