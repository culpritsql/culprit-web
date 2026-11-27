import { execFileSync } from "node:child_process";
import type { Finding } from "../vendor/culprit/app/src/gen/Finding";
import type { WarehouseFleetRow } from "../vendor/culprit/app/src/gen/WarehouseFleetRow";
import type { WarehouseIncidentView } from "../vendor/culprit/app/src/gen/WarehouseIncidentView";
import type { Workload } from "../vendor/culprit/app/src/gen/Workload";

const script = `
  import { around, indexFinding, resource, rows, view, workload } from "./src/ui/demoDataset.ts";
  console.log(JSON.stringify({ around, indexFinding, resource, rows, view, workload }, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  ));
`;
const loaded = JSON.parse(
  execFileSync("bun", ["-e", script], { encoding: "utf8" }),
);

export const around: string = loaded.around;
export const indexFinding: Finding = loaded.indexFinding;
export const resource: { namespace_id: string; database: string } =
  loaded.resource;
export const rows: WarehouseFleetRow[] = loaded.rows;
export const view: WarehouseIncidentView = loaded.view;
export const workload: Workload = loaded.workload;
