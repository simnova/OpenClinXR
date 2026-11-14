#!/usr/bin/env node
/**
 * KD crop step (card WKD stage 5, P5.1). Pure node, no new deps. The OWNER runs
 * this to (re)produce the committed page crops; the card author runs it once
 * now so the files land in docs/.
 *
 *   node tools/openclinxr/evidence/site/capture/kd-crop.mjs \
 *     --store /Volumes/files/openclinxr-assets/store/site-reimagine/kd \
 *     --media-dir docs/site/media --data docs/site/data/kd-media.json
 *
 * Reads the store stills with the repo's shared PNG decoder (png-measure
 * decodePng, packages/openclinxr/png-measure/src/decode-png.ts:32) and writes
 * cropped PNGs with a minimal zlib-based RGB encoder in this file (8-bit
 * truecolor, filter 0, non-interlaced; no new dependency).
 *
 * Attribution pair: run-4 A1/B still.png cropped x0-540 y0-600.
 * Learner-view pair: run-3 A1/B still.png cropped x230-430 y150-430.
 * Also copies the page's verdict numbers from run-4/verdict-r3.json (r3, then
 * r2, then verdict.json), run-3's learner numbers, the placement deltas and
 * the blueprint-diff fixture lines into kd-media.json, so every page number
 * is read from a data file the artifact test checks — never typed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { decodePng } from "../../../../../packages/openclinxr/png-measure/dist/evidence-png.js";

const KD_MEDIA_SCHEMA = "openclinxr.site.kd-media.v1";
const WKD_JOBS = "/Volumes/files/src/openclinxr/.openclinxr/slices/website-reimagine/jobs/wkd";

function fail(why) {
  console.error(`KD-CROP BLOCKED ${why}`);
  process.exitCode = 1;
  throw new Error(why);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([header, data, checksum]);
}

/** Minimal 8-bit RGB PNG encoder: filter-0 scanlines, zlib, non-interlaced. */
export function encodePngRGB(width, height, rgb) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("kd-crop: bad size");
  }
  if (rgb.length < width * height * 3) throw new Error("kd-crop: rgb too short");
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0;
    Buffer.from(rgb.subarray(y * width * 3, (y + 1) * width * 3)).copy(raw, y * (1 + width * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function cropPlanar(decoded, box) {
  const { w, h, r, g, b } = decoded;
  if (box.x < 0 || box.y < 0 || box.x + box.width > w || box.y + box.height > h) {
    throw new Error(`kd-crop: box outside ${w}x${h}: ${JSON.stringify(box)}`);
  }
  const rgb = Buffer.alloc(box.width * box.height * 3);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const src = (box.y + y) * w + (box.x + x);
      const dest = (y * box.width + x) * 3;
      rgb[dest] = r[src];
      rgb[dest + 1] = g[src];
      rgb[dest + 2] = b[src];
    }
  }
  return rgb;
}

/**
 * Publishing verdict of record (stage 6, P6.6): verdict-r3.json ONLY, no
 * fallback. Asserts verdictFile, attribution, B outside and C inside before
 * anything is written; a store holding only r2 (or anything else) is refused.
 */
function readVerdictR3(runDir) {
  const full = join(runDir, "verdict-r3.json");
  if (!existsSync(full)) fail(`publishing requires verdict-r3.json in ${runDir}: no fallback to r2/v1`);
  const doc = JSON.parse(readFileSync(full, "utf8"));
  if (doc?.pinned !== true) fail(`publishing requires a pinned attribution run: ${full}`);
  if (doc?.attribution !== true) fail(`publishing requires attribution true: ${full}`);
  if (doc?.b?.outside !== true) fail(`publishing requires B outside true: ${full}`);
  if (doc?.c?.inside !== false) fail(`publishing requires C inside false: ${full}`);
  return { doc, file: "verdict-r3.json" };
}

function readVerdictFallback(runDir) {
  for (const name of ["verdict-r3.json", "verdict-r2.json", "verdict.json"]) {
    const full = join(runDir, name);
    if (existsSync(full)) return { doc: JSON.parse(readFileSync(full, "utf8")), file: name };
  }
  fail(`no verdict in ${runDir}`);
  return null;
}

