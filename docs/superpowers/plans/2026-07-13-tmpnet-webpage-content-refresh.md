# TMPNet Webpage Content Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the current TMPNet homepage, total-network sidebar, shared legend, single/multiple protein result views, and related tables to match the 2026-07-13 review notes while leaving unavailable images, counts, and copy behind explicit external-input gates.

**Architecture:** Keep the existing Next.js Pages Router structure and make surgical changes in the current page/components. Put the four externally supplied total-network counts and its optional explanatory sentence in one small content module so missing values render as an em dash instead of being inferred from inconsistent current totals. Keep API field names such as `geneSymbol` and `positive_type` unchanged; this work changes presentation terminology and source labeling only, except for the later external-data ingestion task.

**Tech Stack:** Next.js 14 Pages Router, React 18, TypeScript, Tailwind CSS, Cytoscape.js, Jest, React Testing Library

## Global Constraints

- Change user-visible `Gene Symbol` wording to `Protein Symbol`; do not rename `geneSymbol`, `gene_symbol`, `gene_symbol1`, `gene_symbol2`, or the existing lookup behavior.
- Remove user-visible `1-hop` and `rapid` wording from the search-result page; internal API comments may retain graph-theory terminology.
- Display association sources as `Additional` and `TMPNet`; map current `experiment` evidence to `Additional` and current `prediction` evidence to `TMPNet` until the replacement table is received.
- Use a light line for Additional and a dark line for TMPNet in every total-network and sub-network rendering path.
- Do not derive TMPNet/Additional counts by subtracting the homepage numbers from the generated artifact totals. The current sources disagree and overlap semantics have not been confirmed.
- Preserve the current address until replacement instructions are supplied.
- Preserve the current contact email until the replacement email is supplied.
- Preserve CSV export field names; this plan changes table headings, not downloaded schema.
- Do not touch the existing untracked `docs/webpage-modifications.md`, `docs/webpage-modifications-media/`, or `docs/网页修改.docx` files.
- `TODO(external-input:homepage-network-background)`: obtain the approved network background image and its crop/focal-point instruction.
- `TODO(external-input:homepage-tissue-figure)`: obtain the approved tissue figure and annotated placement.
- `TODO(external-input:contact-email)`: obtain the replacement contact email.
- `TODO(external-input:network-statistics)`: obtain exact values for TMPNet nodes, Additional nodes, TMPNet pairs, and Additional pairs.
- `TODO(external-input:network-statistics-description)`: obtain the gray explanatory sentence under Network Statistics.
- `TODO(external-input:multiple-query-description)`: obtain the approved subtitle for the multiple-query association map.
- `TODO(external-input:replacement-table)`: obtain the replacement data table and confirm the exact source column containing `TMPNet`/`Additional`.
- `TODO(external-input:iprox-scope)`: confirm whether the handwritten `S01-S65` iProX renaming and `non-TMP` note belong to this repository; do not implement them as webpage changes without a file/scope confirmation.

---

## File Map

**Create:**

- `src/lib/networkStatisticsContent.ts` — the four externally supplied counts, optional gray description, and null-safe formatting.
- `tests/unit/networkStatisticsContent.test.ts` — formatting contract for supplied and pending counts.

**Modify:**

- `src/pages/index.tsx` — homepage search terminology; later, approved images/layout and email.
- `src/components/SearchBar.tsx` — default placeholder and validation copy.
- `src/components/Sidebar.tsx` — four network statistics, pending-value display, gray note, and fixed family ordering.
- `src/lib/familyBuckets.json` — normalize the current artifact aliases `Ion channel` and `Other TMP` to the Legend buckets.
- `src/components/Legend.tsx` — `Additional`/`TMPNet` labels.
- `src/lib/graphUtils.ts` — shared light/dark edge-color mapping.
- `scripts/build-network-artifacts.js` — matching colors embedded in generated Cytoscape artifacts.
- `public/generated/network/overview.cyto.json` — regenerated total-network artifact containing the corrected colors.
- `src/pages/subgraph.tsx` — single/multiple titles, descriptions, summary cards, queried-protein section removal, and table copy.
- `tests/pages/index.test.tsx`
- `tests/components/SearchBar.test.tsx`
- `tests/components/Sidebar.test.tsx`
- `tests/components/Legend.test.tsx`
- `tests/unit/graphUtils.test.ts`
- `tests/unit/build-network-artifacts.test.js`
- `tests/pages/subgraph.test.tsx`

**External-input task only; exact files are not known yet:**

- `public/<approved-network-background-file>`
- `public/<approved-tissue-figure-file>`
- `data/raw/20260627_web_data/<replacement-table-file>` or a newer confirmed dataset directory
- `scripts/prepare-csvs-for-import.js` only if the supplied table requires a new source-column mapping

---

### Task 1: Change User-Visible Search Terminology

**Files:**

- Modify: `tests/pages/index.test.tsx`
- Modify: `tests/components/SearchBar.test.tsx`
- Modify: `src/pages/index.tsx:93-155`
- Modify: `src/components/SearchBar.tsx:10-63`

**Interfaces:**

- Consumes: the existing `SearchBar` props and comma-separated identifier behavior.
- Produces: user-visible `Protein Symbol` wording while preserving `/subgraph?proteins=...` routing and all internal gene-symbol fields.

- [ ] **Step 1: Make the homepage SearchBar mock expose its placeholder**

