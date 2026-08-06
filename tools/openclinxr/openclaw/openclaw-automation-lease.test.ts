import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  it("acquires and refreshes a same-owner same-slice lease", async () => {
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
        slice: "materialization-gate",
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
        slice: "materialization-gate",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("allows two disjoint slices to acquire concurrently", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-multi-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      const first = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "agent-a",
        slice: "slice-a",
        cwd: tempDir,
        now: new Date("2026-05-28T12:00:00.000Z"),
        ttlMinutes: 30,
      });
      const second = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "agent-b",
        slice: "slice-b",
        cwd: tempDir,
        now: new Date("2026-05-28T12:01:00.000Z"),
        ttlMinutes: 30,
      });

      expect(first).toMatchObject({ status: "acquired", acquired: true });
      expect(second).toMatchObject({ status: "acquired", acquired: true });
      expect(second.leases).toHaveLength(2);
      expect(second.leases?.map((slot) => slot.slice).sort()).toEqual(["slice-a", "slice-b"]);

      // Use the same frozen clock as acquire — wall-clock "now" would treat May fixtures as expired.
      const status = await getOpenClawAutomationLeaseStatus({
        leasePath,
        cwd: tempDir,
        now: new Date("2026-05-28T12:02:00.000Z"),
      });
      expect(status.status).toBe("held");
      expect(status.leases).toHaveLength(2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails second acquire for the same slice (same-slice contention)", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-held-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      await acquireOpenClawAutomationLease({
        leasePath,
        owner: "codex-run-a",
        slice: "shared-slice",
        cwd: tempDir,
        now: new Date("2026-05-28T12:00:00.000Z"),
        ttlMinutes: 30,
      });

      const blocked = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "codex-run-b",
        slice: "shared-slice",
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
        slice: "shared-slice",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("recovers a stale/expired lease for a new owner", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-stale-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      // v1 single-lease on disk still migrates + recovers when expired
      await writeFile(
        leasePath,
        `${JSON.stringify({
          schemaVersion: "openclinxr.openclaw-automation-lease.v1",
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
        slice: "old-slice",
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
        slice: "old-slice",
        acquiredAt: "2026-05-28T12:00:00.000Z",
      });

      const raw = await readFile(leasePath, "utf8");
      const parsed = JSON.parse(raw) as { schemaVersion: string; slots: unknown[] };
      expect(parsed.schemaVersion).toBe(OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION);
      expect(parsed.slots).toHaveLength(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("recovers a stale multi-slot entry while leaving other active slots", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-stale-multi-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      await acquireOpenClawAutomationLease({
        leasePath,
        owner: "alive",
        slice: "alive-slice",
        cwd: tempDir,
        now: new Date("2026-05-28T12:00:00.000Z"),
        ttlMinutes: 60,
      });
      await writeFile(
        leasePath,
        `${JSON.stringify({
          schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
          slots: [
            {
              schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
              owner: "alive",
              slice: "alive-slice",
              cwd: tempDir,
              acquiredAt: "2026-05-28T12:00:00.000Z",
              updatedAt: "2026-05-28T12:00:00.000Z",
              expiresAt: "2026-05-28T13:00:00.000Z",
            },
            {
              schemaVersion: OPENCLAW_AUTOMATION_LEASE_SCHEMA_VERSION,
              owner: "dead",
              slice: "dead-slice",
              cwd: tempDir,
              acquiredAt: "2026-05-28T11:00:00.000Z",
              updatedAt: "2026-05-28T11:00:00.000Z",
              expiresAt: "2026-05-28T11:30:00.000Z",
            },
          ],
        })}\n`,
        "utf8",
      );

      const recovered = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "reviver",
        slice: "dead-slice",
        cwd: tempDir,
        now: new Date("2026-05-28T12:30:00.000Z"),
        ttlMinutes: 15,
      });

      expect(recovered).toMatchObject({
        status: "acquired",
        acquired: true,
        staleRecovered: true,
      });
      expect(recovered.leases?.map((slot) => `${slot.owner}@${slot.slice}`).sort()).toEqual([
        "alive@alive-slice",
        "reviver@dead-slice",
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("releases only the owning slot and leaves other slices", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-release-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      await acquireOpenClawAutomationLease({
        leasePath,
        owner: "codex-owner",
        slice: "slice-a",
        cwd: tempDir,
        now: new Date("2026-05-28T12:00:00.000Z"),
      });
      await acquireOpenClawAutomationLease({
        leasePath,
        owner: "other-owner",
        slice: "slice-b",
        cwd: tempDir,
        now: new Date("2026-05-28T12:01:00.000Z"),
      });

      const clock = new Date("2026-05-28T12:05:00.000Z");
      const wrongOwner = await releaseOpenClawAutomationLease({
        leasePath,
        owner: "someone-else",
        slice: "slice-a",
        cwd: tempDir,
        now: clock,
      });
      expect(wrongOwner).toMatchObject({
        status: "held",
        acquired: false,
      });

      const released = await releaseOpenClawAutomationLease({
        leasePath,
        owner: "codex-owner",
        slice: "slice-a",
        cwd: tempDir,
        now: clock,
      });
      expect(released).toMatchObject({
        status: "released",
        acquired: false,
        lease: null,
      });
      expect(released.leases).toHaveLength(1);
      expect(released.leases?.[0]).toMatchObject({ owner: "other-owner", slice: "slice-b" });

      const status = await getOpenClawAutomationLeaseStatus({
        leasePath,
        cwd: tempDir,
        now: clock,
      });
      expect(status).toMatchObject({
        status: "held",
      });
      expect(status.leases).toHaveLength(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks acquire when writeRoots overlap even for disjoint slices", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-openclaw-lease-roots-"));
    try {
      const leasePath = path.join(tempDir, "lease.json");
      await acquireOpenClawAutomationLease({
        leasePath,
        owner: "writer-a",
        slice: "slice-a",
        cwd: tempDir,
        writeRoots: ["apps/ui-xr"],
        now: new Date("2026-05-28T12:00:00.000Z"),
        ttlMinutes: 30,
      });

      const blocked = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "writer-b",
        slice: "slice-b",
        cwd: tempDir,
        writeRoots: ["apps/ui-xr/src"],
        now: new Date("2026-05-28T12:01:00.000Z"),
        ttlMinutes: 30,
      });

      expect(blocked).toMatchObject({ status: "held", acquired: false });
      expect(blocked.lease).toMatchObject({ owner: "writer-a", slice: "slice-a" });

      const ok = await acquireOpenClawAutomationLease({
        leasePath,
        owner: "writer-c",
        slice: "slice-c",
        cwd: tempDir,
        writeRoots: ["packages/openclinxr/agent-loop"],
        now: new Date("2026-05-28T12:02:00.000Z"),
        ttlMinutes: 30,
      });
      expect(ok).toMatchObject({ status: "acquired", acquired: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
