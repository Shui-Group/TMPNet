import { useCallback, useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import Legend from "@/components/Legend";
import NetworkGraph from "@/components/NetworkGraph";

import LoadingSpinner from "@/components/LoadingSpinner";
import type {
  LayoutPayload,
  NetworkElementsResponse,
  NetworkMeta,
  NetworkStats,
} from "@/lib/types";
import type { CytoscapeElements } from "@/lib/graphUtils";

export default function Home() {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [graphElements, setGraphElements] = useState<CytoscapeElements>([]);
  const [graphLoading, setGraphLoading] = useState<boolean>(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphMeta, setGraphMeta] = useState<NetworkMeta | null>(null);
  const [graphLayout, setGraphLayout] = useState<LayoutPayload | null>(null);
  const networkCacheRef = useRef<NetworkElementsResponse | null>(null);

  const handleGraphError = useCallback((err: unknown) => {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to initialise network viewer";
    setGraphError(message);
    console.error("Error initialising Cytoscape:", err);
  }, []);

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch("/api/network/stats");
        if (!response.ok) {
          throw new Error(`Failed to fetch statistics: ${response.statusText}`);
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unknown error occurred"
        );
        console.error("Error fetching network stats:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  const applyNetworkData = useCallback((network: NetworkElementsResponse) => {
    setGraphMeta(network.meta ?? null);
    setGraphElements(network.elements ?? []);
    setGraphLayout(network.layout ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchNetwork() {
      try {
        const cached = networkCacheRef.current;
        if (cached) {
          applyNetworkData(cached);
          setGraphLoading(false);
        } else {
          setGraphLoading(true);
        }
        setGraphError(null);
        const response = await fetch(
          "/api/network?view=overview&format=cyto&detail=slim"
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch network: ${response.statusText}`);
        }
        const data = (await response.json()) as NetworkElementsResponse;
        if (cancelled) return;
        networkCacheRef.current = data;
        applyNetworkData(data);

        const shouldHydrateFull =
          data.meta?.fullArtifactAvailable === true &&
          (data.meta?.renderedEdges ?? 0) > 0 &&
          (data.meta?.renderedEdges ?? 0) < (data.meta?.totalEdges ?? 0);

        if (shouldHydrateFull) {
          void fetch("/api/network?view=full&format=cyto&detail=slim")
            .then(async (fullResponse) => {
              if (!fullResponse.ok) {
                throw new Error(
                  `Failed to hydrate full network: ${fullResponse.statusText}`
                );
              }
              return (await fullResponse.json()) as NetworkElementsResponse;
            })
            .then((fullData) => {
              if (cancelled) return;
              networkCacheRef.current = fullData;
              applyNetworkData(fullData);
            })
            .catch((err) => {
              if (cancelled) return;
              console.error("Error hydrating full network:", err);
            });
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to fetch network";
        setGraphError(message);
        console.error("Error fetching network:", err);
      } finally {
        if (!cancelled) {
          setGraphLoading(false);
        }
      }
    }

    fetchNetwork();
    return () => {
      cancelled = true;
    };
  }, [applyNetworkData]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="flex flex-col lg:flex-row">
        {loading ? (
          <div className="w-full lg:w-80 bg-white border-r border-gray-200 p-6 flex items-center justify-center">
            <LoadingSpinner label="Loading network statistics..." />
          </div>
        ) : error ? (
          <div className="w-full lg:w-80 bg-white border-r border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Network Statistics
            </h2>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">
                <span className="font-semibold">Error:</span> {error}
              </p>
            </div>
          </div>
        ) : stats ? (
          <Sidebar stats={stats} meta={graphMeta} />
        ) : null}

        <main className="flex-1 p-6">
          <div className="relative h-[calc(100vh-64px-48px)]">
            <NetworkGraph
              elements={graphElements}
              isLoading={graphLoading}
              onError={handleGraphError}
              layoutMetadata={graphLayout}
              preferPresetLayout
            />
            <div className="pointer-events-auto absolute top-4 right-4 z-20">
              <Legend />
            </div>
            {graphError && (
              <div className="absolute inset-0 z-30 flex items-center justify-center">
                <div className="max-w-sm rounded-lg border border-red-200 bg-white/90 p-4 text-center shadow">
                  <p className="text-sm font-semibold text-red-600">
                    Unable to load network
                  </p>
                  <p className="mt-2 text-xs text-red-500">{graphError}</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
