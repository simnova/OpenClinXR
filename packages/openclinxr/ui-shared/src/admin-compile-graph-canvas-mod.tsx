import { Background, type Edge, type Node, ReactFlow } from "@xyflow/react";
import { Button } from "antd";
import { type CSSProperties, type ReactElement, useCallback } from "react";

export type CompileEdge = {
  /** Compile/materialization subject id the dependency starts from. */
  from: string;
  /** Compile/materialization subject id the dependency points at. */
  to: string;
  /** Dependency kind (e.g. actor, equipment, environment). Metadata only. */
  kind: string;
};

export type CompileGraphCanvasProps = {
  compileEdges: CompileEdge[];
  /**
   * Canvas mutation API (W18). The lock Table remains the lock write path;
   * onNodesChange stays a no-op so xyflow itself is not a write surface.
   */
  onAddNode?: (nodeId: string) => void;
  onRemoveNode?: (nodeId: string) => void;
};

export type CompileGraphModel = {
  nodes: Node[];
  edges: Edge[];
};

/** Column x offsets for the body / wardrobe / equipment baker families. */
const COLUMN_X: [number, number, number] = [24, 460, 896];

/** Comfy-like read-only node chrome shared by every compile graph node. */
const NODE_STYLE: CSSProperties = {
  background: "#1e1e1e",
  border: "1px solid #444",
  borderRadius: 6,
  color: "#ddd",
  fontSize: 12,
  padding: 8,
  width: 200,
};

const COLUMN_BAKER_TITLES = ["Body", "Wardrobe", "Equipment"] as const;

/**
 * Deterministic three-column DAG layout: body bakes (col 0) feed wardrobe
 * bakes (col 1) which feed equipment bakes (col 2), each column sorted by
 * subject id. Node ids are the same compile-graph ids the faculty lock table
 * locks (`actor:<subject>:body|:wardrobe`, `equip:<id>`). Edge labels carry
 * the dependency kind. Pure and stable so tests can assert on it without
 * rendering React Flow.
 */
export function buildCompileGraphModel(compileEdges: CompileEdge[]): CompileGraphModel {
  const columnNodes: [Map<string, Node>, Map<string, Node>, Map<string, Node>] = [new Map(), new Map(), new Map()];
  for (const edge of compileEdges) {
    for (const subjectId of [edge.from, edge.to]) {
      const column = nodeColumn(subjectId);
      const nodesById = columnNodes[column];
      if (nodesById === undefined || nodesById.has(subjectId)) {
        continue;
      }
      nodesById.set(subjectId, {
        id: subjectId,
        position: { x: 0, y: 0 },
        data: { label: nodeLabel(subjectId) },
        style: NODE_STYLE,
      });
    }
  }

  const nodes: Node[] = [];
  for (const [column, nodesById] of columnNodes.entries()) {
    const columnX = COLUMN_X[column];
    if (columnX === undefined) {
      continue;
    }
    const sortedNodes = [...nodesById.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const [index, node] of sortedNodes.entries()) {
      nodes.push({
        ...node,
        position: { x: columnX, y: 24 + index * 84 },
      });
    }
  }

  const edges: Edge[] = compileEdges.map((edge, index) => ({
    id: `compile-edge-${index}`,
    source: edge.from,
    target: edge.to,
    label: edge.kind,
    labelStyle: { fill: "#8ab4f8", fontWeight: 600 },
  }));

  return { nodes, edges };
}

/** Baker family column for a compile-graph node id (wardrobe and equipment suffixes win). */
function nodeColumn(nodeId: string): 0 | 1 | 2 {
  if (nodeId.endsWith(":wardrobe")) {
    return 1;
  }
  if (nodeId.startsWith("equip:")) {
    return 2;
  }
  return 0;
}

/** "Baker title\nsubject" label, with the subject trimmed for compact node chrome. */
function nodeLabel(nodeId: string): string {
  const bakerTitle = COLUMN_BAKER_TITLES[nodeColumn(nodeId)] ?? "Body";
  return `${bakerTitle}\n${shortSubject(nodeId)}`;
}

function shortSubject(nodeId: string): string {
  let subject = nodeId;
  if (nodeId.startsWith("actor:") && nodeId.endsWith(":body")) {
    subject = nodeId.slice("actor:".length, -":body".length);
  } else if (nodeId.startsWith("actor:") && nodeId.endsWith(":wardrobe")) {
    subject = nodeId.slice("actor:".length, -":wardrobe".length);
  } else if (nodeId.startsWith("equip:")) {
    subject = nodeId.slice("equip:".length);
  }
  return subject.length > 12 ? `${subject.slice(0, 12)}…` : subject;
}

/**
 * Read-only @xyflow/react view of compile/materialization dependency edges.
 * No-op change handlers keep the canvas from becoming a write path; writes
 * stay on the faculty compile lock Table. This module is loaded via React.lazy
 * so @xyflow/react lands in its own lazily-loaded vendor chunk (see
 * xyflow-vendor in apps/ui-admin/vite.config.ts).
 */
export function CompileGraphCanvas({
  compileEdges,
  onAddNode,
  onRemoveNode,
}: CompileGraphCanvasProps): ReactElement {
  const { nodes, edges } = buildCompileGraphModel(compileEdges);
  const onNodesChange = useCallback(() => undefined, []);
  const onEdgesChange = useCallback(() => undefined, []);
  const selectedNodeId = nodes[0]?.id;

  return (
    <div className="compile-graph-canvas">
      <div className="compile-graph-canvas-actions">
        <Button
          size="small"
          aria-label="Add compile graph node"
          onClick={() => {
            const nodeId = `actor:worldview_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}:body`;
            onAddNode?.(nodeId);
          }}
        >
          Add node
        </Button>
        <Button
          size="small"
          aria-label="Remove compile graph node"
          disabled={selectedNodeId === undefined}
          onClick={() => {
            if (selectedNodeId !== undefined) {
              onRemoveNode?.(selectedNodeId);
            }
          }}
        >
          Remove node
        </Button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        colorMode="dark"
      >
        <Background gap={16} color="#2c2c2c" />
      </ReactFlow>
    </div>
  );
}
