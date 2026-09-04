import { Input, Select, Space, Switch, type TableColumnsType, Tag, Typography } from "antd";
import { type ReactElement, useEffect, useState } from "react";
import type { AdminControlPlaneClient, ScenarioSceneGenerationPipelineWorkOrderQueue } from "./api-client.js";
import type { CompileEdge } from "./CompileGraphCanvas.js";
import type { FacultyCompileLockClient } from "./faculty-compile-lock-types.js";

/** ActorPhenotypeSchema pointer paths a faculty compile lock may override. Review metadata only. */
export const FACULTY_COMPILE_OVERRIDE_PATHS = [
  "/garmentLayers",
  "/clothing_style",
  "/wardrobeRole",
  "/fabricPalette",
] as const;

export type FacultyCompileOverridePath = (typeof FACULTY_COMPILE_OVERRIDE_PATHS)[number];

export type FacultyCompileLockRow = {
  rowId: string;
  kind: "actor" | "equipment";
  compileSubject: string;
  locked: boolean;
  /** Optional ActorPhenotypeSchema pointer the lock applies to; only the four constant paths are allowed. */
  overridePath?: FacultyCompileOverridePath;
  /**
   * Optional ActorPhenotypeSchema VALUE the override applies (the value half of the
   * `{ op, path, value }` overridePatch). Persisted with overridePath so the faculty
   * override writes a value, not only a JSON-pointer path.
   */
  overrideValue?: unknown;
  /**
   * Evidence.v1 compile-node contentHash for the row's compile-graph node
   * (`actor:<subject>:wardrobe` / `equip:<subject>`), so a lock is reviewable
   * without reading the evidence JSON. sha256 of the artifact bytes, never a
   * placeholder literal; undefined when the evidence report carries no node
   * for the subject or the node records no artifact hash.
   */
  contentHash?: string;
  /**
   * Evidence.v1 staleness of the row's compile node (WCG dirty rule "unknown
   * edge = dirty"): true when the evidence node for this row is locked
   * (`lock.locked`) but records no current artifact hash — contentHash null
   * (artifact not on disk / never baked) or a lock whose lockedContentHash
   * differs from the node's current contentHash (artifact re-baked after the
   * lock). False when the node is unlocked, absent, or records a matching
   * current hash. Review metadata only.
   */
  stale: boolean;
  /** LLM/case transfer proposal for this node (W13). Lock table stays SSOT for lock/override. */
  llmProposed?: string;
  /** Faculty-accepted value for this node (locked override, bind, or "proposed"). */
  facultyAccepted?: string;
  /** Scenario version the faculty lock reviewed. Optional; omitted on queue-derived rows. */
  reviewedVersion?: number;
  /**
   * Authored scenario content identity the lock reviewed. Distinct from compile-node
   * contentHash (artifact bytes). Optional; omitted on queue-derived rows.
   */
  authoredContentIdentity?: string;
};

/**
 * Structural slice of an evidence.v1 compile node the lock table reads
 * (`openclinxr.encounter-materialization-evidence.v1` compileNodes). The
 * ui-admin client has no full evidence DTO yet, so only the fields the lock
 * review surface consumes are declared.
 */
export type EvidenceCompileNode = {
  nodeId: string;
  contentHash: string | null;
  lock?: {
    locked?: boolean;
    lockedContentHash?: string | null;
  };
};

/**
 * Resolve the evidence.v1 compile node for a lock row and stamp its review
 * metadata: contentHash (the compiled artifact hash the lock applies to) and
 * stale (WCG dirty rule — a lock whose node records no current artifact hash
 * is stale). Actor rows read the split wardrobe node the lock applies to
 * (`actor:<subject>:wardrobe`), falling back to the unsplit Phase 0 node;
 * equipment rows read `equip:<subject>`.
 */
