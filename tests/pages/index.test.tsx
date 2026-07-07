import React from "react";
import { render, screen } from "@testing-library/react";
import Home from "@/pages/index";

jest.mock("@/components/Header", () => () => (
  <div data-testid="header">Header</div>
));
jest.mock("@/components/Legend", () => () => (
  <div data-testid="legend">Legend</div>
));
jest.mock("@/components/SearchBar", () => () => (
  <div data-testid="search">Search</div>
));
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
        "Endogenous transmembrane (TMP) protein interaction network"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("TMPs")).toBeInTheDocument();
    expect(screen.getByText("2,953")).toBeInTheDocument();
    expect(screen.getByText("ASSOCIATIONS")).toBeInTheDocument();
    expect(screen.getByText("137,510")).toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.getByText(/multiple TMPs/)).toBeInTheDocument();
    expect(screen.getByText("Contact")).toBeInTheDocument();
  });
});
