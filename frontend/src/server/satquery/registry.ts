// Model/tool registry (backend/agent/registry.py), YAML-driven in the
// reference Python backend (see backend/config/models.yaml). The TS
// equivalent below is the source of truth actually consulted by the Next.js
// runtime; keep the two in sync when changing routing policy.
import type { TaskType } from "./types";
import { CROMA, PixelChangeDetector, Qwen3VL, RSCoVLM, RuleBasedFusion, RuleBasedRasterAnalyzer, type ModelWrapper } from "./models";

export interface RegistryEntry {
  task: TaskType;
  tool: string;
  primary: ModelWrapper;
  fallback: ModelWrapper | null;
  allowedParameters: string[];
}

const REGISTRY: Record<TaskType, RegistryEntry> = {
  vqa: {
    task: "vqa",
    tool: "vqa_tool",
    primary: RSCoVLM,
    fallback: RuleBasedRasterAnalyzer,
    allowedParameters: ["target"],
  },
  caption: {
    task: "caption",
    tool: "caption_tool",
    primary: RSCoVLM,
    fallback: RuleBasedRasterAnalyzer,
    allowedParameters: [],
  },
  grounding: {
    task: "grounding",
    tool: "grounding_tool",
    primary: RSCoVLM,
    fallback: RuleBasedRasterAnalyzer,
    allowedParameters: ["target"],
  },
  change_vqa: {
    task: "change_vqa",
    tool: "change_tool",
    primary: Qwen3VL,
    fallback: PixelChangeDetector,
    allowedParameters: ["target"],
  },
  optical_sar: {
    task: "optical_sar",
    tool: "optical_sar_tool",
    primary: CROMA,
    fallback: RuleBasedFusion,
    allowedParameters: ["target"],
  },
};

export function resolveRegistry(task: TaskType): RegistryEntry {
  const entry = REGISTRY[task];
  if (!entry) {
    throw new Error(`No registry entry configured for task "${task}"`);
  }
  return entry;
}

export function validateParameters(task: TaskType, parameters: Record<string, unknown>): string[] {
  const entry = resolveRegistry(task);
  const warnings: string[] = [];
  for (const key of Object.keys(parameters)) {
    if (!entry.allowedParameters.includes(key)) {
      warnings.push(`Parameter "${key}" is not recognized for task "${task}" and was ignored.`);
    }
  }
  return warnings;
}
