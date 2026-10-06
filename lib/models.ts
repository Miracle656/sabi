// The model switcher registry. "Different model. Same memory." - every entry
// reads and writes the same Walrus Memory namespace through the same two tools.

export type Provider = "anthropic" | "openai" | "groq";

export interface ModelOption {
  id: string;
  label: string;
  provider: Provider;
}

export const CLAUDE_MODELS: ModelOption[] = [
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
];

export const DEFAULT_MODEL_ID = CLAUDE_MODELS[0].id;

/**
 * OPENAI_MODEL / GROQ_MODEL are comma-separated lists so the switcher still has
 * something to switch BETWEEN when one provider is the only one configured -
 * "different model, same memory" is the whole demo, and it needs at least two
 * entries.
 */
export function modelIds(spec: string): string[] {
  const seen = new Set<string>();
  for (const raw of spec.split(",")) {
    const id = raw.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

export function openaiOptions(spec: string): ModelOption[] {
  return modelIds(spec).map((id) => ({
    id,
    label: prettyOpenAI(id),
    provider: "openai" as const,
  }));
}

/** Groq ids are `vendor/model` or bare; the label keeps the model and says where it runs. */
export function groqOptions(spec: string): ModelOption[] {
  return modelIds(spec).map((id) => ({
    id,
    label: `${id.slice(id.lastIndexOf("/") + 1)} · Groq`,
    provider: "groq" as const,
  }));
}

export function isClaudeModel(id: string): boolean {
  return CLAUDE_MODELS.some((m) => m.id === id);
}

function prettyOpenAI(id: string): string {
  return id
    .replace(/^gpt-/, "GPT-")
    .replace(/-mini$/, " mini")
    .replace(/-nano$/, " nano");
}

/** Models that can actually run given which keys are configured. */
export function availableModels(keys: {
  anthropic: boolean;
  openai: boolean;
  openaiModels: string;
  groq: boolean;
  groqModels: string;
}): ModelOption[] {
  const out: ModelOption[] = [];
  if (keys.anthropic) out.push(...CLAUDE_MODELS);
  if (keys.openai) out.push(...openaiOptions(keys.openaiModels));
  if (keys.groq) out.push(...groqOptions(keys.groqModels));
  return out;
}
