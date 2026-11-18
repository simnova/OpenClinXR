import { describe, expect, it, vi } from "vitest";
import { withPortlessServer } from "./capture-deps.js";

function stubDeps(stop: () => Promise<void>) {
  const order: string[] = [];
  return {
    order,
    deps: {
      spawnPortlessDevServer: async (_opts: { filter: string }) => {
        order.push("spawn");
        return { url: "http://127.0.0.1:9/", proc: {} as never };
      },
      stopPortlessDevServer: async (_proc: unknown) => {
        order.push("stop");
        await stop();
      },
    },
  };
}

describe("server lifecycle: teardown errors surface", () => {
  it("resolves the body value when the stub stop resolves (no browser, no network)", async () => {
    const { deps, order } = stubDeps(async () => {});
    const seen: string[] = [];
    const out = await withPortlessServer(deps, { filter: "@openclinxr/ui-xr" }, async (server) => {
      seen.push(server.url);
      return 7;
    });
    expect(out).toBe(7);
    expect(seen).toEqual(["http://127.0.0.1:9/"]);
    expect(order).toEqual(["spawn", "stop"]);
  });

  it("rejects when the stub stop throws, after the body already ran", async () => {
    const { deps, order } = stubDeps(async () => {
      throw new Error("teardown boom");
    });
    let bodyRan = false;
    await expect(
      withPortlessServer(deps, { filter: "@openclinxr/ui-xr" }, async () => {
        bodyRan = true;
        return 7;
      }),
    ).rejects.toThrow("teardown boom");
    expect(bodyRan).toBe(true);
    expect(order).toEqual(["spawn", "stop"]);
  });

  it("still rejects with the body error when the stub stop succeeds", async () => {
    const { deps } = stubDeps(async () => {});
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        withPortlessServer(deps, { filter: "@openclinxr/ui-xr" }, async () => {
          throw new Error("body boom");
        }),
      ).rejects.toThrow("body boom");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
