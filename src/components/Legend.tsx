import React from "react";
import { familyColorMap, familyLabelMap, edgeColors } from "@/lib/graphUtils";

interface LegendItem {
  color: string;
  label: string;
}

export default function Legend() {
  const nodeItems: LegendItem[] = [
    { color: familyColorMap.GPCR, label: familyLabelMap.GPCR }, // GPCRs
    {
      color: familyColorMap["Ion-channels"],
      label: familyLabelMap["Ion-channels"],
    }, // Ion-channels
    { color: familyColorMap.Transporter, label: familyLabelMap.Transporter }, // Transporters
    {
      color: familyColorMap["Catalytic receptors"],
      label: familyLabelMap["Catalytic receptors"],
    }, // Catalytic receptors
    {
      color: familyColorMap["Other TMPs"],
      label: familyLabelMap["Other TMPs"],
    }, // Other TMPs
  ];
  const edgeItems: LegendItem[] = [
    { color: edgeColors.experimental, label: "Additional" },
    { color: edgeColors.predicted, label: "TMPNet" },
  ];

  return (
    <div className="bg-white/95 rounded-lg border border-gray-200 p-4 shadow-lg">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Legend</h3>
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">
            TMP families
          </p>
          <div className="space-y-2">
            {nodeItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-sm text-gray-700">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">
            Association evidences
          </p>
          <div className="space-y-2">
            {edgeItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <div
                  className="w-6 h-[2px]"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-sm text-gray-700">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
