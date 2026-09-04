import type { Scenario } from "@openclinxr/shared-schemas";
import { Space, Typography } from "antd";
import { type ReactElement, useMemo } from "react";
import { CaseAuthoringWorkbench } from "./CaseAuthoringWorkbench.js";
import {
  DialogueSeedAuthoringPanel,
  type AuthoredDialogueSeedDraft,
  type DialogueSeedActor,
} from "./DialogueSeedAuthoringPanel.js";

export type ScenarioAuthoringWorkspaceProps = {
  initialScenario?: Scenario;
  initialSeeds?: readonly AuthoredDialogueSeedDraft[];
  claimLiveProvider?: boolean;
  providerId?: string;
};

export function ScenarioAuthoringWorkspace({
  initialScenario,
  initialSeeds = [],
  claimLiveProvider = false,
  providerId,
}: ScenarioAuthoringWorkspaceProps): ReactElement {
  const actors = useMemo(() => actorsFromScenario(initialScenario), [initialScenario]);
  const disclosurePolicy = initialScenario?.governance.hiddenFactPolicy;

  return (
    <section aria-label="Scenario authoring workspace">
      <Typography.Title level={2}>Scenario authoring workspace</Typography.Title>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {initialScenario
          ? <CaseAuthoringWorkbench initialScenario={initialScenario} />
          : <CaseAuthoringWorkbench />}
        <DialogueSeedAuthoringPanel
          scenarioId={initialScenario?.scenarioId ?? "untitled_scenario"}
          scenarioVersion={initialScenario?.version ?? 1}
          actors={actors}
          {...(disclosurePolicy ? { disclosurePolicy } : {})}
          initialSeeds={initialSeeds}
          claimLiveProvider={claimLiveProvider}
          {...(providerId !== undefined ? { providerId } : {})}
        />
      </Space>
    </section>
  );
}

export function actorsFromScenario(scenario: Scenario | undefined): DialogueSeedActor[] {
  if (!scenario) {
    return [];
  }
  return scenario.actors.map((actor) => {
    const mapped: DialogueSeedActor = {
      actorId: actor.actorId,
      displayName: actor.displayName,
      role: actor.role,
    };
    if (typeof actor.phenotype?.age === "number") {
      mapped.age = actor.phenotype.age;
    }
    if (typeof actor.communicationProfile?.intensity === "number") {
      mapped.communicationIntensity = actor.communicationProfile.intensity;
    }
    if (actor.hiddenFacts) {
      mapped.hiddenFacts = actor.hiddenFacts;
    }
    return mapped;
  });
}
