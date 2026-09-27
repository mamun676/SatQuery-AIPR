# TerraMind Optical + Sentinel-1 GRD service

This directory versions the production TerraMind server currently installed at
`/root/satquery/terramind_server/server.py`.

## Input contract

- Optical: RGB PNG/JPEG, three-band optical GeoTIFF, or Sentinel-2-style
  GeoTIFF where bands 4/3/2 are red/green/blue.
- SAR: calibrated two-band Sentinel-1 GRD GeoTIFF ordered `VV`, `VH`.
  Values may be dB backscatter or calibrated linear sigma0 in `0..1`.
- The pair must be co-registered. The application validator reports missing
  georeferencing and rejects incompatible band counts or mismatched CRS.

The model receives native TerraMind modalities `untok_sen2rgb@224` and
`untok_sen1grd@224` and generates `tok_lulc@224`. The output mask is
provisional: quantitative coverage, area, and region claims continue to come
from the deterministic GIS tool.

## Endpoints

- `GET /health`
- `POST /predict` — backwards-compatible single-image endpoint
- `POST /predict-optical-sar` — JSON with `optical_base64`, `sar_base64`, and
  optional filenames

## Install safely

Run from the repository root on the GPU EC2 host:

```bash
sudo bash deploy/terramind-server/install.sh
```

The installer creates a timestamped backup, arms an independent 12-minute
rollback timer, restarts only TerraMind, exercises both HTTP endpoints, checks
all production services, and cancels the timer only after success.

This integration has been capability-tested with the existing
`TerraMind_v1_base.pt`: native optical + Sentinel-1 GRD inference returned a
finite `(1, 10, 224, 224)` output. The included synthetic HTTP smoke test is a
functional regression, not an accuracy benchmark.

For a browser/API regression pair, run:

```bash
/root/satquery/terramind-venv/bin/python \
  deploy/terramind-server/make_test_pair.py \
  /tmp/satquery-optical-sar-pair
```

Upload `controlled-optical-rgb.tif` as **Optical** and
`controlled-sentinel1-grd-vv-vh.tif` as **SAR**, then use the query in
`TASK.txt`. This pair is synthetic and must never be reported as real-world
ground truth.
