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

export default defineConfig({
  plugins: [react()],
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
