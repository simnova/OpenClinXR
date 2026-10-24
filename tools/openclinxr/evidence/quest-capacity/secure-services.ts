import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { createSecureServer, type Http2Session } from "node:http2";
import { tmpdir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Socket } from "node:net";
import { localAppOrigin, makeSecureRoutes, makeSecureWebSocket, newServiceCounters, SECURE_BOUNDS } from "./secure-routes.js";

export interface SecureServiceManifest {
  schema: "quest-capacity-services.v1";
  httpsOrigin: string; wssUrl: string; echoUrl: string; assetUrl: string; imageAssetUrl: string;
  rtcOfferUrl: string; rtcCloseUrl: string; peerStatsUrl: string; webTransportUrl: string;
  certificateHashes: { algorithm: "sha-256"; value: number[] }[];
  certificateSpkiSha256Base64: string; certificateValidTo: string;
  serverBuildHash: string; runtimeVersions: Record<string, string>;
  applicationDelayMs: number;
  token: string; origins: string[]; bounds: typeof SECURE_BOUNDS;
  bindings: { tcpHost: string; tcpPort: number; udpHost: string; udpPort: number; advertisedHost: string; localIpv4: string[] };
  trust: "ephemeral-test-certificate; HTTPS/WSS collector declares scoped SPKI allowlist or target-scoped certificate exception; WT uses DER SHA256 pin; no OS trust changes";
  routeScope: "local-loopback" | "explicit-lan-bind; selected paths require RTC/QUIC observations";
}
export interface SecureServiceOptions { bindHost?: "127.0.0.1" | "0.0.0.0"; advertiseHost?: string | undefined; appOrigin?: string | undefined; python?: string | undefined; allowedOrigins?: string[] | undefined; echoDelayMs?: number | undefined }
const directory = fileURLToPath(new URL("./secure/", import.meta.url));
const sourceDirectory = fileURLToPath(new URL("./", import.meta.url));
function childEnv() { return { ...process.env, MISE_TRUSTED_CONFIG_PATHS: resolve(sourceDirectory, "../../../../mise.toml") }; }
async function execute(command: string, args: string[], timeoutMs = 90_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env: childEnv(), stdio: ["ignore", "pipe", "pipe"] }); let output = ""; let errors = "";
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (output.length < 16384) output += String(chunk); });
    child.stderr.on("data", (chunk) => { if (errors.length < 2048) errors += String(chunk); });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("exit", (code) => { clearTimeout(timeout); if (code === 0) resolvePromise(output); else reject(new Error(`${command} failed (${code}): ${errors.slice(0, 1200)}`)); });
  });
}
async function pythonRuntime(runtime: string, supplied?: string): Promise<string> {
  if (supplied) return supplied;
  const venv = join(runtime, "venv");
  await execute("uv", ["venv", "--python", "3.13", venv]);
  const python = join(venv, "bin", "python");
  await execute("uv", ["pip", "sync", "--python", python, join(directory, "requirements.txt")], 180_000);
  return python;
}
function launchPeers(python: string, args: string[]): Promise<{ child: ChildProcess; rtcPort: number; wtPort: number; versions: Record<string, string> }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, [join(directory, "peers.py"), ...args], { stdio: ["ignore", "pipe", "pipe"], env: childEnv() }); let stdout = ""; let stderr = ""; let done = false;
    const fail = (error: Error) => { if (done) return; done = true; clearTimeout(timeout); child.kill("SIGTERM"); reject(error); };
    const timeout = setTimeout(() => fail(new Error(`Peer readiness deadline: ${stderr.slice(0, 800)}`)), 15_000);
    child.stderr!.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-2048); });
    child.stdout!.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 16384) { fail(new Error("Peer readiness output bound")); return; }
      if (!stdout.includes("\n")) return;
      try { const value = JSON.parse(stdout.split("\n")[0]!); if (!value.ready || !Number.isInteger(value.rtcPort) || !Number.isInteger(value.wtPort)) throw new Error("Invalid peer readiness"); done = true; clearTimeout(timeout); resolvePromise({ child, rtcPort: value.rtcPort, wtPort: value.wtPort, versions: value.versions }); } catch { fail(new Error(`Invalid peer readiness: ${stderr.slice(0, 800)}`)); }
    });
    child.once("error", fail); child.once("exit", (code) => { if (!done) fail(new Error(`Peer exited (${code}): ${stderr.slice(0, 800)}`)); });
  });
}
async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolvePromise) => {
    const kill = setTimeout(() => child.kill("SIGKILL"), 4000);
    child.once("exit", () => { clearTimeout(kill); resolvePromise(); }); child.kill("SIGTERM");
  });
}
async function buildHash(versions: Record<string, string>) {
  const names = ["secure-services.ts", "secure-routes.ts", "secure-image.ts", "secure/peers.py", "secure/rtc_peer.py", "secure/wt_peer.py", "secure/requirements.txt"];
  const hash = createHash("sha256");
  for (const name of names) { hash.update(name); hash.update(await readFile(join(sourceDirectory, name))); }
  hash.update(JSON.stringify(Object.fromEntries(Object.entries(versions).sort()))); return hash.digest("hex");
}
/** Local test services only. Private keys and ephemeral virtualenv are destroyed by close(). */
export async function startSecureServices(options: SecureServiceOptions = {}) {
  const appOrigin = localAppOrigin(options.appOrigin);
  const applicationDelayMs = options.echoDelayMs ?? 0; if (!Number.isInteger(applicationDelayMs) || applicationDelayMs < 0 || applicationDelayMs > 1000) throw new Error("echoDelayMs must be integer0–1000 application delay, not network impairment");
  const localIpv4 = Object.values(networkInterfaces()).flatMap((entries) => entries ?? []).filter((entry) => entry.family === "IPv4" && !entry.internal).map((entry) => entry.address).sort();
  const bindHost = options.bindHost ?? "127.0.0.1"; const host = options.advertiseHost ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", ...localIpv4].includes(host) || (bindHost === "127.0.0.1" && !["127.0.0.1", "localhost"].includes(host))) throw new Error("advertiseHost must be loopback or a current local IPv4 with explicit 0.0.0.0 bind");
  const origins = (options.allowedOrigins ?? []).map((value) => { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error("Explicit allowedOrigins must be exact HTTP(S) origins"); return value; });
  const runtime = await mkdtemp(join(tmpdir(), `openclinxr-capacity-secure-${process.pid}-`)); await chmod(runtime, 0o700);
  let peer: ChildProcess | undefined; let manifest: SecureServiceManifest; let rtcPort = 0; let closed = false;
  const sockets = new Set<Socket>(); const sessions = new Set<Http2Session>(); const counters = newServiceCounters();
  const cert = join(runtime, "certificate.pem"); const key = join(runtime, "private-key.pem");
  let server: ReturnType<typeof createSecureServer> | undefined; let ws: ReturnType<typeof makeSecureWebSocket> | undefined;
  const close = async () => {
    if (closed) return; closed = true;
    await ws?.close(); for (const session of sessions) session.destroy(); for (const socket of sockets) socket.destroy();
    if (server?.listening) await new Promise<void>((resolvePromise) => server!.close(() => resolvePromise()));
    await stopChild(peer); await rm(runtime, { recursive: true, force: true });
  };
  try {
    const openssl = (await execute("openssl", ["version"])).trim();
    await execute("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", key, "-out", cert, "-days", "13", "-subj", "/CN=OpenClinXR capacity test", "-addext", `subjectAltName=DNS:localhost,IP:127.0.0.1${localIpv4.map((ip) => `,IP:${ip}`).join("")}`]); await chmod(key, 0o600);
    const [certificate, privateKey] = await Promise.all([readFile(cert), readFile(key)]);
    const x509 = new X509Certificate(certificate);
    server = createSecureServer({ cert: certificate, key: privateKey, allowHTTP1: true, maxSessionMemory: 16, maxHeaderListPairs: 32, settings: { maxConcurrentStreams: 16, maxHeaderListSize: 8192 } });
    server.on("session", (session) => { sessions.add(session); session.on("close", () => sessions.delete(session)); session.on("error", () => undefined); });
    server.on("connection", (socket) => { sockets.add(socket); if (sockets.size > SECURE_BOUNDS.maxConnections) socket.destroy(); socket.setTimeout(30_000, () => socket.destroy()); socket.on("close", () => sockets.delete(socket)); });
    server.on("error", () => undefined); server.setTimeout(30_000);
    ws = makeSecureWebSocket(() => manifest, counters); server.on("upgrade", ws.upgrade);
    server.on("request", (request, response) => { void makeSecureRoutes(() => manifest, counters, () => rtcPort, appOrigin)(request, response); });
    await new Promise<void>((resolvePromise, reject) => { server!.once("error", reject); server!.listen(0, bindHost, () => { server!.off("error", reject); resolvePromise(); }); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing TCP bind address");
    const httpsOrigin = `https://${host}:${address.port}`; const token = randomBytes(24).toString("hex");
    const allowedOrigins = [...new Set([httpsOrigin, ...(appOrigin ? [appOrigin] : []), ...origins])];
    const python = await pythonRuntime(runtime, options.python);
    const launched = await launchPeers(python, ["--cert", cert, "--key", key, "--token", token, "--origins", JSON.stringify(allowedOrigins), "--host", bindHost, "--echo-delay-ms", String(applicationDelayMs)]); peer = launched.child; rtcPort = launched.rtcPort;
    const path = (name: string) => `${httpsOrigin}/capacity/${name}?token=${token}`;
    const runtimeVersions = { node: process.version, ws: String(createRequire(import.meta.url)("ws/package.json").version), openssl, ...launched.versions };
    manifest = { schema: "quest-capacity-services.v1", applicationDelayMs, httpsOrigin, token, wssUrl: path("ws").replace("https:", "wss:"), echoUrl: path("echo"), assetUrl: path("asset"), imageAssetUrl: path("image") + "&side=256", rtcOfferUrl: path("rtc/offer"), rtcCloseUrl: path("rtc/close"), peerStatsUrl: path("peer-stats"), webTransportUrl: `https://${host}:${launched.wtPort}/capacity/wt?token=${token}`, certificateHashes: [{ algorithm: "sha-256", value: [...createHash("sha256").update(x509.raw).digest()] }], certificateSpkiSha256Base64: createHash("sha256").update(x509.publicKey.export({ type: "spki", format: "der" })).digest("base64"), certificateValidTo: x509.validTo, serverBuildHash: await buildHash(runtimeVersions), runtimeVersions, origins: allowedOrigins, bounds: SECURE_BOUNDS, bindings: { tcpHost: bindHost, tcpPort: address.port, udpHost: bindHost, udpPort: launched.wtPort, advertisedHost: host, localIpv4 }, trust: "ephemeral-test-certificate; HTTPS/WSS collector declares scoped SPKI allowlist or target-scoped certificate exception; WT uses DER SHA256 pin; no OS trust changes", routeScope: bindHost === "127.0.0.1" ? "local-loopback" : "explicit-lan-bind; selected paths require RTC/QUIC observations" };
    return { manifest, close, counters };
  } catch (error) { await close(); throw error; }
}
