# Portless Local Spike

Date: 2026-05-04
Status: Advisory local developer-experience evidence, updated after operator trust setup

## Commands Run

```bash
pnpm view portless version license description --json
pnpm dlx portless@0.12.0 --help
pnpm dlx portless@0.12.0 proxy start --port 1355 --https
pnpm dlx portless@0.12.0 ui-xr --app-port 5176 /Users/patrick/.nvm/versions/node/v22.19.0/bin/node /Users/patrick/Documents/New\\ project\\ 2/apps/ui-xr/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort
```

The initial spike did not start a proxy, trust a certificate, edit hosts entries, or run privileged commands. Patrick later ran `portless trust`, after which Codex used an unprivileged HTTPS proxy on port `1355`; no sudo command was run by Codex.

## Results

- `portless` package metadata: version `0.12.0`, license `Apache-2.0`.
- The CLI help confirms package-managed use is possible through a project dev dependency or `pnpm dlx`.
- The help describes stable named `.localhost` URLs, monorepo workspace discovery, worktree-prefixed URLs, Vite/React Router `--port` and `--host` flag injection, `PORT`/`HOST`/`PORTLESS_URL` child process environment variables, and LAN mode for same-network device testing.
- The help also confirms first real proxy use may run HTTPS on port 443, auto-elevate with `sudo` on macOS/Linux, generate and trust a local CA, and sync hostnames to `/etc/hosts` for Safari/system resolver compatibility.
- After operator trust setup, `portless proxy start --port 1355 --https` started successfully without privileged port binding.
- Chrome DevTools MCP loaded `https://ui-xr.localhost:1355`, found the `ED Chest Pain` station shell, observed a live `500x473` canvas, saw `window.__openClinXrFrameStats.framesObserved` incrementing, and found no warning/error console messages.
- The filtered pnpm script path and a direct `pnpm exec vite` child path under Portless exposed Node `21.7.1` even though the normal repo shell uses Node `22.19.0`; the stable smoke command used the explicit Node 22 binary to run Vite.

## Guidance

Keep Portless optional and interactive. It is a good candidate for parallel local worktrees and agent-owned dev servers, but do not add it to `pnpm verify`, do not start privileged/default-port proxy setup unattended, and do not replace Quest 3 USB-C `adb reverse` evidence with Portless LAN mode until a headset spike validates that path.

For local XR app smoke on this machine, prefer:

```bash
pnpm dlx portless@0.12.0 proxy start --port 1355 --https
pnpm dlx portless@0.12.0 ui-xr --app-port 5176 /Users/patrick/.nvm/versions/node/v22.19.0/bin/node /Users/patrick/Documents/New\\ project\\ 2/apps/ui-xr/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort
```
