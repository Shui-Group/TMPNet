import { render, screen } from "@testing-library/react";

import Header from "@/components/Header";

describe("Header", () => {
  it("renders Download as temporarily unavailable", () => {
    render(<Header />);

    const download = screen.getByRole("button", {
      name: "Download unavailable",
    });
    expect(download).toBeDisabled();
    expect(download).toHaveAttribute(
      "title",
      "Download temporarily unavailable"
    );
  });
});
