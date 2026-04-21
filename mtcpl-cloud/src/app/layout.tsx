import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "MTCPL Cloud",
  description: "Cloud workflow for blocks, slabs, cutting, carving and dispatch"
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

// Inline pre-hydration script — reads the saved theme from localStorage
// and sets data-theme on <html> BEFORE React paints. Without this,
// dark-mode users would briefly see the light theme on every page load
// (FOUC — flash of unstyled/unthemed content).
const themeInitScript = `
(function(){try{var t=localStorage.getItem('mtcpl_theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}else if(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){/* respect OS preference on first visit */document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
