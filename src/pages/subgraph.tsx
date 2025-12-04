import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Header from "@/components/Header";
import Legend from "@/components/Legend";
import NetworkGraph from "@/components/NetworkGraph";
import SearchBar from "@/components/SearchBar";
import DataTable from "@/components/DataTable";
import LoadingSpinner from "@/components/LoadingSpinner";
import type { LayoutPayload, SubgraphData } from "@/lib/types";
import type { CytoscapeElements } from "@/lib/graphUtils";
import {
  layoutPayloadToPositionMap,
  toCytoscapeElements,
} from "@/lib/graphUtils";
import { coseLayout, subgraphStyles } from "@/lib/cytoscape-config";

export default function SubgraphPage() {
  const router = useRouter();
  const { proteins } = router.query;

  const [data, setData] = useState<SubgraphData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [graphElements, setGraphElements] = useState<CytoscapeElements>([]);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphLayout, setGraphLayout] = useState<LayoutPayload | null>(null);

  const handleGraphError = useCallback((err: unknown) => {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to initialise subgraph viewer";
    setGraphError(message);
    console.error("Error initialising Cytoscape:", err);
  }, []);

  const handleBackToNetwork = () => {
    router.push("/");
  };

  // Column definitions for data tables
  const nodeColumns = useMemo(
    () => [
      { key: "id", label: "Protein" },
      { key: "label", label: "Entry Name" },
      { key: "description", label: "Description" },
      { key: "geneNames", label: "Gene Names" },
      { key: "family", label: "Family" },
      { key: "expressionTissue", label: "Expression Tissue" },
    ],
    []
  );

  const edgeColumns = useMemo(
    () => [
      { key: "id", label: "Edge" },
      { key: "source", label: "Protein 1" },
      { key: "target", label: "Protein 2" },
      { key: "fusionPredProb", label: "Fusion Pred. Prob" },
      { key: "enrichedTissue", label: "Enriched Tissue" },
      { key: "positiveType", label: "Positive Type" },
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
      geneNames: node.geneNames,
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
      source: edge.source,
      target: edge.target,
      fusionPredProb: edge.fusionPredProb.toFixed(3),
      enrichedTissue: edge.enrichedTissue ?? "",
      positiveType: edge.positiveType,
    }));
  }, [data]);

  useEffect(() => {
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
          throw new Error(`Failed to fetch subgraph: ${response.statusText}`);
        }

        const subgraphData = (await response.json()) as SubgraphData;
        setData(subgraphData);
        setGraphLayout(subgraphData.layout ?? null);

        const elements = toCytoscapeElements({
          nodes: subgraphData.nodes,
          edges: subgraphData.edges,
          layoutPositions: layoutPayloadToPositionMap(subgraphData.layout),
        });
        setGraphElements(elements);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch subgraph data";
        setError(message);
        console.error("Error fetching subgraph:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchSubgraph();
  }, [proteins]);

  // Show error if no proteins parameter
  if (!proteins) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center p-8">
          <div className="max-w-md rounded-lg border border-red-200 bg-white p-6 text-center shadow">
            <p className="text-sm font-semibold text-red-600">
              Missing Parameter
            </p>
            <p className="mt-2 text-xs text-red-500">
              Please provide protein IDs via the <code>proteins</code> query
              parameter.
            </p>
            <button
              onClick={handleBackToNetwork}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Back to Network
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      {/* Back button */}
      <div className="border-b border-gray-200 bg-white px-6 py-3">
        <button
          onClick={handleBackToNetwork}
          className="flex items-center text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <svg
            className="mr-2 h-4 w-4"
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
          Back to Network
        </button>
      </div>

      <main className="p-6">
        {loading && (
          <div className="flex min-h-[calc(100vh-200px)] items-center justify-center rounded-lg bg-white">
            <LoadingSpinner label="Loading subnetwork..." size="lg" />
          </div>
        )}

        {!loading && error && (
          <div className="flex min-h-[calc(100vh-200px)] items-center justify-center rounded-lg bg-white">
            <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center shadow">
              <p className="text-sm font-semibold text-red-600">
                Error Loading Subgraph
              </p>
              <p className="mt-2 text-xs text-red-500">{error}</p>
              <button
                onClick={handleBackToNetwork}
                className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                Back to Network
              </button>
            </div>
          </div>
        )}

        {!loading && !error && data && (
          <div className="flex flex-col gap-10">
            <section className="w-full">
              {/* Page title */}
              {data && (
                <div className="mb-4">
                  <h1 className="text-2xl font-semibold text-gray-900">
                    Subgraph for: {data.query.join(", ")}
                  </h1>
                  <p className="mt-1 text-sm text-gray-600">
                    {data.nodes.length} node{data.nodes.length !== 1 ? "s" : ""}
                    , {data.edges.length} edge
                    {data.edges.length !== 1 ? "s" : ""}
                  </p>
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Searched Proteins
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {data.query.map((protein) => (
                        <span
                          key={protein}
                          className="inline-flex items-center rounded-full border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 shadow-sm"
                        >
                          {protein}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Truncation warning */}
              {data?.truncated &&
                (data.truncated.nodes || data.truncated.edges) && (
                  <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                    <div className="flex items-start">
                      <svg
                        className="mt-0.5 h-5 w-5 text-yellow-600"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <div className="ml-3">
                        <p className="text-sm font-medium text-yellow-800">
                          Results truncated
                        </p>
                        <p className="mt-1 text-xs text-yellow-700">
                          The subgraph has been limited due to size constraints.
                          {data.truncated.nodes &&
                            " Some nodes have been excluded."}
                          {data.truncated.edges &&
                            " Some edges have been excluded."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

              {/* Graph visualization */}
              <div className="relative h-[600px] lg:h-[calc(100vh-240px)]">
                <NetworkGraph
                  elements={graphElements}
                  isLoading={false}
                  onError={handleGraphError}
                  layout={coseLayout}
                  layoutMetadata={graphLayout}
                  customStyles={subgraphStyles}
                />
                <div className="pointer-events-auto absolute top-4 right-4 z-20">
                  <Legend />
                </div>
                {graphError && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center">
                    <div className="max-w-sm rounded-lg border border-red-200 bg-white/90 p-4 text-center shadow">
                      <p className="text-sm font-semibold text-red-600">
                        Unable to load subgraph
                      </p>
                      <p className="mt-2 text-xs text-red-500">{graphError}</p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <DataTable
                caption="Node Information (Top 10)"
                columns={nodeColumns}
                data={formattedNodes}
              />
              <DataTable
                caption="Edge Information (Top 10)"
                columns={edgeColumns}
                data={formattedEdges}
              />
            </section>
          </div>
        )}
      </main>

      <SearchBar />
    </div>
  );
}
