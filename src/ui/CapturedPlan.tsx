import { lazy, Suspense, useState } from "react";
import type { Plan } from "../../vendor/culprit/app/src/gen/Plan";
import w from "./en.json";

const Viewer = lazy(async () => {
  const [module] = await Promise.all([
    import("@culpritsql/plan-viewer"),
    import("@culpritsql/plan-viewer/styles.css"),
  ]);
  return { default: module.PlanViewer };
});

export function CapturedPlan({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{w.executionPlan}</summary>
      {open && (
        <Suspense fallback={<p role="status">{w.loading}</p>}>
          <Viewer plan={plan} />
        </Suspense>
      )}
    </details>
  );
}
