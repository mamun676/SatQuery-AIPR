import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SatQuery AI — Remote-Sensing Intelligence",
  description:
    "Agentic satellite image intelligence: natural-language querying over optical, SAR and bi-temporal imagery with GIS-derived evidence, confidence estimation and a full execution trace.",
  applicationName: "SatQuery AI",
  keywords: ["remote sensing", "satellite imagery", "GeoAI", "SAR", "change detection", "VQA", "GIS"],
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#04060b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
