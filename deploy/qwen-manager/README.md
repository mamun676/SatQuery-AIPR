# SatQuery Qwen manager

Local-only orchestration service for one-EC2/one-A10G operation.

## Endpoints

- `GET /health` and `GET /v1/status`
- `POST /v1/plan` — Qwen3-4B CPU planner with deterministic route enforcement
- `POST /v1/synthesize` — Qwen3-4B CPU wording pass; the Next.js number-grounding guard remains authoritative
- `POST /v1/change` — queued Qwen3-VL GPU inference over T1/T2, followed by unconditional RSCoVLM/TerraMind restoration

The service binds only to `127.0.0.1:8003`. Do not add a public security-group rule.

## Safety invariants

1. Image paths must resolve under the configured SatQuery storage root.
2. Requests are serialized through one inference lock.
3. Pair-mode routing is deterministic even if the planner over-selects models.
4. Qwen3-VL output never supplies area or pixel counts; GIS remains quantitative ground truth.
5. Baseline GPU services are restored in a `finally` block.
6. The website must be decoupled from model-service stop propagation before first `/v1/change` request.

## Installation order

1. Review dependencies:

   ```bash
   systemctl cat satquery-web.service
   systemctl cat caddy.service
   ```

2. From the checked-out feature branch, run:

   ```bash
   cd /home/ec2-user/SatQuery-AIPR-production
   SATQUERY_CONFIRM_WEB_DECOUPLING=YES sudo bash deploy/qwen-manager/install.sh
   ```

3. Add this to the environment file consumed by `satquery-web.service`:

   ```text
   QWEN_MANAGER_ENDPOINT=http://127.0.0.1:8003
   ```

4. Reload and restart the web service:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart satquery-web.service caddy.service
   ```

5. Validate:

   ```bash
   curl -fsS http://127.0.0.1:8003/health
   curl -fsS http://127.0.0.1:3000/api/health
   ```

## First GPU-swap test

Use a local `curl` request first, not the public UI. Keep an independent recovery timer active. Confirm that `satquery-web.service` and `caddy.service` remain active while RSCoVLM/TerraMind are intentionally stopped. Only then test through the browser.

## Rollback

```bash
sudo bash deploy/qwen-manager/uninstall.sh
```

Remove `QWEN_MANAGER_ENDPOINT` from the web environment and redeploy the previous Git commit.
