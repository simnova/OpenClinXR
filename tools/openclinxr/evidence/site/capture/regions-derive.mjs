#!/usr/bin/env node
/**
 * Inspector regions derive (card W4a-1b round 2): one source (the W0
 * re-baseline run) feeds the page and the tests. Reads one inspector run's
 * regions.json, resolves each region's blueprint blocks from
 * `git show <regions.sourceSha>:<blueprint.path>` (never HEAD, never a
 * hand edit), and writes a NEW run dir via pickRunDir with the still copied
 * byte-identical (sha256 asserted) and regions.json = source doc + blocks[]
 * + derivedFrom. Refuses to write into an existing dir.
 *
 * Usage: node regions-derive.mjs --from <inspector run dir> --out <inspector root>
 * Writes <out>/run-<n>/{still.png,regions.json}. Never hand-edit a store file.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TREE_TOP, pickRunDir } from "./w0-still.mjs";
import { blueprintActorBlocks, redactHiddenFacts } from "./inspector-regions.mjs";

export function deriveInspectorRun({ from, out } = {}) {
  if (typeof from !== "string" || from === "" || typeof out !== "string" || out === "") {
    throw new Error("usage: node regions-derive.mjs --from <run dir> --out <inspector root>");
  }
  const sourceDir = resolve(from);
  const sourceDoc = JSON.parse(readFileSync(join(sourceDir, "regions.json"), "utf8"));
  const sourceSha = sourceDoc?.sourceSha;
  const fixturePath = sourceDoc?.blueprint?.path;
  if (typeof sourceSha !== "string" || sourceSha === "" || typeof fixturePath !== "string" || fixturePath === "") {
    throw new Error("derive source regions.json carries no sourceSha/blueprint.path");
  }
  const sourceText = execFileSync("git", ["-C", TREE_TOP, "show", `${sourceSha}:${fixturePath}`], {
    encoding: "utf8",
  });
  const blocksByActor = redactHiddenFacts(blueprintActorBlocks(sourceText, fixturePath));
  const regions = (Array.isArray(sourceDoc.regions) ? sourceDoc.regions : []).map((region) => ({
    ...region,
    blocks: blocksByActor.get(region?.actorId) ?? [],
  }));

  const { dir: runDir, n: runN } = pickRunDir(resolve(out));
  if (existsSync(join(runDir, "regions.json")) || existsSync(join(runDir, "still.png"))) {
    throw new Error(`derive refused: ${runDir} already holds a run`);
  }
  copyFileSync(join(sourceDir, "still.png"), join(runDir, "still.png"));
  const copiedSha = createHash("sha256").update(readFileSync(join(runDir, "still.png"))).digest("hex");
  if (copiedSha !== sourceDoc?.still?.sha256) {
    throw new Error(`derive refused: copied still sha ${copiedSha} != regions.still.sha256 ${sourceDoc?.still?.sha256}`);
  }

  const runTag = `run-${runN}`;
  const derived = {
    ...sourceDoc,
    run: runTag,
    still: { ...(sourceDoc.still ?? {}), file: `${runTag}/still.png` },
    regions,
    derivedFrom: basename(sourceDir),
  };
  writeFileSync(join(runDir, "regions.json"), `${JSON.stringify(derived, null, 2)}\n`, "utf8");
  return { dir: runDir, run: runTag, regions: regions.length };
}

const isEntryScript =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryScript) {
  const argv = process.argv.slice(2);
  const fromIdx = argv.indexOf("--from");
  const outIdx = argv.indexOf("--out");
  try {
    const result = deriveInspectorRun({
      from: fromIdx === -1 ? undefined : argv[fromIdx + 1],
      out: outIdx === -1 ? undefined : argv[outIdx + 1],
    });
    console.log(`inspector regions derived ${result.run} regions=${result.regions} in ${result.dir}`);
  } catch (error) {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}
