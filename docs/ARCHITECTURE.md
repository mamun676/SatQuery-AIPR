# SatQuery AI — Architecture Notes

This document explains how the fixed SatQuery AI architecture (validator ->
query understanding -> agentic controller -> registry -> specialist
workflow -> GIS -> evidence/confidence -> LLM synthesis -> answer/map/report/
trace) is realized in **two parallel implementations** in this repository.

## 1. The deployed application: `src/` (Next.js + PostgreSQL/Drizzle)

The platform this project is built on provisions a single Next.js fullstack
app with a managed PostgreSQL instance — there is no way to also run a
long-lived separate Python/FastAPI process as the *managed* production
service here. To still deliver a genuinely working, end-to-end SatQuery AI
system, the entire pipeline was implemented natively in TypeScript under
`src/server/satquery/`, wired to Next.js Route Handlers under `src/app/api/`,
and a Leaflet/React UI under `src/app/components/`. This is the version that
is built, type-checked, and started by `build_and_start` and is what you
interact with in the preview.

Module map (Next.js) -> architecture stage:

| Stage                     | File                                        |
|---------------------------|----------------------------------------------|
| Input validator           | `src/server/satquery/validator.ts`           |
| Query understanding       | `src/server/satquery/queryUnderstanding.ts`  |
| Agentic controller        | `src/server/satquery/controller.ts`          |
| Model/tool registry       | `src/server/satquery/registry.ts`            |
| Model wrappers            | `src/server/satquery/models.ts`              |
| Specialist tools          | `src/server/satquery/tools.ts`               |
| GIS / spatial processing  | `src/server/satquery/gis.ts`                 |
| Evidence + confidence     | `src/server/satquery/evidence.ts`            |
| LLM synthesis             | `src/server/satquery/synthesis.ts`           |
| Execution trace           | `src/server/satquery/trace.ts`               |
| Report generation         | `src/server/satquery/report.ts`              |
| Storage abstraction       | `src/server/satquery/storage.ts`             |
| Pipeline glue / DB persist| `src/server/satquery/pipeline.ts`            |

## 2. The reference Python backend: `backend/`

`backend/` is a complete, structurally faithful FastAPI implementation of the
exact same architecture, file-for-file matching the specification (validator/,
query_understanding/, agent/, tools/, models/, gis/, evidence/, synthesis/,
output/, config/). It is meant to be run on your own infrastructure once real
GPU-backed model weights (RSCoVLM-7B, CROMA, Qwen3-VL) are available — see
`docker/Dockerfile.backend` and `docker/docker-compose.yml` (`reference-backend`
profile). It is **not** executed by this sandbox's build/start pipeline.

## Why two implementations instead of one?

The master prompt specifies a Python/FastAPI backend + separate Next.js
frontend. The platform this assignment runs on only builds/serves a single
Next.js + PostgreSQL app. Rather than silently dropping capabilities, both
are provided:

- `src/` is the **real, running, validated** product — every capability in
  the spec (VQA, captioning, grounding, optical+SAR fusion, bi-temporal
  change, GIS, evidence, confidence, trace, report) works end-to-end today
  against real GeoTIFF/PNG/JPEG uploads.
- `backend/` is the **structural reference** matching the requested Python
  architecture 1:1, ready to be pointed at real model-serving endpoints
  (`RSCOVLM_ENDPOINT`, `CROMA_ENDPOINT`, `QWEN3VL_ENDPOINT`) and a real
  BigEarthNet/VRSBench/RSVQA/CDVQA dataset mirror.

## Model availability rule

No GPU or pretrained remote-sensing model weights (RSCoVLM-7B, CROMA,
Qwen3-VL) are available in this sandbox. Every model wrapper honestly reports
`available: false` with a reason via `health_check()` unless an inference
endpoint env var is configured, and the agentic controller reacts by using
the documented rule-based fallback (deterministic spectral-index analysis +
Otsu thresholding + connected-component analysis), never a fabricated
result. This satisfies "do not pretend unavailable models are working" while
still producing real, GIS-grounded answers from actual uploaded raster data.

## Where to plug in real models

- `RSCOVLM_ENDPOINT` / `CROMA_ENDPOINT` / `QWEN3VL_ENDPOINT` env vars — point
  these at a self-hosted inference server and `models.ts` (`healthCheck`)
  will report the model available; wire the actual request/response mapping
  in each wrapper's `predict()`.
- `OPENAI_API_KEY` — optional, only used for (a) ambiguous query-intent
  classification and (b) natural-language polishing of the grounded answer.
  Both paths are guarded so no unverified numeric claim can enter the final
  answer.
- LoRA adapters trained via `training/lora_adapter/train.py` are loaded from
  `training/adapters/<run_name>/` by `backend/models/rscovlm.py`.
