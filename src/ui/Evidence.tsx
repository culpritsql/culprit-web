import { useCallback, useState } from "react";
import type { DiagnosticEvidenceRef } from "../../vendor/culprit/app/src/gen/DiagnosticEvidenceRef";
import type { WarehouseArtifactTextRead } from "../../vendor/culprit/app/src/gen/WarehouseArtifactTextRead";
import {
  api,
  useRead,
  useReadDefaults,
  type WarehouseConnectionRef,
  type PublishedResourceSelector,
} from "./api";
import { StateMessage, stamp } from "./shared";
import w from "./en.json";
type Archive = { connection: WarehouseConnectionRef; resource: PublishedResourceSelector };
export function Evidence({
  connection,
  resource,
  reference,
}: { reference: DiagnosticEvidenceRef } & Archive) {
  const { artifact_chunk_chars: chunkChars } = useReadDefaults();
  const [fullPayloads, setFullPayloads] = useState(false);
  const [textRead, setTextRead] = useState<WarehouseArtifactTextRead>({
    kind: "inventory",
    chunk_chars: chunkChars,
  });
  const load = useCallback(
    (signal: AbortSignal) =>
      api.artifacts(
        connection,
        {
          resource,
          references: [reference],
          full_payloads: fullPayloads,
          text: textRead,
          expected_sql_sha256: null,
        },
        signal,
      ),
    [connection, resource, reference, fullPayloads, textRead],
  );
  const result = useRead(load);
  if (result.status !== "ready")
    return <StateMessage error={result.status === "error" ? result.message : undefined} />;
  const report = result.value;
  return (
    <div className="records">
      <h3>{w.artifactScope}</h3>
      {!fullPayloads && (
        <button className="button" onClick={() => setFullPayloads(true)}>
          {w.readOriginal}
        </button>
      )}
      {textRead.kind === "chunk" && (
        <button
          className="button"
          onClick={() => setTextRead({ kind: "inventory", chunk_chars: chunkChars })}
        >
          {w.backInventory}
        </button>
      )}
      {report.records.length === 0 && <p>{w.miss}</p>}
      {report.records.map((row, i) => (
        <div key={i}>
          <strong>{row.source}</strong>
          <p>
            {stamp(row.collected_from)} — {stamp(row.collected_until)}
          </p>
          {row.artifacts.map((item, index) => (
            <div key={index}>
              <h4>{item.label}</h4>
              {item.payload.kind === "complete" && (
                <pre>
                  {item.payload.payload.state === "available"
                    ? item.payload.payload.text
                    : item.payload.payload.reason}
                </pre>
              )}
              {item.payload.kind === "chunk" && <pre>{item.payload.text}</pre>}
              {item.payload.kind !== "complete" && item.payload.next && (
                <button
                  className="button"
                  onClick={() => {
                    if (item.payload.kind !== "complete" && item.payload.next)
                      setTextRead({ kind: "chunk", cursor: item.payload.next });
                  }}
                >
                  {item.payload.kind === "chunk" ? w.nextChunk : w.readText}
                </button>
              )}
              {item.limitations.map((reason, i) => (
                <p key={i}>{reason}</p>
              ))}
            </div>
          ))}
          <details>
            <summary>{w.more}</summary>
            <pre>{JSON.stringify(row, null, 2)}</pre>
          </details>
        </div>
      ))}
      {[...report.gaps.map((g) => g.kind), ...report.qualifications].map((text, i) => (
        <p key={i}>{text}</p>
      ))}
    </div>
  );
}
