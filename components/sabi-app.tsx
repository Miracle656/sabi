"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Finding, RecalledFinding } from "@/lib/findings";
import { walruscanUrl, type Network } from "@/lib/links";
import type { ModelOption } from "@/lib/models";
import { Markdown } from "./markdown";
import { FindingCard, IdChip, SavedCard } from "./memory-card";
import { ThemeToggle } from "./theme-toggle";
import { SignIn, type SabiUser } from "./sign-in";

// ── tool part shapes (mirror what the chat route's tools return) ────────────

interface RecallOutput {
  query: string;
  today?: string;
  active?: RecalledFinding[];
  superseded?: RecalledFinding[];
  note?: string;
  error?: string;
}
interface StoreOutput {
  status: "done" | "pending" | "error";
  memory_id?: string;
  job_id?: string;
  namespace?: string;
  text?: string;
  finding?: Finding;
  error?: string;
}
type ToolState = "input-streaming" | "input-available" | "output-available" | "output-error";
interface ToolPart {
  type: string;
  toolCallId: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/** What a still-uploading write settled to, reported up by SavedCard. */
export interface ResolvedWrite {
  status: "done" | "error";
  memoryId?: string;
  error?: string;
}

const RECALL = "tool-recall_findings";
const STORE = "tool-remember_finding";

function isToolPart(p: { type: string }): p is ToolPart {
  return p.type === RECALL || p.type === STORE;
}

const EXAMPLES = [
  "WalletConnect dey fail for my users on MTN. Any fix?",
  "Which OPay endpoint should I use for payouts, and wetin be the gotchas?",
  "I confirm today say Airtel NG dey block the WalletConnect relay on 4G; custom relay URL fix am. WalletConnect v2, reown appkit.",
];

export interface SabiAppProps {
  namespace: string;
  mode: "live" | "mock";
  network: Network;
  reporter: string;
  models: ModelOption[];
  /** Signed-in visitor (Enoki/Google); absent = anonymous under SABI_REPORTER. */
  user?: SabiUser;
  /** Present iff sign-in is configured on this instance. */
  googleClientId?: string;
}

export function SabiApp({
  namespace,
  mode,
  network,
  reporter,
  models,
  user,
  googleClientId,
}: SabiAppProps) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [wallOpen, setWallOpen] = useState(true);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error, stop } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  // Scroll the list, not the page, so the composer never leaves the screen; and
  // only follow the stream when the reader is already at the bottom.
  // Follow the stream while the reader is pinned to the bottom. Measuring the
  // gap per commit breaks the moment one commit is taller than the threshold,
  // so track intent on scroll instead and only re-evaluate then.
  const listRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (status === "submitted") pinned.current = true;
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  // Which model produced each assistant turn (the switcher can change mid-chat).
  const sentModels = useRef<string[]>([]);
  const modelByMessageId = useMemo(() => {
    const map = new Map<string, string>();
    let n = -1;
    for (const m of messages) {
      if (m.role === "user") n++;
      const id = sentModels.current[n];
      if (id) map.set(m.id, id);
    }
    return map;
  }, [messages]);
  const labelFor = (id: string) => models.find((m) => m.id === modelByMessageId.get(id))?.label;

  const last = messages[messages.length - 1];
  const thinking =
    status === "submitted" ||
    (status === "streaming" &&
      last?.role === "assistant" &&
      !last.parts.some((p) => (p.type === "text" && p.text.trim()) || isToolPart(p)));

  // A pending write resolves inside SavedCard; the ledger needs to hear about it
  // or the audit rail permanently disagrees with the transcript.
  const [resolved, setResolved] = useState<Record<string, ResolvedWrite>>({});
  const onWriteResolved = useCallback((callId: string, r: ResolvedWrite) => {
    setResolved((prev) => (prev[callId] ? prev : { ...prev, [callId]: r }));
  }, []);

  // First-seen timestamps for the ledger rail (tool parts carry none).
  const seenAt = useRef(new Map<string, number>());
  const ledger = useMemo(() => {
    const entries: LedgerEntry[] = [];
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const p of m.parts) {
        if (!isToolPart(p)) continue;
        if (!seenAt.current.has(p.toolCallId)) seenAt.current.set(p.toolCallId, Date.now());
        entries.push({ part: p, at: seenAt.current.get(p.toolCallId)! });
      }
    }
    return entries;
  }, [messages]);

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || busy) return;
      setInput("");
      sentModels.current.push(modelId);
      void sendMessage({ text: t }, { body: { model: modelId } });
    },
    [busy, modelId, sendMessage],
  );

  const empty = messages.length === 0;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <Topbar
        namespace={namespace}
        mode={mode}
        network={network}
        reporter={reporter}
        models={models}
        modelId={modelId}
        onModel={setModelId}
        wallOpen={wallOpen}
        onToggleWall={() => setWallOpen((v) => !v)}
        user={user}
        googleClientId={googleClientId}
      />

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div ref={listRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[var(--composer-max)] px-5 pb-52 pt-9 sm:px-6">
              {empty ? (
                <FirstRun onPick={send} network={network} mode={mode} />
              ) : (
                <div className="flex flex-col gap-6">
                  {messages.map((m) => (
                    <MessageView
                      key={m.id}
                      message={m}
                      network={network}
                      modelLabel={labelFor(m.id)}
                      mock={mode === "mock"}
                      settled={!busy}
                      onWriteResolved={onWriteResolved}
                    />
                  ))}
                  {thinking && <ActivityRow spinner>Sabi dey think&hellip;</ActivityRow>}
                  {error && (
                    <div className="flex items-start gap-2.5 rounded-[var(--r)] border border-line bg-bad-soft px-3.5 py-3 text-[13.5px] text-bad">
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        className="mt-[3px] shrink-0"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 8v5M12 16h.01" />
                      </svg>
                      <span className="[overflow-wrap:anywhere]">{error.message}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            onStop={stop}
            busy={busy}
          />
        </main>

        {wallOpen && (
          <aside className="hidden w-[var(--rail-w)] shrink-0 border-l border-line lg:block">
            <Ledger
              entries={ledger}
              network={network}
              namespace={namespace}
              mock={mode === "mock"}
              resolved={resolved}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

// ── top bar ─────────────────────────────────────────────────────────────────

function Topbar(props: {
  namespace: string;
  mode: "live" | "mock";
  network: Network;
  reporter: string;
  models: ModelOption[];
  modelId: string;
  onModel: (id: string) => void;
  wallOpen: boolean;
  onToggleWall: () => void;
  user?: SabiUser;
  googleClientId?: string;
}) {
  const live = props.mode === "live";
  return (
    <header className="shrink-0 border-b border-line">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5 sm:h-[var(--topbar-h)] sm:flex-nowrap sm:gap-3 sm:px-6 sm:py-0 lg:px-10">
        <div className="flex min-w-0 shrink items-center gap-2 whitespace-nowrap sm:gap-3">
          <Mark />
          <span className="display text-[19px] font-medium">Sabi</span>
          <span className="hidden h-[18px] w-px bg-line2 md:block" />
          <span className="mono hidden truncate text-[12.5px] text-muted md:block">
            ns:{props.namespace}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 text-[12.5px] ${
              live ? "text-ok" : "text-warn"
            }`}
            title={
              live
                ? `Live — writing to Walrus on ${props.network}`
                : "Mock — in-memory only, nothing reaches Walrus"
            }
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: live ? "var(--ok)" : "var(--warn)" }}
            />
            {live ? props.network : "mock"}
          </span>
        </div>

        <span className="grow" />

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:ml-0 sm:gap-3">
        {/* Anonymous writes still carry SABI_REPORTER, so the chip stays
            visible until someone actually signs in - sign-in being available
            must not hide who unattributed findings would be blamed on. */}
        {!props.user && (
          <span
            className="mono hidden text-[12px] text-faint xl:block"
            title="Findings you store are signed off with this handle"
          >
            {props.reporter}
          </span>
        )}
        {(props.googleClientId || props.user) && (
          <SignIn user={props.user} clientId={props.googleClientId} />
        )}

        <select
          value={props.modelId}
          onChange={(e) => props.onModel(e.target.value)}
          aria-label="Model"
          className="max-w-[9.5rem] cursor-pointer truncate rounded-[var(--r)] border border-edge bg-transparent px-2.5 py-1.5 text-[13px] text-ink transition-colors hover:bg-soft sm:max-w-none"
        >
          {props.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>

        <ThemeToggle />

        <button
          type="button"
          onClick={props.onToggleWall}
          title={props.wallOpen ? "Hide the ledger" : "Show the ledger"}
          aria-pressed={props.wallOpen}
          className={`hidden h-8 items-center gap-2 rounded-[var(--r)] border border-line2 px-2.5 text-[13px] transition-colors hover:bg-soft lg:inline-flex ${
            props.wallOpen ? "text-ink" : "text-faint"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16" />
          </svg>
          Ledger
        </button>
        </div>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" className="shrink-0" aria-hidden="true">
      <rect x="0.5" y="0.5" width="25" height="25" rx="7" stroke="var(--line2)" />
      <rect x="6" y="7" width="14" height="2" rx="1" fill="var(--ok)" />
      <rect x="6" y="12" width="10" height="2" rx="1" fill="var(--muted)" />
      <rect x="6" y="17" width="6" height="2" rx="1" fill="var(--faint)" />
    </svg>
  );
}

// ── first run ───────────────────────────────────────────────────────────────

interface RecentRow {
  memory_id: string;
  stale: boolean;
  age_days: number | null;
  category: string;
  subject: string;
  fix: string;
  verifiedOn: string;
  reportedBy: string | null;
}

function FirstRun({
  onPick,
  network,
  mode,
}: {
  onPick: (t: string) => void;
  network: Network;
  mode: "live" | "mock";
}) {
  const [rows, setRows] = useState<RecentRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/recent")
      .then((r) => r.json())
      .then((j: { rows?: RecentRow[]; error?: string }) => {
        if (!alive) return;
        // An empty list because the sample errored is NOT an empty namespace.
        if (j.error) setFailed(true);
        setRows(j.rows ?? []);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setRows([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col pt-6">
      <h1 className="display max-w-[15ch] text-[33px] font-normal leading-[1.08] sm:text-[46px] lg:text-[52px]">
        Ask before you burn a day on a landmine somebody don already hit.
      </h1>
      <p className="mt-5 max-w-[58ch] text-[16px] leading-relaxed text-muted">
        Sabi na the community brain for Naija web3 and fintech devs. E dey check wetin people don
        verify before e answer, and e only dey keep wetin you confirm say you reproduce yourself.
      </p>

      {/* How e dey work - three steps, hairline discipline, no colour spent. */}
      <ol className="mt-7 grid max-w-[58ch] gap-4 sm:grid-cols-3 sm:gap-6">
        {[
          {
            n: "01",
            t: "Ask",
            d: "Describe your blocker. Sabi go check community memory first and cite who verify wetin, and when.",
          },
          {
            n: "02",
            t: "Verify",
            d: "Reproduce the issue or the fix yourself. Second-hand gist no dey enter - na you be the proof.",
          },
          {
            n: "03",
            t: "Store",
            d: "Talk say you confirm am. Sabi go keep am on Walrus with your name and date, for the next person.",
          },
        ].map((s) => (
          <li key={s.n} className="border-t border-line pt-3">
            <div className="flex items-baseline gap-2">
              <span className="mono text-[11px] text-faint">{s.n}</span>
              <span className="text-[13.5px] font-medium">{s.t}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.d}</p>
          </li>
        ))}
      </ol>

      <div className="mt-7 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="max-w-full rounded-full border border-line px-3.5 py-2 text-left text-[13px] text-muted transition-colors hover:border-line2 hover:text-ink"
          >
            <span className="line-clamp-1">{ex}</span>
          </button>
        ))}
      </div>

      <section className="mt-9 sm:mt-12">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <h2 className="text-[13px] font-medium">Some of wetin the community don verify</h2>
          <span className="text-[12px] text-faint">
            {mode === "mock" ? "mock memory" : "sampled from the namespace"}
          </span>
        </div>

        {rows === null && (
          <div className="flex flex-col">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 border-b border-line py-4">
                <span className="h-3 w-16 rounded bg-soft" />
                <span className="h-3 grow rounded bg-soft" />
                <span className="h-3 w-20 rounded bg-soft" />
              </div>
            ))}
          </div>
        )}

        {rows !== null && rows.length === 0 && (
          <p className={`py-6 text-[13.5px] ${failed ? "text-warn" : "text-faint"}`}>
            {failed
              ? "I no fit reach the memory to sample am — this no mean say the namespace empty."
              : "Nothing dey the namespace yet. Verify one thing, tell Sabi, and e go be the first record."}
          </p>
        )}

        {rows?.map((r) => (
          <article
            key={r.memory_id}
            className="grid grid-cols-1 gap-x-5 gap-y-2 border-b border-line py-4 sm:grid-cols-[88px_1fr_auto] sm:items-baseline"
          >
            <span className={`eyebrow ${r.stale ? "text-warn" : "text-ok"}`}>{r.category}</span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[14.5px]">{r.subject}</span>
              <span className="text-[13px] text-faint">{r.fix}</span>
            </div>
            <div className="nums flex items-center gap-3 text-[12px] text-faint">
              {r.reportedBy && <span>{r.reportedBy}</span>}
              <span className={r.stale ? "text-warn" : "text-muted"}>
                {r.verifiedOn}
                {r.stale && " · stale"}
              </span>
              <IdChip id={r.memory_id} network={network} mock={mode === "mock"} />
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

// ── messages ────────────────────────────────────────────────────────────────

function MessageView({
  message,
  network,
  modelLabel,
  mock,
  settled,
  onWriteResolved,
}: {
  message: UIMessage;
  network: Network;
  modelLabel?: string;
  mock: boolean;
  /** The turn is over: a tool part still awaiting output was aborted. */
  settled: boolean;
  onWriteResolved: (callId: string, r: ResolvedWrite) => void;
}) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[var(--r)] bg-soft px-4 py-3 text-[15px] leading-relaxed [overflow-wrap:anywhere]">
          {message.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {modelLabel && (
        <span className="text-[10.5px] uppercase tracking-[0.1em] text-faint">{modelLabel}</span>
      )}
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          if (!part.text.trim()) return null;
          return <Markdown key={i} text={part.text} />;
        }
        if (isToolPart(part)) {
          return (
            <ToolPartView
              key={part.toolCallId}
              part={part}
              network={network}
              mock={mock}
              settled={settled}
              onWriteResolved={onWriteResolved}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

function ToolPartView({
  part,
  network,
  mock,
  settled,
  onWriteResolved,
}: {
  part: ToolPart;
  network: Network;
  mock: boolean;
  settled: boolean;
  onWriteResolved: (callId: string, r: ResolvedWrite) => void;
}) {
  const isRecall = part.type === RECALL;

  if (part.state === "input-streaming" || part.state === "input-available") {
    // Stop/reload leaves a tool part with no output. Never spin forever.
    if (settled) {
      return (
        <ActivityRow tone="faint">
          {isRecall ? "Recall stopped before it finished." : "Write stopped before it finished."}
        </ActivityRow>
      );
    }
    return (
      <ActivityRow spinner>
        {isRecall
          ? "Sabi dey check community memory…"
          : mock
            ? "Sabi dey store am for mock memory…"
            : "Sabi dey store am for Walrus…"}
      </ActivityRow>
    );
  }

  if (part.state === "output-error") {
    return <ActivityRow tone="bad">Tool fail: {part.errorText ?? "unknown error"}</ActivityRow>;
  }

  if (isRecall) {
    const out = part.output as RecallOutput;
    const active = out.active ?? [];
    const superseded = out.superseded ?? [];
    if (out.error) {
      return (
        <ActivityRow tone="bad">
          I never reach the memory ({out.error}) — so nothing below is verified.
        </ActivityRow>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <ActivityRow tone={active.length ? "ok" : "faint"}>
          <span>
            Recalled <span className="text-ink">&ldquo;{out.query}&rdquo;</span>
          </span>
          <span className="text-faint">·</span>
          <span>
            {active.length} active
            {superseded.length > 0 && `, ${superseded.length} superseded`}
          </span>
        </ActivityRow>

        {active.map((h) => (
          <FindingCard key={h.memory_id} hit={h} network={network} mock={mock} />
        ))}

        {active.length === 0 && (
          <p className="text-[13.5px] text-faint">
            Community memory no get anything on this yet — whatever Sabi talk next na general
            knowledge, nobody verify am.
          </p>
        )}

        {superseded.length > 0 && (
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-[12.5px] text-faint hover:text-muted">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="transition-transform group-open:rotate-180"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
              {superseded.length} superseded — kept for history
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {superseded.map((h) => (
                <FindingCard key={h.memory_id} hit={h} network={network} mock={mock} />
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  const out = part.output as StoreOutput;
  return (
    <SavedCard
      status={out.status}
      memoryId={out.memory_id}
      jobId={out.job_id}
      finding={out.finding}
      text={out.text}
      error={out.error}
      network={network}
      mock={mock}
      onResolved={(r) => onWriteResolved(part.toolCallId, r)}
    />
  );
}

function ActivityRow({
  children,
  spinner,
  tone = "muted",
}: {
  children: React.ReactNode;
  spinner?: boolean;
  tone?: "muted" | "ok" | "bad" | "faint";
}) {
  const color = tone === "bad" ? "text-bad" : tone === "faint" ? "text-faint" : "text-muted";
  const dot = tone === "bad" ? "var(--bad)" : tone === "ok" ? "var(--ok)" : "var(--faint)";
  return (
    <div className={`flex items-center gap-2.5 text-[12.5px] ${color}`}>
      {spinner ? (
        <span className="spin block h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-track border-t-[var(--ok)]" />
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={dot}
          strokeWidth="1.6"
          className="shrink-0"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      )}
      {children}
      <span className="ml-1 hidden h-px grow bg-line sm:block" />
    </div>
  );
}

// ── composer ────────────────────────────────────────────────────────────────

function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  // field-sizing:content handles this natively in newer Chrome; this keeps the
  // same behaviour everywhere else, and resets cleanly when the value clears.
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-6 pt-10 sm:px-6"
      style={{ background: "linear-gradient(to top, var(--paper) 74%, transparent)" }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="pointer-events-auto mx-auto w-full max-w-[var(--composer-max)]"
      >
        <div className="flex items-end gap-2.5 rounded-[14px] border border-edge bg-[var(--composer-fill)] py-2.5 pl-4 pr-2.5 shadow-[var(--shadow)]">
          <textarea
            ref={ta}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder="Describe the blocker, or tell Sabi wetin you verify…"
            className="max-h-40 min-h-[38px] grow resize-none bg-transparent py-1.5 text-[16px] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted sm:text-[15px]"
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-edge text-muted transition-colors hover:bg-soft"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!value.trim()}
              title="Send"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-paper transition-opacity disabled:opacity-30"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
        <p className="mt-2 flex items-start gap-2 pl-1 text-[11.5px] text-faint">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="mt-[3px] shrink-0"
          >
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 018 0v3" />
          </svg>
          Sabi only dey store wetin you confirm say you reproduce — and nothing wey look like a key
          or a phone number.
        </p>
      </form>
    </div>
  );
}

// ── ledger rail ─────────────────────────────────────────────────────────────

interface LedgerEntry {
  part: ToolPart;
  at: number;
}

function Ledger({
  entries,
  network,
  namespace,
  mock,
  resolved,
}: {
  entries: LedgerEntry[];
  network: Network;
  namespace: string;
  mock: boolean;
  resolved: Record<string, ResolvedWrite>;
}) {
  const recalls = entries.filter((e) => e.part.type === RECALL).length;
  // Only a blob that actually landed counts as a write. Refused, failed and
  // still-uploading attempts are reported separately rather than tallied green.
  const writes = entries.filter((e) => e.part.type === STORE);
  const stores = writes.filter((e) => {
    const out = e.part.output as StoreOutput | undefined;
    const r = resolved[e.part.toolCallId];
    return (r ? r.status : out?.status) === "done";
  }).length;
  const unsettled = writes.length - stores;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3.5 border-b border-line px-6 py-5">
        <div className="flex items-baseline justify-between">
          <span className="display text-[14px] font-medium">Ledger</span>
          <span className="mono text-[11.5px] text-faint">ns:{namespace}</span>
        </div>
        <div className="nums grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="display text-[22px] font-medium">{recalls}</span>
            <span className="text-[11.5px] text-faint">recalls this session</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="display text-[22px] font-medium">{stores}</span>
            <span className="text-[11.5px] text-faint">
              {mock ? "mock writes this session" : "stored this session"}
              {unsettled > 0 && <span className="text-warn"> · {unsettled} not settled</span>}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <p className="px-6 py-5 text-[12px] leading-relaxed text-faint">
            Nothing yet. Every time Sabi read or write Walrus Memory, e go show here with the blob
            id.
          </p>
        )}
        {[...entries].reverse().map(({ part, at }) => (
          <LedgerItem
            key={part.toolCallId}
            part={part}
            at={at}
            network={network}
            mock={mock}
            resolved={resolved[part.toolCallId]}
          />
        ))}
      </div>

      <div className="flex items-center gap-2.5 border-t border-line px-6 py-4 text-[11.5px] text-faint">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
        </svg>
        {mock
          ? "Mock memory — these ids no dey Walrus."
          : "Every row na one encrypted blob you fit open."}
      </div>
    </div>
  );
}

function LedgerItem({
  part,
  at,
  network,
  mock,
  resolved,
}: {
  part: ToolPart;
  at: number;
  network: Network;
  mock: boolean;
  resolved?: ResolvedWrite;
}) {
  const isRecall = part.type === RECALL;
  const time = new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const pending = part.state === "input-streaming" || part.state === "input-available";

  let body: React.ReactNode;
  if (part.state === "output-error") {
    body = <span className="text-bad">{part.errorText ?? "tool failed"}</span>;
  } else if (pending) {
    body = <span className="text-faint">{isRecall ? "recalling…" : "storing…"}</span>;
  } else if (isRecall) {
    const out = part.output as RecallOutput;
    const ids = [...(out.active ?? []), ...(out.superseded ?? [])].map((h) => h.memory_id);
    body = (
      <>
        <div className="truncate">&ldquo;{out.query}&rdquo;</div>
        <div className="text-faint">
          {out.error
            ? `error: ${out.error}`
            : `${out.active?.length ?? 0} active · ${out.superseded?.length ?? 0} superseded`}
        </div>
        {ids.slice(0, 3).map((id) => (
          <Blob key={id} id={id} network={network} mock={mock} />
        ))}
      </>
    );
  } else {
    const out = part.output as StoreOutput;
    // The tool output is frozen at first render; a pending write that later
    // landed reports its real outcome through `resolved`.
    const status = resolved?.status ?? out.status;
    const memoryId = resolved?.memoryId ?? out.memory_id;
    const err = resolved?.error ?? out.error;
    body = (
      <>
        <div className="truncate">
          {out.finding ? `[${out.finding.category}] ${out.finding.subject}` : status}
        </div>
        {memoryId ? (
          <Blob id={memoryId} network={network} mock={mock} />
        ) : (
          <div className={status === "error" ? "text-bad" : "text-warn"}>
            {status === "error" ? err : "still uploading…"}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-6 py-3.5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.1em]">
        <span className={isRecall ? "text-muted" : "text-ok"}>{isRecall ? "Recall" : "Store"}</span>
        <span className="mono tracking-normal text-faint">{time}</span>
      </div>
      {/* Prose stays in the body face; mono is reserved for ids and clocks. */}
      <div className="flex flex-col gap-1 text-[11.5px] leading-snug">{body}</div>
    </div>
  );
}

/** A blob id in the rail: mono, and only a link when there is really a blob. */
function Blob({ id, network, mock }: { id: string; network: Network; mock: boolean }) {
  if (mock) return <span className="mono block truncate text-faint">{id}</span>;
  return (
    <a
      href={walruscanUrl(id, network)}
      target="_blank"
      rel="noreferrer"
      className="mono block truncate text-faint underline decoration-line2 underline-offset-2 hover:text-ink"
    >
      {id}
    </a>
  );
}