Replace the current SearchBar mock in `tests/pages/index.test.tsx` with:

```tsx
jest.mock(
  "@/components/SearchBar",
  () =>
    ({ placeholder }: { placeholder?: string }) =>
      (
        <div data-testid="search" data-placeholder={placeholder}>
          Search
        </div>
      )
);
```

- [ ] **Step 2: Write failing homepage terminology assertions**

Add these assertions to `renders the required TMPNet hero content`:

```tsx
expect(screen.getByTestId("search")).toHaveAttribute(
  "data-placeholder",
  "Search by UniProt ID (e.g., P43220, P00533) or Protein Symbol (e.g., EGFR, INSR)"
);
expect(screen.getByText("Protein Symbol")).toBeInTheDocument();
expect(screen.getByText(/separate protein symbols/i)).toBeInTheDocument();
expect(screen.queryByText("Gene Symbol")).not.toBeInTheDocument();
```

- [ ] **Step 3: Write failing SearchBar default-copy assertions**

Add this test to `tests/components/SearchBar.test.tsx`:

```tsx
it("uses Protein Symbol terminology in its user-visible copy", () => {
  render(<SearchBar />);

  const input = screen.getByLabelText("Search proteins");
  expect(input).toHaveAttribute(
    "placeholder",
    "Search for Protein Symbol or UniProt ID"
  );

  fireEvent.change(input, { target: { value: "invalid-id" } });
  fireEvent.click(screen.getByText("Search"));

  expect(
    screen.getByText(
      "Invalid format. Please use valid Protein Symbols or UniProt IDs (alphanumeric)."
    )
  ).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the focused tests and verify they fail**

Run:

```bash
rtk npm test -- --runInBand tests/pages/index.test.tsx tests/components/SearchBar.test.tsx
```

Expected: FAIL because the current UI still says `Gene Symbol` and `gene symbols`.

- [ ] **Step 5: Change only the user-visible homepage strings**

In `src/pages/index.tsx`, use exactly:

```tsx
placeholder =
  "Search by UniProt ID (e.g., P43220, P00533) or Protein Symbol (e.g., EGFR, INSR)";
```

```tsx
<span className="font-semibold">Protein Symbol</span> (e.g., EGFR, INSR)
```

```tsx
separate protein symbols with (&quot;,&quot;).
```

Do not change the example values or routing.

- [ ] **Step 6: Change only the user-visible SearchBar defaults/errors**

In `src/components/SearchBar.tsx`, use exactly:

```tsx
placeholder = "Search for Protein Symbol or UniProt ID",
```

```tsx
setError(
  "Invalid format. Please use valid Protein Symbols or UniProt IDs (alphanumeric)."
);
```

Leave internal comments and `queryString` behavior unchanged unless a comment incorrectly claims a user-visible term.

- [ ] **Step 7: Run the focused tests and verify they pass**

Run:

```bash
rtk npm test -- --runInBand tests/pages/index.test.tsx tests/components/SearchBar.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit the terminology change**

```bash
rtk git add src/pages/index.tsx src/components/SearchBar.tsx tests/pages/index.test.tsx tests/components/SearchBar.test.tsx
rtk git commit -m "fix(copy): use protein symbol terminology"
```

---

### Task 2: Add Pending-Safe Total-Network Statistics and Fixed Family Order

**Files:**

- Create: `src/lib/networkStatisticsContent.ts`
- Create: `tests/unit/networkStatisticsContent.test.ts`
- Modify: `tests/components/Sidebar.test.tsx`
- Modify: `src/components/Sidebar.tsx:1-80`
- Modify: `src/lib/familyBuckets.json`
- Modify: `tests/unit/graphUtils.test.ts`

**Interfaces:**

- Produces: `networkStatisticsContent` with four `number | null` values and `description: string | null`.
- Produces: `formatNetworkStatistic(value: number | null): string`.
- Consumes: existing `NetworkStats.familyCounts`; no API contract change is required.

- [ ] **Step 1: Write the failing pending-value formatter test**

Create `tests/unit/networkStatisticsContent.test.ts`:

```ts
import {
  formatNetworkStatistic,
  networkStatisticsContent,
} from "@/lib/networkStatisticsContent";

describe("networkStatisticsContent", () => {
  it("uses null placeholders until reviewed counts are supplied", () => {
    expect(networkStatisticsContent).toEqual({
      tmpnetNodes: null,
      additionalNodes: null,
      tmpnetPairs: null,
      additionalPairs: null,
      description: null,
    });
  });

  it("formats supplied counts and renders pending counts as an em dash", () => {
    expect(formatNetworkStatistic(137510)).toBe("137,510");
    expect(formatNetworkStatistic(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run the formatter test and verify it fails**

Run:

```bash
rtk npm test -- --runInBand tests/unit/networkStatisticsContent.test.ts
```

Expected: FAIL because `src/lib/networkStatisticsContent.ts` does not exist.

- [ ] **Step 3: Add the explicit external-input content module**

Create `src/lib/networkStatisticsContent.ts`:

```ts
type NetworkStatisticsContent = {
  tmpnetNodes: number | null;
  additionalNodes: number | null;
  tmpnetPairs: number | null;
  additionalPairs: number | null;
  description: string | null;
};

