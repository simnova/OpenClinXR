/** Manual server entrypoint. The capture driver serves in-process. */
import { startServer } from "./serve.mjs";

const port = Number(process.argv[2] ?? "8931");
await startServer(port);
console.log(`bake-off server on 127.0.0.1:${port}`);
