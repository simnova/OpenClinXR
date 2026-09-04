/**
 * Vite config for the acceptance-run ui-admin build.
 *
 * ui-admin's production bundle crashes in the browser when a workspace dependency pulls
 * `util.promisify` into the client graph, so this config builds the real ui-admin app
 * (same root + plugins as apps/ui-admin/vite.config.ts) while aliasing `util`/`node:util`
 * to a browser-safe polyfill for the acceptance browser session only. Nothing product-side
 * is changed.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import base from "../../../apps/ui-admin/vite.config.ts";

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(helperDir, "../../../apps/ui-admin");
const require = createRequire(path.join(adminRoot, "package.json"));
const { defineConfig, mergeConfig } = require("vite") as {
  defineConfig: (config: unknown) => unknown;
  mergeConfig: (defaults: unknown, overrides: unknown) => unknown;
};

const utilPolyfill = path.join(helperDir, "node-util-polyfill.ts");

export default mergeConfig(
  base,
  defineConfig({
    root: adminRoot,
    resolve: {
      alias: [
        { find: /^node:util$/, replacement: utilPolyfill },
        { find: /^util$/, replacement: utilPolyfill },
      ],
    },
  }),
);
