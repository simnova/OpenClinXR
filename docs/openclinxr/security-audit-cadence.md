# PNPM Audit Cadence Runbook

This runbook keeps security evidence current without changing verification gates.

## Scope

- `pnpm audit --audit-level=high` snapshotting
- Policy validation against snapshot JSON
- Recording the latest evidence references in `security-audit-exceptions.md`

## Cadence

- Weekly baseline (or more often during dependency churn).
- Immediately after lockfile updates from approved proposals or dependency maintenance.
- Before major milestone handoff or release gates where posture drift matters.

## Steps

```bash
pnpm security:audit:snapshot
```

or run manually:

```bash
pnpm audit --audit-level=high --json > docs/openclinxr/security-audit-YYYY-MM-DD.json
pnpm security:audit-policy -- --audit-json docs/openclinxr/security-audit-YYYY-MM-DD.json --output docs/openclinxr/security-audit-policy-YYYY-MM-DD.json
```

## Required follow-up

- Update `docs/openclinxr/security-audit-exceptions.md` with the new timestamped artifacts.
- Check in the latest artifacts in the same commit as the lockfile change or milestone handoff evidence.

## Validation

Run:

```bash
pnpm security:audit-policy -- --audit-json docs/openclinxr/security-audit-YYYY-MM-DD.json --output docs/openclinxr/security-audit-policy-YYYY-MM-DD.json
```

and confirm the command succeeds for the same `YYYY-MM-DD` artifacts.
