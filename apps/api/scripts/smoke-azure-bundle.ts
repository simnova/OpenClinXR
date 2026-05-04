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

const snapshotResponse = await startup.fetch(new Request("http://localhost/exam-blueprints/step2cs-seed/station-run-queue/snapshots", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    snapshotId: "queue_snapshot_azure_smoke_001",
    createdAt: "2026-05-03T17:15:00.000Z",
    reviewerId: "azure_smoke",
  }),
}));
if (snapshotResponse.status !== 201) {
  throw new Error(`Azure bundle smoke expected station run queue snapshot to return 201, got ${snapshotResponse.status}`);
}

const snapshot = await snapshotResponse.json() as {
  snapshotId?: string;
  reviewerId?: string;
  queue?: {
    canStartLearnerExam?: boolean;
    stationQueue?: unknown[];
  };
};

if (
  snapshot.snapshotId !== "queue_snapshot_azure_smoke_001"
  || snapshot.reviewerId !== "azure_smoke"
  || snapshot.queue?.canStartLearnerExam !== false
  || snapshot.queue?.stationQueue?.length !== 12
) {
  throw new Error(`Azure bundle smoke received unexpected station run queue snapshot payload: ${JSON.stringify(snapshot)}`);
}

const snapshotsResponse = await startup.fetch(new Request("http://localhost/exam-blueprints/step2cs-seed/station-run-queue/snapshots"));
if (snapshotsResponse.status !== 200) {
  throw new Error(`Azure bundle smoke expected station run queue snapshot list to return 200, got ${snapshotsResponse.status}`);
}

const snapshots = await snapshotsResponse.json() as unknown[];
if (!Array.isArray(snapshots)) {
  throw new Error(`Azure bundle smoke received non-array station run queue snapshot list: ${JSON.stringify(snapshots)}`);
}

console.log("Azure bundle smoke passed");
