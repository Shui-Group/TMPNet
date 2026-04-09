import { useEffect, useRef, useState } from "react";

const NGL_SCRIPT_SRC = "https://unpkg.com/ngl@2.3.0/dist/ngl.js";

type StructureViewerProps = {
  cifUrl: string;
  downloadUrl: string;
  className?: string;
};

type NglStageInstance = {
  loadFile: (
    file: string,
    params?: Record<string, unknown>
  ) => Promise<{
    addRepresentation: (
      type: string,
      params?: Record<string, unknown>
    ) => void;
    autoView: () => void;
  }>;
  removeAllComponents: () => void;
  autoView: () => void;
  handleResize: () => void;
  setParameters: (params: Record<string, unknown>) => void;
  dispose: () => void;
};

declare global {
  interface Window {
    NGL?: {
      Stage: new (
        element: HTMLElement,
        params?: Record<string, unknown>
      ) => NglStageInstance;
    };
    __nglLoaderPromise__?: Promise<void>;
  }
}

function loadNglScript() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.NGL) {
    return Promise.resolve();
  }

  if (!window.__nglLoaderPromise__) {
    window.__nglLoaderPromise__ = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = NGL_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Failed to load the NGL viewer script"));
      document.head.appendChild(script);
    });
  }

  return window.__nglLoaderPromise__;
}

export default function StructureViewer({
  cifUrl,
  downloadUrl,
  className = "",
}: StructureViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<NglStageInstance | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function initializeViewer() {
      if (!containerRef.current) {
        return;
      }

      try {
        setViewerError(null);
        setIsReady(false);
        await loadNglScript();

        if (!isMounted || !containerRef.current || !window.NGL) {
          return;
        }

        if (!stageRef.current) {
          stageRef.current = new window.NGL.Stage(containerRef.current, {
            backgroundColor: "white",
          });
        }

        const stage = stageRef.current;
        stage.setParameters({ backgroundColor: "white" });
        stage.removeAllComponents();

        const component = await stage.loadFile(cifUrl, {
          ext: "cif",
          defaultRepresentation: false,
        });

        if (!isMounted) {
          return;
        }

        component.addRepresentation("cartoon", {
          color: "bfactor",
          smoothSheet: true,
        });
        component.addRepresentation("licorice", {
          sele: "sidechainAttached",
          color: "bfactor",
          opacity: 0.35,
        });
        component.autoView();
        setIsReady(true);
      } catch (error) {
        console.error("Failed to initialise NGL viewer:", error);
        if (isMounted) {
          setViewerError(
            error instanceof Error
              ? error.message
              : "Failed to initialise structure viewer"
          );
        }
      }
    }

    initializeViewer();

    return () => {
      isMounted = false;
    };
  }, [cifUrl]);

  useEffect(() => {
    const handleResize = () => {
      stageRef.current?.handleResize();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    return () => {
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, []);

  const handleResetView = () => {
    stageRef.current?.autoView();
  };

  const handleFullscreen = async () => {
    if (!containerRef.current) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch (error) {
      console.error("Failed to toggle fullscreen viewer:", error);
    }
  };

  return (
    <section
      className={`overflow-hidden rounded-[2rem] border border-stone-300/70 bg-white shadow-[0_30px_80px_-50px_rgba(34,57,30,0.55)] ${className}`}
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 sm:px-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
            Structure Viewer
          </p>
          <p className="mt-1 text-sm text-stone-600">
            AlphaFold3 model colored by residue confidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetView}
            className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-50"
          >
            Reset view
          </button>
          <button
            type="button"
            onClick={handleFullscreen}
            className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-50"
          >
            Full screen
          </button>
          <a
            href={downloadUrl}
            className="rounded-full bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Download CIF
          </a>
        </div>
      </div>

      <div className="relative bg-white">
        <div ref={containerRef} className="h-[420px] w-full sm:h-[520px]" />

        {!isReady && !viewerError && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-50/80">
            <div className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600 shadow-sm">
              Loading structure viewer...
            </div>
          </div>
        )}

        {viewerError && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-50/90 px-6">
            <div className="max-w-sm text-center">
              <p className="text-sm font-semibold text-rose-700">
                Viewer unavailable
              </p>
              <p className="mt-2 text-sm text-stone-600">{viewerError}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
