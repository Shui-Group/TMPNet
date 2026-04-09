import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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

const mockFetch = jest.fn();

const createJsonResponse = (data: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  statusText: ok ? "OK" : "Internal Error",
  json: async () => data,
});

beforeEach(() => {
  mockFetch.mockReset();
  // @ts-expect-error override fetch for tests
  global.fetch = mockFetch;
});

describe("Home page", () => {
  it("renders fetched statistics in the hero", async () => {
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        totalNodes: 10,
        totalEdges: 20,
        familyCounts: {},
        enrichedEdgeCount: 5,
        predictedEdgeCount: 7,
      })
    );

    render(<Home />);

    expect(screen.getAllByText("---")).toHaveLength(3);

    await waitFor(() => {
      expect(screen.getByText("10")).toBeInTheDocument();
      expect(screen.getByText("20")).toBeInTheDocument();
      expect(screen.getByText("22")).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps placeholders when stats request fails", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse({}, false));

    render(<Home />);

    expect(await screen.findAllByText("---")).toHaveLength(3);
  });
});
