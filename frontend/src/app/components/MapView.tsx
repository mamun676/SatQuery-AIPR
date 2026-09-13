"use client";
// ═════════════════════════════════════════════════════════════════════════
// Geospatial view.
//
// A basemap is only shown when the result carries real geographic geometry.
// When the raster is not georeferenced the map falls back to Leaflet's planar
// CRS over the raster's own pixel grid and says so in the header — it never
// places pixel coordinates on a world basemap.
//
// The pixel-space y-flip from the original implementation is preserved
// verbatim: Leaflet's CRS.Simple origin is bottom-left, raster rows count
// from the top.
// ═════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoOverlay } from "@/server/satquery/types";
import { formatLatLon, formatPixelBox, shortCrs } from "@/lib/format";
import type { SpatialReading } from "@/lib/evidence";
import Icon from "./primitives/Icon";

export interface MapViewProps {
  overlay: GeoOverlay;
  spatial: SpatialReading;
  /** Already resolved against the API origin. */
  maskUrl: string | null;
  activeBox: number | null;
  onActiveBoxChange: (index: number | null) => void;
}

type BasemapId = "carto-dark" | "esri-imagery" | "none";

const BASEMAPS: Record<
  Exclude<BasemapId, "none">,
  { label: string; url: string; attribution: string; maxZoom: number; dim: boolean }
> = {
  "carto-dark": {
    label: "Carto dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 20,
    dim: false,
  },
  "esri-imagery": {
    label: "Esri imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
    dim: true,
  },
};

function FitTo({ bounds, trigger }: { bounds: L.LatLngBoundsExpression; trigger: number }) {
  const map = useMap();
  useEffect(() => {
    try {
      map.fitBounds(bounds, { padding: [22, 22] });
    } catch {
      /* invalid bounds — leave the current view untouched */
    }
  }, [map, bounds, trigger]);
  return null;
}

function CursorReadout({
  georeferenced,
  height,
  onChange,
}: {
  georeferenced: boolean;
  height: number;
  onChange: (text: string | null) => void;
}) {
  useMapEvents({
    mousemove(e) {
      const { lat, lng } = e.latlng;
      onChange(
        georeferenced
          ? formatLatLon(lat, lng)
          : `px ${Math.round(lng)}, ${Math.round(height - lat)}`,
      );
    },
    mouseout() {
      onChange(null);
    },
  });
  return null;
}

