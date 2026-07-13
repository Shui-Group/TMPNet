import React from "react";
import { render, screen } from "@testing-library/react";
import Sidebar from "@/components/Sidebar";

const stats = {
  totalNodes: 200,
  totalEdges: 500,
  familyCounts: {
    "Other TMP": 2617,
    Transporter: 742,
    "Ion channel": 315,
    GPCR: 388,
    "Catalytic receptors": 216,
  },
  enrichedEdgeCount: 80,
  predictedEdgeCount: 120,
};

const meta = {
  totalNodes: 200,
  totalEdges: 500,
};

describe("Sidebar", () => {
  it("shows network summary data without filter controls or filtered edge stats", () => {
    render(<Sidebar stats={stats} meta={meta} />);

    expect(screen.getByText("Network Statistics")).toBeInTheDocument();
    expect(screen.queryByText("Network Controls")).not.toBeInTheDocument();
    expect(screen.queryByText("Edge Sources")).not.toBeInTheDocument();
    expect(screen.queryByText("Filtered edges")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Maximum edges")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Only edges among visible nodes")
    ).not.toBeInTheDocument();
    expect(screen.getByText("TMPNet nodes")).toBeInTheDocument();
    expect(screen.getByText("Additional nodes")).toBeInTheDocument();
    expect(screen.getByText("TMPNet edges")).toBeInTheDocument();
    expect(screen.getByText("Additional edges")).toBeInTheDocument();
    expect(screen.getByText("2,953")).toBeInTheDocument();
    expect(screen.getByText("1,320")).toBeInTheDocument();
    expect(screen.getByText("137,549")).toBeInTheDocument();
    expect(screen.getByText("45,430")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Additional edges represent physical protein–protein interactions retrieved from BioGRID, STRING, or HitPredict that are not included in TMPNet."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Total nodes")).not.toBeInTheDocument();
    expect(screen.queryByText("Total edges")).not.toBeInTheDocument();

    expect(
      screen.getAllByTestId("family-row").map((row) => row.textContent)
    ).toEqual([
      "GPCRs388",
      "Ion channels315",
      "Transporters742",
      "Catalytic receptors216",
      "Other TMPs2,617",
    ]);
  });
});
