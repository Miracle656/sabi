// How much to trust one finding, as a score made of named parts. Pure: the
// caller supplies who is what (levels from the community index, packages
// published from Tatum), this file only adds up the evidence.
//
// Every part is shown to the user, so the number is never a black box:
// "Trust 75 = verified by author 30 + 2 confirmations 30 + on-chain evidence 15".

import { confirmers, type RecalledFinding } from "./findings";
import type { LevelId } from "./reputation";

export const TRUST = {
  verified: 30,
  perConfirmer: 15,
  maxConfirmers: 3,
  builderConfirmer: 5,
  builderAuthor: 5,
  evidence: 15,
  trustedAuthor: 5,
  stale: -25,
  aging: -10,
  agingAfterDays: 30,
} as const;

export interface TrustPart {
  label: string;
  points: number;
}

export interface Trust {
  score: number;
  label: "High" | "Medium" | "Low";
  parts: TrustPart[];
}

export interface TrustContext {
  /** Level id of a member by handle, when the community index knows them. */
  levelOf: (handle: string) => LevelId | undefined;
  /** Move packages published by an address, when Tatum has been asked (undefined = unknown). */
  packagesOf: (address: string) => number | undefined;
}

export function trustOf(hit: RecalledFinding, ctx: TrustContext): Trust | undefined {
  const f = hit.finding;
  if (!f) return undefined;
  const parts: TrustPart[] = [{ label: "verified by its author", points: TRUST.verified }];

  const others = confirmers(hit).slice(0, TRUST.maxConfirmers);
  if (others.length) {
    parts.push({
      label: `${others.length} other ${others.length === 1 ? "member" : "members"} confirmed it`,
      points: others.length * TRUST.perConfirmer,
    });
    // Confirmers whose address has published Sui packages - people who ship.
    const addressOf = new Map<string, string>();
    for (const c of hit.confirmations ?? []) if (c.by && c.address) addressOf.set(c.by.toLowerCase(), c.address);
    const builders = others.filter((h) => (ctx.packagesOf(addressOf.get(h) ?? "") ?? 0) > 0).length;
    if (builders) {
      parts.push({
        label: `${builders} ${builders === 1 ? "confirmer has" : "confirmers have"} published Sui packages`,
        points: builders * TRUST.builderConfirmer,
      });
    }
  }

  if (f.address && (ctx.packagesOf(f.address) ?? 0) > 0) {
    parts.push({ label: "author has published Sui packages", points: TRUST.builderAuthor });
  }
  if (f.evidence) parts.push({ label: "on-chain evidence", points: TRUST.evidence });
  const level = f.reportedBy ? ctx.levelOf(f.reportedBy) : undefined;
  if (level === "trusted" || level === "steward") {
    parts.push({ label: `author is a ${level === "steward" ? "Steward" : "Trusted"} member`, points: TRUST.trustedAuthor });
  }

  if (hit.stale) {
    parts.push({ label: "stale: not re-verified recently", points: TRUST.stale });
  } else if (f.volatile && hit.age_days !== null && hit.age_days > TRUST.agingAfterDays) {
    parts.push({ label: `volatile and ${hit.age_days} days since last verified`, points: TRUST.aging });
  }

  const score = Math.max(0, Math.min(100, parts.reduce((n, p) => n + p.points, 0)));
  return { score, label: score >= 75 ? "High" : score >= 50 ? "Medium" : "Low", parts };
}

/** For prompts and tooltips: "75 (High): verified by its author +30, ..." */
export function explainTrust(t: Trust): string {
  return `${t.score} (${t.label}): ${t.parts.map((p) => `${p.label} ${p.points > 0 ? "+" : ""}${p.points}`).join(", ")}`;
}
