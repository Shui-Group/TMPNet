type NetworkStatisticsContent = {
  tmpnetNodes: number | null;
  additionalNodes: number | null;
  tmpnetPairs: number | null;
  additionalPairs: number | null;
  description: string | null;
};

export const networkStatisticsContent: NetworkStatisticsContent = {
  // TODO(external-input:network-statistics): replace all four nulls only with
  // reviewed counts supplied by the project owner. Do not derive by subtraction.
  tmpnetNodes: null,
  additionalNodes: null,
  tmpnetPairs: null,
  additionalPairs: null,
  // TODO(external-input:network-statistics-description): insert approved copy.
  description: null,
};

export const formatNetworkStatistic = (value: number | null): string =>
  value === null ? "—" : value.toLocaleString();
