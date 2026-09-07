import { Alert, Button, Card, Link, Space, Spin, Tag, Typography } from "antd";
import { type ReactElement, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import type { AdminControlPlaneClient, AdminScenarioDetail, AdminScenarioPublicationReadiness } from "./admin-review-types.js";
import {
  formatActorCommunicationProfileCoverage,
  formatDuration,
  formatScenarioGovernanceNotice,
  pluralize,
  scenarioReviewGateEntries,
  scenarioStatusColor,
  reviewGateColor,
  uniqueValues,
} from "./index.js";
import { ReadinessMetric } from "./status-view-model.js";
import { ScenarioReviewGatePanel } from "./scenario-review-gate-panel.js";

export type ScenarioDetailWorkbenchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: AdminScenarioDetail; publicationReadiness?: AdminScenarioPublicationReadiness };

export interface ScenarioDetailWorkbenchContextState {
  state: ScenarioDetailWorkbenchState;
}

export interface ScenarioDetailWorkbenchContextActions {
  setState: React.Dispatch<React.SetStateAction<ScenarioDetailWorkbenchState>>;
}

export interface ScenarioDetailWorkbenchContextMeta {
  controlPlaneClient: AdminControlPlaneClient;
}

export type ScenarioDetailWorkbenchContextValue = {
  state: ScenarioDetailWorkbenchContextState;
  actions: ScenarioDetailWorkbenchContextActions;
  meta: ScenarioDetailWorkbenchContextMeta;
};

function createInitialState(): ScenarioDetailWorkbenchState {
  return { status: "loading" };
}

import { createContext, useContext } from "react";

const ScenarioDetailWorkbenchContext = createContext<ScenarioDetailWorkbenchContextValue | null>(null);

export function useScenarioDetailWorkbenchContext(): ScenarioDetailWorkbenchContextValue {
  const context = useContext(ScenarioDetailWorkbenchContext);
  if (!context) {
    throw new Error("useScenarioDetailWorkbenchContext must be used within a ScenarioDetailWorkbenchProvider");
  }
  return context;
}

export function ScenarioDetailWorkbenchProvider({
  children,
  controlPlaneClient,
}: {
  children: React.ReactNode;
  controlPlaneClient: AdminControlPlaneClient;
}): ReactElement {
  const [state, setState] = useState<ScenarioDetailWorkbenchState>(createInitialState());

  useEffect(() => {
    let active = true;

    Promise.all([
      controlPlaneClient.getScenarioDetail({ scenarioId: "", version: 1 }), // Placeholder - will be updated by UI
      Promise.resolve(undefined),
    ])
      .then(([detail, publicationReadiness]) => {
        if (active) {
          setState(publicationReadiness ? { status: "ready", detail, publicationReadiness } : { status: "ready", detail });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Unknown ScenarioDetail error" });
        }
      });

    return () => {
      active = false;
    };
  }, [controlPlaneClient]);

  const contextValue: ScenarioDetailWorkbenchContextValue = {
    state: { state },
    actions: { setState },
    meta: { controlPlaneClient },
  };

  return <ScenarioDetailWorkbenchContext.Provider value={contextValue}>{children}</ScenarioDetailWorkbenchContext.Provider>;
}

