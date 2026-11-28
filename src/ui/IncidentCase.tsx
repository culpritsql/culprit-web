import { lazy, Suspense, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Fingerprint,
  GitCommitHorizontal,
  Link2,
  Lock,
  Network,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import type { BlockNode } from "../../vendor/culprit/app/src/gen/BlockNode";
import type { DerivedIncident } from "../../vendor/culprit/app/src/gen/DerivedIncident";
import type { DerivedIncidentQuery } from "../../vendor/culprit/app/src/gen/DerivedIncidentQuery";
import type { DiagnosticEvidenceRef } from "../../vendor/culprit/app/src/gen/DiagnosticEvidenceRef";
import type { Engine } from "../../vendor/culprit/app/src/gen/Engine";
import type { QueryStat } from "../../vendor/culprit/app/src/gen/QueryStat";
import type { WarehouseWindowReport } from "../../vendor/culprit/app/src/gen/WarehouseWindowReport";
import type { ArchiveScope as Archive } from "./api";
import { Evidence } from "./Evidence";
import { sectionUrl, spaClick } from "./navigation";
import { ObservationTimes } from "./ObservationTimes";
import { QueryInspectorDrawer } from "./QueryInspectorDrawer";
import { formatDurationMs, relativeAge, stamp } from "./shared";
import { w } from "./i18n";

const LazySql = lazy(async () => {
  const [mod] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: mod.Sql };
});

interface CallerVictim {
  app: string;
  user: string | null;
  sessions: number;
  maxWaitMs: number;
  waitType: string | null;
}

interface BlockingAttribution {
  headSession: string;
  headApp: string | null;
  headUser: string | null;
  headState: string | null;
  headOpenMs: number | null;
  waitType: string | null;
  totalWaiters: number;
  maxWaitMs: number;
  victims: CallerVictim[];
}

function collectWaiters(node: BlockNode, out: BlockNode[]) {
  for (const child of node.children) {
    out.push(child);
    collectWaiters(child, out);
  }
}

function extractBlockingAttribution(
  windowReport: WarehouseWindowReport | null | undefined,
): BlockingAttribution | null {
  const blockingPoints =
    windowReport?.telemetry?.activity
      .map((pt) => pt.blocking)
      .filter((b): b is NonNullable<typeof b> => Boolean(b)) ?? [];
  const latest = blockingPoints.at(-1);
  const chain = latest?.blocking?.chains[0];
  if (!chain) return null;

  const waiterNodes: BlockNode[] = [];
  collectWaiters(chain.tree, waiterNodes);

  const grouped = new Map<string, CallerVictim>();
  for (const wNode of waiterNodes) {
    const app = wNode.context?.application || `Session ${wNode.session}`;
    const user = wNode.context?.user ?? null;
    const prev = grouped.get(app) ?? {
      app,
      user,
      sessions: 0,
      maxWaitMs: 0,
      waitType: wNode.context?.wait ?? null,
    };
    prev.sessions += 1;
    prev.maxWaitMs = Math.max(prev.maxWaitMs, wNode.context?.wait_ms ?? 0);
    if (!prev.waitType && wNode.context?.wait) prev.waitType = wNode.context.wait;
    grouped.set(app, prev);
  }

  return {
    headSession: chain.head,
    headApp: chain.tree.context?.application ?? null,
    headUser: chain.tree.context?.user ?? null,
    headState: chain.tree.context?.state ?? chain.head_kind,
    headOpenMs:
      chain.transaction_ms ??
      chain.tree.context?.transaction_ms ??
      chain.head_ms ??
      null,
    waitType: chain.wait_type ?? null,
    totalWaiters: chain.waiters,
    maxWaitMs: chain.longest_wait_ms ?? 0,
    victims: [...grouped.values()].sort((a, b) => b.maxWaitMs - a.maxWaitMs),
  };
}

