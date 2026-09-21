import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrailCast — conditions-aware trail decisions",
  description:
    "Ingests live weather, air quality, wildfire and stream-gauge data, scores it against each place's own terrain, and explains the verdict with citations.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1e9" },
    { media: "(prefers-color-scheme: dark)", color: "#171a16" },
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
