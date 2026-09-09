import { Button, Card, Input, InputNumber, Space, Switch, Typography } from "antd";
import { type ReactElement, useMemo, useState } from "react";
import {
  factoryStationSchemas,
  productionStationIds,
  type ProductionStationId,
} from "@openclinxr/factory-stations/catalog";

export type FactoryStationCardsProps = {
  values?: Partial<Record<ProductionStationId, Record<string, unknown>>>;
  onChange?: (stationId: ProductionStationId, value: Record<string, unknown>) => void;
  onAddTrellisModel?: (payload: { modelId: string; subjectId: string; packId: string }) => void;
};

function defaultValue(type: "string" | "number" | "boolean" | "object"): unknown {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "object") return { x: 0, y: 0, z: 0 };
  return "";
}

export function FactoryStationCards({ values, onChange, onAddTrellisModel }: FactoryStationCardsProps): ReactElement {
  const stations = useMemo(() => productionStationIds(), []);
  const [drafts, setDrafts] = useState<Partial<Record<ProductionStationId, Record<string, unknown>>>>({});
  const [errors, setErrors] = useState<Partial<Record<ProductionStationId, string>>>({});

  return (
    <fieldset className="station-queue-row" aria-label="Factory station cards">
      <Typography.Text strong>Factory station cards</Typography.Text>
      <Typography.Text type="secondary">
        One card per production station; controls derived from jsonSchema.input. instrument is not a card.
      </Typography.Text>
      <Button
        size="small"
        aria-label="Add TRELLIS bake model"
        onClick={() => {
          const modelId = `trellis_worldview_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
          onAddTrellisModel?.({
            modelId,
            subjectId: "ecg-cart-imagine-box",
            packId: "ecg-cart-imagine-box",
          });
        }}
      >
        Add TRELLIS bake model
      </Button>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {stations.map((stationId) => {
          const schema = factoryStationSchemas[stationId];
          const json = schema.jsonSchema.input({ target: "draft-2020-12" });
          const current = drafts[stationId] ?? values?.[stationId] ?? {};
          return (
            <Card key={stationId} size="small" title={stationId} aria-label={`${stationId} station card`}>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {Object.entries(json.properties).map(([name, prop]) => {
                  const label = `${stationId}.${name}`;
                  const value = current[name] ?? defaultValue(prop.type);
                  // htmlFor/id, not just aria-label: biome's noLabelWithoutControl cannot see
                  // an antd component as a form control, and the explicit association is what
                  // actually lets a screen reader move focus from the label to the input.
                  const controlId = `factory-station-${label.replace(/[^\w-]/gu, "-")}`;
                  if (prop.type === "boolean") {
                    return (
                      <label key={name} htmlFor={controlId}>
                        {name}
                        <Switch
                          id={controlId}
                          aria-label={label}
                          checked={Boolean(value)}
                          onChange={(checked) => patch(stationId, current, name, checked)}
                        />
                      </label>
                    );
                  }
                  if (prop.type === "number") {
                    return (
                      <label key={name} htmlFor={controlId}>
                        {name}
                        <InputNumber
                          id={controlId}
                          aria-label={label}
                          value={typeof value === "number" ? value : 0}
                          onChange={(next) => patch(stationId, current, name, next ?? 0)}
                        />
                      </label>
                    );
                  }
                  if (prop.type === "object") {
                    // vector3: render three InputNumber fields for x, y, z
                    const vec = value as { x: number; y: number; z: number } | undefined;
                    return (
                      <label key={name} htmlFor={controlId}>
                        {name}
                        <Space size={4} wrap>
                          <InputNumber
                            id={`${controlId}-x`}
                            aria-label={`${label}.x`}
                            value={vec?.x ?? 0}
                            step={0.01}
                            min={-10}
                            max={10}
                            style={{ width: 80 }}
                            onChange={(next) => patch(stationId, current, name, { ...vec, x: next ?? 0 })}
                          />
                          <InputNumber
                            id={`${controlId}-y`}
                            aria-label={`${label}.y`}
                            value={vec?.y ?? 0}
                            step={0.01}
                            min={-10}
                            max={10}
                            style={{ width: 80 }}
                            onChange={(next) => patch(stationId, current, name, { ...vec, y: next ?? 0 })}
                          />
                          <InputNumber
                            id={`${controlId}-z`}
                            aria-label={`${label}.z`}
                            value={vec?.z ?? 0}
                            step={0.01}
                            min={-10}
                            max={10}
                            style={{ width: 80 }}
                            onChange={(next) => patch(stationId, current, name, { ...vec, z: next ?? 0 })}
                          />
                        </Space>
                      </label>
                    );
                  }
                  return (
                    <label key={name} htmlFor={controlId}>
                      {name}
                      <Input
                        id={controlId}
                        aria-label={label}
                        value={typeof value === "string" ? value : String(value ?? "")}
                        onChange={(event) => patch(stationId, current, name, event.target.value)}
                      />
                    </label>
                  );
                })}
                <Button size="small" aria-label={`Apply ${stationId}`} onClick={() => apply(stationId, current)}>
                  Apply
                </Button>
                {errors[stationId] ? (
                  <Typography.Text type="danger" role="alert">
                    {errors[stationId]}
                  </Typography.Text>
                ) : null}
              </Space>
            </Card>
          );
        })}
      </Space>
    </fieldset>
  );

  function patch(
    stationId: ProductionStationId,
    current: Record<string, unknown>,
    name: string,
    value: unknown,
  ): void {
    setDrafts((draft) => ({ ...draft, [stationId]: { ...current, [name]: value } }));
  }

  function apply(stationId: ProductionStationId, next: Record<string, unknown>): void {
    const result = factoryStationSchemas[stationId]["~standard"].validate(next);
    // The spec discriminates on a FALSY `issues`, not on the key being present.
    if (result.issues !== undefined) {
      setErrors((current) => ({ ...current, [stationId]: result.issues.map((issue) => issue.message).join("; ") }));
      return;
    }
    setErrors((current) => ({ ...current, [stationId]: undefined }));
    onChange?.(stationId, result.value);
  }
}
