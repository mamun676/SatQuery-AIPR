// Query understanding — translates natural language into a structured,
// validated intent (backend/query_understanding/router.py + prompts.py).
//
// Deterministic rules handle the obvious cases. An optional LLM-assisted
// path (used only when OPENAI_API_KEY is configured) helps with ambiguous
// phrasing, but its output is always validated against the fixed task
// vocabulary below — the model can never invent an unsupported workflow.
import type { InputMode, QueryIntent, TaskType } from "./types";

const TASK_VOCAB: TaskType[] = ["vqa", "caption", "grounding", "change_vqa", "optical_sar"];

const TARGET_KEYWORDS: Record<string, string[]> = {
  water: ["water", "flood", "river", "lake", "reservoir", "wet"],
  built_up: ["built-up", "built up", "urban", "building", "buildings", "settlement", "infrastructure"],
  vegetation: ["vegetation", "forest", "tree", "trees", "crop", "crops", "agricult", "green cover"],
  road: ["road", "roads", "highway"],
  bare_soil: ["bare soil", "barren"],
  cloud: ["cloud", "clouds"],
};

function extractTarget(query: string): string | null {
  const lower = query.toLowerCase();
  for (const [target, keywords] of Object.entries(TARGET_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return target;
  }
  return null;
}

function ruleBasedTask(query: string, mode: InputMode | null): TaskType {
  const lower = query.toLowerCase();

  const changeWords = ["change", "changed", "increase", "increased", "decrease", "decreased", "compare", "difference", "between these", "over time"];
  const opticalSarWords = ["sar", "radar", "backscatter", "fuse", "fusion", "optical and sar", "sentinel-1"];
  const captionWords = ["describe", "caption", "summary", "summarize", "what is in this image", "what does this image show"];
  const groundingWords = ["locate", "find the", "where is", "where are", "bounding box", "detect the", "point out", "highlight the"];

  if (mode === "bitemporal" && changeWords.some((w) => lower.includes(w))) return "change_vqa";
  if (changeWords.some((w) => lower.includes(w)) && mode !== "optical_sar") return "change_vqa";
  if (mode === "optical_sar" || opticalSarWords.some((w) => lower.includes(w))) return "optical_sar";
  if (captionWords.some((w) => lower.includes(w))) return "caption";
  if (groundingWords.some((w) => lower.includes(w))) return "grounding";
  return "vqa";
}

/** Ensure the classified task is actually valid for the given input mode. */
function coerceForMode(task: TaskType, mode: InputMode | null): { task: TaskType; coerced: boolean; reason: string | null } {
  if (mode === "bitemporal" && task !== "change_vqa") {
    return { task: "change_vqa", coerced: true, reason: `Task "${task}" is not supported for bi-temporal input; coerced to "change_vqa".` };
  }
  if (mode === "optical_sar" && task !== "optical_sar") {
    return { task: "optical_sar", coerced: true, reason: `Task "${task}" is not supported for optical+SAR input; coerced to "optical_sar".` };
  }
  if (mode === "single_image" && (task === "change_vqa" || task === "optical_sar")) {
    return { task: "vqa", coerced: true, reason: `Task "${task}" requires two images; coerced to "vqa" for single-image input.` };
  }
  return { task, coerced: false, reason: null };
}

export interface LlmIntentClassifier {
  (query: string, mode: InputMode | null): Promise<{ task: string; target: string | null } | null>;
}

/**
 * Optional LLM-assisted classification. Only invoked when an OPENAI_API_KEY
 * is configured; falls back silently to null (i.e. rule-based wins) on any
 * error so query understanding always degrades gracefully.
 */
export const llmAssistClassify: LlmIntentClassifier = async (query, mode) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `You classify remote-sensing questions into a fixed vocabulary. ` +
              `Respond with strict JSON: {"task": one of ${JSON.stringify(TASK_VOCAB)}, "target": short lowercase noun phrase or null}. ` +
              `Input mode is "${mode}". Never invent a task outside the given vocabulary.`,
          },
          { role: "user", content: query },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (!TASK_VOCAB.includes(parsed.task)) return null;
    return { task: parsed.task, target: parsed.target ?? null };
  } catch {
    return null;
  }
};

export async function classifyIntent(query: string, mode: InputMode | null): Promise<QueryIntent> {
  const trimmed = query.trim();
  const ruleTask = ruleBasedTask(trimmed, mode);
  const ruleTarget = extractTarget(trimmed);

  let task: TaskType = ruleTask;
  let target = ruleTarget;
  let method: QueryIntent["method"] = "rule-based";

  // Only defer to the LLM for the ambiguous default case (plain "vqa" with
  // no clear keyword match) — obvious cases stay fully deterministic.
  if (ruleTask === "vqa" && !ruleTarget) {
    const llmResult = await llmAssistClassify(trimmed, mode);
    if (llmResult) {
      task = llmResult.task as TaskType;
      target = llmResult.target;
      method = "llm-assisted";
    }
  }

  const { task: finalTask, coerced, reason } = coerceForMode(task, mode);

  return {
    task: finalTask,
    target,
    method,
    rawQuery: query,
    coerced,
    coercionReason: reason,
  };
}
