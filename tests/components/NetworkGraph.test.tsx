import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import NetworkGraph from "@/components/NetworkGraph";

jest.mock("cytoscape-fcose", () => ({}));

const connectedEdgesMock = { style: jest.fn() };

const createCoreMock = () => {
  const core = {
    on: jest.fn(),
    off: jest.fn(),
    destroy: jest.fn(),
    elements: jest.fn(() => ({ remove: jest.fn() })),
    add: jest.fn(),
    layout: jest.fn(() => ({ one: jest.fn(), run: jest.fn() })),
    startBatch: jest.fn(),
    endBatch: jest.fn(),
    batch: jest.fn((fn?: () => void) => {
      if (fn) fn();
    }),
    nodes: jest.fn(() => ({
      length: 0,
      style: jest.fn(),
      connectedEdges: jest.fn(() => connectedEdgesMock),
      map: jest.fn(() => []),
    })),
    resize: jest.fn(),
    fit: jest.fn(),
    $: jest.fn(() => ({ unselect: jest.fn() })),
    autolock: jest.fn(),
    autoungrabify: jest.fn(),
  };

  return core;
};

const cytoscapeMock = jest.fn(() => {
  const core = createCoreMock();
  cytoscapeMock.__core = core;
  return core;
});

cytoscapeMock.use = jest.fn();

jest.mock("cytoscape", () => ({
  __esModule: true,
  default: cytoscapeMock,
}));

const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return {
        width: 600,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 600,
      };
    },
  });
});

afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

beforeEach(() => {
  jest.clearAllMocks();
});

const baseNode = {
  data: {
    id: "P12345",
    label: "PROT_HUMAN",
    family: "TF",
    color: "#123456",
    isQuery: true,
    geneNames: "GENE1",
    expressionTissue: ["Brain"],
  },
};

describe("NetworkGraph component", () => {
  it("renders loading overlay with spinner when isLoading is true", async () => {
    render(
      <NetworkGraph
        elements={[]}
        isLoading
        progress={{ nodesLoaded: false, edgesLoaded: 10, edgesTotal: 100 }}
      />
    );

    await waitFor(() => expect(cytoscapeMock).toHaveBeenCalled());
    expect(screen.getByText("Loading network data...")).toBeInTheDocument();
    expect(screen.getByText(/Edges:/)).toHaveTextContent("Edges: 10 / 100");
  });

  it("displays tooltip when node hover event is emitted", async () => {
    render(<NetworkGraph elements={[baseNode]} />);

    await waitFor(() => expect(cytoscapeMock).toHaveBeenCalled());

    const core = cytoscapeMock.__core as
      | ReturnType<typeof createCoreMock>
      | undefined;
    expect(core).toBeDefined();
    const hoverCall = core?.on.mock.calls.find(
      (call) => call[0] === "mouseover"
    );
    expect(hoverCall).toBeDefined();

    const hoverHandler = hoverCall?.[2];
    expect(typeof hoverHandler).toBe("function");

    await act(async () => {
      hoverHandler?.({
        target: {
          isNode: () => true,
          renderedPosition: () => ({ x: 120, y: 80 }),
          data: () => baseNode.data,
        },
      });
    });

    expect(screen.getByText("PROT_HUMAN")).toBeInTheDocument();
    const genesLabel = screen.getByText(/Genes:/);
    expect(genesLabel.parentElement).toHaveTextContent("Genes: GENE1");
    expect(screen.getByText(/Family:/).parentElement).toHaveTextContent(
      "Family: TF"
    );
  });
});
