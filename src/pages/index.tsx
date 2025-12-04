import { useState, useEffect } from "react";
import Head from "next/head";
import Header from "@/components/Header";
import SearchBar from "@/components/SearchBar";
import type { NetworkStats } from "@/lib/types";

export default function Home() {
    const [stats, setStats] = useState<NetworkStats | null>(null);
    const [searchValue, setSearchValue] = useState("");

    useEffect(() => {
        async function fetchStats() {
            try {
                const response = await fetch("/api/network/stats");
                if (response.ok) {
                    const data = await response.json();
                    setStats(data);
                }
            } catch (err) {
                console.error("Error fetching stats:", err);
            }
        }
        fetchStats();
    }, []);

    const handleExampleClick = (example: string) => {
        setSearchValue(example);
    };

    // Default stats if API is not available
    const displayStats = {
        proteins: stats?.totalNodes ?? 2686,
        interactions: stats?.totalEdges ?? 980393,
        tissues: 22,
    };

    return (
        <>
            <Head>
                <title>MemPPI - Endogenous TMP-TMP Interaction Networks</title>
                <meta
                    name="description"
                    content="Explore endogenous transmembrane protein-protein interaction networks"
                />
            </Head>

            <div className="min-h-screen flex flex-col">
                <Header />

                {/* Hero Section with Background */}
                <main
                    className="flex-1 relative flex flex-col items-center justify-center"
                    style={{
                        backgroundImage: "url(/background.png)",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundColor: "#a8c4e8",
                    }}
                >
                    {/* Semi-transparent overlay for better text readability */}
                    <div className="absolute inset-0 bg-[#a8c4e8]/70"></div>

                    {/* Content */}
                    <div className="relative z-10 text-center px-4 py-16 max-w-4xl mx-auto">
                        {/* Title */}
                        <h1 className="text-4xl md:text-5xl font-bold text-blue-600 mb-12">
                            Endogenous TMP -TMP interaction Networks
                        </h1>

                        {/* Stats Section */}
                        <div className="flex justify-center items-center gap-0 mb-16">
                            <div className="text-center px-8 border-r border-gray-500">
                                <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                                    PROTEINS
                                </p>
                                <p className="text-4xl font-bold text-white mt-1">
                                    {displayStats.proteins.toLocaleString()}
                                </p>
                            </div>
                            <div className="text-center px-8 border-r border-gray-500">
                                <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                                    INTERACTIONS
                                </p>
                                <p className="text-4xl font-bold text-white mt-1">
                                    {displayStats.interactions.toLocaleString()}
                                </p>
                            </div>
                            <div className="text-center px-8">
                                <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                                    TISSUES
                                </p>
                                <p className="text-4xl font-bold text-white mt-1">
                                    {displayStats.tissues}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Search Box - Bottom Right */}
                    <div className="absolute bottom-8 right-8 z-10">
                        <div className="flex flex-col items-center">
                            {/* Search Box */}
                            <div className="mb-4">
                                <SearchBar
                                    className=""
                                    initialValue={searchValue}
                                    placeholder="Search for Gene Symbol or Uniprot id"
                                />
                            </div>

                            {/* Examples and Guide - centered with search box */}
                            <div className="text-center">
                                <p className="text-sm text-gray-700">
                                    Example:{" "}
                                    <button
                                        onClick={() => handleExampleClick("GLP1R")}
                                        className="text-red-500 hover:underline font-medium"
                                    >
                                        GLP1R
                                    </button>
                                    {" ,"}
                                    <button
                                        onClick={() => handleExampleClick("ADGRE5")}
                                        className="text-red-500 hover:underline font-medium"
                                    >
                                        ADGRE5
                                    </button>
                                    {","}
                                    <button
                                        onClick={() => handleExampleClick("EGFR")}
                                        className="text-red-500 hover:underline font-medium"
                                    >
                                        EGFR
                                    </button>
                                </p>
                                <p className="text-sm text-gray-600 mt-2">
                                    To query <span className="font-semibold">multiple proteins</span>,
                                    separate gene symbols with (&quot;,&quot;).{" "}
                                    <span className="text-blue-500 cursor-not-allowed">See help</span>
                                </p>
                            </div>
                        </div>
                    </div>
                </main>

                {/* Footer */}
                <footer className="bg-white border-t border-gray-200 py-4 text-center">
                    <p className="text-sm text-gray-600">
                        If you use images or data from this web application, please{" "}
                        <span className="text-red-500 font-medium">cite</span> these papers:
                        XXXXXXXXXXXXXXXXX
                    </p>
                </footer>
            </div>
        </>
    );
}
