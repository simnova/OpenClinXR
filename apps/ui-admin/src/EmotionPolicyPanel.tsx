/**
 * Actor-affect authoring for a case (scenario.emotionPolicy baseline / upper /
 * lower bounds). The runtime `resolveCaseEmotionPolicy` reads the authored
 * scenario.emotionPolicy to drive actor baseline and transition bounds
 * (scenario-runtime emotion-policy.ts), falling back to DEFAULT_EMOTION_POLICY
 * when absent. Transition RULES are preserved from the imported base and are
 * not edited here (transition-rule editor out of scope). Not clinical affect;
 * options come from `interactionEmotionOptions` (the closed
 * InteractionEmotionSchema set) — no invented emotion labels.
 */

import { Card, Form, Select, Space } from "antd";
import type { ReactElement } from "react";
import { interactionEmotionOptions } from "./case-authoring-model.js";

const emotionSelectOptions = interactionEmotionOptions.map((value) => ({ label: value, value }));

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
    </Card>
  );
}
