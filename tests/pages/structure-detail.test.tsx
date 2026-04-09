import { render, screen, waitFor } from "@testing-library/react";
import StructureDetailPage from "@/pages/structures/[modelId]";

jest.mock("next/router", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/components/StructureViewer", () => {
  return function MockStructureViewer() {
    return <div data-testid="structure-viewer">viewer</div>;
  };
});

const { useRouter } = jest.requireMock("next/router") as {
  useRouter: jest.Mock;
};

const structureResponse = {
  model: {
    modelId: "o15303-o00222",
    edge: "O00222_O15303",
    protein1: "O00222",
    protein2: "O15303",
    folderProtein1: "O15303",
    folderProtein2: "O00222",
    variant: "plain",
    source: "alphafold3",
    cifPath: "data/raw/20260407_new_web_data/best_structure/o15303-o00222/o15303-o00222.cif",
    cifSizeBytes: 1145190,
    summaryConfidencesPath:
      "data/raw/20260407_new_web_data/best_structure/o15303-o00222/summary_confidences.json",
    summaryConfidences: { iptm: 0.59, ptm: 0.64, ranking_score: 0.65 },
    summaryIptm: 0.59,
    summaryPtm: 0.64,
    summaryRankingScore: 0.65,
    summaryFractionDisordered: 0.1,
    summaryHasClash: false,
    confidencesPath:
      "data/raw/20260407_new_web_data/best_structure/o15303-o00222/confidences.json",
    confidencesSizeBytes: 28339119,
    hasConfidences: true,
  },
  edge: {
    id: "O00222_O15303",
    source: "O00222",
    target: "O15303",
    fusionPredProb: 0.91,
    enrichedTissue: "Brain",
    tissueEnrichedConfidence: "high confidence",
    positiveType: "prediction",
    geneSymbol1: "GRM8",
    geneSymbol2: "GRM6",
    stringCombinedScore: 812,
    biogridExperimentalSystemType: "Two-hybrid",
    hitpredictConfidence: "High",
  },
  proteins: [
    {
      id: "O00222",
      label: "GRM8_HUMAN",
      entryName: "GRM8_HUMAN",
      description: "Metabotropic glutamate receptor 8",
      geneSymbol: "GRM8",
      family: "GPCR",
      expressionTissue: ["Brain", "Kidney"],
    },
    {
      id: "O15303",
      label: "GRM6_HUMAN",
      entryName: "GRM6_HUMAN",
      description: "Metabotropic glutamate receptor 6",
      geneSymbol: "GRM6",
      family: "GPCR",
      expressionTissue: ["Brain"],
    },
  ],
  assets: {
    cif: "/api/structures/o15303-o00222/asset?kind=cif",
    summary: "/api/structures/o15303-o00222/asset?kind=summary",
    confidences: "/api/structures/o15303-o00222/asset?kind=confidences",
  },
  confidenceSummary: {
    atomCount: 13847,
    residueCount: 1785,
    meanPlddt: 68.5,
    minPlddt: 21.43,
    maxPlddt: 97.8,
    plddtBins: {
      veryHigh: 3200,
      confident: 5100,
      low: 2300,
      veryLow: 3247,
    },
    chains: [
      { chainId: "A", atomCount: 7000, meanPlddt: 71.2 },
      { chainId: "B", atomCount: 6847, meanPlddt: 65.8 },
    ],
  },
};

describe("StructureDetailPage", () => {
  beforeEach(() => {
    useRouter.mockReturnValue({
      query: { modelId: "o15303-o00222" },
      isReady: true,
    });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders key metadata after loading the structure detail payload", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => structureResponse,
    });

    render(<StructureDetailPage />);

    expect(screen.getByText("Loading structure model...")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("GRM8 / GRM6 structure model")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("AlphaFold3 interaction model")).toBeInTheDocument();
    expect(screen.getByTestId("structure-viewer")).toBeInTheDocument();
    expect(screen.getByText("812")).toBeInTheDocument();
    expect(screen.getByText("13,847")).toBeInTheDocument();
  });

  it("renders a not-found state when the API returns 404", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
    });

    render(<StructureDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Structure unavailable")).toBeInTheDocument();
    });

    expect(screen.getByText("Structure model not found.")).toBeInTheDocument();
  });

  it("links the back control to the network explorer", () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => structureResponse,
    });

    render(<StructureDetailPage />);

    expect(
      screen.getByRole("link", { name: "Back to network" })
    ).toHaveAttribute("href", "/network");
  });
});
