import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
} from "antd";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { createAdminControlPlaneClient } from "./api-client.js";
import {
  actorRoleOptions,
  caseAuthoringClaimBoundary,
  collectTouchResponseTraceTags,
  createActorDraft,
  createEmptyScenarioDraft,
  exportScenarioJson,
  habitusOptions,
  supportSurfaceOptions,
  mergeFormValuesIntoScenario,
  type ScenarioFormValues,
  scenarioStatusOptions,
  scenarioToFormValues,
  validateScenarioDraft,
} from "./case-authoring-model.js";
import { EncounterEnvironmentPanel } from "./EncounterEnvironmentPanel.js";
import { ActorPhenotypeFields } from "./ActorPhenotypeFields.js";
import { ActorTouchResponseFields } from "./ActorTouchResponseFields.js";
import { AssetNeedsPanel } from "./AssetNeedsPanel.js";
import { EmotionPolicyPanel } from "./EmotionPolicyPanel.js";
import { EquipmentPanel } from "./EquipmentPanel.js";
import { StringListField } from "@openclinxr/ui-shared/admin-string-list-field";
import { actorFormFromDraft, extractScenario, extractScenarioList, structuredCloneScenario } from "./case-authoring-io.js";
import { LiveAuthoringPreview } from "./scenario-authoring-preview/LiveAuthoringPreview.js";

const { TextArea } = Input;

/** Minimal server client surface for authored-scenario persistence (via app-local api-client only). */
export type CaseAuthoringApiClient = {
  saveAuthoredScenario: (scenario: Scenario) => Promise<unknown>;
  listAuthoredScenarios: () => Promise<unknown>;
  getAuthoredScenario: (scenarioId: string) => Promise<unknown>;
};

function toOptions(values: readonly string[]): { label: string; value: string }[] {
  return values.map((value) => ({ label: value, value }));
}
const roleSelectOptions = toOptions(actorRoleOptions);
const statusSelectOptions = toOptions(scenarioStatusOptions);
const habitusSelectOptions = toOptions(habitusOptions);
const supportSurfaceSelectOptions = toOptions(supportSurfaceOptions);

// Deliberately bounded: validated_summative is never offered (needs stage_3 evidence the
// authoring surface cannot produce) and stage_3_validated is never offered (would invite
// an unearned escalation). stage_0 is never auto-approved — the Select merely reflects
// whatever the compiled world carries and only changes when faculty change it.
const scoreUseLabelSelectOptions = toOptions(["formative_local_only", "pilot_research_only"]);
const validationStageSelectOptions = toOptions([
  "stage_0_synthetic_draft",
  "stage_1_expert_reviewed",
  "stage_2_pilot_ready",
]);

type ValidationView = { ok: true } | { ok: false; errors: string[] };

export type CaseAuthoringWorkbenchProps = {
  initialScenario?: Scenario;
  /** Optional injected client; defaults to createAdminControlPlaneClient() for server save/list/load. */
  apiClient?: CaseAuthoringApiClient;
};

/**
 * Faculty case-authoring surface. Authors create/edit an encounter case whose
 * exported JSON is shape-identical to `@openclinxr/scenario-fixtures` bank entries
 * and validates against the shared `ScenarioSchema` (Q1 blueprint input surface).
 *
 * This surface produces case *definitions* only. It is notEvidenceFor clinical
 * validity, exam equivalence, scoring, or learner readiness.
 */
