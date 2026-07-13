import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import SubgraphPage from "@/pages/subgraph";

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
jest.mock(
  "@/components/DataTable",
  () =>
    ({ caption, data }: { caption: string; data: any[] }) =>
      <div data-testid={caption}>{data.length}</div>
);

const pushMock = jest.fn();
let queryState: Record<string, unknown> = {};

jest.mock("next/router", () => ({
  useRouter: () => ({
    isReady: true,
    push: pushMock,
    query: queryState,
  }),
}));

const mockFetch = jest.fn();

const createJsonResponse = (data: unknown, ok = true, status = 200) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Error",
  json: async () => data,
});

beforeEach(() => {
  queryState = {};
  mockFetch.mockReset();
  // @ts-expect-error override fetch for tests
  global.fetch = mockFetch;
});

describe("Subgraph page", () => {
  it("renders missing parameter message when proteins query is absent", () => {
    render(<SubgraphPage />);
    expect(screen.getByText(/Missing Parameter/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("loads subgraph data and renders tables", async () => {
    queryState = { proteins: "P12345" };
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        query: ["P12345"],
        nodes: [
          {
            id: "P12345",
            label: "PROT1",
            description: "Query node",
            geneSymbol: "GENE1",
            family: "TM",
            expressionTissue: ["Brain"],
            isQuery: true,
          },
        ],
        edges: [
          {
            id: "E1",
            source: "P12345",
            target: "Q67890",
            fusionPredProb: 0.9,
            enrichedTissue: "Brain",
            tissueEnrichedConfidence: "high",
            positiveType: "prediction",
          },
        ],
      })
    );

    render(<SubgraphPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Sub-network centered on P12345")
      ).toBeInTheDocument();
      expect(screen.getByTestId("Protein Information")).toHaveTextContent("1");
      expect(screen.getByTestId("Association Information")).toHaveTextContent(
        "1"
      );
      expect(screen.getByText("Additional + TMPNet")).toBeInTheDocument();
      expect(
        screen.queryByText("Reported + TMPNet predicted")
      ).not.toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/subgraph?proteins=P12345");
  });
});
