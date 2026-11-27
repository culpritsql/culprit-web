import { useSyncExternalStore, type MouseEvent } from "react";
import type { PublishedResourceSelector, WarehouseConnectionRef } from "./api";

export type Section =
  | "incident"
  | "timeline"
  | "resources"
  | "workload"
  | "operations"
  | "schema"
  | "changes"
  | "coverage";

const sections: Section[] = [
  "incident",
  "resources",
  "workload",
  "timeline",
  "operations",
  "schema",
  "changes",
  "coverage",
];

function validSection(raw: string | null | undefined): Section {
  return sections.find((s) => s === raw) ?? "incident";
}

export function appBasePath(): string {
  const configured = import.meta.env.BASE_URL || "/";
  if (configured !== "./" && configured !== ".") {
    return configured.endsWith("/") ? configured : configured + "/";
  }
  if (typeof location === "undefined") return "/";
  const p = location.pathname;
  if (p.endsWith("/index.html")) return p.slice(0, -10);
  return "/";
}

function joinBase(subpath: string): string {
  const base = appBasePath();
  const clean = subpath.replace(/^\/+/, "");
  return clean ? base + clean : base;
}

function stripBase(pathname: string): string {
  const base = appBasePath();
  if (base !== "/" && pathname.startsWith(base)) {
    return "/" + pathname.slice(base.length);
  }
  if (base !== "/" && pathname === base.slice(0, -1)) {
    return "/";
  }
  return pathname || "/";
}

function withStickyParams(params: URLSearchParams): URLSearchParams {
  if (
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("demo") === "1"
  ) {
    params.set("demo", "1");
  }
  return params;
}

function formatQuery(params: URLSearchParams): string {
  const str = params.toString();
  return str ? "?" + str : "";
}

export type ParsedRoute =
  | { kind: "home"; params: URLSearchParams }
  | { kind: "regions"; params: URLSearchParams }
  | { kind: "archive"; archive: string | null; params: URLSearchParams }
  | {
      kind: "investigate";
      archive: string | null;
      section: Section;
      params: URLSearchParams;
    };

export function parseRoute(
  loc: Pick<Location, "pathname" | "search"> = typeof location !== "undefined"
    ? location
    : { pathname: "/", search: "" },
): ParsedRoute {
  const params = new URLSearchParams(loc.search);
  const rel = stripBase(loc.pathname).replace(/\/+$/, "") || "/";
  const segs = rel.split("/").filter(Boolean);

  if (segs[0] === "regions") {
    return { kind: "regions", params };
  }
  if (segs[0] === "archives" && segs[1]) {
    const archive = decodeURIComponent(segs[1]);
    if (segs[2] === "investigate" || params.has("database")) {
      const sec = validSection(segs[3] ?? params.get("view"));
      return { kind: "investigate", archive, section: sec, params };
    }
    return { kind: "archive", archive, params };
  }

  // Legacy query-parameter deep links (`/?view=regions`, `/?archive=...`, `/?database=...`)
  if (params.get("view") === "regions") {
    return { kind: "regions", params };
  }
  if (params.has("database")) {
    return {
      kind: "investigate",
      archive: params.get("archive"),
      section: validSection(params.get("view")),
      params,
    };
  }
  if (params.has("archive") || params.has("revision")) {
    return { kind: "archive", archive: params.get("archive"), params };
  }
  return { kind: "home", params };
}

export function regionsUrl(): string {
  const q = withStickyParams(new URLSearchParams());
  return joinBase("regions") + formatQuery(q);
}

export function archiveUrl(name: string): string {
  const q = withStickyParams(new URLSearchParams());
  return joinBase(`archives/${encodeURIComponent(name)}`) + formatQuery(q);
}

export function investigationUrl(
  connection: WarehouseConnectionRef,
  resource: PublishedResourceSelector,
  around: string,
  section: Section = "incident",
): string {
  const q = withStickyParams(
    new URLSearchParams({
      revision: connection.revision,
      namespace: resource.namespace_id,
      database: resource.database,
      around,
    }),
  );
  return (
    joinBase(
      `archives/${encodeURIComponent(connection.name)}/investigate/${section}`,
    ) + formatQuery(q)
  );
}

export function activeSection(params?: URLSearchParams): Section {
  if (typeof location !== "undefined") {
    const parsed = parseRoute(location);
    if (parsed.kind === "investigate") return parsed.section;
  }
  return validSection(params?.get("view"));
}

