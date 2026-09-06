/**
 * Free-text equipment authoring for a case (scenario.equipment string list).
 * Tags-mode Select: type a name and press Enter (or comma) to add; x removes.
 * The form value round-trips onto scenario.equipment via the shared model
 * (case-authoring-model merge). Not a library picker — equipment library ids
 * vs free strings is out of scope; not 3D placement.
 */

import { Card, Form, Select } from "antd";
import type { ReactElement } from "react";

export function EquipmentPanel(): ReactElement {
  return (
    <Card title="Equipment" size="small" style={{ marginBottom: 16 }}>
      <Form.Item label="Equipment" name="equipment" style={{ marginBottom: 0 }}>
        <Select
          mode="tags"
          placeholder="Type equipment names and press Enter"
          tokenSeparators={[","]}
        />
      </Form.Item>
    </Card>
  );
}
