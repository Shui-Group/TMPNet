import { useState } from "react";
import Head from "next/head";
import Header from "@/components/Header";
import SearchBar from "@/components/SearchBar";

export default function Home() {
  const [searchValue, setSearchValue] = useState("");

  const handleExampleClick = (example: string) => {
    setSearchValue(example);
  };

  return (
    <>
      <Head>
        <title>
          TMPNet - Endogenous transmembrane (TMP) protein interaction network
        </title>
        <meta
          name="description"
          content="Explore the endogenous transmembrane protein interaction network"
        />
      </Head>

      <div className="min-h-screen flex flex-col overflow-x-hidden">
        <Header />

        {/* Hero Section with Background */}
        <main
          className="flex-1 relative flex flex-col items-center justify-center"
          style={{
            backgroundImage: "url(/background.png)",
            backgroundSize: "130%",
            backgroundPosition: "center",
            backgroundColor: "#a8c4e8",
          }}
        >
          {/* Semi-transparent overlay for better text readability */}
          <div className="absolute inset-0 bg-[#a8c4e8]/70"></div>

          {/* Content */}
          <div className="relative z-10 text-center px-4 pt-14 pb-8 max-w-4xl mx-auto">
            {/* Title */}
            <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold text-blue-600 mb-8 sm:mb-10">
              Endogenous
              <span className="sm:hidden">
                <br />
              </span>{" "}
              transmembrane{" "}
              <span className="sm:hidden">
                <br />
              </span>
              (TMP) protein
              <span className="sm:hidden">
                <br />
              </span>{" "}
              interaction
              <span className="sm:hidden">
                <br />
              </span>{" "}
              network
            </h1>

            {/* Stats Section */}
            <div className="grid w-full max-w-[340px] grid-cols-3 items-center justify-center mx-auto sm:max-w-xl">
              <div className="min-w-0 text-center px-2 sm:px-8 border-r border-gray-500">
                <p className="text-[11px] sm:text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  TMPs
                </p>
                <p className="text-xl sm:text-4xl font-bold text-white mt-1">
                  2,953
                </p>
              </div>
              <div className="min-w-0 text-center px-2 sm:px-8 border-r border-gray-500">
                <p className="text-[11px] sm:text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  ASSOCIATIONS
                </p>
                <p className="text-xl sm:text-4xl font-bold text-white mt-1">
                  137,510
                </p>
              </div>
              <div className="min-w-0 text-center px-2 sm:px-8">
                <p className="text-[11px] sm:text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  TISSUES
                </p>
                <p className="text-xl sm:text-4xl font-bold text-white mt-1">
                  22
                </p>
              </div>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative z-10 w-full px-4 pb-10">
            <div className="flex flex-col items-center">
              {/* Search Box */}
              <div className="mb-4 w-full">
                <SearchBar
                  className=""
                  initialValue={searchValue}
                  placeholder="Search by UniProt ID (e.g., P43220, P00533) or Gene Symbol (e.g., EGFR, INSR)"
                />
              </div>

              {/* Search description */}
              <p className="text-sm text-gray-600 mb-3 max-w-sm text-center">
                Search by <span className="font-semibold">UniProt ID</span>{" "}
                (e.g., P43220, P00533) or{" "}
                <span className="sm:hidden">
                  <br />
                </span>
                <span className="font-semibold">Gene Symbol</span> (e.g., EGFR,
                INSR)
              </p>

              {/* Examples and Guide - centered with search box */}
              <div className="text-center">
                <p className="text-sm text-gray-700">
                  Example:{" "}
                  <button
                    onClick={() => handleExampleClick("EGFR")}
                    className="text-red-500 hover:underline font-medium"
                  >
                    EGFR
                  </button>
                  {", "}
                  <button
                    onClick={() => handleExampleClick("INSR")}
                    className="text-red-500 hover:underline font-medium"
                  >
                    INSR
                  </button>
                  {", "}
                  <button
                    onClick={() => handleExampleClick("P43220")}
                    className="text-red-500 hover:underline font-medium"
                  >
                    P43220
                  </button>
                  {", "}
                  <button
                    onClick={() => handleExampleClick("P00533")}
                    className="text-red-500 hover:underline font-medium"
                  >
                    P00533
                  </button>
                </p>
                <p className="text-sm text-gray-600 mt-2 max-w-sm">
                  To query <span className="font-semibold">multiple TMPs</span>,
                  <span className="sm:hidden">
                    <br />
                  </span>{" "}
                  separate gene symbols with (&quot;,&quot;).
                </p>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer
          id="contact"
          className="bg-white border-t border-gray-200 px-4 py-5 text-center"
        >
          <p className="mx-auto max-w-[280px] text-xs text-gray-600 sm:max-w-5xl sm:text-sm">
            If you use images or data from this web application, please cite
            this paper: Proteomics-informed prediction of a tissue-wide
            endogenous transmembrane protein interaction network, TMPNet has
            recently been submitted for publication
          </p>
          <div className="mx-auto mt-4 max-w-5xl break-words text-sm text-gray-600">
            <p className="font-semibold text-gray-800">Contact</p>
            <p>E-mail: shuiwq@shanghaitech.edu.cn</p>
            <p>
              Address: 393 Middle Huaxia Road,
              <span className="sm:hidden">
                <br />
              </span>{" "}
              Pudong, Shanghai, PRC, 201210
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
