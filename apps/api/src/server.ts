import { serve } from "@hono/node-server";
import { createApiApp } from "./index.js";

const port = Number(process.env.PORT ?? 3000);

serve({
  fetch: createApiApp().fetch,
  port,
});

console.log(`OpenClinXR API listening on http://localhost:${port}`);

