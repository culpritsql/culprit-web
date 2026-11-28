import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Command,
  Database,
  Globe2,
  Languages,
  Layers3,
  Palette,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  archiveUrl,
  investigationUrl,
  navigate,
  regionsUrl,
  sectionUrl,
  type Section,
} from "./navigation";
import { THEMES, setThemeChoice } from "./themes";
import { LOCALES, setLocale, useLocale, w } from "./i18n";
import type { Engine } from "../../vendor/culprit/app/src/gen/Engine";
import type { WarehouseFleetRow } from "../../vendor/culprit/app/src/gen/WarehouseFleetRow";
import type { WarehouseConnectionRef, PublishedResourceSelector } from "./api";

export interface PaletteResource {
  name: string;
  engine: Engine;
  environment?: string | null;
  archive: WarehouseConnectionRef;
  selector: PublishedResourceSelector;
  around: string;
  freshness?: WarehouseFleetRow["freshness"];
  sharedGroup?: WarehouseFleetRow["shared_group"];
  activeIncidents?: number;
  cpuPct?: number | null;
  memoryPct?: number | null;
  dominantWait?: string | null;
  latestCollectedUntil?: string;
}

export interface PaletteDemoScenario {
  label: string;
  detail: string;
  href: string;
}

interface Item {
  id: string;
  group: string;
  label: string;
  detail?: string;
  icon: typeof Database;
  run: () => void;
}

export function CommandPalette({
  connections,
  regions,
  knownResources,
  investigating,
  demoScenarios = [],
}: {
  connections: WarehouseConnectionRef[];
  regions: Record<string, string>;
  knownResources: PaletteResource[];
  investigating: boolean;
  demoScenarios?: PaletteDemoScenario[];
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      } else if (event.key === "Escape" && open) {
        setOpen(false);
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    void locale;
    const sectionItems: { key: Section; label: string }[] = [
      { key: "incident", label: w.progress },
      { key: "resources", label: w.resourcesTab },
      { key: "workload", label: w.workloadTopSql },
      { key: "schema", label: w.schema },
      { key: "timeline", label: w.timeline },
    ];
    const list: Item[] = [];
    for (const demo of demoScenarios) {
      list.push({
        id: "demo:" + demo.label,
        group: w.showcaseScenarios,
        label: demo.label,
        detail: demo.detail,
        icon: Sparkles,
        run: () => navigate(demo.href),
      });
    }
    if (connections.length > 1) {
      list.push({
        id: "nav:regions",
        group: w.navigation,
        label: w.regionalFleetsOverview,
        detail: `${connections.length} ${w.archive.toLowerCase()}`,
        icon: Globe2,
        run: () => navigate(regionsUrl()),
      });
    }
    for (const conn of connections) {
      list.push({
        id: "archive:" + conn.name,
        group: w.archive,
        label: conn.name,
        detail: regions[conn.name]
          ? `${regions[conn.name]} · ${w.openFleet}`
          : w.openFleet,
        icon: Layers3,
        run: () => navigate(archiveUrl(conn.name)),
      });
    }
    for (const db of knownResources) {
      list.push({
        id: `db:${db.archive.name}:${db.selector.database}`,
        group: w.databasesGroup,
        label: db.name,
        detail: [db.engine.toUpperCase(), db.environment, db.archive.name]
          .filter(Boolean)
          .join(" · "),
        icon: Database,
        run: () =>
          navigate(
            investigationUrl(db.archive, db.selector, db.around, "incident"),
          ),
      });
    }
    if (investigating) {
      for (const sec of sectionItems) {
        list.push({
          id: "sec:" + sec.key,
          group: w.currentDbViews,
          label: sec.label,
          icon: Activity,
          run: () => navigate(sectionUrl(sec.key)),
        });
      }
    }
    for (const theme of THEMES) {
      list.push({
        id: "theme:" + theme.id,
        group: w.appearanceGroup,
        label: `${w.theme}: ${theme.label}`,
        detail: theme.tagline,
        icon: Palette,
        run: () => setThemeChoice(theme.id),
      });
    }
    for (const loc of LOCALES) {
      list.push({
        id: "lang:" + loc.code,
        group: w.language,
        label: `${w.language}: ${loc.nativeName}`,
        detail: loc.englishName,
        icon: Languages,
        run: () => setLocale(loc.code),
      });
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q) ||
        (item.detail?.toLowerCase().includes(q) ?? false),
    );
  }, [
    connections,
    regions,
    knownResources,
    investigating,
    demoScenarios,
    query,
    locale,
  ]);

  if (!open) return null;

  const clampedActive = Math.min(active, Math.max(0, items.length - 1));

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="palette-modal panel"
        role="dialog"
        aria-modal="true"
        aria-label="Quick jump"
      >
        <div className="palette-search">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder={w.searchJumpPlaceholder}
            aria-label="Jump to database, region, view or theme"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && items[clampedActive]) {
                e.preventDefault();
                items[clampedActive].run();
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Close quick jump"
            onClick={() => setOpen(false)}
          >
            <X size={15} />
          </button>
        </div>
        <div className="palette-results">
          {items.length === 0 ? (
            <p className="palette-empty">{w.noPaletteMatches}</p>
          ) : (
            items.map((item, index) => {
              const Icon = item.icon;
              const prevGroup = index > 0 ? items[index - 1].group : null;
              return (
                <div key={item.id}>
                  {item.group !== prevGroup && (
                    <div className="palette-group">{item.group}</div>
                  )}
                  <button
                    type="button"
                    className="palette-item"
                    data-active={index === clampedActive}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      item.run();
                      setOpen(false);
                    }}
                  >
                    <Icon size={15} />
                    <span className="palette-item-label">{item.label}</span>
                    {item.detail && <small>{item.detail}</small>}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <footer className="palette-foot">
          <span>
            <Command size={12} /> Use ↑↓ to navigate · Enter to open · Esc to
            dismiss
          </span>
        </footer>
      </div>
    </div>
  );
}
