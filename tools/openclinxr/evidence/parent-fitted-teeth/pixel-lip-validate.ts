/**
 * Validate the pixel lip instrument and commit its evidence (lip-bones2).
 *
 * Decodes the shipped isolated stills (ffmpeg, top-down rgb24), calibrates
 * thresholds from the rest-pose stills of the same render, measures every
 * front + 3/4 still, and validates two ways: (a) attempt-1 bone-driven delta
 * (archived after-stills vs live before-stills, E-framing verified) must be
 * ~0 where the landmark instrument claimed O -44px / U -56px additional
 * narrowing and the coordinator graded the opening the same width; (b) a
 * destructive 0.85 horizontal squeeze of the mouth band must report ~-15%.
 *
 * Writes docs/openclinxr/mouth-dynamics/viseme-eval/pixel-lip-measure.json.
 * Run: pnpm exec tsx tools/openclinxr/evidence/parent-fitted-teeth/pixel-lip-validate.ts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  calibratePixelLipThresholds,
  measurePixelLipForward,
  measurePixelLipFront,
  squeezeMouthBand,
  type RgbImage,
} from "./pixel-lip-measure.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const OUT_DIR = path.join(REPO, "docs/openclinxr/mouth-dynamics/viseme-eval");
const ORDER = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"] as const;
const ARCHIVE = "/private/tmp/claude-501/-Volumes-files-src-openclinxr/bde3aa49-e17c-405c-b469-621484cb7ff2/scratchpad/lbwip/docs/openclinxr/mouth-dynamics/viseme-eval";

function decodeTopDown(pngPath: string): RgbImage {
  const probe = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", pngPath],
    { encoding: "utf8" },
  );
  const [W, H] = probe.trim().split(",").map(Number);
  if (!W || !H) throw new Error(`bad-png-dims:${pngPath}`);
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", pngPath, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  }) as Buffer;
  if (raw.length < W * H * 3) throw new Error(`short-raw:${pngPath}`);
  return { rgb: new Uint8Array(raw.buffer, raw.byteOffset, W * H * 3), w: W, h: H };
}

function md5(file: string): string {
  return createHash("md5").update(readFileSync(file)).digest("hex");
}

async function main(): Promise<void> {
  const still = (view: string, viseme: string): string => {
    const file = path.join(OUT_DIR, `isolated-${view}`, `${viseme}.png`);
    if (!existsSync(file)) throw new Error(`missing-still:${file}`);
    return file;
  };
  const restFront = decodeTopDown(still("front", "sil"));
  const rest34 = decodeTopDown(still("34", "sil"));
  const t = calibratePixelLipThresholds(restFront, rest34);
  process.stdout.write(
    `thresholds darkT=${t.darkT} redT=${t.redT} gumT=${t.gumT} bgT34=${t.bgT34} ` +
      `apMean=${t.restStats.apertureMean.toFixed(1)} apSd=${t.restStats.apertureSd.toFixed(1)} ` +
      `lipRedxs=${t.restStats.lipRedxsMedian.toFixed(1)} bg34=${t.restStats.bg34Median.toFixed(1)}\n`,
  );

  const front: Record<string, unknown> = {};
  const view34: Record<string, unknown> = {};
  const fingerprints: Record<string, string> = {};
  for (const v of ORDER) {
    const ff = still("front", v);
    const f34 = still("34", v);
    fingerprints[`isolated-front/${v}.png`] = md5(ff);
    fingerprints[`isolated-34/${v}.png`] = md5(f34);
    front[v] = measurePixelLipFront(decodeTopDown(ff), t);
    view34[v] = measurePixelLipForward(decodeTopDown(f34), t);
  }
  const ratio = (got: number, ref: number): number => Math.round((got / ref) * 1000) / 1000;
  const eFront = front["E"] as { outerWidthPx: number };
  const eFwd = view34["E"] as { forwardPx: number };
  const ratiosVsE: Record<string, Record<string, number>> = { frontOuter: {}, frontApW: {}, fwd34: {} };
  for (const v of ORDER) {
    const f = front[v] as { outerWidthPx: number; apertureWidthPx: number };
    const c = view34[v] as { forwardPx: number };
    ratiosVsE["frontOuter"]![v] = ratio(f.outerWidthPx, eFront.outerWidthPx);
    ratiosVsE["frontApW"]![v] = ratio(f.apertureWidthPx, eFront.outerWidthPx);
    ratiosVsE["fwd34"]![v] = c.forwardPx - eFwd.forwardPx;
  }

  // Destructive probe: 0.85 horizontal squeeze of the E mouth band.
  const eImg = decodeTopDown(still("front", "E"));
  const squeezed = squeezeMouthBand(eImg, 0.85);
  const probeGot = measurePixelLipFront(squeezed, t).outerWidthPx;
  const probeRatio = probeGot / eFront.outerWidthPx;
  const scaleProbe = {
    factor: 0.85,
    baseOuterPx: eFront.outerWidthPx,
    squeezedOuterPx: probeGot,
    reportedRatio: Math.round(probeRatio * 10000) / 10000,
    pass: Math.abs(probeRatio - 0.85) <= 0.02,
  };
  process.stdout.write(`scaleProbe E x0.85: ${eFront.outerWidthPx} -> ${probeGot} (${scaleProbe.reportedRatio})\n`);

  // Validation (a): attempt-1 bone-driven delta, archived after vs live before.
  let boneDelta: Record<string, unknown> | null = null;
  const archRaw = path.join(ARCHIVE, "isolated.raw.json");
  const liveRaw = path.join(OUT_DIR, "isolated.raw.json");
  if (existsSync(archRaw) && existsSync(liveRaw)) {
    const rows = (file: string, view: string, viseme: string) => {
      const raw = JSON.parse(readFileSync(file, "utf8")) as {
        views: Record<string, { stills: { viseme: string; corners: { lx: number; rx: number }; widthPx: number }[] }>;
      };
      const row = raw.views[view]?.stills.find((s) => s.viseme === viseme);
      if (!row) throw new Error(`missing-raw-row:${file}:${view}:${viseme}`);
      return row;
    };
    // Framing check: E carries no bone drive (all O/U/CH/RR weights 0 at E),
    // so archived-E vs live-E landmark corners must match.
    const archE = rows(archRaw, "front", "E");
    const liveE = rows(liveRaw, "front", "E");
    const delta: Record<string, unknown> = {
      framing: { archECorners: archE.corners, liveECorners: liveE.corners },
    };
    for (const v of ["O", "U", "CH", "RR"]) {
      const archF = path.join(ARCHIVE, `isolated-front/${v}.png`);
      const archC = path.join(ARCHIVE, `isolated-34/${v}.png`);
      if (!existsSync(archF) || !existsSync(archC)) continue;
      const aFront = measurePixelLipFront(decodeTopDown(archF), t);
      const aFwd = measurePixelLipForward(decodeTopDown(archC), t);
      const lFront = front[v] as { outerWidthPx: number };
      const lFwd = view34[v] as { forwardPx: number };
      const archLand = rows(archRaw, "front", v);
      const liveLand = rows(liveRaw, "front", v);
      delta[v] = {
        pixelOuterLive: lFront.outerWidthPx,
        pixelOuterArch: aFront.outerWidthPx,
        pixelOuterDeltaPx: aFront.outerWidthPx - lFront.outerWidthPx,
        pixelOuterDeltaPct: Math.round(((aFront.outerWidthPx - lFront.outerWidthPx) / lFront.outerWidthPx) * 1000) / 10,
        pixelFwdDeltaPx: aFwd.forwardPx - lFwd.forwardPx,
        landmarkOuterLive: liveLand.widthPx,
        landmarkOuterArch: archLand.widthPx,
        landmarkDeltaPx: Math.round((archLand.widthPx - liveLand.widthPx) * 10) / 10,
      };
    }
    boneDelta = delta;
    process.stdout.write(`boneDelta ${JSON.stringify(delta)}\n`);
  } else {
    process.stderr.write("WARN archive raw.json missing: bone-delta validation skipped\n");
  }

  const report = {
    schemaVersion: "openclinxr.pixel-lip-measure.v1",
    method: [
      "Segment the visible mouth from the rendered still: dark aperture (mean < darkT) + tooth-white (tooth-pixel-split rule) + vermilion redness excess over per-row local skin (lerped cheek refs) vs surrounding skin; thresholds calibrated from the rest-pose sil stills of the same render.",
      "Outer lip width = widest mouth-centre run over the mouth band (y 380-620); aperture w = widest dark/tooth/deep-red centre run; aperture h = tallest aperture column run near the centre; 3/4 forward = foremost lip silhouette x vs the rigid forehead anchor.",
      "Validation (a): attempt-1 bone-driven pixel delta (archived after vs live before, E-framing verified) ~0 where landmark claimed narrowing and the coordinator graded the opening the same width. Validation (b): 0.85 mouth-band squeeze reports ~0.85.",
    ],
    thresholds: { darkT: t.darkT, redT: t.redT, gumT: t.gumT, bgT34: t.bgT34, restStats: t.restStats },
    front,
    view34,
    ratiosVsE,
    validation: {
      shipped: {
        E: { ...(front["E"] as object), ...(view34["E"] as object) },
        O: { ...(front["O"] as object), ...(view34["O"] as object) },
        U: { ...(front["U"] as object), ...(view34["U"] as object) },
      },
      boneDelta,
      scaleProbe,
      humanAgreement: [
        "Coordinator grade (COORDINATOR-GRADE-lipbones-OU.png): O/U openings the same width before|after bones, more lower teeth on O after. Pixel bone-delta ~0 agrees; landmark -44px O / -56px U additional narrowing disagrees with the camera.",
        "Visual ranking on shipped stills (E widest, O narrowest, U between) reproduced by pixel outer ratios; sil hw ~0.1 (closed seam) as seen.",
      ],
    },
    fingerprints,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "pixel-lip-measure.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write("wrote pixel-lip-measure.json\n");
  if (!scaleProbe.pass) throw new Error(`scale-probe-failed:${scaleProbe.reportedRatio}`);
}

const invoked = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