export function resolveFacultyCompileLockEvidence(
  row: FacultyCompileLockRow,
  evidenceCompileNodes: readonly EvidenceCompileNode[] | undefined,
): { contentHash?: string; stale: boolean } {
  if (!evidenceCompileNodes) {
    return { stale: false };
  }
  const nodeIdCandidates =
    row.kind === "actor"
      ? [`actor:${row.compileSubject}:wardrobe`, `actor:${row.compileSubject}`]
      : [`equip:${row.compileSubject}`];
  const node = evidenceCompileNodes.find((candidate) => nodeIdCandidates.includes(candidate.nodeId));
  const contentHash = node?.contentHash ?? undefined;
  const locked = node?.lock?.locked === true;
  const lockHashMoved =
    node?.lock?.lockedContentHash != null && node.lock.lockedContentHash !== node.contentHash;
  const stale = locked && (contentHash === undefined || lockHashMoved);
  return { ...(contentHash === undefined ? {} : { contentHash }), stale };
}

/**
 * Faculty compile/materialization lock rows derived from scene pipeline actor and equipment ids.
 * Review metadata only: locked stays false until the faculty compile-lock store is written.
 * When evidence.v1 compile nodes are supplied, each row also carries the compiled
 * artifact contentHash and staleness for its compile-graph node.
 */
export function buildFacultyCompileLockRows(
  sceneGenerationPipelineQueue: ScenarioSceneGenerationPipelineWorkOrderQueue,
  evidenceCompileNodes?: readonly EvidenceCompileNode[],
): FacultyCompileLockRow[] {
  const rows: FacultyCompileLockRow[] = [];
  const seenRowIds = new Set<string>();
  const appendRow = (row: FacultyCompileLockRow): void => {
    if (seenRowIds.has(row.rowId)) {
      return;
    }
    seenRowIds.add(row.rowId);
    rows.push(row);
  };
  for (const workOrder of sceneGenerationPipelineQueue.workOrders) {
    const actorSubjects = workOrder.actorWorkOrders.length > 0
      ? workOrder.actorWorkOrders.map((actorWorkOrder) => actorWorkOrder.actorId)
      : workOrder.characterAssetIds;
    for (const actorSubject of actorSubjects) {
      const baseRow: FacultyCompileLockRow = { rowId: `lock:actor:${actorSubject}`, kind: "actor", compileSubject: actorSubject, locked: false, stale: false };
      appendRow({ ...baseRow, ...resolveFacultyCompileLockEvidence(baseRow, evidenceCompileNodes) });
    }
    for (const equipmentAssetId of workOrder.equipmentAssetIds) {
      const baseRow: FacultyCompileLockRow = { rowId: `lock:equipment:${equipmentAssetId}`, kind: "equipment", compileSubject: equipmentAssetId, locked: false, stale: false };
      appendRow({ ...baseRow, ...resolveFacultyCompileLockEvidence(baseRow, evidenceCompileNodes) });
    }
  }
  return rows;
}

/**
 * True when the previous lock reviewed a different artifact hash, authored
 * scenario identity, or scenario version than the freshly derived row.
 */
export function facultyCompileLockIdentityMoved(
  previous: FacultyCompileLockRow,
  next: FacultyCompileLockRow,
): boolean {
  if (previous.contentHash !== undefined && previous.contentHash !== next.contentHash) {
    return true;
  }
  if (
    previous.authoredContentIdentity !== undefined &&
    previous.authoredContentIdentity !== next.authoredContentIdentity
  ) {
    return true;
  }
  if (previous.reviewedVersion !== undefined && previous.reviewedVersion !== next.reviewedVersion) {
    return true;
  }
  return false;
}

/**
 * Merges faculty compile lock rows by queue identity (rowId): locked flags and
 * override paths/values from `previousRows` survive onto the freshly derived rows.
 * A lock whose reviewed identity moved is marked stale so compile/learner-use
 * cannot inherit the prior lock. Review metadata only.
 */
