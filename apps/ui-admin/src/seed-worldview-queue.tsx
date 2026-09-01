import { type ReactElement } from "react";
import {
  EnvironmentGenerationQueuePanel,
  type EnvironmentGenerationQueuePanelProps,
} from "./EnvironmentGenerationQueuePanel.js";
import {
  mergeWorldviewCompileEdges,
  mergeWorldviewLockRows,
  useWorldviewCompileGraph,
} from "./worldview-compile-graph.js";

export type SeedWorldviewCompileGraph = {
  compileNodes: unknown[];
  facultyLocks: EnvironmentGenerationQueuePanelProps["facultyCompileLockRows"];
};

export type SeedWorldviewQueueProps = Omit<
  EnvironmentGenerationQueuePanelProps,
  "onAddActor" | "onBindEquipmentFixtureSlot" | "onAddTrellisModel" | "onCompileEncounter"
> & {
  onCompileEncounter?: (scenarioId: string, graph: SeedWorldviewCompileGraph) => void;
};

/**
 * Seed exam worldview queue: owns add-actor / fixture-slot / canvas node
 * mutations and merges them into the lock table + compile graph the panel
 * already renders. SeedBlueprintWorkbench mounts this, not the raw panel.
 */
export function SeedWorldviewQueue({
  onCompileEncounter,
  compileEdges = [],
  facultyCompileLockRows = [],
  ...panelProps
}: SeedWorldviewQueueProps): ReactElement {
  const worldview = useWorldviewCompileGraph();
  const mergedEdges = mergeWorldviewCompileEdges(compileEdges, worldview.state);
  const mergedLocks = mergeWorldviewLockRows(facultyCompileLockRows, worldview.state);
  return (
    <EnvironmentGenerationQueuePanel
      {...panelProps}
      compileEdges={mergedEdges}
      facultyCompileLockRows={mergedLocks}
      onAddActor={worldview.onAddActor}
      onBindEquipmentFixtureSlot={worldview.onBindEquipmentFixtureSlot}
      onAddTrellisModel={worldview.onAddTrellisModel}
      onAddNode={worldview.onAddNode}
      onRemoveNode={worldview.onRemoveNode}
      {...(onCompileEncounter
        ? {
            onCompileEncounter: (scenarioId: string) =>
              onCompileEncounter(scenarioId, {
                compileNodes: [...mergedEdges, ...worldview.state.actors],
                facultyLocks: mergedLocks,
              }),
          }
        : {})}
    />
  );
}
