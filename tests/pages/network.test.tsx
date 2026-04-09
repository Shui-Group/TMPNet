import React from "react";
import { render, waitFor } from "@testing-library/react";
import NetworkPage from "@/pages/network";

jest.mock("@/components/Header", () => {
  function MockHeader() {
    return <div data-testid="header">Header</div>;
  }

  return MockHeader;
});
jest.mock("@/components/Legend", () => {
  function MockLegend() {
    return <div data-testid="legend">Legend</div>;
  }

  return MockLegend;
});
jest.mock("@/components/NetworkGraph", () => {
  function MockNetworkGraph() {
    return <div data-testid="network-graph">Graph</div>;
  }

  return MockNetworkGraph;
});
jest.mock("@/components/Sidebar", () => {
  function MockSidebar() {
    return <div data-testid="sidebar">Sidebar</div>;
  }

  return MockSidebar;
});

const mockFetch = jest.fn();

const createJsonResponse = (data: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  statusText: ok ? "OK" : "Internal Error",
  json: async () => data,
});

beforeEach(() => {
  mockFetch.mockReset();
  // @ts-expect-error test override
  global.fetch = mockFetch;
});

describe("Network page", () => {
  it("requests the full total network without client-side filter query params", async () => {
    mockFetch
      .mockResolvedValueOnce(
        createJsonResponse({
          totalNodes: 10,
          totalEdges: 20,
          familyCounts: {},
          enrichedEdgeCount: 5,
          predictedEdgeCount: 7,
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          nodes: [],
          edges: [],
          meta: {
            totalNodes: 10,
            totalEdges: 20,
            filteredEdges: 20,
          },
        })
      );

    render(<NetworkPage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/network/stats");
      expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/network");
    });
  });
});
