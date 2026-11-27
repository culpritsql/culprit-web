import { AlertCircle, LoaderCircle } from "lucide-react";
import words from "./en.json";

export function StateMessage({ error }: { error?: string }) {
  return (
    <div className="notice" role={error ? "alert" : "status"}>
      {error ? <AlertCircle size={18} /> : <LoaderCircle size={18} />}{" "}
      {error ?? words.loading}
    </div>
  );
}
export function stamp(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: "UTC",
      }).format(d) + " UTC";
}

const numberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
export function quantity(value: number | null) {
  return value === null ? "—" : numberFormat.format(value);
}
