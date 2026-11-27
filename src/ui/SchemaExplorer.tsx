import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Columns3,
  Database,
  KeyRound,
  Layers,
  Link2,
  Search,
  Sparkles,
  TableProperties,
  X,
} from "lucide-react";
import type { ColumnInfo } from "../../vendor/culprit/app/src/gen/ColumnInfo";
import type { ForeignKey } from "../../vendor/culprit/app/src/gen/ForeignKey";
import type { IndexStat } from "../../vendor/culprit/app/src/gen/IndexStat";
import type { MissingIndex } from "../../vendor/culprit/app/src/gen/MissingIndex";
import type { TableStat } from "../../vendor/culprit/app/src/gen/TableStat";
import { pct, quantity, stamp } from "./shared";

export interface SchemaCatalogData {
  observed_at: string | null;
  tables: TableStat[];
  indexes: IndexStat[];
  columns?: ColumnInfo[];
  foreign_keys?: ForeignKey[];
  missing_indexes?: MissingIndex[];
}

type ViewMode = "tables" | "indexes";

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

function fmtCompactRows(rows: number | null | undefined): string {
  if (rows == null || !Number.isFinite(rows)) return "—";
  if (rows >= 1_000_000_000) return `${(rows / 1_000_000_000).toFixed(2)}B`;
  if (rows >= 1_000_000) return `${(rows / 1_000_000).toFixed(2)}M`;
  if (rows >= 10_000) return `${(rows / 1_000).toFixed(1)}K`;
  return quantity(rows);
}

function indexHealth(idx: IndexStat): {
  label: string;
  tone: "observed" | "partial" | "danger" | "stale";
} {
  if (idx.is_disabled) {
    return { label: "Disabled", tone: "danger" };
  }
  const reads =
    (idx.reads ?? 0) + (idx.seeks ?? 0) + (idx.scans ?? 0);
  const writes = idx.writes ?? 0;
  const lookups = idx.lookups ?? 0;
  if (!idx.is_primary_key && !idx.is_unique && reads === 0 && writes > 500) {
    return { label: "Unused · write overhead", tone: "stale" };
  }
  if (lookups > 500 && lookups > (idx.seeks ?? 1) * 0.25) {
    return { label: "High key lookups", tone: "partial" };
  }
  if (
    idx.contention &&
    ((idx.contention.row_lock_wait_ms ?? 0) > 1000 ||
      (idx.contention.page_lock_wait_ms ?? 0) > 1000)
  ) {
    return { label: "Lock contention", tone: "danger" };
  }
  return { label: "Healthy", tone: "observed" };
}

