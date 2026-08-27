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
const MEMORY_ID = /^[A-Za-z0-9_-]{1,120}$/;

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
    .describe("Short subject, e.g. 'WalletConnect relay on MTN 4G'."),
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
    .describe("Carrier, bank, API, chain or provider, e.g. 'MTN NG', 'OPay API', 'Sui mainnet'."),
  version_or_app: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe("Version, SDK, app or date context, e.g. 'walletconnect v2', 'OPay API v3', 'Aug 2026'."),
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
    .string()
    .trim()
    .regex(MEMORY_ID, "supersedes_memory_id must be a memory id (base64url blob id)")
    .optional()
    .describe("memory_id of the active finding this one replaces, if any."),
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
}

const SEP = " → ";
const FIELD_SEP = " | ";

/** Strip characters that would break the single-line grammar. */
function clean(s: string): string {
  return s.replace(/\s*\n+\s*/g, " ").replace(/→/g, "->").replace(/\|/g, "/").trim();
}

/** Local calendar date (WAT in Lagos), not UTC - "today" must match the user's clock. */
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
  [/(?:^|[^\d])(?:\+?234|0)[789][01]\d{8}(?!\d)/, "Nigerian phone number"],
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
  opts: { today?: string; defaultReporter?: string } = {},
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
  if (f.supersedes) tail.push(`SUPERSEDES:${f.supersedes}`);
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
    else if (extra.startsWith("SUPERSEDES:"))
      out.supersedes = extra.slice("SUPERSEDES:".length).trim();
  }
  return out;
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

/** One recalled memory, enriched for the model and the UI. */
export interface RecalledFinding {
  memory_id: string;
  text: string;
  score: number; // 1 - distance, higher is better
  finding: Finding | null;
  stale: boolean;
  age_days: number | null;
  /** Set when another recalled memory names this one in SUPERSEDES. */
  superseded_by?: string;
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

export function enrich(
  memory_id: string,
  text: string,
  distance: number,
  today: string,
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
  };
}
