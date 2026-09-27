#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/qwen-manager/install.sh" >&2
  exit 1
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INSTALL_DIR=/opt/satquery/qwen-manager

if [[ ${SATQUERY_CONFIRM_WEB_DECOUPLING:-} != YES ]]; then
  cat >&2 <<'EOF'
Safety stop: review these first:
  systemctl cat satquery-web.service
  systemctl cat caddy.service
The installer clears satquery-web.service Unit dependencies so GPU model swaps
cannot stop the active HTTP request. Re-run only after review:
  SATQUERY_CONFIRM_WEB_DECOUPLING=YES bash deploy/qwen-manager/install.sh
EOF
  exit 2
fi
ENV_DIR=/etc/satquery

for file in \
  /opt/satquery/llama.cpp-v0.5.0/build/bin/llama-cli \
  /opt/satquery/llama.cpp-v0.5.0/build/bin/llama-mtmd-cli \
  /opt/satquery/models/qwen/qwen3-4b-gguf/Qwen3-4B-Q4_K_M.gguf \
  /opt/satquery/models/qwen/qwen3-vl-8b-instruct-gguf/Qwen3VL-8B-Instruct-Q4_K_M.gguf \
  /opt/satquery/models/qwen/qwen3-vl-8b-instruct-gguf/mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf; do
  [[ -f "$file" ]] || { echo "Missing required file: $file" >&2; exit 1; }
done

install -d -m 0755 "$INSTALL_DIR" "$ENV_DIR"
install -m 0755 "$ROOT/server.py" "$INSTALL_DIR/server.py"
install -m 0644 "$ROOT/satquery-qwen-manager.service" /etc/systemd/system/satquery-qwen-manager.service
if [[ ! -f "$ENV_DIR/qwen-manager.env" ]]; then
  install -m 0644 "$ROOT/qwen-manager.env.example" "$ENV_DIR/qwen-manager.env"
fi

# Keep the website alive while GPU specialists are intentionally stopped.
install -d -m 0755 /etc/systemd/system/satquery-web.service.d
install -m 0644 "$ROOT/satquery-web-independent.conf" \
  /etc/systemd/system/satquery-web.service.d/20-qwen-manager-independent.conf

systemctl daemon-reload
systemctl enable --now satquery-qwen-manager.service
systemctl restart satquery-web.service caddy.service
sleep 2
curl -fsS http://127.0.0.1:8003/health
printf '\nInstalled SatQuery Qwen manager on 127.0.0.1:8003\n'