function normalizeSqlTokens(sql: string): string[] {
  return sql
    .toLowerCase()
    .replace(/[\[\]"`']/g, " ")
    .replace(/[^a-z0-9_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !["from", "where", "set", "and", "the"].includes(tok));
}

function matchWorkloadIndex(
  sqlText: string | undefined,
  queries: QueryStat[],
): number | null {
  if (!sqlText || !queries.length) return null;
  const cleanTarget = sqlText.replace(/\s+/g, " ").trim().toLowerCase();
  const exactIdx = queries.findIndex(
    (q) => q.text && q.text.replace(/\s+/g, " ").trim().toLowerCase() === cleanTarget,
  );
  if (exactIdx >= 0) return exactIdx;

  const targetTokens = normalizeSqlTokens(sqlText);
  if (targetTokens.length < 2) return null;
  const targetVerb = targetTokens[0];
  let bestIdx = -1;
  let bestScore = 0;

  queries.forEach((q, idx) => {
    if (!q.text) return;
    const candTokens = new Set(normalizeSqlTokens(q.text));
    const candArr = [...candTokens];
    if (candArr[0] !== targetVerb) return;
    let overlap = 0;
    for (const tok of targetTokens) {
      if (candTokens.has(tok)) overlap += 1;
    }
    const score = overlap / Math.max(targetTokens.length, 1);
    if (overlap >= 2 && score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  return bestIdx >= 0 ? bestIdx : null;
}

function Queries({
  title,
  tone,
  items,
  workloadQueries,
  onInspectIndex,
}: {
  title: string;
  tone: "affected" | "culprit" | "candidate";
  items: DerivedIncidentQuery[];
  workloadQueries: QueryStat[];
  onInspectIndex: (idx: number) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="case-section">
      <h3 className="case-section-heading">{title}</h3>
      {items.map((query, i) => {
        const sqlText =
          query.sql.state === "available" ? query.sql.text : undefined;
        const matchedIdx = matchWorkloadIndex(sqlText, workloadQueries);
        const matchedQuery =
          matchedIdx !== null ? workloadQueries[matchedIdx] : undefined;

        return (
          <div key={i} className={`query query-${tone}`}>
            <div className="query-card-bar">
              <span className={`query-role-tag role-${tone}`}>
                {tone === "culprit"
                  ? "Root-cause statement"
                  : tone === "affected"
                    ? "Blocked / impacted SQL"
                    : "Candidate SQL"}
              </span>
              {matchedIdx !== null && (
                <button
                  type="button"
                  className="chip query-inspect-btn"
                  onClick={() => onInspectIndex(matchedIdx)}
                >
                  <Network size={12} />
                  <span>
                    {matchedQuery?.plan
                      ? "Inspect SQL & execution plan"
                      : "Inspect in Top SQL"}
                  </span>
                  <ArrowUpRight size={12} />
                </button>
              )}
            </div>
            {query.sql.state === "available" ? (
              <Suspense fallback={<code>{query.sql.text}</code>}>
                <LazySql text={query.sql.text} pretty />
              </Suspense>
            ) : (
              <code className="sql-unavailable-pill">{w.noPayload}</code>
            )}
            {query.causal_role && (
              <p className="query-role-note">
                {query.causal_role.explanation.text}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function IncidentCase({
  incident,
  connection,
  resource,
  windowReport,
  dbName,
  engine,
  environment,
  referenceIso,
}: Archive & {
  incident: DerivedIncident;
  windowReport?: WarehouseWindowReport | null;
  dbName?: string;
  engine?: Engine | null;
  environment?: string | null;
  referenceIso?: string;
}) {
  const [selected, setSelected] = useState<DiagnosticEvidenceRef | null>(null);
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [drawerIndex, setDrawerIndex] = useState<number | null>(null);

  const refs = [
    incident.revision_reference,
    ...incident.affected_queries.flatMap((q) => q.evidence),
    ...incident.culprit_queries.flatMap((q) => q.evidence),
    ...incident.candidate_queries.flatMap((q) => q.evidence),
  ];
  const originals = [
    ...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values(),
  ];
  const entry = incident.entry;
  const permalink = new URL(location.href);
  permalink.searchParams.set("incident", entry.revision_id);

  const lifecycleTone =
    entry.lifecycle === "active"
      ? "danger"
      : entry.lifecycle === "resolved"
        ? "observed"
        : "partial";

  const spanMs = Date.parse(entry.last_seen_at) - Date.parse(entry.first_seen_at);
  const spanLabel =
    Number.isFinite(spanMs) && spanMs >= 0
      ? `${formatDurationMs(spanMs)} span`
      : null;

  const refClock = referenceIso ?? entry.recorded_at;
  const lastSeenRel = relativeAge(entry.last_seen_at, refClock);
  const firstSeenRel = relativeAge(entry.first_seen_at, refClock);

  const blockingAttr = useMemo(
    () => extractBlockingAttribution(windowReport),
    [windowReport],
  );

  const deadlocks = windowReport?.telemetry?.deadlocks ?? [];
  const latestReplication = windowReport?.telemetry?.replication?.at(-1)?.report;

  const correlatedChanges = useMemo(() => {
    const out: Array<{
      id: string;
      kind: string;
      title: string;
      at: string;
      object: string | null;
      failed: boolean;
    }> = [];
    for (const pub of windowReport?.published ?? []) {
      for (const ch of pub.changes) {
        const ev = ch.change.change;
        out.push({
          id: ev.id + ev.at,
          kind: ev.kind,
          title: ev.title.text,
          at: ev.at,
          object: ev.object,
          failed: ev.job_execution?.status === "failed",
        });
      }
    }
    return out
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 4);
  }, [windowReport]);

  const workloadQueries = useMemo<QueryStat[]>(() => {
    if (windowReport?.workload.kind !== "evaluated") return [];
    return (
      windowReport.workload.analysis.sections[0]?.analysis.workload?.queries ??
      []
    );
  }, [windowReport]);

  const workloadTotals = useMemo(
    () => ({
      totalTime: workloadQueries.reduce((s, q) => s + (q.total_time_ms ?? 0), 0),
      totalCpu: workloadQueries.reduce((s, q) => s + (q.cpu_time_ms ?? 0), 0),
      totalReads: workloadQueries.reduce((s, q) => s + (q.logical_reads ?? 0), 0),
    }),
    [workloadQueries],
  );

  const targetLabel = [
    dbName ?? incident.display.database_name ?? incident.display.connection_alias ?? "Database",
    engine ? engine.toUpperCase() : null,
    environment ?? incident.display.environment ?? null,
    connection.name,
  ]
    .filter(Boolean)
    .join(" · ");

  const buildSlackBrief = () => {
    const culpritLine = blockingAttr
      ? `${blockingAttr.headApp ?? "Session"} (Session ${blockingAttr.headSession}${blockingAttr.headUser ? ` · ${blockingAttr.headUser}` : ""}${blockingAttr.waitType ? ` · ${blockingAttr.waitType}` : ""})`
      : incident.culprit_queries[0]?.causal_role?.explanation.text ??
        (incident.culprit_queries[0]?.sql.state === "available"
          ? incident.culprit_queries[0].sql.text
          : "See attributed evidence");
    return [
      `*[${entry.lifecycle.toUpperCase()}] ${targetLabel}* — ${entry.title}`,
      `• *Window:* ${stamp(entry.first_seen_at)} → ${stamp(entry.last_seen_at)}${spanLabel ? ` (${spanLabel})` : ""}`,
      `• *Impact:* ${incident.victim_summary}`,
      `• *Culprit:* ${culpritLine}`,
      `• *Fix:* ${incident.developer_action}`,
      `• *Triage link:* ${permalink.href}`,
    ].join("\n");
  };

  const buildAgentPrompt = () => {
    const culpritSql =
      incident.culprit_queries[0]?.sql.state === "available"
        ? incident.culprit_queries[0].sql.text
        : incident.affected_queries[0]?.sql.state === "available"
          ? incident.affected_queries[0].sql.text
          : null;
    const callerHint = blockingAttr?.headApp
      ? `Service/caller: \`${blockingAttr.headApp}\` (DB user \`${blockingAttr.headUser ?? "unknown"}\`, Session ${blockingAttr.headSession}).`
      : "";
    return [
      `Investigate and fix database incident "${entry.title}" on ${targetLabel}.`,
      `Archive: "${connection.name}" | namespace_id: "${resource.namespace_id}" | database: "${resource.database}" | revision_id: "${entry.revision_id}" | around: "${entry.last_seen_at}"`,
      callerHint,
      incident.mechanism ? `Mechanism: ${incident.mechanism}` : "",
      culpritSql ? `SQL: ${culpritSql}` : "",
      `Recommended remediation: ${incident.developer_action}`,
      `Verification check: ${incident.verification}`,
    ]
      .filter(Boolean)
      .join("\n");
  };

  return (
    <article className="panel case">
      <div className="case-title">
        <div className="case-badges">
          <span className={`status ${lifecycleTone}`}>
            <i />
            {entry.lifecycle}
          </span>
          <span className="case-meta-pill">
            <ShieldCheck size={12} />
            {incident.attribution_status}
          </span>
          {spanLabel && <span className="case-meta-pill">{spanLabel}</span>}
          {lastSeenRel && (
            <span className="case-meta-pill case-rel-pill">
              <Clock3 size={11} />
              {entry.lifecycle === "active"
                ? `Started ${firstSeenRel}`
                : `Last seen ${lastSeenRel}`}
            </span>
          )}
        </div>

        <div className="case-share-actions">
          <button
            type="button"
            className="chip case-action-chip"
            aria-label="Copy incident brief"
            onClick={() => {
              navigator.clipboard?.writeText(buildSlackBrief());
              setCopiedBrief(true);
              setTimeout(() => setCopiedBrief(false), 1800);
            }}
          >
            {copiedBrief ? <Check size={12} /> : <ClipboardList size={12} />}
            <span>{copiedBrief ? "Copied brief" : "Copy brief"}</span>
          </button>
          <button
            type="button"
            className="chip case-action-chip"
            aria-label="Copy coding agent prompt"
            onClick={() => {
              navigator.clipboard?.writeText(buildAgentPrompt());
              setCopiedPrompt(true);
              setTimeout(() => setCopiedPrompt(false), 1800);
            }}
          >
            {copiedPrompt ? <Check size={12} /> : <Bot size={12} />}
            <span>{copiedPrompt ? "Copied prompt" : "Copy agent prompt"}</span>
          </button>
          <a
            className="permalink-chip"
            href={permalink.pathname + permalink.search}
            onClick={(e) => {
              spaClick(e);
              navigator.clipboard?.writeText(permalink.href);
              setCopiedLink(true);
              setTimeout(() => setCopiedLink(false), 1600);
            }}
          >
            {copiedLink ? <Check size={13} /> : <Link2 size={13} />}
            {w.permalink}
          </a>
        </div>
      </div>

      <h2>{entry.title}</h2>
      <p className="lead">{incident.victim_summary}</p>
      <ObservationTimes
        first={entry.first_seen_at}
        last={entry.last_seen_at}
        recorded={entry.recorded_at}
        referenceIso={refClock}
      />

      <div className="case-columns">
        <div>
          {incident.mechanism && (
            <section className="case-section mechanism-callout">
              <h3 className="case-section-heading">{w.mechanism}</h3>
              <p>{incident.mechanism}</p>
            </section>
          )}
          <Queries
            title={w.culprit}
            tone="culprit"
            items={incident.culprit_queries}
            workloadQueries={workloadQueries}
            onInspectIndex={(idx) => setDrawerIndex(idx)}
          />
          <Queries
            title={w.affected}
            tone="affected"
            items={incident.affected_queries}
            workloadQueries={workloadQueries}
            onInspectIndex={(idx) => setDrawerIndex(idx)}
          />
          <Queries
            title={w.candidate}
            tone="candidate"
            items={incident.candidate_queries}
            workloadQueries={workloadQueries}
            onInspectIndex={(idx) => setDrawerIndex(idx)}
          />
          <section className="case-section action-grid">
            <div className="action-box action-fix">
              <h3>
                <Wrench size={14} />
                {w.action}
              </h3>
              <p>{incident.developer_action}</p>
            </div>
            <div className="action-box action-verify">
              <h3>
                <CheckCircle2 size={14} />
                {w.verify}
              </h3>
              <p>{incident.verification}</p>
            </div>
          </section>
        </div>

        <aside className="case-intel-rail">
          <div className="intel-rail-block">
            <div className="intel-rail-head">
              <h3>
                <Users size={15} />
                Blast radius &amp; callers
              </h3>
              {(blockingAttr || deadlocks.length > 0 || latestReplication) && (
                <a
                  className="rail-jump-link"
                  href={sectionUrl("resources")}
                  onClick={spaClick}
                >
                  Blocking &amp; wait tree <ArrowUpRight size={12} />
                </a>
              )}
            </div>

            {blockingAttr ? (
              <div className="attribution-stack">
                <div className="attr-card attr-culprit">
                  <div className="attr-card-eyebrow">
                    <Lock size={11} />
                    <span>HEAD BLOCKER · SESSION {blockingAttr.headSession}</span>
                  </div>
                  <strong className="attr-service-name">
                    {blockingAttr.headApp ?? `Session ${blockingAttr.headSession}`}
                  </strong>
                  <div className="attr-meta-tags">
                    {blockingAttr.headUser && (
                      <code>{blockingAttr.headUser}</code>
                    )}
                    {blockingAttr.headState && (
                      <span>{blockingAttr.headState}</span>
                    )}
                    {blockingAttr.waitType && (
                      <span className="wait-pill wait-lock">
                        {blockingAttr.waitType}
                      </span>
                    )}
                    {blockingAttr.headOpenMs != null && (
                      <span>
                        tx {formatDurationMs(blockingAttr.headOpenMs)}
                      </span>
                    )}
                  </div>
                </div>

                {blockingAttr.victims.length > 0 && (
                  <div className="attr-victims-box">
                    <span className="attr-sub-label">
                      Impacted callers ({blockingAttr.totalWaiters} blocked)
                    </span>
                    {blockingAttr.victims.map((v) => (
                      <div key={v.app} className="attr-victim-row">
                        <div>
                          <strong>{v.app}</strong>
                          {v.user && <small>{v.user}</small>}
                        </div>
                        <span className="attr-victim-stat">
                          {v.sessions} {v.sessions === 1 ? "session" : "sessions"} ·{" "}
                          {formatDurationMs(v.maxWaitMs)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : deadlocks.length > 0 ? (
              <div className="attr-card attr-culprit">
                <div className="attr-card-eyebrow">
                  <ShieldAlert size={11} />
                  <span>LOCK CYCLE · {deadlocks.length} CAPTURED</span>
                </div>
                <strong className="attr-service-name">
                  {deadlocks[0]!.headline || deadlocks[0]!.pattern}
                </strong>
                <p className="attr-note">{deadlocks[0]!.explanation}</p>
              </div>
            ) : latestReplication ? (
              <div className="attr-card">
                <div className="attr-card-eyebrow">
                  <span>REPLICATION &amp; HA TOPOLOGY</span>
                </div>
                <strong className="attr-service-name">
                  {latestReplication.title}
                </strong>
                <p className="attr-note">{latestReplication.summary}</p>
              </div>
            ) : (
              <div className="attr-card">
                <div className="attr-card-eyebrow">
                  <span>CAUSAL ATTRIBUTION</span>
                </div>
                <strong className="attr-service-name">
                  {incident.attribution_status === "established"
                    ? "Verified from native activity"
                    : "Candidate evidence retained"}
                </strong>
                <p className="attr-note">
                  {incident.culprit_queries.length} attributed ·{" "}
                  {incident.affected_queries.length} affected ·{" "}
                  {originals.length} archive captures
                </p>
              </div>
            )}
          </div>

          <div className="intel-rail-block">
            <div className="intel-rail-head">
              <h3>
                <GitCommitHorizontal size={15} />
                Changes in window
              </h3>
              <a
                className="rail-jump-link"
                href={sectionUrl("schema")}
                onClick={spaClick}
              >
                Advisors <ArrowUpRight size={12} />
              </a>
            </div>
            {correlatedChanges.length > 0 ? (
              <ul className="rail-changes-list">
                {correlatedChanges.map((ch) => (
                  <li key={ch.id} className="rail-change-item">
                    <div className="rail-change-top">
                      <span
                        className={`category-pill ${ch.failed ? "sev-danger" : ""}`}
                      >
                        {ch.failed ? `${ch.kind} · failed` : ch.kind}
                      </span>
                      <small>{relativeAge(ch.at, refClock)}</small>
                    </div>
                    <span className="rail-change-title">{ch.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted rail-empty-note">
                No DDL, configuration, or job changes recorded in this window.
              </p>
            )}
          </div>
        </aside>
      </div>

      <footer className="case-provenance-strip">
        <div className="provenance-strip-head">
          <span className="provenance-strip-title">
            <Fingerprint size={13} />
            <strong>{w.orig}</strong>
            <small>
              {originals.length}{" "}
              {originals.length === 1 ? "capture" : "captures"} · {w.at}:{" "}
              {incident.attribution_status}
            </small>
          </span>
        </div>
        <div className="evidence-chip-grid">
          {originals.map((ref, i) => {
            const isSel =
              selected && JSON.stringify(selected) === JSON.stringify(ref);
            return (
              <button
                type="button"
                key={i}
                className="evidence-button"
                data-selected={Boolean(isSel)}
                onClick={() => setSelected(isSel ? null : ref)}
              >
                <span>
                  <strong>{ref.stream}</strong>
                  <small>sha256:{ref.manifest_sha256.slice(0, 16)}…</small>
                </span>
                <ChevronRight
                  size={14}
                  className={
                    isSel ? "select-chevron rotated" : "select-chevron"
                  }
                />
              </button>
            );
          })}
        </div>
        {selected && (
          <Evidence
            key={JSON.stringify(selected)}
            reference={selected}
            connection={connection}
            resource={resource}
          />
        )}
      </footer>

      {drawerIndex !== null && workloadQueries[drawerIndex] && (
        <QueryInspectorDrawer
          queries={workloadQueries}
          selectedIndex={drawerIndex}
          totals={workloadTotals}
          onSelectIndex={setDrawerIndex}
          onClose={() => setDrawerIndex(null)}
        />
      )}
    </article>
  );
}
