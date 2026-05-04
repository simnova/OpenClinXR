import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const localApiTarget = "http://localhost:3000";

export const openClinXrApiProxy = Object.freeze({
  "/health": localApiProxyTarget(),
  "/providers": localApiProxyTarget(),
  "/admin": localApiProxyTarget(),
  "/scenarios": localApiProxyTarget(),
  "/scenario-bank": localApiProxyTarget(),
  "/exam-blueprints": localApiProxyTarget(),
  "/sessions": localApiProxyTarget(),
});

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

function localApiProxyTarget() {
  return {
    target: localApiTarget,
    changeOrigin: true,
  };
}
