import type { WarehouseFleetRequest } from "./api";
import type { Engine } from "../../vendor/culprit/app/src/gen/Engine";

export function fleetRequest(
  asOf: string,
  pageRows: number,
  attentionOnly = false,
  after: WarehouseFleetRequest["after"] = null,
  options?: {
    environment?: string | null;
    engine?: Engine | null;
    sharedGroup?: string | null;
    sort?: WarehouseFleetRequest["sort"];
  },
): WarehouseFleetRequest {
  return {
    as_of: asOf,
    window: null,
    max_age_seconds: 3600,
    filter: {
      environment: options?.environment ?? null,
      engine: options?.engine ?? null,
      attention_only: attentionOnly,
      shared_group: options?.sharedGroup ?? null,
    },
    sort: options?.sort ?? "attention",
    page_rows: pageRows,
    after,
  };
}