export function CaseAuthoringWorkbench({ initialScenario, apiClient }: CaseAuthoringWorkbenchProps): ReactElement {
  const [form] = Form.useForm<ScenarioFormValues>();
  const [baseDraft, setBaseDraft] = useState<Scenario>(() => initialScenario ?? createEmptyScenarioDraft());
  const [formKey, setFormKey] = useState(0);
  const [validation, setValidation] = useState<ValidationView>(() =>
    validateScenarioDraft(initialScenario ?? createEmptyScenarioDraft()),
  );
  const [exportJson, setExportJson] = useState<string>(() =>
    exportScenarioJson(initialScenario ?? createEmptyScenarioDraft()),
  );
  const [touchTags, setTouchTags] = useState<string[]>(() =>
    collectTouchResponseTraceTags(initialScenario ?? createEmptyScenarioDraft()),
  );
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [serverList, setServerList] = useState<Array<{ scenarioId: string; version: number; label: string }>>([]);
  const [selectedServerKey, setSelectedServerKey] = useState<string | undefined>(undefined);
  const [serverBusy, setServerBusy] = useState(false);
  const client = useMemo(
    () => apiClient ?? createAdminControlPlaneClient(),
    [apiClient],
  );

  const initialValues = useMemo(() => scenarioToFormValues(baseDraft), [baseDraft]);

  // antd keeps the useForm store across the key remount, so re-apply the loaded
  // case imperatively whenever the base draft changes (Load example / Import / New).
  useEffect(() => {
    form.setFieldsValue(scenarioToFormValues(baseDraft));
  }, [baseDraft, form, formKey]);

  const recompute = useCallback(() => {
    const values = form.getFieldsValue(true) as ScenarioFormValues;
    const merged = mergeFormValuesIntoScenario(baseDraft, values);
    setValidation(validateScenarioDraft(merged));
    setExportJson(exportScenarioJson(merged));
    setTouchTags(collectTouchResponseTraceTags(merged));
    setCopied(false);
  }, [baseDraft, form]);

  const loadScenario = useCallback(
    (scenario: Scenario) => {
      setBaseDraft(scenario);
      setValidation(validateScenarioDraft(scenario));
      setExportJson(exportScenarioJson(scenario));
      setTouchTags(collectTouchResponseTraceTags(scenario));
      setImportError(null);
      setImportText("");
      setCopied(false);
      setFormKey((key) => key + 1);
    },
    [],
  );

  const handleImport = useCallback(() => {
    // Lazy import to avoid a hard dependency cycle in the model module surface.
    import("./case-authoring-model.js")
      .then(({ parseScenarioJson }) => {
        const result = parseScenarioJson(importText);
        if (result.ok) {
          loadScenario(result.scenario);
        } else {
          setImportError(result.errors.join("; "));
        }
      })
      .catch((error: unknown) => {
        setImportError(error instanceof Error ? error.message : "Import failed");
      });
  }, [importText, loadScenario]);

  const handleDownload = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }
    const values = form.getFieldsValue(true) as ScenarioFormValues;
    const merged = mergeFormValuesIntoScenario(baseDraft, values);
    const blob = new Blob([exportScenarioJson(merged)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${merged.scenarioId || "encounter_case"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [baseDraft, form]);
  const handleSaveToServer = useCallback(async () => {
    const values = form.getFieldsValue(true) as ScenarioFormValues;
    const merged = mergeFormValuesIntoScenario(baseDraft, values);
    const draftValidation = validateScenarioDraft(merged);
    if (!draftValidation.ok) {
      message.error("Fix validation issues before saving to server");
      return;
    }
    setServerBusy(true);
    try {
      await client.saveAuthoredScenario(merged);
      message.success(`Saved ${merged.scenarioId} v${merged.version} to server`);
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : "Save to server failed");
    } finally {
      setServerBusy(false);
    }
  }, [baseDraft, client, form]);

  const handleRefreshServerList = useCallback(async () => {
    setServerBusy(true);
    try {
      const raw = await client.listAuthoredScenarios();
      const scenarios = extractScenarioList(raw);
      setServerList(
        scenarios.map((scenario) => ({
          scenarioId: scenario.scenarioId,
          version: scenario.version,
          label: `${scenario.scenarioId} v${scenario.version}`,
        })),
      );
      if (scenarios.length === 0) {
        message.info("No authored scenarios on server yet");
      }
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : "List from server failed");
    } finally {
      setServerBusy(false);
    }
  }, [client]);

  const handleLoadFromServer = useCallback(
    async (scenarioId: string) => {
      setServerBusy(true);
      try {
        const raw = await client.getAuthoredScenario(scenarioId);
        const scenario = extractScenario(raw);
        if (!scenario) {
          message.error("Server returned no scenario payload");
          return;
        }
        loadScenario(scenario);
        message.success(`Loaded ${scenario.scenarioId} v${scenario.version} from server`);
      } catch (error: unknown) {
        message.error(error instanceof Error ? error.message : "Load from server failed");
      } finally {
        setServerBusy(false);
      }
    },
    [client, loadScenario],
  );

  const handleCopy = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(exportJson);
    }
    setCopied(true);
  }, [exportJson]);

  return (
    <section className="case-authoring-workbench" aria-label="Encounter case authoring">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Blueprint input surface</Typography.Text>
          <Typography.Title level={3} style={{ margin: "4px 0 0" }}>
            Encounter Case Authoring
          </Typography.Title>
        </div>
        <Space wrap>
          <Tag color="blue">antd Form authoring</Tag>
          <Tag color={validation.ok ? "green" : "gold"} aria-label="Case validation status">
            {validation.ok ? "valid against ScenarioSchema" : "validation blocked"}
          </Tag>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Formative authoring surface"
        description={
          <span aria-label="Authoring claim boundary">
            Authored cases are synthetic encounter definitions for local faculty review. This surface is{" "}
            <Typography.Text strong>notEvidenceFor</Typography.Text>: {caseAuthoringClaimBoundary.join(", ")}.
          </span>
        }
      />

      <Steps
        size="small"
        style={{ marginBottom: 20 }}
        items={[
          { title: "Case metadata", description: "Identity, status, objectives" },
          { title: "Actors & interactions", description: "Roles, body mechanics, touch responses" },
          { title: "Validate & export", description: "ScenarioSchema check + JSON" },
        ]}
      />

      <Card title="Load a case" size="small" style={{ marginBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button onClick={() => loadScenario(structuredCloneScenario(edChestPainScenario))}>
            Load ED Chest Pain example
          </Button>
          <Button onClick={() => loadScenario(createEmptyScenarioDraft())}>New empty case</Button>
        </Space>
        <Form.Item
          label="Import scenario JSON"
          htmlFor="case-authoring-import"
          validateStatus={importError ? "error" : ""}
          help={importError ?? "Paste a scenario-bank-shaped JSON case to edit it."}
          style={{ marginBottom: 8 }}
        >
          <TextArea
            id="case-authoring-import"
            aria-label="Import scenario JSON"
            rows={3}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder='{"scenarioId":"...","title":"...", ...}'
          />
        </Form.Item>
        <Button onClick={handleImport} disabled={importText.trim().length === 0}>
          Import JSON
        </Button>
        <Divider style={{ margin: "16px 0 12px" }} />
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
          Server persistence (authored drafts as full Scenario objects)
        </Typography.Text>
        <Space wrap>
          <Button type="primary" onClick={() => void handleSaveToServer()} loading={serverBusy} disabled={!validation.ok}>
            Save to server
          </Button>
          <Button onClick={() => void handleRefreshServerList()} loading={serverBusy}>
            Load from server
          </Button>
          <Select
            aria-label="Server authored scenarios"
            placeholder="Select saved scenario"
            style={{ minWidth: 260 }}
            value={selectedServerKey}
            options={serverList.map((entry) => ({
              label: entry.label,
              value: `${entry.scenarioId}::${entry.version}`,
            }))}
            onChange={(value: string | undefined) => {
              setSelectedServerKey(value);
              if (!value) {
                return;
              }
              const scenarioId = value.split("::")[0] ?? "";
              if (scenarioId.length > 0) {
                void handleLoadFromServer(scenarioId);
              }
            }}
            disabled={serverList.length === 0 || serverBusy}
            allowClear
          />
        </Space>
      </Card>

      <Form<ScenarioFormValues>
        key={formKey}
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={recompute}
        aria-label="Encounter case form"
      >
        <Card title="Case metadata" size="small" style={{ marginBottom: 16 }}>
          <Form.Item label="Scenario ID" name="scenarioId" rules={[{ required: true, message: "Scenario ID is required" }]}>
            <Input aria-label="Scenario ID" />
          </Form.Item>
          <Form.Item label="Title" name="title" rules={[{ required: true, message: "Title is required" }]}>
            <Input aria-label="Case title" />
          </Form.Item>
          <Space wrap size="large">
            <Form.Item label="Version" name="version">
              <InputNumber min={1} aria-label="Case version" />
            </Form.Item>
            <Form.Item label="Status" name="status">
              <Select options={statusSelectOptions} style={{ minWidth: 160 }} aria-label="Case status" />
            </Form.Item>
          </Space>
          <StringListField
            name="clinicalObjectives"
            label="Clinical objectives"
            addLabel="Add objective"
            itemLabel="Objective"
          />
          <StringListField
            name="requiredTraceTags"
            label="Required trace tags"
            addLabel="Add trace tag"
            itemLabel="Trace tag"
          />
        </Card>
        <EncounterEnvironmentPanel environmentId={baseDraft.environment?.environmentId} />
        <EquipmentPanel />
        <EmotionPolicyPanel /* W10: transitions Form.List lives in this panel */ />
        <AssetNeedsPanel />
        <Card title="Governance & review rubric" size="small" style={{ marginBottom: 16 }}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Faculty-visible governance"
            description={
              <span aria-label="Governance claim boundary">
                scoreUseLabel, validationStage, and rubric items come from the compiled world and round-trip
                unchanged unless faculty edit them — the LLM cannot escalate claim labels silently.{" "}
                <Typography.Text strong>validated_summative</Typography.Text> is never offered and stage_0 is
                never auto-approved.
              </span>
            }
          />
          <Space wrap size="large">
            <Form.Item name={["governance", "scoreUseLabel"]} label="Score use label" style={{ marginBottom: 12 }}>
              <Select options={scoreUseLabelSelectOptions} style={{ minWidth: 220 }} aria-label="Governance score use label" />
            </Form.Item>
            <Form.Item name={["governance", "validationStage"]} label="Validation stage" style={{ marginBottom: 12 }}>
              <Select options={validationStageSelectOptions} style={{ minWidth: 260 }} aria-label="Governance validation stage" />
            </Form.Item>
          </Space>
          <Form.Item name={["governance", "syntheticCaseDisclosure"]} label="Synthetic-case disclosure" style={{ marginBottom: 12 }}>
            <TextArea aria-label="Governance synthetic case disclosure" rows={2} />
          </Form.Item>
          <StringListField
            name={["governance", "validationLimitations"]}
            label="Validation limitations"
            addLabel="Add limitation"
            itemLabel="Validation limitation"
          />
          <Divider style={{ margin: "8px 0" }}>Review rubric items</Divider>
          <Form.List name="reviewRubric">
            {(fields, { add, remove }) => (
              <div>
                {fields.map((field) => (
                  <Card
                    key={field.key}
                    size="small"
                    type="inner"
                    style={{ marginBottom: 10 }}
                    title={`Rubric item ${field.name + 1}`}
                    extra={
                      <Button danger size="small" onClick={() => remove(field.name)}>
                        Remove
                      </Button>
                    }
                  >
                    <Space wrap size="large">
                      <Form.Item name={[field.name, "rubricId"]} label="Rubric ID" style={{ marginBottom: 12 }}>
                        <Input aria-label="Rubric ID" placeholder="e.g. urgent_recognition" />
                      </Form.Item>
                      <Form.Item name={[field.name, "label"]} label="Label" style={{ marginBottom: 12 }}>
                        <Input aria-label="Rubric label" placeholder="e.g. Urgent recognition" />
                      </Form.Item>
                    </Space>
                    <StringListField
                      name={[field.name, "requiredTraceTags"]}
                      label="Required trace tags"
                      addLabel="Add trace tag"
                      itemLabel="Rubric trace tag"
                    />
                  </Card>
                ))}
                <Button
                  type="dashed"
                  block
                  style={{ marginTop: 12 }}
                  onClick={() => add({ rubricId: `rubric_${fields.length + 1}`, label: "", requiredTraceTags: [] })}
                >
                  Add rubric item
                </Button>
              </div>
            )}
          </Form.List>
        </Card>
        <Card title="Actors & interactions" size="small" style={{ marginBottom: 16 }}>
          <Form.List name="actors">
            {(fields, { add, remove }) => (
              <div>
                <Collapse
                  items={fields.map((field) => ({
                    key: field.key,
                    label: <ActorPanelLabel form={form} fieldName={field.name} />,
                    children: <ActorFields fieldName={field.name} onRemove={() => remove(field.name)} />,
                  }))}
                />
                <Button
                  type="dashed"
                  block
                  style={{ marginTop: 12 }}
                  onClick={() => add(actorFormFromDraft(createActorDraft(fields.length + 1)))}
                >
                  Add actor
                </Button>
              </div>
            )}
          </Form.List>
        </Card>

        <Card title="Scenario steps (event schedule)" size="small" style={{ marginBottom: 16 }}>
          <Form.List name="eventSchedule">
            {(fields, { add, remove }) => (
              <div>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap style={{ display: "flex", marginBottom: 8 }}>
                    <Form.Item name={[field.name, "eventId"]} label="Event ID">
                      <Input aria-label="Event ID" />
                    </Form.Item>
                    <Form.Item name={[field.name, "atSecond"]} label="At second">
                      <InputNumber min={0} aria-label="Event at second" />
                    </Form.Item>
                    <Form.Item name={[field.name, "actorId"]} label="Actor ID">
                      <Input aria-label="Event actor ID" />
                    </Form.Item>
                    <Form.Item name={[field.name, "tag"]} label="Trace tag">
                      <Input aria-label="Event trace tag" />
                    </Form.Item>
                    <Button danger size="small" onClick={() => remove(field.name)}>
                      Remove step
                    </Button>
                  </Space>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add({ eventId: `event_${fields.length + 1}`, atSecond: 0, actorId: "", tag: "" })}
                >
                  Add scenario step
                </Button>
              </div>
            )}
          </Form.List>
        </Card>
        <LiveAuthoringPreview approved={baseDraft} />
      </Form>

      <div className="case-authoring-output-grid">
        <Card title="Validation" size="small">
          {validation.ok ? (
            <Alert type="success" showIcon message="Case validates against ScenarioSchema." />
          ) : (
            <Alert
              type="warning"
              showIcon
              message="Resolve validation issues before export"
              description={
                <ul aria-label="Validation errors" style={{ margin: 0, paddingLeft: 18 }}>
                  {validation.errors.map((error, index) => (
                    <li key={`${index}-${error}`}>{error}</li>
                  ))}
                </ul>
              }
            />
          )}
          <Divider style={{ margin: "12px 0" }} />
          <Typography.Text type="secondary">Touch-response trace tags</Typography.Text>
          <div className="tag-row" aria-label="Touch response trace tags" style={{ marginTop: 6 }}>
            {touchTags.length === 0 ? (
              <Typography.Text type="secondary">No touch responses authored yet.</Typography.Text>
            ) : (
              touchTags.map((tag) => <Tag key={tag}>{tag}</Tag>)
            )}
          </div>
        </Card>

        <Card
          title="Export scenario JSON"
          size="small"
          extra={
            <Space>
              <Button size="small" onClick={handleCopy}>
                {copied ? "Copied" : "Copy JSON"}
              </Button>
              <Button size="small" type="primary" onClick={handleDownload} disabled={!validation.ok}>
                Download JSON
              </Button>
            </Space>
          }
        >
          <TextArea
            aria-label="Exported scenario JSON"
            readOnly
            value={exportJson}
            autoSize={{ minRows: 8, maxRows: 20 }}
          />
        </Card>
      </div>
    </section>
  );
}

