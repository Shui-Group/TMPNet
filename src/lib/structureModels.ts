import type {
  StructureModelRecord,
  StructureModelResponse,
  StructureVariant,
} from "./types";

export type ParsedStructureModelId = {
  modelId: string;
  folderProtein1: string;
  folderProtein2: string;
  proteinPairKey: string;
  variant: StructureVariant;
};

const MODEL_ID_PATTERN =
  /^([a-z0-9]+)-([a-z0-9]+?)(?:_(without_ag|optimize))?$/i;

export function buildProteinPairKey(
  protein1: string,
  protein2: string
): string {
  return [protein1, protein2]
    .map((protein) => protein.trim().toUpperCase())
    .sort((left, right) => left.localeCompare(right))
    .join("::");
}

export function parseStructureModelId(
  rawModelId: string
): ParsedStructureModelId | null {
  const normalized = rawModelId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(MODEL_ID_PATTERN);
  if (!match) {
    return null;
  }

  const [, protein1, protein2, suffix] = match;
  const variant: StructureVariant =
    suffix === "without_ag" || suffix === "optimize" ? suffix : "plain";

  return {
    modelId: normalized,
    folderProtein1: protein1.toUpperCase(),
    folderProtein2: protein2.toUpperCase(),
    proteinPairKey: buildProteinPairKey(protein1, protein2),
    variant,
  };
}

export function transformStructureModelRecord(
  record: StructureModelRecord
): StructureModelResponse {
  return {
    modelId: record.model_id,
    edge: record.edge,
    protein1: record.protein1,
    protein2: record.protein2,
    folderProtein1: record.folder_protein1,
    folderProtein2: record.folder_protein2,
    variant: record.variant,
    source: record.source,
    cifPath: record.cif_rel_path,
    cifSizeBytes: record.cif_size_bytes,
    summaryConfidencesPath: record.summary_confidences_rel_path,
    summaryConfidences: record.summary_confidences,
    summaryIptm: record.summary_iptm,
    summaryPtm: record.summary_ptm,
    summaryRankingScore: record.summary_ranking_score,
    summaryFractionDisordered: record.summary_fraction_disordered,
    summaryHasClash: record.summary_has_clash,
    confidencesPath: record.confidences_rel_path,
    confidencesSizeBytes: record.confidences_size_bytes,
    hasConfidences: record.has_confidences,
  };
}
