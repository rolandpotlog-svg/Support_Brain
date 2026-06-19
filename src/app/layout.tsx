import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Support-Brain",
  description: "Internes Support-Cockpit",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
