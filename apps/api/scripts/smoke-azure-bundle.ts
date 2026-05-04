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

const graphqlCreateResponse = await startup.fetch(new Request("http://localhost/admin/graphql", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `
      mutation CreateStationRunQueueSnapshot($input: CreateStationRunQueueSnapshotInput!) {
        createStationRunQueueSnapshot(input: $input) {
          snapshotId
          reviewerId
          queue {
            blueprintId
            totalStationTimeSeconds
            breakCheckpoints {
              afterStationOrder
              atSecond
            }
            stationQueue {
              stationOrder
              timing {
                doorway {
                  durationSeconds
                }
                encounter {
                  durationSeconds
                }
                note {
                  durationSeconds
                }
              }
            }
            summary {
              activationReady
              draftBlocked
            }
          }
        }
      }
    `,
    operationName: "CreateStationRunQueueSnapshot",
    variables: {
      input: {
        snapshotId: "queue_snapshot_azure_graphql_001",
        createdAt: "2026-05-03T20:00:00.000Z",
        reviewerId: "azure_graphql_smoke",
      },
    },
  }),
}));

if (graphqlCreateResponse.status !== 200) {
  throw new Error(`Azure bundle smoke expected GraphQL snapshot create to return 200, got ${graphqlCreateResponse.status}`);
}

const graphqlCreate = await graphqlCreateResponse.json() as {
  errors?: unknown[];
  data?: {
    createStationRunQueueSnapshot?: {
      snapshotId?: string;
      reviewerId?: string;
      queue?: {
        blueprintId?: string;
        totalStationTimeSeconds?: number;
        breakCheckpoints?: unknown[];
        stationQueue?: Array<{
          stationOrder?: number;
          timing?: {
            doorway?: { durationSeconds?: number };
            encounter?: { durationSeconds?: number };
            note?: { durationSeconds?: number };
          };
        }>;
        summary?: {
          activationReady?: number;
          draftBlocked?: number;
        };
      };
    };
  };
};

const createdGraphqlSnapshot = graphqlCreate.data?.createStationRunQueueSnapshot;
if (
  graphqlCreate.errors
  || createdGraphqlSnapshot?.snapshotId !== "queue_snapshot_azure_graphql_001"
  || createdGraphqlSnapshot.reviewerId !== "azure_graphql_smoke"
  || createdGraphqlSnapshot.queue?.blueprintId !== "blueprint_openclinxr_step2cs_style_seed_v1"
  || createdGraphqlSnapshot.queue.totalStationTimeSeconds !== 18720
  || createdGraphqlSnapshot.queue.breakCheckpoints?.length !== 3
  || createdGraphqlSnapshot.queue.stationQueue?.length !== 12
  || createdGraphqlSnapshot.queue.stationQueue[0]?.timing?.doorway?.durationSeconds !== 60
  || createdGraphqlSnapshot.queue.stationQueue[0]?.timing?.encounter?.durationSeconds !== 900
  || createdGraphqlSnapshot.queue.stationQueue[0]?.timing?.note?.durationSeconds !== 600
  || createdGraphqlSnapshot.queue.summary?.activationReady !== 1
  || createdGraphqlSnapshot.queue.summary.draftBlocked !== 11
) {
  throw new Error(`Azure bundle smoke received unexpected GraphQL snapshot create payload: ${JSON.stringify(graphqlCreate)}`);
}

const graphqlListResponse = await startup.fetch(new Request("http://localhost/admin/graphql", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `
      query StationRunQueueSnapshots($blueprintId: ID!) {
        stationRunQueueSnapshots(blueprintId: $blueprintId) {
          snapshotId
          reviewerId
          queue {
            totalStationTimeSeconds
            stationQueue {
              stationOrder
            }
          }
        }
      }
    `,
    operationName: "StationRunQueueSnapshots",
    variables: { blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1" },
  }),
}));

if (graphqlListResponse.status !== 200) {
  throw new Error(`Azure bundle smoke expected GraphQL snapshot list to return 200, got ${graphqlListResponse.status}`);
}

const graphqlList = await graphqlListResponse.json() as {
  errors?: unknown[];
  data?: {
    stationRunQueueSnapshots?: Array<{
      snapshotId?: string;
      reviewerId?: string;
      queue?: {
        totalStationTimeSeconds?: number;
        stationQueue?: unknown[];
      };
    }>;
  };
};

const listedGraphqlSnapshot = graphqlList.data?.stationRunQueueSnapshots?.find(
  (snapshot) => snapshot.snapshotId === "queue_snapshot_azure_graphql_001",
);

if (
  graphqlList.errors
  || !listedGraphqlSnapshot
  || listedGraphqlSnapshot.reviewerId !== "azure_graphql_smoke"
  || listedGraphqlSnapshot.queue?.totalStationTimeSeconds !== 18720
  || listedGraphqlSnapshot.queue.stationQueue?.length !== 12
) {
  throw new Error(`Azure bundle smoke received unexpected GraphQL snapshot list payload: ${JSON.stringify(graphqlList)}`);
}

console.log("Azure bundle smoke passed");