export function mergeFacultyCompileLockRows(
  nextRows: FacultyCompileLockRow[],
  previousRows: FacultyCompileLockRow[],
): FacultyCompileLockRow[] {
  const previousById = new Map(previousRows.map((row) => [row.rowId, row]));
  return nextRows.map((row) => {
    const previous = previousById.get(row.rowId);
    if (!previous) {
      return row;
    }
    const locked = previous.locked;
    const identityMoved = facultyCompileLockIdentityMoved(previous, row);
    return {
      ...row,
      locked,
      stale: row.stale || (locked && identityMoved),
      ...(previous.overridePath === undefined ? {} : { overridePath: previous.overridePath }),
      ...(previous.overrideValue === undefined ? {} : { overrideValue: previous.overrideValue }),
    };
  });
}

/** Compile/learner-use is refused while any lock row is stale. Not a production readiness claim. */
export function facultyCompileLockAllowsCompile(rows: readonly FacultyCompileLockRow[]): boolean {
  return rows.every((row) => !row.stale);
}

/**
 * Resolve a faculty compile lock row to the compile-graph nodeId and its owning
 * scenario (the workOrder that derived the row). Actor rows lock the split
 * wardrobe baker (`actor:<subject>:wardrobe`) so the World Compile Graph runner
 * skips the bake at baker granularity. Returns undefined when the queue is not
 * loaded yet or the subject is not on any workOrder.
 */
export function findFacultyCompileLockContext(
  sceneGenerationPipelineQueue: ScenarioSceneGenerationPipelineWorkOrderQueue | undefined,
  compileSubject: string,
  kind: FacultyCompileLockRow["kind"],
): { scenarioId: string; nodeId: string } | undefined {
  if (!sceneGenerationPipelineQueue) {
    return undefined;
  }
  const nodeId = kind === "actor" ? `actor:${compileSubject}:wardrobe` : `equip:${compileSubject}`;
  for (const workOrder of sceneGenerationPipelineQueue.workOrders) {
    if (kind === "actor") {
      const actorIds = workOrder.actorWorkOrders.length > 0
        ? workOrder.actorWorkOrders.map((actorWorkOrder) => actorWorkOrder.actorId)
        : workOrder.characterAssetIds;
      if (actorIds.includes(compileSubject)) {
        return { scenarioId: workOrder.scenarioId, nodeId };
      }
    } else if (workOrder.equipmentAssetIds.includes(compileSubject)) {
      return { scenarioId: workOrder.scenarioId, nodeId };
    }
  }
  return undefined;
}

/**
 * Stored World Compile Graph edges from evidence.v1 — the `compileEdges` field
 * a compile run stamps on `openclinxr.encounter-materialization-evidence.v1`
 * reports. Same {from,to,kind} shape as CompileEdge; node ids are the same
 * compile-graph node ids the lock table locks (`actor:<subject>:body|:wardrobe`,
 * `equip:<id>`).
 */
export type EvidenceCompileEdges = ReadonlyArray<{ from: string; to: string; kind: string }>;

/**
 * Compile/materialization dependency edges for the read-only graph canvas.
 * Prefers the STORED evidence.v1 compileEdges when a compiled evidence report
 * is supplied (`compileEdgesFromEvidence !== undefined` — a compile that ran
 * is authoritative, even when it recorded no edges). Falls back to deriving
 * edges from the same scene pipeline actor-equipment pairs as the faculty
 * compile lock rows: each actor subject contributes a body -> wardrobe bake
 * edge plus one wardrobe -> equipment edge per equipment asset on the actor's
 * work order. Node ids mirror the compile-graph node ids the lock table locks
 * (`actor:<subject>:wardrobe`, `equip:<id>`). Keeps the read-only graph canvas
 * non-empty whenever the lock table is non-empty; metadata only, no lock state
 * is implied.
 */
