"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  STALE_AFTER_DAYS,
  sameHandle,
  type Finding,
  type RecalledFinding,
} from "@/lib/findings";
import { aggregatorUrl, profileHref, walruscanUrl, type Network } from "@/lib/links";
import { shortId, suiscanTx, type TxReport } from "@/lib/onchain";

// ── who is looking ──────────────────────────────────────────────────────────

/** The signed-in viewer, if any: decides whether a card offers "This worked for me". */
const ViewerContext = createContext<{ handle?: string }>({});
export const ViewerProvider = ViewerContext.Provider;

/** A member handle that opens their profile. */
export function Handle({ handle, className = "" }: { handle: string; className?: string }) {
  return (
    <a
      href={profileHref(handle)}
      className={`underline decoration-line2 underline-offset-2 transition-colors hover:text-ink hover:decoration-ink ${className}`}
    >
      {handle}
    </a>
  );
}

// ── memory id ───────────────────────────────────────────────────────────────

export function IdChip({
  id,
  network,
  tone = "muted",
  mock = false,
}: {
  id: string;
  network: Network;
  tone?: "muted" | "ok";
  /** Mock mode has no Walrus blob behind the id — never link it out. */
  mock?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const short = id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
  return (
    <span className="mono inline-flex items-center overflow-hidden rounded-[7px] border border-line text-[11.5px] leading-none">
      <button
        type="button"
        title={`Copy memory id\n${id}`}
        onClick={() => {
          navigator.clipboard
            ?.writeText(id)
            .then(() => {
              setCopied(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), 1200);
            })
            .catch(() => {
              /* clipboard denied — the full id is in the title attribute */
            });
        }}
        className={`px-2 py-1.5 transition-colors hover:bg-soft ${
          tone === "ok" ? "text-ok" : "text-muted"
        }`}
      >
        <span aria-live="polite">{copied ? "copied" : short}</span>
      </button>
      {mock ? (
        <span
          className="border-l border-line px-2 py-1.5 text-faint"
          title="Mock mode — this id is in-memory only, there is no Walrus blob behind it"
        >
          mock
        </span>
      ) : (
        <>
      <a
        href={walruscanUrl(id, network)}
        target="_blank"
        rel="noreferrer"
        title="Open this blob on Walruscan"
        className="border-l border-line px-1.5 py-1.5 text-faint transition-colors hover:bg-soft hover:text-ink"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M14 4h6v6M20 4l-9 9" />
          <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
        </svg>
      </a>
      <a
        href={aggregatorUrl(id, network)}
        target="_blank"
        rel="noreferrer"
        title="Fetch the encrypted bytes from a Walrus aggregator"
        className="border-l border-line px-1.5 py-1.5 text-faint transition-colors hover:bg-soft hover:text-ink"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
        </svg>
      </a>
        </>
      )}
    </span>
  );
}

// ── freshness ───────────────────────────────────────────────────────────────

/**
 * How much of a volatile finding's freshness window is left, counted from its
 * last verification - a confirmation by any member restarts the clock.
 */
