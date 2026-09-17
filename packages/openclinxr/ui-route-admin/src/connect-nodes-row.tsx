import type { CompileEdge } from "@openclinxr/ui-shared/admin-compile-graph-canvas";
import { Button, Select, Tag, Typography } from "antd";
import { type ReactElement, useMemo, useState } from "react";

/**
 * WCG typed-port "connect nodes" row: extracted from environment-generation-queue-panel.tsx
 * rather than left inline. Adding it took that file to 650 lines against a frozen ceiling of
 * 575, and file-size-budgets.ts says "freeze ceilings may only shrink — split the file; do NOT
 * raise the ceiling" (same reasoning `placement-authoring-row.tsx` was split out for).
 *
 * A user picks two existing compile-graph node ids and asks for a connection. The parent
 * (SeedWorldviewQueue, via `onConnectNodes`) runs the candidate through
 * `resolveCompileEdgeConnection` (compile-edge-port-types.ts) and REFUSES it when the picked
 * pair's output port type does not match a closed compile-edge kind's required input port type;
 * an accepted connection is appended to the compile graph. This is the drivable connect-two-nodes
 * surface the operator asked for — `compileEdges` stays the source of truth for what is actually
 * connected.
 */
export function ConnectNodesRow({
  compileEdges,
  onConnectNodes,
  connectionAttempt,
}: {
  compileEdges: readonly CompileEdge[];
  onConnectNodes?: (fromNodeId: string, toNodeId: string) => void;
  connectionAttempt?: { ok: true; edge: CompileEdge } | { ok: false; from: string; to: string; reason: string };
}): ReactElement | null {
  const [connectFromNodeId, setConnectFromNodeId] = useState<string | undefined>(undefined);
  const [connectToNodeId, setConnectToNodeId] = useState<string | undefined>(undefined);
  const compileGraphNodeIdOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of compileEdges) {
      ids.add(edge.from);
      ids.add(edge.to);
    }
    return [...ids].sort((left, right) => left.localeCompare(right)).map((id) => ({ label: id, value: id }));
  }, [compileEdges]);

  if (!onConnectNodes) {
    return null;
  }

  return (
    <fieldset className="station-queue-row" aria-label="Connect compile graph nodes">
      <Select
        allowClear
        showSearch
        virtual={false}
        aria-label="Connect from node"
        placeholder="Connect from node"
        style={{ minWidth: 220 }}
        options={compileGraphNodeIdOptions}
        value={connectFromNodeId}
        onChange={(value) => setConnectFromNodeId(typeof value === "string" ? value : undefined)}
      />
      <Select
        allowClear
        showSearch
        virtual={false}
        aria-label="Connect to node"
        placeholder="Connect to node"
        style={{ minWidth: 220 }}
        options={compileGraphNodeIdOptions}
        value={connectToNodeId}
        onChange={(value) => setConnectToNodeId(typeof value === "string" ? value : undefined)}
      />
      <Button
        size="small"
        aria-label="Connect nodes"
        disabled={connectFromNodeId === undefined || connectToNodeId === undefined}
        onClick={() => {
          if (connectFromNodeId !== undefined && connectToNodeId !== undefined) {
            onConnectNodes(connectFromNodeId, connectToNodeId);
          }
        }}
      >
        Connect nodes
      </Button>
      {connectionAttempt ? (
        <Tag aria-label="Connection attempt result" color={connectionAttempt.ok ? "blue" : "red"}>
          {connectionAttempt.ok
            ? `accepted: ${connectionAttempt.edge.from} -> ${connectionAttempt.edge.to} (${connectionAttempt.edge.kind})`
            : `refused: ${connectionAttempt.reason}`}
        </Tag>
      ) : null}
      <Typography.Paragraph type="secondary">
        Typed-port gate: a connection is refused unless the picked pair's output port type matches
        a closed compile-edge kind's required input port type (e.g. a body output may only connect
        to a wardrobe input); a matching pair is added to the compile graph above.
      </Typography.Paragraph>
    </fieldset>
  );
}