export function buildCompileEdges(
  sceneGenerationPipelineQueue: ScenarioSceneGenerationPipelineWorkOrderQueue,
  compileEdgesFromEvidence?: EvidenceCompileEdges,
): CompileEdge[] {
  if (compileEdgesFromEvidence !== undefined) {
    return compileEdgesFromEvidence.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind }));
  }
  const edges: CompileEdge[] = [];
  const seenEdgeKeys = new Set<string>();
  for (const workOrder of sceneGenerationPipelineQueue.workOrders) {
    const actorSubjects = workOrder.actorWorkOrders.length > 0
      ? workOrder.actorWorkOrders.map((actorWorkOrder) => actorWorkOrder.actorId)
      : workOrder.characterAssetIds;
    for (const actorSubject of actorSubjects) {
      const wardrobeNodeId = `actor:${actorSubject}:wardrobe`;
      const bodyEdgeKey = `actor:${actorSubject}:body\u0000${wardrobeNodeId}`;
      if (!seenEdgeKeys.has(bodyEdgeKey)) {
        seenEdgeKeys.add(bodyEdgeKey);
        edges.push({ from: `actor:${actorSubject}:body`, to: wardrobeNodeId, kind: "body_to_clothing" });
      }
      for (const equipmentAssetId of workOrder.equipmentAssetIds) {
        const equipmentNodeId = `equip:${equipmentAssetId}`;
        const edgeKey = `${wardrobeNodeId}\u0000${equipmentNodeId}`;
        if (seenEdgeKeys.has(edgeKey)) {
          continue;
        }
        seenEdgeKeys.add(edgeKey);
        edges.push({ from: wardrobeNodeId, to: equipmentNodeId, kind: "wardrobe_to_equipment" });
      }
    }
  }
  return edges;
}

/**
 * Parent-owned faculty compile lock rows: seeded from the scene pipeline queue and
 * merged on queue identity so toggled locks survive re-renders, persisted to the
 * compile-lock store on each toggle (the World Compile Graph compile runner reads
 * .openclinxr/compile-locks/<scenarioId>.json). Evidence.v1 compile nodes stamp
 * contentHash/staleness onto each row when supplied. Review metadata only.
 */
