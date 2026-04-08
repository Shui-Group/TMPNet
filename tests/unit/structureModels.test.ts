import { parseStructureModelId } from "@/lib/structureModels";

describe("parseStructureModelId", () => {
  it("parses a plain interaction model id", () => {
    expect(parseStructureModelId("o15303-o00222")).toEqual({
      modelId: "o15303-o00222",
      folderProtein1: "O15303",
      folderProtein2: "O00222",
      proteinPairKey: "O00222::O15303",
      variant: "plain",
    });
  });

  it("parses suffixed interaction model ids", () => {
    expect(parseStructureModelId("p43116-p25106_without_ag")).toEqual({
      modelId: "p43116-p25106_without_ag",
      folderProtein1: "P43116",
      folderProtein2: "P25106",
      proteinPairKey: "P25106::P43116",
      variant: "without_ag",
    });

    expect(parseStructureModelId("q14330-p46094_optimize")).toEqual({
      modelId: "q14330-p46094_optimize",
      folderProtein1: "Q14330",
      folderProtein2: "P46094",
      proteinPairKey: "P46094::Q14330",
      variant: "optimize",
    });
  });

  it("returns null for invalid model ids", () => {
    expect(parseStructureModelId("bad-model-name-extra-part")).toBeNull();
    expect(parseStructureModelId("")).toBeNull();
  });
});
