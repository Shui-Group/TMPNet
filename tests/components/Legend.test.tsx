import React from "react";
import { render, screen } from "@testing-library/react";
import Legend from "@/components/Legend";

describe("Legend", () => {
  it("renders node and edge legend items", () => {
    render(<Legend />);

    expect(screen.getByText("Legend")).toBeInTheDocument();
    expect(screen.getByText("Experimental")).toBeInTheDocument();
    expect(screen.getByText("Predicted/Other")).toBeInTheDocument();
    expect(screen.getByText("GPCRs")).toBeInTheDocument();
  });
});
