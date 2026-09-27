#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
python3 - "$ROOT/server.py" "$ROOT/smoke_test.py" "$ROOT/make_test_pair.py" <<'PY'
from pathlib import Path
import sys
for name in sys.argv[1:]:
    source = Path(name).read_text(encoding="utf-8")
    compile(source, name, "exec")
PY

grep -F 'modalities=[OPTICAL_MODALITY, SAR_MODALITY]' "$ROOT/server.py" >/dev/null
grep -F '@app.post("/predict-optical-sar")' "$ROOT/server.py" >/dev/null
grep -F 'untok_sen1grd@224' "$ROOT/server.py" >/dev/null
grep -F 'Sentinel-1 GRD input requires two bands ordered VV, VH' "$ROOT/server.py" >/dev/null

echo "TerraMind Optical+SAR deployment validation passed."