export const networkStatisticsContent: NetworkStatisticsContent = {
  // TODO(external-input:network-statistics): replace all four nulls only with
  // reviewed counts supplied by the project owner. Do not derive by subtraction.
  tmpnetNodes: null,
  additionalNodes: null,
  tmpnetPairs: null,
  additionalPairs: null,
  // TODO(external-input:network-statistics-description): insert approved copy.
  description: null,
};

export const formatNetworkStatistic = (value: number | null): string =>
  value === null ? "—" : value.toLocaleString();
```

- [ ] **Step 4: Run the formatter test and verify it passes**

Run:

```bash
rtk npm test -- --runInBand tests/unit/networkStatisticsContent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Replace Sidebar test fixtures with deliberately shuffled family data**

Use this `familyCounts` value in `tests/components/Sidebar.test.tsx`:

```tsx
familyCounts: {
  "Other TMP": 2617,
  Transporter: 742,
  "Ion channel": 315,
  GPCR: 388,
  "Catalytic receptors": 216,
},
```

Add assertions:

```tsx
expect(screen.getByText("TMPNet nodes")).toBeInTheDocument();
expect(screen.getByText("Additional nodes")).toBeInTheDocument();
expect(screen.getByText("TMPNet pairs")).toBeInTheDocument();
expect(screen.getByText("Additional pairs")).toBeInTheDocument();
expect(screen.getAllByText("—")).toHaveLength(4);
expect(screen.queryByText("Total nodes")).not.toBeInTheDocument();
expect(screen.queryByText("Total edges")).not.toBeInTheDocument();

expect(
  screen.getAllByTestId("family-row").map((row) => row.textContent)
).toEqual([
  "GPCRs388",
  "Ion channels315",
  "Transporters742",
  "Catalytic receptors216",
  "Other TMPs2,617",
]);
```

Remove the old assertions that expect the meta totals `200` and `500`; the four reviewed categories replace those fields.

- [ ] **Step 6: Run the Sidebar test and verify it fails**

Run:

```bash
rtk npm test -- --runInBand tests/components/Sidebar.test.tsx
```

Expected: FAIL because Sidebar still renders total nodes/edges and sorts families by count.

- [ ] **Step 7: Add current artifact aliases to family normalization**

Make `src/lib/familyBuckets.json` exactly:

```json
{
  "TM": "Other TMPs",
  "TM(GPCR)": "GPCR",
  "TM(IC)": "Ion-channels",
  "TM(Trans)": "Transporter",
  "TM(RTK)": "Catalytic receptors",
  "Ion channel": "Ion-channels",
  "Other TMP": "Other TMPs"
}
```

Add to `normalizes raw dataset family codes into legend buckets` in `tests/unit/graphUtils.test.ts`:

```ts
expect(normalizeFamily("Ion channel")).toBe("Ion-channels");
expect(normalizeFamily("Other TMP")).toBe("Other TMPs");
expect(getFamilyLabel("Ion channel")).toBe("Ion channels");
expect(getFamilyLabel("Other TMP")).toBe("Other TMPs");
```

- [ ] **Step 8: Implement the four statistics and normalize family keys before ordering**

Update imports in `src/components/Sidebar.tsx`:

```tsx
import { getFamilyLabel, normalizeFamily } from "@/lib/graphUtils";
import {
  formatNetworkStatistic,
  networkStatisticsContent,
} from "@/lib/networkStatisticsContent";
```

Add above the component:

```tsx
const FAMILY_ORDER = [
  "GPCR",
  "Ion-channels",
  "Transporter",
  "Catalytic receptors",
  "Other TMPs",
] as const;

const orderFamilyCounts = (familyCounts: Record<string, number>) => {
  const normalizedCounts = Object.entries(familyCounts).reduce<
    Record<string, number>
  >((counts, [family, count]) => {
    const normalized = normalizeFamily(family);
    counts[normalized] = (counts[normalized] ?? 0) + count;
    return counts;
  }, {});

  return FAMILY_ORDER.flatMap((family) =>
    normalizedCounts[family] === undefined
      ? []
      : [[family, normalizedCounts[family]] as const]
  );
};
```

Inside the component, add:

```tsx
const orderedFamilyCounts = orderFamilyCounts(stats.familyCounts);
```

Replace the current metadata grid with:

```tsx
<div
  className="grid grid-cols-2 gap-3 text-sm text-gray-600"
  aria-label="Network statistics"
>
  {[
    ["TMPNet nodes", networkStatisticsContent.tmpnetNodes],
    ["Additional nodes", networkStatisticsContent.additionalNodes],
    ["TMPNet pairs", networkStatisticsContent.tmpnetPairs],
    ["Additional pairs", networkStatisticsContent.additionalPairs],
  ].map(([label, value]) => (
    <div key={label as string} className="flex flex-col">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-900">
        {formatNetworkStatistic(value as number | null)}
      </span>
    </div>
  ))}
</div>;
{
  networkStatisticsContent.description && (
    <p className="text-xs leading-5 text-gray-500">
      {networkStatisticsContent.description}
    </p>
  );
}
```

Keep `meta` in the prop interface because `src/pages/network.tsx` already supplies it, but do not display server timing or use meta totals for the four reviewed categories.

Change the component signature so the retained compatibility prop is not destructured unused:

```tsx
export default function Sidebar({ stats }: SidebarProps) {
```

Replace the family mapping with:

```tsx
{
  orderedFamilyCounts.map(([family, count]) => (
    <div
      key={family}
      data-testid="family-row"
      className="flex justify-between text-sm text-gray-700"
    >
      <span>{getFamilyLabel(family)}</span>
      <span className="font-semibold">{count.toLocaleString()}</span>
    </div>
  ));
}
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
rtk npm test -- --runInBand tests/unit/networkStatisticsContent.test.ts tests/unit/graphUtils.test.ts tests/components/Sidebar.test.tsx tests/pages/network.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit the pending-safe statistics UI**

```bash
rtk git add src/lib/networkStatisticsContent.ts src/lib/familyBuckets.json src/components/Sidebar.tsx tests/unit/networkStatisticsContent.test.ts tests/unit/graphUtils.test.ts tests/components/Sidebar.test.tsx
rtk git commit -m "feat(network): split reviewed network statistics"
```

---

### Task 3: Rename Association Sources and Reverse Their Line Colors Everywhere

**Files:**

- Modify: `tests/components/Legend.test.tsx`
- Modify: `tests/unit/graphUtils.test.ts`
- Modify: `tests/unit/build-network-artifacts.test.js`
- Modify: `src/components/Legend.tsx:26-29`
- Modify: `src/lib/graphUtils.ts:50-73`
- Modify: `scripts/build-network-artifacts.js:450-466`
- Regenerate: `public/generated/network/overview.cyto.json`

**Interfaces:**

- Consumes: current normalized evidence values: `experiment` means Additional/Reported; `prediction` means TMPNet predicted.
- Produces: Additional `#C9DBF8` and TMPNet `#4C6FB9` in live subgraphs and generated total-network artifacts.

- [ ] **Step 1: Update Legend expectations first**

Replace the two source assertions in `tests/components/Legend.test.tsx` with:

```tsx
expect(screen.getByText("Additional")).toBeInTheDocument();
expect(screen.getByText("TMPNet")).toBeInTheDocument();
expect(screen.queryByText("Reported")).not.toBeInTheDocument();
expect(screen.queryByText("TMPNet predicted")).not.toBeInTheDocument();
```

- [ ] **Step 2: Add explicit light/dark color assertions**

In `tests/unit/graphUtils.test.ts`, add to `describe("getEdgeColor")`:

```ts
it("uses a light line for Additional and a dark line for TMPNet", () => {
  expect(edgeColors.experimental).toBe("#C9DBF8");
  expect(edgeColors.predicted).toBe("#4C6FB9");
});
```

- [ ] **Step 3: Extend artifact fixture and assert embedded colors**

In `tests/unit/build-network-artifacts.test.js`, make the fixture edges:

```js
[
  "edge,protein1,protein2,fusion_pred_prob,enriched_tissue,positive_type",
  "P1_P2,P1,P2,0.95,brain,prediction",
  "P2_P1,P2,P1,0.80,heart,experiment",
].join("\n");
```

Change `--overview-limit` from `1` to `2`, then add:

```js
const edgeColors = Object.fromEntries(
  overview.elements
    .filter((element) => element.data.source && element.data.target)
    .map((element) => [element.data.positiveType, element.data.color])
);
expect(edgeColors.prediction).toBe("#4C6FB9");
expect(edgeColors.experiment).toBe("#C9DBF8");
```

- [ ] **Step 4: Run focused tests and verify they fail**

Run:

```bash
rtk npm test -- --runInBand tests/components/Legend.test.tsx tests/unit/graphUtils.test.ts tests/unit/build-network-artifacts.test.js
```

Expected: FAIL because labels and colors are currently reversed.

- [ ] **Step 5: Update live legend labels and shared colors**

In `src/components/Legend.tsx`:

```tsx
const edgeItems: LegendItem[] = [
  { color: edgeColors.experimental, label: "Additional" },
  { color: edgeColors.predicted, label: "TMPNet" },
];
```

In `src/lib/graphUtils.ts`:

```ts
export const edgeColors = {
  experimental: "#C9DBF8",
  predicted: "#4C6FB9",
};
```

Keep the internal keys to avoid a broad schema refactor.

- [ ] **Step 6: Update colors embedded by the artifact builder**

In `scripts/build-network-artifacts.js`, change only the edge color expression:

```js
color: edge.positiveType.includes("experiment") ? "#C9DBF8" : "#4C6FB9",
```

- [ ] **Step 7: Run focused tests and verify they pass**

Run:

```bash
rtk npm test -- --runInBand tests/components/Legend.test.tsx tests/unit/graphUtils.test.ts tests/unit/build-network-artifacts.test.js
```

Expected: PASS.

- [ ] **Step 8: Regenerate the tracked total-network artifact**

Run:

```bash
rtk npm run build:network-artifacts
```

Expected: `public/generated/network/overview.cyto.json` is regenerated; `stats.json` may be rewritten without semantic count changes.

- [ ] **Step 9: Verify the generated artifact contains both corrected colors**

Run:

```bash
rtk proxy rg -o '"positiveType":"experiment[^"]*"[^}]*"color":"#[A-Fa-f0-9]{6}"|"positiveType":"prediction"[^}]*"color":"#[A-Fa-f0-9]{6}"' public/generated/network/overview.cyto.json | head
```

Expected: experimental records use `#C9DBF8`; prediction records use `#4C6FB9`.

- [ ] **Step 10: Commit labels, colors, and regenerated artifact**

