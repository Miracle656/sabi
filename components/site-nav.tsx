"use client";

// The frame on every page: a top bar (brand, sections, search over verified
// findings, the member's points and level where Stack Overflow keeps
// reputation) and a left rail of sections. Page-specific controls (the chat's
// model switcher and ledger toggle) arrive as children of the top bar.

import { useEffect, useState } from "react";
import { profileHref } from "@/lib/links";
import { SignIn, type SabiUser } from "./sign-in";
import { ThemeToggle } from "./theme-toggle";

export type Section = "home" | "findings" | "topics" | "members" | "watch";

interface Standing {
  points: number;
  level: string;
  rank: number | null;
}

export function SiteNav({
  user,
  googleClientId,
  active,
  query = "",
  sidebarFrom = "lg",
  children,
}: {
  user?: SabiUser;
  googleClientId?: string;
  active?: Section;
  query?: string;
  /** Breakpoint where the sidebar docks; below it the menu button opens a drawer. */
  sidebarFrom?: "lg" | "xl";
  children?: React.ReactNode;
}) {
  const standing = useStanding(user?.handle);
  const [drawer, setDrawer] = useState(false);

  return (
    <header className="shrink-0 border-b border-line border-t-[3px] border-t-[var(--ok)] bg-[var(--paper)]">
      <div className="flex h-[var(--topbar-h)] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r)] text-muted hover:bg-soft hover:text-ink ${
            sidebarFrom === "xl" ? "xl:hidden" : "lg:hidden"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {drawer && (
          <>
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setDrawer(false)} aria-hidden="true" />
            <div className="fixed inset-y-0 left-0 z-50 flex w-[260px] max-w-[84vw] flex-col overflow-y-auto border-r border-line bg-[var(--paper)] pt-3">
              <div className="flex items-center justify-between px-5 pb-3">
                <span className="display text-[17px] font-medium">Sabi</span>
                <button
                  type="button"
                  onClick={() => setDrawer(false)}
                  aria-label="Close menu"
                  className="text-[22px] leading-none text-faint hover:text-ink"
                >
                  &times;
                </button>
              </div>
              <SidebarLinks active={active} user={user} />
            </div>
          </>
        )}

        <a href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Sabi home">
          <Mark />
          <span className="display hidden text-[19px] font-medium sm:inline">Sabi</span>
        </a>

        <nav aria-label="Sections" className="hidden items-center xl:flex">
          <NavLink href="/" current={active === "home"}>
            Ask
          </NavLink>
          <NavLink href="/community" current={active === "findings"}>
            Findings
          </NavLink>
          <NavLink href="/members" current={active === "members"}>
            Members
          </NavLink>
        </nav>

        <form action="/community" method="get" role="search" className="min-w-0 flex-1">
          <label className="flex h-9 items-center gap-2 rounded-[var(--r)] border border-edge bg-[var(--composer-fill)] px-2.5 focus-within:border-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-faint" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <span className="sr-only">Search verified findings</span>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search verified findings…"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none"
            />
          </label>
        </form>

        {children}

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {user && (
            <a
              href={profileHref(user.handle)}
              title={
                standing
                  ? `${user.handle} · ${standing.level} · ${standing.points} points${standing.rank ? ` · #${standing.rank}` : ""}`
                  : user.handle
              }
              className="flex items-center gap-1.5 rounded-[var(--r)] px-1.5 py-1 transition-colors hover:bg-soft"
            >
              <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-soft text-[12px] font-medium uppercase text-ink">
                {user.handle.replace(/^@+/, "").slice(0, 1)}
              </span>
              <span className="nums text-[13px] font-medium text-ink">{standing?.points ?? "–"}</span>
              {standing && (
                <span className="nums hidden items-center gap-1 text-[12px] text-muted sm:inline-flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-hidden="true" />
                  {standing.level}
                </span>
              )}
            </a>
          )}

          <IconLink href="/members#levels" label="Levels and points" icon="levels" />
          <IconLink href="https://github.com/Miracle656/sabi#readme" label="How Sabi works" icon="help" />
          <ThemeToggle />
          {(googleClientId || user) && <SignIn user={user} clientId={googleClientId} compact />}
        </div>
      </div>
    </header>
  );
}

// ── sidebar ─────────────────────────────────────────────────────────────────

