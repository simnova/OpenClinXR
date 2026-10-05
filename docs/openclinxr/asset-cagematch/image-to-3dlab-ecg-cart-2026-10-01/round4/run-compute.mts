import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { writeFile } from "node:fs/promises";
import process from "node:process";

const [kind, receiptPath, command, ...args] = process.argv.slice(2);
if (!kind || !receiptPath || !command || !["gpu", "blender"].includes(kind)) {
  throw new Error("usage: run-compute.mts gpu|blender RECEIPT COMMAND [ARGS...]");
}

const start = new Date();
const services = createLocalComputeServices({ cwd: process.cwd(), env: process.env });
const result = kind === "gpu"
  ? await services.gpuJob.run({
      command,
      args,
      cwd: process.cwd(),
      label: `ecg-cart-round4:${args[0] ?? command}`,
      timeoutMs: 7_200_000,
      env: { ...process.env, OPENCLINXR_WORKER: "1" },
    })
  : await services.blender.run({
      script: command,
      args,
      label: `ecg-cart-round4:${args.find((arg) => arg.endsWith(".py")) ?? command}`,
      timeoutMs: 900_000,
    });
const end = new Date();
const receipt = {
  kind,
  command,
  args,
  start: start.toISOString(),
  end: end.toISOString(),
  wallSeconds: (end.getTime() - start.getTime()) / 1000,
  ...result,
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
