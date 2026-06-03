# MADR 0017: Use WebSocket First And Keep WebTransport As A Spike

Status: Accepted for planning
Date: 2026-05-03

## Context

The original architecture favored WebTransport. The user also wants Hono/Bun networking flexibility, Azure App Service Plan B1 compatibility, and Quest 3 performance. WebTransport is promising, but end-to-end HTTP/3 support across headset, TLS, proxy, Azure, and runtime path is not yet validated for the pilot.

## Decision

Use WebSocket first for the single-user pilot. Keep a `RealtimeTransport` interface so WebTransport can be added after support and performance are proven on the exact Quest 3 and Azure path.

## Consequences

Positive:

- Reduces pilot deployment risk on Azure B1.
- Aligns with Bun WebSocket support and voice-provider WebSocket patterns.
- Keeps real-time messages simple for a single-user exam.

Negative:

- May leave lower-latency datagram/stream options unused until a later spike.
- Requires disciplined transport abstraction to avoid WebSocket assumptions leaking into station logic.

## Reversal Trigger

Switch the default transport only after WebTransport works reliably on Quest 3, Azure/proxy supports the path, and measured WebSocket performance is insufficient for station needs.

## Sources

- `src-mdn-webtransport-2026`
- `src-azure-app-service-plan-docs-2026`
- `src-xai-voice-api-docs-2026`
