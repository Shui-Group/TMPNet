import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Header from "@/components/Header";
import Legend from "@/components/Legend";
import NetworkGraph from "@/components/NetworkGraph";

import DataTable from "@/components/DataTable";
import LoadingSpinner from "@/components/LoadingSpinner";
import type { LayoutPayload, SubgraphData, TableColumn } from "@/lib/types";
import type { CytoscapeElements } from "@/lib/graphUtils";
import {
  layoutPayloadToPositionMap,
  toCytoscapeElements,
} from "@/lib/graphUtils";
// This argument is ignored by the tool wrapper, but I need to call the tool.
import {
  coseLayout,
  fcoseLayout,
  subgraphStyles,
} from "@/lib/cytoscape-config";

export default function SubgraphPage() {
  const router = useRouter();
  const { proteins } = router.query;

  const [data, setData] = useState<SubgraphData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [graphElements, setGraphElements] = useState<CytoscapeElements>([]);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphLayout, setGraphLayout] = useState<LayoutPayload | null>(null);

  type NodeTableRow = {
    id: string;
    label: string;
    description: string;
    geneSymbol: string;
    family: string;
    expressionTissue: string;
  };

  type EdgeTableRow = {
    id: string;
    source: string;
    target: string;
    fusionPredProb: string;
    enrichedTissue: string;
    positiveType: string;
    structureStatus: string;
    structureModelId?: string;
  };

  const handleGraphError = useCallback((err: unknown) => {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to initialise sub-network viewer";
    setGraphError(message);
    console.error("Error initialising Cytoscape:", err);
  }, []);

  const handleBackToNetwork = () => {
    router.push("/");
  };

  // Column definitions for data tables
  const nodeColumns = useMemo(
    (): TableColumn<NodeTableRow>[] => [
      { key: "id", label: "Protein" },
      { key: "label", label: "Entry Name" },
      { key: "description", label: "Description" },
      { key: "geneSymbol", label: "Gene Symbol" },
      { key: "family", label: "Family" },
      { key: "expressionTissue", label: "Expression Tissue" },
    ],
    []
  );

  const edgeColumns = useMemo(
    (): TableColumn<EdgeTableRow>[] => [
      { key: "id", label: "Edge" },
      { key: "source", label: "Protein 1" },
      { key: "target", label: "Protein 2" },
      { key: "fusionPredProb", label: "Fusion Pred. Prob" },
      { key: "enrichedTissue", label: "Enriched Tissue" },
      { key: "positiveType", label: "Positive Type" },
      {
        key: "structureStatus",
        label: "Structure",
        render: (row) =>
          row.structureModelId ? (
            <Link
              href={`/structures/${encodeURIComponent(row.structureModelId)}`}
              className="inline-flex items-center rounded-full border border-emerald-700/20 bg-emerald-700/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800 transition-colors hover:border-emerald-700/35 hover:bg-emerald-700/15"
            >
              View model
            </Link>
          ) : (
            <span className="text-gray-400">N/A</span>
          ),
      },
    ],
    []
  );

  // Format and sort node data for display
  const formattedNodes = useMemo(() => {
    if (!data) return [];

    // Sort: queried nodes first, then alphabetically by id
    const sorted = [...data.nodes].sort((a, b) => {
      if (a.isQuery && !b.isQuery) return -1;
      if (!a.isQuery && b.isQuery) return 1;
      return a.id.localeCompare(b.id);
    });

    return sorted.map((node) => ({
      id: node.id,
      label: node.label,
      description: node.description,
      geneSymbol: node.geneSymbol,
      family: node.family,
      expressionTissue: node.expressionTissue.join(", "),
    }));
  }, [data]);

  // Format and sort edge data for display
  const formattedEdges = useMemo(() => {
    if (!data) return [];

    // Sort by fusionPredProb descending
    const sorted = [...data.edges].sort(
      (a, b) => b.fusionPredProb - a.fusionPredProb
    );

    return sorted.map((edge) => ({
      id: edge.id,
      source: edge.geneSymbol1
        ? `${edge.source} (${edge.geneSymbol1})`
        : edge.source,
      target: edge.geneSymbol2
        ? `${edge.target} (${edge.geneSymbol2})`
        : edge.target,
      fusionPredProb: edge.fusionPredProb.toFixed(3),
      enrichedTissue: edge.enrichedTissue ?? "",
      positiveType: edge.positiveType,
      structureStatus: edge.hasStructureModel ? "Available" : "N/A",
      structureModelId: edge.structureModelId,
    }));
  }, [data]);

  // Prepare export data
  const exportableNodes = useMemo(() => {
    return (
      data?.nodes.map((node) => ({
        protein: node.id,
        entry_name: node.entryName,
        description: node.description,
        family: node.family,
        expression_tissue: node.expressionTissue.join("\\"),
        gene_symbol: node.geneSymbol,
      })) ?? []
    );
  }, [data]);

  const exportableEdges = useMemo(() => {
    return (
      data?.edges.map((edge) => ({
        edge: edge.id,
        protein1: edge.source,
        protein2: edge.target,
        fusion_pred_prob: edge.fusionPredProb,
        enriched_tissue: edge.enrichedTissue || "NA",
        tissue_enriched_confidence: edge.tissueEnrichedConfidence || "NA",
        positive_type: edge.positiveType,
        gene_symbol1: edge.geneSymbol1 || "NA",
        gene_symbol2: edge.geneSymbol2 || "NA",
      })) ?? []
    );
  }, [data]);

  const queryProteinDetails = useMemo(() => {
    if (!data) return [];

    return (
      data.queryProteins ??
      data.query.map((queryProtein) => ({
        searchedTerm: queryProtein,
        proteinId: queryProtein,
        geneSymbol: "",
        entryName: "",
        description: "",
        wasGeneSymbolSearch: false,
      }))
    );
  }, [data]);

  const queryDisplay = useMemo(() => {
    return queryProteinDetails
      .map((queryProtein) => {
        const primary =
          queryProtein.geneSymbol ||
          queryProtein.searchedTerm ||
          queryProtein.proteinId;
        return primary === queryProtein.proteinId
          ? primary
          : `${primary} (${queryProtein.proteinId})`;
      })
      .join(", ");
  }, [queryProteinDetails]);

  const structureCount = useMemo(() => {
    return data?.edges.filter((edge) => edge.hasStructureModel).length ?? 0;
  }, [data]);

  const isMultipleMode = queryProteinDetails.length > 1;

  const summaryTitle = isMultipleMode
    ? `Sub-network centered on ${queryProteinDetails.length} queried proteins`
    : `Sub-network centered on ${queryDisplay}`;

  const summaryCards = useMemo(() => {
    if (!data) return [];

    return [
      {
        label: "Queried proteins",
        value: queryProteinDetails.length.toString(),
        note: isMultipleMode
          ? "Shared neighborhood view"
          : "Single-seed neighborhood",
      },
      {
        label: "TMPs",
        value: data.nodes.length.toLocaleString(),
        note: "Ranked by 1-hop association context",
      },
      {
        label: "Associations",
        value: data.edges.length.toLocaleString(),
        note: "Additional + TMPNet",
      },
      {
        label: "Structure links",
        value: structureCount.toLocaleString(),
        note: "Edges with mapped models",
      },
    ];
  }, [data, isMultipleMode, queryProteinDetails.length, structureCount]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    if (!proteins || typeof proteins !== "string") {
      setLoading(false);
      return;
    }

    async function fetchSubgraph() {
      setLoading(true);
      setError(null);
      setGraphError(null);

      try {
        const proteinParam = Array.isArray(proteins) ? proteins[0] : proteins;
        const response = await fetch(
          `/api/subgraph?proteins=${encodeURIComponent(proteinParam ?? "")}`
        );

        if (response.status === 404) {
          setError(
            "Protein(s) not found in database. Please check the protein IDs and try again."
          );
          setLoading(false);
          return;
        }

        if (response.status === 400) {
          setError("Invalid request. Please provide valid protein IDs.");
          setLoading(false);
          return;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to fetch sub-network: ${response.statusText}`
          );
        }

        const subgraphData = (await response.json()) as SubgraphData;
        setData(subgraphData);
        setGraphLayout(subgraphData.layout ?? null);

        const isMultipleMode =
          (subgraphData.queryProteins?.length ?? subgraphData.query.length) > 1;

        const nodes = isMultipleMode
          ? subgraphData.nodes.map((n) => ({ ...n, isQuery: false }))
          : subgraphData.nodes;

        const elements = toCytoscapeElements(
          {
            nodes: nodes,
            edges: subgraphData.edges,
            layoutPositions: layoutPayloadToPositionMap(subgraphData.layout),
          },
          isMultipleMode
        );
        setGraphElements(elements);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to fetch sub-network data";
        setError(message);
        console.error("Error fetching subgraph:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchSubgraph();
  }, [proteins, router.isReady]);

  // Show error if no proteins parameter
  if (router.isReady && !proteins) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(186,230,253,0.32),_transparent_30%),linear-gradient(180deg,_#f8fbff_0%,_#f4f6fb_48%,_#eef2f9_100%)]">
        <Header />
        <div className="flex items-center justify-center p-8">
          <div className="max-w-md rounded-[28px] border border-red-200/80 bg-white/90 p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-500">
              Missing Parameter
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Please provide protein IDs via the <code>proteins</code> query
              parameter.
            </p>
            <button
              onClick={handleBackToNetwork}
              className="mt-6 inline-flex items-center rounded-full border border-slate-200 bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Back to Network
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(186,230,253,0.34),_transparent_24%),radial-gradient(circle_at_85%_15%,_rgba(196,181,253,0.22),_transparent_26%),linear-gradient(180deg,_#f8fbff_0%,_#f4f6fb_48%,_#eef2f9_100%)]">
      <Header />

      <div className="border-b border-slate-200/70 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <button
            onClick={handleBackToNetwork}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:text-slate-950 hover:shadow"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to network
          </button>
          <div className="hidden rounded-full border border-sky-100 bg-sky-50/80 px-3 py-1 text-xs font-medium tracking-[0.16em] text-sky-700 sm:block">
            SUB-NETWORK EXPLORER
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        {loading && (
          <div className="flex min-h-[calc(100vh-220px)] items-center justify-center rounded-[32px] border border-white/60 bg-white/75 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur">
            <LoadingSpinner label="Loading sub-network..." size="lg" />
          </div>
        )}

        {!loading && error && (
          <div className="flex min-h-[calc(100vh-220px)] items-center justify-center rounded-[32px] border border-white/60 bg-white/75 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="max-w-md rounded-[28px] border border-red-200/80 bg-white p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-500">
                Error Loading sub-network
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>
              <button
                onClick={handleBackToNetwork}
                className="mt-6 inline-flex items-center rounded-full border border-slate-200 bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                Back to Network
              </button>
            </div>
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-8">
            <section className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="space-y-4">
                <div className="overflow-hidden rounded-[26px] border border-white/70 bg-white/82 p-4 shadow-[0_20px_55px_rgba(15,23,42,0.07)] backdrop-blur">
                  <div className="inline-flex rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">
                    SUB-NETWORK SUMMARY
                  </div>
                  <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">
                    {summaryTitle}
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    A focused TMP association view centered on the query protein
                    set, designed for rapid overview before detailed
                    table-level review.
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {summaryCards.map((card) => (
                      <div
                        key={card.label}
                        className="rounded-[16px] border border-slate-200/80 bg-slate-50/90 px-3 py-2.5"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {card.label}
                        </p>
                        <p className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                          {card.value}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                          {card.note}
                        </p>
                      </div>
                    ))}
                  </div>

                </div>

                {data.truncated &&
                  (data.truncated.nodes || data.truncated.edges) && (
                    <div className="rounded-[28px] border border-amber-200/80 bg-amber-50/90 p-5 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="mt-1 rounded-full bg-amber-100 p-2 text-amber-700">
                          <svg
                            className="h-4 w-4"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-amber-900">
                            Results truncated
                          </p>
                          <p className="mt-1 text-sm leading-6 text-amber-800">
                            The sub-network has been limited due to size
                            constraints.
                            {data.truncated.nodes &&
                              " Some nodes have been excluded."}
                            {data.truncated.edges &&
                              " Some edges have been excluded."}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
              </aside>

              <section className="space-y-4">
                <div className="rounded-[32px] border border-white/70 bg-white/82 p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur sm:p-5">
                  <div className="mb-4 flex flex-col gap-4 border-b border-slate-200/70 pb-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        TMPNet ASSOCIATION MAP
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                        {isMultipleMode
                          ? "Shared sub-network landscape"
                          : "1-hop TMP association sub-network"}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                        Query proteins are fixed at the center, and 1-hop
                        associated TMPs are arranged radially for rapid
                        inspection of protein families and association evidence.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                        Tap a node for details
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                        {isMultipleMode
                          ? "Force-cluster layout"
                          : "Radial focus"}
                      </span>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/85 shadow-inner">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,_rgba(191,219,254,0.45),_transparent_28%),radial-gradient(circle_at_82%_18%,_rgba(196,181,253,0.22),_transparent_24%),linear-gradient(180deg,_rgba(255,255,255,0.84),_rgba(248,250,252,0.92))]" />
                    <div className="pointer-events-none absolute -left-20 top-10 h-56 w-56 rounded-full bg-sky-100/60 blur-3xl" />
                    <div className="pointer-events-none absolute bottom-8 right-10 h-52 w-52 rounded-full bg-violet-100/50 blur-3xl" />

                    <div className="relative h-[420px] min-h-[380px] sm:h-[460px] lg:h-[clamp(420px,48vh,520px)] 2xl:h-[540px]">
                      <NetworkGraph
                        elements={graphElements}
                        isLoading={false}
                        onError={handleGraphError}
                        layout={isMultipleMode ? fcoseLayout : coseLayout}
                        layoutMetadata={graphLayout}
                        customStyles={subgraphStyles}
                      />
                      <div className="pointer-events-auto absolute right-4 top-4 z-20">
                        <Legend />
                      </div>
                      {graphError && (
                        <div className="absolute inset-0 z-30 flex items-center justify-center">
                          <div className="max-w-sm rounded-[24px] border border-red-200 bg-white/95 p-5 text-center shadow-lg">
                            <p className="text-sm font-semibold text-red-600">
                              Unable to load sub-network
                            </p>
                            <p className="mt-2 text-xs text-red-500">
                              {graphError}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/70 bg-white/82 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur sm:p-5">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Query Inputs
                      </p>
                      <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                        Queried proteins
                      </h2>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-600">
                      {queryProteinDetails.length}
                    </div>
                  </div>

                  <div className="-mx-1 mt-4 overflow-x-auto px-1 pb-2">
                    <div className="flex min-w-0 gap-3">
                      {queryProteinDetails.map((queryProtein) => (
                        <article
                          key={queryProtein.proteinId}
                          className="min-w-[230px] flex-[0_0_230px] rounded-[18px] border border-slate-200/80 bg-slate-50/90 p-4 sm:min-w-[250px] sm:flex-[0_0_250px] xl:min-w-[0] xl:flex-[0_0_calc((100%_-_36px)/4)]"
                        >
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-lg font-semibold tracking-tight text-slate-950">
                              {queryProtein.wasGeneSymbolSearch
                                ? queryProtein.searchedTerm
                                : queryProtein.proteinId}
                            </span>
                            {queryProtein.wasGeneSymbolSearch && (
                              <span className="text-sm text-slate-500">
                                ({queryProtein.proteinId})
                              </span>
                            )}
                          </div>
                          <dl className="mt-3 grid gap-2 text-sm text-slate-600">
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Entry
                              </dt>
                              <dd className="mt-0.5 min-w-0 break-words font-medium text-slate-800">
                                {queryProtein.entryName || "N/A"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Gene
                              </dt>
                              <dd className="mt-0.5 min-w-0 break-words font-medium text-slate-800">
                                {queryProtein.geneSymbol || "N/A"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Description
                              </dt>
                              <dd className="mt-0.5 line-clamp-3 min-w-0 break-words leading-5 text-slate-600">
                                {queryProtein.description || "N/A"}
                              </dd>
                            </div>
                          </dl>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </section>

            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Reference Tables
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                    Tables and export
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Tables for manual review, export, and structure follow-up.
                  </p>
                </div>
                <div className="text-xs text-slate-500">
                  Use the built-in filters to narrow specific proteins, tissues,
                  and edge sources.
                </div>
              </div>

              <div className="grid gap-6">
                <DataTable
                  caption="Protein Information"
                  columns={nodeColumns}
                  data={formattedNodes}
                  exportData={exportableNodes}
                  exportFileName="nodes.csv"
                />
                <DataTable
                  caption="Association Information"
                  columns={edgeColumns}
                  data={formattedEdges}
                  exportData={exportableEdges}
                  exportFileName="edges.csv"
                />
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
