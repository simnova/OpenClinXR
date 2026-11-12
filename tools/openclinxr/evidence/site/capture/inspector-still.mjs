#!/usr/bin/env node
/**
 * Inspector regions capture (card W4a-0): one settled frame of the ED chest
 * pain encounter in the apps/ui-xr shell, recording one projected actor
 * region per blueprint actor id from ed-chest-pain-mod.ts.
 *
 * Drive comes only through openW0Stage({ css: true }) from w0-still.mjs:
 * the same settled frame the w0-proof still shoots. Per-actor regions come
 * from projectActorBbox (harness-lib.mjs); ok rows land under regions,
 * failed rows under missing with their why.
 *
 * Usage: node inspector-still.mjs --out /Volumes/files/openclinxr-assets/store/site-reimagine/inspector
 * Writes <out>/run-<n>/{still.png,regions.json}. No top-level pointer file
 * is written (unlike w0-still.mjs).
 * BLOCKED (exit 1, regions.json is still written in the run dir) when
 * sourceSha != buildSha, pageErrors is
 * non-empty, or blockers is non-empty. PROTECTED rows are recorded, not
 * gated: the W0 rule is control-vs-proof visibility equality, and this
 * script takes only the CSS-on still; the shared drive is gated by the W0
 * same-sha A/B (jobs/w4a0/ab).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  TREE_TOP,
  VIEWPORT,
  buildSha,
  openW0Stage,
  phaseLog,
  pickRunDir,
  protectedVisibility,
  readPngSize,
} from "./w0-still.mjs";
import { projectActorBbox } from "../../xr-sync/harness-lib.mjs";
import { blueprintActorLines, validateRegions } from "./inspector-regions.mjs";

const BLUEPRINT_REPO_PATH = "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts";
const SCHEMA = "openclinxr.site-reimagine.inspector-regions.v1";

/** One actor region from exactly one projectActorBbox call. */
export async function regionFor(page, actorId) {
  const read = await projectActorBbox(page, actorId);
  if (read?.ok === true) {
    return { actorId, bbox: read.bbox };
  }
  return { actorId, why: read?.why ?? "unknown projectActorBbox failure" };
}

function blueprintAtHead() {
  const text = execFileSync("git", ["-C", TREE_TOP, "show", `HEAD:${BLUEPRINT_REPO_PATH}`], { encoding: "utf8" });
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}

async function readCamera(page) {
  const camera = await page.evaluate(() => {
    const live = globalThis.__openClinXrGazeCamera;
    if (live === undefined || live === null) return null;
    return {
      position: [live.position.x, live.position.y, live.position.z],
      quaternion: [live.quaternion.x, live.quaternion.y, live.quaternion.z, live.quaternion.w],
      fov: live.fov ?? null,
    };
  });
  if (camera === null) return null;
  return { source: "__openClinXrGazeCamera", ...camera };
}

async function readCanvasRect(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("station-canvas");
    if (canvas === null) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

export async function captureInspectorRun({ out } = {}) {
  if (typeof out !== "string" || out === "") {
    const error = new Error("usage: node inspector-still.mjs --out <inspector root>");
    console.error(`BLOCKED ${error.message}`);
    process.exitCode = 1;
    throw error;
  }
  const root = resolve(out);
  const { dir: runDir, n: runN } = pickRunDir(root);
  const runTag = `run-${runN}`;
  phaseLog(runDir, "start");
  phaseLog(runDir, `argv ${JSON.stringify(process.argv.slice(2))}`);
  const heartbeat = setInterval(() => phaseLog(runDir, "alive"), 5000);
  heartbeat.unref();

  const sourceSha = execFileSync("git", ["-C", TREE_TOP, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const blueprint = blueprintAtHead();
  const actorLines = blueprintActorLines(blueprint.text);
  const actorIds = [...actorLines.keys()];

  const regions = [];
  const missing = [];
  let camera = null;
  let canvasRect = null;
  let still = null;
  let protectedRows = [];
  const stage = await openW0Stage({ css: true, runDir });
  const { page, pageErrors, consoleErrors, close } = stage;
  try {
    protectedRows = await protectedVisibility(page);

    camera = await readCamera(page);
    canvasRect = await readCanvasRect(page);

    for (const actorId of actorIds) {
      const row = await regionFor(page, actorId);
      if ("bbox" in row) {
        regions.push({ actorId: row.actorId, lines: actorLines.get(actorId) ?? [], bbox: row.bbox });
      } else {
        missing.push({ actorId: row.actorId, why: row.why });
      }
    }
    const stillPath = join(runDir, "still.png");
    await page.screenshot({ path: stillPath, timeout: 30000 });
    const size = readPngSize(stillPath);
    still = {
      file: `${runTag}/still.png`,
      sha256: createHash("sha256").update(readFileSync(stillPath)).digest("hex"),
      width: size.width,
      height: size.height,
    };
    phaseLog(runDir, `shot still bytes=${size.bytes}`);

    const build = buildSha();
    const viewport = { width: VIEWPORT.width, height: VIEWPORT.height };
    const blockers = validateRegions({ canvasRect, viewport, regions }, actorIds);
    const regionsJson = {
      schema: SCHEMA,
      run: runTag,
      sourceSha,
      buildSha: build,
      viewport,
      camera,
      canvasRect,
      still,
      blueprint: { path: BLUEPRINT_REPO_PATH, sha256: blueprint.sha256, actorLines: Object.fromEntries(actorLines) },
      regions,
      missing,
      protected: protectedRows,
      pageErrors,
      consoleErrors,
      blockers,
    };
    writeFileSync(join(runDir, "regions.json"), `${JSON.stringify(regionsJson, null, 2)}\n`, "utf8");
    const blocked = sourceSha !== build || pageErrors.length > 0 || blockers.length > 0;
    if (blocked) {
      console.error(`BLOCKED inspector ${runTag} sourceSha=${sourceSha} buildSha=${build} blockers=${JSON.stringify(blockers)}`);
      process.exitCode = 1;
    } else {
      console.log(`inspector regions done ${runTag} regions=${regions.length} missing=${missing.length}`);
    }
    console.log(`wrote ${join(runDir, "regions.json")}`);
  } finally {
    clearInterval(heartbeat);
    await close();
  }
}

const isEntryScript =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryScript) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const root = outIdx === -1 ? undefined : argv[outIdx + 1];
  await captureInspectorRun({ out: root }).catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
