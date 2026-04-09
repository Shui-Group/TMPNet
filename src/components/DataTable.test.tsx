import { render, screen } from "@testing-library/react";
import DataTable from "./DataTable";

describe("DataTable", () => {
  it("renders column-level custom cells while keeping the raw value in data", () => {
    render(
      <DataTable
        caption="Edge Information"
        columns={[
          { key: "edge", label: "Edge" },
          {
            key: "structureStatus",
            label: "Structure",
            render: (row) =>
              row.structureModelId ? (
                <a href={`/structures/${row.structureModelId}`}>View model</a>
              ) : (
                <span>-</span>
              ),
          },
        ]}
        data={[
          {
            edge: "P12345_Q67890",
            structureStatus: "Available",
            structureModelId: "p12345-q67890",
          },
        ]}
      />
    );

    expect(screen.getByText("P12345_Q67890")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View model" })
    ).toHaveAttribute("href", "/structures/p12345-q67890");
  });
});
