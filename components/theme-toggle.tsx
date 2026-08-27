"use client";

import { useEffect, useState } from "react";
import { applyTheme, readStoredTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  // Start at "system" on both server and first client render so the markup
  // matches; the real choice is read in an effect (the inline script in
  // layout.tsx has already painted it, so there is no visible flip).
  const [theme, setTheme] = useState<Theme>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(readStoredTheme());
    setReady(true);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-[var(--r)] border border-edge p-0.5"
    >
      {OPTIONS.map((o) => {
        // Before the stored choice is read, "system" is the honest answer —
        // reporting nothing checked leaves the group with no selected radio.
        const active = ready ? theme === o.value : o.value === "system";
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={`${o.label} theme`}
            onClick={() => choose(o.value)}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = OPTIONS.findIndex((x) => x.value === theme);
              const step = e.key === "ArrowRight" ? 1 : -1;
              const next = OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length];
              choose(next.value);
              e.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(`[aria-label="${next.label}"]`)
                ?.focus();
            }}
            className={`grid h-7 w-7 place-items-center rounded-[7px] transition-colors ${
              active ? "bg-soft text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {o.icon}
          </button>
        );
      })}
    </div>
  );
}