export function ScenarioDetailWorkbenchUI(): ReactElement {
  const {
    state: { state },
    actions: { setState },
    meta: { controlPlaneClient },
  } = useScenarioDetailWorkbenchContext();
  const { scenarioId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const version = Number.parseInt(searchParams.get("version") ?? "1", 10);

  useEffect(() => {
    let active = true;

    Promise.all([
      controlPlaneClient.getScenarioDetail({ scenarioId, version: Number.isFinite(version) ? version : 1 }),
      scenarioId === "ed_chest_pain_priority_v1"
        ? controlPlaneClient.getEdChestPainPublicationReadiness({ targetUse: "local_formative", reviewerEvidence: [] }).catch(() => undefined)
        : Promise.resolve(undefined),
    ])
      .then(([detail, publicationReadiness]) => {
        if (active) {
          setState(publicationReadiness ? { status: "ready", detail, publicationReadiness } : { status: "ready", detail });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Unknown ScenarioDetail error" });
        }
      });

    return () => {
      active = false;
    };
  }, [controlPlaneClient, scenarioId, version]);

  if (state.status === "loading") {
    return (
      <section className="scenario-detail-workbench" aria-labelledby="scenario-detail-title">
        <Link to="/scenarios">Back to Scenario Bank</Link>
        <Typography.Title id="scenario-detail-title" level={3}>
          Scenario Detail
        </Typography.Title>
        <Spin />
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="scenario-detail-workbench" aria-labelledby="scenario-detail-title">
        <Link to="/scenarios">Back to Scenario Bank</Link>
        <Typography.Title id="scenario-detail-title" level={3}>
          Scenario Detail
        </Typography.Title>
        <Alert type="error" title="Scenario detail unavailable" description={state.message} showIcon />
      </section>
    );
  }

  const { scenario, assetReadiness } = state.detail;
  const publicationReadiness = state.publicationReadiness;
  const productionReadinessLadder = assetReadiness.productionReadinessLadder;
  const blockedProductionAssetCount = productionReadinessLadder.blockedAssetIds.length;
  const productionLadderBlockerCount = productionReadinessLadder.blockers.length;

  if (!scenario) {
    return (
      <section className="scenario-detail-workbench" aria-labelledby="scenario-detail-title">
        <Link to="/scenarios">Back to Scenario Bank</Link>
        <Typography.Title id="scenario-detail-title" level={3}>
          Scenario Detail
        </Typography.Title>
        <Alert type="warning" title="Scenario not found" description={`${scenarioId} v${Number.isFinite(version) ? version : 1}`} showIcon />
      </section>
    );
  }

  return (
    <section className="scenario-detail-workbench" aria-label="Scenario detail governance">
      <div className="workbench-title-row">
        <div>
          <Link to="/scenarios">Back to Scenario Bank</Link>
          <Typography.Text className="eyebrow">Generated ScenarioDetail</Typography.Text>
          <Typography.Title id="scenario-detail-title" level={3}>
            {scenario.title}
          </Typography.Title>
          <Typography.Text type="secondary">{`${scenario.scenarioId} v${scenario.version}`}</Typography.Text>
        </div>
        <Space wrap>
          <Tag color={scenarioStatusColor(scenario.status)}>{scenario.status.toLowerCase().replaceAll("_", " ")}</Tag>
          <Tag color={assetReadiness.devReady ? "green" : "red"}>Dev-ready assets</Tag>
          <Tag color={assetReadiness.productionReady ? "green" : "gold"}>
            {assetReadiness.productionReady ? "Production ready" : "Production blocked"}
          </Tag>
        </Space>
      </div>

      <Alert
        type="info"
        title="Governance posture"
        description={formatScenarioGovernanceNotice(scenario)}
        showIcon
      />

      <ScenarioReviewGatePanel
        scenario={scenario}
        submitScenarioReview={(input) => controlPlaneClient.submitScenarioReview(input)}
        listScenarioReviewDecisions={(input) => controlPlaneClient.listScenarioReviewDecisions(input)}
        onScenarioUpdated={(nextScenario) => {
          setState((currentState) =>
            currentState.status === "ready"
              ? { ...currentState, detail: { ...currentState.detail, scenario: nextScenario } }
              : currentState
          );
        }}
      />

      <div className="readiness-strip scenario-bank-strip">
        <ReadinessMetric label={`${scenario.clinicalObjectives.length} objectives`} detail={`${scenario.requiredTraceTags.length} required trace tags`} />
        <ReadinessMetric label={`${scenario.actors.length} actors`} detail={`${countActorCommunicationProfiles(scenario.actors)} behavior profiles`} />
        <ReadinessMetric label={`${scenario.assetNeeds.length} asset needs`} detail={`${assetReadiness.productionBlockedAssets.length} production blockers`} />
        <ReadinessMetric label={`${productionReadinessLadder.assetCount} release-ladder assets`} detail={`${blockedProductionAssetCount} blocked for release`} />
        <ReadinessMetric label={scenario.environment?.name ?? "Environment pending"} detail={`${scenario.equipment.length} equipment items`} />
      </div>

      <div className="scenario-detail-grid">
        <section className="workbench-panel" aria-label="Scenario environment">
          <Typography.Title level={4}>Environment</Typography.Title>
          <Typography.Text strong>{scenario.environment?.name ?? "Environment pending"}</Typography.Text>
          <Typography.Paragraph>{scenario.environment?.description ?? "No environment description supplied."}</Typography.Paragraph>
          <Typography.Text type="secondary">{scenario.environment?.environmentId ?? "missing environment ID"}</Typography.Text>
        </section>

        <section className="workbench-panel" aria-label="Scenario equipment">
          <Typography.Title level={4}>Equipment</Typography.Title>
          <ol className="compact-list">
            {scenario.equipment.map((item) => (
              <li key={item}>
                <Typography.Text>{item}</Typography.Text>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-label="Scenario actors">
          <Typography.Title level={4}>Actors</Typography.Title>
          <ol className="compact-list">
            {scenario.actors.map((actor) => (
              <li key={actor.actorId}>
                <Typography.Text>{actor.displayName}</Typography.Text>
                <Typography.Text type="secondary">{`${actor.role}${actor.demeanor ? `, ${actor.demeanor}` : ""}`}</Typography.Text>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-label="Scenario behavior profiles">
          <Typography.Title level={4}>Behavior Profile Review</Typography.Title>
          <Typography.Paragraph>{formatActorCommunicationProfileCoverage(scenario.actors)}</Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            Supports faculty review of synthetic actor behavior; scenario status and score-use gates still control learner use.
          </Typography.Paragraph>
          <ol className="compact-list">
            {scenario.actors.map((actor) => (
              <li key={actor.actorId}>
                <Typography.Text>{actor.displayName}</Typography.Text>
                <Typography.Text type="secondary">
                  {actor.communicationProfile
                    ? `${actor.communicationProfile.style} / ${actor.communicationProfile.baselineMood.join(", ")}`
                    : "Behavior profile not exposed by the admin API."}
                </Typography.Text>
              </li>
            ))}
          </ol>
        </section>

        {publicationReadiness ? (
          <section className="workbench-panel" aria-label="Publication blocker visibility">
            <Typography.Title level={4}>Publication Blocker Visibility</Typography.Title>
            <Typography.Paragraph type="secondary">
              This read-only posture explains scenario publication blockers for operator review; it is not Quest readiness, clinical validity, scoring validity, or production release evidence.
            </Typography.Paragraph>
            <div className="tag-row">
              <Tag color="cyan">{`target use: ${publicationReadiness.targetUse}`}</Tag>
              <Tag color="gold">{publicationReadiness.blockerVisibility.claimBoundary}</Tag>
              <Tag color={publicationReadiness.blockerVisibility.humanReviewRequired ? "gold" : "blue"}>
                {publicationReadiness.blockerVisibility.humanReviewRequired ? "human review required" : "operator review clear"}
              </Tag>
              <Tag color="blue">{publicationReadiness.blockerVisibility.recommendedNextAction}</Tag>
            </div>
            <Typography.Text type="secondary">{`Gate statuses: ${publicationReadiness.gateResults.map((gate) => `${gate.gate}:${gate.status}`).join(", ")}`}</Typography.Text>
            <Typography.Text type="secondary">{`Missing reviewer roles: ${publicationReadiness.missingReviewerRoles.join(", ") || "none"}`}</Typography.Text>
            <Typography.Text type="secondary">{`Blocker IDs: ${publicationReadiness.blockerVisibility.blockerIds.join(", ") || "none"}`}</Typography.Text>
            <Typography.Text type="secondary">{`Warning IDs: ${publicationReadiness.blockerVisibility.warningIds.join(", ") || "none"}`}</Typography.Text>
          </section>
        ) : null}

        <section className="workbench-panel" aria-label="Scenario asset needs">
          <Typography.Title level={4}>Asset Needs</Typography.Title>
          <ol className="compact-list">
            {scenario.assetNeeds.map((asset) => (
              <li key={asset.assetId}>
                <Typography.Text>{asset.assetId}</Typography.Text>
                <Typography.Text type="secondary">{`${asset.assetType} / ${asset.licenseStatus}`}</Typography.Text>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-label="Scenario production blockers">
          <Typography.Title level={4}>Production Blockers</Typography.Title>
          {assetReadiness.productionBlockedAssets.length === 0 ? (
            <Typography.Paragraph className="empty-panel-note">No production blockers recorded.</Typography.Paragraph>
          ) : (
            <ol className="compact-list">
              {assetReadiness.productionBlockedAssets.map((asset) => (
                <li key={asset.assetId}>
                  <Typography.Text>{asset.assetId}</Typography.Text>
                  <Typography.Text type="secondary">{asset.blockers.join(", ")}</Typography.Text>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="workbench-panel" aria-label="Scenario production readiness ladder">
          <Typography.Title level={4}>Production Readiness Ladder</Typography.Title>
          <Typography.Paragraph>{`${productionReadinessLadder.assetCount} station assets in ladder; ${productionLadderBlockerCount} evidence blockers remain.`}</Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            Release-ladder evidence supports faculty/operator review only; it does not establish Quest runtime readiness or learner launch.
          </Typography.Paragraph>
          <div className="tag-row">
            <Tag color={productionReadinessLadder.productionReady ? "green" : "gold"}>
              {productionReadinessLadder.productionReady ? "release ready" : "release blocked"}
            </Tag>
            <Tag color={productionReadinessLadder.stationBudget.blockers.length === 0 ? "green" : "red"}>
              {productionReadinessLadder.stationBudget.blockers.length === 0 ? "budget clear" : "budget blocked"}
            </Tag>
          </div>
          <ol className="compact-list">
            {productionReadinessLadder.assetLadders.map((assetLadder) => {
              const completeStepCount = assetLadder.steps.filter((step) => step.status === "complete").length;
              return (
                <li key={assetLadder.assetId}>
                  <Typography.Text>{assetLadder.assetId}</Typography.Text>
                  <Typography.Text type="secondary">{`${completeStepCount} of ${assetLadder.steps.length} release steps complete`}</Typography.Text>
                  {assetLadder.blockers.length > 0 ? <Typography.Text type="secondary">{assetLadder.blockers.join(", ")}</Typography.Text> : null}
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </section>
  );
}