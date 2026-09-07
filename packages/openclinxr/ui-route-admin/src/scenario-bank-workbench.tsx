import { createContext, useContext, type ReactElement, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, Space, Spin, Tag, Typography } from "antd";
import type { AdminControlPlaneClient, AdminScenario, AdminScenarioBankMaturityReport, AdminScenarioBankExamSequenceProjection, AdminDynamicEncounterFactoryPlanningProjection } from "./admin-review-types.js";
import { countActorCommunicationProfiles, formatActorCommunicationProfileCoverage, formatScenarioGovernanceNotice, uniqueValues } from "./formatters.js";
import { scenarioReviewGateEntries, scenarioStatusColor, reviewGateColor } from "./scenario-bank-maturity-panel.js";
import { ScenarioBankMaturityPanel } from "./scenario-bank-maturity-panel.js";
import { ReadinessMetric } from "./status-view-model.js";

export type ScenarioBankWorkbenchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
    status: "ready";
    scenarios: AdminScenario[];
    scenarioBankMaturity: AdminScenarioBankMaturityReport;
    scenarioBankExamSequence: AdminScenarioBankExamSequenceProjection;
    dynamicEncounterFactoryPlanning: AdminDynamicEncounterFactoryPlanningProjection;
  };

export interface ScenarioBankWorkbenchContextState {
  state: ScenarioBankWorkbenchState;
}

/** This workbench is read-only; the actions slot is intentionally empty. */
export type ScenarioBankWorkbenchContextActions = Record<string, never>

export interface ScenarioBankWorkbenchContextMeta {
  controlPlaneClient: AdminControlPlaneClient;
}

export type ScenarioBankWorkbenchContextValue = {
  state: ScenarioBankWorkbenchContextState;
  actions: ScenarioBankWorkbenchContextActions;
  meta: ScenarioBankWorkbenchContextMeta;
};

function createInitialState(): ScenarioBankWorkbenchState {
  return { status: "loading" };
}

const ScenarioBankWorkbenchContext = createContext<ScenarioBankWorkbenchContextValue | null>(null);

export function useScenarioBankWorkbenchContext(): ScenarioBankWorkbenchContextValue {
  const context = useContext(ScenarioBankWorkbenchContext);
  if (!context) {
    throw new Error("useScenarioBankWorkbenchContext must be used within a ScenarioBankWorkbenchProvider");
  }
  return context;
}

export function ScenarioBankWorkbenchProvider({
  children,
  controlPlaneClient,
}: {
  children: React.ReactNode;
  controlPlaneClient: AdminControlPlaneClient;
}): ReactElement {
  const [state, setState] = useState<ScenarioBankWorkbenchState>(createInitialState());

  useEffect(() => {
    let active = true;

    Promise.all([
      controlPlaneClient.listScenarios(),
      controlPlaneClient.getScenarioBankMaturity(),
      controlPlaneClient.getScenarioBankExamSequence(),
      controlPlaneClient.getDynamicEncounterFactoryPlanning(),
    ])
      .then(([scenarios, scenarioBankMaturity, scenarioBankExamSequence, dynamicEncounterFactoryPlanning]) => {
        if (active) {
          setState({ status: "ready", scenarios, scenarioBankMaturity, scenarioBankExamSequence, dynamicEncounterFactoryPlanning });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Unknown ScenarioBank error" });
        }
      });

    return () => {
      active = false;
    };
  }, [controlPlaneClient]);

  const contextValue: ScenarioBankWorkbenchContextValue = {
    state: { state },
    actions: {},
    meta: { controlPlaneClient },
  };

  return <ScenarioBankWorkbenchContext.Provider value={contextValue}>{children}</ScenarioBankWorkbenchContext.Provider>;
}

