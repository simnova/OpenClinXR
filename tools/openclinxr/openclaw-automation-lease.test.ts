import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireOpenClawAutomationLease,
  getOpenClawAutomationLeaseStatus,
  OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
  releaseOpenClawAutomationLease,
} from "./openclaw-automation-lease.js";

describe("openclaw automation lease", () => {
  it("acquires and refreshes a same-owner lease", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      const acquired = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "codex-heartbeat",
        slice: "materialization-gate",
        cwd: tempDir,
        now: new Date("2026-05-28T12:00:00.000Z"),
        ttlMinutes: 10,
      });

      expect(acquired).toMatchObject({
        status: "acquired",
        acquired: true,
        staleRecovered: false,
      });
      expect(acquired.lease).toMatchObject({
        schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
        owner: "codex-heartbeat",
        slice: "materialization-gate",
        acquiredAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:00:00.000Z",
        expiresAt: "2026-05-28T12:10:00.000Z",
      });

      const refreshed = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "codex-heartbeat",
        slice: "materialization-gate-followup",
        cwd: tempDir,
        now: new Date("2026-05-28T12:05:00.000Z"),
        ttlMinutes: 10,
      });

      expect(refreshed).toMatchObject({
        status: "refreshed",
        acquired: true,
        staleRecovered: false,
      });
      expect(refreshed.lease).toMatchObject({
        acquiredAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:05:00.000Z",
        expiresAt: "2026-05-28T12:15:00.000Z",
        slice: "materialization-gate-followup",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reports an unexpired different-owner lease as held", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-held-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      await acquireOpenClawAutomationLease({
        leasePath,
        owner: "codex-run-a",
        slice: "slice-a",
        cwd: tempDir,
        now: new Date("2026-05-28T12:00:00.000Z"),
        ttlMinutes: 30,
      });

      const blocked = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "codex-run-b",
        slice: "slice-b",
        cwd: tempDir,
        now: new Date("2026-05-28T12:10:00.000Z"),
        ttlMinutes: 30,
      });

      expect(blocked).toMatchObject({
        status: "held",
        acquired: false,
      });
      expect(blocked.lease).toMatchObject({
        owner: "codex-run-a",
        slice: "slice-a",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("recovers an expired lease for a new owner", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-stale-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      await writeFile(
        leasePath,
        `${JSON.stringify({
          schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
          owner: "old-run",
          slice: "old-slice",
          cwd: tempDir,
          acquiredAt: "2026-05-28T11:00:00.000Z",
          updatedAt: "2026-05-28T11:00:00.000Z",
          expiresAt: "2026-05-28T11:30:00.000Z",
        })}\n`,
        "utf8",
      );

      const recovered = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "new-run",
        slice: "new-slice",
        cwd: tempDir,
        now: new Date("2026-05-28T12:00:00.000Z"),
        ttlMinutes: 10,
      });

      expect(recovered).toMatchObject({
        status: "acquired",
        acquired: true,
        staleRecovered: true,
      });
      expect(recovered.lease).toMatchObject({
        owner: "new-run",
        slice: "new-slice",
        acquiredAt: "2026-05-28T12:00:00.000Z",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("releases only the owning lease", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-release-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      await acquireOpenClawAutomationLease({
        leasePath,
        owner: "codex-owner",
        slice: "slice",
        cwd: tempDir,
        now: new Date("2026-05-28T12:00:00.000Z"),
      });

      const wrongOwner = await releaseOpenClawAutomationLease({
        leasePath,
        owner: "someone-else",
        cwd: tempDir,
      });
      expect(wrongOwner).toMatchObject({
        status: "held",
        acquired: false,
      });

      const released = await releaseOpenClawAutomationLease({
        leasePath,
        owner: "codex-owner",
        cwd: tempDir,
      });
      expect(released).toMatchObject({
        status: "released",
        acquired: false,
        lease: null,
      });

      const status = await getOpenClawAutomationLeaseStatus({
        leasePath,
        cwd: tempDir,
      });
      expect(status).toMatchObject({
        status: "none",
        lease: null,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
