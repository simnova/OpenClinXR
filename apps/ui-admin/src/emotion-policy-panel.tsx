/**
 * Actor-affect authoring for a case (scenario.emotionPolicy baseline / upper /
 * lower bounds). The runtime `resolveCaseEmotionPolicy` reads the authored
 * scenario.emotionPolicy to drive actor baseline and transition bounds
 * (scenario-runtime emotion-policy.ts), falling back to DEFAULT_EMOTION_POLICY
 * when absent. Transition RULES (from, triggeredBy, to) are authored here as
 * a Form.List so faculty edit the graph the runtime actually fires. Empty
 * list remains valid. Not clinical affect; options come from
 * `interactionEmotionOptions` (the closed InteractionEmotionSchema set) and
 * EmotionEventKindSchema — no invented emotion labels.
 */

import { Button, Card, Form, Select, Space } from "antd";
import type { ReactElement } from "react";
import { interactionEmotionOptions } from "./case-authoring-model.js";

const emotionSelectOptions = interactionEmotionOptions.map((value) => ({ label: value, value }));
const emotionEventKindOptions = [
  "learner_empathetic",
  "learner_dismissive",
  "learner_interruption",
  "actor_silence_timeout",
  "learner_acknowledgement",
  "learner_clinical_question",
  "learner_personal_question",
].map((value) => ({ label: value, value }));

export function EmotionPolicyPanel(): ReactElement {
  return (
    <Card title="Emotion policy" size="small" style={{ marginBottom: 16 }}>
      <Space wrap size="large">
        <Form.Item label="Emotion policy" name={["emotionPolicy", "baseline"]} style={{ marginBottom: 0 }}>
          <Select
            allowClear
            options={emotionSelectOptions}
            style={{ minWidth: 160 }}
            aria-label="Emotion baseline"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item label="Upper bound" name={["emotionPolicy", "upperBound"]} style={{ marginBottom: 0 }}>
          <Select
            allowClear
            options={emotionSelectOptions}
            style={{ minWidth: 160 }}
            aria-label="Emotion upper bound"
            placeholder="none"
          />
        </Form.Item>
        <Form.Item label="Lower bound" name={["emotionPolicy", "lowerBound"]} style={{ marginBottom: 0 }}>
          <Select
            allowClear
            options={emotionSelectOptions}
            style={{ minWidth: 160 }}
            aria-label="Emotion lower bound"
            placeholder="none"
          />
        </Form.Item>
      </Space>
      <Form.List name={["emotionPolicy", "transitions"]}>
        {(fields, { add, remove }) => (
          <div style={{ marginTop: 12 }}>
            {fields.map((field) => (
              <Space key={field.key} wrap size="small" style={{ display: "flex", marginBottom: 8 }}>
                <Form.Item name={[field.name, "from"]} style={{ marginBottom: 0 }}>
                  <Select
                    allowClear
                    options={emotionSelectOptions}
                    style={{ minWidth: 140 }}
                    aria-label="Emotion transition from"
                    placeholder="from"
                  />
                </Form.Item>
                <Form.Item name={[field.name, "triggeredBy"]} style={{ marginBottom: 0 }}>
                  <Select
                    allowClear
                    options={emotionEventKindOptions}
                    style={{ minWidth: 200 }}
                    aria-label="Emotion transition triggered by"
                    placeholder="triggeredBy"
                  />
                </Form.Item>
                <Form.Item name={[field.name, "to"]} style={{ marginBottom: 0 }}>
                  <Select
                    allowClear
                    options={emotionSelectOptions}
                    style={{ minWidth: 140 }}
                    aria-label="Emotion transition to"
                    placeholder="to"
                  />
                </Form.Item>
                <Button type="link" onClick={() => remove(field.name)} aria-label="Remove emotion transition">
                  Remove
                </Button>
              </Space>
            ))}
            <Button type="dashed" onClick={() => add()} aria-label="Add emotion transition">
              Add transition
            </Button>
          </div>
        )}
      </Form.List>
    </Card>
  );
}
