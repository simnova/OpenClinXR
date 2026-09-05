import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "./lib/portless-server.js";

const REQUIRED_PHASES = ["ready", "approaching", "contacting", "holding", "released"] as const;
const MINIMUM_CAPTURE_MS = 7_000;
const DEFAULT_CAPTURE_MS = 8_000;

type RadialPulsePhase = (typeof REQUIRED_PHASES)[number];
type EvidenceSnapshot = Record<string, unknown> & {
  phase?: unknown;
  readyForIwerInteractionEvidence?: unknown;
};

export type RadialPulseCaptureOptions = {
  videoPath: string;
  reportPath: string;
  durationMs: number;
};

export type RadialPulseCaptureReport = {
  schemaVersion: "openclinxr.iwsdk-radial-pulse-video-capture.v1";
  generatedAt: string;
  runtimeUrl: string;
  viewport: { width: 1440; height: 900 };
  capture: {
    videoPath: string;
    durationMs: number;
    frameRate: 30;
    mimeType: "video/webm;codecs=vp9";
    snapshotCount: number;
  };
  observedPhases: RadialPulsePhase[];
  readyForIwerInteractionEvidenceObserved: boolean;
  patient: {
    assetName: "mpfb-street-adult-male.glb";
    wristBoneName: "wrist.R";
    targetAttachedToWrist: true;
    presentationPose: "consented_right_wrist_presentation";
  };
  snapshots: EvidenceSnapshot[];
  errors: { console: string[]; page: string[] };
  readyForPhysicalQuestClaim: false;
  physicalQuestHapticsClaimed: false;
  clinicalValidityClaimed: false;
  scoringClaimed: false;
  productionReadinessClaimed: false;
  notEvidenceFor: string[];
};

