import { Button, Card, Form, Input, InputNumber, Select, Space } from "antd";
import type { ReactElement } from "react";
import {
  complianceRegionOptions,
  createTouchResponseDraft,
  interactionEmotionOptions,
  touchResponseKindOptions,
} from "./case-authoring-model.js";

/**
 * Per-actor touch-response rows (ActorCard.bodyMechanics.touchResponses).
 *
 * Extracted from CaseAuthoringWorkbench in W11 (tsk_250729c006996e58) because adding the
 * staging control pushed that file to 687 lines against a frozen 679 ceiling. The rule is
 * explicit that freeze ceilings may only shrink and its own note prescribes the remedy —
 * "extract form sections" — so this is the prescribed fix rather than a raised budget.
 * Follows the sibling pattern already in this directory: ActorPhenotypeFields,
 * AssetNeedsPanel, EmotionPolicyPanel, EquipmentPanel.
 *
 * Pure presentation over the antd form store. `fieldName` is the actor's index within the
 * `actors` Form.List, so every control nests as [fieldName, "touchResponses", i, field].
 */
export type ActorTouchResponseFieldsProps = {
  /** Index of the actor row inside the `actors` Form.List. */
  fieldName: number;
};

function toOptions(values: readonly string[]): { label: string; value: string }[] {
  return values.map((value) => ({ label: value, value }));
}

const regionSelectOptions = toOptions(complianceRegionOptions);
const emotionSelectOptions = toOptions(interactionEmotionOptions);
const responseKindSelectOptions = toOptions(touchResponseKindOptions);

export function ActorTouchResponseFields({ fieldName }: ActorTouchResponseFieldsProps): ReactElement {
  return (
    <Form.List name={[fieldName, "touchResponses"]}>
      {(fields, { add, remove }) => (
        <div aria-label="Touch responses">
          {fields.map((field) => (
            <Card
              key={field.key}
              size="small"
              type="inner"
              style={{ marginBottom: 10 }}
              title={`Touch response ${field.name + 1}`}
              extra={
                <Button danger size="small" onClick={() => remove(field.name)}>
                  Remove
                </Button>
              }
            >
              <Space wrap size="large">
                <Form.Item name={[field.name, "region"]} label="Region">
                  <Select options={regionSelectOptions} style={{ minWidth: 180 }} aria-label="Touch region" />
                </Form.Item>
                <Form.Item name={[field.name, "responseKind"]} label="Response kind">
                  <Select options={responseKindSelectOptions} style={{ minWidth: 160 }} aria-label="Touch response kind" />
                </Form.Item>
                <Form.Item name={[field.name, "forceThreshold"]} label="Force threshold">
                  <InputNumber min={0} max={1} step={0.01} aria-label="Touch force threshold" />
                </Form.Item>
                <Form.Item name={[field.name, "emotion"]} label="Emotion">
                  <Select options={emotionSelectOptions} style={{ minWidth: 150 }} aria-label="Touch emotion" />
                </Form.Item>
              </Space>
              <Space wrap size="large">
                <Form.Item name={[field.name, "emotionEventId"]} label="Emotion event ID">
                  <Input aria-label="Touch emotion event ID" />
                </Form.Item>
                <Form.Item name={[field.name, "responseClip"]} label="Response clip">
                  <Input aria-label="Touch response clip" />
                </Form.Item>
                <Form.Item name={[field.name, "traceTag"]} label="Trace tag">
                  <Input aria-label="Touch trace tag" />
                </Form.Item>
              </Space>
              <Form.Item name={[field.name, "dialogueLine"]} label="Dialogue line">
                <Input aria-label="Touch dialogue line" />
              </Form.Item>
            </Card>
          ))}
          <Button type="dashed" onClick={() => add(createTouchResponseDraft())}>
            Add touch response
          </Button>
        </div>
      )}
    </Form.List>
  );
}
