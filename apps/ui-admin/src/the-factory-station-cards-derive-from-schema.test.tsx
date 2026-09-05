import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStationSchemas } from "@openclinxr/shared-schemas";
import { FactoryStationCards } from "@openclinxr/ui-shared/admin-factory-station-cards";
import { installWorldviewQueueTestDom } from "./worldview-queue-test-dom.js";

installWorldviewQueueTestDom();

/**
 * OBSERVABLE: admin worldview has no factory-station cards derived from
 * station interface schema. Hand lists drift from the spec.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (schema-derived factory station cards)
 */

describe("the factory station cards derive from schema", () => {
  afterEach(() => {
    cleanup();
  });

  it("(1) production stations render as cards with a control per jsonSchema property including schema-only fields", () => {
    render(<FactoryStationCards />);
    expect(screen.getByRole("group", { name: "Factory station cards" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/instrument station card/i)).not.toBeInTheDocument();
    const room = factoryStationSchemas.room_generate.jsonSchema.input({ target: "draft-2020-12" });
    for (const key of Object.keys(room.properties)) {
      expect(screen.getByLabelText(`room_generate.${key}`)).toBeInTheDocument();
    }
    const equip = factoryStationSchemas.equipment_generate.jsonSchema.input({ target: "draft-2020-12" });
    for (const key of Object.keys(equip.properties)) {
      expect(screen.getByLabelText(`equipment_generate.${key}`)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("equipment_generate.decimationTarget")).toBeInTheDocument();
    expect(screen.getByLabelText("room_generate.layoutVariant")).toBeInTheDocument();
  });

  it("(2) Apply rejects schema-invalid values and accepts a valid equipment_generate payload", () => {
    const accepted: Array<Record<string, unknown>> = [];
    render(<FactoryStationCards onChange={(_id, value) => accepted.push(value)} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply equipment_generate" }));
    expect(screen.getByRole("alert").textContent?.length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("equipment_generate.subjectId"), { target: { value: "ecg-cart-imagine-box" } });
    fireEvent.change(screen.getByLabelText("equipment_generate.packId"), { target: { value: "ecg-cart-imagine-box" } });
    fireEvent.change(screen.getByLabelText("equipment_generate.seed"), { target: { value: 7 } });
    fireEvent.click(screen.getByLabelText("equipment_generate.remesh"));
    fireEvent.change(screen.getByLabelText("equipment_generate.viewCount"), { target: { value: 4 } });
    fireEvent.change(screen.getByLabelText("equipment_generate.decimationTarget"), { target: { value: 1000000 } });
    fireEvent.click(screen.getByRole("button", { name: "Apply equipment_generate" }));
    expect(accepted.length).toBe(1);
    expect(accepted[0]?.["subjectId"]).toBe("ecg-cart-imagine-box");
    expect(accepted[0]?.["viewCount"]).toBe(4);
  });
});

// NOT TESTED: live TRELLIS GPU bake; Quest.
