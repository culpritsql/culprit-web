import engines from "../../vendor/culprit/app/src/gen/engines.json";
import type { Engine } from "../../vendor/culprit/app/src/gen/Engine";

export function EngineBadge({
  engine,
  compact = false,
}: {
  engine: Engine;
  compact?: boolean;
}) {
  const label = engines[engine]?.label ?? engine;
  return (
    <span className={`engine-badge engine-${engine}`} title={label}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        {engine === "postgres" ? (
          <>
            <ellipse
              cx="8"
              cy="4.5"
              rx="5"
              ry="2.3"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M3 4.5v5c0 1.3 2.2 2.3 5 2.3s5-1 5-2.3v-5M3 7.2c0 1.3 2.2 2.3 5 2.3s5-1 5-2.3"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <circle cx="11.5" cy="12.5" r="1.6" fill="currentColor" />
          </>
        ) : engine === "mssql" ? (
          <>
            <rect
              x="2.5"
              y="2.5"
              width="11"
              height="3.2"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <rect
              x="2.5"
              y="6.4"
              width="11"
              height="3.2"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <rect
              x="2.5"
              y="10.3"
              width="11"
              height="3.2"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </>
        ) : engine === "mysql" ? (
          <>
            <path
              d="M2.5 11.5c1.2-4.2 4.2-7.5 8.5-8-1.4 2.2-1.8 4.2-.8 6.2 1.2-.5 2.4-.3 3.3.5-2.2.8-3.8 1.5-5.2 2.8-.9-1.4-2.8-2-5.8-1.5Z"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinejoin="round"
            />
          </>
        ) : engine === "yugabyte" ? (
          <>
            <polygon
              points="8,2 13.2,5 13.2,11 8,14 2.8,11 2.8,5"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M5.5 5.8L8 8.4l2.5-2.6M8 8.4v3.4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <rect
              x="3"
              y="2.5"
              width="10"
              height="11"
              rx="1.8"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M5.5 6h5M5.5 8.5h5M5.5 11h3"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
      {!compact && <span>{label}</span>}
    </span>
  );
}
