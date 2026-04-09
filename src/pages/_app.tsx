import "@/styles/globals.css";
import type { AppProps } from "next/app";
import AppErrorBoundary from "@/components/AppErrorBoundary";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div>
      <AppErrorBoundary>
        <Component {...pageProps} />
      </AppErrorBoundary>
    </div>
  );
}
