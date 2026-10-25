// Topics, contributors and levels, derived from recalled memories alone.
//
// Pure: no SDK, no I/O. Everything here is recomputed from what is on Walrus,
// so there is no score to tamper with - only findings and confirmations, each
// a blob with a verified author. Reputation rewards BEING CONFIRMED, not
// posting: a finding nobody else reproduces earns its author 10 points once,
// while every distinct member who reproduces it adds 5.

import {
  CATEGORIES,
  sameHandle,
  type Category,
  type RecalledFinding,
} from "./findings";

/** Example findings shipped with the repo; never a contributor. */
const NOT_A_MEMBER = new Set(["@seed"]);

export const POINTS = { finding: 10, confirmed: 5, confirmedOther: 2 } as const;

export type LevelId = "newcomer" | "verifier" | "trusted" | "steward";

export interface Level {
  id: LevelId;
  name: string;
  rule: string;
  /** What reaching this level lets a member do, when it unlocks anything. */
  unlocks?: string;
}

export const LEVELS: readonly Level[] = [
  { id: "newcomer", name: "Newcomer", rule: "No verified finding yet" },
  { id: "verifier", name: "Verifier", rule: "1+ verified finding" },
  {
    id: "trusted",
    name: "Trusted",
    rule: "3+ findings, confirmed by 2+ other members",
    unlocks: "Can replace a finding that other members have confirmed",
  },
  { id: "steward", name: "Steward", rule: "10+ findings, confirmed by 5+ other members" },
];

/** Superseding someone else's finding that this many OTHER members confirmed needs level "trusted". */
export const PROTECTED_AFTER_CONFIRMERS = 2;

export interface Contributor {
  handle: string;
  findings: number;
  /** Distinct (member, finding) confirmations of this member's findings, self excluded. */
  confirmationsReceived: number;
  /** Distinct members who confirmed at least one of this member's findings. */
  confirmedBy: number;
  /** Findings by OTHER members this member reproduced. */
  confirmationsGiven: number;
  categories: Category[];
  /** Newest date this member verified or confirmed anything. */
  lastActive: string;
  points: number;
  level: Level;
}

export interface Topic {
  category: Category;
  active: number;
  stale: number;
  latest: string | null;
}

function levelFor(findings: number, confirmedBy: number): Level {
  const [newcomer, verifier, trusted, steward] = LEVELS;
  if (findings >= 10 && confirmedBy >= 5) return steward;
  if (findings >= 3 && confirmedBy >= 2) return trusted;
  if (findings >= 1) return verifier;
  return newcomer;
}

export function levelRank(id: LevelId): number {
  return LEVELS.findIndex((l) => l.id === id);
}

const key = (h: string) => h.replace(/^@+/, "").toLowerCase();

/**
 * Every member who wrote or confirmed something in `hits`. Pass ALL recalled
 * rows - superseded findings were true when written and still count, and
 * confirmations are read from the raw rows, folded or not.
 */
export function buildContributors(hits: RecalledFinding[]): Contributor[] {
  const byId = new Map(hits.map((h) => [h.memory_id, h]));
  interface Acc {
    handle: string;
    findings: Set<string>;
    received: Set<string>; // `${confirmer}|${findingId}`
    confirmedBy: Set<string>;
    given: Set<string>; // finding ids
    categories: Set<Category>;
    lastActive: string;
  }
  const acc = new Map<string, Acc>();
  const get = (handle: string): Acc => {
    let a = acc.get(key(handle));
    if (!a) {
      a = {
        handle,
        findings: new Set(),
        received: new Set(),
        confirmedBy: new Set(),
        given: new Set(),
        categories: new Set(),
        lastActive: "",
      };
      acc.set(key(handle), a);
    }
    return a;
  };
  const touch = (a: Acc, on: string) => {
    if (on > a.lastActive) a.lastActive = on;
  };

  for (const h of hits) {
    const f = h.finding;
    const by = f?.reportedBy;
    if (!f || !by || NOT_A_MEMBER.has(by.toLowerCase())) continue;
    if (!f.confirms) {
      const a = get(by);
      a.findings.add(h.memory_id);
      a.categories.add(f.category);
      touch(a, f.verifiedOn);
      continue;
    }
    // A confirmation only counts when we can see whose finding it confirms:
    // otherwise a member could farm points by "confirming" their own work.
    const target = byId.get(f.confirms)?.finding;
    const author = target?.reportedBy;
    if (!target || target.confirms || !author || sameHandle(author, by)) {
      if (target && sameHandle(author, by)) touch(get(by), f.verifiedOn);
      continue;
    }
    const confirmer = get(by);
    confirmer.given.add(f.confirms);
    touch(confirmer, f.verifiedOn);
    if (NOT_A_MEMBER.has(author.toLowerCase())) continue;
    const owner = get(author);
    owner.received.add(`${key(by)}|${f.confirms}`);
    owner.confirmedBy.add(key(by));
  }

  return [...acc.values()]
    .map((a) => {
      const findings = a.findings.size;
      const confirmedBy = a.confirmedBy.size;
      return {
        handle: a.handle,
        findings,
        confirmationsReceived: a.received.size,
        confirmedBy,
        confirmationsGiven: a.given.size,
        categories: CATEGORIES.filter((c) => a.categories.has(c)),
        lastActive: a.lastActive,
        points:
          findings * POINTS.finding +
          a.received.size * POINTS.confirmed +
          a.given.size * POINTS.confirmedOther,
        level: levelFor(findings, confirmedBy),
      };
    })
    .sort((x, y) => y.points - x.points || (x.lastActive < y.lastActive ? 1 : -1));
}

/** Per-category counts over the ACTIVE (resolved) findings. */
export function buildTopics(active: RecalledFinding[]): Topic[] {
  return CATEGORIES.map((category) => {
    const rows = active.filter((h) => h.finding?.category === category);
    const latest = rows.reduce<string | null>((max, h) => {
      const d = h.last_verified ?? h.finding!.verifiedOn;
      return !max || d > max ? d : max;
    }, null);
    return { category, active: rows.length, stale: rows.filter((h) => h.stale).length, latest };
  });
}

export function findContributor(list: Contributor[], handle: string): Contributor | undefined {
  return list.find((c) => key(c.handle) === key(handle));
}

/** Newest first: last verification, then relayer write time. */
export function byRecency(a: RecalledFinding, b: RecalledFinding): number {
  const da = a.last_verified ?? a.finding?.verifiedOn ?? "";
  const db = b.last_verified ?? b.finding?.verifiedOn ?? "";
  if (da !== db) return da < db ? 1 : -1;
  return (a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1;
}
