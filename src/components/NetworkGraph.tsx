import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type cytoscapeType from "cytoscape";
import type {
  EdgeDefinition,
  ElementDefinition,
  EventObject,
  LayoutOptions,
  NodeDefinition,
} from "cytoscape";
import fcose from "cytoscape-fcose";
import LoadingSpinner from "./LoadingSpinner";
import {
  cyStyles,
  fcoseLayout,
  largeGraphThreshold,
  rendererOptions,
} from "@/lib/cytoscape-config";
import type { CytoscapeElements } from "@/lib/graphUtils";
import type { LayoutPayload } from "@/lib/types";

type CytoscapeWithExtensions = cytoscapeType & {
  use: (extension: unknown) => void;
};

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
  label: string;
  family?: string;
  geneNames?: string;
  expression?: string[];
  isQuery?: boolean;
};

const isEdgeElement = (
  element: ElementDefinition
): element is EdgeDefinition => {
  const data = element.data as EdgeDefinition["data"] | undefined;
  return Boolean(data && "source" in data && "target" in data);
};

const isNodeElement = (
  element: ElementDefinition
): element is NodeDefinition => {
  const data = element.data as NodeDefinition["data"] | undefined;
  return Boolean(data && !("source" in data));
};

interface NetworkGraphProps {
  elements: CytoscapeElements;
  isLoading?: boolean;
  progress?: {
    nodesLoaded: boolean;
    edgesLoaded: number;
    edgesTotal: number;
  } | null;
  onError?: (err: unknown) => void;
  layout?: LayoutOptions;
  layoutMetadata?: LayoutPayload | null;
}

