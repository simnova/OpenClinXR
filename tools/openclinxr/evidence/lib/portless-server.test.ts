/**
 * Scaling proof for dynamic port allocation (non-browser, deterministic).
 * Concurrent findFreePort must not return colliding ports while listeners are held.
 *
 * Also guards Vite Local: line parsing under FORCE_COLOR / ANSI (the #69 re-run
 * failure: Vite printed the Local line in 125ms and the helper still waited 180s).
 */
import { createServer, type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { findFreePort, parseViteLocalPort, stripAnsi } from "./portless-server.js";

describe("parseViteLocalPort (ANSI-safe Local: line)", () => {
  it("parses a plain Vite Local line", () => {
    const out = "VITE v8.0.16  ready in 125 ms\n  ➜  Local:   http://127.0.0.1:49877/\n";
    expect(parseViteLocalPort(out)).toBe(49877);
  });

  it("parses Vite 8 FORCE_COLOR output where Local and URL are SGR-wrapped", () => {
    // Measured shape: bold Local, green arrow, cyan URL — Local:\\s+http never matches raw.
    const colored =
      "\u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:\u001b[32m   http://127.0.0.1:49877/\u001b[39m";
    expect(colored.match(/Local:\s+https?:\/\//)).toBeNull();
    expect(parseViteLocalPort(colored)).toBe(49877);
  });

  it("parses when only the URL is colourised after Local:", () => {
    const colored = "  ➜  Local:   \u001b[36mhttp://127.0.0.1:5174/\u001b[39m";
    expect(parseViteLocalPort(colored)).toBe(5174);
  });

  it("returns null when no Local line is present", () => {
    expect(parseViteLocalPort("VITE v8.0.16  ready in 125 ms\n")).toBeNull();
  });

  it("stripAnsi removes CSI so the human-readable tail matches the match input", () => {
    const colored = "\u001b[1mLocal\u001b[22m:   http://127.0.0.1:9/";
    expect(stripAnsi(colored)).toBe("Local:   http://127.0.0.1:9/");
  });
});

describe("findFreePort (collision-safe for parallel worktrees)", () => {
  it("returns a positive ephemeral port", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  it("returns distinct free ports for N=5 concurrent calls (no collision)", async () => {
    const N = 5;
    // Hold each reserved port open until all N are acquired so the OS cannot
    // reassign a just-closed ephemeral port mid-batch (true parallel-worktree race).
    type Held = { port: number; release: () => Promise<void> };
    const holdFreePort = (): Promise<Held> =>
      new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as AddressInfo | null;
          if (!addr || typeof addr === "string") {
            server.close();
            reject(new Error("no address"));
            return;
          }
          resolve({
            port: addr.port,
            release: () =>
              new Promise((res, rej) => {
                server.close((err) => (err ? rej(err) : res()));
              }),
          });
        });
      });

    // Parallel hold (same mechanism as findFreePort, keeps sockets open).
    const held = await Promise.all(Array.from({ length: N }, () => holdFreePort()));
    try {
      const heldPorts = held.map((h) => h.port);
      expect(new Set(heldPorts).size).toBe(N);

      // Also prove the exported helper returns usable distinct ports in parallel
      // (close-then-return pattern; uniqueness still expected under concurrent listen(0)).
      const freePorts = await Promise.all(Array.from({ length: N }, () => findFreePort()));
      expect(freePorts.every((p) => p > 0 && p < 65536)).toBe(true);
      expect(new Set(freePorts).size).toBe(N);

      // Re-bind every findFreePort result simultaneously — would EADDRINUSE if
      // the helper returned a duplicate still held by a sibling call.
      const rebound = await Promise.all(
        freePorts.map(
          (port) =>
            new Promise<number>((resolve, reject) => {
              const s = createServer();
              s.unref();
              s.once("error", reject);
              s.listen(port, "127.0.0.1", () => {
                resolve(port);
                s.close();
              });
            }),
        ),
      );
      expect(new Set(rebound).size).toBe(N);
    } finally {
      await Promise.all(held.map((h) => h.release()));
    }
  });
});