```bash
rtk git add src/components/Legend.tsx src/lib/graphUtils.ts scripts/build-network-artifacts.js public/generated/network/overview.cyto.json public/generated/network/stats.json tests/components/Legend.test.tsx tests/unit/graphUtils.test.ts tests/unit/build-network-artifacts.test.js
rtk git commit -m "fix(network): distinguish TMPNet and additional associations"
```

---

### Task 4: Simplify Single- and Multiple-Query Result Summaries

**Files:**

- Modify: `tests/pages/subgraph.test.tsx`
- Modify: `src/pages/subgraph.tsx:199-245`
- Modify: `src/pages/subgraph.tsx:409-610`

**Interfaces:**

- Consumes: `queryProteinDetails.length` to distinguish single and multiple modes.
- Produces: mode-specific map titles and summary cards; no API response change.

- [ ] **Step 1: Add reusable single-query fixture data in the test**

Add above `describe("Subgraph page")` in `tests/pages/subgraph.test.tsx`:

```tsx
const singleQueryData = {
  query: ["P12345"],
  queryProteins: [
    {
      searchedTerm: "P12345",
      proteinId: "P12345",
      geneSymbol: "GENE1",
      entryName: "PROT1_HUMAN",
      description: "Query node",
      wasGeneSymbolSearch: false,
    },
  ],
  nodes: [
    {
      id: "P12345",
      label: "PROT1",
      description: "Query node",
      geneSymbol: "GENE1",
      family: "TM",
      expressionTissue: ["Brain"],
      isQuery: true,
    },
  ],
  edges: [
    {
      id: "E1",
      source: "P12345",
      target: "Q67890",
      fusionPredProb: 0.9,
      enrichedTissue: "Brain",
      tissueEnrichedConfidence: "high",
      positiveType: "prediction",
    },
  ],
};
```

- [ ] **Step 2: Write failing single-query copy/removal assertions**

Use `singleQueryData` in the existing load test and add after `waitFor`:

```tsx
expect(
  screen.getByText("Retrieved TMP associations for a single query protein")
).toBeInTheDocument();
expect(
  screen.getByText(
    "The query protein is positioned at the center and connected to associated TMPs, which are grouped by protein family."
  )
).toBeInTheDocument();
expect(screen.getByText("Associated TMPs")).toBeInTheDocument();
expect(screen.queryByText(/1-hop/i)).not.toBeInTheDocument();
expect(screen.queryByText(/rapid/i)).not.toBeInTheDocument();
expect(screen.queryByText("Query Inputs")).not.toBeInTheDocument();
```

- [ ] **Step 3: Write a failing multiple-query mode test**

Add:

