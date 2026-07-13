import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "MTCPL Cloud Slab Clean",
  description: "Fresh slab-to-carving workflow for slab intake, vendor assignment, approval and dispatch"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
