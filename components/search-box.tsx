"use client";

// The top-bar search with a live dropdown: matching verified findings and
// members as you type, then "see all" or "ask Sabi". Keyboard: arrows move,
// Enter opens, Escape closes. Enter with nothing highlighted runs the full
// search on /community.

import { useEffect, useId, useRef, useState } from "react";
import { profileHref } from "@/lib/links";

interface FindingHit {
  memory_id: string;
  category: string;
  subject: string;
  fix: string;
  verifiedOn: string;
  reportedBy: string | null;
  stale: boolean;
  confirmations: number;
}
interface MemberHit {
  handle: string;
  level: string;
  points: number;
}
interface Results {
  total: number;
  findings: FindingHit[];
  members: MemberHit[];
}

type Option = { href: string; key: string };

export function SearchBox({ initial = "" }: { initial?: string }) {
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Debounced fetch; a stale response for an older query is dropped.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j: Results) => {
          setResults({ total: j.total ?? 0, findings: j.findings ?? [], members: j.members ?? [] });
          setActive(-1);
        })
        .catch(() => {
          /* aborted or offline: keep the last results */
        })
        .finally(() => {
          if (!ctl.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  // Close when focus or a click leaves the box.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const term = q.trim();
  const options: Option[] = [
    ...(results?.findings ?? []).map((f) => ({
      key: f.memory_id,
      href: `/community?q=${encodeURIComponent(term)}#${f.memory_id}`,
    })),
    ...(results?.members ?? []).map((m) => ({ key: m.handle, href: profileHref(m.handle) })),
    { key: "all", href: `/community?q=${encodeURIComponent(term)}` },
    { key: "ask", href: `/ask?ask=${encodeURIComponent(term)}` },
  ];
  const showPanel = open && term.length >= 2;

  const go = (href: string) => {
    setOpen(false);
    window.location.href = href;
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showPanel) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      go(options[active].href);
    }
  };

  let idx = -1;
  const optionProps = (href: string) => {
    idx += 1;
    const i = idx;
    return {
      id: `${listId}-${i}`,
      role: "option" as const,
      "aria-selected": active === i,
      onMouseEnter: () => setActive(i),
      onMouseDown: (e: React.MouseEvent) => {
        e.preventDefault();
        go(href);
      },
      className: `flex cursor-pointer flex-col gap-0.5 px-3.5 py-2.5 ${active === i ? "bg-soft" : ""}`,
    };
  };

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <form action="/community" method="get" role="search">
        <label className="flex h-9 items-center gap-2 rounded-[var(--r)] border border-edge bg-[var(--composer-fill)] px-2.5 transition-colors focus-within:border-ink">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-faint" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="sr-only">Search verified findings</span>
          <input
            type="search"
            name="q"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            placeholder="Search verified findings…"
            autoComplete="off"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint focus-visible:outline-none"
          />
          {loading && (
            <span className="spin block h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-track border-t-[var(--ok)]" />
          )}
        </label>
      </form>

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-y-auto rounded-[var(--r)] border border-line2 bg-[var(--paper)] py-1.5 shadow-[var(--shadow-lg)]"
        >
          {results === null && (
            <p className="px-3.5 py-2.5 text-[13px] text-faint">{loading ? "Searching the community memory…" : "Keep typing…"}</p>
          )}

          {results && results.findings.length > 0 && (
            <>
              <span className="eyebrow block px-3.5 pb-1 pt-1.5 text-faint">Verified findings</span>
              {results.findings.map((f) => (
                <div key={f.memory_id} {...optionProps(`/community?q=${encodeURIComponent(term)}#${f.memory_id}`)}>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={`eyebrow shrink-0 ${f.stale ? "text-warn" : "text-ok"}`}>{f.category}</span>
                    <span className="truncate text-[13.5px] text-ink">{f.subject}</span>
                  </span>
                  <span className="truncate text-[12.5px] text-muted">Fix: {f.fix}</span>
                  <span className="nums text-[11.5px] text-faint">
                    {f.reportedBy ?? "unknown"} · {f.verifiedOn}
                    {f.confirmations > 0 && ` · +${f.confirmations} confirmed`}
                    {f.stale && " · stale"}
                  </span>
                </div>
              ))}
            </>
          )}

          {results && results.members.length > 0 && (
            <>
              <span className="eyebrow block px-3.5 pb-1 pt-2.5 text-faint">Members</span>
              {results.members.map((m) => (
                <div key={m.handle} {...optionProps(profileHref(m.handle))}>
                  <span className="text-[13.5px] text-ink">
                    {m.handle} <span className="nums text-[12px] text-faint">· {m.level} · {m.points} points</span>
                  </span>
                </div>
              ))}
            </>
          )}

          {results && results.findings.length === 0 && results.members.length === 0 && (
            <p className="px-3.5 py-2 text-[13px] text-faint">No verified finding has those words yet.</p>
          )}

          {results && (
            <div className="mt-1 border-t border-line pt-1">
              <div {...optionProps(`/community?q=${encodeURIComponent(term)}`)}>
                <span className="text-[13px] text-muted">
                  See all {results.total} {results.total === 1 ? "result" : "results"} for &ldquo;{term}&rdquo;
                </span>
              </div>
              <div {...optionProps(`/ask?ask=${encodeURIComponent(term)}`)}>
                <span className="text-[13px] text-ink">
                  Ask Sabi about &ldquo;{term}&rdquo; <span className="text-faint">· searches by meaning</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
