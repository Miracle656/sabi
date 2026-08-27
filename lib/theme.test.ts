import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal DOM + storage stand-ins: theme.ts only touches documentElement's
// attribute, localStorage, and matchMedia.
function stubEnv(opts: { stored?: string | null; prefersDark?: boolean; throwOnWrite?: boolean }) {
  const attrs = new Map<string, string>();
  const store = new Map<string, string>();
  if (opts.stored != null) store.set("sabi.theme", opts.stored);

  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
      getAttribute: (k: string) => attrs.get(k) ?? null,
    },
  };
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (opts.throwOnWrite) throw new Error("private mode");
        store.set(k, v);
      },
      removeItem: (k: string) => {
        if (opts.throwOnWrite) throw new Error("private mode");
        store.delete(k);
      },
    },
    matchMedia: (q: string) => ({ matches: q.includes("dark") ? !!opts.prefersDark : false }),
  };
  return { attrs, store };
}

function clearEnv() {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
}

test("applyTheme writes the attribute for explicit choices and clears it for system", async () => {
  const { attrs, store } = stubEnv({});
  const { applyTheme } = await import("./theme");

  applyTheme("dark");
  assert.equal(attrs.get("data-theme"), "dark");
  assert.equal(store.get("sabi.theme"), "dark");

  applyTheme("light");
  assert.equal(attrs.get("data-theme"), "light");
  assert.equal(store.get("sabi.theme"), "light");

  // "system" must remove the attribute entirely so the prefers-color-scheme
  // rules in globals.css take over — writing data-theme="system" would match
  // neither palette and strand the page on the light base.
  applyTheme("system");
  assert.equal(attrs.has("data-theme"), false);
  assert.equal(store.has("sabi.theme"), false);
  clearEnv();
});

test("readStoredTheme rejects junk and defaults to system", async () => {
  stubEnv({ stored: "neon" });
  const { readStoredTheme } = await import("./theme");
  assert.equal(readStoredTheme(), "system");
  clearEnv();

  stubEnv({ stored: "dark" });
  assert.equal((await import("./theme")).readStoredTheme(), "dark");
  clearEnv();
});

test("resolveTheme follows the OS only for system", async () => {
  stubEnv({ prefersDark: true });
  const { resolveTheme } = await import("./theme");
  assert.equal(resolveTheme("system"), "dark");
  assert.equal(resolveTheme("light"), "light");
  assert.equal(resolveTheme("dark"), "dark");
  clearEnv();

  stubEnv({ prefersDark: false });
  assert.equal((await import("./theme")).resolveTheme("system"), "light");
  clearEnv();
});

test("a storage that refuses writes still applies the theme", async () => {
  const { attrs } = stubEnv({ throwOnWrite: true });
  const { applyTheme } = await import("./theme");
  assert.doesNotThrow(() => applyTheme("dark"));
  assert.equal(attrs.get("data-theme"), "dark");
  clearEnv();
});