```tsx
it("renders the multiple-query title without the TMP count card", async () => {
  queryState = { proteins: "P12345,Q67890" };
  mockFetch.mockResolvedValueOnce(
    createJsonResponse({
      ...singleQueryData,
      query: ["P12345", "Q67890"],
      queryProteins: [
        singleQueryData.queryProteins[0],
        {
          searchedTerm: "Q67890",
          proteinId: "Q67890",
          geneSymbol: "GENE2",
          entryName: "PROT2_HUMAN",
          description: "Second query node",
          wasGeneSymbolSearch: false,
        },
      ],
      nodes: [
        ...singleQueryData.nodes,
        {
          id: "Q67890",
          label: "PROT2",
          description: "Second query node",
          geneSymbol: "GENE2",
          family: "TM(GPCR)",
          expressionTissue: ["Liver"],
          isQuery: true,
        },
      ],
    })
  );

  render(<SubgraphPage />);

  await waitFor(() => {
    expect(
      screen.getByText(
        "Retrieved associations between two or more query proteins"
      )
    ).toBeInTheDocument();
  });

  expect(screen.queryByText("Associated TMPs")).not.toBeInTheDocument();
  expect(screen.queryByText(/^TMPs$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/1-hop/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/rapid/i)).not.toBeInTheDocument();
  expect(screen.queryByText("Query Inputs")).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run the subgraph page test and verify it fails**

Run:

```bash
rtk npm test -- --runInBand tests/pages/subgraph.test.tsx
```

Expected: FAIL on the old titles, `1-hop`, `rapid`, and Query Inputs block.

- [ ] **Step 5: Remove summary-card note fields and make TMP cards mode-specific**

Replace `summaryCards` in `src/pages/subgraph.tsx` with:

```tsx
const summaryCards = useMemo(() => {
  if (!data) return [];

  return [
    {
      label: "Queried proteins",
      value: queryProteinDetails.length.toString(),
    },
    ...(!isMultipleMode
      ? [
          {
            label: "Associated TMPs",
            value: data.nodes.length.toLocaleString(),
          },
        ]
      : []),
    {
      label: "Associations",
      value: data.edges.length.toLocaleString(),
    },
    {
      label: "Structure links",
      value: structureCount.toLocaleString(),
    },
  ];
}, [data, isMultipleMode, queryProteinDetails.length, structureCount]);
```

Delete the JSX that renders `{card.note}`.

- [ ] **Step 6: Replace summary and association-map copy**

Change the summary sentence to:

```tsx
A focused TMP association view centered on the query protein set, designed for
an overview before detailed table-level review.
```

Replace the map title with:

```tsx
{
  isMultipleMode
    ? "Retrieved associations between two or more query proteins"
    : "Retrieved TMP associations for a single query protein";
}
```

Replace the map description with:

<!-- prettier-ignore -->
```tsx
{/* TODO(external-input:multiple-query-description): render the approved
sentence here after it is supplied. Omit unapproved placeholder copy. */}
{!isMultipleMode && (
  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
    The query protein is positioned at the center and connected to associated
    TMPs, which are grouped by protein family.
  </p>
)}
```

Delete the current unconditional description paragraph so no `1-hop` or `rapid` remains in rendered copy.

- [ ] **Step 7: Remove the complete Query Inputs / Queried proteins block**

Delete `src/pages/subgraph.tsx` current lines 545-609, beginning with the rounded container after the graph and ending after the mapped query-protein cards. Do not remove `queryProteinDetails`; it is still required for mode detection, title construction, and summary counts.

- [ ] **Step 8: Run the focused test and search rendered-source copy**

Run:

```bash
rtk npm test -- --runInBand tests/pages/subgraph.test.tsx
rtk proxy rg -n -i 'rapid|1-hop' src/pages/subgraph.tsx
```

Expected: test PASS; `rg` returns no matches in `src/pages/subgraph.tsx`.

- [ ] **Step 9: Commit result-summary changes**

```bash
rtk git add src/pages/subgraph.tsx tests/pages/subgraph.test.tsx
rtk git commit -m "fix(subgraph): clarify single and multiple query views"
```

---

### Task 5: Simplify Related Tables and Update Their Display Labels

**Files:**

- Modify: `tests/pages/subgraph.test.tsx`
- Modify: `src/pages/subgraph.tsx:67-105`
- Modify: `src/pages/subgraph.tsx:613-647` after Task 4 line shifts

**Interfaces:**

- Consumes: existing `DataTable` `caption`, `columns`, `data`, and export props.
- Produces: `Related tables`, `TMP Information`, `Protein Symbol`, and `Tissues of expression` presentation labels; exported CSV keys remain unchanged.

- [ ] **Step 1: Make the DataTable test mock render column labels**

Replace the DataTable mock in `tests/pages/subgraph.test.tsx` with:

```tsx
jest.mock(
  "@/components/DataTable",
  () =>
    ({
      caption,
      data,
      columns,
    }: {
      caption: string;
      data: any[];
      columns: Array<{ label: string }>;
    }) =>
      (
        <div data-testid={caption}>
          <span>{data.length}</span>
          {columns.map((column) => (
            <span key={column.label}>{column.label}</span>
          ))}
        </div>
      )
);
```

- [ ] **Step 2: Replace the old table assertion and add failing copy assertions**

In the single-query test, replace `Protein Information` with `TMP Information` and add:

```tsx
expect(screen.getByText("Related tables")).toBeInTheDocument();
expect(screen.getByTestId("TMP Information")).toHaveTextContent("1");
expect(screen.getByText("Protein Symbol")).toBeInTheDocument();
expect(screen.getByText("Tissues of expression")).toBeInTheDocument();
expect(screen.queryByText("Reference Tables")).not.toBeInTheDocument();
expect(screen.queryByText("Tables and export")).not.toBeInTheDocument();
expect(screen.queryByText(/Tables for manual review/i)).not.toBeInTheDocument();
expect(screen.queryByText(/Use the built-in filters/i)).not.toBeInTheDocument();
```

- [ ] **Step 3: Run the subgraph test and verify it fails**

Run:

```bash
rtk npm test -- --runInBand tests/pages/subgraph.test.tsx
```

Expected: FAIL on old headings and captions.

- [ ] **Step 4: Change only the table presentation labels**

In `nodeColumns`, use:

```tsx
{ key: "geneSymbol", label: "Protein Symbol" },
{ key: "expressionTissue", label: "Tissues of expression" },
```

Do not rename the keys.

Replace the table section heading wrapper with:

```tsx
<div>
  <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
    Related tables
  </h2>
</div>
```

Delete `Reference Tables`, the manual-review sentence, and the built-in-filter sentence.

Change the first table caption only:

```tsx
caption = "TMP Information";
```

Keep `Association Information`, `nodes.csv`, `edges.csv`, and all export object keys unchanged.

- [ ] **Step 5: Run the focused test**

Run:

```bash
rtk npm test -- --runInBand tests/pages/subgraph.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit table-copy cleanup**

```bash
rtk git add src/pages/subgraph.tsx tests/pages/subgraph.test.tsx
rtk git commit -m "fix(tables): simplify related table labels"
```

---

### Task 6: Fill the Four Counts and Statistics Description When Supplied

**Status:** `TODO(external-input:network-statistics)` and `TODO(external-input:network-statistics-description)` — intentionally blocked until reviewed values/copy arrive.

**Files:**

- Modify: `src/lib/networkStatisticsContent.ts`
- Modify: `tests/unit/networkStatisticsContent.test.ts`
- Test: `tests/components/Sidebar.test.tsx`

**Interfaces:**

- Consumes: four exact integer counts and one approved English sentence.
- Produces: no new interface; replaces the five null placeholders from Task 2.

- [ ] **Step 1: Record provenance before changing code**

At the top of the commit message body or implementation notes, record the received filename/message date and the exact four source labels. Do not accept a table whose categories cannot be unambiguously mapped to:

```text
TMPNet nodes
Additional nodes
TMPNet pairs
Additional pairs
```

- [ ] **Step 2: Replace the null expectations with supplied values**

Update `tests/unit/networkStatisticsContent.test.ts` first:

