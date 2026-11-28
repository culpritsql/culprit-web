import { lazy, Suspense, useState } from "react";
import type { Plan } from "../../vendor/culprit/app/src/gen/Plan";
import type { QueryStat } from "../../vendor/culprit/app/src/gen/QueryStat";
import { useTheme } from "./themes";
import { useLocale, w } from "./i18n";

const Viewer = lazy(async () => {
  const [module] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: module.PlanViewer };
});

export function CapturedPlan({
  plan,
  query,
  label,
}: {
  plan: Plan;
  query?: QueryStat;
  label?: string;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const { colorMode } = useTheme();
  return (
    <details
      className="captured-plan-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{label ?? w.executionPlan}</summary>
      {open && (
        <Suspense fallback={<p role="status">{w.loading}</p>}>
          <Viewer plan={plan} query={query} theme={colorMode} />
        </Suspense>
      )}
    </details>
  );
}
