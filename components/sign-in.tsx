"use client";

// "Sign in" via Google Identity Services -> POST the ID token to our server,
// which verifies it against Google's JWKS and (when ENOKI_API_KEY is set) asks
// Enoki for the zkLogin Sui address. The server sets an HttpOnly cookie, so a
// full refresh() is how the new identity reaches the server components.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface PromptMoment {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
}
interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (res: { credential: string }) => void;
    use_fedcm_for_prompt?: boolean;
  }): void;
  prompt(momentListener?: (moment: PromptMoment) => void): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

// A failed load must not poison every later attempt: the promise is cleared and
// the dead <script> removed, so the next click injects a fresh one.
let gsiLoad: Promise<GoogleAccountsId> | null = null;
function loadGsi(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!gsiLoad) {
    gsiLoad = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GSI_SRC;
      s.async = true;
      s.onload = () => {
        const gsi = window.google?.accounts?.id;
        if (gsi) resolve(gsi);
        else {
          gsiLoad = null;
          s.remove();
          reject(new Error("Google sign-in loaded but is unavailable"));
        }
      };
      s.onerror = () => {
        gsiLoad = null;
        s.remove();
        reject(new Error("Google sign-in failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return gsiLoad;
}

export interface SabiUser {
  handle: string;
  address?: string;
}

export function SignIn({ user, clientId }: { user?: SabiUser; clientId?: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Which clientId gsi.initialize was last called with - re-init on change
  // instead of pinning the first value forever.
  const initializedFor = useRef<string | null>(null);

  const onCredential = useCallback(
    async (res: { credential: string }) => {
      setPending(true);
      setErr(null);
      try {
        const r = await fetch("/api/auth/enoki", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credential: res.credential }),
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setPending(false);
      }
    },
    [router],
  );

  const signIn = useCallback(async () => {
    if (!clientId) return;
    setErr(null);
    let gsi: GoogleAccountsId;
    try {
      gsi = await loadGsi();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    if (initializedFor.current !== clientId) {
      gsi.initialize({ client_id: clientId, callback: onCredential, use_fedcm_for_prompt: true });
      initializedFor.current = clientId;
    }
    // The prompt can be silently suppressed (cooldown, blocked third-party
    // sign-in). The moment listener turns that silence into a visible error
    // instead of a dead button. Guarded: FedCM builds restrict these methods.
    gsi.prompt((moment) => {
      try {
        if (moment?.isNotDisplayed?.() || moment?.isSkippedMoment?.()) {
          setErr("Google prompt was blocked or dismissed — check third-party sign-in settings and retry");
        }
      } catch {
        /* moment API unavailable under FedCM - nothing to report */
      }
    });
  }, [clientId, onCredential]);

  const signOut = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch("/api/auth/enoki", { method: "DELETE" });
      if (!r.ok) throw new Error(`sign-out failed (HTTP ${r.status})`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [router]);

  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(null), 8000);
    return () => clearTimeout(t);
  }, [err]);

  if (!clientId && !user) return null;

  if (user) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="mono max-w-[7rem] truncate text-[12px] text-ink sm:max-w-[10rem]"
          title={user.address ? `zkLogin address ${user.address}` : "Signed in"}
        >
          {user.handle}
        </span>
        <button
          type="button"
          onClick={signOut}
          className="h-8 shrink-0 rounded-[var(--r)] border border-line2 px-2.5 text-[13px] text-faint transition-colors hover:bg-soft hover:text-ink"
        >
          Sign out
        </button>
        {err && (
          <span role="status" className="max-w-[12rem] truncate text-[12px] text-bad" title={err}>
            {err}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        title="Sign in with Google — findings you store carry your handle"
        className="h-8 shrink-0 rounded-[var(--r)] border border-line2 px-2.5 text-[13px] text-ink transition-colors hover:bg-soft disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {err && (
        <span role="status" className="max-w-[12rem] truncate text-[12px] text-bad" title={err}>
          {err}
        </span>
      )}
    </span>
  );
}
