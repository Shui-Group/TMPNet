import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import Header from "@/components/Header";
import LoadingSpinner from "@/components/LoadingSpinner";
import type {
  NodeResponse,
  StructureConfidenceBins,
  StructureDetailResponse,
} from "@/lib/types";

const StructureViewer = dynamic(() => import("@/components/StructureViewer"), {
  ssr: false,
});

const confidenceLegend: Array<{
  key: keyof StructureConfidenceBins;
  label: string;
  range: string;
  color: string;
}> = [
  {
    key: "veryHigh",
    label: "Very high",
    range: "pLDDT > 90",
    color: "bg-[#3554f5]",
  },
  {
    key: "confident",
    label: "Confident",
    range: "70 < pLDDT <= 90",
    color: "bg-[#7fc8f8]",
  },
  {
    key: "low",
    label: "Low",
    range: "50 < pLDDT <= 70",
    color: "bg-[#f3d44d]",
  },
  {
    key: "veryLow",
    label: "Very low",
    range: "pLDDT <= 50",
    color: "bg-[#ee8f43]",
  },
];

function formatScore(value: number | null | undefined, digits = 2) {
  if (value === null || typeof value === "undefined") {
    return "NA";
  }

  return value.toFixed(digits);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "NA";
  }

  return `${Math.round(value * 100)}%`;
}

function buildProteinLabel(protein: NodeResponse | undefined) {
  if (!protein) {
    return "Protein";
  }

  if (protein.geneSymbol) {
    return protein.geneSymbol;
  }

  return protein.id;
}

function summarizeTissues(protein: NodeResponse | undefined) {
  if (!protein || protein.expressionTissue.length === 0) {
    return "No tissue annotation";
  }

  const preview = protein.expressionTissue.slice(0, 5).join(", ");
  const remaining = protein.expressionTissue.length - 5;
  if (remaining <= 0) {
    return preview;
  }

  return `${preview}, +${remaining} more`;
}

