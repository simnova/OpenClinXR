import { serve } from "@hono/node-server";
import {
  createNodeServerConfig,
  createOpenClinXrApiStartup,
  type StartedOpenClinXrApi,
} from "./index.js";

const port = Number(process.env["PORT"] ?? 3000);

async function resolveStartup(): Promise<StartedOpenClinXrApi> {
  if (process.env["OPENCLINXR_PERSISTENCE"] !== "mongodb") {
    return createOpenClinXrApiStartup().startUp();
  }
  // Composition root: load Mongo boot from tools/ via a non-static specifier so apps/api
  // stays persistence-agnostic (architecture rule) and the default build graph is Mongo-free.
  const bootSpecifier = "../../../tools/openclinxr/api-mongo-boot.js";
  const bootModule = (await import(bootSpecifier)) as {
    createBootedOpenClinXrApiStartup: (
      env?: NodeJS.ProcessEnv,
    ) => Promise<{ startup: StartedOpenClinXrApi; boot: { mode: string; fallbackReason?: string } }>;
  };
  const { startup, boot } = await bootModule.createBootedOpenClinXrApiStartup(process.env);
  console.log(
    `OpenClinXR API persistence mode: ${boot.mode}${boot.fallbackReason ? ` (fallback: ${boot.fallbackReason})` : ""}`,
  );
  return startup;
}

const startup = await resolveStartup();
serve(createNodeServerConfig(startup, { port }));
console.log(`OpenClinXR API listening on http://localhost:${port}`);
