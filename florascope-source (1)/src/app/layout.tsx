import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "FloraScope — drone dMRV for nature-based carbon",
  description:
    "FloraScope by Flora Carbon AI turns drone orthomosaics into audit-ready, GPS-tagged tree inventories: survival, gaps, health, height, biomass and tCO₂e with uncertainty — in your browser.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#060a08",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
