import { act, fireEvent, render, screen } from "@testing-library/react";

import Header from "@/components/Header";

describe("Header", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("downloads the versioned 20260627 public graph CSV files", () => {
    const clickedDownloads: Array<{ href: string; download: string }> = [];
    const originalCreateElement = document.createElement.bind(document);

    jest.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = originalCreateElement(tagName);

      if (tagName.toLowerCase() === "a") {
        jest.spyOn(element, "click").mockImplementation(() => {
          const link = element as HTMLAnchorElement;
          clickedDownloads.push({
            href: link.getAttribute("href") ?? "",
            download: link.download,
          });
        });
      }

      return element;
    });

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(clickedDownloads).toEqual([
      { href: "/20260627_nodes.csv", download: "20260627_nodes.csv" },
      { href: "/20260627_edges.csv", download: "20260627_edges.csv" },
    ]);
  });
});
