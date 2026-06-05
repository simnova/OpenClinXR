import { serve } from "@hono/node-server";
import { createNodeServerConfig, createOpenClinXrApiStartup } from "./index.js";

const port = Number(process.env["PORT"] ?? 3000);
const startup = createOpenClinXrApiStartup().startUp();

serve(createNodeServerConfig(startup, { port }));

console.log(`OpenClinXR API listening on http://localhost:${port}`);