```ts
expect(networkStatisticsContent).toEqual({
  tmpnetNodes: /* TODO(external-input): exact reviewed integer */,
  additionalNodes: /* TODO(external-input): exact reviewed integer */,
  tmpnetPairs: /* TODO(external-input): exact reviewed integer */,
  additionalPairs: /* TODO(external-input): exact reviewed integer */,
  description: /* TODO(external-input): exact approved English sentence */,
});
```

Replace every comment with actual received content before running the test; do not commit these comment expressions.

- [ ] **Step 3: Run the test and verify it fails against null placeholders**

```bash
rtk npm test -- --runInBand tests/unit/networkStatisticsContent.test.ts
```

Expected: FAIL showing null actual values.

- [ ] **Step 4: Put the exact supplied values in the content module**

Replace only the five nulls in `src/lib/networkStatisticsContent.ts`; retain `formatNetworkStatistic` unchanged.

- [ ] **Step 5: Run focused tests**

```bash
rtk npm test -- --runInBand tests/unit/networkStatisticsContent.test.ts tests/components/Sidebar.test.tsx
```

Expected: PASS and no em-dash placeholders in the Sidebar test after its expected text is updated to the supplied formatted values.

- [ ] **Step 6: Commit supplied statistics separately**

```bash
rtk git add src/lib/networkStatisticsContent.ts tests/unit/networkStatisticsContent.test.ts tests/components/Sidebar.test.tsx
rtk git commit -m "content(network): add reviewed TMPNet statistics"
```

---

### Task 7: Replace Homepage Assets, Layout, and Contact Email When Supplied

**Status:** `TODO(external-input:homepage-network-background)`, `TODO(external-input:homepage-tissue-figure)`, and `TODO(external-input:contact-email)` — intentionally blocked.

**Files:**

- Add: `public/<approved-network-background-file>`
- Add: `public/<approved-tissue-figure-file>`
- Modify: `tests/pages/index.test.tsx`
- Modify: `src/pages/index.tsx:28-42`
- Modify: `src/pages/index.tsx:171-180`

**Interfaces:**

- Consumes: two image files, approved focal-point/layout annotation, and exact email.
- Produces: responsive homepage hero without broken asset URLs; address stays unchanged.

- [ ] **Step 1: Verify external files before referencing them**

After the assets are copied into `public/`, run with the real filenames:

```bash
rtk ls -lh public/<approved-network-background-file> public/<approved-tissue-figure-file>
```

Expected: both files exist and have non-zero sizes. Do not add a code reference while either path is missing.

- [ ] **Step 2: Add failing asset and email assertions**

Add stable accessible labels in the intended implementation and test them first:

```tsx
expect(screen.getByTestId("homepage-hero")).toHaveStyle({
  backgroundImage: "url(/<approved-network-background-file>)",
});
expect(screen.getByAltText("TMPNet tissue overview")).toHaveAttribute(
  "src",
  expect.stringContaining("<approved-tissue-figure-file>")
);
expect(screen.getByText("E-mail: <approved-email>")).toBeInTheDocument();
```

Replace angle-bracket placeholders with the supplied values before committing.

- [ ] **Step 3: Run the homepage test and verify it fails**

```bash
rtk npm test -- --runInBand tests/pages/index.test.tsx
```

Expected: FAIL because current code still uses `/background.png`, has no tissue figure, and retains the current email.

- [ ] **Step 4: Implement only the annotated responsive layout**

Apply the supplied left/right positioning literally. Use a two-column grid at the annotated breakpoint and a one-column stack on small screens. Add `data-testid="homepage-hero"` to the hero container and use an ordinary `<img>` or Next `<Image>` with `alt="TMPNet tissue overview"`; choose dimensions from the actual asset rather than guessing.

Do not redesign the title, statistics, search controls, footer, or mobile navigation beyond what is necessary for the annotated placement.

- [ ] **Step 5: Replace only the email text**

Change:

```tsx
<p>E-mail: shuiwq@shanghaitech.edu.cn</p>
```

to the exact approved email. Leave the address unchanged.

- [ ] **Step 6: Run focused test and visual verification**

```bash
rtk npm test -- --runInBand tests/pages/index.test.tsx
rtk npm run dev
```

Expected: test PASS. Manually verify `/` at a mobile width and desktop width: no text overlaps, both images load, search remains usable, and the footer address is unchanged.

- [ ] **Step 7: Commit external assets and layout separately**

```bash
rtk git add public/<approved-network-background-file> public/<approved-tissue-figure-file> src/pages/index.tsx tests/pages/index.test.tsx
rtk git commit -m "feat(home): apply approved TMPNet hero artwork"
```

Replace angle-bracket placeholders before running the commands.

---

### Task 8: Ingest the Replacement TMPNet/Additional Table When Supplied

**Status:** `TODO(external-input:replacement-table)` — intentionally blocked because the filename, headers, and category semantics are unknown.

**Files:**

- Add: `data/raw/<confirmed-dataset-directory>/<replacement-table-file>` if the supplied file belongs in the tracked raw-data workflow.
- Modify: `scripts/prepare-csvs-for-import.js` only if existing `Association_evidence` normalization cannot read the supplied source column.
- Modify: `tests/unit/build-network-artifacts.test.js`
- Regenerate: `data/supabase-import/<confirmed-dataset-directory>/edges.csv`
- Regenerate: `public/generated/network/overview.cyto.json`
- Regenerate: `public/generated/network/stats.json`

