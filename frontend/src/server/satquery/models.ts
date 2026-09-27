import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

interface RemoteResponse {
  status: number;
  body: Buffer;
}

function requestRemote(
  urlString: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: Buffer;
    timeoutMs: number;
  },
): Promise<RemoteResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const headers = { ...options.headers };
    if (options.body && headers["content-length"] == null) {
      headers["content-length"] = String(options.body.length);
    }

    const req = request(
      url,
      { method: options.method ?? "GET", headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          clearTimeout(timer);
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    const timer = setTimeout(() => {
      req.destroy(
        new Error(
          `Request to ${url.host} timed out after ${options.timeoutMs}ms.`,
        ),
      );
    }, options.timeoutMs);

    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

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

function unavailableWeights(modelName: string): {
  available: boolean;
  reason: string;
} {
  return {
    available: false,
    reason:
      `${modelName} weights are not provisioned in this environment (no GPU/model-server configured). ` +
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
      const response = await requestRemote(`${endpoint}/health`, {
        timeoutMs: 30_000,
      });
      if (response.status < 200 || response.status >= 300) {
        return {
          available: false,
          reason: `RSCoVLM health returned HTTP ${response.status}.`,
        };
      }
      const data = JSON.parse(response.body.toString("utf8")) as {
        model_loaded?: boolean;
        gpu?: boolean;
      };
      if (data.model_loaded && data.gpu) return { available: true };
      return {
        available: false,
        reason: "RSCoVLM endpoint is reachable but the model/GPU is not ready.",
      };
    } catch (error) {
      return {
        available: false,
        reason: `RSCoVLM endpoint unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  metadata() {
    return {
      params: "7B",
      inference: "remote EC2 NVIDIA A10G",
      endpoint: process.env.RSCOVLM_ENDPOINT ?? null,
    };
  },
};

export async function predictRsCoVLM(
  imagePath: string,
  question: string,
  task: string,
) {
  const endpoint = process.env.RSCOVLM_ENDPOINT?.replace(/\/+$/, "");
  if (!endpoint) throw new Error("RSCOVLM_ENDPOINT is not configured.");
  const image = (await readFile(imagePath)).toString("base64");
  const body = Buffer.from(
    JSON.stringify({
      image,
      filename: imagePath.split("/").pop() ?? "image",
      question,
      task,
    }),
  );
  const response = await requestRemote(`${endpoint}/predict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    timeoutMs: 10 * 60 * 1000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `RSCoVLM prediction failed with HTTP ${response.status}: ${response.body.toString("utf8")}`,
    );
  }
  const data = JSON.parse(response.body.toString("utf8")) as {
    answer?: string;
    model?: string;
    facts?: unknown[];
  };
  return {
    answer: data.answer ?? "",
    model: data.model ?? "RSCoVLM-7B",
    facts: data.facts ?? [],
  };
}

export const TerraMind: ModelWrapper = {
  name: "TerraMind-v1-base",
  role: "single-image land-use / land-cover mask generation",
  async load() {},
  async healthCheck() {
    const endpoint = process.env.TERRAMIND_ENDPOINT?.replace(/\/+$/, "");
    if (!endpoint) return unavailableWeights("TerraMind-v1-base");
    try {
      const response = await requestRemote(`${endpoint}/health`, {
        timeoutMs: 30_000,
      });
      if (response.status < 200 || response.status >= 300) {
        return {
          available: false,
          reason: `TerraMind health returned HTTP ${response.status}.`,
        };
      }
      const data = JSON.parse(response.body.toString("utf8")) as {
        status?: string;
        device?: string;
      };
      if (data.status === "ok" && data.device === "cuda")
        return { available: true };
      return {
        available: false,
        reason:
          "TerraMind endpoint is reachable but the model/GPU is not ready.",
      };
    } catch (error) {
      return {
        available: false,
        reason: `TerraMind endpoint unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  metadata() {
    return {
      model: "TerraMind-v1-base",
      inputModality: "untok_sen2rgb@224",
      outputModality: "tok_lulc@224",
      inference: "remote EC2 NVIDIA A10G",
      endpoint: process.env.TERRAMIND_ENDPOINT ?? null,
    };
  },
};

export async function predictTerraMind(imagePath: string) {
  const endpoint = process.env.TERRAMIND_ENDPOINT?.replace(/\/+$/, "");
  if (!endpoint) throw new Error("TERRAMIND_ENDPOINT is not configured.");
  const image = await readFile(imagePath);
  const response = await requestRemote(`${endpoint}/predict`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: image,
    timeoutMs: 10 * 60 * 1000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `TerraMind prediction failed with HTTP ${response.status}: ${response.body.toString("utf8")}`,
    );
  }
  const data = JSON.parse(response.body.toString("utf8")) as {
    model?: string;
    input_shape?: number[];
    output_shape?: number[];
    output_min?: number;
    output_max?: number;
    output_mean?: number;
    mask_is_provisional?: boolean;
    mask_png_base64?: string;
  };
  if (!data.mask_png_base64)
    throw new Error("TerraMind response did not include a LULC mask.");
  return {
    model: data.model ?? "TerraMind-v1-base",
    inputShape: data.input_shape ?? [],
    outputShape: data.output_shape ?? [],
    outputMin: data.output_min ?? null,
    outputMax: data.output_max ?? null,
    outputMean: data.output_mean ?? null,
    maskIsProvisional: data.mask_is_provisional ?? true,
    maskPng: Buffer.from(data.mask_png_base64, "base64"),
  };
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

function qwenManagerEndpoint(): string | null {
  const endpoint =
    process.env.QWEN_MANAGER_ENDPOINT ?? process.env.QWEN3VL_ENDPOINT;
  return endpoint?.replace(/\/+$/, "") ?? null;
}

async function requestQwenManager<T>(
  path: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const endpoint = qwenManagerEndpoint();
  if (!endpoint) throw new Error("QWEN_MANAGER_ENDPOINT is not configured.");
  const body = Buffer.from(JSON.stringify(payload));
  const response = await requestRemote(`${endpoint}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    timeoutMs,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Qwen manager ${path} failed with HTTP ${response.status}: ${response.body.toString("utf8")}`,
    );
  }
  return JSON.parse(response.body.toString("utf8")) as T;
}

export interface QwenPlanPrediction {
  task: string;
  target: string | null;
  route_enforced: boolean;
  planner_raw: Record<string, unknown>;
  model: string;
}

export interface QwenChangePrediction {
  model: string;
  output: {
    summary?: string;
    major_changes?: string | string[];
    possible_flood_change?: string;
    confidence?: number;
    limitations?: string;
  };
  runtime?: Record<string, unknown>;
}

export async function predictQwenPlan(
  query: string,
  mode: string,
): Promise<QwenPlanPrediction> {
  return requestQwenManager<QwenPlanPrediction>(
    "/v1/plan",
    { query, mode },
    5 * 60 * 1000,
  );
}

export async function predictQwenChange(
  t1Path: string,
  t2Path: string,
  prompt: string,
): Promise<QwenChangePrediction> {
  return requestQwenManager<QwenChangePrediction>(
    "/v1/change",
    { t1_path: t1Path, t2_path: t2Path, prompt },
    15 * 60 * 1000,
  );
}

export async function synthesizeWithQwen(
  query: string,
  groundedAnswer: string,
  facts: unknown[],
): Promise<string> {
  const response = await requestQwenManager<{ text?: string }>(
    "/v1/synthesize",
    { query, grounded_answer: groundedAnswer, facts },
    5 * 60 * 1000,
  );
  if (!response.text?.trim())
    throw new Error("Qwen synthesis returned an empty response.");
  return response.text.trim();
}

export const Qwen3VL: ModelWrapper = {
  name: "Qwen3-VL-8B",
  role: "bi-temporal visual change reasoning",
  async load() {},
  async healthCheck() {
    const endpoint = qwenManagerEndpoint();
    if (!endpoint) return unavailableWeights("Qwen3-VL-8B");
    try {
      const response = await requestRemote(`${endpoint}/health`, {
        timeoutMs: 10_000,
      });
      if (response.status < 200 || response.status >= 300) {
        return {
          available: false,
          reason: `Qwen manager health returned HTTP ${response.status}.`,
        };
      }
      const data = JSON.parse(response.body.toString("utf8")) as {
        ok?: boolean;
        files?: { qwen3_vl?: boolean; qwen3_vl_mmproj?: boolean };
      };
      if (data.ok && data.files?.qwen3_vl && data.files.qwen3_vl_mmproj)
        return { available: true };
      return {
        available: false,
        reason: "Qwen manager is reachable but model files are not ready.",
      };
    } catch (error) {
      return {
        available: false,
        reason: `Qwen manager unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  metadata() {
    return {
      params: "8B",
      role: "change-vqa language reasoning",
      endpoint: qwenManagerEndpoint(),
      inference: "on-demand EC2 NVIDIA A10G",
    };
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
    return {
      method:
        "explicit weighted fusion of optical spectral index + SAR backscatter proxy",
    };
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
    return {
      method:
        "deterministic spectral-index thresholding + connected-component analysis",
    };
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
    return {
      method:
        "Otsu-thresholded pixel-difference + connected-component analysis",
    };
  },
};

export const ALL_MODELS: ModelWrapper[] = [
  RSCoVLM,
  TerraMind,
  CROMA,
  Qwen3VL,
  RuleBasedFusion,
  PixelChangeDetector,
  RuleBasedRasterAnalyzer,
];
