import { readFile } from "fs/promises";
import path from "path";

type Row = Record<string, unknown>;
type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "not"; column: string; operator: string; value: unknown }
  | { kind: "gte"; column: string; value: number }
  | { kind: "lte"; column: string; value: number }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "ilike"; column: string; pattern: string }
  | { kind: "or"; clauses: Filter[] };

type Order = {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
};

type SelectOptions = {
  count?: "exact";
  head?: boolean;
};

type QueryResult = {
  data: Row[] | Row | null;
  error: Error | null;
  count?: number | null;
};

type DataStore = {
  nodes: Row[];
  edges: Row[];
  structure_models: Row[];
  graph_layout_cache: Row[];
};

let cachedStore: Promise<DataStore> | null = null;

const DEFAULT_DATA_ROOT = "data/supabase-import/20260627_web_data";

function getDataRoot(): string {
  return path.resolve(process.env.MEMPPI_DATA_ROOT || DEFAULT_DATA_ROOT);
}

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  if (!headers) return [];

  return records
    .filter((record) => record.length > 1 || record[0])
    .map((record) => {
      const parsed: Row = {};
      headers.forEach((header, index) => {
        parsed[header] = coerceValue(header, record[index] ?? "");
      });
      return parsed;
    });
}

function coerceValue(column: string, value: string): unknown {
  if (value === "") return null;
  if (
    [
      "fusion_pred_prob",
      "summary_iptm",
      "summary_ptm",
      "summary_ranking_score",
      "summary_fraction_disordered",
    ].includes(column)
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (
    [
      "string_combined_score",
      "cif_size_bytes",
      "confidences_size_bytes",
    ].includes(column)
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (["summary_has_clash", "has_confidences"].includes(column)) {
    return value.toLowerCase() === "true";
  }
  if (column === "summary_confidences") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

async function readCsv(fileName: string): Promise<Row[]> {
  const raw = await readFile(path.join(getDataRoot(), fileName), "utf8");
  return parseCsv(raw);
}

async function loadStore(): Promise<DataStore> {
  if (!cachedStore) {
    cachedStore = Promise.all([
      readCsv("nodes.csv"),
      readCsv("edges.csv"),
      readCsv("structure_models.csv"),
    ]).then(([nodes, edges, structureModels]) => ({
      nodes,
      edges,
      structure_models: structureModels,
      graph_layout_cache: [],
    }));
  }
  return cachedStore;
}

function selectedColumns(selectClause: string | undefined): string[] | null {
  if (!selectClause || selectClause.trim() === "*") return null;
  return selectClause
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function projectRows(rows: Row[], selectClause: string | undefined): Row[] {
  const columns = selectedColumns(selectClause);
  if (!columns) return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    const projected: Row = {};
    columns.forEach((column) => {
      projected[column] = row[column];
    });
    return projected;
  });
}

function likePattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
}

function matchesFilter(row: Row, filter: Filter): boolean {
  switch (filter.kind) {
    case "eq": {
      const value = row[filter.column];
      return (
        String(value ?? "").toUpperCase() ===
        String(filter.value ?? "").toUpperCase()
      );
    }
    case "neq": {
      const value = row[filter.column];
      return value !== filter.value;
    }
    case "not": {
      const value = row[filter.column];
      if (filter.operator === "is" && filter.value === null) {
        return value !== null && typeof value !== "undefined";
      }
      return true;
    }
    case "gte": {
      const value = row[filter.column];
      return Number(value) >= filter.value;
    }
    case "lte": {
      const value = row[filter.column];
      return Number(value) <= filter.value;
    }
    case "in": {
      const value = row[filter.column];
      const values = new Set(
        filter.values.map((item) => String(item).toUpperCase())
      );
      return values.has(String(value ?? "").toUpperCase());
    }
    case "ilike": {
      const value = row[filter.column];
      return likePattern(filter.pattern).test(String(value ?? ""));
    }
    case "or":
      return filter.clauses.some((clause) => matchesFilter(row, clause));
  }
}

function parseOrClause(raw: string): Filter[] {
  return raw
    .split(",")
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map((clause) => {
      const [column, operator, ...rest] = clause.split(".");
      const value = rest.join(".");
      if (operator === "eq") {
        return { kind: "eq", column, value } satisfies Filter;
      }
      throw new Error(`Unsupported local data OR clause: ${clause}`);
    });
}

class LocalQueryBuilder {
  private selectClause?: string;
  private selectOptions?: SelectOptions;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private rangeStart?: number;
  private rangeEnd?: number;
  private limitCount?: number;
  private mode: "select" | "delete" | "upsert" = "select";
  private payload: Row[] = [];
  private wantsSingle = false;
  private wantsMaybeSingle = false;

  constructor(private table: keyof DataStore) {}

  select(columns = "*", options?: SelectOptions): this {
    this.selectClause = columns;
    this.selectOptions = options;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  upsert(records: Row | Row[]): this {
    this.mode = "upsert";
    this.payload = Array.isArray(records) ? records : [records];
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.filters.push({ kind: "not", column, operator, value });
    return this;
  }

  gte(column: string, value: number): this {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }

  lte(column: string, value: number): this {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, values });
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.filters.push({ kind: "ilike", column, pattern });
    return this;
  }

  or(raw: string): this {
    this.filters.push({ kind: "or", clauses: parseOrClause(raw) });
    return this;
  }

  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ): this {
    this.orders.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst,
    });
    return this;
  }

  range(start: number, end: number): this {
    this.rangeStart = start;
    this.rangeEnd = end;
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  single(): this {
    this.wantsSingle = true;
    return this;
  }

  maybeSingle(): this {
    this.wantsMaybeSingle = true;
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult> {
    try {
      const store = await loadStore();
      const tableRows = store[this.table];

      if (this.mode === "upsert") {
        this.upsertRows(tableRows);
        return { data: null, error: null, count: this.payload.length };
      }

      const matched = tableRows.filter((row) =>
        this.filters.every((filter) => matchesFilter(row, filter))
      );

      if (this.mode === "delete") {
        const matchedSet = new Set(matched);
        const kept = tableRows.filter((row) => !matchedSet.has(row));
        store[this.table] = kept as never;
        return {
          data: projectRows(matched, this.selectClause),
          error: null,
          count: matched.length,
        };
      }

      const count =
        this.selectOptions?.count === "exact" ? matched.length : null;
      let rows = [...matched];

      rows.sort((left, right) => {
        for (const order of this.orders) {
          const leftValue = left[order.column];
          const rightValue = right[order.column];
          if (leftValue == null && rightValue == null) continue;
          if (leftValue == null) return order.nullsFirst ? -1 : 1;
          if (rightValue == null) return order.nullsFirst ? 1 : -1;
          const diff =
            typeof leftValue === "number" && typeof rightValue === "number"
              ? leftValue - rightValue
              : String(leftValue).localeCompare(String(rightValue));
          if (diff !== 0) return order.ascending ? diff : -diff;
        }
        return 0;
      });

      if (
        typeof this.rangeStart === "number" &&
        typeof this.rangeEnd === "number"
      ) {
        rows = rows.slice(this.rangeStart, this.rangeEnd + 1);
      }

      if (typeof this.limitCount === "number") {
        rows = rows.slice(0, this.limitCount);
      }

      if (this.selectOptions?.head) {
        return { data: null, error: null, count };
      }

      const data = projectRows(rows, this.selectClause);
      if (this.wantsSingle || this.wantsMaybeSingle) {
        return { data: data[0] ?? null, error: null, count };
      }

      return { data, error: null, count };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error(String(error)),
        count: null,
      };
    }
  }

  private upsertRows(rows: Row[]): void {
    for (const record of this.payload) {
      const existing = rows.find(
        (row) =>
          row.graph_key === record.graph_key && row.node_id === record.node_id
      );
      if (existing) {
        Object.assign(existing, record, {
          updated_at: new Date().toISOString(),
        });
      } else {
        rows.push({
          ...record,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }
  }
}

export function createLocalDataSupabaseClient() {
  return {
    from(table: keyof DataStore) {
      return new LocalQueryBuilder(table);
    },
    storage: {
      from() {
        return {
          getPublicUrl(objectPath: string) {
            return { data: { publicUrl: objectPath } };
          },
          async download() {
            return {
              data: null,
              error: new Error("Storage is unavailable in file data mode"),
            };
          },
        };
      },
    },
  };
}
