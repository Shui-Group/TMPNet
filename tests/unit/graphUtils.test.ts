import {
  buildNodeDegreeMap,
  edgeColors,
  getEdgeVisualWeight,
  familyColorMap,
  getEdgeColor,
  getFamilyColor,
  getNodeSize,
  nodesToCy,
  edgesToCy,
  toCytoscapeElements,
} from "@/lib/graphUtils";
import type { EdgeResponse, NodeResponse } from "@/lib/types";

describe("graphUtils", () => {
  describe("buildNodeDegreeMap and getNodeSize", () => {
    it("builds degrees from edge connectivity and scales node size conservatively", () => {
      const edges: EdgeResponse[] = [
        {
          id: "E1",
          source: "A",
          target: "B",
          fusionPredProb: 0.4,
          enrichedTissue: null,
          tissueEnrichedConfidence: null,
          positiveType: "prediction",
        },
        {
          id: "E2",
          source: "A",
          target: "C",
          fusionPredProb: 0.8,
          enrichedTissue: null,
          tissueEnrichedConfidence: null,
          positiveType: "experiment",
        },
      ];

      const degreeMap = buildNodeDegreeMap(edges);

      expect(degreeMap).toEqual({ A: 2, B: 1, C: 1 });
      expect(getNodeSize(0)).toBe(9);
      expect(getNodeSize(25)).toBeLessThanOrEqual(18);
      expect(getNodeSize(9, { isQuery: true })).toBeGreaterThan(getNodeSize(9));
    });
  });

  describe("getFamilyColor", () => {
    it("returns mapped color for known family", () => {
      expect(getFamilyColor("GPCR")).toBe(familyColorMap.GPCR);
    });

    it("falls back to Other for unknown family", () => {
      expect(getFamilyColor("Unknown")).toBe(familyColorMap.Other);
      expect(getFamilyColor(undefined)).toBe(familyColorMap.Other);
    });
  });

  describe("getEdgeColor", () => {
    const baseEdge: EdgeResponse = {
      id: "E1",
      source: "A",
      target: "B",
      fusionPredProb: 0.5,
      enrichedTissue: null,
      tissueEnrichedConfidence: null,
      positiveType: "prediction",
    };

    it("uses experimental color when positiveType contains experiment", () => {
      expect(getEdgeColor({ ...baseEdge, positiveType: "experiment" })).toBe(
        edgeColors.experimental
      );
      expect(
        getEdgeColor({ ...baseEdge, positiveType: "prediction & experiment" })
      ).toBe(edgeColors.experimental);
    });

    it("uses predicted color by default", () => {
      expect(getEdgeColor(baseEdge)).toBe(edgeColors.predicted);
    });

    it("derives lighter visual weight for predicted edges than experimental ones", () => {
      const predictedWeight = getEdgeVisualWeight(baseEdge);
      const experimentalWeight = getEdgeVisualWeight({
        ...baseEdge,
        positiveType: "experiment",
        fusionPredProb: 0.8,
      });

      expect(predictedWeight.width).toBeLessThan(experimentalWeight.width);
      expect(predictedWeight.opacity).toBeLessThan(experimentalWeight.opacity);
      expect(predictedWeight.layoutPriority).toBeLessThan(
        experimentalWeight.layoutPriority
      );
    });
  });

  describe("nodesToCy", () => {
    const node: NodeResponse = {
      id: "P12345",
      label: "PROT_HUMAN",
      description: "Protein description",
      geneSymbol: "GENE1",
      family: "GPCR",
      expressionTissue: ["Brain", "Liver"],
      isQuery: true,
    };

    it("maps node fields and computed styling", () => {
      const [nodeElement] = nodesToCy([node], false, { P12345: 16 });
      expect(nodeElement.data).toMatchObject({
        id: "P12345",
        label: "GENE1",
        color: "#1E3A8A",
        isQuery: true,
        geneSymbol: "GENE1",
        expressionTissue: ["Brain", "Liver"],
        degree: 16,
      });
      expect(nodeElement.data?.size).toBeGreaterThan(18);
      expect(typeof nodeElement.data?.tooltip).toBe("string");
      expect(nodeElement.data?.tooltip).toContain("PROT_HUMAN");
    });

    it("applies family color for non-query nodes", () => {
      const [nodeElement] = nodesToCy([{ ...node, isQuery: false }]);
      expect(nodeElement.data?.color).toBe(getFamilyColor(node.family));
    });
  });

  describe("edgesToCy and toCytoscapeElements", () => {
    const node: NodeResponse = {
      id: "P12345",
      label: "PROT_HUMAN",
      description: "Protein description",
      geneSymbol: "GENE1",
      family: "GPCR",
      expressionTissue: ["Brain"],
    };

    const edge: EdgeResponse = {
      id: "P12345_Q67890",
      source: "P12345",
      target: "Q67890",
      fusionPredProb: 0.9,
      enrichedTissue: "Brain",
      tissueEnrichedConfidence: "high confidence",
      positiveType: "prediction",
    };

    it("maps edge fields with color", () => {
      const [edgeElement] = edgesToCy([edge]);
      expect(edgeElement.data).toMatchObject({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        color: edgeColors.predicted,
      });
      expect(edgeElement.data?.width).toBeGreaterThan(0.35);
      expect(edgeElement.data?.opacity).toBeGreaterThan(0.08);
      expect(edgeElement.data?.layoutPriority).toBeGreaterThan(0);
    });

    it("combines nodes and edges in toCytoscapeElements", () => {
      const elements = toCytoscapeElements({ nodes: [node], edges: [edge] });
      expect(elements).toHaveLength(2);
      const ids = elements.map((el) => el.data?.id).sort();
      expect(ids).toEqual([edge.id, node.id].sort());
      const nodeElement = elements.find((el) => el.data?.id === node.id);
      expect(nodeElement?.data?.size).toBeGreaterThan(9);
    });
  });
});
