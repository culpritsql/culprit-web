import { useContext, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { WarehouseArtifactQuery } from "../../vendor/culprit/app/src/gen/WarehouseArtifactQuery";
import { api, ExportAccess, type WarehouseConnectionRef } from "./api";
import w from "./en.json";

export function ExportEvidence({
  connection,
  query,
}: {
  connection: WarehouseConnectionRef;
  query: WarehouseArtifactQuery;
}) {
  const allowed = useContext(ExportAccess);
  const operation = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => () => operation.current?.abort(), []);
  async function download() {
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setMessage("");
    try {
      const report = await api.exportOriginal(
        connection,
        query,
        controller.signal,
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "culprit-evidence.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!controller.signal.aborted)
        setMessage(e instanceof Error ? e.message : w.error);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }
  if (!allowed) return null;
  return (
    <>
      <button
        className="button"
        disabled={pending}
        onClick={() => void download()}
      >
        <Download size={14} />
        {pending ? w.exportBusy : w.exportOriginal}
      </button>
      {message && <p role="alert">{message}</p>}
    </>
  );
}