export function parseRadialPulseCaptureArgs(args: string[]): RadialPulseCaptureOptions {
  let videoPath: string | undefined;
  let reportPath: string | undefined;
  let durationMs = DEFAULT_CAPTURE_MS;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--video") videoPath = requireNext(args, ++index, arg);
    else if (arg === "--report") reportPath = requireNext(args, ++index, arg);
    else if (arg === "--duration-ms") durationMs = Number(requireNext(args, ++index, arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!videoPath) throw new Error("Missing required --video output path");
  if (!reportPath) throw new Error("Missing required --report output path");
  if (!Number.isFinite(durationMs) || durationMs < MINIMUM_CAPTURE_MS) {
    throw new Error(`--duration-ms must be at least ${MINIMUM_CAPTURE_MS}`);
  }
  return { videoPath, reportPath, durationMs };
}

export function buildRadialPulseCaptureReport(input: {
  runtimeUrl: string;
  videoPath: string;
  durationMs: number;
  snapshots: EvidenceSnapshot[];
  consoleErrors: string[];
  pageErrors: string[];
}): RadialPulseCaptureReport {
  const observed = new Set<string>();
  let readyObserved = false;
  let properPatientObserved = false;
  for (const snapshot of input.snapshots) {
    if (typeof snapshot.phase === "string") observed.add(snapshot.phase);
    readyObserved ||= snapshot.readyForIwerInteractionEvidence === true;
    properPatientObserved ||= snapshot.patientAssetName === "mpfb-street-adult-male.glb"
      && snapshot.patientAssetLoadStatus === "loaded"
      && snapshot.wristBoneName === "wrist.R"
      && snapshot.targetAttachedToWrist === true
      && snapshot.patientPresentationPose === "consented_right_wrist_presentation";
  }
  const observedPhases = REQUIRED_PHASES.filter((phase) => observed.has(phase));
  const missingPhases = REQUIRED_PHASES.filter((phase) => !observed.has(phase));
  const failures = [
    ...(missingPhases.length > 0 ? [`missing phases: ${missingPhases.join(", ")}`] : []),
    ...(!readyObserved ? ["readyForIwerInteractionEvidence was never true"] : []),
    ...(!properPatientObserved ? ["proper MPFB patient and wrist attachment were never observed"] : []),
    ...(input.consoleErrors.length > 0 ? [`console errors: ${input.consoleErrors.join(" | ")}`] : []),
    ...(input.pageErrors.length > 0 ? [`page errors: ${input.pageErrors.join(" | ")}`] : []),
  ];
  if (failures.length > 0) throw new Error(`Radial pulse capture rejected: ${failures.join("; ")}`);

  return {
    schemaVersion: "openclinxr.iwsdk-radial-pulse-video-capture.v1",
    generatedAt: new Date().toISOString(),
    runtimeUrl: input.runtimeUrl,
    viewport: { width: 1440, height: 900 },
    capture: {
      videoPath: input.videoPath,
      durationMs: input.durationMs,
      frameRate: 30,
      mimeType: "video/webm;codecs=vp9",
      snapshotCount: input.snapshots.length,
    },
    observedPhases,
    readyForIwerInteractionEvidenceObserved: true,
    patient: {
      assetName: "mpfb-street-adult-male.glb",
      wristBoneName: "wrist.R",
      targetAttachedToWrist: true,
      presentationPose: "consented_right_wrist_presentation",
    },
    snapshots: input.snapshots,
    errors: { console: [], page: [] },
    readyForPhysicalQuestClaim: false,
    physicalQuestHapticsClaimed: false,
    clinicalValidityClaimed: false,
    scoringClaimed: false,
    productionReadinessClaimed: false,
    notEvidenceFor: [
      "physical_quest_hand_tracking_quality",
      "physical_quest_haptics",
      "physical_quest_readiness",
      "clinical_pulse_assessment_validity",
      "clinical_scoring",
      "production_runtime_readiness",
    ],
  };
}

export async function captureRadialPulseVideo(options: RadialPulseCaptureOptions): Promise<RadialPulseCaptureReport> {
  let server: PortlessDevServer | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr-iwsdk-spike" });
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(`(() => {
      const snapshots = [];
      let current;
      Object.defineProperty(window, "__openClinXrRadialPulseEvidence", {
        configurable: true,
        get: function () { return current; },
        set: function (value) {
          current = value;
          if (value && typeof value === "object") snapshots.push(JSON.parse(JSON.stringify(value)));
        },
      });
      window.__openClinXrRadialPulseCaptureSnapshots = snapshots;
    })()`);
    const runtimeUrl = `${server.url}?radialPulseDemo=true&iwerEvidenceView=wide`;
    await page.goto(runtimeUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("canvas", { state: "visible", timeout: 120_000 });
    const result = await page.evaluate(async (durationMs) => {
      const canvas = browserPageDocument.querySelector("canvas");
      if (!canvas) throw new Error("IWSDK radial pulse canvas not found");
      const mimeType = "video/webm;codecs=vp9";
      if (!browserPageRecorderSupports(mimeType)) throw new Error(`Required MediaRecorder codec unavailable: ${mimeType}`);
      const stream = canvas.captureStream(30);
      const chunks: Blob[] = [];
      const recorder = createBrowserPageRecorder(stream, { mimeType });
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      const stopped = new Promise<void>((resolve, reject) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.addEventListener("error", () => reject(new Error("IWSDK radial pulse recording failed")), { once: true });
      });
      recorder.start(250);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      recorder.stop();
      await stopped;
      for (const track of stream.getTracks()) track.stop();
      const blob = new Blob(chunks, { type: mimeType });
      const snapshots = (browserPageWindow.__openClinXrRadialPulseCaptureSnapshots ?? []) as EvidenceSnapshot[];
      return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), snapshots };
    }, options.durationMs);
    const report = buildRadialPulseCaptureReport({
      runtimeUrl,
      videoPath: options.videoPath,
      durationMs: options.durationMs,
      snapshots: result.snapshots,
      consoleErrors,
      pageErrors,
    });
    await mkdir(path.dirname(options.videoPath), { recursive: true });
    await mkdir(path.dirname(options.reportPath), { recursive: true });
    await writeFile(options.videoPath, Buffer.from(result.bytes));
    await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await stopPortlessDevServer(server?.proc);
  }
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function main(): Promise<void> {
  const options = parseRadialPulseCaptureArgs(process.argv.slice(2));
  const report = await captureRadialPulseVideo(options);
  console.log(`Wrote ${options.videoPath}`);
  console.log(`Wrote ${options.reportPath} (${report.capture.snapshotCount} snapshots)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
