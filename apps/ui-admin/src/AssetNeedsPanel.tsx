/**
 * Asset-needs authoring for a case (scenario.assetNeeds rows: assetId, assetType,
 * description, licenseStatus). Row-based editor bound to the form `assetNeeds`
 * field; the list round-trips onto scenario.assetNeeds via the shared model
 * (case-authoring-model merge). assetType is a closed enum Select (AssetKindSchema);
 * licenseStatus stays free text — enum authoring is out of scope. Not 3D placement.
 */

import { Button, Card, Form, Input, Select, Space } from "antd";
import type { ReactElement } from "react";
import {
  assetTypeOptions,
  createAssetNeedDraft,
} from "./case-authoring-model.js";

function toOptions(values: readonly string[]): { label: string; value: string }[] {
  return values.map((value) => ({ label: value, value }));
}
const assetTypeSelectOptions = toOptions(assetTypeOptions);

export function AssetNeedsPanel(): ReactElement {
  return (
    <Card title="Asset needs" size="small" style={{ marginBottom: 16 }}>
      <Form.List name="assetNeeds">
        {(fields, { add, remove }) => (
          <section aria-label="Asset needs">
            {fields.map((field) => (
              <Card
                key={field.key}
                size="small"
                type="inner"
                style={{ marginBottom: 10 }}
                title={`Asset need ${field.name + 1}`}
                extra={
                  <Button danger size="small" onClick={() => remove(field.name)}>
                    Remove
                  </Button>
                }
              >
                <Space wrap size="large">
                  <Form.Item name={[field.name, "assetId"]} label="Asset ID" style={{ marginBottom: 12 }}>
                    <Input aria-label="Asset ID" placeholder="e.g. patient_robert_hayes_character" />
                  </Form.Item>
                  <Form.Item name={[field.name, "assetType"]} label="Asset type" style={{ marginBottom: 12 }}>
                    <Select options={assetTypeSelectOptions} style={{ minWidth: 160 }} aria-label="Asset type" />
                  </Form.Item>
                </Space>
                <Form.Item name={[field.name, "description"]} label="Description" style={{ marginBottom: 12 }}>
                  <Input aria-label="Asset description" placeholder="What the runtime scene needs this asset for" />
                </Form.Item>
                <Form.Item name={[field.name, "licenseStatus"]} label="License status" style={{ marginBottom: 0 }}>
                  <Input aria-label="Asset license status" placeholder="e.g. placeholder-approved" />
                </Form.Item>
              </Card>
            ))}
            <Button type="dashed" block style={{ marginTop: 12 }} onClick={() => add(createAssetNeedDraft())}>
              Add asset need
            </Button>
          </section>
        )}
      </Form.List>
    </Card>
  );
}
