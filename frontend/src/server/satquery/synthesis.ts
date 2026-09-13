// LLM synthesis layer (backend/synthesis/llm_synthesizer.py).
//
// CRITICAL RULE: the synthesizer may only restate facts that are already
// present in the grounded template answer / evidence facts produced by the
// GIS + evidence layers. If an optional LLM polishing pass introduces any
// numeric value that cannot be matched back to the evidence, its output is
// discarded and the deterministic grounded template is used instead.
import type { ConfidenceBreakdown, EvidenceFact } from "./types";

function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+(\.\d+)?/g) ?? [];
  return matches.map(Number);
}

function numbersAreGrounded(candidateNumbers: number[], groundedNumbers: number[], tolerance = 0.05): boolean {
  for (const n of candidateNumbers) {
    const ok = groundedNumbers.some((g) => Math.abs(g - n) <= Math.max(tolerance, Math.abs(g) * 0.02));
    if (!ok) return false;
  }
  return true;
}

async function llmPolish(query: string, groundedAnswer: string, facts: EvidenceFact[]): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You rewrite a grounded remote-sensing analysis result into one clear, natural paragraph for a non-technical user. " +
              "You MUST NOT invent, add, or change any number, coordinate, unit, or fact. " +
              "Only rephrase the wording of the facts given to you. If unsure, copy the numbers verbatim.",
          },
          {
            role: "user",
            content: `User question: "${query}"\n\nGrounded facts (JSON): ${JSON.stringify(facts)}\n\nGrounded draft answer: "${groundedAnswer}"\n\nRewrite the draft answer naturally, preserving every number exactly.`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export async function synthesizeAnswer(
  query: string,
  groundedAnswer: string,
  facts: EvidenceFact[],
  confidence: ConfidenceBreakdown,
  warnings: string[],
): Promise<string> {
  const groundedNumbers = [
    ...extractNumbers(groundedAnswer),
    ...facts.flatMap((f) => (typeof f.value === "number" ? [f.value] : extractNumbers(String(f.value ?? "")))),
  ];

  let finalAnswer = groundedAnswer;

  const polished = await llmPolish(query, groundedAnswer, facts);
  if (polished) {
    const candidateNumbers = extractNumbers(polished);
    if (numbersAreGrounded(candidateNumbers, groundedNumbers)) {
      finalAnswer = polished.trim();
    }
    // else: silently keep the deterministic grounded answer.
  }

  finalAnswer += ` (Confidence estimate: ${(confidence.confidenceEstimate * 100).toFixed(0)}% — a heuristic estimate, not a calibrated probability.)`;
  if (warnings.length > 0) {
    finalAnswer += ` Note: ${warnings.length} validation warning(s) were recorded during this analysis — see the execution trace for details.`;
  }
  return finalAnswer;
}
