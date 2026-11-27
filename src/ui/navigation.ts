import type { PublishedResourceSelector, WarehouseConnectionRef } from "./api";
export type Section = "incident" | "workload" | "changes" | "coverage";
const sections: Section[] = ["incident", "workload", "changes", "coverage"];

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
