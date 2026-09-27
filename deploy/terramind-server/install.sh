#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/terramind-server/install.sh" >&2
  exit 1
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TARGET_DIR=/root/satquery/terramind_server
TARGET="$TARGET_DIR/server.py"
PYTHON=/root/satquery/terramind-venv/bin/python
CHECKPOINT=/root/satquery/models/TerraMind/TerraMind_v1_base.pt
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$TARGET.pre-optical-sar-$STAMP"
ROLLBACK=/usr/local/sbin/satquery-terramind-optical-sar-rollback
ROLLBACK_UNIT=satquery-terramind-optical-sar-rollback

for file in "$PYTHON" "$CHECKPOINT" "$TARGET"; do
  [[ -e "$file" ]] || { echo "Missing required file: $file" >&2; exit 1; }
done

"$PYTHON" -c 'import fastapi, numpy, PIL, rasterio, torch, terratorch'
"$PYTHON" - "$ROOT/server.py" "$ROOT/smoke_test.py" "$ROOT/make_test_pair.py" <<'PY'
from pathlib import Path
import sys
for name in sys.argv[1:]:
    source = Path(name).read_text(encoding="utf-8")
    compile(source, name, "exec")
PY
bash "$ROOT/validate.sh"

cp -a "$TARGET" "$BACKUP"
install -d -m 0755 "$TARGET_DIR"
install -m 0644 "$ROOT/server.py" "$TARGET"

cat >"$ROLLBACK" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cp -a '$BACKUP' '$TARGET'
systemctl restart satquery-terramind.service
EOF
chmod 0755 "$ROLLBACK"

systemctl stop "$ROLLBACK_UNIT.timer" "$ROLLBACK_UNIT.service" 2>/dev/null || true
systemctl reset-failed "$ROLLBACK_UNIT.service" 2>/dev/null || true
systemd-run --unit="$ROLLBACK_UNIT" --on-active=12m "$ROLLBACK" >/dev/null

rollback_now() {
  trap - ERR
  echo "Activation failed; restoring $BACKUP" >&2
  "$ROLLBACK" || true
  echo "Rollback timer remains armed." >&2
}
trap rollback_now ERR

systemctl restart satquery-terramind.service

READY=0
for _ in $(seq 1 120); do
  if curl -fsS --max-time 5 http://127.0.0.1:8002/health >/tmp/satquery-terramind-health.json 2>/dev/null; then
    if "$PYTHON" - <<'PY'
import json
with open('/tmp/satquery-terramind-health.json', encoding='utf-8') as handle:
    data = json.load(handle)
required = {'untok_sen2rgb@224', 'untok_sen1grd@224'}
assert data.get('status') == 'ok'
assert data.get('device') == 'cuda'
assert data.get('optical_sar_ready') is True
assert required.issubset(set(data.get('input_modalities') or []))
PY
    then
      READY=1
      break
    fi
  fi
  sleep 5
done

[[ "$READY" -eq 1 ]]
"$PYTHON" "$ROOT/smoke_test.py" --endpoint http://127.0.0.1:8002

for service in \
  satquery-model.service \
  satquery-terramind.service \
  satquery-qwen-manager.service \
  satquery-web.service \
  caddy.service; do
  [[ $(systemctl is-active "$service") == active ]]
done

systemctl stop "$ROLLBACK_UNIT.timer" "$ROLLBACK_UNIT.service" 2>/dev/null || true
trap - ERR

echo "Installed TerraMind Optical+SAR server."
echo "Backup retained at: $BACKUP"
echo "Rollback helper retained at: $ROLLBACK"
