import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slots Studio — Blueprint Builder",
  description:
    "Professional slot-game construction environment. Build, organise and export Game Blueprints.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        {children}
      </body>
    </html>
  );
}