export default function StructureDetailPage() {
  const router = useRouter();
  const { modelId } = router.query;
  const modelIdParam = Array.isArray(modelId) ? modelId[0] : modelId;

  const [data, setData] = useState<StructureDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEntered, setIsEntered] = useState(false);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    if (!modelIdParam) {
      setLoading(false);
      setError("Missing structure model id.");
      return;
    }

    const activeModelId = modelIdParam;
    let isMounted = true;

    async function fetchStructure() {
      setLoading(true);
      setError(null);
      setIsEntered(false);

      try {
        const response = await fetch(
          `/api/structures/${encodeURIComponent(activeModelId)}`
        );

        if (response.status === 404) {
          throw new Error("Structure model not found.");
        }

        if (!response.ok) {
          throw new Error("Failed to load structure model.");
        }

        const payload = (await response.json()) as StructureDetailResponse;
        if (!isMounted) {
          return;
        }

        setData(payload);
        requestAnimationFrame(() => setIsEntered(true));
      } catch (fetchError) {
        if (!isMounted) {
          return;
        }

        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load structure model."
        );
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchStructure();

    return () => {
      isMounted = false;
    };
  }, [modelIdParam, router.isReady]);

  const proteins = data?.proteins ?? [];
  const proteinA = proteins[0];
  const proteinB = proteins[1];
  const confidenceSummary = data?.confidenceSummary ?? null;

  const title = useMemo(() => {
    if (!data) {
      return "Structure model";
    }

    return `${buildProteinLabel(proteinA)} / ${buildProteinLabel(
      proteinB
    )} structure model`;
  }, [data, proteinA, proteinB]);

  const cifDownloadUrl = data ? `${data.assets.cif}&download=1` : "#";
  const summaryDownloadUrl = data ? `${data.assets.summary}&download=1` : "#";
  const confidencesDownloadUrl =
    data?.assets.confidences != null
      ? `${data.assets.confidences}&download=1`
      : null;

  return (
    <>
      <Head>
        <title>{title} | MemPPI-Atlas</title>
        <meta
          name="description"
          content="Inspect AlphaFold3 transmembrane protein interaction structure models and residue confidence."
        />
      </Head>

      <div className="min-h-screen bg-[#f5f7f2] text-stone-700">
        <Header />

        <main className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,_rgba(110,144,95,0.18),_transparent_60%)]" />
          <div className="mx-auto max-w-[1440px] px-6 pb-16 pt-8 lg:px-10">
            <div className="mb-8 flex items-center justify-between">
              <Link
                href="/"
                className="inline-flex items-center text-sm font-medium text-stone-600 transition-colors hover:text-stone-900"
              >
                Back to network
              </Link>
              {data && (
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-800">
                  Predicted structure available
                </p>
              )}
            </div>

            {loading && (
              <div className="flex min-h-[60vh] items-center justify-center">
                <LoadingSpinner label="Loading structure model..." size="lg" />
              </div>
            )}

            {!loading && error && (
              <div className="mx-auto max-w-xl rounded-[1.75rem] border border-rose-200 bg-white/90 p-10 text-center shadow-sm">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-700">
                  Structure unavailable
                </p>
                <p className="mt-3 text-base text-stone-600">{error}</p>
              </div>
            )}

            {!loading && !error && data && (
              <div
                className={`space-y-10 transition-all duration-500 ${
                  isEntered
                    ? "translate-y-0 opacity-100"
                    : "translate-y-2 opacity-0"
                }`}
              >
                <section className="border-b border-stone-300/70 pb-8">
                  <div className="max-w-4xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-800">
                      AlphaFold3 interaction model
                    </p>
                    <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
                      {title}
                    </h1>
                    <p className="mt-4 max-w-3xl text-base leading-7 text-stone-600">
                      Inspect the predicted interface, confidence landscape, and
                      supporting interaction evidence for the selected
                      transmembrane protein pair.
                    </p>
                  </div>
                  <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm text-stone-600">
                    <span>
                      <strong className="font-semibold text-stone-900">
                        Model ID:
                      </strong>{" "}
                      {data.model.modelId}
                    </span>
                    <span>
                      <strong className="font-semibold text-stone-900">
                        Variant:
                      </strong>{" "}
                      {data.model.variant}
                    </span>
                    <span>
                      <strong className="font-semibold text-stone-900">
                        Source:
                      </strong>{" "}
                      {data.model.source}
                    </span>
                  </div>
                </section>

                <section className="grid gap-10 lg:grid-cols-[19rem_minmax(0,1fr)]">
                  <aside className="space-y-8 lg:sticky lg:top-8 lg:self-start">
                    <div className="space-y-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                        Model metrics
                      </p>
                      <dl className="space-y-3 border-t border-stone-300/70 pt-4 text-sm">
                        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200/70 pb-3">
                          <dt className="text-stone-500">iPTM</dt>
                          <dd className="font-semibold text-stone-900">
                            {formatScore(data.model.summaryIptm)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200/70 pb-3">
                          <dt className="text-stone-500">pTM</dt>
                          <dd className="font-semibold text-stone-900">
                            {formatScore(data.model.summaryPtm)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200/70 pb-3">
                          <dt className="text-stone-500">Ranking score</dt>
                          <dd className="font-semibold text-stone-900">
                            {formatScore(data.model.summaryRankingScore)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200/70 pb-3">
                          <dt className="text-stone-500">Disordered fraction</dt>
                          <dd className="font-semibold text-stone-900">
                            {formatPercent(data.model.summaryFractionDisordered)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <dt className="text-stone-500">Clash detected</dt>
                          <dd className="font-semibold text-stone-900">
                            {data.model.summaryHasClash ? "Yes" : "No"}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="space-y-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                        Interaction evidence
                      </p>
                      <dl className="space-y-3 border-t border-stone-300/70 pt-4 text-sm">
                        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200/70 pb-3">
                          <dt className="text-stone-500">Positive type</dt>
                          <dd className="font-semibold capitalize text-stone-900">
                            {data.edge.positiveType || "NA"}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200/70 pb-3">
                          <dt className="text-stone-500">Fusion prediction</dt>
                          <dd className="font-semibold text-stone-900">
                            {formatScore(data.edge.fusionPredProb, 3)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200/70 pb-3">
                          <dt className="text-stone-500">Enriched tissue</dt>
                          <dd className="font-semibold text-stone-900">
                            {data.edge.enrichedTissue ?? "NA"}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200/70 pb-3">
                          <dt className="text-stone-500">STRING score</dt>
                          <dd className="font-semibold text-stone-900">
                            {data.edge.stringCombinedScore ?? "NA"}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200/70 pb-3">
                          <dt className="text-stone-500">BioGRID system</dt>
                          <dd className="text-right font-semibold text-stone-900">
                            {data.edge.biogridExperimentalSystemType ?? "NA"}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <dt className="text-stone-500">HitPredict</dt>
                          <dd className="font-semibold text-stone-900">
                            {data.edge.hitpredictConfidence ?? "NA"}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="space-y-4 border-t border-stone-300/70 pt-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                        Downloads
                      </p>
                      <div className="flex flex-col gap-2 text-sm">
                        <a
                          href={cifDownloadUrl}
                          className="inline-flex items-center justify-between border-b border-stone-200/70 pb-2 text-stone-700 transition-colors hover:text-emerald-800"
                        >
                          <span>Model CIF</span>
                          <span>Open</span>
                        </a>
                        <a
                          href={summaryDownloadUrl}
                          className="inline-flex items-center justify-between border-b border-stone-200/70 pb-2 text-stone-700 transition-colors hover:text-emerald-800"
                        >
                          <span>Summary confidences</span>
                          <span>Open</span>
                        </a>
                        {confidencesDownloadUrl && (
                          <a
                            href={confidencesDownloadUrl}
                            className="inline-flex items-center justify-between border-b border-stone-200/70 pb-2 text-stone-700 transition-colors hover:text-emerald-800"
                          >
                            <span>Full confidences JSON</span>
                            <span>Open</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </aside>

                  <div className="space-y-8">
                    <StructureViewer
                      cifUrl={data.assets.cif}
                      downloadUrl={cifDownloadUrl}
                    />

                    <section className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_19rem]">
                      <div className="space-y-5 rounded-[2rem] border border-stone-300/70 bg-white/80 p-6 shadow-[0_25px_60px_-45px_rgba(34,57,30,0.45)] backdrop-blur">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                            Protein descriptors
                          </p>
                        </div>
                        <div className="grid gap-6 md:grid-cols-2">
                          {[proteinA, proteinB].map((protein, index) => (
                            <article key={protein?.id ?? index}>
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
                                Protein {index + 1}
                              </p>
                              <h2 className="mt-2 text-2xl font-semibold text-stone-900">
                                {buildProteinLabel(protein)}
                              </h2>
                              <p className="mt-1 text-sm text-stone-500">
                                {protein?.entryName || protein?.id || "NA"}
                              </p>
                              <p className="mt-4 text-sm leading-6 text-stone-600">
                                {protein?.description || "No description available."}
                              </p>
                              <dl className="mt-5 space-y-2 text-sm text-stone-600">
                                <div className="flex items-start justify-between gap-4">
                                  <dt className="text-stone-500">Family</dt>
                                  <dd className="text-right font-medium text-stone-900">
                                    {protein?.family || "NA"}
                                  </dd>
                                </div>
                                <div className="flex items-start justify-between gap-4">
                                  <dt className="text-stone-500">Accession</dt>
                                  <dd className="text-right font-medium text-stone-900">
                                    {protein?.id || "NA"}
                                  </dd>
                                </div>
                                <div className="flex items-start justify-between gap-4">
                                  <dt className="text-stone-500">Tissues</dt>
                                  <dd className="max-w-[16rem] text-right font-medium text-stone-900">
                                    {summarizeTissues(protein)}
                                  </dd>
                                </div>
                              </dl>
                            </article>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[2rem] border border-stone-300/70 bg-white/90 p-6 shadow-[0_25px_60px_-45px_rgba(34,57,30,0.45)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                          Confidence legend
                        </p>
                        <div className="mt-5 space-y-3">
                          {confidenceSummary ? (
                            confidenceLegend.map((item) => (
                              <div
                                key={item.key}
                                className="flex items-center justify-between gap-3 text-sm"
                              >
                                <div className="flex items-center gap-3">
                                  <span
                                    className={`h-4 w-4 rounded-sm ${item.color}`}
                                  />
                                  <div>
                                    <p className="font-medium text-stone-900">
                                      {item.label}
                                    </p>
                                    <p className="text-xs text-stone-500">
                                      {item.range}
                                    </p>
                                  </div>
                                </div>
                                <span className="font-semibold text-stone-900">
                                  {confidenceSummary.plddtBins[item.key]}
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-stone-600">
                              No residue confidence summary available.
                            </p>
                          )}
                        </div>

                        {confidenceSummary && (
                          <>
                            <div className="mt-6 border-t border-stone-200 pt-5">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                                Summary
                              </p>
                              <dl className="mt-3 space-y-2 text-sm">
                                <div className="flex justify-between gap-4">
                                  <dt className="text-stone-500">Atoms</dt>
                                  <dd className="font-semibold text-stone-900">
                                    {confidenceSummary.atomCount.toLocaleString()}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <dt className="text-stone-500">Residues</dt>
                                  <dd className="font-semibold text-stone-900">
                                    {confidenceSummary.residueCount.toLocaleString()}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <dt className="text-stone-500">Mean pLDDT</dt>
                                  <dd className="font-semibold text-stone-900">
                                    {formatScore(confidenceSummary.meanPlddt)}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <dt className="text-stone-500">Range</dt>
                                  <dd className="font-semibold text-stone-900">
                                      {formatScore(
                                      confidenceSummary.minPlddt
                                    )}{" "}
                                    -{" "}
                                    {formatScore(confidenceSummary.maxPlddt)}
                                  </dd>
                                </div>
                              </dl>
                            </div>

                            <div className="mt-6 border-t border-stone-200 pt-5">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                                Chains
                              </p>
                              <div className="mt-3 space-y-2">
                                {confidenceSummary.chains.map((chain) => (
                                  <div
                                    key={chain.chainId}
                                    className="flex items-center justify-between text-sm"
                                  >
                                    <span className="text-stone-600">
                                      Chain {chain.chainId}
                                    </span>
                                    <span className="font-semibold text-stone-900">
                                      {formatScore(chain.meanPlddt)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </section>
                  </div>
                </section>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
