import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import type {
  Edge,
  Node,
  StructureDetailResponse,
  StructureModelRecord,
} from "@/lib/types";
import {
  parseStructureModelId,
  transformStructureModelRecord,
} from "@/lib/structureModels";
import {
  transformEdgeToResponse,
  transformNodeToResponse,
} from "@/lib/transforms";

const structureSelect =
  "model_id,edge,protein1,protein2,folder_protein1,folder_protein2,variant,source,cif_rel_path,cif_size_bytes,summary_confidences_rel_path,summary_confidences,summary_iptm,summary_ptm,summary_ranking_score,summary_fraction_disordered,summary_has_clash,confidences_rel_path,confidences_size_bytes,has_confidences";

const edgeSelect =
  "edge,protein1,protein2,fusion_pred_prob,enriched_tissue,tissue_enriched_confidence,positive_type,gene_symbol1,gene_symbol2";

type ErrorResponse = { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StructureDetailResponse | ErrorResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const modelParam = req.query.modelId;
  const rawModelId = Array.isArray(modelParam) ? modelParam[0] : modelParam;
  const parsedModelId = parseStructureModelId(rawModelId ?? "");

  if (!parsedModelId) {
    return res.status(400).json({ error: "Invalid structure model id" });
  }

  const { data: structureData, error: structureError } = await supabase
    .from("structure_models")
    .select(structureSelect)
    .eq("model_id", parsedModelId.modelId)
    .maybeSingle();

  if (structureError) {
    console.error("Database error fetching structure model:", structureError);
    return res
      .status(500)
      .json({ error: "Failed to fetch structure model from database" });
  }

  if (!structureData) {
    return res.status(404).json({ error: "Structure model not found" });
  }

  const structureRecord = structureData as StructureModelRecord;

  const { data: edgeData, error: edgeError } = await supabase
    .from("edges")
    .select(edgeSelect)
    .eq("edge", structureRecord.edge)
    .maybeSingle();

  if (edgeError) {
    console.error("Database error fetching structure edge:", edgeError);
    return res
      .status(500)
      .json({ error: "Failed to fetch structure edge from database" });
  }

  if (!edgeData) {
    return res.status(404).json({ error: "Structure edge not found" });
  }

  const { data: nodeData, error: nodeError } = await supabase
    .from("nodes")
    .select("protein,entry_name,description,family,expression_tissue,gene_symbol")
    .in("protein", [structureRecord.protein1, structureRecord.protein2]);

  if (nodeError) {
    console.error("Database error fetching structure proteins:", nodeError);
    return res
      .status(500)
      .json({ error: "Failed to fetch structure proteins from database" });
  }

  const nodeByProtein = new Map(
    ((nodeData ?? []) as Node[]).map((node) => [node.protein, node])
  );

  const orderedProteins = [structureRecord.protein1, structureRecord.protein2]
    .map((protein) => nodeByProtein.get(protein))
    .filter((node): node is Node => Boolean(node))
    .map(transformNodeToResponse);

  return res.status(200).json({
    model: transformStructureModelRecord(structureRecord),
    edge: transformEdgeToResponse(edgeData as Edge),
    proteins: orderedProteins,
  });
}
