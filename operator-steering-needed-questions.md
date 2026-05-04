# Operator Steering Needed Questions

This file is for true operator blockers only: decisions, confirmations, credentials, hardware actions, paid/cloud/API usage, destructive actions, or local trust/security changes that Codex should not perform unattended.

## Open Blockers

- None at the moment. Current work can continue locally with repo tests, local builds, source-ledger updates, and non-paid package-managed spikes.

## Recently Resolved

- Portless local trust: Patrick ran `portless trust`, so Codex can use Portless for local developer/browser routing experiments when useful. Codex verified an unprivileged local proxy on port `1355`; do not add Portless to mandatory repo scripts, start privileged/default-port proxy setup, or start LAN/Tailscale/public sharing without explicit steering.

## Standing Rules

- Ask before destructive git/file operations, paid/cloud/API usage, production credentials, or changes that alter machine-level trust/security state.
- Prefer local deterministic spikes, repo-managed dependencies, and verified commits before requesting steering.
