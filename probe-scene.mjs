import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Boot the ui-xr portless dev server like the evidence lib does
const repo = "/Users/patrick/.grok/worktrees/src-openclinxr/issue-333";
const HERE = path.dirname(fileURLToPath(import.meta.url));
process.chdir(repo);

// Use the existing spawnPortlessDevServer via tsx
const child = spawn("pnpm", ["exec", "tsx", "-e", `
import { spawnPortlessDevServer } from "./tools/openclinxr/evidence/lib/portless-server.js";
const s = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180000 });
console.log("SERVER_URL=" + s.url);
await new Promise(r => setTimeout(r, 999999999));
`], { cwd: repo });

let serverUrl = null;
child.stdout.on("data", (d) => {
  const s = d.toString();
  if (s.includes("SERVER_URL=")) serverUrl = s.split("SERVER_URL=")[1].trim();
});
child.stderr.on("data", (d) => process.stderr.write(d));

async function waitUrl() {
  for (let i = 0; i < 60; i++) {
    if (serverUrl) return serverUrl;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("no server url");
}

const url = await waitUrl();
console.log("using", url);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleMsgs = [];
const failedRequests = [];
page.on("console", (msg) => {
  const t = msg.text();
  if (t.includes("error") || t.includes("Error") || t.includes("FAIL") || t.includes("refused") || t.includes("404")) {
    consoleMsgs.push(`[${msg.type()}] ${t.slice(0, 300)}`);
  }
});
page.on("requestfailed", (req) => failedRequests.push(`${req.url().slice(0,140)} :: ${req.failure()?.errorText ?? "?"}`));

const target = `${url}/?openclinxrScenarioId=peds_asthma_parent_anxiety_v1&scenarioId=peds_asthma_parent_anxiety_v1&openclinxrCaptureMode=scene-overview&capture=scene-overview&openclinxrPortalStart=encounter&openclinxrAcceleratedExam=1`;
await page.goto(target, { waitUntil: "load", timeout: 180000 });
await page.waitForTimeout(20000);

const sceneState = await page.evaluate(`(() => {
  const win = window;
  const scene = win.__openClinXrDebugScene;
  if (!scene) return { noDebugScene: true };
  const actors = {};
  scene.traverse(function (o) {
    let cur = o;
    while (cur) {
      if (cur.userData && typeof cur.userData.openClinXrActorId === "string") {
        const aid = cur.userData.openClinXrActorId;
        if (!actors[aid]) actors[aid] = [];
        if (o.isMesh || o.isSkinnedMesh) {
          const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
          actors[aid].push({ name: o.name || "(unnamed)", tris: o.geometry && o.geometry.index ? Math.floor(o.geometry.index.count/3) : 0, visible: o.visible, mat: (mats[0]&&mats[0].name)||"" });
        }
        break;
      }
      cur = cur.parent;
    }
  });
  return actors;
})()`);

console.log("=== ACTOR MESHES ===");
for (const [aid, meshes] of Object.entries(sceneState)) {
  console.log(aid, "count=" + meshes.length);
  for (const m of meshes.slice(0, 8)) console.log("   ", m);
}
console.log("=== CONSOLE ERRORS ===");
for (const m of consoleMsgs.slice(0, 20)) console.log(m);
console.log("=== FAILED REQUESTS ===");
for (const f of failedRequests.slice(0, 20)) console.log(f);
await browser.close();
child.kill("SIGTERM");
process.exit(0);
