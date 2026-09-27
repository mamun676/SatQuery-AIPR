#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
systemctl disable --now satquery-qwen-manager.service 2>/dev/null || true
rm -f /etc/systemd/system/satquery-qwen-manager.service
rm -f /etc/systemd/system/satquery-web.service.d/20-qwen-manager-independent.conf
systemctl daemon-reload
systemctl start satquery-model.service satquery-terramind.service satquery-web.service caddy.service
