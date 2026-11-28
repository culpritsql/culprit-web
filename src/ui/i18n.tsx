import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ExternalLink, Languages, Scale } from "lucide-react";
import logo from "../../vendor/culprit/docs/images/logo.svg";
import en from "./en.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import ru from "./locales/ru.json";
import de from "./locales/de.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import pt from "./locales/pt.json";

export type LocaleCode =
  | "en"
  | "zh"
  | "ja"
  | "ko"
  | "ru"
  | "de"
  | "es"
  | "fr"
  | "pt";

export type Words = typeof en;

export interface LocaleSpec {
  code: LocaleCode;
  bcp47: string;
  htmlLang: string;
  sitePrefix: string;
  nativeName: string;
  englishName: string;
}

export const LOCALES: readonly LocaleSpec[] = [
  {
    code: "en",
    bcp47: "en",
    htmlLang: "en",
    sitePrefix: "",
    nativeName: "English",
    englishName: "English",
  },
  {
    code: "zh",
    bcp47: "zh-Hans",
    htmlLang: "zh-Hans",
    sitePrefix: "zh/",
    nativeName: "简体中文",
    englishName: "Chinese (Simplified)",
  },
  {
    code: "ja",
    bcp47: "ja",
    htmlLang: "ja",
    sitePrefix: "ja/",
    nativeName: "日本語",
    englishName: "Japanese",
  },
  {
    code: "ko",
    bcp47: "ko",
    htmlLang: "ko",
    sitePrefix: "ko/",
    nativeName: "한국어",
    englishName: "Korean",
  },
  {
    code: "ru",
    bcp47: "ru",
    htmlLang: "ru",
    sitePrefix: "ru/",
    nativeName: "Русский",
    englishName: "Russian",
  },
  {
    code: "de",
    bcp47: "de",
    htmlLang: "de",
    sitePrefix: "de/",
    nativeName: "Deutsch",
    englishName: "German",
  },
  {
    code: "es",
    bcp47: "es",
    htmlLang: "es",
    sitePrefix: "es/",
    nativeName: "Español",
    englishName: "Spanish",
  },
  {
    code: "fr",
    bcp47: "fr",
    htmlLang: "fr",
    sitePrefix: "fr/",
    nativeName: "Français",
    englishName: "French",
  },
  {
    code: "pt",
    bcp47: "pt-BR",
    htmlLang: "pt-BR",
    sitePrefix: "pt/",
    nativeName: "Português",
    englishName: "Portuguese (Brazil)",
  },
];

const CATALOGS: Record<LocaleCode, Words> = {
  en,
  zh,
  ja,
  ko,
  ru,
  de,
  es,
  fr,
  pt,
};

const STORAGE_KEY = "culprit-web-lang";

export function matchLocaleTag(raw: string | null | undefined): LocaleCode | null {
  if (!raw) return null;
  const norm = raw.trim().replace(/_/g, "-").toLowerCase();
  if (!norm) return null;
  if (norm === "en" || norm.startsWith("en-")) return "en";
  if (
    norm === "zh" ||
    norm === "zh-hans" ||
    norm === "zh-cn" ||
    norm === "zh-sg" ||
    norm.startsWith("zh-hans-") ||
    norm.startsWith("zh-")
  ) {
    return "zh";
  }
  if (norm === "ja" || norm.startsWith("ja-")) return "ja";
  if (norm === "ko" || norm.startsWith("ko-")) return "ko";
  if (norm === "ru" || norm.startsWith("ru-")) return "ru";
  if (norm === "de" || norm.startsWith("de-")) return "de";
  if (norm === "es" || norm.startsWith("es-")) return "es";
  if (norm === "fr" || norm.startsWith("fr-")) return "fr";
  if (norm === "pt" || norm.startsWith("pt-")) return "pt";
  return null;
}

function detectInitialLocale(): LocaleCode {
  if (typeof window === "undefined") return "en";
  try {
    const queryLang = matchLocaleTag(
      new URLSearchParams(window.location.search).get("lang"),
    );
    if (queryLang) {
      try {
        localStorage.setItem(STORAGE_KEY, queryLang);
      } catch {
        /* Ignore storage errors. */
      }
      return queryLang;
    }
  } catch {
    /* Ignore malformed URL. */
  }
  try {
    const stored = matchLocaleTag(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* Ignore restricted storage context. */
  }
  if (typeof navigator !== "undefined") {
    const prefs = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const tag of prefs) {
      const matched = matchLocaleTag(tag);
      if (matched) return matched;
    }
  }
  return "en";
}

let currentLocale: LocaleCode = detectInitialLocale();
const listeners = new Set<() => void>();

function syncDocumentLang(code: LocaleCode) {
  if (typeof document === "undefined") return;
  const spec = LOCALES.find((l) => l.code === code) ?? LOCALES[0]!;
  document.documentElement.lang = spec.htmlLang;
}

