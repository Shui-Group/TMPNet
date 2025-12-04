import { useMemo } from "react";
import type { NetworkMeta, NetworkStats } from "@/lib/types";

type PositiveTypeOption = "experiment" | "prediction";

interface SidebarProps {
  stats: NetworkStats;
  meta?: NetworkMeta | null;
  filters: {
    positiveTypes: PositiveTypeOption[];
    maxEdges: number;
    onlyVisibleEdges: boolean;
  };
  onChange: (filters: SidebarProps["filters"]) => void;
}

const POSITIVE_TYPE_OPTIONS: { value: PositiveTypeOption; label: string }[] = [
  { value: "experiment", label: "Experimental" },
  { value: "prediction", label: "Predicted" },
];

const MAX_EDGES_MIN = 0;
const MAX_EDGES_STEP = 1000;
const MAX_EDGES_DEFAULT = 50000;
const MAX_EDGES_FALLBACK_MAX = 2000000;

export default function Sidebar({
  stats,
  meta,
  filters,
  onChange,
}: SidebarProps) {
  const positiveTypeSet = useMemo(
    () => new Set(filters.positiveTypes),
    [filters.positiveTypes]
  );

  const handleTogglePositiveType = (option: PositiveTypeOption) => {
    const next = new Set(filters.positiveTypes);
    if (next.has(option)) {
      next.delete(option);
    } else {
      next.add(option);
    }
    const updated = Array.from(next);
    onChange({
      ...filters,
      positiveTypes: updated.length > 0 ? updated : [option],
    });
  };

  const maxEdgesLimit = meta?.totalEdges ?? MAX_EDGES_FALLBACK_MAX;

  const handleMaxEdgesChange = (value: number) => {
    const clamped = Math.min(Math.max(value, MAX_EDGES_MIN), maxEdgesLimit);
    onChange({
      ...filters,
      maxEdges: clamped,
    });
  };

  const handleToggleOnlyVisibleEdges = () => {
    onChange({
      ...filters,
      onlyVisibleEdges: !filters.onlyVisibleEdges,
    });
  };

  return (
    <aside className="w-full lg:w-80 bg-white border-r border-gray-200 p-6 space-y-6 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Network Controls
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Limit edges and sources to keep the graph fast.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              Edge Sources
            </h3>
            <div className="flex flex-wrap gap-2">
              {POSITIVE_TYPE_OPTIONS.map((option) => {
                const selected = positiveTypeSet.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`px-3 py-1.5 text-sm rounded-full border transition ${
                      selected
                        ? "bg-blue-100 text-blue-700 border-blue-300"
                        : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                    }`}
                    onClick={() => handleTogglePositiveType(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm font-semibold text-gray-900 mb-2">
              <span>Max Edges</span>
              <span>{filters.maxEdges.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min={MAX_EDGES_MIN}
              max={maxEdgesLimit}
              step={MAX_EDGES_STEP}
              value={filters.maxEdges}
              onChange={(event) =>
                handleMaxEdgesChange(Number(event.target.value))
              }
              className="w-full"
              aria-label="Maximum edges"
            />
            <div className="mt-2 flex gap-2">
              <input
                type="number"
                min={MAX_EDGES_MIN}
                max={maxEdgesLimit}
                step={MAX_EDGES_STEP}
                value={filters.maxEdges}
                onChange={(event) =>
                  handleMaxEdgesChange(Number(event.target.value))
                }
                className="w-28 rounded border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => handleMaxEdgesChange(MAX_EDGES_DEFAULT)}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                Reset
              </button>
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={filters.onlyVisibleEdges}
              onChange={handleToggleOnlyVisibleEdges}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Only edges among visible nodes
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Network Statistics
        </h2>
        {meta && (
          <div
            className="grid grid-cols-2 gap-3 text-sm text-gray-600"
            aria-label="Network metadata"
          >
            <div className="flex flex-col">
              <span className="text-gray-500">Total nodes</span>
              <span className="font-semibold text-gray-900">
                {meta.totalNodes.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-500">Total edges</span>
              <span className="font-semibold text-gray-900">
                {meta.totalEdges.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-500">Filtered edges</span>
              <span className="font-semibold text-gray-900">
                {meta.filteredEdges.toLocaleString()}
              </span>
            </div>
            {meta.timings?.totalMs !== undefined && (
              <div className="flex flex-col">
                <span className="text-gray-500">Server time (ms)</span>
                <span className="font-semibold text-gray-900">
                  {meta.timings.totalMs.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Family Distribution
        </h3>
        {Object.keys(stats.familyCounts).length > 0 ? (
          <div className="space-y-2">
            {Object.entries(stats.familyCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([family, count]) => (
                <div
                  key={family}
                  className="flex justify-between text-sm text-gray-700"
                >
                  <span>{family}</span>
                  <span className="font-semibold">
                    {count.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No family data available</p>
        )}
      </div>
    </aside>
  );
}
