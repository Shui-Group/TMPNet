import {
  formatNetworkStatistic,
  networkStatisticsContent,
} from "@/lib/networkStatisticsContent";

describe("networkStatisticsContent", () => {
  it("uses the reviewed network statistics and explanatory copy", () => {
    expect(networkStatisticsContent).toEqual({
      tmpnetNodes: 2953,
      additionalNodes: 1320,
      tmpnetEdges: 137549,
      additionalEdges: 45430,
      description:
        "Additional edges represent physical protein–protein interactions retrieved from BioGRID, STRING, or HitPredict that are not included in TMPNet.",
    });
  });

  it("formats supplied counts and renders pending counts as an em dash", () => {
    expect(formatNetworkStatistic(137510)).toBe("137,510");
    expect(formatNetworkStatistic(null)).toBe("—");
  });
});
