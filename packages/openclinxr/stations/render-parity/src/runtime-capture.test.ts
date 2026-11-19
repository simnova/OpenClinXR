/** I4: --calib-sweep resolves under --cwd at the runRuntimeCapture level. */
import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCaptureArgs } from "./capture-args.js";
import type { CaptureDeps } from "./capture-deps.js";
import { runRuntimeCapture } from "./runtime-capture.js";

const SUBJECT = {
  id: "probe-subject",
  bodyGlb: "probe.glb",
  hdriUrl: "/probe.hdr",
  bodyMeshName: "probe_body",
  garmentMeshNames: [] as string[],
};

const CAMERAS = {
  cameras: [
    {
      name: "head_front",
      resolution: [8, 8],
      vfov_deg: 30,
      near: 0.01,
      far: 100,
      three: {
        position: [0, 1.6, 2],
        target: [0, 1.5, 0],
        up: [0, 1, 0],
        quaternion: [0, 0, 0, 1],
      },
    },
  ],
};

describe("I4: calib-sweep path resolves under --cwd before any browser launch", () => {
  it("runRuntimeCapture creates <cwd>/<relative> parent pre-launch; launch sentinel propagates", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "sweep-cwd-"));
    // Serve >1MB so the HDRI reachability gate passes against stub server URL.
    const big = Buffer.alloc(1_100_000, 7);
    const srv = createServer((_req, res) => {
      res.writeHead(200, { "content-length": String(big.length) });
      res.end(big);
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const port = (srv.address() as AddressInfo).port;
      writeFileSync(path.join(cwd, "cameras.json"), JSON.stringify(CAMERAS));
      const cli = parseCaptureArgs([
        "--cameras",
        "cameras.json",
        "--calib-sweep",
        "rel/sweep.json",
        "--levers",
        "baseline",
        "--cwd",
        cwd,
      ]);
      const deps: CaptureDeps = {
        chromium: {
          launch: async () => {
            throw new Error("SENTINEL-LAUNCH");
          },
        },
        spawnPortlessDevServer: async (_opts: { filter: string }) => ({
          url: `http://127.0.0.1:${port}/`,
          proc: {} as never,
        }),
        stopPortlessDevServer: async (_proc: unknown) => {},
        BROWSER_PAGE_GLOBALS_INIT_SCRIPT: "",
      };
      const err = await runRuntimeCapture(cli, SUBJECT, deps).catch((e: unknown) => e);
      // Reached browser launch (sentinel), past all path handling: the sweep
      // path was resolved before launch.
      expect(String(err)).toContain("SENTINEL-LAUNCH");
      // The joined path lives under cwd, not under the process cwd.
      expect(existsSync(path.join(cwd, "rel"))).toBe(true);
      expect(path.join(cwd, "rel", "sweep.json").startsWith(cwd)).toBe(true);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
