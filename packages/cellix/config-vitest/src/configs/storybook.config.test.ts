import { describe, expect, it } from "vitest";
import { createStorybookVitestConfig, getStorybookBrowserApiPort } from "./storybook.config.js";

describe("storybook Vitest config", () => {
  it("derives deterministic high ports for browser test APIs", () => {
    const port = getStorybookBrowserApiPort("/workspace/packages/example");

    expect(port).toBe(getStorybookBrowserApiPort("/workspace/packages/example"));
    expect(port).toBeGreaterThanOrEqual(64000);
    expect(port).toBeLessThan(65000);
  });

  it("builds storybook browser projects when optional adapters are injected", async () => {
    const config = await createStorybookVitestConfig(
      "/workspace/packages/ui",
      {
        browsers: [{ browser: "webkit" }],
        additionalCoverageExclude: ["src/generated/**"],
      },
      async <TModule>(specifier: string): Promise<TModule> => {
        if (specifier === "@storybook/addon-vitest/vitest-plugin") {
          return {
            storybookTest: (options: { configDir: string }) => ({
              name: "storybook-test-plugin",
              options,
            }),
          } as TModule;
        }

        return {
          playwright: () => ({ name: "playwright-provider" }),
        } as TModule;
      },
    );

    expect(config.test).toMatchObject({
      api: {
        host: "127.0.0.1",
      },
      globals: true,
      projects: [
        {
          test: {
            name: "unit",
            environment: "jsdom",
          },
        },
        {
          test: {
            name: "storybook",
            browser: {
              enabled: true,
              headless: true,
              instances: [{ browser: "webkit" }],
            },
          },
        },
      ],
      coverage: {
        exclude: expect.arrayContaining(["src/generated/**"]),
      },
    });
  });

  it("throws an actionable message when optional storybook packages are missing", async () => {
    await expect(
      createStorybookVitestConfig("/workspace/packages/ui", {}, async () => {
        throw new Error("module not found");
      }),
    ).rejects.toThrow(/optional package @storybook\/addon-vitest|optional package @vitest\/browser-playwright/);
  });
});
