import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Big_Shoulders_Display, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/*
 * The brand's three voices: Big Shoulders Display for headlines, Instrument
 * Sans for everything read, JetBrains Mono for the numbers (64°F · 8 mph).
 * next/font self-hosts them at build time, so no request goes to Google at
 * runtime and there is no layout shift while they load.
 */
const display = Big_Shoulders_Display({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display" });
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "TrailCast — the forecast for where you're going",
  description:
    "Ingests live weather, air quality, wildfire and stream-gauge data, scores it against each place's own terrain, and explains the verdict with citations.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2EDE3" },
    { media: "(prefers-color-scheme: dark)", color: "#13201A" },
  ],
};

/*
 * Applies a stored theme choice before first paint. Without it, someone who
 * picked dark mode would see a flash of the light theme on every load while
 * React hydrated. It only reads a stored choice; with none, the stylesheet's
 * prefers-color-scheme rule handles the system default on its own.
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('trailcast-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The bootstrap script may set data-theme before React hydrates, so the
    // server and client markup legitimately differ on this one attribute.
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