export function sectionUrl(section: Section): string {
  const parsed = parseRoute(location);
  const nextParams = new URLSearchParams(location.search);
  nextParams.delete("view");
  nextParams.delete("incident");
  const archive =
    parsed.kind === "investigate" || parsed.kind === "archive"
      ? parsed.archive
      : nextParams.get("archive");
  if (archive) {
    nextParams.delete("archive");
    return (
      joinBase(
        `archives/${encodeURIComponent(archive)}/investigate/${section}`,
      ) + formatQuery(withStickyParams(nextParams))
    );
  }
  nextParams.set("view", section);
  return location.pathname + formatQuery(withStickyParams(nextParams));
}

export type ArchiveRange = Pick<
  import("../../vendor/culprit/app/src/gen/IncidentReadReport").IncidentReadReport,
  "from" | "until" | "recorded_before"
>;

export function getRange(
  params: URLSearchParams,
): ArchiveRange | null | "invalid" {
  if (!["from", "until", "asof"].some((key) => params.has(key))) return null;
  const from = params.get("from") ?? "",
    until = params.get("until") ?? "",
    recorded_before = params.get("asof") ?? "";
  const utc = (s: string) =>
    /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s) &&
    Number.isFinite(Date.parse(s));
  if (
    ![from, until, recorded_before].every(utc) ||
    Date.parse(from) >= Date.parse(until)
  )
    return "invalid";
  return { from, until, recorded_before };
}

export function putRange(params: URLSearchParams, range: ArchiveRange) {
  params.set("from", range.from);
  params.set("until", range.until);
  params.set("asof", range.recorded_before);
}

export function rangeUrl(bounds: ArchiveRange): string {
  const parsed = parseRoute(location);
  const nextParams = new URLSearchParams(location.search);
  nextParams.delete("incident");
  nextParams.delete("view");
  putRange(nextParams, bounds);
  const midpoint = (Date.parse(bounds.from) + Date.parse(bounds.until)) / 2;
  nextParams.set("around", new Date(midpoint).toISOString());
  if (parsed.kind === "investigate" && parsed.archive) {
    nextParams.delete("archive");
    return (
      joinBase(
        `archives/${encodeURIComponent(parsed.archive)}/investigate/${parsed.section}`,
      ) + formatQuery(withStickyParams(nextParams))
    );
  }
  return location.pathname + formatQuery(withStickyParams(nextParams));
}

const navListeners = new Set<() => void>();

function emitNav() {
  for (const listener of navListeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", emitNav);
}

function subscribeNav(listener: () => void) {
  navListeners.add(listener);
  return () => {
    navListeners.delete(listener);
  };
}

function currentHref() {
  return typeof location === "undefined"
    ? "/"
    : location.pathname + location.search;
}

export function useLocationHref(): string {
  return useSyncExternalStore(subscribeNav, currentHref, () => "/");
}

function routeEntityKey(loc: Pick<Location, "pathname" | "search">): string {
  const r = parseRoute(loc);
  if (r.kind === "regions" || r.kind === "home") return r.kind;
  if (r.kind === "archive") return `archive:${r.archive ?? r.params.get("revision") ?? ""}`;
  return `db:${r.archive ?? ""}:${r.params.get("namespace") ?? ""}:${r.params.get("database") ?? ""}`;
}

export function navigate(
  href: string,
  options?: boolean | { replace?: boolean; preserveScroll?: boolean },
) {
  if (typeof window === "undefined") return;
  const replace =
    typeof options === "boolean" ? options : (options?.replace ?? false);
  const preserveScroll =
    typeof options === "object" ? (options?.preserveScroll ?? false) : false;

  const next = new URL(href, location.href);
  if (next.origin !== location.origin || next.pathname.startsWith("/auth/")) {
    location.assign(href);
    return;
  }
  const prevEntity = routeEntityKey(location);
  const nextEntity = routeEntityKey(next);
  const target = next.pathname + next.search + next.hash;
  if (target === location.pathname + location.search + location.hash) return;
  if (replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);

  if (!preserveScroll && prevEntity !== nextEntity) {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }
  emitNav();
}

export function spaClick(event: MouseEvent<HTMLAnchorElement>) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const anchor = event.currentTarget;
  if (anchor.target && anchor.target !== "_self") return;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("/auth/")) return;
  const resolved = new URL(href, location.href);
  if (resolved.origin !== location.origin) return;
  event.preventDefault();
  navigate(resolved.pathname + resolved.search + resolved.hash);
}