function ActorPanelLabel({ form, fieldName }: { form: ReturnType<typeof Form.useForm<ScenarioFormValues>>[0]; fieldName: number }): ReactElement {
  // Watch the whole actors array so collapsed (unrendered) panels still show live
  // identity; deep per-item watch paths do not resolve while a panel is collapsed.
  const actors = Form.useWatch("actors", form) as ScenarioFormValues["actors"] | undefined;
  const actor = actors?.[fieldName];
  return (
    <span>
      <Typography.Text strong>{actor?.displayName || "New actor"}</Typography.Text>
      {actor?.role ? <Tag style={{ marginLeft: 8 }}>{actor.role}</Tag> : null}
    </span>
  );
}

function ActorFields({ fieldName, onRemove }: { fieldName: number; onRemove: () => void }): ReactElement {
  return (
    <div>
      <Space wrap size="large">
        <Form.Item name={[fieldName, "actorId"]} label="Actor ID" rules={[{ required: true, message: "Actor ID is required" }]}>
          <Input aria-label="Actor ID" />
        </Form.Item>
        <Form.Item name={[fieldName, "displayName"]} label="Display name" rules={[{ required: true, message: "Display name is required" }]}>
          <Input aria-label="Actor display name" />
        </Form.Item>
        <Form.Item name={[fieldName, "role"]} label="Role">
          <Select options={roleSelectOptions} style={{ minWidth: 180 }} aria-label="Actor role" />
        </Form.Item>
      </Space>
      <Form.Item name={[fieldName, "demeanor"]} label="Demeanor">
        <Input aria-label="Actor demeanor" placeholder="e.g. anxious, guarded, protective of chest" />
      </Form.Item>
      <Form.Item name={[fieldName, "openingUtterance"]} label="Opening utterance">
        <Input.TextArea aria-label="Actor openingUtterance" autoSize={{ minRows: 2, maxRows: 4 }} />
      </Form.Item>
      <Form.Item name={[fieldName, "communicationProfile", "style"]} label="Communication style">
        <Select
          allowClear
          aria-label="Actor communicationProfile style"
          style={{ minWidth: 220 }}
          placeholder="preserve imported profile"
          options={["congruent", "accuser", "rationalizer", "appeaser", "distractor", "withdrawn_guarded", "angry_family_member", "custom"].map((value) => ({ value, label: value }))}
        />
      </Form.Item>

      <StringListField
        name={[fieldName, "hiddenFacts"]}
        label="Hidden facts"
        addLabel="Add hidden fact"
        itemLabel="Hidden fact"
      />

      <Divider style={{ margin: "8px 0" }}>Staging (optional)</Divider>
      <Form.Item
        name={[fieldName, "placement", "supportSurface"]}
        label="Support surface"
        tooltip="Where this actor is staged. Leave unset to author no staging — the compile graph then emits no Placement node for them. 'none' is an explicit standing decision, not the same as unset."
      >
        <Select
          allowClear
          options={supportSurfaceSelectOptions}
          style={{ minWidth: 160 }}
          aria-label="Actor support surface"
          placeholder="unset"
        />
      </Form.Item>

      <Divider style={{ margin: "8px 0" }}>Body mechanics (optional)</Divider>
      <Form.Item name={[fieldName, "habitus"]} label="Habitus">
        <Select
          allowClear
          options={habitusSelectOptions}
          style={{ minWidth: 160 }}
          aria-label="Actor habitus"
          placeholder="none"
        />
      </Form.Item>

      <ActorTouchResponseFields fieldName={fieldName} />
      <ActorPhenotypeFields fieldName={fieldName} />

      <Divider style={{ margin: "12px 0" }} />
      <Button danger onClick={onRemove}>
        Remove actor
      </Button>
    </div>
  );
}
