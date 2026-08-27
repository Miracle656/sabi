// Theme is a three-state choice: an explicit light, an explicit dark, or
// "system" (no attribute, so the prefers-color-scheme rules in globals.css
// decide). The chosen value is mirrored to <html data-theme> and localStorage;
// the inline script in layout.tsx replays it before first paint.

export const THEME_STORAGE_KEY = "sabi.theme";

export type Theme = "light" | "dark" | "system";

export function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}

export function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode: the choice just does not persist */
  }
}

/** What the user is actually looking at right now. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
