import Link from "next/link";

interface HeaderProps {
  title?: string;
}

export default function Header({ title = "TMPNet" }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-4 sm:px-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            {/* Network Icon SVG */}
            <svg
              className="w-8 h-8 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="TMPNet Logo"
            >
              {/* Central node */}
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              {/* Surrounding nodes */}
              <circle cx="6" cy="6" r="1.5" fill="currentColor" />
              <circle cx="18" cy="6" r="1.5" fill="currentColor" />
              <circle cx="6" cy="18" r="1.5" fill="currentColor" />
              <circle cx="18" cy="18" r="1.5" fill="currentColor" />
              {/* Connecting lines */}
              <line x1="12" y1="12" x2="6" y2="6" strokeWidth="1.5" />
              <line x1="12" y1="12" x2="18" y2="6" strokeWidth="1.5" />
              <line x1="12" y1="12" x2="6" y2="18" strokeWidth="1.5" />
              <line x1="12" y1="12" x2="18" y2="18" strokeWidth="1.5" />
            </svg>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          </Link>
        </div>

        <nav className="flex w-full flex-wrap items-center justify-start gap-x-5 gap-y-2 text-sm sm:w-auto sm:gap-6 sm:text-base">
          <Link
            href="/network"
            className="text-gray-600 hover:text-blue-600 font-medium transition-colors"
          >
            Total network
          </Link>
          <button
            type="button"
            disabled
            aria-label="Download unavailable"
            title="Download temporarily unavailable"
            className="cursor-not-allowed font-medium text-gray-400"
          >
            Download
          </button>
          <Link
            href="/#contact"
            className="text-gray-600 hover:text-blue-600 font-medium transition-colors"
          >
            Contact us
          </Link>
        </nav>
      </div>
    </header>
  );
}
