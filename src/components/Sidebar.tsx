import { getFamilyLabel, normalizeFamily } from "@/lib/graphUtils";
import {
  formatNetworkStatistic,
  networkStatisticsContent,
} from "@/lib/networkStatisticsContent";
import type { NetworkMeta, NetworkStats } from "@/lib/types";

interface SidebarProps {
  stats: NetworkStats;
  meta?: NetworkMeta | null;
}

const FAMILY_ORDER = [
  "GPCR",
  "Ion-channels",
  "Transporter",
  "Catalytic receptors",
  "Other TMPs",
] as const;

const orderFamilyCounts = (familyCounts: Record<string, number>) => {
  const normalizedCounts = Object.entries(familyCounts).reduce<
    Record<string, number>
  >((counts, [family, count]) => {
    const normalized = normalizeFamily(family);
    counts[normalized] = (counts[normalized] ?? 0) + count;
    return counts;
  }, {});

  return FAMILY_ORDER.flatMap((family) =>
    normalizedCounts[family] === undefined
      ? []
      : [[family, normalizedCounts[family]] as const]
  );
};

export default function Sidebar({ stats }: SidebarProps) {
  const orderedFamilyCounts = orderFamilyCounts(stats.familyCounts);

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
        <div
          className="grid grid-cols-2 gap-3 text-sm text-gray-600"
          aria-label="Network statistics"
        >
          {[
            ["TMPNet nodes", networkStatisticsContent.tmpnetNodes],
            ["Additional nodes", networkStatisticsContent.additionalNodes],
            ["TMPNet edges", networkStatisticsContent.tmpnetEdges],
            ["Additional edges", networkStatisticsContent.additionalEdges],
          ].map(([label, value]) => (
            <div key={label as string} className="flex flex-col">
              <span className="text-gray-500">{label}</span>
              <span className="font-semibold text-gray-900">
                {formatNetworkStatistic(value as number | null)}
              </span>
            </div>
          ))}
        </div>
        {networkStatisticsContent.description && (
          <p className="text-xs leading-5 text-gray-500">
            {networkStatisticsContent.description}
          </p>
        )}
      </div>

      <div className="pt-4 border-t border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Family Distribution
        </h3>
        {Object.keys(stats.familyCounts).length > 0 ? (
          <div className="space-y-2">
            {orderedFamilyCounts.map(([family, count]) => (
              <div
                key={family}
                data-testid="family-row"
                className="flex justify-between text-sm text-gray-700"
              >
                <span>{getFamilyLabel(family)}</span>
                <span className="font-semibold">{count.toLocaleString()}</span>
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
