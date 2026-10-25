// The frame for the read-only pages (/community, /topics, /members,
// /u/[handle]): the shared top bar and left rail around a centered column.

import { SiteNav, Sidebar, type Section } from "./site-nav";
import type { SabiUser } from "./sign-in";

export function PageShell({
  user,
  googleClientId,
  active,
  query,
  children,
}: {
  user?: SabiUser;
  googleClientId?: string;
  active?: Section;
  query?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteNav user={user} googleClientId={googleClientId} active={active} query={query} />
      <div className="mx-auto flex w-full max-w-[1320px] flex-1">
        <Sidebar active={active} user={user} />
        <main className="min-w-0 flex-1 px-4 pb-20 pt-8 sm:px-6 lg:px-8">{children}</main>
      </div>
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
