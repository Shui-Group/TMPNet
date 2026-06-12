import {
  coseLayout,
  fcoseLayout,
  largeGraphThreshold,
  rendererOptions,
} from "@/lib/cytoscape-config";

describe("cytoscape-config", () => {
  it("exposes canvas renderer with bounded pixel ratio", () => {
    expect(rendererOptions?.name).toBe("canvas");
    expect(typeof rendererOptions?.pixelRatio).toBe("number");
    expect((rendererOptions?.pixelRatio ?? 0) > 0).toBe(true);
  });

  it("configures fcose layout for stable proof iterations", () => {
    expect(fcoseLayout.name).toBe("fcose");
    expect(fcoseLayout.quality).toBe("proof");
    expect(fcoseLayout.numIter).toBeGreaterThan(0);
  });

  it("configures cose layout as fallback", () => {
    expect(coseLayout.name).toBe("cose");
    expect(coseLayout.animate).toBe(false);
    expect(coseLayout.padding).toBeGreaterThan(0);
  });

  it("defines a large graph threshold for performance tuning", () => {
    expect(largeGraphThreshold).toBeGreaterThan(0);
  });
});
