// The write rules, once. The chat route, the MCP tools and the confirm button
// all call these, so a finding is checked the same way whichever door it
// came through.

import { z } from "zod";
import {
  FindingInputSchema,
  confirmers,
  formatFinding,
  isMemoryId,
  sameHandle,
  secretInFinding,
  toConfirmation,
  toFinding,
  type Finding,
} from "./findings";
import { explainStoreFailure, findMemory, storeFinding } from "./memwal";
import { communityIndex, invalidateCommunity } from "./community";
import { inspectTransaction, tatumEnabled } from "./tatum";
import {
  LEVELS,
  PROTECTED_AFTER_CONFIRMERS,
  findContributor,
  levelRank,
} from "./reputation";

export const RememberInputSchema = FindingInputSchema.omit({ reported_by: true });
export type RememberInput = z.infer<typeof RememberInputSchema>;

export const ConfirmInputSchema = z.object({
  memory_id: z
    .string()
    .trim()
    .refine(isMemoryId, "memory_id must be a memory id returned by recall_findings")
    .describe("memory_id of the ACTIVE finding the user reproduced themselves."),
  subject: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .describe("That finding's subject, exactly as recall returned it (used to look it up)."),
});
export type ConfirmInput = z.infer<typeof ConfirmInputSchema>;

export interface WriteContext {
  reporter: string;
  today: string;
}

export type WriteResult =
  | {
      status: "done" | "pending";
      memory_id?: string;
      job_id?: string;
      namespace: string;
      text: string;
      finding: Finding;
      /** Confirmations only: the original author re-verifying their own finding. */
      self?: boolean;
    }
  | { status: "error"; error: string };

const fail = (error: string): WriteResult => ({ status: "error", error });

export async function rememberAction(input: RememberInput, ctx: WriteContext): Promise<WriteResult> {
  const secret = secretInFinding(input);
  if (secret) {
    return fail(`Refused: the finding looks like it contains a secret (${secret}). Strip it and try again.`);
  }
  const finding = toFinding(input, { today: ctx.today, defaultReporter: ctx.reporter });
  try {
    if (finding.supersedes) {
      const refusal = await checkSupersede(finding, ctx);
      if (refusal) return fail(refusal);
    }
    if (finding.evidence) {
      const refusal = await checkEvidence(finding.evidence);
      if (refusal) return fail(refusal);
    }
    const text = formatFinding(finding);
    const res = await storeFinding(text);
    invalidateCommunity(res.namespace);
    return { ...res, text, finding };
  } catch (err) {
    return fail(await explainStoreFailure(err));
  }
}

/**
 * EVIDENCE is a claim that this transaction exists on mainnet. It goes into
 * append-only storage with a badge, so it is checked on-chain first.
 */
async function checkEvidence(digest: string): Promise<string | null> {
  if (!tatumEnabled()) {
    return "Refused: evidence_tx can't be verified on this instance (no TATUM_API_KEY). Store the finding without it.";
  }
  const tx = await inspectTransaction(digest);
  if (!tx) {
    return `Refused: evidence_tx ${digest} is not a transaction on Sui mainnet. Check the digest, or store the finding without it.`;
  }
  return null;
}

/**
 * A supersede must name a memory that exists (a model once invented
 * "noop0000"), and must not let a newcomer bury a finding other members
 * reproduced. Returns a refusal, or null to go ahead.
 */
async function checkSupersede(finding: Finding, ctx: WriteContext): Promise<string | null> {
  const id = finding.supersedes!;
  const target = await findMemory(id, `${finding.subject} ${finding.finding}`, { today: ctx.today });
  if (!target) {
    return `Refused: supersedes_memory_id ${id} is not a memory in this namespace. Run recall_findings on the subject and pass an id it returned, or omit supersedes_memory_id.`;
  }
  const author = target.finding?.reportedBy;
  if (!author || sameHandle(author, ctx.reporter)) return null;
  const others = confirmers(target).filter((h) => !sameHandle(h, ctx.reporter));
  if (others.length < PROTECTED_AFTER_CONFIRMERS) return null;
  const index = await communityIndex();
  const me = findContributor(index.contributors, ctx.reporter);
  const need = LEVELS.find((l) => l.id === "trusted")!;
  if (me && levelRank(me.level.id) >= levelRank(need.id)) return null;
  return `Refused: ${id} by ${author} has been confirmed by ${others.length} other members, and replacing a confirmed finding needs the "${need.name}" level (${need.rule}). ${ctx.reporter} is ${me?.level.name ?? LEVELS[0].name}. Store the new finding WITHOUT supersedes_memory_id so both show, and tell the user why.`;
}

export async function confirmAction(input: ConfirmInput, ctx: WriteContext): Promise<WriteResult> {
  try {
    let target = await findMemory(input.memory_id, input.subject, { today: ctx.today });
    // Confirming a confirmation means confirming the finding behind it.
    if (target?.finding?.confirms) {
      target = await findMemory(target.finding.confirms, input.subject, { today: ctx.today });
    }
    if (!target) {
      return fail(`Refused: ${input.memory_id} is not a memory in this namespace. Recall it first and pass the id it returned.`);
    }
    if (!target.finding) {
      return fail("Refused: that memory is free text, not a canonical finding, so it cannot be confirmed.");
    }
    if (target.superseded_by) {
      return fail(`Refused: that finding was replaced by ${target.superseded_by}. Confirm the current one instead.`);
    }
    const finding = toConfirmation(target.finding, target.memory_id, {
      reporter: ctx.reporter,
      today: ctx.today,
    });
    const text = formatFinding(finding);
    // Same member, same finding, same day: one confirmation however often it is clicked.
    const res = await storeFinding(text);
    invalidateCommunity(res.namespace);
    return { ...res, text, finding, self: sameHandle(target.finding.reportedBy, ctx.reporter) };
  } catch (err) {
    return fail(await explainStoreFailure(err));
  }
}
