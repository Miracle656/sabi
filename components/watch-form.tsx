"use client";

// Start watching an address. The server reads its balance through Tatum first,
// so an address that is not on mainnet is refused before anything is stored.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function WatchForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "working" } | { kind: "error"; error: string }>({
    kind: "idle",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ kind: "working" });
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, label }),
      });
      const j = (await res.json()) as { status: string; error?: string };
      if (j.status === "error") {
        setState({ kind: "error", error: j.error ?? "Could not watch that address." });
        return;
      }
      setAddress("");
      setLabel("");
      setState({ kind: "idle" });
      router.refresh();
    } catch (err) {
      setState({ kind: "error", error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className={`flex flex-col gap-2 ${compact ? "" : "sm:flex-row"}`}>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x… address to watch (deployer, treasury, bot)"
          aria-label="Sui address"
          required
          spellCheck={false}
          className="mono h-10 min-w-0 flex-[2] rounded-[var(--r)] border border-edge bg-[var(--composer-fill)] px-3 text-[13px] text-ink placeholder:text-faint focus:border-ink focus:outline-none"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name, e.g. mainnet deployer"
          aria-label="Label"
          maxLength={60}
          className="h-10 min-w-0 flex-1 rounded-[var(--r)] border border-edge bg-[var(--composer-fill)] px-3 text-[13.5px] text-ink placeholder:text-faint focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.kind === "working" || !address.trim()}
          className="h-10 shrink-0 rounded-[var(--r)] bg-ink px-4 text-[13.5px] font-medium text-[var(--paper)] transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {state.kind === "working" ? "Reading Sui…" : "Watch"}
        </button>
      </div>
      {state.kind === "error" && <p className="text-[13px] text-bad">{state.error}</p>}
    </form>
  );
}
