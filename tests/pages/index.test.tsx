import React from "react";
import { render, screen } from "@testing-library/react";
import Home from "@/pages/index";

jest.mock("@/components/Header", () => () => (
  <div data-testid="header">Header</div>
));
jest.mock("@/components/Legend", () => () => (
  <div data-testid="legend">Legend</div>
));
jest.mock(
  "@/components/SearchBar",
  () =>
    ({ placeholder }: { placeholder?: string }) =>
      (
        <div data-testid="search" data-placeholder={placeholder}>
          Search
        </div>
      )
);
jest.mock("@/components/NetworkGraph", () => () => (
  <div data-testid="network-graph">Graph</div>
));
jest.mock("@/components/Sidebar", () => ({ stats }: { stats: any }) => (
  <div data-testid="sidebar">Sidebar {stats.totalNodes}</div>
));

describe("Home page", () => {
  it("renders the required TMPNet hero content", () => {
    render(<Home />);

    expect(
      screen.getByText(
        "TMPNet: A tissue-wide transmembrane protein interaction network"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("TMPs")).toBeInTheDocument();
    expect(screen.getByText("2,953")).toBeInTheDocument();
    expect(screen.getByText("ASSOCIATIONS")).toBeInTheDocument();
    expect(screen.getByText("137,549")).toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.getByText(/multiple TMPs/)).toBeInTheDocument();
    expect(screen.getByText("Examples:")).toBeInTheDocument();
    expect(screen.getByText("Contact")).toBeInTheDocument();
    expect(screen.getByText("E-mail: waters1215@163.com")).toBeInTheDocument();
    expect(screen.getByTestId("search")).toHaveAttribute(
      "data-placeholder",
      "Search by UniProt ID (e.g., P43220, P00533) or Protein Symbol (e.g., EGFR, INSR)"
    );
    expect(screen.getByText("Protein Symbol")).toBeInTheDocument();
    expect(screen.getByText(/separate protein symbols/i)).toBeInTheDocument();
    expect(screen.queryByText("Gene Symbol")).not.toBeInTheDocument();
    expect(screen.getByTestId("hero-background")).toHaveClass("opacity-70");
  });
});
