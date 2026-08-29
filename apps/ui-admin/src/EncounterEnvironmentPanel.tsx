/**
 * Shell facts for the selected encounter environmentId (#69) + the faculty-picked
 * registered shell id (the authoring form writes environmentId). The Select is the
 * form's only environment control; facts follow the live selection so the author
 * sees the room change before export. Not a 3D preview — displayName, dimensions,
 * floor/wall colour, shell lighting (sky/ground ambient + key intensity), and
 * fixture slotIds from the shared descriptor table.
 */

import { ENVIRONMENT_SHELL_DESCRIPTORS } from "@openclinxr/asset-registry";
import { Alert, Card, Form, InputNumber, Select, Space, Typography } from "antd";
import { type ReactElement, useMemo } from "react";
import type { ScenarioFormValues } from "./case-authoring-model.js";

/** Option source stays the shared registry — never a hardcoded list. */
const environmentOptions = Object.values(ENVIRONMENT_SHELL_DESCRIPTORS).map((descriptor) => ({
  value: descriptor.environmentId,
  label: descriptor.displayName,
}));

export type EncounterEnvironmentPanelProps = {
  /** Imported base environmentId; facts fall back to it until the form store carries a selection. */
  environmentId?: string | undefined;
};

export function EncounterEnvironmentPanel({ environmentId: importedEnvironmentId }: EncounterEnvironmentPanelProps): ReactElement {
  const form = Form.useFormInstance<ScenarioFormValues>();
  const selectedId = (Form.useWatch("environmentId", form) ?? importedEnvironmentId) as string | undefined;
  const shell = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    const descriptor = ENVIRONMENT_SHELL_DESCRIPTORS[selectedId];
    return {
      environmentId: selectedId,
      displayName: descriptor?.displayName ?? selectedId,
      roomWidthMeters: descriptor?.roomWidthMeters,
      roomDepthMeters: descriptor?.roomDepthMeters,
      roomHeightMeters: descriptor?.roomHeightMeters,
      floorColor: descriptor?.floorColor,
      wallColor: descriptor?.wallColor,
      ambientHemisphereSky: descriptor?.ambientHemisphereSky,
      ambientHemisphereGround: descriptor?.ambientHemisphereGround,
      keyLightIntensity: descriptor?.keyLightIntensity,
      fixtureSlots: descriptor?.fixtureSlots,
      known: Boolean(descriptor),
    };
  }, [selectedId]);

  return (
    <section aria-label="Encounter environment" style={{ marginBottom: 16 }}>
      <Card title="Encounter environment" size="small">
        <Form.Item label="Environment" name="environmentId" style={{ marginBottom: 12 }}>
          <Select
            aria-label="Environment shell"
            placeholder="Select a registered environment shell"
            allowClear
            showSearch
            optionFilterProp="label"
            options={environmentOptions}
          />
        </Form.Item>
        {shell ? (
          <div>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <Typography.Text strong>Room: </Typography.Text>
              <Typography.Text>{shell.displayName}</Typography.Text>
            </Typography.Paragraph>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary">environmentId: </Typography.Text>
              <Typography.Text code>{shell.environmentId}</Typography.Text>
            </Typography.Paragraph>
            {shell.known && shell.roomWidthMeters != null ? (
              <Space wrap size="large">
                <Typography.Text>width {shell.roomWidthMeters} m</Typography.Text>
                <Typography.Text>depth {shell.roomDepthMeters} m</Typography.Text>
                <Typography.Text>height {shell.roomHeightMeters} m</Typography.Text>
                {typeof shell.floorColor === "number" ? (
                  <Typography.Text>
                    floor #{shell.floorColor.toString(16).padStart(6, "0")}
                  </Typography.Text>
                ) : null}
                {typeof shell.wallColor === "number" ? (
                  <Typography.Text>
                    wall #{shell.wallColor.toString(16).padStart(6, "0")}
                  </Typography.Text>
                ) : null}
              </Space>
            ) : (
              <Alert
                type="warning"
                showIcon
                message="No shell descriptor for this environmentId"
                description="The runtime will fall back to the generic shell until a descriptor is registered."
              />
            )}
            {shell.known && shell.fixtureSlots != null && shell.fixtureSlots.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <Typography.Text strong>Fixture slots: </Typography.Text>
                <ul aria-label="Fixture slots" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {shell.fixtureSlots.map((slot) => (
                    <li key={slot.slotId} style={{ marginBottom: 2 }}>
                      {slot.slotId}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {shell.known &&
            (typeof shell.ambientHemisphereSky === "number" ||
              typeof shell.ambientHemisphereGround === "number" ||
              typeof shell.keyLightIntensity === "number") ? (
              <div aria-label="Shell lighting" style={{ marginTop: 12 }}>
                <Typography.Text strong>Shell lighting: </Typography.Text>
                <Space wrap size="large">
                  {typeof shell.ambientHemisphereSky === "number" ? (
                    <Typography.Text>
                      sky #{shell.ambientHemisphereSky.toString(16).padStart(6, "0")}
                    </Typography.Text>
                  ) : null}
                  {typeof shell.ambientHemisphereGround === "number" ? (
                    <Typography.Text>
                      ground #{shell.ambientHemisphereGround.toString(16).padStart(6, "0")}
                    </Typography.Text>
                  ) : null}
                  {typeof shell.keyLightIntensity === "number" ? (
                    <Typography.Text>key {shell.keyLightIntensity}</Typography.Text>
                  ) : null}
                </Space>
              </div>
            ) : null}
            <div aria-label="Lighting compile overrides" style={{ marginTop: 16 }}>
              <Typography.Text strong>Override for the next compile: </Typography.Text>
              <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 8 }}>
                Leave blank to bake the descriptor fact above. A value here is written as the Lighting
                node&apos;s overridePatch and changes the recipe cache key, so the room re-bakes.
              </Typography.Paragraph>
              <Space wrap size="large" align="start">
                <Form.Item
                  label="wallColor"
                  name="wallColor"
                  style={{ marginBottom: 0 }}
                  tooltip="Integer colour, e.g. 0x112233 as 1122867. Blank keeps the descriptor value."
                >
                  <InputNumber aria-label="wallColor override" min={0} max={0xffffff} step={1} />
                </Form.Item>
                <Form.Item
                  label="ambientHemisphereSky"
                  name="ambientHemisphereSky"
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber aria-label="ambientHemisphereSky override" min={0} max={0xffffff} step={1} />
                </Form.Item>
                <Form.Item
                  label="ambientHemisphereGround"
                  name="ambientHemisphereGround"
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber aria-label="ambientHemisphereGround override" min={0} max={0xffffff} step={1} />
                </Form.Item>
                <Form.Item label="keyLightIntensity" name="keyLightIntensity" style={{ marginBottom: 0 }}>
                  <InputNumber aria-label="keyLightIntensity override" min={0} step={0.1} />
                </Form.Item>
              </Space>
            </div>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              Shell facts from the shared environment descriptor (runtime + factory use the same table).
              Not a 3D preview; notEvidenceFor clinical room realism.
            </Typography.Paragraph>
          </div>
        ) : (
          <Typography.Text type="secondary">
            No environment.environmentId on this case yet.
          </Typography.Text>
        )}
      </Card>
    </section>
  );
}