export default function MapView({
  overlay,
  spatial,
  maskUrl,
  activeBox,
  onActiveBoxChange,
}: MapViewProps) {
  const georeferenced = spatial.kind === "georeferenced";
  const [basemap, setBasemap] = useState<BasemapId>(georeferenced ? "carto-dark" : "none");
  const [showMask, setShowMask] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(georeferenced ? 0.7 : 0.85);
  const [showBoxes, setShowBoxes] = useState(true);
  const [readout, setReadout] = useState<string | null>(null);
  const [fitTick, setFitTick] = useState(0);

  const pixelHeight = spatial.pixelDimensions?.height ?? 1000;
  const pixelWidth = spatial.pixelDimensions?.width ?? 1000;

  const imageBounds = useMemo<L.LatLngBoundsExpression>(() => {
    if (georeferenced && spatial.imageBounds) {
      const [minX, minY, maxX, maxY] = spatial.imageBounds;
      return [
        [minY, minX],
        [maxY, maxX],
      ];
    }
    return [
      [0, 0],
      [pixelHeight, pixelWidth],
    ];
  }, [georeferenced, spatial.imageBounds, pixelHeight, pixelWidth]);

  // Rectangles in the map's own coordinate space.
  const rects = useMemo(
    () =>
      overlay.boxes.map((b, i) => {
        const bounds: L.LatLngBoundsExpression = georeferenced && b.geoBox
          ? [
              [b.geoBox[1], b.geoBox[0]],
              [b.geoBox[3], b.geoBox[2]],
            ]
          : [
              [pixelHeight - b.pixelBox[3], b.pixelBox[0]],
              [pixelHeight - b.pixelBox[1], b.pixelBox[2]],
            ];
        return { index: i, bounds, box: b };
      }),
    [overlay.boxes, georeferenced, pixelHeight],
  );

  const evidenceBounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (rects.length === 0) return null;
    const latLngs: L.LatLngTuple[] = [];
    for (const r of rects) {
      const pair = r.bounds as L.LatLngTuple[];
      latLngs.push(pair[0], pair[1]);
    }
    return L.latLngBounds(latLngs);
  }, [rects]);

  const active = activeBox !== null ? rects[activeBox] : undefined;
  useEffect(() => {
    if (active) setFitTick((t) => t + 1);
  }, [active]);

  const base = basemap === "none" ? null : BASEMAPS[basemap];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--hair)] px-2.5 py-1.5">
        <span className={["sq-label", georeferenced ? "sq-label-hi" : ""].join(" ")}>
          {georeferenced ? "Georeferenced" : "Pixel space — not georeferenced"}
        </span>
        {spatial.crs && (
          <span className="sq-num text-[10px] text-[var(--color-ink-3)]">{shortCrs(spatial.crs)}</span>
        )}
        <span className="sq-vrule mx-1 h-4" />

        {georeferenced ? (
          <label className="flex items-center gap-1.5">
            <span className="sq-label">Base</span>
            <select
              className="sq-select"
              value={basemap}
              onChange={(e) => setBasemap(e.target.value as BasemapId)}
              aria-label="Basemap"
            >
              <option value="carto-dark">Carto dark</option>
              <option value="esri-imagery">Esri imagery</option>
              <option value="none">None</option>
            </select>
          </label>
        ) : (
          <span className="sq-num text-[10px] text-[var(--color-ink-4)]">
            {pixelWidth}×{pixelHeight} px grid
          </span>
        )}

        <span className="flex-1" />

        {maskUrl && (
          <>
            <button
              type="button"
              className="sq-icon-btn"
              aria-pressed={showMask}
              onClick={() => setShowMask((v) => !v)}
              aria-label={showMask ? "Hide mask" : "Show mask"}
              title="Mask overlay"
            >
              <Icon name={showMask ? "eye" : "eyeOff"} size={13} />
            </button>
            <input
              type="range"
              className="sq-range w-20"
              min={0}
              max={100}
              value={Math.round(maskOpacity * 100)}
              onChange={(e) => setMaskOpacity(Number(e.target.value) / 100)}
              aria-label="Mask opacity"
              disabled={!showMask}
            />
          </>
        )}
        {rects.length > 0 && (
          <>
            <button
              type="button"
              className="sq-icon-btn"
              aria-pressed={showBoxes}
              onClick={() => setShowBoxes((v) => !v)}
              aria-label={showBoxes ? "Hide regions" : "Show regions"}
              title={`${rects.length} region${rects.length === 1 ? "" : "s"}`}
            >
              <Icon name="target" size={13} />
            </button>
            <button type="button" className="sq-btn sq-btn-sm" onClick={() => setFitTick((t) => t + 1)}>
              <Icon name="expand" size={12} />
              Fit evidence
            </button>
          </>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <MapContainer
          key={georeferenced ? "geo" : "pixel"}
          crs={georeferenced ? undefined : L.CRS.Simple}
          bounds={imageBounds}
          className="h-full w-full"
          scrollWheelZoom
          zoomControl
          attributionControl={georeferenced}
          style={{ background: "var(--color-void)" }}
        >
          {base && (
            <TileLayer
              url={base.url}
              attribution={base.attribution}
              maxZoom={base.maxZoom}
              className={base.dim ? "sq-basemap-dim" : undefined}
            />
          )}
          {maskUrl && showMask && (
            <ImageOverlay url={maskUrl} bounds={imageBounds} opacity={maskOpacity} />
          )}
          {showBoxes &&
            rects.map((r) => {
              const isActive = activeBox === r.index;
              return (
                <Rectangle
                  key={r.index}
                  bounds={r.bounds}
                  pathOptions={{
                    color: isActive ? "#4fe3ff" : "#ffb457",
                    weight: isActive ? 2.2 : 1.4,
                    fillColor: isActive ? "#4fe3ff" : "#ffb457",
                    fillOpacity: isActive ? 0.16 : 0.06,
                  }}
                  eventHandlers={{
                    click: () => onActiveBoxChange(isActive ? null : r.index),
                  }}
                >
                  <Tooltip direction="top" opacity={1}>
                    <span className="sq-mono text-[10.5px]">
                      {r.box.label}
                      {typeof r.box.score === "number" ? ` · ${r.box.score.toFixed(2)}` : ""}
                      <br />
                      {formatPixelBox(r.box.pixelBox)}
                    </span>
                  </Tooltip>
                </Rectangle>
              );
            })}
          {showBoxes &&
            rects.map((r) => {
              const pair = r.bounds as L.LatLngTuple[];
              const center: L.LatLngTuple = [
                (pair[0][0] + pair[1][0]) / 2,
                (pair[0][1] + pair[1][1]) / 2,
              ];
              return (
                <CircleMarker
                  key={`c-${r.index}`}
                  center={center}
                  radius={2.4}
                  pathOptions={{
                    color: activeBox === r.index ? "#4fe3ff" : "#ffb457",
                    fillOpacity: 1,
                  }}
                  interactive={false}
                />
              );
            })}
          <FitTo bounds={active?.bounds ?? evidenceBounds ?? imageBounds} trigger={fitTick} />
          <CursorReadout
            georeferenced={georeferenced}
            height={pixelHeight}
            onChange={setReadout}
          />
        </MapContainer>

        {readout && (
          <div className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded border border-[var(--hair-hi)] bg-[rgba(4,6,11,0.86)] px-2 py-1">
            <span className="sq-num text-[10px] text-[var(--color-ink-2)]">{readout}</span>
          </div>
        )}

        {!georeferenced && (
          <div className="pointer-events-none absolute right-2 top-2 z-[500] max-w-[38ch] rounded border border-[var(--color-caution)] bg-[rgba(4,6,11,0.88)] px-2.5 py-1.5">
            <p className="text-[10.5px] leading-[1.5] text-[var(--color-caution)]">
              {spatial.limitation ??
                "This raster is not georeferenced; coordinates are raster pixels, not the ground."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