export function SchemaExplorer({ catalog }: { catalog: SchemaCatalogData }) {
  const [mode, setMode] = useState<ViewMode>("tables");
  const [search, setSearch] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);

  const tables = catalog.tables;
  const indexes = catalog.indexes;
  const columns = catalog.columns ?? [];
  const foreignKeys = catalog.foreign_keys ?? [];
  const missingIndexes = catalog.missing_indexes ?? [];

  const defaultExpanded = useMemo(() => {
    const first = tables[0];
    return first ? `${first.schema}.${first.name}` : null;
  }, [tables]);

  const [expandedKey, setExpandedKey] = useState<string | null>(
    defaultExpanded,
  );

  const tableStats = useMemo(() => {
    let totalRows = 0;
    let totalDataBytes = 0;
    let totalIndexBytes = 0;
    let attentionTables = 0;
    let unusedIndexes = 0;

    for (const idx of indexes) {
      const h = indexHealth(idx);
      if (h.tone !== "observed") unusedIndexes++;
    }

    const enriched = tables.map((t) => {
      const key = `${t.schema}.${t.name}`;
      const tblIndexes = indexes.filter(
        (i) => i.schema === t.schema && i.table === t.name,
      );
      const tblColumns = columns
        .filter((c) => c.schema === t.schema && c.table === t.name)
        .sort((a, b) => a.ordinal - b.ordinal);
      const tblFks = foreignKeys.filter(
        (fk) => fk.schema === t.schema && fk.table === t.name,
      );
      const tblMissing = missingIndexes.filter(
        (m) => m.schema === t.schema && m.table === t.name,
      );

      totalRows += t.rows ?? 0;
      const dataB = t.data_bytes ?? t.in_row_bytes ?? 0;
      const idxB =
        t.index_bytes ??
        tblIndexes.reduce((s, i) => s + (i.size_bytes ?? 0), 0);
      totalDataBytes += dataB;
      totalIndexBytes += idxB;

      const deadRatio =
        t.dead_rows != null && t.rows != null && t.rows > 0
          ? (100 * t.dead_rows) / (t.rows + t.dead_rows)
          : null;
      const hasIdxIssue = tblIndexes.some(
        (i) => indexHealth(i).tone !== "observed",
      );
      const needsAttention =
        !t.has_primary_key ||
        Boolean(t.is_heap) ||
        tblMissing.length > 0 ||
        (deadRatio !== null && deadRatio >= 10) ||
        (t.forwarded_records ?? 0) > 1000 ||
        hasIdxIssue;

      if (needsAttention) attentionTables++;

      return {
        key,
        table: t,
        indexes: tblIndexes,
        columns: tblColumns,
        foreignKeys: tblFks,
        missingIndexes: tblMissing,
        dataBytes: dataB,
        indexBytes: idxB,
        totalBytes: t.total_bytes ?? dataB + idxB + (t.lob_bytes ?? 0),
        deadRatio,
        needsAttention,
      };
    });

    return {
      enriched,
      totalRows,
      totalDataBytes,
      totalIndexBytes,
      attentionTables,
      unusedIndexes,
    };
  }, [tables, indexes, columns, foreignKeys, missingIndexes]);

  const query = search.trim().toLowerCase();

  const filteredTables = useMemo(() => {
    return tableStats.enriched.filter((item) => {
      if (attentionOnly && !item.needsAttention) return false;
      if (!query) return true;
      if (item.key.toLowerCase().includes(query)) return true;
      if (item.indexes.some((i) => i.name.toLowerCase().includes(query)))
        return true;
      if (item.columns.some((c) => c.name.toLowerCase().includes(query)))
        return true;
      return false;
    });
  }, [tableStats.enriched, attentionOnly, query]);

  const filteredIndexes = useMemo(() => {
    return [...indexes]
      .filter((idx) => {
        if (attentionOnly && indexHealth(idx).tone === "observed") return false;
        if (!query) return true;
        return (
          idx.name.toLowerCase().includes(query) ||
          `${idx.schema}.${idx.table}`.toLowerCase().includes(query) ||
          idx.columns.some((c) => c.toLowerCase().includes(query)) ||
          idx.include.some((c) => c.toLowerCase().includes(query))
        );
      })
      .sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0));
  }, [indexes, attentionOnly, query]);

  if (!tables.length && !indexes.length) return null;

  const activeExpanded =
    expandedKey && filteredTables.some((t) => t.key === expandedKey)
      ? expandedKey
      : (filteredTables[0]?.key ?? null);

  return (
    <section className="panel schema-explorer-panel">
      <header className="panel-head schema-explorer-head">
        <div className="panel-head-copy">
          <h2 className="icon-heading">
            <Database size={18} />
            Schema &amp; index catalog
          </h2>
          <small>
            Captured table storage, column types, B-tree / clustered index usage
            counters, and optimizer missing-index signals
            {catalog.observed_at ? ` · Observed ${stamp(catalog.observed_at)}` : ""}
          </small>
        </div>

        <div className="fleet-controls">
          <div className="search-box compact-search">
            <Search size={13} />
            <input
              value={search}
              placeholder="Filter tables, columns, indexes…"
              aria-label="Filter schema catalog"
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="clear-search"
                aria-label="Clear schema filter"
                onClick={() => setSearch("")}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="switcher" role="group" aria-label="Schema filter">
            <button
              type="button"
              aria-pressed={!attentionOnly}
              onClick={() => setAttentionOnly(false)}
            >
              All objects
            </button>
            <button
              type="button"
              aria-pressed={attentionOnly}
              onClick={() => setAttentionOnly(true)}
            >
              Needs attention ({tableStats.attentionTables})
            </button>
          </div>

          <div className="switcher" role="group" aria-label="Catalog view">
            <button
              type="button"
              aria-pressed={mode === "tables"}
              onClick={() => setMode("tables")}
            >
              Tables ({tables.length})
            </button>
            <button
              type="button"
              aria-pressed={mode === "indexes"}
              onClick={() => setMode("indexes")}
            >
              Indexes ({indexes.length})
            </button>
          </div>
        </div>
      </header>

      <div className="ops-kpi-band schema-kpi-band">
        <div>
          <small>Cataloged tables &amp; rows</small>
          <strong>
            {tables.length} tables · {fmtCompactRows(tableStats.totalRows)} rows
          </strong>
        </div>
        <div>
          <small>Data / heap footprint</small>
          <strong>{fmtBytes(tableStats.totalDataBytes)}</strong>
        </div>
        <div>
          <small>Index storage ({indexes.length} indexes)</small>
          <strong>{fmtBytes(tableStats.totalIndexBytes)}</strong>
        </div>
        <div>
          <small>Index &amp; table health signals</small>
          <strong>
            {missingIndexes.length > 0 || tableStats.unusedIndexes > 0
              ? `${missingIndexes.length} missing · ${tableStats.unusedIndexes} flagged`
              : "All indexes active & healthy"}
          </strong>
        </div>
      </div>

      {mode === "tables" ? (
        <div className="schema-table-list">
          {filteredTables.length === 0 ? (
            <div className="empty-state-box">
              <p>No tables match the current filter.</p>
            </div>
          ) : (
            filteredTables.map((item) => {
              const { table: t } = item;
              const open = activeExpanded === item.key;
              const totalReadOps = (t.seq_scans ?? 0) + (t.index_scans ?? 0);
              const seekShare =
                totalReadOps > 0
                  ? (100 * (t.index_scans ?? 0)) / totalReadOps
                  : null;
              const dataPct =
                item.totalBytes > 0
                  ? Math.min(100, (100 * item.dataBytes) / item.totalBytes)
                  : 55;

              return (
                <div
                  key={item.key}
                  className={`schema-table-card ${open ? "is-open" : ""}`}
                >
                  <button
                    type="button"
                    className="schema-table-summary"
                    aria-expanded={open}
                    onClick={() =>
                      setExpandedKey(open ? "__collapsed__" : item.key)
                    }
                  >
                    <div className="schema-tbl-ident">
                      {open ? (
                        <ChevronDown size={15} className="schema-chevron" />
                      ) : (
                        <ChevronRight size={15} className="schema-chevron" />
                      )}
                      <TableProperties size={15} className="schema-tbl-icon" />
                      <div>
                        <div className="schema-tbl-name-row">
                          <strong>
                            <span className="schema-prefix">{t.schema}.</span>
                            {t.name}
                          </strong>
                          {t.is_heap ? (
                            <span className="severity-pill sev-warn">HEAP</span>
                          ) : t.has_primary_key ? (
                            <span className="category-pill">PK</span>
                          ) : (
                            <span className="severity-pill sev-danger">
                              NO PK
                            </span>
                          )}
                          {t.partition_of && (
                            <span className="case-meta-pill">
                              partition of {t.partition_of}
                            </span>
                          )}
                          {item.missingIndexes.length > 0 && (
                            <span className="wait-pill wait-lock">
                              <Sparkles size={11} />
                              {item.missingIndexes.length} missing idx
                            </span>
                          )}
                          {item.deadRatio !== null && item.deadRatio >= 10 && (
                            <span className="wait-pill wait-io">
                              <AlertTriangle size={11} />
                              {pct(item.deadRatio)} dead tuples
                            </span>
                          )}
                        </div>
                        <small>
                          {item.columns.length} columns · {item.indexes.length}{" "}
                          indexes
                          {item.foreignKeys.length > 0
                            ? ` · ${item.foreignKeys.length} foreign keys`
                            : ""}
                        </small>
                      </div>
                    </div>

                    <div className="schema-tbl-stat">
                      <small>Rows</small>
                      <strong>{fmtCompactRows(t.rows)}</strong>
                    </div>

                    <div className="schema-tbl-stat schema-size-cell">
                      <small>Data / Index size</small>
                      <strong>
                        {fmtBytes(item.dataBytes)} / {fmtBytes(item.indexBytes)}
                      </strong>
                      <div className="schema-split-bar" aria-hidden="true">
                        <i
                          className="seg-cpu"
                          style={{ width: `${dataPct}%` }}
                        />
                        <i
                          className="seg-memory"
                          style={{ width: `${Math.max(0, 100 - dataPct)}%` }}
                        />
                      </div>
                    </div>

                    <div className="schema-tbl-stat">
                      <small>Access pattern</small>
                      <strong>
                        {seekShare !== null
                          ? `${pct(seekShare)} idx seeks`
                          : "Cataloged"}
                      </strong>
                      {t.seq_scans != null && (
                        <span className="schema-sub-num">
                          {quantity(t.seq_scans)} seq scans
                        </span>
                      )}
                    </div>
                  </button>

                  {open && (
                    <div className="schema-table-detail">
                      {item.missingIndexes.length > 0 && (
                        <div className="schema-missing-banner">
                          {item.missingIndexes.map((mi, mIdx) => (
                            <div key={mIdx} className="schema-missing-item">
                              <div className="schema-missing-head">
                                <span className="severity-pill sev-warn">
                                  Optimizer missing index ·{" "}
                                  {pct(mi.avg_impact_pct)} est. impact
                                </span>
                                <small>
                                  {quantity(mi.seeks)} would-be seeks · avg cost{" "}
                                  {mi.avg_query_cost.toFixed(1)}
                                </small>
                              </div>
                              <code>
                                KEY (
                                {[...mi.equality, ...mi.inequality].join(", ")})
                                {mi.include.length > 0
                                  ? ` INCLUDE (${mi.include.join(", ")})`
                                  : ""}
                              </code>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="schema-detail-section">
                        <h4>
                          <Layers size={14} />
                          Indexes on {t.schema}.{t.name} ({item.indexes.length})
                        </h4>
                        <div className="table-scroll">
                          <table className="schema-inner-table">
                            <thead>
                              <tr>
                                <th>Index</th>
                                <th>Type</th>
                                <th>Key &amp; included columns</th>
                                <th>Size</th>
                                <th>Seeks / Scans</th>
                                <th>Lookups / Writes</th>
                                <th>Health</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.indexes.map((idx) => {
                                const health = indexHealth(idx);
                                return (
                                  <tr key={idx.name}>
                                    <td>
                                      <div className="schema-idx-name">
                                        {idx.is_primary_key && (
                                          <KeyRound size={12} />
                                        )}
                                        <strong>{idx.name}</strong>
                                      </div>
                                    </td>
                                    <td>
                                      <span className="category-pill">
                                        {idx.is_clustered
                                          ? "CLUSTERED"
                                          : idx.kind.toUpperCase()}
                                      </span>
                                      {idx.is_unique && !idx.is_primary_key && (
                                        <span className="case-meta-pill">
                                          UNIQUE
                                        </span>
                                      )}
                                    </td>
                                    <td className="schema-cols-cell">
                                      <code>({idx.columns.join(", ")})</code>
                                      {idx.include.length > 0 && (
                                        <span className="schema-inc-pill">
                                          INCLUDE ({idx.include.join(", ")})
                                        </span>
                                      )}
                                      {idx.filter && (
                                        <span className="schema-filter-pill">
                                          WHERE {idx.filter}
                                        </span>
                                      )}
                                    </td>
                                    <td>{fmtBytes(idx.size_bytes)}</td>
                                    <td>
                                      {quantity(idx.seeks ?? idx.reads ?? 0)} /{" "}
                                      {quantity(idx.scans ?? 0)}
                                    </td>
                                    <td>
                                      {idx.lookups != null && idx.lookups > 0
                                        ? `${quantity(idx.lookups)} lookups · `
                                        : ""}
                                      {quantity(idx.writes ?? 0)} writes
                                    </td>
                                    <td>
                                      <span
                                        className={`status ${health.tone}`}
                                      >
                                        <i />
                                        {health.label}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {item.columns.length > 0 && (
                        <div className="schema-detail-section">
                          <h4>
                            <Columns3 size={14} />
                            Columns &amp; foreign keys ({item.columns.length})
                          </h4>
                          <div className="schema-columns-grid">
                            {item.columns.map((col) => {
                              const fk = item.foreignKeys.find((f) =>
                                f.columns.includes(col.name),
                              );
                              return (
                                <div
                                  key={col.name}
                                  className="schema-col-chip"
                                >
                                  <div className="schema-col-top">
                                    <strong>{col.name}</strong>
                                    <code>{col.data_type}</code>
                                  </div>
                                  <div className="schema-col-meta">
                                    <span>
                                      {col.nullable ? "NULL" : "NOT NULL"}
                                    </span>
                                    {col.generated && <span>GENERATED</span>}
                                    {col.default && (
                                      <span title={col.default}>
                                        DEFAULT {col.default}
                                      </span>
                                    )}
                                    {fk && (
                                      <span className="schema-fk-badge">
                                        <Link2 size={10} />
                                        {fk.ref_schema}.{fk.ref_table}(
                                        {fk.ref_columns.join(",")})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Index</th>
                <th>Table</th>
                <th>Type</th>
                <th>Key &amp; included columns</th>
                <th>Size</th>
                <th>Seeks</th>
                <th>Scans</th>
                <th>Writes</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {filteredIndexes.map((idx) => {
                const health = indexHealth(idx);
                return (
                  <tr key={`${idx.schema}.${idx.table}.${idx.name}`}>
                    <td>
                      <div className="schema-idx-name">
                        {idx.is_primary_key && <KeyRound size={12} />}
                        <strong>{idx.name}</strong>
                      </div>
                    </td>
                    <td>
                      <code>
                        {idx.schema}.{idx.table}
                      </code>
                    </td>
                    <td>
                      <span className="category-pill">
                        {idx.is_clustered
                          ? "CLUSTERED"
                          : idx.kind.toUpperCase()}
                      </span>
                    </td>
                    <td className="schema-cols-cell">
                      <code>({idx.columns.join(", ")})</code>
                      {idx.include.length > 0 && (
                        <span className="schema-inc-pill">
                          INCLUDE ({idx.include.join(", ")})
                        </span>
                      )}
                      {idx.filter && (
                        <span className="schema-filter-pill">
                          WHERE {idx.filter}
                        </span>
                      )}
                    </td>
                    <td>
                      <strong>{fmtBytes(idx.size_bytes)}</strong>
                    </td>
                    <td>{quantity(idx.seeks ?? idx.reads ?? 0)}</td>
                    <td>{quantity(idx.scans ?? 0)}</td>
                    <td>{quantity(idx.writes ?? 0)}</td>
                    <td>
                      <span className={`status ${health.tone}`}>
                        <i />
                        {health.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
