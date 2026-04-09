import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import Sidebar from "@/components/Sidebar";

const stats = {
  totalNodes: 200,
  totalEdges: 500,
  familyCounts: { TM: 100, TF: 50 },
  enrichedEdgeCount: 80,
  predictedEdgeCount: 120,
};

const meta = {
  totalNodes: 200,
  totalEdges: 500,
  filteredEdges: 120,
};

describe("Sidebar", () => {
  it("toggles positive type filters and calls onChange", () => {
    const onChange = jest.fn();
    render(
      <Sidebar
        stats={stats}
        meta={meta}
        filters={{
          positiveTypes: ["experiment"],
          maxEdges: 50000,
          onlyVisibleEdges: false,
        }}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText("Predicted"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        positiveTypes: expect.arrayContaining(["experiment", "prediction"]),
      })
    );
  });

  it("updates maxEdges via slider input", () => {
    const onChange = jest.fn();
    render(
      <Sidebar
        stats={stats}
        meta={meta}
        filters={{
          positiveTypes: ["experiment"],
          maxEdges: 50000,
          onlyVisibleEdges: false,
        }}
        onChange={onChange}
      />
    );

    const slider = screen.getByLabelText("Maximum edges") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "20000" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ maxEdges: 500 })
    );
  });

  it("toggles onlyVisibleEdges checkbox", () => {
    const onChange = jest.fn();
    render(
      <Sidebar
        stats={stats}
        meta={meta}
        filters={{
          positiveTypes: ["experiment"],
          maxEdges: 50000,
          onlyVisibleEdges: false,
        }}
        onChange={onChange}
      />
    );

    const checkbox = screen.getByLabelText("Only edges among visible nodes");
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ onlyVisibleEdges: true })
    );
  });
});
