import { createMocks } from "node-mocks-http";
import handler from "./[modelId]";
import { supabase } from "@/lib/supabase";

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const fromMock = supabase.from as jest.Mock;

const structureRow = {
  model_id: "o15303-o00222",
  edge: "O00222_O15303",
  protein1: "O00222",
  protein2: "O15303",
  folder_protein1: "O15303",
  folder_protein2: "O00222",
  variant: "plain",
  source: "alphafold3",
  cif_rel_path:
    "data/raw/20260407_new_web_data/best_structure/o15303-o00222/o15303-o00222.cif",
  cif_size_bytes: 1145190,
  summary_confidences_rel_path:
    "data/raw/20260407_new_web_data/best_structure/o15303-o00222/summary_confidences.json",
  summary_confidences: {
    iptm: 0.59,
    ptm: 0.64,
    ranking_score: 0.65,
    fraction_disordered: 0.1,
    has_clash: 0,
  },
  summary_iptm: 0.59,
  summary_ptm: 0.64,
  summary_ranking_score: 0.65,
  summary_fraction_disordered: 0.1,
  summary_has_clash: false,
  confidences_rel_path:
    "data/raw/20260407_new_web_data/best_structure/o15303-o00222/confidences.json",
  confidences_size_bytes: 1000,
  has_confidences: true,
};

const edgeRow = {
  edge: "O00222_O15303",
  protein1: "O00222",
  protein2: "O15303",
  fusion_pred_prob: 0.91,
  enriched_tissue: "Brain",
  tissue_enriched_confidence: "high confidence",
  positive_type: "prediction",
  gene_symbol1: "KCNK5",
  gene_symbol2: "GALR1",
  string_combined_score: 812,
  biogrid_experimental_system_type: "Two-hybrid",
  hitpredict_confidence: "High",
};

const nodeRows = [
  {
    protein: "O00222",
    entry_name: "KCNK5_HUMAN",
    description: "Potassium channel",
    family: "Ion-channels",
    expression_tissue: "Brain\\Lung",
    gene_symbol: "KCNK5",
  },
  {
    protein: "O15303",
    entry_name: "GALR1_HUMAN",
    description: "Galanin receptor 1",
    family: "GPCR",
    expression_tissue: "Brain",
    gene_symbol: "GALR1",
  },
];

describe("/api/structures/[modelId]", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns a structure model with edge and protein summaries", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "structure_models") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() =>
                Promise.resolve({ data: structureRow, error: null })
              ),
            })),
          })),
        };
      }

      if (table === "edges") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() =>
                Promise.resolve({ data: edgeRow, error: null })
              ),
            })),
          })),
        };
      }

      if (table === "nodes") {
        return {
          select: jest.fn(() => ({
            in: jest.fn(() =>
              Promise.resolve({ data: nodeRows, error: null })
            ),
          })),
        };
      }

      return { select: jest.fn() };
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { modelId: "O15303-O00222" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());

    expect(payload.model.modelId).toBe("o15303-o00222");
    expect(payload.model.variant).toBe("plain");
    expect(payload.edge.id).toBe("O00222_O15303");
    expect(payload.edge.stringCombinedScore).toBe(812);
    expect(payload.proteins).toHaveLength(2);
    expect(payload.proteins[0].id).toBe("O00222");
    expect(payload.assets.cif).toContain(
      "/api/structures/o15303-o00222/asset?kind=cif"
    );
    expect(payload.confidenceSummary).toMatchObject({
      atomCount: expect.any(Number),
      residueCount: expect.any(Number),
      plddtBins: {
        veryHigh: expect.any(Number),
        confident: expect.any(Number),
        low: expect.any(Number),
        veryLow: expect.any(Number),
      },
    });
  });

  it("returns 404 when the model is not present", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "structure_models") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() =>
                Promise.resolve({ data: null, error: null })
              ),
            })),
          })),
        };
      }

      return { select: jest.fn() };
    });

    const { req, res } = createMocks({
      method: "GET",
      query: { modelId: "missing-model" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData()).error).toBe("Structure model not found");
  });

  it("rejects non-GET methods", async () => {
    const { req, res } = createMocks({
      method: "POST",
      query: { modelId: "o15303-o00222" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
  });
});
