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
    ({
      caption,
      data,
      columns,
      exportData,
    }: {
      caption: string;
      data: Array<Record<string, unknown>>;
      columns: Array<{ label: string }>;
      exportData: Array<Record<string, unknown>>;
    }) =>
      (
        <div data-testid={caption}>
          <span>{data.length}</span>
          {columns.map((column) => (
            <span key={column.label}>{column.label}</span>
          ))}
          <span data-testid={`${caption}-display`}>
            {data.map((row) => (
              <span key={String(row.id)}>{Object.values(row).join("|")}</span>
            ))}
          </span>
          <span data-testid={`${caption}-export`}>
            {JSON.stringify(exportData)}
          </span>
        </div>
      )
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

const singleQueryData = {
  query: ["P12345"],
  queryProteins: [
    {
      searchedTerm: "P12345",
      proteinId: "P12345",
      geneSymbol: "GENE1",
      entryName: "PROT1_HUMAN",
      description: "Query node",
      wasGeneSymbolSearch: false,
    },
  ],
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
};

describe("Subgraph page", () => {
  it("renders missing parameter message when proteins query is absent", () => {
    render(<SubgraphPage />);
    expect(screen.getByText(/Missing Parameter/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("loads subgraph data and renders tables", async () => {
    queryState = { proteins: "P12345" };
    mockFetch.mockResolvedValueOnce(createJsonResponse(singleQueryData));

    render(<SubgraphPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Sub-network centered on GENE1 (P12345)")
      ).toBeInTheDocument();
      expect(screen.getByTestId("TMP Information")).toHaveTextContent("1");
      expect(screen.getByTestId("Association Information")).toHaveTextContent(
        "1"
      );
    });

    expect(
      screen.getByText("Retrieved TMP associations for a single query protein")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The query protein is positioned at the center and connected to associated TMPs, which are grouped by protein family."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Associated TMPs")).toBeInTheDocument();
    expect(screen.queryByText(/1-hop/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rapid/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Query Inputs")).not.toBeInTheDocument();
    expect(screen.getByText("Related tables")).toBeInTheDocument();
    expect(screen.getByTestId("TMP Information")).toHaveTextContent("1");
    expect(screen.getByText("Protein Symbol")).toBeInTheDocument();
    expect(screen.getByText("Tissues of expression")).toBeInTheDocument();
    expect(screen.queryByText("Reference Tables")).not.toBeInTheDocument();
    expect(screen.queryByText("Tables and export")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Tables for manual review/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Use the built-in filters/i)
    ).not.toBeInTheDocument();

    expect(mockFetch).toHaveBeenCalledWith("/api/subgraph?proteins=P12345");
  });

  it("maps raw evidence to display-only association sources", async () => {
    queryState = { proteins: "P12345" };
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        ...singleQueryData,
        edges: [
          singleQueryData.edges[0],
          {
            ...singleQueryData.edges[0],
            id: "E2",
            positiveType: "experiment/prediction",
          },
        ],
      })
    );

    render(<SubgraphPage />);

    await waitFor(() => {
      expect(screen.getByText("Association source")).toBeInTheDocument();
    });

    const displayRows = screen.getByTestId("Association Information-display");
    expect(displayRows).toHaveTextContent("TMPNet");
    expect(displayRows).toHaveTextContent("Additional");
    expect(displayRows).not.toHaveTextContent("experiment/prediction");
    expect(
      screen.getByTestId("Association Information-export")
    ).toHaveTextContent('"positive_type":"prediction"');
    expect(
      screen.getByTestId("Association Information-export")
    ).toHaveTextContent('"positive_type":"experiment/prediction"');
  });

  it("renders the multiple-query title without the TMP count card", async () => {
    queryState = { proteins: "P12345,Q67890" };
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        ...singleQueryData,
        query: ["P12345", "Q67890"],
        queryProteins: [
          singleQueryData.queryProteins[0],
          {
            searchedTerm: "Q67890",
            proteinId: "Q67890",
            geneSymbol: "GENE2",
            entryName: "PROT2_HUMAN",
            description: "Second query node",
            wasGeneSymbolSearch: false,
          },
        ],
        nodes: [
          ...singleQueryData.nodes,
          {
            id: "Q67890",
            label: "PROT2",
            description: "Second query node",
            geneSymbol: "GENE2",
            family: "TM(GPCR)",
            expressionTissue: ["Liver"],
            isQuery: true,
          },
        ],
      })
    );

    render(<SubgraphPage />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Retrieved associations between two or more query proteins"
        )
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Associated TMPs")).not.toBeInTheDocument();
    expect(screen.queryByText(/^TMPs$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1-hop/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rapid/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Query Inputs")).not.toBeInTheDocument();
  });
});
