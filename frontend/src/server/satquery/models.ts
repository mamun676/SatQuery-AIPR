import { readFile } from "node:fs/promises";

// Model wrappers (backend/models/rscovlm.py, croma.py, qwen3_vl.py).
//
// INTEGRATION BOUNDARY: this sandbox has no GPU and no pretrained
// remote-sensing model weights (RSCoVLM-7B, CROMA, Qwen3-VL). Every wrapper
// below implements the same `ModelWrapper` interface the rest of the system
// depends on (load/predict/healthCheck/metadata) so that a real deployment
// can drop in actual weights/inference calls without touching the
// controller, tools, or API layer. `healthCheck()` honestly reports
// unavailability here; the agentic controller reacts to that by using the
// configured rule-based fallback (see registry.ts / tools.ts) instead of
// pretending the model ran.
export interface ModelWrapper {
  name: string;
  role: string;
  load(): Promise<void>;
  healthCheck(): Promise<{ available: boolean; reason?: string }>;
  metadata(): Record<string, unknown>;
}

function unavailableWeights(modelName: string): { available: boolean; reason: string } {
  return {
    available: false,
    reason: `${modelName} weights are not provisioned in this environment (no GPU/model-server configured). ` +
      `Set MODEL_SERVER_URL / provide local weights to enable real inference.`,
  };
}

export const RSCoVLM: ModelWrapper = {
  name: "RSCoVLM-7B",
  role: "single-image VQA / captioning / grounding",
  async load() {},
  async healthCheck() {
    const endpoint = process.env.RSCOVLM_ENDPOINT?.replace(/\/+$/, "");
    if (!endpoint) return unavailableWeights("RSCoVLM-7B");
    try {
      const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return { available: false, reason: `RSCoVLM health returned HTTP ${response.status}.` };
      const data = (await response.json()) as { model_loaded?: boolean; gpu?: boolean };
      if (data.model_loaded && data.gpu) return { available: true };
      return { available: false, reason: "RSCoVLM endpoint is reachable but the model/GPU is not ready." };
    } catch (error) {
      return { available: false, reason: `RSCoVLM endpoint unavailable: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
  metadata() {
    return { params: "7B", inference: "remote EC2 NVIDIA A10G", endpoint: process.env.RSCOVLM_ENDPOINT ?? null };
  },
};

export async function predictRsCoVLM(imagePath: string, question: string, task: string) {
  const endpoint = process.env.RSCOVLM_ENDPOINT?.replace(/\/+$/, "");
  if (!endpoint) throw new Error("RSCOVLM_ENDPOINT is not configured.");
  const image = (await readFile(imagePath)).toString("base64");
  const response = await fetch(`${endpoint}/predict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, filename: imagePath.split("/").pop() ?? "image", question, task }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`RSCoVLM prediction failed with HTTP ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as { answer?: string; model?: string; facts?: unknown[] };
  return { answer: data.answer ?? "", model: data.model ?? "RSCoVLM-7B", facts: data.facts ?? [] };
}

export const CROMA: ModelWrapper = {
  name: "CROMA",
  role: "optical-SAR joint representation / fusion backbone",
  async load() {},
  async healthCheck() {
    if (process.env.CROMA_ENDPOINT) {
      return { available: true };
    }
    return unavailableWeights("CROMA");
  },
  metadata() {
    return { modality: "optical+SAR", output: "joint embedding" };
  },
};

export const Qwen3VL: ModelWrapper = {
  name: "Qwen3-VL-8B",
  role: "bi-temporal change reasoning / language synthesis",
  async load() {},
  async healthCheck() {
    if (process.env.QWEN3VL_ENDPOINT || process.env.OPENAI_API_KEY) {
      return { available: Boolean(process.env.QWEN3VL_ENDPOINT) };
    }
    return unavailableWeights("Qwen3-VL-8B");
  },
  metadata() {
    return { params: "8B", role: "change-vqa language reasoning" };
  },
};

export const RuleBasedFusion: ModelWrapper = {
  name: "rule_based_fusion",
  role: "optical+SAR fallback fusion",
  async load() {},
  async healthCheck() {
    return { available: true };
  },
  metadata() {
    return { method: "explicit weighted fusion of optical spectral index + SAR backscatter proxy" };
  },
};

export const RuleBasedRasterAnalyzer: ModelWrapper = {
  name: "rule_based_raster_analyzer",
  role: "single-image VQA/caption/grounding fallback",
  async load() {},
  async healthCheck() {
    return { available: true };
  },
  metadata() {
    return { method: "deterministic spectral-index thresholding + connected-component analysis" };
  },
};

export const PixelChangeDetector: ModelWrapper = {
  name: "pixel_change_detector",
  role: "bi-temporal spatial change evidence",
  async load() {},
  async healthCheck() {
    return { available: true };
  },
  metadata() {
    return { method: "Otsu-thresholded pixel-difference + connected-component analysis" };
  },
};

export const ALL_MODELS: ModelWrapper[] = [RSCoVLM, CROMA, Qwen3VL, RuleBasedFusion, PixelChangeDetector, RuleBasedRasterAnalyzer];