/** The docked left rail. Hidden below `from`; the top bar's menu button covers that. */
export function Sidebar({
  active,
  user,
  from = "lg",
}: {
  active?: Section;
  user?: SabiUser;
  from?: "lg" | "xl";
}) {
  return (
    <aside className={`hidden w-[212px] shrink-0 border-r border-line pt-5 ${from === "xl" ? "xl:block" : "lg:block"}`}>
      <div className="sticky top-5">
        <SidebarLinks active={active} user={user} />
      </div>
    </aside>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1v-8z" />,
  findings: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  topics: (
    <>
      <path d="M3 12V4h8l9 9-8 8-9-9z" />
      <circle cx="7.5" cy="8.5" r="1.3" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.2 3.2 0 010 6.3M18 14.2c1.8.7 3 2.6 3 4.8" />
    </>
  ),
  watch: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  levels: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    </>
  ),
  mcp: <path d="M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16" />,
  github: (
    <path d="M9 19c-4 1.3-4-2-6-2.5m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 00-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V22" />
  ),
};

function Icon({ name, size = 17 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="shrink-0">
      {ICONS[name]}
    </svg>
  );
}

function SidebarLinks({ active, user }: { active?: Section; user?: SabiUser }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2 pb-6">
      <SideLink href="/" icon="home" current={active === "home"}>
        Ask Sabi
      </SideLink>
      <SideLink href="/watch" icon="watch" current={active === "watch"}>
        Your project
      </SideLink>
      <SideLink href="/community" icon="findings" current={active === "findings"}>
        Findings
      </SideLink>
      <SideLink href="/topics" icon="topics" current={active === "topics"}>
        Topics
      </SideLink>
      <SideLink href="/members" icon="members" current={active === "members"}>
        Members
      </SideLink>
      <SideLink href="/members#levels" icon="levels">
        Levels
      </SideLink>
      {user && (
        <SideLink href={profileHref(user.handle)} icon="profile">
          Your profile
        </SideLink>
      )}

      <span className="eyebrow mt-6 px-3 pb-1.5 text-faint">Use it anywhere</span>
      <SideLink href="https://github.com/Miracle656/sabi#mcp-server" icon="mcp" external>
        MCP for your AI tool
      </SideLink>
      <SideLink href="https://github.com/Miracle656/sabi" icon="github" external>
        Source on GitHub
      </SideLink>
    </nav>
  );
}

function SideLink({
  href,
  icon,
  current,
  external,
  children,
}: {
  href: string;
  icon: string;
  current?: boolean;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={`flex items-center gap-3 rounded-[var(--r)] px-3 py-2 text-[13.5px] transition-colors hover:bg-soft hover:text-ink ${
        current ? "bg-soft font-medium text-ink" : "text-muted"
      }`}
    >
      <Icon name={icon} />
      {children}
    </a>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

/** Points and level for the signed-in member, from the community index. */
function useStanding(handle?: string): Standing | null {
  const [standing, setStanding] = useState<Standing | null>(null);
  useEffect(() => {
    if (!handle) return;
    let alive = true;
    fetch("/api/me")
      .then((r) => r.json())
      .then((j: Partial<Standing>) => {
        if (alive && typeof j.points === "number" && j.level) {
          setStanding({ points: j.points, level: j.level, rank: j.rank ?? null });
        }
      })
      .catch(() => {
        /* standing is decoration; the avatar still links to the profile */
      });
    return () => {
      alive = false;
    };
  }, [handle]);
  return handle ? standing : null;
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-[13.5px] transition-colors hover:bg-soft hover:text-ink ${
        current ? "bg-soft text-ink" : "text-muted"
      }`}
    >
      {children}
    </a>
  );
}

function IconLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      title={label}
      aria-label={label}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="hidden h-8 w-8 place-items-center rounded-[var(--r)] text-muted transition-colors hover:bg-soft hover:text-ink sm:grid"
    >
      <Icon name={icon} />
    </a>
  );
}

export function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" className="shrink-0" aria-hidden="true">
      <rect x="0.5" y="0.5" width="25" height="25" rx="7" stroke="var(--line2)" />
      <rect x="6" y="7" width="14" height="2" rx="1" fill="var(--ok)" />
      <rect x="6" y="12" width="10" height="2" rx="1" fill="var(--muted)" />
      <rect x="6" y="17" width="6" height="2" rx="1" fill="var(--faint)" />
    </svg>
  );
}