export default function NetworkGraph({
  elements,
  isLoading,
  progress,
  onError,
  layout = fcoseLayout,
  layoutMetadata = null,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscapeType.Core | null>(null);
  const [ready, setReady] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    label: "",
  });
  const postedLayoutsRef = useRef<Set<string>>(new Set());

  const ensureQueryPriority = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      const queryNodes = cy.nodes("[?isQuery]");
      if (queryNodes.length === 0) return;
      queryNodes.style({ "z-index": 1000 });
      queryNodes.connectedEdges().style({ "z-index": 900 });
    });
  }, []);

  const edgeCount = useMemo(
    () => elements.filter(isEdgeElement).length,
    [elements]
  );
  const largeGraph = edgeCount > largeGraphThreshold;

  useEffect(() => {
    (async () => {
      try {
        const cytoscapeModule = await import("cytoscape");
        const cytoscapeFactory =
          cytoscapeModule.default as unknown as CytoscapeWithExtensions;
        cytoscapeFactory.use(fcose);
        if (!containerRef.current) return;
        const instance = cytoscapeFactory({
          container: containerRef.current,
          elements: [],
          style: cyStyles,
          layout: { name: "preset" },
          textureOnViewport: true,
          wheelSensitivity: 0.2,
          selectionType: "single",
          boxSelectionEnabled: false,
          autoungrabify: false,
          autounselectify: false,
          userZoomingEnabled: true,
          userPanningEnabled: true,
          minZoom: 0.05,
          maxZoom: 6,
          renderer: rendererOptions,
          motionBlur: true,
          motionBlurOpacity: 0.2,
        });
        const handleTapNode = (event: EventObject) => {
          const node = event.target;
          if (node?.isNode?.()) {
            if (node.selected()) {
              node.unselect();
              return;
            }
            instance.$("node:selected").unselect();
            node.select();
          }
        };
        const handleTapBackground = (event: EventObject) => {
          if (event.target === instance) {
            instance.$("node:selected").unselect();
          }
        };
        instance.on("tap", "node", handleTapNode);
        instance.on("tap", handleTapBackground);
        cyRef.current = instance;
        setReady(true);
      } catch (err) {
        onError?.(err);
      }
    })();
    return () => {
      const current = cyRef.current;
      if (current) {
        current.off("tap");
        current.destroy();
      }
      cyRef.current = null;
    };
  }, [onError]);

  const hideTooltip = useCallback(() => {
    setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  const shouldSkipLayout = useMemo(() => {
    const layoutPositionsKnown =
      layoutMetadata &&
      !layoutMetadata.positionsNeeded &&
      layoutMetadata.positions.length > 0;
    if (!layoutPositionsKnown) return false;
    const nodeElements = elements.filter(isNodeElement);
    if (nodeElements.length === 0) return false;
    return nodeElements.every((node) => {
      const pos = node.position as
        | { x: number; y: number }
        | undefined;
      return (
        typeof pos?.x === "number" && Number.isFinite(pos.x) &&
        typeof pos?.y === "number" && Number.isFinite(pos.y)
      );
    });
  }, [elements, layoutMetadata]);

  // apply elements and run layout (progressive: nodes + seed edges first)
  useEffect(() => {
    if (!ready || !cyRef.current) return;
    const cy = cyRef.current;
    const nodeElements = elements.filter(isNodeElement);
    const edgeElements = elements.filter(isEdgeElement);

    const seedEdges = largeGraph ? 12000 : 20000; // quick initial layout
    cy.startBatch();
    cy.elements().remove();
    cy.add(nodeElements);
    if (shouldSkipLayout) {
      cy.add(edgeElements);
    } else {
      cy.add(edgeElements.slice(0, Math.min(seedEdges, edgeElements.length)));
    }
    cy.endBatch();
    ensureQueryPriority();
    cy.resize();
    hideTooltip();
    if (shouldSkipLayout) {
      cy.fit(undefined, 30);
      cy.autolock(true);
      cy.autoungrabify(true);
      return;
    }

    cy.autolock(false);
    cy.autoungrabify(false);

    const runLayout = (options: LayoutOptions) => {
      const layoutInstance = cy.layout(options);
      layoutInstance.one?.("layoutstop", () => {
        ensureQueryPriority();
        cy.autolock(true);
        cy.autoungrabify(true);

        const graphKey = layoutMetadata?.graphKey;
        const layoutVersion = layoutMetadata?.layoutVersion;
        const needsPositions = layoutMetadata?.positionsNeeded;

        if (
          graphKey &&
          layoutVersion &&
          needsPositions &&
          !postedLayoutsRef.current.has(graphKey)
        ) {
          const positions = cy
            .nodes()
            .map((node) => ({
              id: node.id(),
              x: node.position("x"),
              y: node.position("y"),
            }))
            .filter((pos) =>
              Number.isFinite(pos.x) && Number.isFinite(pos.y)
            );

          if (positions.length === nodeElements.length) {
            postedLayoutsRef.current.add(graphKey);
            void fetch("/api/layout-cache", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                graphKey,
                layoutVersion,
                positions,
              }),
            }).catch((err) => {
              postedLayoutsRef.current.delete(graphKey);
              console.error("Failed to persist layout cache", err);
              onError?.(err);
            });
          }
        }
      });
      layoutInstance.run();
    };

    try {
      runLayout(layout);
    } catch {
      const fallbackLayout: LayoutOptions = {
        name: "cose",
        animate: false,
        fit: true,
        padding: 30,
      };
      runLayout(fallbackLayout);
    }
    cy.fit(undefined, 30);

    // batch in remaining edges without relayout
    let added = Math.min(seedEdges, edgeElements.length);
    const batchSize = largeGraph ? 5000 : 10000;
    function addMore() {
      if (!cyRef.current) return;
      if (added >= edgeElements.length) return;
      const end = Math.min(added + batchSize, edgeElements.length);
      cyRef.current.add(edgeElements.slice(added, end));
      added = end;
      ensureQueryPriority();
      if (added < edgeElements.length) setTimeout(addMore, 0);
    }
    setTimeout(addMore, 0);
  }, [
    elements,
    ready,
    layout,
    ensureQueryPriority,
    hideTooltip,
    largeGraph,
    layoutMetadata,
    shouldSkipLayout,
  ]);

  useEffect(() => {
    if (!ready || !cyRef.current) return;
    const handleResize = () => {
      cyRef.current?.resize();
      hideTooltip();
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [hideTooltip, ready]);

  useEffect(() => {
    if (!ready || !cyRef.current) return;
    const cy = cyRef.current;

    const handleNodeOver = (event: EventObject) => {
      const node = event.target;
      if (!node?.isNode?.()) return;
      const rendered = node.renderedPosition();
      const data = node.data() as NodeDefinition["data"] & {
        geneNames?: string;
        expressionTissue?: string[];
      };
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const padding = 16;
      const tooltipWidth = 240;
      const tooltipHeight = 120;
      const clampedX = Math.min(
        Math.max(rendered.x + padding, padding),
        Math.max(padding, rect.width - tooltipWidth)
      );
      const clampedY = Math.min(
        Math.max(rendered.y - padding, padding),
        Math.max(padding, rect.height - tooltipHeight)
      );

      setTooltip({
        visible: true,
        x: clampedX,
        y: clampedY,
        label: (data.label as string) || (data.id as string) || "Protein",
        family: (data.family as string) || undefined,
        geneNames: (data.geneNames as string) || undefined,
        expression: Array.isArray(data.expressionTissue)
          ? data.expressionTissue
          : undefined,
        isQuery: Boolean(data.isQuery),
      });
    };

    const handleNodeOut = () => {
      hideTooltip();
    };

    const handleViewportChange = () => {
      hideTooltip();
    };

    cy.on("mouseover", "node", handleNodeOver);
    cy.on("mouseout", "node", handleNodeOut);
    cy.on("drag", "node", handleNodeOut);
    cy.on("viewport", handleViewportChange);

    return () => {
      cy.off("mouseover", "node", handleNodeOver);
      cy.off("mouseout", "node", handleNodeOut);
      cy.off("drag", "node", handleNodeOut);
      cy.off("viewport", handleViewportChange);
    };
  }, [hideTooltip, ready]);

  return (
    <div
      className="relative h-full w-full rounded-lg bg-white"
      aria-label="Network graph"
    >
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="rounded-lg border border-gray-200 bg-white/90 p-6 text-center shadow-sm">
            <LoadingSpinner label="Loading network data..." />
            {progress && (
              <div className="mt-4 w-64 text-left">
                <div className="mb-2 h-2 w-full overflow-hidden rounded bg-gray-200">
                  <div
                    className="h-2 bg-blue-600"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (progress.edgesLoaded /
                            Math.max(1, progress.edgesTotal)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-gray-600">
                  Nodes: {progress.nodesLoaded ? "✓" : "loading"} | Edges:{" "}
                  {progress.edgesLoaded.toLocaleString()} /{" "}
                  {progress.edgesTotal.toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="h-full w-full"
        data-testid="network-graph"
      />
      {tooltip.visible && (
        <div
          className={`pointer-events-none absolute z-20 max-w-xs rounded-md border border-gray-200 bg-white/95 p-3 text-left shadow-lg transition ${
            tooltip.isQuery ? "ring-2 ring-blue-200" : ""
          }`}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <p className="text-sm font-semibold text-gray-900">{tooltip.label}</p>
          {tooltip.geneNames && (
            <p className="mt-1 text-xs text-gray-600">
              <span className="font-medium text-gray-700">Genes:</span>{" "}
              {tooltip.geneNames}
            </p>
          )}
          {tooltip.family && (
            <p className="mt-1 text-xs text-gray-600">
              <span className="font-medium text-gray-700">Family:</span>{" "}
              {tooltip.family}
            </p>
          )}
          {tooltip.expression && tooltip.expression.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              <span className="font-medium text-gray-700">Expression:</span>{" "}
              {tooltip.expression.slice(0, 3).join(", ")}
              {tooltip.expression.length > 3 ? "…" : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
