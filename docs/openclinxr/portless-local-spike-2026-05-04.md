# Portless Local Spike

Date: 2026-05-04
Status: Advisory local developer-experience evidence

## Commands Run

```bash
pnpm view portless version license description --json
pnpm dlx portless@0.12.0 --help
```

No proxy was started, no certificate was trusted, no hosts entries were changed, and no privileged command was run.

## Results

- `portless` package metadata: version `0.12.0`, license `Apache-2.0`.
- The CLI help confirms package-managed use is possible through a project dev dependency or `pnpm dlx`.
- The help describes stable named `.localhost` URLs, monorepo workspace discovery, worktree-prefixed URLs, Vite/React Router `--port` and `--host` flag injection, `PORT`/`HOST`/`PORTLESS_URL` child process environment variables, and LAN mode for same-network device testing.
- The help also confirms first real proxy use may run HTTPS on port 443, auto-elevate with `sudo` on macOS/Linux, generate and trust a local CA, and sync hostnames to `/etc/hosts` for Safari/system resolver compatibility.

## Guidance

Keep Portless optional and interactive. It is a good candidate for parallel local worktrees and agent-owned dev servers, but do not add it to `pnpm verify`, do not start the proxy unattended, and do not replace Quest 3 USB-C `adb reverse` evidence with Portless LAN mode until a headset spike validates that path.