**Interfaces:**

- Consumes: a reviewed table containing exactly two display categories, `TMPNet` and `Additional`.
- Produces: normalized `positive_type` values compatible with the Task 3 presentation mapping, unless the supplied schema justifies a separately reviewed internal-schema migration.

- [ ] **Step 1: Inspect and record the exact incoming schema**

Run after the file arrives:

```bash
rtk read data/raw/<confirmed-dataset-directory>/<replacement-table-file> | head -5
```

Expected: headers and sample values are visible. Replace all path placeholders with the supplied path.

- [ ] **Step 2: Stop if category semantics are ambiguous**

The input must answer both questions before implementation:

```text
Which column contains TMPNet/Additional?
Can one pair carry both categories, or are they mutually exclusive?
```

Do not infer these answers from current `experiment/prediction` overlaps.

- [ ] **Step 3: Write the exact normalization test from real rows**

Add a fixture containing one real-format TMPNet row and one real-format Additional row. Expected normalized values must remain:

```js
expect(tmpnetRow.positive_type).toBe("prediction");
expect(additionalRow.positive_type).toBe("experiment");
```

If the supplied semantics contradict this mapping, pause for a scope decision instead of silently changing Task 3.

- [ ] **Step 4: Run the test and verify it fails**

```bash
rtk npm test -- --runInBand tests/unit/build-network-artifacts.test.js
```

Expected: FAIL because the new source column/value mapping is not yet supported.

- [ ] **Step 5: Add the smallest source-column mapping**

Extend `EDGE_COLUMN_SOURCES.positive_type` or the existing `normalizeAssociationEvidence` call using the exact supplied header. Do not add generic fuzzy header matching.

- [ ] **Step 6: Normalize data and regenerate artifacts**

Use the confirmed paths:

```bash
rtk proxy node scripts/prepare-csvs-for-import.js --raw-dir data/raw/<confirmed-dataset-directory> --output-dir data/supabase-import/<confirmed-dataset-directory> --skip-structures
rtk proxy node scripts/build-network-artifacts.js --nodes data/supabase-import/<confirmed-dataset-directory>/nodes.csv --edges data/supabase-import/<confirmed-dataset-directory>/edges.csv --output public/generated/network
```

Expected: normalization succeeds without orphan edges; generated artifacts contain both category colors from Task 3.

- [ ] **Step 7: Run data/API regression tests**

```bash
rtk npm test -- --runInBand tests/unit/build-network-artifacts.test.js tests/api/network-stats.test.ts tests/api/network.test.ts tests/api/subgraph.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit data migration independently**

Stage only the confirmed input/output files and related script/test changes; use:

```bash
rtk git commit -m "feat(data): ingest reviewed TMPNet association labels"
```

---

### Task 9: Final Regression and Visual QA

**Files:**

- No source changes unless a failure directly traces to Tasks 1-8.
- Verify: all files changed by the implementation.

**Interfaces:**

- Consumes: completed unblocked tasks plus any external-input tasks whose material has arrived.
- Produces: evidence that copy, behavior, artifacts, responsive layout, and tests agree.

- [ ] **Step 1: Scan user-visible source for removed wording**

```bash
rtk proxy rg -n -i 'Gene Symbol|gene symbols|rapid|1-hop|Shared sub-network landscape|Reference Tables|Tables and export|Protein Information|Reported|TMPNet predicted' src/pages/index.tsx src/components/SearchBar.tsx src/components/Sidebar.tsx src/components/Legend.tsx src/pages/subgraph.tsx
```

Expected: no matches. Internal API comments and data field names are intentionally outside this scan.

- [ ] **Step 2: Run formatting check**

```bash
rtk npm run format:check
```

Expected: PASS. If only plan-touched files fail, format those files with the project formatter and re-run; do not format unrelated user files.

- [ ] **Step 3: Run lint**

```bash
rtk npm run lint
```

Expected: PASS with no new warnings.

- [ ] **Step 4: Run the complete Jest suite**

```bash
rtk npm test -- --runInBand
```

Expected: all tests PASS.

- [ ] **Step 5: Run the production build**

```bash
rtk npm run build
```

Expected: Next.js production build completes successfully.

- [ ] **Step 6: Verify the three primary routes in file-backed mode**

Run:

```bash
rtk proxy env MEMPPI_DATA_MODE=file npm run dev
```

Verify:

```text
/: Protein Symbol wording; current fallback artwork remains until Task 7 is unblocked.
/network: four statistics labels; null inputs show four em dashes; family order matches Legend; Additional is light and TMPNet is dark.
/subgraph?proteins=EGFR: single-query title/copy, no 1-hop/rapid, no Query Inputs block, simplified Related tables.
/subgraph?proteins=EGFR,INSR: multiple-query title, no TMP count card, no Query Inputs block, description omitted until approved copy arrives.
```

- [ ] **Step 7: Inspect the final diff for surgical scope**

```bash
rtk git status --short
rtk git diff --stat
rtk git diff
```

Expected: every changed line maps to this plan; the pre-existing untracked documentation files remain untouched.

- [ ] **Step 8: Commit any verification-only correction**

Only if a directly related correction was needed:

```bash
rtk git add <only-the-corrected-files>
rtk git commit -m "fix(web): address TMPNet refresh regression"
```

Do not create an empty final commit.
