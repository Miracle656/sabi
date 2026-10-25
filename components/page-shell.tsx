// The frame for the read-only pages (/community, /u/[handle]): the same
// hairline top bar as the chat, minus the model switcher and the ledger.

import { ThemeToggle } from "./theme-toggle";

export function PageShell({
  namespace,
  children,
}: {
  namespace: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="shrink-0 border-b border-line">
        <div className="flex h-[var(--topbar-h)] items-center gap-3 px-4 sm:px-6 lg:px-10">
          <a href="/" className="flex items-center gap-3">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
              <rect x="0.5" y="0.5" width="25" height="25" rx="7" stroke="var(--line2)" />
              <rect x="6" y="7" width="14" height="2" rx="1" fill="var(--ok)" />
              <rect x="6" y="12" width="10" height="2" rx="1" fill="var(--muted)" />
              <rect x="6" y="17" width="6" height="2" rx="1" fill="var(--faint)" />
            </svg>
            <span className="display text-[19px] font-medium">Sabi</span>
          </a>
          <span className="hidden h-[18px] w-px bg-line2 md:block" />
          <span className="mono hidden truncate text-[12.5px] text-muted md:block">ns:{namespace}</span>
          <span className="grow" />
          <a href="/community" className="text-[13px] text-muted transition-colors hover:text-ink">
            Community
          </a>
          <a
            href="/"
            className="rounded-[var(--r)] border border-edge px-3 py-1.5 text-[13px] transition-colors hover:bg-soft"
          >
            Ask Sabi
          </a>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-5 pb-20 pt-9 sm:px-6 lg:px-10">
        {children}
      </main>
    </div>
  );
}

/** Level as a small outlined tag; colour stays reserved for verification state. */
export function LevelTag({ name, title }: { name: string; title?: string }) {
  return (
    <span
      title={title}
      className="eyebrow inline-flex items-center rounded-full border border-line2 px-2 py-[3px] text-muted"
    >
      {name}
    </span>
  );
}
