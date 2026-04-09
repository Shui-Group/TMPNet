import Link from "next/link";

interface HeaderProps {
  title?: string;
}

export default function Header({ title = "MemPPI" }: HeaderProps) {
  const handleDownload = () => {
    // Trigger downloads for the latest prepared dataset files.
    const link1 = document.createElement("a");
    link1.href = "/20260407_nodes.csv";
    link1.download = "20260407_nodes.csv";
    document.body.appendChild(link1);
    link1.click();
    document.body.removeChild(link1);

    setTimeout(() => {
      const link2 = document.createElement("a");
      link2.href = "/20260407_edges.csv";
      link2.download = "20260407_edges.csv";
      document.body.appendChild(link2);
      link2.click();
      document.body.removeChild(link2);
    }, 500);
  };

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            {/* Network Icon SVG */}
            <svg
              className="w-8 h-8 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="MemPPI-Atlas Logo"
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

        <nav className="flex items-center gap-6">
          <Link href="/network" className="text-gray-600 hover:text-blue-600 font-medium transition-colors">
            Total network
          </Link>
          <button
            onClick={handleDownload}
            className="text-gray-600 hover:text-blue-600 font-medium transition-colors"
          >
            Download
          </button>
          <span className="text-gray-400 cursor-not-allowed font-medium">
            Help
          </span>
          <span className="text-gray-400 cursor-not-allowed font-medium">
            Contact us
          </span>
        </nav>
      </div>
    </header>
  );
}
