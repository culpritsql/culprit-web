import type { WarehouseFleetRequest } from "./api";

export function fleetRequest(
  asOf: string,
  pageRows: number,
  attentionOnly = false,
  after: WarehouseFleetRequest["after"] = null,
): WarehouseFleetRequest {
  return {
    as_of: asOf,
    window: null,
    max_age_seconds: 3600,
    filter: {
      environment: null,
      engine: null,
      attention_only: attentionOnly,
      shared_group: null,
    },
    sort: "attention",
    page_rows: pageRows,
    after,
  };
}