function Freshness({ ageDays, stale }: { ageDays: number; stale: boolean }) {
  // A verified date in the future is bad data, not maximum freshness.
  const future = ageDays < 0;
  const age = Math.max(0, ageDays);
  const left = Math.max(0, Math.min(1, 1 - age / STALE_AFTER_DAYS));
  if (future) {
    return (
      <span className="text-warn" title={`This finding claims a verification date ${-ageDays}d in the future`}>
        verified in the future?
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-2"
      title={`Verified ${age}d ago · volatile findings go stale after ${STALE_AFTER_DAYS}d`}
    >
      <span className="relative block h-[3px] w-16 overflow-hidden rounded-full bg-track">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.max(stale ? 0 : 6, left * 100)}%`,
            background: stale ? "var(--warn)" : "var(--ok)",
          }}
        />
      </span>
      <span className={stale ? "text-warn" : "text-faint"}>
        {stale ? `stale · ${age}d` : `${age}d old`}
      </span>
    </span>
  );
}

// ── the record ──────────────────────────────────────────────────────────────

const CATEGORY_HELP: Record<string, string> = {
  CARRIER: "Carrier behaviour changes fast",
  PAYMENTS: "Payment APIs change fast",
  RPC: "RPC health changes fast",
  EXCHANGE: "Exchange behaviour changes fast",
};

export function FindingCard({
  hit,
  network,
  mock = false,
}: {
  hit: RecalledFinding;
  network: Network;
  mock?: boolean;
}) {
  const f = hit.finding;
  if (!f) return <RawMemoryCard hit={hit} network={network} mock={mock} />;

  const superseded = Boolean(hit.superseded_by);
  const tone = superseded ? "var(--line2)" : hit.stale ? "var(--warn)" : "var(--ok)";
  const toneText = superseded ? "text-faint" : hit.stale ? "text-warn" : "text-ok";

  return (
    <article
      className={`enter grid grid-cols-[3px_1fr] overflow-hidden rounded-[var(--r)] border border-line ${
        superseded ? "" : "bg-surface2"
      }`}
    >
      <div style={{ background: tone }} />
      <div className={`flex flex-col gap-2.5 px-4 py-3.5 ${superseded ? "text-muted" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className={`eyebrow ${toneText}`}>{f.category}</span>
          <span
            className={`display text-[16px] font-medium ${
              superseded ? "text-muted line-through decoration-faint" : ""
            }`}
          >
            {f.subject}
          </span>
          {hit.stale && !superseded && (
            <span className="rounded-full border border-warn px-2 py-px text-[11px] text-warn">
              Stale · {hit.age_days}d
            </span>
          )}
          {superseded && (
            <span className="rounded-full border border-line2 px-2 py-px text-[11px] text-faint">
              Replaced
            </span>
          )}
        </div>

        <p className="text-[14.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
          {f.finding}
        </p>

        <div className="flex items-start gap-2.5">
          <span className="eyebrow shrink-0 pt-[3px] text-faint">Fix</span>
          <span className="text-[14.5px] leading-relaxed [overflow-wrap:anywhere]">{f.fix}</span>
        </div>

        {hit.stale && !superseded && (
          <div className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              className="mt-[3px] shrink-0"
            >
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.3 3.9L2.6 17a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
            </svg>
            <span>
              {CATEGORY_HELP[f.category] ?? "This can change"}. Get someone to re-confirm it
              before you plan around it.
            </span>
          </div>
        )}

        <div className="nums flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line pt-2.5 text-[12px] text-faint">
          {f.reportedBy ? (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="grid h-[17px] w-[17px] place-items-center rounded-full bg-soft text-[8.5px] uppercase text-muted">
                {f.reportedBy.replace(/^@/, "").slice(0, 1)}
              </span>
              <Handle handle={f.reportedBy} />
            </span>
          ) : (
            <span>writer unknown</span>
          )}
          {f.volatile && hit.age_days !== null ? (
            <Freshness ageDays={hit.age_days} stale={hit.stale} />
          ) : (
            <span title="Not a volatile category — it does not expire on a timer">
              does not expire
            </span>
          )}
          <span className="text-muted">
            Verified {hit.last_verified ?? f.verifiedOn}
          </span>
          <span className="hidden sm:inline">{f.provider}</span>
          <span className="hidden md:inline">{f.version}</span>
          <span className="grow" />
          <IdChip id={hit.memory_id} network={network} mock={mock} />
        </div>

        {!superseded && <Confirmations hit={hit} network={network} mock={mock} />}

        {f.supersedes && (
          <div className="mono text-[11.5px] text-faint">supersedes {f.supersedes}</div>
        )}
        {f.confirms && (
          <div className="mono text-[11.5px] text-faint">confirms {f.confirms}</div>
        )}
        {f.evidence && <EvidenceLink digest={f.evidence} />}
        {hit.superseded_by && (
          <div className="mono text-[11.5px] text-faint">replaced by {hit.superseded_by}</div>
        )}
      </div>
    </article>
  );
}

/** A finding's on-chain evidence: a mainnet transaction, checked when it was stored. */
function EvidenceLink({ digest }: { digest: string }) {
  return (
    <a
      href={suiscanTx(digest)}
      target="_blank"
      rel="noreferrer"
      title="This transaction was read from Sui mainnet (via Tatum) before the finding was stored"
      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line2 px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-ink hover:text-ink"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2" aria-hidden="true">
        <path d="M20 6L9 17l-5-5" />
      </svg>
      On-chain evidence
      <span className="mono text-faint">{digest.slice(0, 6)}…{digest.slice(-4)}</span>
    </a>
  );
}

// ── a transaction, as the chain reports it ──────────────────────────────────

export function TxCard({
  tx,
  gasSui,
  explorer,
}: {
  tx: Omit<TxReport, "calls"> & { calls: string[]; moreCalls?: number };
  gasSui?: string;
  explorer: string;
}) {
  const failed = !tx.ok;
  const f = tx.failure;
  return (
    <article className="enter grid grid-cols-[3px_1fr] overflow-hidden rounded-[var(--r)] border border-line bg-surface2">
      <div style={{ background: failed ? "var(--bad)" : "var(--ok)" }} />
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className={`eyebrow ${failed ? "text-bad" : "text-ok"}`}>
            {failed ? "Failed on-chain" : "Succeeded on-chain"}
          </span>
          <span className="mono text-[12px] text-faint">Sui mainnet · read via Tatum</span>
          <span className="grow" />
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="mono text-[11.5px] text-muted underline decoration-line2 underline-offset-2 hover:text-ink"
          >
            {tx.digest.slice(0, 8)}…{tx.digest.slice(-4)} ↗
          </a>
        </div>

        <p className="mono text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]">{tx.signature}</p>

        {f && (f.abortCode !== undefined || f.module) && (
          <dl className="nums grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
            {f.abortCode !== undefined && (
              <>
                <dt className="text-faint">abort code</dt>
                <dd className="mono">{f.abortCode}</dd>
              </>
            )}
            {f.package && (
              <>
                <dt className="text-faint">raised in</dt>
                <dd className="mono [overflow-wrap:anywhere]">
                  {shortId(f.package)}::{f.module}
                  {f.function ? `::${f.function}` : ""}
                </dd>
              </>
            )}
            {f.command !== undefined && (
              <>
                <dt className="text-faint">command</dt>
                <dd className="mono">#{f.command}</dd>
              </>
            )}
          </dl>
        )}

        {tx.calls.length > 0 && (
          <details className="group text-[12.5px]">
            <summary className="cursor-pointer list-none text-faint hover:text-muted">
              {tx.calls.length + (tx.moreCalls ?? 0)} Move calls
            </summary>
            <ol className="mono mt-2 flex flex-col gap-1 text-[11.5px] text-muted">
              {tx.calls.map((c, i) => {
                const [pkg, mod, fn] = c.split("::");
                return (
                  <li key={i} className={f?.command === i ? "text-bad" : ""}>
                    {i}. {shortId(pkg)}::{mod}::{fn}
                  </li>
                );
              })}
              {(tx.moreCalls ?? 0) > 0 && <li className="text-faint">+{tx.moreCalls} more</li>}
            </ol>
          </details>
        )}

        <div className="nums flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line pt-2.5 text-[12px] text-faint">
          {tx.sender && <span className="mono">from {shortId(tx.sender)}</span>}
          {gasSui && <span>gas paid {gasSui} SUI</span>}
        </div>
      </div>
    </article>
  );
}

// ── confirmations ───────────────────────────────────────────────────────────

/**
 * Who else reproduced this, and the button to add yourself. A confirmation is
 * a new blob with the viewer's name on it, so the button only appears for a
 * signed-in member who has not written or already confirmed this finding.
 */
function Confirmations({
  hit,
  network,
  mock,
}: {
  hit: RecalledFinding;
  network: Network;
  mock: boolean;
}) {
  const viewer = useContext(ViewerContext).handle;
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "done"; id?: string }
    | { kind: "error"; error: string }
  >({ kind: "idle" });
  const f = hit.finding!;
  const others = (hit.confirmations ?? []).filter((c) => !c.self && c.by);
  const people = [...new Map(others.map((c) => [c.by!.toLowerCase(), c.by!])).values()];
  const mine =
    sameHandle(viewer, f.reportedBy) ||
    (hit.confirmations ?? []).some((c) => sameHandle(c.by, viewer));
  const canConfirm = Boolean(viewer) && !mine && !f.confirms && state.kind !== "done";

  if (!people.length && !canConfirm && state.kind !== "done") return null;

  const confirm = async () => {
    setState({ kind: "working" });
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memory_id: hit.memory_id, subject: f.subject }),
      });
      const j = (await res.json()) as { status: string; memory_id?: string; error?: string };
      if (j.status === "error") setState({ kind: "error", error: j.error ?? "confirmation failed" });
      else setState({ kind: "done", id: j.memory_id });
    } catch (err) {
      setState({ kind: "error", error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]">
      {people.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 text-muted">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Confirmed by
          {people.slice(0, 3).map((h, i) => (
            <span key={h}>
              <Handle handle={h} />
              {i < Math.min(people.length, 3) - 1 ? "," : ""}
            </span>
          ))}
          {people.length > 3 && <span className="text-faint">+{people.length - 3}</span>}
        </span>
      )}
      <span className="grow" />
      {canConfirm && (
        <button
          type="button"
          onClick={confirm}
          disabled={state.kind === "working"}
          title="Store a confirmation on Walrus under your name. Only if you reproduced it yourself."
          className="inline-flex items-center gap-1.5 rounded-full border border-edge px-3 py-1 text-[12.5px] text-ink transition-colors hover:bg-soft disabled:opacity-60"
        >
          {state.kind === "working" ? (
            <span className="spin block h-3 w-3 rounded-full border-[1.5px] border-track border-t-[var(--ok)]" />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
          {state.kind === "working" ? "Storing on Walrus…" : "This worked for me"}
        </button>
      )}
      {state.kind === "done" && (
        <span className="inline-flex items-center gap-2 text-ok">
          You confirmed this
          {state.id && <IdChip id={state.id} network={network} tone="ok" mock={mock} />}
        </span>
      )}
      {state.kind === "error" && (
        <span className="basis-full text-bad [overflow-wrap:anywhere]">{state.error}</span>
      )}
    </div>
  );
}

export function RawMemoryCard({
  hit,
  network,
  mock = false,
}: {
  hit: RecalledFinding;
  network: Network;
  mock?: boolean;
}) {
  return (
    <article className="enter grid grid-cols-[3px_1fr] overflow-hidden rounded-[var(--r)] border border-line">
      <div className="bg-line2" />
      <div className="flex flex-col gap-2 px-4 py-3.5">
        <span className="eyebrow text-faint">Free text · not in the canonical format</span>
        <p className="text-[14.5px] leading-relaxed [overflow-wrap:anywhere]">{hit.text}</p>
        <div className="flex items-center gap-3 border-t border-line pt-2.5 text-[12px] text-faint">
          <span>no verification date recorded</span>
          <span className="grow" />
          <IdChip id={hit.memory_id} network={network} mock={mock} />
        </div>
      </div>
    </article>
  );
}

// ── the write confirmation, which IS the record it created ──────────────────

export function SavedCard({
  status,
  memoryId,
  jobId,
  finding,
  text,
  network,
  error,
  mock = false,
  onResolved,
}: {
  status: "done" | "pending" | "error";
  memoryId?: string;
  jobId?: string;
  finding?: Finding;
  text?: string;
  network: Network;
  error?: string;
  mock?: boolean;
  /** Fires once when a pending write settles, so the ledger can follow. */
  onResolved?: (r: { status: "done" | "error"; memoryId?: string; error?: string }) => void;
}) {
  const [live, setLive] = useState<{ status: typeof status; memoryId?: string; error?: string }>({
    status,
    memoryId,
    error,
  });

  useEffect(() => {
    if (status !== "pending" || !jobId) return;
    let stop = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      // ~3 minutes of polling, then stop claiming we are still waiting.
      if (attempts++ >= 60) {
        const msg = "The relayer never confirmed this write. Run `pnpm restore`, then recall it.";
        setLive({ status: "error", error: msg });
        onResolved?.({ status: "error", error: msg });
        return;
      }
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        const j = (await res.json()) as { status?: string; memory_id?: string; error?: string };
        if (stop) return;
        if (j.status === "done" && j.memory_id) {
          setLive({ status: "done", memoryId: j.memory_id });
          onResolved?.({ status: "done", memoryId: j.memory_id });
          return;
        }
        if (j.status === "failed" || j.status === "not_found") {
          const msg = j.error ?? `relayer reported ${j.status}`;
          setLive({ status: "error", error: msg });
          onResolved?.({ status: "error", error: msg });
          return;
        }
      } catch {
        /* transient; keep polling */
      }
      if (!stop) timer = setTimeout(tick, 3_000);
    };
    timer = setTimeout(tick, 2_000);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
    // onResolved is a stable useCallback in the parent; re-running this effect
    // on identity changes would restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, jobId]);

  if (live.status === "error") {
    return (
      <article className="enter grid grid-cols-[3px_1fr] overflow-hidden rounded-[var(--r)] border border-line">
        <div className="bg-bad" />
        <div className="flex flex-col gap-2 px-4 py-3.5">
          <span className="eyebrow inline-flex items-center gap-2 text-bad">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Not stored
          </span>
          <p className="text-[14px] leading-relaxed [overflow-wrap:anywhere]">{live.error}</p>
          <p className="text-[12.5px] text-faint">
            {mock
              ? "Mock memory: nothing reached Walrus. Fix it and send it again."
              : "Nothing was written to Walrus. Fix it and send it again."}
          </p>
        </div>
      </article>
    );
  }

  const done = live.status === "done";
  return (
    <article className="enter grid grid-cols-[3px_1fr] overflow-hidden rounded-[var(--r)] border border-line bg-surface2">
      <div style={{ background: done ? "var(--ok)" : "var(--warn)" }} />
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`eyebrow inline-flex items-center gap-2 ${done ? "text-ok" : "text-warn"}`}>
            {done ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <span className="spin block h-3 w-3 rounded-full border-[1.5px] border-track border-t-warn" />
            )}
            {done
              ? `${finding?.confirms ? "Confirmation stored" : "Stored"} ${mock ? "in mock memory" : "on Walrus"}`
              : "Relayer still uploading"}
          </span>
          <span className="grow" />
          {live.memoryId && (
            <IdChip id={live.memoryId} network={network} tone="ok" mock={mock} />
          )}
        </div>

        {finding && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className={`eyebrow ${done ? "text-ok" : "text-warn"}`}>{finding.category}</span>
            <span className="display text-[16px] font-medium">{finding.subject}</span>
          </div>
        )}

        {finding && (
          <>
            <p className="text-[14.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
              {finding.finding}
            </p>
            <div className="flex items-start gap-2.5">
              <span className="eyebrow shrink-0 pt-[3px] text-faint">Fix</span>
              <span className="text-[14.5px] leading-relaxed [overflow-wrap:anywhere]">
                {finding.fix}
              </span>
            </div>
          </>
        )}

        {text && (
          <p className="mono rounded-lg bg-soft px-3 py-2.5 text-[11.5px] leading-relaxed text-faint [overflow-wrap:anywhere]">
            {text}
          </p>
        )}

        <div className="nums flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line pt-2.5 text-[12px] text-faint">
          {finding?.reportedBy && <Handle handle={finding.reportedBy} className="text-muted" />}
          {finding && <span>Verified {finding.verifiedOn}</span>}
          {finding?.supersedes && (
            <span className="mono">supersedes {finding.supersedes}</span>
          )}
          {finding?.confirms && <span className="mono">confirms {finding.confirms}</span>}
          <span className="grow" />
          {!live.memoryId && jobId && (
            <span className="mono [overflow-wrap:anywhere]">
              job {jobId} — this card fills itself in when the blob lands
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
