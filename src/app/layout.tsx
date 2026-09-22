import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/*
 * The brand's three voices: Big Shoulders Display for headlines, Instrument
 * Sans for everything read, JetBrains Mono for the numbers (64°F · 8 mph).
 * next/font self-hosts the body and number fonts at build time. The headline
 * face is linked from Google Fonts instead: it is published as "Big
 * Shoulders" now, and the next/font catalogue this build pins does not list
 * it under either name.
 */
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "TrailCast — know where to go, and when to go",
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
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
