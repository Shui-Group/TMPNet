import { getFamilyLabel } from "@/lib/graphUtils";
import type { NetworkMeta, NetworkStats } from "@/lib/types";

interface SidebarProps {
  stats: NetworkStats;
  meta?: NetworkMeta | null;
}
export default function Sidebar({ stats, meta }: SidebarProps) {
  return (
    <aside className="w-full lg:w-80 bg-white border-r border-gray-200 p-6 space-y-6 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-gray-900">Network Summary</h2>
        <p className="text-sm text-gray-600">
          The total graph shows the full TMPNet interaction network without
          sidebar filtering.
        </p>
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
              .map(([family, count]) => {
                return (
                  <div
                    key={family}
                    className="flex justify-between text-sm text-gray-700"
                  >
                    <span>{getFamilyLabel(family)}</span>
                    <span className="font-semibold">
                      {count.toLocaleString()}
                    </span>
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No family data available</p>
        )}
      </div>
    </aside>
  );
}