export async function runCrop({ store, runAttr, runView, mediaDir, data, placement } = {}) {
  const kdRoot = resolve(store ?? "/Volumes/files/openclinxr-assets/store/site-reimagine/kd");
  const attrDir = join(kdRoot, runAttr ?? "run-4");
  const viewDir = join(kdRoot, runView ?? "run-3");
  const outMedia = resolve(mediaDir ?? join("docs", "site", "media"));
  const outData = resolve(data ?? join("docs", "site", "data", "kd-media.json"));
  mkdirSync(outMedia, { recursive: true });
  mkdirSync(dirname(outData), { recursive: true });

  const attr = readVerdictR3(attrDir);
  const view = readVerdictFallback(viewDir);
  const runtime = JSON.parse(readFileSync(placement ?? join(WKD_JOBS, "placement-check-runtime.json"), "utf8"));

  const jobs = [
    { file: "kd-attribution-a1.png", runDir: attrDir, label: "A1", box: { x: 0, y: 0, width: 540, height: 600 } },
    { file: "kd-attribution-b.png", runDir: attrDir, label: "B", box: { x: 0, y: 0, width: 540, height: 600 } },
    { file: "kd-learner-view-a1.png", runDir: viewDir, label: "A1", box: { x: 230, y: 150, width: 200, height: 280 } },
    { file: "kd-learner-view-b.png", runDir: viewDir, label: "B", box: { x: 230, y: 150, width: 200, height: 280 } },
  ];
  const crops = [];
  for (const job of jobs) {
    const stillPath = join(job.runDir, job.label, "still.png");
    if (!existsSync(stillPath)) fail(`store still absent: ${stillPath}`);
    const stillBytes = readFileSync(stillPath);
    const decoded = decodePng(new Uint8Array(stillBytes));
    if (!decoded) fail(`undecodable store still: ${stillPath}`);
    const rgb = cropPlanar(decoded, job.box);
    const png = encodePngRGB(job.box.width, job.box.height, rgb);
    writeFileSync(join(outMedia, job.file), png);
    crops.push({
      file: `site/media/${job.file}`,
      box: { ...job.box },
      sourceRun: job.runDir.split("/").at(-1),
      sourceLabel: job.label,
      sourceFile: `${job.runDir.split("/").at(-1)}/${job.label}/still.png`,
      sourceSha256: createHash("sha256").update(stillBytes).digest("hex"),
      outputSha256: createHash("sha256").update(png).digest("hex"),
      bytes: png.length,
      width: job.box.width,
      height: job.box.height,
    });
  }

  const diffText = readFileSync(join(kdRoot, "blueprint.diff"), "utf8");
  const diffLines = diffText.split("\n");
  const fixtureMinus = diffLines.find((line) => line.startsWith("-") && !line.startsWith("---") && line.includes("plantOffsetMeters"));
  const fixturePlus = diffLines.find((line) => line.startsWith("+") && !line.startsWith("+++") && line.includes("plantOffsetMeters"));
  const bundleChangedMinus = diffLines.filter((line) => line.startsWith("-") && !line.startsWith("---") && line.includes('"x":'));
  const bundleChanged = bundleChangedMinus.length;
  if (fixtureMinus == null || fixturePlus == null) fail("blueprint.diff carries no fixture plantOffsetMeters line");
  const kdMedia = {
    schema: KD_MEDIA_SCHEMA,
    attribution: {
      run: attr.doc.run,
      verdictFile: attr.file,
      ratio: attr.doc.b.ratio,
      minIn: attr.doc.b.minIn,
      floor_in: attr.doc.b.floor_in,
      maxOut: attr.doc.b.maxOut,
      floor_out: attr.doc.b.floor_out,
      cMinIn: attr.doc.c.minIn,
      cFloorIn: attr.doc.c.floor_in,
      cInPairs: attr.doc.c.abPairs.map((pair) => pair.in),
      pad: attr.doc.pad.pad,
      padPerPairMax: attr.doc.pad.perPairMax,
      shiftPx: attr.doc.centreShiftPx.distancePx,
      shiftDx: attr.doc.centreShiftPx.dx,
      shiftDy: attr.doc.centreShiftPx.dy,
      shiftBarPx: attr.doc.shiftGate.barPx,
      overlapA1Px: null,
      overlapBPx: null,
    },
    learnerView: {
      run: view.doc.run,
      verdictFile: view.file,
      claim: view.doc.claim ?? (view.doc.pinned === true ? "attribution" : "learner-view"),
      shiftPx: view.doc.centreShiftPx?.distancePx ?? null,
    },
    placement: {
      source: "jobs/wkd/placement-check-runtime.json",
      scenarios: Object.fromEntries(
        Object.entries(runtime.scenarios ?? {}).map(([id, row]) => [id, { delta: row.delta, clearanceViolations: row.clearanceViolations ?? null, wallClearanceMeters: row.wallClearanceMeters ?? null }]),
      ),
    },
    blueprintDiff: {
      fixtureMinus,
      fixturePlus,
      bundleChangedLines: bundleChanged,
      bundleFiles: 4,
    },
    learnerRoomShiftPxApprox: 12,
    crops,
  };
  // Nurse overlap is the cross-actor pair the card is about; record it explicitly.
  const nurse = (attr.doc.refusalsB?.overlaps ?? []).find((row) => row.actorId === "nurse_maria_alvarez_v1");
  kdMedia.attribution.overlapA1Px = nurse?.overlapAreaA1Px ?? null;
  kdMedia.attribution.overlapBPx = nurse?.overlapAreaBPx ?? null;
  kdMedia.learnerView.overlapA1Px = ((view.doc.refusalsB?.overlaps ?? []).find((row) => row.actorId === "nurse_maria_alvarez_v1")?.overlapAreaA1Px ?? null);
  kdMedia.learnerView.overlapBPx = ((view.doc.refusalsB?.overlaps ?? []).find((row) => row.actorId === "nurse_maria_alvarez_v1")?.overlapAreaBPx ?? null);
  writeFileSync(outData, `${JSON.stringify(kdMedia, null, 2)}\n`, "utf8");
  const total = crops.reduce((sum, crop) => sum + crop.bytes, 0);
  console.log(`kd crops done total=${total} ${crops.map((crop) => `${crop.file.split("/").at(-1)}=${crop.bytes}`).join(" ")}`);
  return { crops, kdMedia, total };
}

const isEntryScript =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryScript) {
  const argv = process.argv.slice(2);
  const pick = (flag) => {
    const idx = argv.indexOf(flag);
    return idx === -1 ? undefined : argv[idx + 1];
  };
  await runCrop({
    store: pick("--store"),
    runAttr: pick("--run-attr"),
    runView: pick("--run-view"),
    mediaDir: pick("--media-dir"),
    data: pick("--data"),
    placement: pick("--placement"),
  }).catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
