import {
  formatNetworkStatistic,
  networkStatisticsContent,
} from "@/lib/networkStatisticsContent";

describe("networkStatisticsContent", () => {
  it("uses null placeholders until reviewed counts are supplied", () => {
    expect(networkStatisticsContent).toEqual({
      tmpnetNodes: null,
      additionalNodes: null,
      tmpnetPairs: null,
      additionalPairs: null,
      description: null,
    });
  });

  it("formats supplied counts and renders pending counts as an em dash", () => {
    expect(formatNetworkStatistic(137510)).toBe("137,510");
    expect(formatNetworkStatistic(null)).toBe("—");
  });
});
