import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareOpenClinXrAzureFunctionsDeploy } from "@openclinxr/config-rolldown";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await prepareOpenClinXrAzureFunctionsDeploy({ appDir });
