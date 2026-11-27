import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Database,
  Globe2,
  Search,
} from "lucide-react";
import type { WarehouseConnectionRef } from "./api";
import { archiveUrl, navigate, regionsUrl, spaClick } from "./navigation";
import w from "./en.json";

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  detail?: string;
  icon?: ReactNode;
}

export function SelectMenu<V extends string>({
  label,
  prefix,
  value,
  options,
  onChange,
  align = "right",
}: {
  label: string;
  prefix?: string;
  value: V;
  options: SelectOption<V>[];
  onChange: (next: V) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = options.find((opt) => opt.value === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="select-menu" ref={wrapRef}>
      <button
        type="button"
        className="select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {prefix && <span className="select-prefix">{prefix}</span>}
        <span className="select-current">{current.label}</span>
        <ChevronDown
          size={13}
          className={open ? "select-chevron rotated" : "select-chevron"}
        />
      </button>
      {open && (
        <div
          className={`select-popover panel select-align-${align}`}
          role="listbox"
          aria-label={label}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                type="button"
                role="option"
                key={opt.value}
                aria-selected={active}
                className="select-option"
                data-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.icon && <span className="select-opt-icon">{opt.icon}</span>}
                <span className="select-opt-copy">
                  <strong>{opt.label}</strong>
                  {opt.detail && <small>{opt.detail}</small>}
                </span>
                {active && <Check size={14} className="select-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ArchiveScaleSwitcher({
  current,
  connections,
  regions,
  showRegionsLink,
}: {
  current: WarehouseConnectionRef;
  connections: WarehouseConnectionRef[];
  regions: Record<string, string>;
  showRegionsLink: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFilter("");
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const map = new Map<string, WarehouseConnectionRef[]>();
    for (const c of connections) {
      const reg = regions[c.name] || "Archives";
      if (
        q &&
        !c.name.toLowerCase().includes(q) &&
        !reg.toLowerCase().includes(q)
      ) {
        continue;
      }
      const list = map.get(reg) ?? [];
      list.push(c);
      map.set(reg, list);
    }
    return [...map.entries()];
  }, [connections, regions, filter]);

  const currentRegion = regions[current.name];

  if (connections.length <= 1) {
    return (
      <span className="scale-unit-static">
        <Database size={13} />
        {currentRegion && (
          <span className="scale-region-pill">{currentRegion}</span>
        )}
        <strong>{current.name}</strong>
      </span>
    );
  }

  return (
    <div className="select-menu scale-switcher" ref={wrapRef}>
      <button
        type="button"
        className="scale-trigger"
        aria-label={w.archive}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="scale-dot" aria-hidden="true" />
        {currentRegion && (
          <span className="scale-region-pill">{currentRegion}</span>
        )}
        <strong className="scale-name">{current.name}</strong>
        <ChevronsUpDown size={13} className="select-chevron" />
      </button>

      {open && (
        <div
          className="select-popover scale-popover panel select-align-left"
          role="listbox"
          aria-label={w.archive}
        >
          <div className="scale-popover-head">
            <span>
              <Globe2 size={13} />
              Scale units &amp; archives
            </span>
            <span className="scale-count">{connections.length}</span>
          </div>

          {connections.length > 3 && (
            <div className="scale-search">
              <Search size={13} />
              <input
                ref={inputRef}
                value={filter}
                placeholder="Filter region or scale unit…"
                aria-label="Filter archives"
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          )}

          <div className="scale-list">
            {grouped.map(([reg, items]) => (
              <div key={reg} className="scale-group">
                <div className="scale-group-title">{reg}</div>
                {items.map((item) => {
                  const selected = item.name === current.name;
                  return (
                    <button
                      type="button"
                      role="option"
                      key={item.name}
                      aria-selected={selected}
                      className="select-option scale-option"
                      data-selected={selected}
                      onClick={() => {
                        setOpen(false);
                        navigate(archiveUrl(item.name));
                      }}
                    >
                      <span className="scale-opt-dot" aria-hidden="true" />
                      <span className="select-opt-copy">
                        <strong>{item.name}</strong>
                        <small>
                          rev <code>{item.revision.slice(0, 8)}</code>
                        </small>
                      </span>
                      {selected && <Check size={14} className="select-check" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {grouped.length === 0 && (
              <p className="scale-empty">No matching scale unit.</p>
            )}
          </div>

          {showRegionsLink && (
            <a
              className="scale-foot-link"
              href={regionsUrl()}
              onClick={(e) => {
                setOpen(false);
                spaClick(e);
              }}
            >
              <span>All regional scale units</span>
              <ArrowRight size={13} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
