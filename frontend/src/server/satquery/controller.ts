// Agentic controller (backend/agent/controller.py) — the central
// orchestration state machine. It receives validated input + structured
// intent, selects a workflow/model from the registry, executes the
// corresponding tool, and records an observable trace at every stage.
import { promises as fs } from "fs";
import { classifyIntent } from "./queryUnderstanding";
import { resolveRegistry, validateParameters } from "./registry";
import { readRaster, type RasterData } from "./gis";
import { runCaptionTool, runChangeTool, runGroundingTool, runOpticalSarTool, runVqaTool, type ToolOutput } from "./tools";
import { predictRsCoVLM, RSCoVLM } from "./models";
import { TraceLogger } from "./trace";
import type { InputMode, ModelUsed, QueryIntent, UploadedFileMeta } from "./types";

export interface ControllerInput {
  query: string;
  mode: InputMode;
  files: UploadedFileMeta[];
}

export interface ControllerOutput {
  intent: QueryIntent;
  workflow: string;
  modelsUsed: ModelUsed[];
  parameters: Record<string, unknown>;
  toolOutput: ToolOutput;
  usedFallback: boolean;
}

async function loadRaster(file: UploadedFileMeta): Promise<RasterData> {
  const buffer = await fs.readFile(file.storedPath);
  const format = file.format === "unknown" ? "PNG" : file.format;
  return readRaster(buffer, format);
}

function fileByRole(files: UploadedFileMeta[], roles: string[]): UploadedFileMeta | undefined {
  return files.find((f) => roles.includes(f.role));
}

export async function orchestrate(input: ControllerInput, trace: TraceLogger): Promise<ControllerOutput> {
  trace.log("query_understanding", "Classifying natural-language query into a structured intent", {
    query: input.query,
    mode: input.mode,
  });
  const intent = await classifyIntent(input.query, input.mode);
  trace.log("query_understanding", `Resolved task="${intent.task}" target="${intent.target ?? "none"}" via ${intent.method}`, {
    intent,
  });
  if (intent.coerced) {
    trace.log("query_understanding", `Coerced task for input mode: ${intent.coercionReason}`, {});
  }

  const entry = resolveRegistry(intent.task);
  trace.log("routing", `Selected workflow/tool "${entry.tool}" for task "${entry.task}"`, { tool: entry.tool });

  const parameters: Record<string, unknown> = intent.target ? { target: intent.target } : {};
  const paramWarnings = validateParameters(intent.task, parameters);
  paramWarnings.forEach((w) => trace.log("routing", w, {}));

  const modelsUsed: ModelUsed[] = [];
  let usedFallback = false;

  const primaryHealth = await entry.primary.healthCheck();
  if (primaryHealth.available) {
    modelsUsed.push({ name: entry.primary.name, role: entry.primary.role, status: "used" });
    trace.log("model_selection", `Primary model "${entry.primary.name}" is available.`, {});
  } else {
    modelsUsed.push({ name: entry.primary.name, role: entry.primary.role, status: "unavailable", reason: primaryHealth.reason });
    trace.log("model_selection", `Primary model "${entry.primary.name}" unavailable: ${primaryHealth.reason}`, {});
    usedFallback = true;
    if (entry.fallback) {
      modelsUsed.push({ name: entry.fallback.name, role: entry.fallback.role, status: "fallback_used" });
      trace.log("fallback", `Falling back to configured fallback "${entry.fallback.name}" per registry policy.`, {});
    } else {
      trace.log("fallback", "No fallback configured for this task; request would fail without a rule-based tool implementation.", {});
    }
  }

  trace.log("execution", `Executing tool "${entry.tool}"`, { parameters });

  let toolOutput: ToolOutput;
  const target = (parameters.target as string | undefined) ?? null;

  switch (intent.task) {
    case "vqa": {
      const file = input.files[0];
      const raster = await loadRaster(file);
      toolOutput = runVqaTool(raster, input.query, target);
      break;
    }
    case "caption": {
      const file = input.files[0];
      const raster = await loadRaster(file);
      toolOutput = runCaptionTool(raster);
      break;
    }
    case "grounding": {
      const file = input.files[0];
      const raster = await loadRaster(file);
      toolOutput = runGroundingTool(raster, target ?? "built_up");
      break;
    }
    case "change_vqa": {
      const t1File = fileByRole(input.files, ["t1"]) ?? input.files[0];
      const t2File = fileByRole(input.files, ["t2"]) ?? input.files[1];
      const [t1, t2] = await Promise.all([loadRaster(t1File), loadRaster(t2File)]);
      toolOutput = runChangeTool(t1, t2, target);
      break;
    }
    case "optical_sar": {
      const opticalFile = fileByRole(input.files, ["optical"]) ?? input.files.find((f) => f.modality !== "sar") ?? input.files[0];
      const sarFile = fileByRole(input.files, ["sar"]) ?? input.files.find((f) => f.modality === "sar") ?? input.files[1];
      const [optical, sar] = await Promise.all([loadRaster(opticalFile), loadRaster(sarFile)]);
      toolOutput = runOpticalSarTool(optical, sar, target);
      break;
    }
    default:
      throw new Error(`Unhandled task type: ${intent.task}`);
  }

  // Keep the deterministic GIS evidence, overlays, and statistics, but replace
  // the user-facing language answer with the real EC2 GPU model response for
  // single-image tasks when RSCoVLM health succeeded above.
  if (!usedFallback && entry.primary === RSCoVLM && ["vqa", "caption", "grounding"].includes(intent.task)) {
    try {
      const file = input.files[0];
      const question = intent.task === "caption"
        ? input.query || "Describe this satellite image."
        : intent.task === "grounding"
          ? `Locate ${target ?? "the main target"} in this satellite image.`
          : input.query;
      const remote = await predictRsCoVLM(file.storedPath, question, intent.task);
      toolOutput = { ...toolOutput, answer: remote.answer || toolOutput.answer, modelProbability: 0.95 };
      trace.log("execution", `Remote RSCoVLM prediction completed on EC2 (${remote.model}).`, {});
    } catch (error) {
      usedFallback = true;
      trace.log("fallback", `Remote RSCoVLM prediction failed; retaining deterministic evidence answer: ${error instanceof Error ? error.message : String(error)}`, {});
    }
  }

  trace.log("execution", `Tool "${entry.tool}" completed successfully.`, {
    factCount: toolOutput.facts.length,
    toolAgreement: toolOutput.toolAgreement,
    modelProbability: toolOutput.modelProbability,
  });

  return { intent, workflow: entry.tool, modelsUsed, parameters, toolOutput, usedFallback };
}
