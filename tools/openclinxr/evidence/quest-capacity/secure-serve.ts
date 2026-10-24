import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { allowOptions, parseArguments, stringOption, integerOption, flagOption } from "./args.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "../lib/portless-server.js";
import { startSecureServices } from "./secure-services.js";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
export async function serveSecure(argv = process.argv.slice(2)) {
  const { options } = parseArguments(["secure-serve", ...argv]);
  allowOptions(options, ["bind-host", "advertise-host", "app-origin", "python", "allowed-origin", "echo-delay-ms", "service-only"]);
  const bindHost = stringOption(options, "bind-host") ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(bindHost)) throw new Error("--bind-host must be127.0.0.1 or0.0.0.0");
  const serviceOnly = flagOption(options, "service-only"); let appOrigin = stringOption(options, "app-origin"); let app: PortlessDevServer | undefined;
  const origin = stringOption(options, "allowed-origin");
  if (serviceOnly && appOrigin) throw new Error("--service-only cannot combine with --app-origin");
  if (!serviceOnly && !appOrigin) { app = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: root, readyTimeoutMs: 45000, env: { OPENCLINXR_CAPACITY_TLS_PROXY: "1" } }); appOrigin = new URL(app.url).origin; }
  try {
    const service = await startSecureServices({ bindHost: bindHost as "127.0.0.1" | "0.0.0.0", advertiseHost: stringOption(options, "advertise-host"), appOrigin, python: stringOption(options, "python"), allowedOrigins: origin ? [origin] : [], echoDelayMs: integerOption(options, "echo-delay-ms", 0, 0, 1000) });
    const lab = new URL(service.manifest.httpsOrigin); lab.searchParams.set("capacity", "1"); lab.searchParams.set("services", `${service.manifest.httpsOrigin}/capacity/manifest`);
    process.stdout.write(`${JSON.stringify({ ...service.manifest, labUrl: serviceOnly ? null : lab.href })}\n`);
    const close = async () => { await service.close(); if (app) await stopPortlessDevServer(app.proc); };
    const stop = async () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); await close(); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    return { ...service, close, labUrl: serviceOnly ? null : lab.href };
  } catch (error) { if (app) await stopPortlessDevServer(app.proc); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serveSecure().catch((error) => { process.stderr.write(`${JSON.stringify({ error: String(error) })}\n`); process.exitCode = 2; });
