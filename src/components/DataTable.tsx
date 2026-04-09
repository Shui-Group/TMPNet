import { useState, useMemo, useEffect } from "react";
import type { TableColumn } from "@/lib/types";

type TableRowValue = string | number | null | undefined;
type TableRow = Record<string, TableRowValue | unknown>;

interface DataTableProps<Row extends TableRow = TableRow> {
  columns: TableColumn<Row>[];
  data: Row[];
  caption: string;
  pageSize?: number;
  exportData?: Array<Record<string, TableRowValue>>;
  exportFileName?: string;
}

export default function DataTable<Row extends TableRow = TableRow>({
  columns,
  data,
  caption,
  pageSize = 10,
  exportData,
  exportFileName = "data.csv"
}: DataTableProps<Row>) {
  const [currentPage, setCurrentPage] = useState(1);
  const [filterText, setFilterText] = useState("");
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const processedData = useMemo(() => {
    let result = [...data];

    // 1. Global Search
    if (filterText) {
      const lowerFilter = filterText.toLowerCase();
      result = result.filter((row) =>
        columns.some((col) => {
          const val = row[col.key as string];
          return val && String(val).toLowerCase().includes(lowerFilter);
        })
      );
    }

    // 2. Column Filters
    if (isFilterVisible) {
      Object.entries(columnFilters).forEach(([key, filterValue]) => {
        if (filterValue) {
          const lowerFilter = filterValue.toLowerCase();
          result = result.filter((row) => {
            const val = row[key as string];
            return val && String(val).toLowerCase().includes(lowerFilter);
          });
        }
      });
    }

    // 3. Sorting
    if (sortConfig) {
      result.sort((a, b) => {
        const valA = a[sortConfig.key as string] as TableRowValue;
        const valB = b[sortConfig.key as string] as TableRowValue;

        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        if (typeof valA === "number" && typeof valB === "number") {
          return sortConfig.direction === "asc" ? valA - valB : valB - valA;
        }

        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        if (strA < strB) return sortConfig.direction === "asc" ? -1 : 1;
        if (strA > strB) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, columns, filterText, isFilterVisible, columnFilters, sortConfig]);

  const totalPages = Math.ceil(processedData.length / pageSize);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterText, isFilterVisible, columnFilters]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return processedData.slice(startIndex, startIndex + pageSize);
  }, [processedData, currentPage, pageSize]);

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

  const handleSort = (key: string) => {
    setSortConfig((current) => {
      if (current?.key === key) {
        if (current.direction === "asc") return { key, direction: "desc" };
        return null;
      }
      return { key, direction: "asc" };
    });
  };

  const updateColumnFilter = (key: string, value: string) => {
    setColumnFilters((prev) => ({
      ...prev,
      [key]: value
    }));
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
            onClick={() => setIsFilterVisible(!isFilterVisible)}
            className={`rounded border px-3 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${isFilterVisible
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
          >
            Filter
          </button>
          <button
            onClick={downloadCSV}
            className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Save Table CSV
          </button>
        </div>
      </div>

      <table className="table-auto w-full border-collapse">
        <thead className="bg-gray-100">
          <tr>
            {columns.map((col) => {
              const columnKey = String(col.key);

              return (
                <th
                  key={columnKey}
                  className="group cursor-pointer border-b border-gray-200 px-4 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap hover:bg-gray-200 transition-colors select-none"
                  onClick={() => handleSort(columnKey)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{col.label}</span>
                    <span className="flex flex-col text-[8px] leading-[8px] text-gray-400">
                      <span className={`${sortConfig?.key === columnKey && sortConfig.direction === 'asc' ? 'text-gray-900' : ''}`}>▲</span>
                      <span className={`${sortConfig?.key === columnKey && sortConfig.direction === 'desc' ? 'text-gray-900' : ''}`}>▼</span>
                    </span>
                  </div>
                </th>
              );
            })}
          </tr>
          {/* Filter Row */}
          {isFilterVisible && (
            <tr className="bg-gray-50">
              {columns.map((col) => {
                const columnKey = String(col.key);

                return (
                  <th key={`filter-${columnKey}`} className="border-b border-gray-200 px-2 py-2">
                    <input
                      type="text"
                      className="w-full min-w-[60px] rounded border border-gray-300 px-2 py-1 text-xs font-normal text-gray-600 focus:border-blue-500 focus:outline-none"
                      placeholder={`Filter...`}
                      value={columnFilters[columnKey] || ""}
                      onChange={(e) => updateColumnFilter(columnKey, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                );
              })}
            </tr>
          )}
        </thead>
        <tbody>
          {paginatedData.map((row, idx) => (
            <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50 hover:bg-gray-100 transition-colors"}>
              {columns.map((col) => {
                const columnKey = String(col.key);

                return (
                  <td
                    key={columnKey}
                    className="border-b border-gray-200 px-4 py-3 text-sm text-gray-700 whitespace-nowrap"
                  >
                    {col.render ? col.render(row) : ((row[columnKey] as TableRowValue) ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
          {paginatedData.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-500">
                No results found
              </td>
            </tr>
          )}
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
