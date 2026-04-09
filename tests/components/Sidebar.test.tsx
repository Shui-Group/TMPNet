import React from "react";
import { render, screen } from "@testing-library/react";
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
  it("shows network summary data without filter controls", () => {
    render(
      <Sidebar
        stats={stats}
        meta={meta}
      />
    );

    expect(screen.getByText("Network Statistics")).toBeInTheDocument();
    expect(screen.queryByText("Network Controls")).not.toBeInTheDocument();
    expect(screen.queryByText("Edge Sources")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Maximum edges")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Only edges among visible nodes")
    ).not.toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });
});
