import type { MissingVar } from "@/lib/env";
import { ThemeToggle } from "./theme-toggle";

export function SetupScreen({ missing, mode }: { missing: MissingVar[]; mode: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[760px] flex-col justify-center px-5 py-14 sm:px-6">
      <div className="mb-8 flex items-center gap-3">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" className="shrink-0" aria-hidden="true">
          <rect x="0.5" y="0.5" width="25" height="25" rx="7" stroke="var(--line2)" />
          <rect x="6" y="7" width="14" height="2" rx="1" fill="var(--ok)" />
          <rect x="6" y="12" width="10" height="2" rx="1" fill="var(--muted)" />
          <rect x="6" y="17" width="6" height="2" rx="1" fill="var(--faint)" />
        </svg>
        <span className="display text-[19px] font-medium">Sabi</span>
        <span className="grow" />
        <ThemeToggle />
      </div>

      <span className="eyebrow text-warn">Setup needed</span>
      <h1 className="display mt-3 max-w-[16ch] text-[36px] font-normal leading-[1.08] sm:text-[44px]">
        Sabi no fit start yet.
      </h1>
      <p className="mt-5 max-w-[60ch] text-[15.5px] leading-relaxed text-muted">
        Copy <code className="mono text-ink">sabi/.env.example</code> to{" "}
        <code className="mono text-ink">sabi/.env</code>, fill in the variables below, then restart{" "}
        <code className="mono text-ink">pnpm dev</code>.
      </p>

      <ul className="mt-8 flex flex-col">
        {missing.map((m) => (
          <li
            key={m.name}
            className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-line py-4 sm:grid-cols-[240px_1fr]"
          >
            <span className="mono text-[13px] text-ink">{m.name}</span>
            <div className="flex flex-col gap-1">
              <span className="text-[14px] leading-relaxed">{m.why}</span>
              <span className="text-[13px] text-faint">{m.where}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-col gap-2.5 rounded-[var(--r)] border border-line bg-surface2 px-4 py-4 text-[13.5px] leading-relaxed">
        <p>
          <span className="font-medium">No Walrus Memory credentials yet?</span> Set{" "}
          <code className="mono text-ink">MEMWAL_MODE=mock</code> to run the whole UI against an
          in-memory store — nothing persists and nothing reaches Walrus. Current mode:{" "}
          <code className="mono text-ink">{mode}</code>.
        </p>
        <p className="text-muted">
          Real credentials come from the Walrus Memory Playground at{" "}
          <a
            className="text-ink underline decoration-line2 underline-offset-2 hover:decoration-current"
            href="https://memory.walrus.xyz"
            target="_blank"
            rel="noreferrer"
          >
            memory.walrus.xyz
          </a>
          , or mint a member key with <code className="mono text-ink">pnpm keygen</code> and have
          the account owner register it with{" "}
          <code className="mono text-ink">pnpm add-member</code>.
        </p>
      </div>
    </main>
  );
}
