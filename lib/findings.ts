// The canonical finding: the one line Sabi stores as a memory, and the parser
// that turns a recalled line back into structured fields.
//
// Memory on Walrus is APPEND-ONLY (the MemWal SDK has no delete). So "updating"
// a finding means storing a new one that names the old memory id in SUPERSEDES,
// and resolving the chain at recall time (see resolveSupersession). Staleness is
// also computed here, in code, from the VERIFIED date - the model never has to
// do date arithmetic.
//
// Format (single line):
//   [CATEGORY] subject → finding → FIX: fix → VERIFIED: YYYY-MM-DD | provider | version | volatile:yes | by:@handle | SUPERSEDES:<memory_id>
//
// `by:` and `SUPERSEDES:` are optional. The memory id is the Walrus blob id the
// relayer returns; it is the only stable identifier a recalled memory carries.
//
// A CONFIRMATION is the same line written by a second member who reproduced the
// finding themselves, ending in `CONFIRMS:<memory_id>` instead of SUPERSEDES. It
// repeats the original's fields so it embeds next to the original and recalls
// with it; resolveHits folds it into the original, which moves the original's
// last-verified date forward and credits the original's author.

import { z } from "zod";

export const CATEGORIES = [
  "CARRIER",
  "PAYMENTS",
  "WALLET",
  "RPC",
  "TOOLING",
  "REGULATORY",
  "EXCHANGE",
  "INFRA",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Categories whose findings rot fast (carrier policy, API behaviour, RPC health). */
export const VOLATILE_BY_DEFAULT: ReadonlySet<Category> = new Set<Category>([
  "CARRIER",
  "PAYMENTS",
  "RPC",
  "EXCHANGE",
]);

/** A volatile finding older than this is flagged for re-verification. */
export const STALE_AFTER_DAYS = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Walrus blob ids are base64url; memory ids must never carry grammar characters.
// The 8-char floor rejects list positions ("2") a model passes instead of an id.
const MEMORY_ID = /^[A-Za-z0-9_-]{8,120}$/;
// What a model sends for an optional string it means to leave empty. These all
// match MEMORY_ID's alphabet, and "SUPERSEDES:null" reached Walrus on 2026-08-27.
const NO_MEMORY_ID = /^(null|none|nil|undefined|n\/a|na|-)?$/i;
// Sui transaction digests: base58, 43-44 characters.
const TX_DIGEST = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** A SUPERSEDES value that can actually name a memory. */
export function isMemoryId(s: string): boolean {
  return MEMORY_ID.test(s) && !NO_MEMORY_ID.test(s);
}

/** Calendar-valid YYYY-MM-DD (rejects 2026-02-30, 2026-13-01, ...). */
export function isValidISODate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const FindingInputSchema = z.object({
  category: z
    .enum(CATEGORIES)
    .describe("CARRIER | PAYMENTS | WALLET | RPC | TOOLING | REGULATORY | EXCHANGE | INFRA"),
  subject: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .describe("Short subject, e.g. 'WalletConnect relay on a mobile carrier'."),
  finding: z
    .string()
    .trim()
    .min(10)
    .max(600)
    .describe("The exact observed behaviour. Preserve error strings, endpoints, versions."),
  fix: z
    .string()
    .trim()
    .max(600)
    .default("none known")
    .describe("The confirmed fix or workaround, or 'none known'."),
  network_or_provider: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .describe("Carrier, bank, API, chain or provider, e.g. 'Vodafone UK', 'Stripe API', 'Sui mainnet'."),
  version_or_app: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe("Version, SDK, app or date context, e.g. 'walletconnect v2', '@mysten/sui 2.26', 'Aug 2026'."),
  verified_on: z
    .string()
    .refine(isValidISODate, "verified_on must be a real YYYY-MM-DD date")
    .refine((d) => d <= todayISO(), "verified_on cannot be in the future")
    .optional()
    .describe("YYYY-MM-DD the user verified it. Omit for today."),
  volatile: z
    .boolean()
    .optional()
    .describe("Override the category default (CARRIER/PAYMENTS/RPC/EXCHANGE are volatile)."),
  reported_by: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe("Handle of the member who verified it. Omit to attribute to this instance's reporter."),
  supersedes_memory_id: z
    .preprocess(
      (v) => (v == null || (typeof v === "string" && NO_MEMORY_ID.test(v.trim())) ? undefined : v),
      z
        .string()
        .trim()
        .regex(MEMORY_ID, "supersedes_memory_id must be a memory id (base64url blob id)")
        .optional(),
    )
    .describe("memory_id of the active finding this one replaces, if any."),
  evidence_tx: z
    .preprocess(
      (v) => (v == null || (typeof v === "string" && NO_MEMORY_ID.test(v.trim())) ? undefined : v),
      z
        .string()
        .trim()
        .regex(TX_DIGEST, "evidence_tx must be a Sui transaction digest")
        .optional(),
    )
    .describe(
      "Digest of a Sui mainnet transaction that shows the issue (e.g. the failed tx). Verified on-chain before storing.",
    ),
});
export type FindingInput = z.infer<typeof FindingInputSchema>;

export interface Finding {
  category: Category;
  subject: string;
  finding: string;
  fix: string;
  verifiedOn: string; // YYYY-MM-DD
  provider: string;
  version: string;
  volatile: boolean;
  reportedBy?: string;
  supersedes?: string;
  /** Set on a confirmation: the memory this re-verifies. */
  confirms?: string;
  /** A mainnet transaction digest that shows the issue; checked on-chain at write time. */
  evidence?: string;
  /**
   * The writer's zkLogin Sui address, from the signed-in session (never the
   * model). Lets trust scores read the writer's on-chain history.
   */
  address?: string;
}

const SEP = " → ";
const FIELD_SEP = " | ";

/** Strip characters that would break the single-line grammar. */
function clean(s: string): string {
  return s.replace(/\s*\n+\s*/g, " ").replace(/→/g, "->").replace(/\|/g, "/").trim();
}

/** Local calendar date of the server, not UTC - "today" must match the user's clock. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Cheap server-side backstop for the prompt's NEVER-store rule. Returns a label
// for the first secret-shaped token found, or null.
// (No bare 64-hex rule: Sui object/package ids are 0x + 64 hex and are
// legitimate content in almost every Sui finding.)
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bsk-(ant-)?[A-Za-z0-9_-]{16,}/, "API key"],
  [/\bsuiprivkey1[a-z0-9]{20,}/i, "Sui private key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  // International (+country code) and Nigerian local (080...) numbers.
  [/(?:^|[^\w+])\+\d{1,3}[ -]?\d{3,4}[ -]?\d{3,4}[ -]?\d{0,4}(?!\d)/, "phone number"],
  [/(?:^|[^\d])0[789][01]\d{8}(?!\d)/, "phone number"],
  [/\b(secret|password|passwd|api[_ -]?key|token)\s*[:=]\s*\S{6,}/i, "credential assignment"],
];

export function looksLikeSecret(text: string): string | null {
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) return label;
  return null;
}

/**
 * The secret gate every write path must pass. Joins the user-writable text
 * fields - INCLUDING network_or_provider, which one path once skipped - and
 * excludes the regex-constrained fields (dates, memory ids) so a legitimate
 * blob id can never false-positive.
 */
export function secretInFinding(
  input: Pick<
    FindingInput,
    "subject" | "finding" | "fix" | "version_or_app" | "network_or_provider"
  >,
): string | null {
  return looksLikeSecret(
    [input.subject, input.finding, input.fix ?? "", input.version_or_app, input.network_or_provider].join(" "),
  );
}

/** Build a Finding from validated tool input, applying defaults. */
export function toFinding(
  input: FindingInput,
  opts: { today?: string; defaultReporter?: string; address?: string } = {},
): Finding {
  const today = opts.today ?? todayISO();
  const out: Finding = {
    category: input.category,
    subject: clean(input.subject),
    finding: clean(input.finding),
    fix: clean(input.fix || "none known"),
    verifiedOn: input.verified_on ?? today,
    provider: clean(input.network_or_provider),
    version: clean(input.version_or_app),
    volatile: input.volatile ?? VOLATILE_BY_DEFAULT.has(input.category),
  };
  const reportedBy = normalizeReporter(input.reported_by || opts.defaultReporter);
  if (reportedBy) out.reportedBy = reportedBy;
  const supersedes = input.supersedes_memory_id?.trim();
  if (supersedes) out.supersedes = supersedes;
  const evidence = input.evidence_tx?.trim();
  if (evidence) out.evidence = evidence;
  if (opts.address) out.address = opts.address.toLowerCase();
  return out;
}

function normalizeReporter(raw?: string): string | undefined {
  if (!raw) return undefined;
  const h = raw.replace(/\s+/g, "").replace(/^@+/, "");
  return h ? `@${h}` : undefined;
}

/** The canonical single-line memory text. */
export function formatFinding(f: Finding): string {
  const tail = [
    f.verifiedOn,
    f.provider,
    f.version,
    `volatile:${f.volatile ? "yes" : "no"}`,
  ];
  if (f.reportedBy) tail.push(`by:${f.reportedBy}`);
  if (f.address) tail.push(`addr:${f.address}`);
  if (f.supersedes) tail.push(`SUPERSEDES:${f.supersedes}`);
  if (f.confirms) tail.push(`CONFIRMS:${f.confirms}`);
  if (f.evidence) tail.push(`EVIDENCE:${f.evidence}`);
  return [
    `[${f.category}] ${f.subject}`,
    f.finding,
    `FIX: ${f.fix}`,
    `VERIFIED: ${tail.join(FIELD_SEP)}`,
  ].join(SEP);
}

/**
 * Parse a canonical line back into a Finding. Returns null for memories that
 * are not in the canonical format (free-text memories still recall fine; the UI
 * just shows them raw).
 */
export function parseFinding(text: string): Finding | null {
  const line = text.trim();
  const head = /^\[([A-Z]+)\]\s*(.*)$/s.exec(line);
  if (!head) return null;
  const category = head[1] as Category;
  if (!CATEGORIES.includes(category)) return null;

  const parts = head[2].split(SEP);
  if (parts.length < 4) return null;
  const subject = parts[0].trim();
  // Everything between the subject and the FIX/VERIFIED tail is the finding
  // (in case a stored line slipped an arrow through).
  // Search from the END: formatFinding always emits exactly one FIX and one
  // VERIFIED part at the tail, while user text (finding/fix) may itself start
  // with those words.
  const verifiedIdx = findLastIndex(parts, (p) => p.startsWith("VERIFIED:"));
  const fixIdx = findLastIndex(parts.slice(0, verifiedIdx), (p) => p.startsWith("FIX:"));
  if (verifiedIdx < 2 || fixIdx < 1) return null;
  const finding = parts.slice(1, fixIdx).join(SEP).trim();
  const fix = parts
    .slice(fixIdx, verifiedIdx)
    .join(SEP)
    .replace(/^FIX:\s*/, "")
    .trim();
  const tail = parts
    .slice(verifiedIdx)
    .join(SEP)
    .replace(/^VERIFIED:\s*/, "")
    .split(FIELD_SEP)
    .map((s) => s.trim());
  if (tail.length < 4) return null;
  const [verifiedOn, provider, version, volatileRaw, ...extras] = tail;
  // Shape alone is not enough: "2026-02-30" matches the regex but is not a
  // date, and daysBetween would score it 0 days old — i.e. "verified today".
  if (!isValidISODate(verifiedOn)) return null;
  const volatileMatch = /^volatile:(yes|no)$/.exec(volatileRaw);
  if (!volatileMatch) return null;

  const out: Finding = {
    category,
    subject,
    finding,
    fix,
    verifiedOn,
    provider,
    version,
    volatile: volatileMatch[1] === "yes",
  };
  for (const extra of extras) {
    if (extra.startsWith("by:")) out.reportedBy = extra.slice(3).trim();
    else if (extra.startsWith("addr:")) {
      const a = extra.slice(5).trim().toLowerCase();
      if (/^0x[0-9a-f]{1,64}$/.test(a)) out.address = a;
    }
    else if (extra.startsWith("SUPERSEDES:")) {
      // Rows stored before the input gate existed carry "SUPERSEDES:null"; a
      // pointer that names nothing is no pointer.
      const id = extra.slice("SUPERSEDES:".length).trim();
      if (isMemoryId(id)) out.supersedes = id;
    } else if (extra.startsWith("EVIDENCE:")) {
      const d = extra.slice("EVIDENCE:".length).trim();
      if (TX_DIGEST.test(d)) out.evidence = d;
    } else if (extra.startsWith("CONFIRMS:")) {
      const id = extra.slice("CONFIRMS:".length).trim();
      if (isMemoryId(id)) out.confirms = id;
    }
  }
  // Sabi never writes both; if a hand-made line does, it is a confirmation.
  if (out.confirms) delete out.supersedes;
  return out;
}

/**
 * The confirmation line for `target`, re-verified by `reporter` on `today`.
 * Copies the target's fields so the line recalls alongside the original.
 */
export function toConfirmation(
  target: Finding,
  targetId: string,
  opts: { reporter: string; today?: string; address?: string },
): Finding {
  const reportedBy = normalizeReporter(opts.reporter);
  return {
    category: target.category,
    subject: target.subject,
    finding: target.finding,
    fix: target.fix,
    verifiedOn: opts.today ?? todayISO(),
    provider: target.provider,
    version: target.version,
    volatile: target.volatile,
    ...(reportedBy ? { reportedBy } : {}),
    ...(opts.address ? { address: opts.address.toLowerCase() } : {}),
    confirms: targetId,
  };
}

/** Same person, whatever the @ and case. */
export function sameHandle(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const n = (h: string) => h.replace(/^@+/, "").toLowerCase();
  return n(a) === n(b);
}

function findLastIndex<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

/**
 * Whole days from `fromISO` to `toISO`. Returns NaN for unparseable input —
 * never 0, which would be indistinguishable from "verified today".
 */
export function daysBetween(fromISO: string, toISO: string): number {
  // Date.parse does NOT reject an overflowing date — "2026-02-30" silently
  // becomes 2026-03-02, which would shift the age by two days. Validate the
  // calendar first so bad input reads as unknown, not as a plausible number.
  if (!isValidISODate(fromISO) || !isValidISODate(toISO)) return Number.NaN;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.floor((b - a) / 86_400_000);
}

/** Volatile + older than STALE_AFTER_DAYS => needs re-verification. */
export function isStale(f: Finding, today: string): boolean {
  const age = daysBetween(f.verifiedOn, today);
  if (Number.isNaN(age)) return false;
  return f.volatile && age > STALE_AFTER_DAYS;
}

/** A second member's re-verification, folded into the finding it confirms. */
export interface Confirmation {
  memory_id: string;
  by?: string;
  on: string; // YYYY-MM-DD
  /** The original author re-verifying their own finding: refreshes the date, earns nothing. */
  self: boolean;
  /** The confirmer's zkLogin address, when they were signed in. */
  address?: string;
}

/** One recalled memory, enriched for the model and the UI. */
export interface RecalledFinding {
  memory_id: string;
  text: string;
  score: number; // 1 - distance, higher is better
  finding: Finding | null;
  stale: boolean;
  age_days: number | null;
  /** Relayer write time (RFC3339), when the relayer reports it. */
  created_at?: string;
  /** Set when another recalled memory names this one in SUPERSEDES. */
  superseded_by?: string;
  /** Re-verifications of this finding, oldest first. */
  confirmations?: Confirmation[];
  /** Newest of verifiedOn and every confirmation date; staleness runs from this. */
  last_verified?: string;
  /** Trust score with its parts, when computed (lib/trust.ts). */
  trust?: import("./trust").Trust;
}

/**
 * Split recalled memories into the ones that are still current and the ones
 * that a newer memory explicitly superseded. Append-only storage means old
 * versions stay on Walrus forever; this is where they stop being "the answer".
 */
export function resolveSupersession(hits: RecalledFinding[]): {
  active: RecalledFinding[];
  superseded: RecalledFinding[];
} {
  const supersededBy = new Map<string, string>();
  for (const h of hits) {
    const target = h.finding?.supersedes;
    if (target) supersededBy.set(target, h.memory_id);
  }
  const active: RecalledFinding[] = [];
  const superseded: RecalledFinding[] = [];
  for (const h of hits) {
    const by = supersededBy.get(h.memory_id);
    if (by) superseded.push({ ...h, superseded_by: by });
    else active.push(h);
  }
  return { active, superseded };
}

/**
 * Fold confirmations into the findings they confirm, then resolve supersession.
 * A confirmation whose target was not recalled stays visible on its own - it is
 * a complete finding line, just with a second verifier's name on it.
 */
export function resolveHits(
  hits: RecalledFinding[],
  today: string,
): { active: RecalledFinding[]; superseded: RecalledFinding[] } {
  const byId = new Map(hits.map((h) => [h.memory_id, { ...h }]));
  const folded = new Set<string>();
  for (const h of hits) {
    const target = h.finding?.confirms ? byId.get(h.finding.confirms) : undefined;
    if (!target?.finding || target.memory_id === h.memory_id) continue;
    const c: Confirmation = {
      memory_id: h.memory_id,
      by: h.finding!.reportedBy,
      on: h.finding!.verifiedOn,
      self: sameHandle(h.finding!.reportedBy, target.finding.reportedBy),
      ...(h.finding!.address ? { address: h.finding!.address } : {}),
    };
    target.confirmations = [...(target.confirmations ?? []), c].sort((a, b) =>
      a.on < b.on ? -1 : a.on > b.on ? 1 : 0,
    );
    folded.add(h.memory_id);
  }
  const rest: RecalledFinding[] = [];
  for (const h of byId.values()) {
    if (folded.has(h.memory_id)) continue;
    if (h.finding && h.confirmations?.length) {
      const last = h.confirmations.reduce(
        (max, c) => (c.on > max ? c.on : max),
        h.finding.verifiedOn,
      );
      h.last_verified = last;
      const age = daysBetween(last, today);
      h.age_days = Number.isNaN(age) ? h.age_days : age;
      h.stale = isStale({ ...h.finding, verifiedOn: last }, today);
    }
    rest.push(h);
  }
  return resolveSupersession(rest);
}

/** Distinct people other than the author who confirmed this finding. */
export function confirmers(hit: RecalledFinding): string[] {
  const out = new Set<string>();
  for (const c of hit.confirmations ?? []) {
    if (!c.self && c.by) out.add(c.by.toLowerCase());
  }
  return [...out];
}

export function enrich(
  memory_id: string,
  text: string,
  distance: number,
  today: string,
  created_at?: string,
): RecalledFinding {
  const finding = parseFinding(text);
  const age = finding ? daysBetween(finding.verifiedOn, today) : Number.NaN;
  return {
    memory_id,
    text,
    score: Math.max(0, Math.min(1, 1 - distance)),
    finding,
    stale: finding ? isStale(finding, today) : false,
    age_days: Number.isNaN(age) ? null : age,
    ...(created_at ? { created_at } : {}),
  };
}
