# Mock Realtime Voice Server

**Arena role:** local WebSocket transport harness for realtime voice and provider-adapter cage matches.

**Governing decisions:** [MADR 0017](../../../docs/madr/0017-websocket-first-realtime-transport.md), [MADR 0019](../../../docs/madr/0019-provider-adapter-model-and-voice-routing.md), [MADR 0021](../../../docs/madr/0021-local-first-no-cloud-implementation-spikes.md), and [MADR 0024](../../../docs/madr/0024-pnpm-node-first-bun-deployment-gate.md).

**Production relationship:** this app may validate local transport behavior, but production code should consume stable voice contracts through `@openclinxr/voice-gateway`.

Useful checks:

- `pnpm --filter @openclinxr/mock-realtime-voice-server typecheck`
- `pnpm --filter @openclinxr/mock-realtime-voice-server test`
- `pnpm arena:voice:dev`

Promotion requires transport evidence, adapter contract tests, and a MADR update if WebSocket-first or Node-first assumptions change.