export function useFacultyCompileLocks(
  sceneGenerationPipelineQueue: ScenarioSceneGenerationPipelineWorkOrderQueue | undefined,
  controlPlaneClient: AdminControlPlaneClient,
  compileEdgesFromEvidence?: EvidenceCompileEdges,
  evidenceCompileNodes?: readonly EvidenceCompileNode[],
): {
  facultyCompileLockRows: FacultyCompileLockRow[];
  handleFacultyCompileLockChange: (rowId: string, locked: boolean) => void;
  handleFacultyCompileOverrideChange: (rowId: string, overridePath: FacultyCompileOverridePath | undefined) => void;
  handleFacultyCompileOverrideValueChange: (rowId: string, overrideValue: unknown) => void;
  compileEdges: CompileEdge[];
} {
  const [facultyCompileLockRows, setFacultyCompileLockRows] = useState<FacultyCompileLockRow[]>([]);
  useEffect(() => {
    if (!sceneGenerationPipelineQueue) {
      return;
    }
    setFacultyCompileLockRows((currentRows) =>
      mergeFacultyCompileLockRows(buildFacultyCompileLockRows(sceneGenerationPipelineQueue, evidenceCompileNodes), currentRows),
    );
  }, [sceneGenerationPipelineQueue, evidenceCompileNodes]);

  // Persist each faculty lock/override toggle to the compile-lock store (the World
  // Compile Graph compile runner reads .openclinxr/compile-locks/<scenarioId>.json).
  const persistCompileLock = (row: FacultyCompileLockRow, patch: { locked: boolean; overridePath: FacultyCompileOverridePath | undefined; overrideValue: unknown }): void => {
    const context = findFacultyCompileLockContext(sceneGenerationPipelineQueue, row.compileSubject, row.kind);
    if (!context) {
      return;
    }
    // The concrete client returned by createAdminControlPlaneClient always carries
    // the compile-lock methods; the base AdminControlPlaneClient type does not
    // (api-client-types.ts is frozen at its ceiling, so the slice lives in
    // faculty-compile-lock-types.ts as FacultyCompileLockClient).
    void (controlPlaneClient as AdminControlPlaneClient & FacultyCompileLockClient)
      .persistFacultyCompileLock({
        scenarioId: context.scenarioId,
        nodeId: context.nodeId,
        locked: patch.locked,
        ...(patch.overridePath === undefined ? {} : { overridePath: patch.overridePath }),
        ...(patch.overrideValue === undefined ? {} : { overrideValue: patch.overrideValue }),
      })
      .catch(() => undefined);
  };
  const handleFacultyCompileLockChange = (rowId: string, locked: boolean): void => {
    const row = facultyCompileLockRows.find((candidate) => candidate.rowId === rowId);
    setFacultyCompileLockRows((currentRows) =>
      currentRows.map((candidate) => {
        if (candidate.rowId !== rowId) {
          return candidate;
        }
        if (!locked) {
          return { ...candidate, locked: false };
        }
        return {
          ...candidate,
          locked: true,
          stale: candidate.contentHash === undefined ? candidate.stale : false,
        };
      }),
    );
    if (row) {
      persistCompileLock(row, { locked, overridePath: row.overridePath, overrideValue: row.overrideValue });
    }
  };
  const handleFacultyCompileOverrideChange = (rowId: string, overridePath: FacultyCompileOverridePath | undefined): void => {
    const row = facultyCompileLockRows.find((candidate) => candidate.rowId === rowId);
    setFacultyCompileLockRows((currentRows) =>
      currentRows.map((candidate) => {
        if (candidate.rowId !== rowId) {
          return candidate;
        }
        if (overridePath === undefined) {
          const { overridePath: _clearedPath, overrideValue: _clearedValue, ...rest } = candidate;
          return rest;
        }
        return { ...candidate, overridePath };
      }),
    );
    if (row) {
      persistCompileLock(row, {
        locked: row.locked,
        overridePath,
        overrideValue: overridePath === undefined ? undefined : row.overrideValue,
      });
    }
  };
  const handleFacultyCompileOverrideValueChange = (rowId: string, overrideValue: unknown): void => {
    const row = facultyCompileLockRows.find((candidate) => candidate.rowId === rowId);
    setFacultyCompileLockRows((currentRows) =>
      currentRows.map((candidate) => {
        if (candidate.rowId !== rowId) {
          return candidate;
        }
        if (overrideValue === undefined) {
          const { overrideValue: _clearedValue, ...rest } = candidate;
          return rest;
        }
        return { ...candidate, overrideValue };
      }),
    );
    if (row) {
      persistCompileLock(row, { locked: row.locked, overridePath: row.overridePath, overrideValue });
    }
  };
  const compileEdges = sceneGenerationPipelineQueue
    ? buildCompileEdges(sceneGenerationPipelineQueue, compileEdgesFromEvidence)
    : [];
  return { facultyCompileLockRows, handleFacultyCompileLockChange, handleFacultyCompileOverrideChange, handleFacultyCompileOverrideValueChange, compileEdges };
}

export function ProposedVsAcceptedList({ rows }: { rows: readonly FacultyCompileLockRow[] }): ReactElement {
  return (
    <ul aria-label="proposedVsAccepted">
      {rows.map((row) => (
        <li key={row.rowId}>
          {`${row.compileSubject}: llmProposed ${row.llmProposed ?? row.compileSubject} vs facultyAccepted ${row.facultyAccepted ?? (row.locked ? "accepted" : "proposed")}`}
        </li>
      ))}
    </ul>
  );
}