if (typeof window !== "undefined") {
  syncDocumentLang(currentLocale);
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    const next = matchLocaleTag(event.newValue) ?? "en";
    if (next !== currentLocale) {
      currentLocale = next;
      syncDocumentLang(currentLocale);
      for (const listener of listeners) listener();
    }
  });
}

export function getLocale(): LocaleCode {
  return currentLocale;
}

export function getLocaleSpec(code: LocaleCode = currentLocale): LocaleSpec {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0]!;
}

export function setLocale(next: LocaleCode) {
  if (!CATALOGS[next]) return;
  currentLocale = next;
  syncDocumentLang(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* Ignore quota/storage errors. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocale(): LocaleCode {
  return useSyncExternalStore(subscribe, getLocale, () => "en");
}

export const w: Words = new Proxy(en, {
  get(target, prop, receiver) {
    if (typeof prop !== "string") {
      return Reflect.get(target, prop, receiver);
    }
    const active = CATALOGS[currentLocale] ?? target;
    return (
      (active as Record<string, unknown>)[prop] ??
      (target as Record<string, unknown>)[prop]
    );
  },
});

export function LanguagePicker() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeSpec = getLocaleSpec(locale);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="theme-picker lang-picker" ref={wrapRef}>
      <button
        type="button"
        className="top-pill"
        aria-label={w.language}
        aria-expanded={open}
        title={`${w.language}: ${activeSpec.nativeName}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Languages size={15} />
        <span className="top-pill-label">{activeSpec.nativeName}</span>
      </button>
      {open && (
        <div
          className="theme-popover lang-popover panel"
          role="dialog"
          aria-label={w.chooseLanguage}
        >
          <div className="theme-popover-head">
            <Languages size={14} />
            <span>{w.chooseLanguage}</span>
          </div>
          <div className="theme-list">
            {LOCALES.map((spec) => {
              const selected = spec.code === locale;
              return (
                <button
                  type="button"
                  key={spec.code}
                  className="theme-option"
                  data-selected={selected}
                  onClick={() => {
                    setLocale(spec.code);
                    setOpen(false);
                  }}
                >
                  <span className="lang-code-badge" aria-hidden="true">
                    {spec.code.toUpperCase()}
                  </span>
                  <span className="theme-option-copy">
                    <strong>{spec.nativeName}</strong>
                    <small>{spec.englishName}</small>
                  </span>
                  {selected && <Check size={15} className="theme-check" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function FleetFooter() {
  const locale = useLocale();
  const spec = getLocaleSpec(locale);
  const siteRoot = `https://culpritsql.com/${spec.sitePrefix}`;
  const explainRoot = `https://explain.culpritsql.com/${spec.sitePrefix}`;

  return (
    <footer className="fleet-footer">
      <div className="fleet-footer-inner">
        <div className="fleet-footer-top">
          <div className="fleet-footer-brand-col">
            <div className="fleet-footer-brand-row">
              <a
                className="fleet-footer-brand"
                href={siteRoot}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img src={logo} alt="" />
                <strong>Culprit SQL</strong>
                <span className="fleet-footer-surface">{w.web}</span>
              </a>
              <a
                className="fleet-footer-mit-pill"
                href="https://github.com/culpritsql/culprit-fleet/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Scale size={12} />
                <span>{w.footerOpenSource}</span>
              </a>
            </div>
            <p className="fleet-footer-tagline">{w.footerTagline}</p>
          </div>

          <nav className="fleet-footer-links" aria-label="Culprit SQL">
            <a href={siteRoot} target="_blank" rel="noopener noreferrer">
              <span>{w.footerPlatform}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
            <a
              href={`${siteRoot}studio/`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{w.footerStudio}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
            <a href={explainRoot} target="_blank" rel="noopener noreferrer">
              <span>{w.footerExplain}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
            <a
              href={`${siteRoot}fleet/`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{w.footerDocs}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
            <a
              href={`${siteRoot}releases/`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{w.footerReleases}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
            <a
              href="https://github.com/culpritsql/culprit-fleet"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{w.footerGithub}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
            <a
              href="https://github.com/culpritsql/culprit-fleet/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{w.footerLicense}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
          </nav>
        </div>

        <div className="fleet-footer-bottom">
          <div
            className="fleet-footer-langs"
            role="group"
            aria-label={w.chooseLanguage}
          >
            {LOCALES.map((loc) => (
              <button
                type="button"
                key={loc.code}
                className="fleet-footer-lang-btn"
                aria-pressed={loc.code === locale}
                onClick={() => setLocale(loc.code)}
              >
                {loc.nativeName}
              </button>
            ))}
          </div>
          <span className="fleet-footer-copy">© 2026 Culprit SQL · MIT</span>
        </div>
      </div>
    </footer>
  );
}
