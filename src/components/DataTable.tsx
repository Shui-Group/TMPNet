import { useState, useMemo } from "react";

interface Column {
  key: string;
  label: string;
}

interface DataTableProps {
  columns: Column[];
  data: Array<Record<string, string | number | null | undefined>>;
  caption: string;
  pageSize?: number;
  exportData?: Array<Record<string, string | number | null | undefined>>;
  exportFileName?: string;
}

export default function DataTable({
  columns,
  data,
  caption,
  pageSize = 10,
  exportData,
  exportFileName = "data.csv"
}: DataTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [filterText, setFilterText] = useState("");

  const filteredData = useMemo(() => {
    if (!filterText) return data;
    const lowerFilter = filterText.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const val = row[col.key];
        return val && String(val).toLowerCase().includes(lowerFilter);
      })
    );
  }, [data, columns, filterText]);

  const totalPages = Math.ceil(filteredData.length / pageSize);

  // Reset to page 1 when filter changes
  useMemo(() => {
    setCurrentPage(1);
  }, [filterText]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredData.slice(startIndex, startIndex + pageSize);
  }, [filteredData, currentPage, pageSize]);

  // Generate page numbers to display - always show page 1, then next pages
  const pageNumbers = useMemo(() => {
    const pages: (number | string)[] = [1];

    if (totalPages <= 1) return pages;

    const showEllipsisStart = currentPage > 4;
    const showEllipsisEnd = currentPage < totalPages - 3;

    if (showEllipsisStart) {
      pages.push("...");
    }

    // Determine the range of pages to show around the current page
    let startPage = Math.max(2, currentPage - 1);
    let endPage = Math.min(totalPages - 1, currentPage + 1);

    // Adjust for edge cases to ensure we show a reasonable number of pages
    if (currentPage <= 4) {
      startPage = 2;
      endPage = Math.min(5, totalPages - 1); // Show up to page 5 initially
    } else if (currentPage >= totalPages - 3) {
      startPage = Math.max(totalPages - 4, 2);
      endPage = totalPages - 1;
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    if (showEllipsisEnd) {
      pages.push("... "); // Space to differentiate if needed, or just same string key
    }

    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  }, [currentPage, totalPages]);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const downloadCSV = () => {
    const dataToExport = exportData || data;
    if (!dataToExport || dataToExport.length === 0) return;

    // Get all unique keys from the first object (or all objects if keys vary)
    // Assuming uniform objects for now based on Typescript definition
    const headers = Object.keys(dataToExport[0]);

    // Create CSV content
    const csvContent = [
      headers.join(","), // Header row
      ...dataToExport.map(row =>
        headers.map(header => {
          const val = row[header];
          // Handle null/undefined
          if (val === null || val === undefined) return "";
          // Escape quotes and wrap in quotes if contains comma or quote
          const stringVal = String(val);
          if (stringVal.includes(",") || stringVal.includes('"') || stringVal.includes("\n")) {
            return `"${stringVal.replace(/"/g, '""')}"`;
          }
          return stringVal;
        }).join(",")
      )
    ].join("\n");

    // trigger download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", exportFileName);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="bg-gray-50 px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-2">
        <span className="text-left text-sm font-semibold uppercase tracking-wide text-gray-500">
          {caption}
        </span>
        <div className="flex items-center gap-2">
          <label htmlFor={`search-${caption}`} className="text-sm text-gray-600">
            Search:
          </label>
          <input
            id={`search-${caption}`}
            type="text"
            className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search..."
          />
          <button
            onClick={downloadCSV}
            className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Save Table CSV
          </button>
        </div>
      </div>

      <table className="table-auto w-full">
        <thead className="bg-gray-100">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="border-b border-gray-200 px-4 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paginatedData.map((row, idx) => (
            <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className="border-b border-gray-200 px-4 py-3 text-sm text-gray-700 whitespace-nowrap"
                >
                  {row[col.key] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination Controls */}
      {
        totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 py-3 px-4 border-t border-gray-200 bg-gray-50">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            {pageNumbers.map((page, idx) => (
              typeof page === 'number' ? (
                <button
                  key={`${page}-${idx}`}
                  onClick={() => goToPage(page)}
                  className={`px-3 py-1 text-sm rounded ${page === currentPage
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-200"
                    }`}
                >
                  {page}
                </button>
              ) : (
                <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">...</span>
              )
            ))}

            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )
      }
    </div >
  );
}
