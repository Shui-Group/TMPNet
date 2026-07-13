import { useState, FormEvent, KeyboardEvent, useEffect } from "react";
import { useRouter } from "next/router";

interface SearchBarProps {
  placeholder?: string;
  className?: string;
  initialValue?: string;
}

export default function SearchBar({
  placeholder = "Search for Protein Symbol or UniProt ID",
  className = "fixed bottom-8 left-1/2 transform -translate-x-1/2 z-10",
  initialValue = "",
}: SearchBarProps) {
  const router = useRouter();
  const [input, setInput] = useState(initialValue);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialValue) {
      setInput(initialValue);
    }
  }, [initialValue]);

  const validateInput = (ids: string[]): boolean => {
    // Allow alphanumeric characters (Gene symbols or UniProt IDs)
    // Basic check: length > 0 and alphanumeric
    const pattern = /^[A-Z0-9]+$/i;
    return ids.every((id) => pattern.test(id));
  };

  const handleSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault();

    // Empty input does nothing
    if (!input.trim()) {
      return;
    }

    // Clear previous error
    setError("");

    // Parse and validate IDs
    const ids = input
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (ids.length === 0) {
      return;
    }

    if (!validateInput(ids)) {
      setError(
        "Invalid format. Please use valid Protein Symbols or UniProt IDs (alphanumeric)."
      );
      return;
    }

    // Navigate to subgraph page with query params
    // Convert to uppercase for consistency if needed, or keep as is?
    // UniProt IDs are uppercase, Gene symbols often uppercase. Let's uppercase.
    const queryString = ids.map((id) => id.toUpperCase()).join(",");
    router.push(`/subgraph?proteins=${queryString}`);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    // Clear error on new input
    if (error) {
      setError("");
    }
  };

  return (
    <div className={className || "w-full"}>
      <div className="flex flex-col items-center">
        <form onSubmit={handleSubmit} className="w-full">
          <div className="mx-auto flex w-full max-w-[280px] items-center rounded-full border border-gray-300 bg-white px-4 py-3 shadow-lg sm:max-w-[600px]">
            <input
              type="text"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="min-w-0 flex-1 outline-none text-gray-700 text-sm"
              aria-label="Search proteins"
            />
            <button
              type="submit"
              className="flex-shrink-0 bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 transition-colors duration-200 text-sm font-medium sm:px-6"
            >
              Search
            </button>
          </div>
        </form>
        {error && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2 shadow-sm max-w-[600px]">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
