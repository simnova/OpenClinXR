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

console.log("Azure bundle smoke passed");
