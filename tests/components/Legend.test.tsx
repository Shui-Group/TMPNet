import React from "react";
import { render, screen } from "@testing-library/react";
import Legend from "@/components/Legend";

describe("Legend", () => {
  it("renders node and edge legend items", () => {
    render(<Legend />);

    expect(screen.getByText("Legend")).toBeInTheDocument();
    expect(screen.getByText("Association evidences")).toBeInTheDocument();
    expect(screen.getByText("Additional")).toBeInTheDocument();
    expect(screen.getByText("TMPNet")).toBeInTheDocument();
    expect(screen.queryByText("Reported")).not.toBeInTheDocument();
    expect(screen.queryByText("TMPNet predicted")).not.toBeInTheDocument();
    expect(screen.getByText("TMP families")).toBeInTheDocument();
    expect(screen.getByText("GPCRs")).toBeInTheDocument();
    expect(screen.getByText("Ion channels")).toBeInTheDocument();
  });
});
