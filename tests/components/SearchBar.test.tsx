import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import SearchBar from "@/components/SearchBar";

const pushMock = jest.fn();

jest.mock("next/router", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

beforeEach(() => {
  pushMock.mockClear();
});

describe("SearchBar", () => {
  it("shows validation error for invalid protein IDs", () => {
    render(<SearchBar />);

    const input = screen.getByLabelText("Search proteins");
    fireEvent.change(input, { target: { value: "invalid-id" } });
    fireEvent.click(screen.getByText("Search"));

    expect(screen.getByText(/Invalid format/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates to subgraph with sanitized, uppercase IDs", () => {
    render(<SearchBar />);

    const input = screen.getByLabelText("Search proteins");
    fireEvent.change(input, { target: { value: "p12345, q67890 " } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/subgraph?proteins=P12345,Q67890");
  });
});
