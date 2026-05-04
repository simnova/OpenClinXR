import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

type ApiBundle = {
  createOpenClinXrApiStartup: () => {
    startUp: () => {
      fetch: (request: Request) => Response | Promise<Response>;
    };
  };
};

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleUrl = pathToFileURL(path.join(appDir, "deploy/dist/index.js")).href;
const bundle = await import(bundleUrl) as ApiBundle;
const startup = bundle.createOpenClinXrApiStartup().startUp();
const response = await startup.fetch(new Request("http://localhost/health"));

if (response.status !== 200) {
  throw new Error(`Azure bundle smoke expected /health to return 200, got ${response.status}`);
}

const body = await response.json() as { ok?: boolean; service?: string };
if (body.ok !== true || body.service !== "openclinxr-api") {
  throw new Error(`Azure bundle smoke received unexpected /health payload: ${JSON.stringify(body)}`);
}

const timingResponse = await startup.fetch(new Request("http://localhost/exam-blueprints/step2cs-seed/timing-plan"));
if (timingResponse.status !== 200) {
  throw new Error(`Azure bundle smoke expected timing plan to return 200, got ${timingResponse.status}`);
}

const timingPlan = await timingResponse.json() as {
  stationWindows?: unknown[];
  breakCheckpoints?: unknown[];
  totalStationTimeSeconds?: number;
};

if (timingPlan.stationWindows?.length !== 12 || timingPlan.breakCheckpoints?.length !== 3 || timingPlan.totalStationTimeSeconds !== 18720) {
  throw new Error(`Azure bundle smoke received unexpected timing plan payload: ${JSON.stringify(timingPlan)}`);
}

const queueResponse = await startup.fetch(new Request("http://localhost/exam-blueprints/step2cs-seed/station-run-queue"));
if (queueResponse.status !== 200) {
  throw new Error(`Azure bundle smoke expected station run queue to return 200, got ${queueResponse.status}`);
}

const stationRunQueue = await queueResponse.json() as {
  canStartLearnerExam?: boolean;
  stationQueue?: unknown[];
  summary?: {
    activationReady?: number;
    draftBlocked?: number;
  };
};

if (
  stationRunQueue.canStartLearnerExam !== false
  || stationRunQueue.stationQueue?.length !== 12
  || stationRunQueue.summary?.activationReady !== 1
  || stationRunQueue.summary?.draftBlocked !== 11
) {
  throw new Error(`Azure bundle smoke received unexpected station run queue payload: ${JSON.stringify(stationRunQueue)}`);
}

console.log("Azure bundle smoke passed");
