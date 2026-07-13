type NetworkStatisticsContent = {
  tmpnetNodes: number | null;
  additionalNodes: number | null;
  tmpnetEdges: number | null;
  additionalEdges: number | null;
  description: string | null;
};

export const networkStatisticsContent: NetworkStatisticsContent = {
  tmpnetNodes: 2953,
  additionalNodes: 1318,
  tmpnetEdges: 137549,
  additionalEdges: 44637,
  description:
    "Additional edges represent physical protein–protein interactions retrieved from BioGRID, STRING, or HitPredict that are not included in TMPNet.",
};

export const formatNetworkStatistic = (value: number | null): string =>
  value === null ? "—" : value.toLocaleString();
