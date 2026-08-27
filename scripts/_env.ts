// Shared bootstrap for the CLI scripts: load sabi/.env.local and sabi/.env before
// any lib module reads process.env. Node 20.12+ has process.loadEnvFile built in.
//
// Order matters and is NOT arbitrary. process.loadEnvFile never overwrites a key
// that is already set, so the FIRST file to define a key wins. Loading
// `.env.local` before `.env` therefore reproduces Next.js's own precedence
// (shell > .env.local > .env) - without this the scripts and the app read
// different credentials, and `pnpm smoke` fails while the app works.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILES = [".env.local", ".env"];

export function loadEnv(): void {
  const override = process.env.SABI_ENV_FILE;
  const files = override ? [override] : ENV_FILES.map((f) => resolve(process.cwd(), f));
  for (const file of files) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const kv = process.argv.find((a) => a.startsWith(`--${name}=`));
  return kv?.slice(name.length + 3);
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
