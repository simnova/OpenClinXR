import type { Scenario } from "@openclinxr/shared-schemas";
import { Form } from "antd";
import { type ReactElement, useMemo } from "react";
import { mergeFormValuesIntoScenario, type ScenarioFormValues } from "../case-authoring-model.js";
import { ScenarioAuthoringPreviewPanel } from "./ScenarioAuthoringPreviewPanel.js";

/**
 * Watches the encounter-case form and previews the current merged draft against
 * the loaded baseline. Promotion stays fail-closed until a matching reviewed identity
 * is supplied (authoring does not invent one).
 */
export function LiveAuthoringPreview({ approved }: { approved: Scenario }): ReactElement {
  const form = Form.useFormInstance<ScenarioFormValues>();
  const actors = Form.useWatch("actors", form);
  const equipment = Form.useWatch("equipment", form);
  const emotionPolicy = Form.useWatch("emotionPolicy", form);
  const environmentId = Form.useWatch("environmentId", form);
  const draft = useMemo(() => {
    const values = form.getFieldsValue(true) as ScenarioFormValues;
    // Form.List fields register after first paint; merging an empty actor list
    // would invent a full actor/dialogue/asset removal versus the loaded case.
    if (approved.actors.length > 0 && (values.actors?.length ?? 0) === 0) {
      return approved;
    }
    return mergeFormValuesIntoScenario(approved, values);
  }, [approved, form, actors, equipment, emotionPolicy, environmentId]);
  return <ScenarioAuthoringPreviewPanel draft={draft} approved={approved} />;
}