/** antd Table columns for the faculty compile/materialization lock table. */
export function buildFacultyCompileLockColumns({
  onFacultyCompileLockChange,
  onFacultyCompileOverrideChange,
  onFacultyCompileOverrideValueChange,
}: {
  onFacultyCompileLockChange?: ((rowId: string, locked: boolean) => void) | undefined;
  onFacultyCompileOverrideChange?: ((rowId: string, overridePath: FacultyCompileOverridePath | undefined) => void) | undefined;
  onFacultyCompileOverrideValueChange?: ((rowId: string, overrideValue: unknown) => void) | undefined;
}): TableColumnsType<FacultyCompileLockRow> {
  return [
    {
      title: "Kind",
      dataIndex: "kind",
      key: "kind",
      render: (kind: FacultyCompileLockRow["kind"]) => <Tag color={kind === "actor" ? "cyan" : "purple"}>{kind}</Tag>,
    },
    { title: "Compile/materialization subject", dataIndex: "compileSubject", key: "compileSubject" },
    {
      title: "llmProposed",
      dataIndex: "llmProposed",
      key: "llmProposed",
      render: (llmProposed: string | undefined, row: FacultyCompileLockRow) => (
        <Typography.Text>{llmProposed ?? row.compileSubject}</Typography.Text>
      ),
    },
    {
      title: "facultyAccepted",
      dataIndex: "facultyAccepted",
      key: "facultyAccepted",
      render: (facultyAccepted: string | undefined, row: FacultyCompileLockRow) => (
        <Typography.Text>{facultyAccepted ?? (row.locked ? "accepted" : "proposed")}</Typography.Text>
      ),
    },
    {
      title: "Stale",
      dataIndex: "stale",
      key: "stale",
      render: (stale: boolean) =>
        stale ? <Tag color="red">stale</Tag> : <Typography.Text type="secondary">current</Typography.Text>,
    },
    {
      title: "Content hash",
      dataIndex: "contentHash",
      key: "contentHash",
      render: (contentHash: string | undefined) =>
        contentHash === undefined ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text code>{contentHash}</Typography.Text>
        ),
    },
    {
      title: "Lock",
      dataIndex: "locked",
      key: "locked",
      render: (locked: boolean, row: FacultyCompileLockRow) => (
        <Switch
          checked={locked}
          disabled={!onFacultyCompileLockChange}
          aria-label={`Lock ${row.compileSubject}`}
          onChange={(checked) => onFacultyCompileLockChange?.(row.rowId, checked)}
        />
      ),
    },
    {
      title: "Override",
      dataIndex: "overridePath",
      key: "overridePath",
      render: (overridePath: FacultyCompileOverridePath | undefined, row: FacultyCompileLockRow) => (
        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <Select<FacultyCompileOverridePath>
            aria-label={`Override path for ${row.compileSubject}`}
            placeholder="No override"
            allowClear
            showSearch={false}
            virtual={false}
            disabled={!onFacultyCompileOverrideChange}
            options={FACULTY_COMPILE_OVERRIDE_PATHS.map((path) => ({ value: path, label: path }))}
            value={overridePath ?? null}
            onChange={(value) => onFacultyCompileOverrideChange?.(row.rowId, value)}
          />
          {overridePath !== undefined ? (
            onFacultyCompileOverrideValueChange ? (
              <Input
                aria-label={`Override value for ${row.compileSubject}`}
                placeholder="Phenotype value"
                allowClear
                value={row.overrideValue === undefined ? "" : String(row.overrideValue)}
                onChange={(event) =>
                  onFacultyCompileOverrideValueChange(
                    row.rowId,
                    event.currentTarget.value === "" ? undefined : event.currentTarget.value,
                  )
                }
              />
            ) : row.overrideValue === undefined ? null : (
              <Typography.Text type="secondary">{String(row.overrideValue)}</Typography.Text>
            )
          ) : null}
        </Space>
      ),
    },
  ];
}
