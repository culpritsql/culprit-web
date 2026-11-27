import type { PublishedResourceSelector, WarehouseConnectionRef } from "./api";
export type Section =
  | "incident"
  | "workload"
  | "changes"
  | "coverage"
  | "timeline"
  | "operations"
  | "schema";
const sections: Section[] = [
  "incident",
  "workload",
  "changes",
  "coverage",
  "timeline",
  "operations",
  "schema",
];

export function archiveUrl(name: string) {
  return "/?" + new URLSearchParams({ archive: name });
}
export function investigationUrl(
  connection: WarehouseConnectionRef,
  resource: PublishedResourceSelector,
  around: string,
  section: Section = "incident",
) {
  return (
    "/?" +
    new URLSearchParams({
      archive: connection.name,
      revision: connection.revision,
      namespace: resource.namespace_id,
      database: resource.database,
      around,
      view: section,
    })
  );
}
export function activeSection(params: URLSearchParams): Section {
  return sections.find((s) => s === params.get("view")) ?? "incident";
}
export function sectionUrl(section: Section) {
  const url = new URL(location.href);
  url.searchParams.set("view", section);
  url.searchParams.delete("incident");
  return url.pathname + url.search;
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
