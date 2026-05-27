import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const localApiTarget = "http://localhost:3000";

export function createOpenClinXrApiProxy(apiTarget = process.env.OPENCLINXR_API_PROXY_TARGET ?? localApiTarget) {
  return Object.freeze({
    "/health": localApiProxyTarget(apiTarget),
    "/providers": localApiProxyTarget(apiTarget),
    "/runtime": localApiProxyTarget(apiTarget),
    "/voice": localApiProxyTarget(apiTarget),
    "/admin": localApiProxyTarget(apiTarget),
    "/scenario-bank": localApiProxyTarget(apiTarget),
    "/exam-blueprints": localApiProxyTarget(apiTarget),
    "/sessions": localApiProxyTarget(apiTarget),
  });
}

export const openClinXrApiProxy = createOpenClinXrApiProxy();

export const openClinXrAdminBuildOutput = Object.freeze({
  codeSplitting: {
    groups: [
      {
        name: "react-vendor",
        test: /node_modules[\\/](?:\.pnpm[\\/])?(?:react|react-dom|react-router|scheduler)/,
        priority: 30,
      },
      {
        name: "antd-vendor",
        test: /node_modules[\\/](?:\.pnpm[\\/])?(?:antd|@ant-design|rc-)/,
        priority: 25,
      },
      {
        name: "graphql-vendor",
        test: /node_modules[\\/](?:\.pnpm[\\/])?(?:@apollo|graphql|rxjs|@graphql-typed-document-node)/,
        priority: 20,
      },
      {
        name: "vendor",
        test: /node_modules/,
        priority: 10,
      },
    ],
  },
});

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: openClinXrAdminBuildOutput,
    },
  },
  server: {
    proxy: openClinXrApiProxy,
  },
  test: {
    environment: "jsdom",
  },
});

function localApiProxyTarget(apiTarget: string) {
  return {
    target: apiTarget,
    changeOrigin: true,
  };
}