export function ScenarioBankWorkbenchUI(): ReactElement {
  const {
    state: { state },
  } = useScenarioBankWorkbenchContext();

  if (state.status === "loading") {
    return (
      <section className="scenario-bank-workbench" aria-labelledby="scenario-bank-title">
        <Typography.Title id="scenario-bank-title" level={3}>
          Scenario Bank
        </Typography.Title>
        <Spin />
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="scenario-bank-workbench" aria-labelledby="scenario-bank-title">
        <Typography.Title id="scenario-bank-title" level={3}>
          Scenario Bank
        </Typography.Title>
        <Alert type="error" title="Scenario bank unavailable" description={state.message} showIcon />
      </section>
    );
  }

  const approvedCount = state.scenarios.filter((scenario) => scenario.status === "APPROVED").length;
  const draftCount = state.scenarios.filter((scenario) => scenario.status === "DRAFT").length;
  const readyForReviewCount = state.scenarios.filter((scenario) => scenario.status === "READY_FOR_REVIEW").length;
  const actorCount = state.scenarios.reduce((total, scenario) => total + scenario.actors.length, 0);
  const behaviorProfileCount = state.scenarios.reduce((total, scenario) => total + countActorCommunicationProfiles(scenario.actors), 0);

  return (
    <section className="scenario-bank-workbench" aria-label="Scenario bank governance">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Generated ScenarioBank</Typography.Text>
          <Typography.Title id="scenario-bank-title" level={3}>
            Scenario Bank
          </Typography.Title>
        </div>
        <Space wrap>
          <Tag color="green">{`${approvedCount} approved`}</Tag>
          <Tag color="gold">{`${draftCount} draft`}</Tag>
          <Tag color="blue">{`${readyForReviewCount} ready for review`}</Tag>
        </Space>
      </div>

      <div className="readiness-strip scenario-bank-strip">
        <ReadinessMetric label={`${state.scenarios.length} scenarios`} detail={`${uniqueValues(state.scenarios.flatMap((scenario) => scenario.governance.requiredReviewerRoles)).length} reviewer roles`} />
        <ReadinessMetric label={`${approvedCount} approved`} detail={`${draftCount + readyForReviewCount} awaiting gates`} />
        <ReadinessMetric label={`${uniqueValues(state.scenarios.flatMap((scenario) => scenario.actors.map((actor) => actor.role))).length} actor roles`} detail={`${actorCount} virtual actors`} />
        <ReadinessMetric label={`${behaviorProfileCount} behavior profiles`} detail={`${actorCount} actors, review evidence only`} />
        <ReadinessMetric label={`${state.scenarios.reduce((total, scenario) => total + scenario.assetNeeds.length, 0)} asset needs`} detail="placeholder license posture" />
      </div>

      <ScenarioBankMaturityPanel
        scenarios={state.scenarios}
        maturityReport={state.scenarioBankMaturity}
        examSequenceProjection={state.scenarioBankExamSequence}
      />

      <section className="workbench-panel" aria-label="Scenario bank dynamic encounter factory planning">
        <Typography.Title level={4}>Dynamic Encounter Factory Planning</Typography.Title>
        <Typography.Paragraph type="secondary">
          {`Boundary: ${state.dynamicEncounterFactoryPlanning.claimBoundary}; next scenario: ${state.dynamicEncounterFactoryPlanning.nextFactoryPlanningScenarioId ?? "none"} via ${state.dynamicEncounterFactoryPlanning.nextFactoryPlanningScenarioSelectionMode}.`}
        </Typography.Paragraph>
        <fieldset className="readiness-strip" aria-label="Scenario bank dynamic encounter factory planning metrics">
          <ReadinessMetric
            label={`${state.dynamicEncounterFactoryPlanning.scenarios.length} factory candidates`}
            detail={`anchor ${state.dynamicEncounterFactoryPlanning.anchorScenarioId}`}
          />
          <ReadinessMetric
            label={state.dynamicEncounterFactoryPlanning.routeContractBoundary?.posture ?? "read_only_review_packet"}
            detail={`provider ${String(state.dynamicEncounterFactoryPlanning.routeContractBoundary?.providerExecutionAllowed ?? false)}; runtime ${String(state.dynamicEncounterFactoryPlanning.routeContractBoundary?.runtimeExecutionAllowed ?? false)}; learner ${String(state.dynamicEncounterFactoryPlanning.routeContractBoundary?.learnerLaunchAllowed ?? false)}; Quest ${String(state.dynamicEncounterFactoryPlanning.routeContractBoundary?.questEvidenceRefreshAllowed ?? false)}`}
          />
        </fieldset>
        <ul className="compact-list" aria-label="Scenario bank dynamic encounter factory candidate summaries">
          {state.dynamicEncounterFactoryPlanning.scenarios.slice(0, 3).map((scenario) => (
            <li key={scenario.scenarioId}>
              <Typography.Text>{scenario.scenarioId}</Typography.Text>
              <Typography.Text type="secondary">
                {`actors ${scenario.encounterFactoryInputSummary.actorAssetWorkOrderCount}; environment ${scenario.encounterFactoryInputSummary.environmentAssetWorkOrderCount}; equipment ${scenario.encounterFactoryInputSummary.equipmentAssetWorkOrderCount}; ${scenario.encounterFactoryInputSummary.factorySelectionClaimBoundary}`}
              </Typography.Text>
              {scenario.humanoidPerformanceContract ? (
                <Typography.Text type="secondary">
                  {`humanoid behavior contract actors ${scenario.humanoidPerformanceContract.actorCount}; locomotion ${scenario.humanoidPerformanceContract.locomotionActorRoles.length}; expression ${scenario.humanoidPerformanceContract.expressionActorRoles.length}; gaze ${scenario.humanoidPerformanceContract.gazeActorRoles.length}; lip-sync ${scenario.humanoidPerformanceContract.lipSyncActorRoles.length}; interactivity ${scenario.humanoidPerformanceContract.interactiveActorRoles.length}; emotion states ${scenario.humanoidPerformanceContract.emotionStateCount}; viseme mapping ${String(scenario.humanoidPerformanceContract.dialogueDrivenVisemeMappingRequired)}; ${scenario.humanoidPerformanceContract.claimBoundary}; not evidence for ${scenario.humanoidPerformanceContract.notEvidenceFor.join(", ")}`}
                </Typography.Text>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="scenario-list">
        {state.scenarios.map((scenario) => (
          <article className="scenario-row" key={`${scenario.scenarioId}:${scenario.version}`}>
            <div className="scenario-row-main">
              <div>
                <Typography.Title level={4}>{scenario.title}</Typography.Title>
                <Typography.Text type="secondary">{`${scenario.scenarioId} v${scenario.version}`}</Typography.Text>
              </div>
              <Space wrap>
                <Tag color={scenarioStatusColor(scenario.status)}>{scenario.status.toLowerCase().replaceAll("_", " ")}</Tag>
                <Link to={`/scenarios/${scenario.scenarioId}?version=${scenario.version}`}>Open detail</Link>
              </Space>
            </div>

            <div className="scenario-row-grid">
              <section aria-label={`${scenario.title} review gates`}>
                <Typography.Text strong>Review gates</Typography.Text>
                <div className="tag-row">
                  {scenarioReviewGateEntries(scenario).map(([gate, stateName]) => (
                    <Tag key={gate} color={reviewGateColor(stateName)}>{`${gate}: ${stateName}`}</Tag>
                  ))}
                </div>
              </section>

              <section aria-label={`${scenario.title} actors`}>
                <Typography.Text strong>Actors</Typography.Text>
                <Typography.Paragraph type="secondary">
                  {formatActorCommunicationProfileCoverage(scenario.actors)}
                </Typography.Paragraph>
                <ol className="compact-list">
                  {scenario.actors.map((actor) => (
                    <li key={actor.actorId}>
                      <Typography.Text>{actor.displayName}</Typography.Text>
                      <Typography.Text type="secondary">{actor.role}</Typography.Text>
                    </li>
                  ))}
                </ol>
              </section>

              <section aria-label={`${scenario.title} governance`}>
                <Typography.Text strong>Governance</Typography.Text>
                <div className="tag-row">
                  {scenario.governance.requiredReviewerRoles.map((role) => (
                    <Tag key={role}>{role}</Tag>
                  ))}
                </div>
                <Typography.Text type="secondary">{formatScenarioGovernanceNotice(scenario)}</Typography.Text>
              </section>

              <section aria-label={`${scenario.title} trace tags and assets`}>
                <Typography.Text strong>{`${scenario.requiredTraceTags.length} trace tags`}</Typography.Text>
                <Typography.Text type="secondary">{`${scenario.assetNeeds.length} asset needs`}</Typography.Text>
              </section>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}